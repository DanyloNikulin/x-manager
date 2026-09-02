import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Integration test for the digest builder against a real SQLite file: rows written with
 * epoch timestamps (the app) and with `YYYY-MM-DD HH:MM:SS` text (SQL defaults) must both
 * be windowed correctly, tasks behind the window's posts must be linked even when older
 * than the window, and the previous analysis must be found regardless of scan caps.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-digest-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { buildDigest } = await import('@/lib/digest');
const { saveAccountProfile } = await import('@/lib/account-profiles');

const now = new Date('2026-09-09T12:00:00Z');
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const text = (iso: string) => iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');

let campaignId = 0;
let oldTaskId = 0;
let openOldTaskId = 0;
let windowTaskId = 0;
let oldReplyTaskId = 0;
let oldThreadTaskId = 0;

beforeAll(async () => {
  await saveAccountProfile(1, { status: 'ready', voice: 'v', strategy: 's', memory: 'm', playbook: 'p', postsPerDay: 1 });
  campaignId = Number(
    sqlite.prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'objective', 1, 'active')").run().lastInsertRowid,
  );
  const insertTask = sqlite.prepare(
    `INSERT INTO campaign_tasks (campaign_id, task_type, title, details, output, priority, assigned_agent, status, created_at) VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?)`,
  );
  // An old task (outside the window, 20 days ago) that produced a post published inside the window.
  oldTaskId = Number(insertTask.run(campaignId, 'post', 'old task', JSON.stringify({ topic: 'old', format: 'post' }), JSON.stringify({ validation: { verdict: 'pass', score: 90 } }), 'subscription-agent', 'done', epoch('2026-08-20T09:00:00Z')).lastInsertRowid);
  // An old but still open task: must appear in the window's task list.
  openOldTaskId = Number(insertTask.run(campaignId, 'reply', 'old open', JSON.stringify({ reply_kind: 'inbound' }), null, 'subscription-agent', 'waiting_approval', text('2026-08-01T09:00:00Z')).lastInsertRowid);
  // A task inside the window, with a SQL-text created_at.
  windowTaskId = Number(insertTask.run(campaignId, 'post', 'window task', JSON.stringify({ topic: 'new', format: 'post' }), null, 'subscription-agent', 'done', text('2026-09-08T09:00:00Z')).lastInsertRowid);
  // An old analysis, outside the window: still the "previous analysis".
  insertTask.run(campaignId, 'research', 'Autopilot 2026-W34: analysis', JSON.stringify({ report: 'older report', proposals: [] }), null, 'analyst', 'done', epoch('2026-08-24T10:00:00Z'));
  // A failed week and the marker reserved for the current run: neither is a previous analysis.
  insertTask.run(campaignId, 'research', 'Autopilot 2026-W35: analysis', JSON.stringify({ week: '2026-W35', error: 'boom' }), null, 'analyst', 'failed', epoch('2026-08-31T10:00:00Z'));
  insertTask.run(campaignId, 'research', 'Autopilot 2026-W37: analysis', JSON.stringify({ week: '2026-W37', started_at: 'now' }), null, 'analyst', 'in_progress', epoch('2026-09-09T11:59:00Z'));
  // Malformed details on a reply and on a post task: must be skipped, never crash the query.
  insertTask.run(campaignId, 'reply', 'broken reply', 'not json {', null, 'subscription-agent', 'done', epoch('2026-08-26T09:00:00Z'));
  insertTask.run(campaignId, 'post', 'broken post', '{"format": "thread", "source_notes": [', null, 'subscription-agent', 'done', epoch('2026-08-26T09:00:00Z'));
  // Old reply and thread tasks whose posts published late, inside the window.
  oldReplyTaskId = Number(insertTask.run(campaignId, 'reply', 'old reply', JSON.stringify({ reply_to_tweet_id: '8888', reply_kind: 'inbound', parent_text: 'hey' }), JSON.stringify({ decision: 'answer' }), 'subscription-agent', 'done', epoch('2026-08-25T09:00:00Z')).lastInsertRowid);
  oldThreadTaskId = Number(insertTask.run(campaignId, 'post', 'old thread', JSON.stringify({ format: 'thread', source_notes: [{ url: 'https://src/long-read ' }] }), null, 'subscription-agent', 'done', epoch('2026-08-26T09:00:00Z')).lastInsertRowid);
  // Noise: many recent planner markers so a capped scan would push old rows out.
  for (let i = 0; i < 30; i += 1) {
    insertTask.run(campaignId, 'research', `Autopilot 2026-09-0${(i % 9) + 1}: plan`, '{}', null, 'planner', 'done', epoch('2026-09-08T10:00:00Z'));
  }

  const insertPost = sqlite.prepare(
    `INSERT INTO scheduled_posts (account_slot, text, dedupe_key, scheduled_time, status, twitter_post_id, created_at, updated_at) VALUES (1, ?, ?, ?, 'posted', ?, unixepoch(), unixepoch())`,
  );
  insertPost.run('inside, epoch', `subscription-worker:task:${oldTaskId}`, epoch('2026-09-05T22:00:00Z'), '5001');
  insertPost.run('inside, text', `subscription-worker:task:${windowTaskId}`, text('2026-09-08T22:00:00Z'), '5002');
  insertPost.run('outside, epoch', 'subscription-worker:task:1', epoch('2026-08-15T22:00:00Z'), '5003');
  insertPost.run('outside, text', 'subscription-worker:task:2', text('2026-07-01T22:00:00Z'), '5004');
  sqlite
    .prepare(`INSERT INTO scheduled_posts (account_slot, text, dedupe_key, reply_to_tweet_id, scheduled_time, status, twitter_post_id, created_at, updated_at) VALUES (1, 'late reply', 'subscription-worker:reply:8888', '8888', ?, 'posted', '5005', unixepoch(), unixepoch())`)
    .run(epoch('2026-09-07T22:00:00Z'));
  const insertThreadRow = sqlite.prepare(
    `INSERT INTO scheduled_posts (account_slot, text, source_url, thread_id, thread_index, scheduled_time, status, twitter_post_id, created_at, updated_at) VALUES (1, ?, 'https://src/long-read', 'th-1', ?, ?, 'posted', ?, unixepoch(), unixepoch())`,
  );
  insertThreadRow.run('late thread, second', 1, epoch('2026-09-08T20:00:00Z'), '5007');
  insertThreadRow.run('late thread, first', 0, epoch('2026-09-08T20:00:00Z'), '5006');

  const post = sqlite.prepare("SELECT id FROM scheduled_posts WHERE twitter_post_id = '5001'").get() as { id: number };
  const insertMetric = sqlite.prepare(
    `INSERT INTO post_metrics (scheduled_post_id, twitter_post_id, account_slot, impressions, likes, retweets, replies, quotes, bookmarks, fetched_at) VALUES (?, '5001', 1, ?, 0, 0, ?, 0, 0, ?)`,
  );
  insertMetric.run(post.id, 40, 1, text('2026-09-06T00:00:00Z')); // 2 h
  insertMetric.run(post.id, 300, 4, text('2026-09-06T21:00:00Z')); // 23 h
  insertMetric.run(post.id, 420, 5, epoch('2026-09-09T11:00:00Z')); // ~85 h, latest
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('buildDigest', () => {
  it('windows posts on both timestamp storages and links them to their tasks', async () => {
    const digest = await buildDigest(1, 7, now);
    expect(digest.window.days).toBe(7);
    expect(digest.posts.map((post) => post.text).sort()).toEqual(['inside, epoch', 'inside, text', 'late reply', 'late thread, first']);
    const oldPost = digest.posts.find((post) => post.text === 'inside, epoch')!;
    expect(oldPost.taskId).toBe(oldTaskId);
    expect(oldPost.publishedAt).toBe('2026-09-05T22:00:00.000Z');
    expect(oldPost.metrics.at24h?.impressions).toBe(300);
    expect(oldPost.metrics.latest?.impressions).toBe(420);
    expect(oldPost.metrics.at7d).toBeNull();
    expect(oldPost.metrics.measurements).toBe(3);
    expect(digest.posts.find((post) => post.text === 'inside, text')!.taskId).toBe(windowTaskId);
  });

  it('brings the old tasks behind late-published posts, replies and threads included', async () => {
    const digest = await buildDigest(1, 7, now);
    const byId = new Map(digest.tasks.items.map((task) => [task.id, task]));
    expect(byId.get(oldTaskId)?.topic).toBe('old');
    expect(byId.get(oldTaskId)?.validator?.score).toBe(90);
    expect(digest.posts.find((post) => post.text === 'late reply')?.taskId).toBe(oldReplyTaskId);
    expect(byId.get(oldReplyTaskId)?.replyKind).toBe('inbound');
    expect(byId.get(oldReplyTaskId)?.decision).toBe('answer');
    const thread = digest.posts.find((post) => post.text === 'late thread, first')!;
    expect(thread.tweets).toBe(2);
    expect(thread.taskId).toBe(oldThreadTaskId);
    expect(byId.get(oldThreadTaskId)?.format).toBe('thread');
  });

  it('lists window tasks plus still-open old ones, and finds the previous analysis behind the noise', async () => {
    const digest = await buildDigest(1, 7, now);
    const ids = digest.tasks.items.map((task) => task.id);
    expect(ids).toContain(windowTaskId);
    expect(ids).toContain(openOldTaskId);
    expect(digest.tasks.counts.waiting_approval).toBe(1);
    // Neither the failed week nor the marker reserved for the running analysis counts.
    expect(digest.previousAnalysis?.report).toBe('older report');
    expect(digest.brief.playbook).toBe('p');
    expect(digest.account.postsPerDay).toBe(1);
  });

  it('bounds the window', async () => {
    const digest = await buildDigest(1, 999, now);
    expect(digest.window.days).toBe(30);
    expect(digest.posts.map((post) => post.text).sort()).toEqual(['inside, epoch', 'inside, text', 'late reply', 'late thread, first', 'outside, epoch']);
  });
});
