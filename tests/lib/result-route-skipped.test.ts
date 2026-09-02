import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Route-level test for the `skipped` outcome of POST /api/agent/tasks/:id/result.
 * The database module resolves its file from X_MANAGER_DB_PATH at import time, so the
 * environment is set before the route (and everything it pulls in) is imported.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-result-route-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { POST } = await import('@/app/api/agent/tasks/[id]/result/route');

const WORKER = 'test.worker-1';

function call(taskId: number, body: Record<string, unknown>) {
  const request = new Request(`http://127.0.0.1/api/agent/tasks/${taskId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: String(taskId) }) });
}

function taskStatus(taskId: number): string {
  return (sqlite.prepare('SELECT status FROM campaign_tasks WHERE id = ?').get(taskId) as { status: string }).status;
}

function inboxStatus(inboxId: number): { status: string; assigned_to: string | null } {
  return sqlite.prepare('SELECT status, assigned_to FROM engagement_inbox WHERE id = ?').get(inboxId) as { status: string; assigned_to: string | null };
}

let postTaskId = 0;
let replyTaskId = 0;
let orphanReplyTaskId = 0;
let mismatchedReplyTaskId = 0;
let inboxId = 0;
let otherInboxId = 0;

beforeAll(() => {
  const campaign = sqlite
    .prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'objective', 1, 'active')")
    .run();
  const campaignId = Number(campaign.lastInsertRowid);

  const inbox = sqlite
    .prepare(`INSERT INTO engagement_inbox (account_slot, source_type, source_id, text, raw_payload, received_at, status, assigned_to)
              VALUES (1, 'mention', '555', 'buy my coin @LoopedHuman', '{}', unixepoch(), 'new', 'subscription-agent')`)
    .run();
  inboxId = Number(inbox.lastInsertRowid);
  // A second, unrelated mention from someone else: must never be touched by another task's skip.
  const otherInbox = sqlite
    .prepare(`INSERT INTO engagement_inbox (account_slot, source_type, source_id, text, raw_payload, received_at, status, assigned_to)
              VALUES (1, 'mention', '777', 'genuine question @LoopedHuman', '{}', unixepoch(), 'new', 'subscription-agent')`)
    .run();
  otherInboxId = Number(otherInbox.lastInsertRowid);

  const insertTask = sqlite.prepare(`INSERT INTO campaign_tasks (campaign_id, task_type, title, details, priority, assigned_agent, status, claimed_by, claimed_at)
                                     VALUES (?, ?, ?, ?, 1, 'subscription-agent', 'in_progress', ?, unixepoch())`);
  postTaskId = Number(insertTask.run(campaignId, 'post', 'a post', JSON.stringify({ topic: 't' }), WORKER).lastInsertRowid);
  replyTaskId = Number(
    insertTask.run(campaignId, 'reply', 'Reply to @spam', JSON.stringify({ reply_to_tweet_id: '555', reply_kind: 'inbound', inbox_id: inboxId }), WORKER).lastInsertRowid,
  );
  orphanReplyTaskId = Number(
    insertTask.run(campaignId, 'reply', 'Reply to @gone', JSON.stringify({ reply_to_tweet_id: '556', reply_kind: 'inbound', inbox_id: 999999 }), WORKER).lastInsertRowid,
  );
  // Malformed task: it answers tweet 558 but its details point at the inbox row of tweet 777.
  mismatchedReplyTaskId = Number(
    insertTask.run(campaignId, 'reply', 'Reply to @mismatch', JSON.stringify({ reply_to_tweet_id: '558', reply_kind: 'inbound', inbox_id: otherInboxId }), WORKER).lastInsertRowid,
  );
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('POST /api/agent/tasks/:id/result with outcome skipped', () => {
  it('refuses to skip a post task', async () => {
    const response = await call(postTaskId, { worker_id: WORKER, outcome: 'skipped', output: { decision: 'ignore' } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('Only reply tasks can be skipped.');
    expect(taskStatus(postTaskId)).toBe('in_progress');
  });

  it('refuses a skipped outcome that carries a draft', async () => {
    const response = await call(replyTaskId, { worker_id: WORKER, outcome: 'skipped', output: {}, draft: { text: 'nope' } });
    expect(response.status).toBe(400);
    expect(taskStatus(replyTaskId)).toBe('in_progress');
    expect(inboxStatus(inboxId).status).toBe('new');
  });

  it('skips a reply task and dismisses its mention in one go', async () => {
    const response = await call(replyTaskId, {
      worker_id: WORKER,
      outcome: 'skipped',
      output: { decision: 'ignore', writer: { triage: { class: 'spam', decision: 'ignore', reason: 'promo' } } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; status: string; draftId: number | null; scheduledPostId: number | null };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('skipped');
    expect(body.draftId).toBeNull();
    expect(body.scheduledPostId).toBeNull();
    expect(taskStatus(replyTaskId)).toBe('skipped');
    expect(inboxStatus(inboxId)).toEqual({ status: 'dismissed', assigned_to: 'subscription-agent' });
    const stored = sqlite.prepare('SELECT output FROM campaign_tasks WHERE id = ?').get(replyTaskId) as { output: string };
    expect(JSON.parse(stored.output)).toMatchObject({ decision: 'ignore' });
    expect(sqlite.prepare('SELECT count(*) AS n FROM draft_posts').get()).toEqual({ n: 0 });
  });

  it('will not skip the same task twice', async () => {
    const response = await call(replyTaskId, { worker_id: WORKER, outcome: 'skipped', output: {} });
    expect(response.status).toBe(409);
  });

  it('skips a reply whose mention is gone without failing', async () => {
    const response = await call(orphanReplyTaskId, { worker_id: WORKER, outcome: 'skipped', output: { decision: 'ignore' } });
    expect(response.status).toBe(200);
    expect(taskStatus(orphanReplyTaskId)).toBe('skipped');
  });

  it('never dismisses a mention that is not the one the task answers', async () => {
    const response = await call(mismatchedReplyTaskId, { worker_id: WORKER, outcome: 'skipped', output: { decision: 'ignore' } });
    expect(response.status).toBe(200);
    expect(taskStatus(mismatchedReplyTaskId)).toBe('skipped');
    // inbox_id pointed at tweet 777's row, but the task answers tweet 558: the row stays open.
    expect(inboxStatus(otherInboxId)).toEqual({ status: 'new', assigned_to: 'subscription-agent' });
  });
});
