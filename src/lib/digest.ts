import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { db } from '@/lib/db';
import { campaignTasks, campaigns, draftPosts, engagementInbox, followerSnapshots, postMetrics, scheduledPosts } from '@/lib/db/schema';
import type { AccountSlot } from '@/lib/account-slots';
import { listAccountProfiles } from '@/lib/account-profiles';
import { getSlotPolicy } from '@/lib/policy';
import { autopilotCampaignName } from '@/lib/overview-model';
import { isThreadDraftSource, splitThreadDraft } from '@/lib/thread-draft';
import { toIso } from '@/lib/time-zone';
import {
  ANALYST_AGENT,
  countByStatus,
  followerDelta,
  groupDigestPosts,
  metricPoints,
  previousAnalysisFrom,
  summarizeMetrics,
  taskIdFromDedupeKey,
  toDigestTask,
  type Digest,
  type DigestPost,
  type RawDigestPostRow,
  type RawMetricRow,
  type RawTaskRow,
} from '@/lib/digest-model';

/**
 * The account digest: everything the analyst needs about one slot's last `days` days in one
 * JSON payload. Read-only; served by GET /api/agent/accounts/:slot/digest.
 */

export const MAX_DIGEST_DAYS = 30;
const POST_ROWS = 400;
const TASK_ROWS = 1000;
const DRAFT_SCAN = 60;
const MENTION_SCAN = 150;
const OPEN_TASK_STATUSES = ['pending', 'in_progress', 'waiting_approval'] as const;

/**
 * Timestamps in this database are stored as epoch seconds by the app and as
 * `YYYY-MM-DD HH:MM:SS` text by SQL defaults; comparing either with an epoch bound needs
 * the text form converted first, otherwise SQLite's type ordering (text above integers)
 * would let old text rows through.
 */
function epochOf(column: SQLiteColumn): SQL<number> {
  return sql<number>`(CASE WHEN typeof(${column}) = 'integer' THEN ${column} WHEN typeof(${column}) = 'real' THEN CAST(${column} AS INTEGER) ELSE CAST(strftime('%s', ${column}) AS INTEGER) END)`;
}

function inWindow(iso: string | null, since: Date): boolean {
  return Boolean(iso) && new Date(iso as string).getTime() >= since.getTime();
}

