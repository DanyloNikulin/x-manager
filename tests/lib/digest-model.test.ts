import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  followerDelta,
  groupDigestPosts,
  metricPoints,
  pickMetricsAtAge,
  previousAnalysisFrom,
  summarizeMetrics,
  summarizeTaskDetails,
  summarizeWorkerOutput,
  taskIdFromDedupeKey,
  toDigestTask,
  type DigestMetricPoint,
} from '@/lib/digest-model';

const published = new Date('2026-09-01T22:00:00Z');

function point(ageHours: number, impressions = 100): DigestMetricPoint {
  return { ageHours, fetchedAt: new Date(published.getTime() + ageHours * 3_600_000).toISOString(), impressions, likes: 1, retweets: 0, replies: 2, quotes: 0, bookmarks: 0 };
}

describe('metrics at an age', () => {
  it('picks the reading nearest the target only when one is close enough', () => {
    const points = [point(1), point(3), point(20), point(30), point(150)];
    expect(pickMetricsAtAge(points, 24)?.ageHours).toBe(20);
    expect(pickMetricsAtAge([point(1), point(3)], 24)).toBeNull();
    expect(pickMetricsAtAge([point(11)], 24)).toBeNull(); // 13 h off: outside ±12
    expect(pickMetricsAtAge(points, 168)?.ageHours).toBe(150);
    expect(pickMetricsAtAge([point(1), point(40)], 168)).toBeNull();
    expect(pickMetricsAtAge([point(85)], 168)).toBeNull(); // 3.5 days is not a week
    expect(pickMetricsAtAge([point(130)], 168)?.ageHours).toBe(130); // inside ±48
  });

  it('builds sorted points from raw rows with text or numeric timestamps', () => {
    const rows = [
      { scheduledPostId: 1, impressions: 50, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, fetchedAt: Math.floor(published.getTime() / 1000) + 2 * 3600 },
      { scheduledPostId: 1, impressions: 90, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, fetchedAt: '2026-09-02 23:00:00' },
      { scheduledPostId: 1, impressions: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, fetchedAt: null },
    ];
    const points = metricPoints(rows, published);
    expect(points.map((p) => p.ageHours)).toEqual([2, 25]);
    const summary = summarizeMetrics(points);
    expect(summary.latest?.impressions).toBe(90);
    expect(summary.at24h?.ageHours).toBe(25);
    expect(summary.at7d).toBeNull();
    expect(summary.measurements).toBe(2);
    expect(summarizeMetrics([])).toEqual({ latest: null, at24h: null, at7d: null, measurements: 0 });
  });
});

describe('task summaries', () => {
  it('reads the worker audit and the planner details', () => {
    const output = JSON.stringify({
      validation: { verdict: 'pass', score: 92, issues: [] },
      length: { band: 'post: 200 to 280', measurements: [{ label: 'post', weighted: 271, over_limit: false }] },
      decision: 'answer',
      publication: { requested: 'auto', effective: 'auto' },
    });
    const details = JSON.stringify({ topic: 'T', angle: 'A', pillar: 'P', format: 'post', source_notes: [{ url: 'https://s' }] });
    const task = toDigestTask({ id: 9, title: 't', status: 'done', taskType: 'post', assignedAgent: 'subscription-agent', details, output, createdAt: '2026-09-02 14:21:41', updatedAt: null });
    expect(task.validator).toEqual({ verdict: 'pass', score: 92, issues: [] });
    expect(task.length).toEqual({ band: 'post: 200 to 280', measurements: [{ label: 'post', weighted: 271 }] });
    expect(task.decision).toBe('answer');
    expect(task.publication).toEqual({ requested: 'auto', effective: 'auto', blockedReason: null });
    expect(task.topic).toBe('T');
    expect(task.format).toBe('post');
    expect(task.createdAt).toBe('2026-09-02T14:21:41.000Z');
  });

  it('is empty for missing or broken payloads and reads reply details', () => {
    expect(summarizeWorkerOutput(null).validator).toBeNull();
    expect(summarizeWorkerOutput('nope').validator).toBeNull();
    expect(summarizeWorkerOutput(JSON.stringify({ error: 'writer failed' })).error).toBe('writer failed');
    const reply = summarizeTaskDetails(JSON.stringify({ reply_kind: 'inbound', exchange_depth: 1, parent_text: 'hi', parent_author: 'x' }));
    expect(reply).toMatchObject({ replyKind: 'inbound', exchangeDepth: 1, parentText: 'hi', parentAuthor: 'x', topic: null });
    expect(countByStatus([{ status: 'done' }, { status: 'done' }, { status: 'skipped' }])).toEqual({ done: 2, skipped: 1 });
  });
});

