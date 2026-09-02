import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-review-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { POST } = await import('@/app/api/agent/tasks/[id]/review/route');

let campaignId = 0;

function task(type: string, status = 'waiting_approval'): number {
  return Number(
    sqlite
      .prepare(`INSERT INTO campaign_tasks (campaign_id, task_type, title, details, output, priority, assigned_agent, status) VALUES (?, ?, ?, '{}', '{"validation":{"verdict":"pass","score":91}}', 1, 'subscription-agent', ?)`)
      .run(campaignId, type, `${type} task`, status).lastInsertRowid,
  );
}

function draft(taskId: number, text: string, replyTo: string | null, thread = false): number {
  return Number(
    sqlite
      .prepare(`INSERT INTO draft_posts (account_slot, text, reply_to_tweet_id, source, created_at, updated_at) VALUES (1, ?, ?, ?, unixepoch(), unixepoch())`)
      .run(text, replyTo, `subscription-worker:needs_review:${thread ? 'thread:' : ''}task:${taskId}`).lastInsertRowid,
  );
}

function call(id: number, action: string) {
  return POST(new Request(`http://127.0.0.1/api/agent/tasks/${id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const status = (id: number) => (sqlite.prepare('SELECT status FROM campaign_tasks WHERE id = ?').get(id) as { status: string }).status;
const draftCount = () => (sqlite.prepare('SELECT count(*) AS n FROM draft_posts').get() as { n: number }).n;

beforeAll(() => {
  campaignId = Number(sqlite.prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'o', 1, 'active')").run().lastInsertRowid);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('POST /api/agent/tasks/:id/review', () => {
  it('approves a reply: schedules it with its target, deletes the draft, closes the task', async () => {
    const id = task('reply');
    draft(id, 'Rural wires got paid back by the farms they reached.', '2095272264681844840');
    const response = await call(id, 'approve');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; scheduledPostId: number | null; scheduledFor: string | null };
    expect(body.status).toBe('done');
    expect(body.scheduledPostId).not.toBeNull();
    const post = sqlite.prepare('SELECT status, reply_to_tweet_id, dedupe_key, text FROM scheduled_posts WHERE id = ?').get(body.scheduledPostId) as Record<string, string>;
    expect(post).toMatchObject({ status: 'scheduled', reply_to_tweet_id: '2095272264681844840', dedupe_key: `subscription-worker:review:task:${id}` });
    expect(status(id)).toBe('done');
    expect(draftCount()).toBe(0);
    const output = JSON.parse((sqlite.prepare('SELECT output FROM campaign_tasks WHERE id = ?').get(id) as { output: string }).output) as { review: { action: string }; validation: { score: number } };
    expect(output.review.action).toBe('approve');
    expect(output.validation.score).toBe(91);
  });

  it('rejects: deletes the draft and skips the task', async () => {
    const id = task('post');
    draft(id, 'a post', null);
    const response = await call(id, 'reject');
    expect(response.status).toBe(200);
    expect(status(id)).toBe('skipped');
    expect(draftCount()).toBe(0);
  });

  it('approves a thread draft through the thread scheduler', async () => {
    const id = task('post');
    draft(id, 'first tweet\n\n---\n\nsecond tweet', null, true);
    const response = await call(id, 'approve');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threadId: string | null };
    expect(body.threadId).not.toBeNull();
    expect((sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts WHERE thread_id = ?').get(body.threadId) as { n: number }).n).toBe(2);
    expect(status(id)).toBe('done');
  });

  it('refuses what cannot be reviewed', async () => {
    const noDraft = task('reply');
    expect((await call(noDraft, 'approve')).status).toBe(409);
    expect(status(noDraft)).toBe('waiting_approval');
    expect((await call(noDraft, 'reject')).status).toBe(200);
    const done = task('post', 'done');
    expect((await call(done, 'approve')).status).toBe(409);
    expect((await call(999999, 'approve')).status).toBe(404);
    expect((await call(noDraft, 'maybe')).status).toBe(400);
  });
});
