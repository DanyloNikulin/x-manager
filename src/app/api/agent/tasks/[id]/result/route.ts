import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';
import { parsePositiveTaskId, parseWorkerId } from '@/lib/subscription-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 25_000;
const MAX_OUTPUT_LENGTH = 1_000_000;

type ResultBody = {
  worker_id?: unknown;
  outcome?: unknown;
  output?: unknown;
  draft?: {
    text?: unknown;
    media_urls?: unknown;
    reply_to_tweet_id?: unknown;
  };
};

type ClaimedTask = {
  id: number;
  account_slot: number;
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
    SELECT ct.id, c.account_slot, ct.claimed_by, ct.status
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

  const commitResult = sqlite.transaction(() => {
    let draftId: number | null = null;
    if (draftText) {
      const inserted = sqlite.prepare(`
        INSERT INTO draft_posts (
          account_slot, text, media_urls, reply_to_tweet_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).run(
        task.account_slot,
        draftText,
        mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
        replyToTweetId,
        `subscription-worker:${outcome}:task:${taskId}`,
      );
      draftId = Number(inserted.lastInsertRowid);
    }

    const nextStatus = outcome === 'drafted' ? 'done' : outcome === 'needs_review' ? 'waiting_approval' : 'failed';
    const update = sqlite.prepare(`
      UPDATE campaign_tasks
      SET status = ?, output = ?, updated_at = unixepoch()
      WHERE id = ? AND status = 'in_progress' AND claimed_by = ?
    `).run(nextStatus, outputJson, taskId, workerId);

    if (update.changes !== 1) {
      throw new Error('Task claim changed while committing the result.');
    }
    return { draftId, status: nextStatus };
  })();

  return NextResponse.json({ ok: true, task_id: taskId, ...commitResult });
}
