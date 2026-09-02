import { tweetUrl } from '@/lib/overview-model';
import { toIso } from '@/lib/time-zone';

/**
 * Shapes and pure helpers behind the account digest the analyst reads once a week.
 * Database access lives in `digest.ts`; everything here is testable without a database.
 */

export const ANALYST_AGENT = 'analyst';

export type DigestMetricPoint = {
  /** Hours between publication and this measurement. */
  ageHours: number;
  fetchedAt: string;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
};

export type DigestPostMetrics = {
  latest: DigestMetricPoint | null;
  /** The measurement closest to 24 hours after publication, when one exists near it. */
  at24h: DigestMetricPoint | null;
  /** The measurement closest to 7 days after publication, when one exists near it. */
  at7d: DigestMetricPoint | null;
  measurements: number;
};

export type DigestValidator = { verdict: string | null; score: number | null; issues: string[] };

export type DigestLength = { band: string | null; measurements: Array<{ label: string; weighted: number }> };

export type DigestTask = {
  id: number;
  taskType: string;
  status: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  topic: string | null;
  angle: string | null;
  pillar: string | null;
  format: string | null;
  replyKind: string | null;
  exchangeDepth: number | null;
  /** Untrusted: the text of the mention a reply task answers. */
  parentText: string | null;
  parentAuthor: string | null;
  validator: DigestValidator | null;
  length: DigestLength | null;
  /** Reply decision recorded by the worker (answer / ignore / escalate), when any. */
  decision: string | null;
  publication: { requested: string | null; effective: string | null; blockedReason: string | null } | null;
  /** Error text of a failed task. */
  error: string | null;
};

export type DigestPost = {
  id: number;
  threadId: string | null;
  tweets: number;
  /** First tweet for a thread. */
  text: string;
  publishedAt: string | null;
  twitterPostId: string | null;
  url: string | null;
  replyToTweetId: string | null;
  sourceUrl: string | null;
  taskId: number | null;
  metrics: DigestPostMetrics;
};

export type DigestDraft = {
  id: number;
  text: string;
  isThread: boolean;
  tweets: number;
  source: string | null;
  createdAt: string | null;
};

export type DigestMention = {
  id: number;
  sourceId: string;
  author: string | null;
  /** Untrusted: what the other person wrote. */
  text: string;
  receivedAt: string | null;
  status: string;
  assignedTo: string | null;
};

export type DigestFollowers = {
  start: { count: number; at: string } | null;
  end: { count: number; at: string } | null;
  delta: number | null;
};

export type PreviousAnalysis = {
  taskId: number;
  at: string | null;
  report: string | null;
  proposals: unknown[];
};

export type Digest = {
  generatedAt: string;
  slot: number;
  window: { days: number; since: string; until: string };
  account: {
    username: string | null;
    status: string;
    postMode: string;
    inboundReplyMode: string;
    outboundReplyMode: string;
    postsPerDay: number;
    maxRepliesPerConversation: number;
    planHour: number;
    planTimezone: string;
    policyWindow: { start: number; end: number; timezone: string } | null;
  };
  brief: { profile: string; voice: string; strategy: string; memory: string; playbook: string };
  posts: DigestPost[];
  tasks: { counts: Record<string, number>; items: DigestTask[] };
  drafts: DigestDraft[];
  mentions: DigestMention[];
  followers: DigestFollowers;
  previousAnalysis: PreviousAnalysis | null;
};

// ---------------------------------------------------------------------------
// Metrics at an age
// ---------------------------------------------------------------------------

export type RawMetricRow = {
  scheduledPostId: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  fetchedAt: unknown;
};

export function metricPoints(rows: RawMetricRow[], publishedAt: Date | null): DigestMetricPoint[] {
  const points: DigestMetricPoint[] = [];
  for (const row of rows) {
    const fetchedAt = toIso(row.fetchedAt);
    if (!fetchedAt) continue;
    const fetched = new Date(fetchedAt);
    if (Number.isNaN(fetched.getTime())) continue;
    const ageHours = publishedAt ? Math.max(0, (fetched.getTime() - publishedAt.getTime()) / 3_600_000) : 0;
    points.push({
      ageHours: Math.round(ageHours * 10) / 10,
      fetchedAt,
      impressions: row.impressions,
      likes: row.likes,
      retweets: row.retweets,
      replies: row.replies,
      quotes: row.quotes,
      bookmarks: row.bookmarks,
    });
  }
  return points.sort((a, b) => a.ageHours - b.ageHours);
}

