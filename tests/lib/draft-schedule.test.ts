import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-draft-schedule-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { POST } = await import('@/app/api/drafts/[id]/schedule/route');
const { taskIdFromDraftSource } = await import('@/lib/draft-schedule');

let campaignId = 0;
const when = '2026-09-10T22:00:00.000Z';

function draft(text: string, source: string | null, replyTo: string | null = null): number {
  return Number(
    sqlite
      .prepare(`INSERT INTO draft_posts (account_slot, text, reply_to_tweet_id, source, created_at, updated_at) VALUES (1, ?, ?, ?, unixepoch(), unixepoch())`)
      .run(text, replyTo, source).lastInsertRowid,
  );
}

function call(id: number | string, body: unknown) {
  return POST(new Request(`http://127.0.0.1/api/drafts/${id}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

const posts = () => (sqlite.prepare('SELECT count(*) AS n FROM scheduled_posts').get() as { n: number }).n;

beforeAll(() => {
  campaignId = Number(sqlite.prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'o', 1, 'active')").run().lastInsertRowid);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('POST /api/drafts/:id/schedule', () => {
  it('schedules a reply draft with its target, removes the draft, closes the worker task, in one go', async () => {
    const taskId = Number(
      sqlite
        .prepare(`INSERT INTO campaign_tasks (campaign_id, task_type, title, details, output, priority, assigned_agent, status) VALUES (?, 'reply', 'r', '{}', '{"validation":{"score":91}}', 1, 'subscription-agent', 'waiting_approval')`)
        .run(campaignId).lastInsertRowid,
    );
    const id = draft('the reply', `subscription-worker:needs_review:task:${taskId}`, '555');
    const response = await call(id, { scheduled_time: when });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { scheduledPostId: number; taskId: number | null; scheduledFor: string };
    expect(body.taskId).toBe(taskId);
    expect(body.scheduledFor).toBe(when);
    const row = sqlite.prepare('SELECT reply_to_tweet_id, status, scheduled_time, dedupe_key FROM scheduled_posts WHERE id = ?').get(body.scheduledPostId) as Record<string, unknown>;
    expect(row).toMatchObject({ reply_to_tweet_id: '555', status: 'scheduled', scheduled_time: Math.floor(new Date(when).getTime() / 1000) });
    expect(String(row.dedupe_key)).toMatch(/^drafts:[0-9a-f-]{36}$/);
    expect((sqlite.prepare('SELECT count(*) AS n FROM draft_posts WHERE id = ?').get(id) as { n: number }).n).toBe(0);
    const task = sqlite.prepare('SELECT status, output FROM campaign_tasks WHERE id = ?').get(taskId) as { status: string; output: string };
    expect(task.status).toBe('done');
    expect(JSON.parse(task.output)).toMatchObject({ validation: { score: 91 }, review: { action: 'approve', via: 'drafts' } });
  });

  it('rebuilds a worker thread draft as chained rows', async () => {
    const id = draft('one\n\n---\n\ntwo\n\n---\n\nthree', 'subscription-worker:needs_review:thread:task:999');
    const response = await call(id, { scheduled_time: when });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threadId: string | null; tweets: number };
    expect(body.tweets).toBe(3);
    const rows = sqlite.prepare('SELECT text, thread_index FROM scheduled_posts WHERE thread_id = ? ORDER BY thread_index').all(body.threadId) as Array<{ text: string; thread_index: number }>;
    expect(rows.map((r) => r.text)).toEqual(['one', 'two', 'three']);
  });

  it('cannot schedule the same draft twice, and validates input', async () => {
    const id = draft('plain post', null);
    const before = posts();
    expect((await call(id, { scheduled_time: when })).status).toBe(200);
    expect((await call(id, { scheduled_time: when })).status).toBe(409);
    expect(posts()).toBe(before + 1);
    expect((await call(id, { scheduled_time: 'soon' })).status).toBe(400);
    expect((await call('x', { scheduled_time: when })).status).toBe(400);
  });

  it('reads the task id out of worker draft sources', () => {
    expect(taskIdFromDraftSource('subscription-worker:needs_review:task:13')).toBe(13);
    expect(taskIdFromDraftSource('subscription-worker:auto-blocked:thread:task:7')).toBe(7);
    expect(taskIdFromDraftSource('manual')).toBeNull();
    expect(taskIdFromDraftSource(null)).toBeNull();
  });
});
