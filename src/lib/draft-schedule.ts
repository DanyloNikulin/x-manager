import { randomUUID } from 'crypto';

import { sqlite } from '@/lib/db';
import { isThreadDraftSource, splitThreadDraft } from '@/lib/thread-draft';

/**
 * Scheduling a draft is one SQLite transaction: the draft row is claimed (deleted, and it
 * must still be there), the scheduled rows are inserted (one, or one per tweet of a thread
 * with a shared thread_id the scheduler service chains), and a worker task the draft came
 * from is closed. Used by the operator's Approve on the Overview and by the Drafts page, so
 * the two paths can never both publish the same draft.
 */

export type DraftRow = {
  id: number;
  account_slot: number;
  text: string;
  source: string | null;
  reply_to_tweet_id: string | null;
  media_urls: string | null;
};

export class DraftScheduleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type ScheduledDraft = { scheduledPostId: number; threadId: string | null; tweets: number; taskId: number | null };

/** `subscription-worker:<outcome>:[thread:]task:<id>` → id. */
export function taskIdFromDraftSource(source: string | null): number | null {
  const match = source?.match(/^subscription-worker:.*:task:(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * Must run inside a `sqlite.transaction`. Claims the draft by id (and, when given, by the
 * exact text the caller planned with) and writes the scheduled rows. `dedupePrefix` keys the
 * rows (`<prefix>` for a post, `<prefix>:<index>` for a thread). Returns what was written.
 */
export function claimAndScheduleDraft(
  draftId: number,
  scheduledEpoch: number,
  dedupePrefix: string,
  expectedText: string | null = null,
  tags: string[] = ['subscription-worker'],
): ScheduledDraft {
  const draft = sqlite
    .prepare('DELETE FROM draft_posts WHERE id = ? AND (? IS NULL OR text IS ?) RETURNING id, account_slot, text, source, reply_to_tweet_id, media_urls')
    .get(draftId, expectedText, expectedText) as DraftRow | undefined;
  if (!draft) throw new DraftScheduleError('The draft is gone or changed meanwhile (scheduled or deleted elsewhere); reload.', 409);

  const isThread = isThreadDraftSource(draft.source);
  const tweets = isThread ? splitThreadDraft(draft.text) : [draft.text];
  if (isThread && tweets.length < 2) throw new DraftScheduleError('The thread draft has fewer than two tweets.', 409);
  const threadId = isThread ? randomUUID() : null;
  const insert = sqlite.prepare(
    `INSERT INTO scheduled_posts (account_slot, text, dedupe_key, media_urls, reply_to_tweet_id, thread_id, thread_index, scheduled_time, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, unixepoch(), unixepoch())`,
  );
  let firstId = 0;
  tweets.forEach((text, index) => {
    const inserted = insert.run(
      draft.account_slot,
      text,
      isThread ? `${dedupePrefix}:${index}` : dedupePrefix,
      index === 0 ? (draft.media_urls ?? '[]') : '[]',
      isThread ? null : draft.reply_to_tweet_id,
      threadId,
      isThread ? index : null,
      scheduledEpoch,
      JSON.stringify(tags),
    );
    if (index === 0) firstId = Number(inserted.lastInsertRowid);
  });
  return { scheduledPostId: firstId, threadId, tweets: tweets.length, taskId: taskIdFromDraftSource(draft.source) };
}

/**
 * The Drafts page path: schedule draft `draftId` at `scheduledAt`, closing the worker task
 * it came from (if any, and still waiting) as approved from Drafts. One transaction.
 */
export function scheduleDraftFromDrafts(draftId: number, scheduledAt: Date, now: Date = new Date()): ScheduledDraft & { scheduledFor: string } {
  const scheduledEpoch = Math.floor(scheduledAt.getTime() / 1000);
  const result = sqlite.transaction(() => {
    // Draft ids are reused by SQLite after deletion, so the dedupe key carries a fresh id:
    // the claim on the draft row, not the key, is what prevents scheduling it twice.
    const scheduled = claimAndScheduleDraft(draftId, scheduledEpoch, `drafts:${randomUUID()}`, null, ['drafts']);
    if (scheduled.taskId !== null) {
      const row = sqlite.prepare('SELECT output FROM campaign_tasks WHERE id = ? AND status = ?').get(scheduled.taskId, 'waiting_approval') as { output: string | null } | undefined;
      if (row) {
        let output: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(row.output ?? '{}') as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) output = parsed as Record<string, unknown>;
        } catch {
          output = {};
        }
        output.review = { action: 'approve', via: 'drafts', at: now.toISOString(), scheduled_for: scheduledAt.toISOString(), scheduled_post_id: scheduled.scheduledPostId, thread_id: scheduled.threadId };
        sqlite.prepare(`UPDATE campaign_tasks SET status = 'done', output = ?, updated_at = unixepoch() WHERE id = ? AND status = 'waiting_approval'`).run(JSON.stringify(output), scheduled.taskId);
      }
    }
    return scheduled;
  })();
  return { ...result, scheduledFor: scheduledAt.toISOString() };
}
