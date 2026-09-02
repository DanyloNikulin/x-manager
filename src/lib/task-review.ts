import { randomUUID } from 'crypto';

import { sqlite } from '@/lib/db';
import { isAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { checkPolicy, getSlotPolicy } from '@/lib/policy';
import { suggestMultipleOptimalTimes, suggestOptimalTime } from '@/lib/optimal-time';
import { planWorkerPublishTime } from '@/lib/worker-publish';
import { isThreadDraftSource, splitThreadDraft } from '@/lib/thread-draft';

/**
 * The operator's decision on a worker task that waits for review: approve publishes the
 * draft the worker left (a reply keeps its target, a thread is rebuilt, a post takes the
 * next open slot under the slot policy) and closes the task as done; reject deletes the
 * draft and closes the task as skipped. Both are recorded in the task output.
 */

export type ReviewAction = 'approve' | 'reject';

export class ReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type TaskRow = { id: number; account_slot: number; task_type: string; status: string; output: string | null };
type DraftRow = { id: number; text: string; source: string | null; reply_to_tweet_id: string | null; media_urls: string | null };

function loadTask(taskId: number): TaskRow | null {
  const row = sqlite
    .prepare(
      `SELECT ct.id, c.account_slot, ct.task_type, ct.status, ct.output
       FROM campaign_tasks ct JOIN campaigns c ON c.id = ct.campaign_id
       WHERE ct.id = ? LIMIT 1`,
    )
    .get(taskId) as TaskRow | undefined;
  return row ?? null;
}

/** The draft the worker stored for this task: its source ends with `:task:<id>`. */
export function findTaskDraft(taskId: number, slot: AccountSlot): DraftRow | null {
  const row = sqlite
    .prepare(
      `SELECT id, text, source, reply_to_tweet_id, media_urls
       FROM draft_posts
       WHERE account_slot = ? AND source LIKE 'subscription-worker:%' AND source LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(slot, `%:task:${taskId}`) as DraftRow | undefined;
  return row ?? null;
}

function mergedOutput(output: string | null, review: Record<string, unknown>): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(output ?? '{}') as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return JSON.stringify({ ...parsed, review });
}

/** Same planning as the worker's auto path: replies on the next tick, posts in the next open slot, policy has the final say. */
async function planTime(slot: AccountSlot, actionType: 'post' | 'reply', now: Date): Promise<Date> {
  const policy = await getSlotPolicy(slot);
  const spacingMinutes = 90;
  const existingScheduled = (
    sqlite
      .prepare(`SELECT scheduled_time FROM scheduled_posts WHERE account_slot = ? AND status IN ('scheduled', 'posted') AND scheduled_time >= ?`)
      .all(slot, Math.floor(now.getTime() / 1000) - spacingMinutes * 60) as Array<{ scheduled_time: number }>
  ).map((row) => row.scheduled_time);
  const candidates = actionType === 'post' ? [...suggestMultipleOptimalTimes(slot, 5).map((s) => s.time), suggestOptimalTime(slot)] : [];
  const plan = planWorkerPublishTime({
    now,
    actionType,
    candidates,
    existingScheduled,
    window: { start: policy.allowedWindowStart, end: policy.allowedWindowEnd, timezone: policy.timezone },
    spacingMinutes,
  });
  const verdict = await checkPolicy({ slot, actionType, scheduledTime: plan.scheduledAt });
  if (!verdict.allowed) throw new ReviewError(`Policy refuses this time: ${verdict.reason}`, 409);
  return plan.scheduledAt;
}

/** Test hook: runs after planning and before the transactional write (simulates a concurrent decision). */
export type ReviewOptions = { now?: Date; beforeWrite?: () => void };

export async function reviewTask(
  taskId: number,
  action: ReviewAction,
  options: ReviewOptions = {},
): Promise<{ status: string; scheduledPostId: number | null; scheduledFor: string | null; threadId: string | null }> {
  const now = options.now ?? new Date();
  const task = loadTask(taskId);
  if (!task) throw new ReviewError('Task not found.', 404);
  if (task.status !== 'waiting_approval') throw new ReviewError(`Task is ${task.status}, not waiting for review.`, 409);
  if (!isAccountSlot(task.account_slot)) throw new ReviewError('Task has no valid account slot.', 409);
  const slot = task.account_slot;
  const draft = findTaskDraft(taskId, slot);
  const at = now.toISOString();

  if (action === 'reject') {
    sqlite.transaction(() => {
      if (draft) sqlite.prepare('DELETE FROM draft_posts WHERE id = ?').run(draft.id);
      const update = sqlite
        .prepare(`UPDATE campaign_tasks SET status = 'skipped', output = ?, updated_at = unixepoch() WHERE id = ? AND status = 'waiting_approval'`)
        .run(mergedOutput(task.output, { action: 'reject', at, draft_id: draft?.id ?? null }), taskId);
      if (update.changes !== 1) throw new ReviewError('Task changed while rejecting; reload.', 409);
    })();
    return { status: 'skipped', scheduledPostId: null, scheduledFor: null, threadId: null };
  }

  if (!draft) throw new ReviewError('This task has no draft left to approve (it may have been scheduled or deleted from Drafts).', 409);

  // What gets scheduled: one row for a post or reply, one row per tweet for a thread
  // (same shape the thread scheduler writes: shared thread_id, ascending thread_index, the
  // scheduler service chains index > 0 as replies to the previous tweet once it is posted).
  const isThread = isThreadDraftSource(draft.source);
  const tweets = isThread ? splitThreadDraft(draft.text) : [draft.text];
  if (isThread && tweets.length < 2) throw new ReviewError('The thread draft has fewer than two tweets.', 409);
  const actionType = !isThread && draft.reply_to_tweet_id ? 'reply' : 'post';
  const scheduledAt = await planTime(slot, actionType, now);
  const scheduledEpoch = Math.floor(scheduledAt.getTime() / 1000);
  const threadId = isThread ? randomUUID() : null;

  options.beforeWrite?.();

  // One transaction: the rows, the draft deletion and the guarded task update commit
  // together or not at all, so a concurrent rejection (or any failure) can never leave a
  // scheduled thread behind a task that is not done.
  const scheduledPostId = sqlite.transaction(() => {
    const insert = sqlite.prepare(
      `INSERT INTO scheduled_posts (account_slot, text, dedupe_key, media_urls, reply_to_tweet_id, thread_id, thread_index, scheduled_time, status, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, unixepoch(), unixepoch())`,
    );
    let firstId: number | null = null;
    tweets.forEach((text, index) => {
      const inserted = insert.run(
        slot,
        text,
        isThread ? `subscription-worker:review:task:${taskId}:${index}` : `subscription-worker:review:task:${taskId}`,
        index === 0 ? (draft.media_urls ?? '[]') : '[]',
        isThread ? null : draft.reply_to_tweet_id,
        threadId,
        isThread ? index : null,
        scheduledEpoch,
        JSON.stringify(['subscription-worker', 'approved']),
      );
      if (index === 0) firstId = Number(inserted.lastInsertRowid);
    });
    sqlite.prepare('DELETE FROM draft_posts WHERE id = ?').run(draft.id);
    const update = sqlite
      .prepare(`UPDATE campaign_tasks SET status = 'done', output = ?, updated_at = unixepoch() WHERE id = ? AND status = 'waiting_approval'`)
      .run(mergedOutput(task.output, { action: 'approve', at, scheduled_for: scheduledAt.toISOString(), scheduled_post_id: firstId, thread_id: threadId, tweets: tweets.length }), taskId);
    if (update.changes !== 1) throw new ReviewError('Task changed while approving; reload.', 409);
    return firstId;
  })();
  return { status: 'done', scheduledPostId, scheduledFor: scheduledAt.toISOString(), threadId };
}
