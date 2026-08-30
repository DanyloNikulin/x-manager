import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';
import { emitEvent } from '@/lib/events';
import { parsePositiveTaskId, parseWorkerId, parseWorkerPublicationMode } from '@/lib/subscription-worker';
import { deliverEventToWebhooks } from '@/lib/webhook-delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 25_000;
const MAX_OUTPUT_LENGTH = 1_000_000;

type ResultBody = {
  worker_id?: unknown;
  outcome?: unknown;
  output?: unknown;
  publication_mode?: unknown;
  draft?: {
    text?: unknown;
    media_urls?: unknown;
    reply_to_tweet_id?: unknown;
  };
};

type ClaimedTask = {
  id: number;
  account_slot: number;
  task_type: string;
  claimed_by: string | null;
  status: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const taskId = parsePositiveTaskId(rawId);
  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
  }

  let body: ResultBody;
  try {
    body = (await req.json()) as ResultBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const workerId = parseWorkerId(body.worker_id);
  if (!workerId) {
    return NextResponse.json({ error: 'worker_id is invalid.' }, { status: 400 });
  }

  const outcome = body.outcome;
  if (outcome !== 'drafted' && outcome !== 'needs_review' && outcome !== 'failed') {
    return NextResponse.json({ error: 'outcome must be drafted, needs_review, or failed.' }, { status: 400 });
  }

  const publicationMode = body.publication_mode === undefined
    ? 'draft'
    : parseWorkerPublicationMode(body.publication_mode);
  if (!publicationMode) {
    return NextResponse.json({ error: 'publication_mode must be auto or draft.' }, { status: 400 });
  }
  if (outcome !== 'drafted' && body.publication_mode !== undefined) {
    return NextResponse.json({ error: 'publication_mode is only valid for drafted outcomes.' }, { status: 400 });
  }

  let outputJson: string;
  try {
    outputJson = JSON.stringify(body.output ?? null);
  } catch {
    return NextResponse.json({ error: 'output must be JSON serializable.' }, { status: 400 });
  }
  if (outputJson.length > MAX_OUTPUT_LENGTH) {
    return NextResponse.json({ error: 'output is too large.' }, { status: 413 });
  }

  const draftText = typeof body.draft?.text === 'string' ? body.draft.text.trim() : '';
  if (outcome === 'drafted' && !draftText) {
    return NextResponse.json({ error: 'draft.text is required for a drafted outcome.' }, { status: 400 });
  }
  if (draftText.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'draft.text is too long.' }, { status: 400 });
  }
  if (outcome === 'failed' && body.draft !== undefined) {
    return NextResponse.json({ error: 'draft is not allowed for a failed outcome.' }, { status: 400 });
  }

  const mediaUrls = Array.isArray(body.draft?.media_urls)
    ? body.draft.media_urls.filter((item): item is string => typeof item === 'string').slice(0, 4)
    : [];
  const replyToTweetId = typeof body.draft?.reply_to_tweet_id === 'string'
    ? body.draft.reply_to_tweet_id.trim() || null
    : null;

  const task = sqlite.prepare(`
    SELECT ct.id, c.account_slot, ct.task_type, ct.claimed_by, ct.status
    FROM campaign_tasks ct
    JOIN campaigns c ON c.id = ct.campaign_id
    WHERE ct.id = ?
    LIMIT 1
  `).get(taskId) as ClaimedTask | undefined;

  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  if (task.status !== 'in_progress' || task.claimed_by !== workerId) {
    return NextResponse.json({ error: 'Task is not claimed by this worker.' }, { status: 409 });
  }

  let autoPublishBlocked: string | null = null;
  if (outcome === 'drafted' && publicationMode === 'auto' && (task.task_type === 'reply' || replyToTweetId)) {
    if (!replyToTweetId) {
      autoPublishBlocked = 'Reply task has no target tweet id.';
    } else {
      const inbound = sqlite.prepare(`
        SELECT id FROM engagement_inbox
        WHERE account_slot = ?
          AND source_type = 'mention'
          AND source_id = ?
          AND status IN ('new', 'reviewed')
        LIMIT 1
      `).get(task.account_slot, replyToTweetId) as { id: number } | undefined;
      if (!inbound) {
        autoPublishBlocked = 'Reply target is not an unanswered inbound mention for this account.';
      } else {
        const existingReply = sqlite.prepare(`
          SELECT id FROM scheduled_posts
          WHERE account_slot = ?
            AND reply_to_tweet_id = ?
            AND status IN ('scheduled', 'posted')
          LIMIT 1
        `).get(task.account_slot, replyToTweetId) as { id: number } | undefined;
        if (existingReply) {
          autoPublishBlocked = 'A reply to this mention is already scheduled or posted.';
        }
      }
    }
  }
  const effectivePublicationMode = publicationMode === 'auto' && !autoPublishBlocked ? 'auto' : 'draft';

  if (autoPublishBlocked) {
    try {
      const parsed = JSON.parse(outputJson) as unknown;
      const enriched = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...parsed, publication: { requested: publicationMode, effective: effectivePublicationMode, blocked_reason: autoPublishBlocked } }
        : { agent_output: parsed, publication: { requested: publicationMode, effective: effectivePublicationMode, blocked_reason: autoPublishBlocked } };
      outputJson = JSON.stringify(enriched);
    } catch {
      // outputJson was already validated; keep the original if enrichment is unavailable.
    }
  }
  if (outputJson.length > MAX_OUTPUT_LENGTH) {
    return NextResponse.json({ error: 'output is too large after publication metadata was added.' }, { status: 413 });
  }

  const commitResult = sqlite.transaction(() => {
    let draftId: number | null = null;
    let scheduledPostId: number | null = null;
    if (draftText && outcome === 'drafted' && effectivePublicationMode === 'auto') {
      const dedupeKey = replyToTweetId
        ? `subscription-worker:reply:${replyToTweetId}`
        : `subscription-worker:task:${taskId}`;
      const inserted = sqlite.prepare(`
        INSERT OR IGNORE INTO scheduled_posts (
          account_slot, text, dedupe_key, media_urls, reply_to_tweet_id,
          scheduled_time, status, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, unixepoch(), 'scheduled', ?, unixepoch(), unixepoch())
      `).run(
        task.account_slot,
        draftText,
        dedupeKey,
        JSON.stringify(mediaUrls),
        replyToTweetId,
        JSON.stringify(['subscription-worker']),
      );
      if (inserted.changes === 1) {
        scheduledPostId = Number(inserted.lastInsertRowid);
      } else {
        const existing = sqlite.prepare(`
          SELECT id FROM scheduled_posts
          WHERE account_slot = ? AND dedupe_key = ? AND status = 'scheduled'
          LIMIT 1
        `).get(task.account_slot, dedupeKey) as { id: number } | undefined;
        if (!existing) {
          throw new Error('Could not resolve the idempotent scheduled post.');
        }
        scheduledPostId = existing.id;
      }
    } else if (draftText) {
      const inserted = sqlite.prepare(`
        INSERT INTO draft_posts (
          account_slot, text, media_urls, reply_to_tweet_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).run(
        task.account_slot,
        draftText,
        mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
        replyToTweetId,
        `subscription-worker:${autoPublishBlocked ? 'auto-blocked' : outcome}:task:${taskId}`,
      );
      draftId = Number(inserted.lastInsertRowid);
    }

    const nextStatus = outcome === 'drafted' && !autoPublishBlocked
      ? 'done'
      : outcome === 'failed'
        ? 'failed'
        : 'waiting_approval';
    const update = sqlite.prepare(`
      UPDATE campaign_tasks
      SET status = ?, output = ?, updated_at = unixepoch()
      WHERE id = ? AND status = 'in_progress' AND claimed_by = ?
    `).run(nextStatus, outputJson, taskId, workerId);

    if (update.changes !== 1) {
      throw new Error('Task claim changed while committing the result.');
    }
    return { draftId, scheduledPostId, status: nextStatus };
  })();

  if (commitResult.scheduledPostId !== null) {
    try {
      const event = {
        eventType: 'post.scheduled' as const,
        entityType: 'post',
        entityId: commitResult.scheduledPostId,
        accountSlot: task.account_slot,
        payload: {
          scheduledTime: new Date().toISOString(),
          source: `subscription-worker:task:${taskId}`,
        },
      };
      const eventId = emitEvent(event);
      deliverEventToWebhooks(eventId, event);
    } catch {
      // Scheduling remains successful if event fanout is unavailable.
    }
  }

  return NextResponse.json({
    ok: true,
    task_id: taskId,
    requested_publication_mode: outcome === 'drafted' ? publicationMode : null,
    publication_mode: outcome === 'drafted' ? effectivePublicationMode : null,
    auto_publish_blocked: autoPublishBlocked,
    ...commitResult,
  });
}