/** How far a reading may sit from the age it stands for. */
export const AGE_TOLERANCE_HOURS: Record<number, number> = { 24: 12, 168: 48 };

/**
 * The measurement closest to `targetHours` after publication, provided it falls within
 * `toleranceHours` of the target; otherwise null, so a 3-hour reading never poses as the
 * 24-hour one and an 85-hour reading never poses as the 7-day one.
 */
export function pickMetricsAtAge(points: DigestMetricPoint[], targetHours: number, toleranceHours = AGE_TOLERANCE_HOURS[targetHours] ?? targetHours / 2): DigestMetricPoint | null {
  let best: DigestMetricPoint | null = null;
  for (const point of points) {
    if (Math.abs(point.ageHours - targetHours) > toleranceHours) continue;
    if (!best || Math.abs(point.ageHours - targetHours) < Math.abs(best.ageHours - targetHours)) best = point;
  }
  return best;
}

export function summarizeMetrics(points: DigestMetricPoint[]): DigestPostMetrics {
  const latest = points.length > 0 ? points[points.length - 1] : null;
  return {
    latest,
    at24h: pickMetricsAtAge(points, 24),
    at7d: pickMetricsAtAge(points, 168),
    measurements: points.length,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type RawTaskRow = {
  id: number;
  title: string;
  status: string;
  taskType: string;
  assignedAgent: string | null;
  details: string | null;
  output: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads the worker's audit payload stored in `campaign_tasks.output`. */
export function summarizeWorkerOutput(output: string | null): Pick<DigestTask, 'validator' | 'length' | 'decision' | 'publication' | 'error'> {
  const empty = { validator: null, length: null, decision: null, publication: null, error: null };
  if (!output) return empty;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const validation = parsed.validation as { verdict?: unknown; score?: unknown; issues?: unknown } | undefined;
    const length = parsed.length as { band?: unknown; measurements?: unknown } | undefined;
    const publication = parsed.publication as { requested?: unknown; effective?: unknown; blocked_reason?: unknown } | undefined;
    return {
      validator: validation
        ? {
            verdict: asString(validation.verdict),
            score: asNumber(validation.score),
            issues: Array.isArray(validation.issues) ? validation.issues.filter((item): item is string => typeof item === 'string') : [],
          }
        : null,
      length: length
        ? {
            band: asString(length.band),
            measurements: Array.isArray(length.measurements)
              ? length.measurements
                  .map((item) => item as { label?: unknown; weighted?: unknown })
                  .filter((item) => typeof item.label === 'string' && typeof item.weighted === 'number')
                  .map((item) => ({ label: item.label as string, weighted: item.weighted as number }))
              : [],
          }
        : null,
      decision: asString(parsed.decision),
      publication: publication
        ? {
            requested: asString(publication.requested),
            effective: asString(publication.effective),
            blockedReason: asString(publication.blocked_reason),
          }
        : null,
      error: asString(parsed.error),
    };
  } catch {
    return empty;
  }
}

/** Reads what the planner or the intake put into `campaign_tasks.details`. */
export function summarizeTaskDetails(details: string | null): Pick<DigestTask, 'topic' | 'angle' | 'pillar' | 'format' | 'replyKind' | 'exchangeDepth' | 'parentText' | 'parentAuthor'> {
  const empty = { topic: null, angle: null, pillar: null, format: null, replyKind: null, exchangeDepth: null, parentText: null, parentAuthor: null };
  if (!details) return empty;
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return {
      topic: asString(parsed.topic),
      angle: asString(parsed.angle),
      pillar: asString(parsed.pillar),
      format: asString(parsed.format),
      replyKind: asString(parsed.reply_kind),
      exchangeDepth: asNumber(parsed.exchange_depth),
      parentText: asString(parsed.parent_text),
      parentAuthor: asString(parsed.parent_author),
    };
  } catch {
    return empty;
  }
}

export function toDigestTask(row: RawTaskRow): DigestTask {
  return {
    id: row.id,
    taskType: row.taskType,
    status: row.status,
    title: row.title,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...summarizeTaskDetails(row.details),
    ...summarizeWorkerOutput(row.output),
  };
}

export function countByStatus(tasks: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

/** `subscription-worker:task:<id>` → id; anything else → null. */
export function taskIdFromDedupeKey(dedupeKey: string | null): number | null {
  const match = dedupeKey?.match(/^subscription-worker:task:(\d+)$/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export type RawDigestPostRow = {
  id: number;
  text: string;
  scheduledTime: unknown;
  twitterPostId: string | null;
  threadId: string | null;
  threadIndex: number | null;
  dedupeKey: string | null;
  sourceUrl: string | null;
  replyToTweetId: string | null;
};

/**
 * Collapses thread rows into one post represented by the first tweet, and links each post
 * to the task that produced it: single posts through the dedupe key, replies through the
 * tweet they answer, threads through the source URL of the task's first source note.
 */
export function groupDigestPosts(
  rows: RawDigestPostRow[],
  username: string | null,
  tasks: Array<{ id: number; taskType: string; details: string | null }>,
): Array<Omit<DigestPost, 'metrics'> & { rowIds: number[] }> {
  const replyTaskByTarget = new Map<string, number>();
  const threadTaskBySource = new Map<string, number>();
  for (const task of tasks) {
    if (!task.details) continue;
    try {
      const parsed = JSON.parse(task.details) as { reply_to_tweet_id?: unknown; source_notes?: Array<{ url?: unknown }>; format?: unknown };
      if (task.taskType === 'reply' && typeof parsed.reply_to_tweet_id === 'string') {
        replyTaskByTarget.set(parsed.reply_to_tweet_id, task.id);
      }
      const first = parsed.source_notes?.[0]?.url;
      if (task.taskType === 'post' && parsed.format === 'thread' && typeof first === 'string') {
        threadTaskBySource.set(first.trim(), task.id);
      }
    } catch {
      // A task with unreadable details simply cannot be linked.
    }
  }

  const groups = new Map<string, { head: RawDigestPostRow; rowIds: number[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.threadId ? `thread:${row.threadId}` : `post:${row.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { head: row, rowIds: [row.id] });
      order.push(key);
      continue;
    }
    existing.rowIds.push(row.id);
    if ((row.threadIndex ?? 0) < (existing.head.threadIndex ?? 0)) existing.head = row;
  }

  return order.map((key) => {
    const { head, rowIds } = groups.get(key)!;
    const taskId =
      taskIdFromDedupeKey(head.dedupeKey) ??
      (head.replyToTweetId ? replyTaskByTarget.get(head.replyToTweetId) ?? null : null) ??
      (head.threadId && head.sourceUrl ? threadTaskBySource.get(head.sourceUrl.trim()) ?? null : null);
    return {
      id: head.id,
      threadId: head.threadId,
      tweets: rowIds.length,
      text: head.text,
      publishedAt: toIso(head.scheduledTime),
      twitterPostId: head.twitterPostId,
      url: tweetUrl(username, head.twitterPostId),
      replyToTweetId: head.replyToTweetId,
      sourceUrl: head.sourceUrl,
      taskId,
      rowIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Followers and the previous analysis
// ---------------------------------------------------------------------------

export function followerDelta(snapshots: Array<{ followersCount: number; snapshotAt: unknown }>): DigestFollowers {
  const points = snapshots
    .map((row) => ({ count: row.followersCount, at: toIso(row.snapshotAt) }))
    .filter((row): row is { count: number; at: string } => Boolean(row.at))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (points.length === 0) return { start: null, end: null, delta: null };
  const start = points[0];
  const end = points[points.length - 1];
  return { start, end, delta: end.count - start.count };
}

/**
 * The newest finished analysis: an analyst task that carries a report. A marker that was
 * only reserved (`in_progress`, no report yet) or a failed run never counts, so the analysis
 * being produced right now cannot see itself as "the previous one".
 */
export function previousAnalysisFrom(tasks: RawTaskRow[]): PreviousAnalysis | null {
  const rows = tasks
    .filter((task) => task.assignedAgent === ANALYST_AGENT && (task.status === 'done' || task.status === 'waiting_approval'))
    .sort((a, b) => b.id - a.id);
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.details ?? '{}') as { report?: unknown; proposals?: unknown };
      const report = asString(parsed.report);
      if (!report) continue;
      return {
        taskId: row.id,
        at: toIso(row.createdAt),
        report,
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      };
    } catch {
      continue;
    }
  }
  return null;
}
