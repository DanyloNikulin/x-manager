import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-review-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { POST } = await import('@/app/api/agent/tasks/[id]/review/route');
const { reviewTask } = await import('@/lib/task-review');

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
  it('refuses to schedule an outbound reply (X only allows replies to mentions) and lets the operator mark it posted by hand', async () => {
    const id = task('reply');
    draft(id, 'Rural wires got paid back by the farms they reached.', '2095272264681844840');
    const refused = await call(id, 'approve');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/mention/);
    expect(status(id)).toBe('waiting_approval');
    expect(draftCount()).toBe(1);
    const manual = await call(id, 'manual');
    expect(manual.status).toBe(200);
    expect(status(id)).toBe('done');
    expect(draftCount()).toBe(0);
    const output = JSON.parse((sqlite.prepare('SELECT output FROM campaign_tasks WHERE id = ?').get(id) as { output: string }).output) as { review: { action: string; text: string } };
    expect(output.review).toMatchObject({ action: 'manual', text: 'Rural wires got paid back by the farms they reached.' });
  });

  it('approves a reply to a mention: schedules it with its target, deletes the draft, closes the task', async () => {
    const id = task('reply');
    sqlite
      .prepare(`INSERT INTO engagement_inbox (account_slot, source_type, source_id, text, raw_payload, received_at, status, assigned_to) VALUES (1, 'mention', '2095272264681844840', 'hey @LoopedHuman', '{}', unixepoch(), 'new', 'subscription-agent')`)
      .run();
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

  it('approves a thread draft as chained rows in one transaction', async () => {
    const id = task('post');
    draft(id, 'first tweet\n\n---\n\nsecond tweet', null, true);
    const response = await call(id, 'approve');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threadId: string | null };
    expect(body.threadId).not.toBeNull();
    const rows = sqlite.prepare('SELECT text, thread_index, dedupe_key, scheduled_time FROM scheduled_posts WHERE thread_id = ? ORDER BY thread_index').all(body.threadId) as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.text, r.thread_index, r.dedupe_key])).toEqual([
      ['first tweet', 0, `subscription-worker:review:task:${id}:0`],
      ['second tweet', 1, `subscription-worker:review:task:${id}:1`],
    ]);
    expect(rows[0].scheduled_time).toBe(rows[1].scheduled_time);
    expect(status(id)).toBe('done');
  });

  it('is atomic: a task decided concurrently leaves no scheduled rows behind', async () => {
    const before = (sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts').get() as { n: number }).n;
    const id = task('post');
    draft(id, 'a\n\n---\n\nb', null, true);
    await expect(
      reviewTask(id, 'approve', {
        beforeWrite: () => {
          sqlite.prepare("UPDATE campaign_tasks SET status = 'skipped' WHERE id = ?").run(id);
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts').get() as { n: number }).n).toBe(before);
    expect(draftCount()).toBe(1); // the draft survives the failed approval
    sqlite.prepare('DELETE FROM draft_posts').run();
  });

  it('never double-schedules a draft the Drafts page consumed meanwhile', async () => {
    const before = (sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts').get() as { n: number }).n;
    const id = task('reply');
    draft(id, 'answer', '4242');
    await expect(
      reviewTask(id, 'approve', {
        beforeWrite: () => {
          // The Drafts page scheduled and deleted it (or edited its text) during planning.
          sqlite.prepare('DELETE FROM draft_posts').run();
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts').get() as { n: number }).n).toBe(before);
    expect(status(id)).toBe('waiting_approval');
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