describe('posts and their tasks', () => {
  const tasks = [
    { id: 9, taskType: 'post', details: JSON.stringify({ format: 'post' }) },
    { id: 12, taskType: 'reply', details: JSON.stringify({ reply_to_tweet_id: '555' }) },
    { id: 14, taskType: 'post', details: JSON.stringify({ format: 'thread', source_notes: [{ url: 'https://src/a ' }] }) },
    { id: 15, taskType: 'post', details: 'broken' },
  ];

  it('links single posts by dedupe key, replies by target, threads by source', () => {
    const rows = [
      { id: 1, text: 'post', scheduledTime: 1788386400, twitterPostId: '111', threadId: null, threadIndex: null, dedupeKey: 'subscription-worker:task:9', sourceUrl: null, replyToTweetId: null },
      { id: 2, text: 'reply', scheduledTime: 1788386500, twitterPostId: '112', threadId: null, threadIndex: null, dedupeKey: 'subscription-worker:reply:555', sourceUrl: null, replyToTweetId: '555' },
      { id: 4, text: 'second tweet', scheduledTime: 1788386600, twitterPostId: '114', threadId: 'th', threadIndex: 1, dedupeKey: null, sourceUrl: 'https://src/a', replyToTweetId: null },
      { id: 3, text: 'first tweet', scheduledTime: 1788386600, twitterPostId: '113', threadId: 'th', threadIndex: 0, dedupeKey: null, sourceUrl: 'https://src/a', replyToTweetId: null },
    ];
    const posts = groupDigestPosts(rows, 'LoopedHuman', tasks);
    expect(posts.map((p) => [p.id, p.taskId, p.tweets])).toEqual([[1, 9, 1], [2, 12, 1], [3, 14, 2]]);
    expect(posts[2].text).toBe('first tweet');
    expect(posts[0].url).toBe('https://x.com/LoopedHuman/status/111');
    expect(posts[0].publishedAt).toBe('2026-09-02T22:00:00.000Z');
    expect(posts[2].rowIds).toEqual([4, 3]);
  });

  it('parses dedupe keys strictly', () => {
    expect(taskIdFromDedupeKey('subscription-worker:task:42')).toBe(42);
    expect(taskIdFromDedupeKey('subscription-worker:reply:42')).toBeNull();
    expect(taskIdFromDedupeKey(null)).toBeNull();
  });
});

describe('followers and the previous analysis', () => {
  it('reports the delta over the window', () => {
    expect(followerDelta([])).toEqual({ start: null, end: null, delta: null });
    const result = followerDelta([
      { followersCount: 120, snapshotAt: '2026-09-02 10:00:00' },
      { followersCount: 100, snapshotAt: '2026-08-27 10:00:00' },
      { followersCount: 110, snapshotAt: null },
    ]);
    expect(result.start?.count).toBe(100);
    expect(result.end?.count).toBe(120);
    expect(result.delta).toBe(20);
  });

  it('finds the latest analyst task', () => {
    const rows = [
      { id: 20, title: 'a', status: 'done', taskType: 'research', assignedAgent: 'analyst', details: JSON.stringify({ report: 'older', proposals: [] }), output: null, createdAt: null, updatedAt: null },
      { id: 21, title: 'b', status: 'waiting_approval', taskType: 'research', assignedAgent: 'analyst', details: JSON.stringify({ report: 'newer', proposals: [{ target: 'voice' }] }), output: null, createdAt: '2026-09-08 10:00:00', updatedAt: null },
      { id: 22, title: 'c', status: 'done', taskType: 'research', assignedAgent: 'planner', details: '{}', output: null, createdAt: null, updatedAt: null },
    ];
    expect(previousAnalysisFrom(rows)).toEqual({ taskId: 21, at: '2026-09-08T10:00:00.000Z', report: 'newer', proposals: [{ target: 'voice' }] });
    expect(previousAnalysisFrom([rows[2]])).toBeNull();
  });
});