async function loadCampaignId(slot: AccountSlot): Promise<number | null> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.accountSlot, slot), eq(campaigns.name, autopilotCampaignName(slot))))
    .orderBy(desc(campaigns.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

const taskColumns = {
  id: campaignTasks.id,
  title: campaignTasks.title,
  status: campaignTasks.status,
  taskType: campaignTasks.taskType,
  assignedAgent: campaignTasks.assignedAgent,
  details: campaignTasks.details,
  output: campaignTasks.output,
  createdAt: sql<string | number | null>`${campaignTasks.createdAt}`,
  updatedAt: sql<string | number | null>`${campaignTasks.updatedAt}`,
};

/** Tasks created inside the window plus every task that is still open, whatever its age. */
async function loadWindowTasks(campaignId: number, sinceEpoch: number): Promise<RawTaskRow[]> {
  return db
    .select(taskColumns)
    .from(campaignTasks)
    .where(
      and(
        eq(campaignTasks.campaignId, campaignId),
        or(sql`${epochOf(campaignTasks.createdAt)} >= ${sinceEpoch}`, inArray(campaignTasks.status, [...OPEN_TASK_STATUSES])),
      ),
    )
    .orderBy(desc(campaignTasks.id))
    .limit(TASK_ROWS);
}

/**
 * The latest finished analyses, queried on their own so no scan cap can hide them. A
 * reserved (`in_progress`) or failed marker is not an analysis; `previousAnalysisFrom`
 * also insists on a report.
 */
async function loadPreviousAnalysis(campaignId: number): Promise<RawTaskRow[]> {
  return db
    .select(taskColumns)
    .from(campaignTasks)
    .where(
      and(
        eq(campaignTasks.campaignId, campaignId),
        eq(campaignTasks.assignedAgent, ANALYST_AGENT),
        inArray(campaignTasks.status, ['done', 'waiting_approval']),
      ),
    )
    .orderBy(desc(campaignTasks.id))
    .limit(5);
}

/**
 * Tasks behind the window's posts that were created before the window: single posts and
 * their tasks share a dedupe key; replies point at the tweet they answer; threads share
 * the source URL of the task's first source note.
 */
async function loadTasksBehindPosts(campaignId: number, posts: RawDigestPostRow[], known: Set<number>): Promise<RawTaskRow[]> {
  const byId = Array.from(new Set(posts.map((row) => taskIdFromDedupeKey(row.dedupeKey)).filter((id): id is number => id !== null && !known.has(id))));
  const replyTargets = Array.from(new Set(posts.filter((row) => row.replyToTweetId && taskIdFromDedupeKey(row.dedupeKey) === null).map((row) => row.replyToTweetId as string)));
  const threadSources = Array.from(new Set(posts.filter((row) => row.threadId && row.sourceUrl).map((row) => (row.sourceUrl as string).trim())));
  const queries: Array<Promise<RawTaskRow[]>> = [];
  if (byId.length > 0) {
    queries.push(db.select(taskColumns).from(campaignTasks).where(and(eq(campaignTasks.campaignId, campaignId), inArray(campaignTasks.id, byId))));
  }
  // Task details are free text: a row that is not valid JSON must be skipped, not crash
  // the query (json_extract raises on malformed input), hence the json_valid guard.
  if (replyTargets.length > 0) {
    queries.push(
      db
        .select(taskColumns)
        .from(campaignTasks)
        .where(
          and(
            eq(campaignTasks.campaignId, campaignId),
            eq(campaignTasks.taskType, 'reply'),
            sql`(CASE WHEN json_valid(${campaignTasks.details}) THEN json_extract(${campaignTasks.details}, '$.reply_to_tweet_id') ELSE NULL END) IN ${replyTargets}`,
          ),
        ),
    );
  }
  if (threadSources.length > 0) {
    queries.push(
      db
        .select(taskColumns)
        .from(campaignTasks)
        .where(
          and(
            eq(campaignTasks.campaignId, campaignId),
            eq(campaignTasks.taskType, 'post'),
            sql`(CASE WHEN json_valid(${campaignTasks.details}) THEN trim(json_extract(${campaignTasks.details}, '$.source_notes[0].url')) ELSE NULL END) IN ${threadSources}`,
          ),
        ),
    );
  }
  const results = await Promise.all(queries);
  const merged = new Map<number, RawTaskRow>();
  for (const rows of results) for (const row of rows) if (!known.has(row.id)) merged.set(row.id, row);
  return Array.from(merged.values());
}

export async function buildDigest(slot: AccountSlot, days: number, now: Date = new Date()): Promise<Digest> {
  const boundedDays = Math.min(MAX_DIGEST_DAYS, Math.max(1, Math.floor(days)));
  const since = new Date(now.getTime() - boundedDays * 24 * 60 * 60 * 1000);
  const sinceEpoch = Math.floor(since.getTime() / 1000);

  const [profiles, policy, campaignId] = await Promise.all([listAccountProfiles(), getSlotPolicy(slot), loadCampaignId(slot)]);
  const profile = profiles.find((item) => item.slot === slot);
  if (!profile) throw new Error(`Missing profile for slot ${slot}`);

  const [windowTasks, previousRows, postRows, draftRows, mentionRows, snapshotRows] = await Promise.all([
    campaignId === null ? Promise.resolve([] as RawTaskRow[]) : loadWindowTasks(campaignId, sinceEpoch),
    campaignId === null ? Promise.resolve([] as RawTaskRow[]) : loadPreviousAnalysis(campaignId),
    db
      .select({
        id: scheduledPosts.id,
        text: scheduledPosts.text,
        scheduledTime: sql<string | number | null>`${scheduledPosts.scheduledTime}`,
        twitterPostId: scheduledPosts.twitterPostId,
        threadId: scheduledPosts.threadId,
        threadIndex: scheduledPosts.threadIndex,
        dedupeKey: scheduledPosts.dedupeKey,
        sourceUrl: scheduledPosts.sourceUrl,
        replyToTweetId: scheduledPosts.replyToTweetId,
      })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.accountSlot, slot), eq(scheduledPosts.status, 'posted'), sql`${epochOf(scheduledPosts.scheduledTime)} >= ${sinceEpoch}`))
      .orderBy(sql`${epochOf(scheduledPosts.scheduledTime)} ASC`, sql`${scheduledPosts.threadIndex} ASC`)
      .limit(POST_ROWS),
    db
      .select({
        id: draftPosts.id,
        text: draftPosts.text,
        source: draftPosts.source,
        createdAt: sql<string | number | null>`${draftPosts.createdAt}`,
      })
      .from(draftPosts)
      .where(and(eq(draftPosts.accountSlot, slot), sql`${epochOf(draftPosts.createdAt)} >= ${sinceEpoch}`))
      .orderBy(desc(draftPosts.id))
      .limit(DRAFT_SCAN),
    db
      .select({
        id: engagementInbox.id,
        sourceId: engagementInbox.sourceId,
        authorUsername: engagementInbox.authorUsername,
        text: engagementInbox.text,
        receivedAt: sql<string | number | null>`${engagementInbox.receivedAt}`,
        status: engagementInbox.status,
        assignedTo: engagementInbox.assignedTo,
      })
      .from(engagementInbox)
      .where(and(eq(engagementInbox.accountSlot, slot), eq(engagementInbox.sourceType, 'mention'), sql`${epochOf(engagementInbox.receivedAt)} >= ${sinceEpoch}`))
      .orderBy(desc(engagementInbox.id))
      .limit(MENTION_SCAN),
    db
      .select({
        followersCount: followerSnapshots.followersCount,
        snapshotAt: sql<string | number | null>`${followerSnapshots.snapshotAt}`,
      })
      .from(followerSnapshots)
      .where(and(eq(followerSnapshots.accountSlot, slot), sql`${epochOf(followerSnapshots.snapshotAt)} >= ${sinceEpoch}`))
      .orderBy(desc(followerSnapshots.id))
      .limit(24 * MAX_DIGEST_DAYS),
  ]);

  // The window check is repeated in JS on every row: the SQL predicate is the coarse
  // filter, `toIso` is the authority on what a stored timestamp means.
  const posts0 = postRows.filter((row) => inWindow(toIso(row.scheduledTime), since));

  // Tasks behind the window's posts may predate the window: fetch them too, so every post
  // the analyst sees comes with its topic, angle, verdict and length.
  const known = new Set(windowTasks.map((task) => task.id));
  const behindPosts = campaignId === null ? [] : await loadTasksBehindPosts(campaignId, posts0, known);
  const tasksForLinking = [...windowTasks, ...behindPosts];
  const tasks = [
    ...windowTasks.filter((task) => inWindow(toIso(task.createdAt), since) || (OPEN_TASK_STATUSES as readonly string[]).includes(task.status)),
    ...behindPosts,
  ].sort((a, b) => b.id - a.id);

  const grouped = groupDigestPosts(posts0, profile.username, tasksForLinking);
  const headIds = grouped.map((post) => post.id);
  const metricRows: RawMetricRow[] =
    headIds.length === 0
      ? []
      : await db
          .select({
            scheduledPostId: postMetrics.scheduledPostId,
            impressions: postMetrics.impressions,
            likes: postMetrics.likes,
            retweets: postMetrics.retweets,
            replies: postMetrics.replies,
            quotes: postMetrics.quotes,
            bookmarks: postMetrics.bookmarks,
            fetchedAt: sql<string | number | null>`${postMetrics.fetchedAt}`,
          })
          .from(postMetrics)
          .where(and(eq(postMetrics.accountSlot, slot), inArray(postMetrics.scheduledPostId, headIds)));
  const metricsByPost = new Map<number, RawMetricRow[]>();
  for (const row of metricRows) {
    const list = metricsByPost.get(row.scheduledPostId) ?? [];
    list.push(row);
    metricsByPost.set(row.scheduledPostId, list);
  }
  const posts: DigestPost[] = grouped.map(({ rowIds: _rowIds, ...post }) => {
    const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null;
    return { ...post, metrics: summarizeMetrics(metricPoints(metricsByPost.get(post.id) ?? [], publishedAt)) };
  });

  const drafts = draftRows
    .filter((row) => inWindow(toIso(row.createdAt), since))
    .map((row) => {
      const isThread = isThreadDraftSource(row.source);
      const tweets = isThread ? splitThreadDraft(row.text) : [row.text];
      return { id: row.id, text: tweets[0] ?? row.text, isThread, tweets: tweets.length, source: row.source, createdAt: toIso(row.createdAt) };
    });

  const mentions = mentionRows
    .filter((row) => inWindow(toIso(row.receivedAt), since))
    .map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      author: row.authorUsername,
      text: row.text,
      receivedAt: toIso(row.receivedAt),
      status: row.status,
      assignedTo: row.assignedTo,
    }));

  const followers = followerDelta(snapshotRows.filter((row) => inWindow(toIso(row.snapshotAt), since)));

  return {
    generatedAt: now.toISOString(),
    slot,
    window: { days: boundedDays, since: since.toISOString(), until: now.toISOString() },
    account: {
      username: profile.username,
      status: profile.status,
      postMode: profile.postMode,
      inboundReplyMode: profile.inboundReplyMode,
      outboundReplyMode: profile.outboundReplyMode,
      postsPerDay: profile.postsPerDay,
      maxRepliesPerConversation: profile.maxRepliesPerConversation,
      planHour: profile.planHour,
      planTimezone: profile.planTimezone,
      policyWindow: policy ? { start: policy.allowedWindowStart, end: policy.allowedWindowEnd, timezone: policy.timezone } : null,
    },
    brief: { profile: profile.profile, voice: profile.voice, strategy: profile.strategy, memory: profile.memory, playbook: profile.playbook },
    posts,
    tasks: { counts: countByStatus(tasks), items: tasks.map(toDigestTask) },
    drafts,
    mentions,
    followers,
    previousAnalysis: previousAnalysisFrom(previousRows),
  };
}
