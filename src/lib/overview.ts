import { and, asc, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { campaignTasks, campaigns, draftPosts, postMetrics, scheduledPosts } from '@/lib/db/schema';
import { ACCOUNT_SLOTS, type AccountSlot } from '@/lib/account-slots';
import { listAccountProfiles, type AccountProfileView } from '@/lib/account-profiles';
import { getSlotPolicy } from '@/lib/policy';
import { isThreadDraftSource, splitThreadDraft } from '@/lib/thread-draft';
import { localDay, planRunToday, toIso } from '@/lib/time-zone';
import {
  autopilotCampaignName,
  groupThreadPosts,
  parseMarkerDetails,
  planMarkerTitle,
  plannerState,
  PLAN_MARKER_TASK_TYPE,
  PLANNER_AGENT,
  summarizeTaskOutput,
  type Overview,
  type OverviewMetrics,
  type OverviewPost,
  type OverviewTask,
  type PlanMarker,
  type SlotOverview,
} from '@/lib/overview-model';

const QUEUE_LIMIT = 40;
const PUBLISHED_ROWS = 25;
const PUBLISHED_GROUPS = 5;
const FAILED_WINDOW_DAYS = 7;
const DRAFT_PREVIEW = 5;
const TASK_SCAN = 80;
const IN_FLIGHT_STATUSES = ['pending', 'in_progress'] as const;

type TaskRow = {
  id: number;
  title: string;
  status: string;
  taskType: string;
  assignedAgent: string | null;
  claimedBy: string | null;
  details: string | null;
  output: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

async function findAutopilotCampaign(slot: AccountSlot): Promise<number | null> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.accountSlot, slot), eq(campaigns.name, autopilotCampaignName(slot))))
    .orderBy(desc(campaigns.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function loadTasks(campaignId: number): Promise<TaskRow[]> {
  return db
    .select({
      id: campaignTasks.id,
      title: campaignTasks.title,
      status: campaignTasks.status,
      taskType: campaignTasks.taskType,
      assignedAgent: campaignTasks.assignedAgent,
      claimedBy: campaignTasks.claimedBy,
      details: campaignTasks.details,
      output: campaignTasks.output,
      // Raw values: rows written by SQL defaults carry text timestamps that drizzle cannot map.
      createdAt: sql<string | number | null>`${campaignTasks.createdAt}`,
      updatedAt: sql<string | number | null>`${campaignTasks.updatedAt}`,
    })
    .from(campaignTasks)
    .where(eq(campaignTasks.campaignId, campaignId))
    .orderBy(desc(campaignTasks.id))
    .limit(TASK_SCAN);
}

function replyKindOf(details: string | null): string | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { reply_kind?: unknown };
    return typeof parsed.reply_kind === 'string' ? parsed.reply_kind : null;
  } catch {
    return null;
  }
}

function toTask(row: TaskRow, draftText: string | null = null): OverviewTask {
  const summary = summarizeTaskOutput(row.output);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    taskType: row.taskType,
    claimedBy: row.claimedBy,
    updatedAt: toIso(row.updatedAt) ?? toIso(row.createdAt),
    score: summary.score,
    verdict: summary.verdict,
    publicationMode: summary.publicationMode,
    replyKind: row.taskType === 'reply' ? replyKindOf(row.details) ?? 'outbound' : null,
    draftText,
  };
}

/** Worker drafts of this slot keyed by the task they came from (`...:task:<id>` sources). */
async function loadTaskDrafts(slot: AccountSlot): Promise<Map<number, string>> {
  const rows = await db
    .select({ text: draftPosts.text, source: draftPosts.source })
    .from(draftPosts)
    .where(and(eq(draftPosts.accountSlot, slot), like(draftPosts.source, 'subscription-worker:%')));
  const byTask = new Map<number, string>();
  for (const row of rows) {
    const match = row.source?.match(/:task:(\d+)$/);
    if (match) byTask.set(Number(match[1]), row.text);
  }
  return byTask;
}

export function findPlanMarker(tasks: TaskRow[], day: string): PlanMarker | null {
  const title = planMarkerTitle(day);
  const row = tasks.find(
    (task) => task.taskType === PLAN_MARKER_TASK_TYPE && task.assignedAgent === PLANNER_AGENT && task.title === title,
  );
  if (!row) return null;
  const details = parseMarkerDetails(row.details);
  return { taskId: row.id, plannedAt: toIso(row.createdAt), created: details.created, notes: details.notes };
}

async function latestMetrics(postIds: number[]): Promise<Map<number, OverviewMetrics>> {
  const result = new Map<number, OverviewMetrics>();
  if (postIds.length === 0) return result;
  const rows = await db
    .select()
    .from(postMetrics)
    .where(inArray(postMetrics.scheduledPostId, postIds))
    .orderBy(desc(postMetrics.fetchedAt), desc(postMetrics.id));
  for (const row of rows) {
    if (result.has(row.scheduledPostId)) continue;
    result.set(row.scheduledPostId, {
      impressions: row.impressions,
      likes: row.likes,
      retweets: row.retweets,
      replies: row.replies,
      fetchedAt: toIso(row.fetchedAt),
    });
  }
  return result;
}

async function loadPosts(slot: AccountSlot, username: string | null, now: Date) {
  const failedSince = new Date(now.getTime() - FAILED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [queueRows, publishedRows, failedRows] = await Promise.all([
    db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.accountSlot, slot), inArray(scheduledPosts.status, ['scheduled', 'pending_approval'])))
      .orderBy(asc(scheduledPosts.scheduledTime), asc(scheduledPosts.threadIndex))
      .limit(QUEUE_LIMIT),
    db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.accountSlot, slot), eq(scheduledPosts.status, 'posted')))
      .orderBy(desc(scheduledPosts.scheduledTime), asc(scheduledPosts.threadIndex))
      .limit(PUBLISHED_ROWS),
    db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.accountSlot, slot), eq(scheduledPosts.status, 'failed'), gte(scheduledPosts.scheduledTime, failedSince)))
      .orderBy(desc(scheduledPosts.scheduledTime))
      .limit(5),
  ]);

  const queue = groupThreadPosts(queueRows, username);
  const published = groupThreadPosts(publishedRows, username).slice(0, PUBLISHED_GROUPS);
  const failed = groupThreadPosts(failedRows, username);

  const metrics = await latestMetrics(published.map((post) => post.id));
  const withMetrics: OverviewPost[] = published.map((post) => ({ ...post, metrics: metrics.get(post.id) ?? null }));
  return { queue, published: withMetrics, failed };
}

async function loadDrafts(slot: AccountSlot) {
  const [rows, countRows] = await Promise.all([
    db.select().from(draftPosts).where(eq(draftPosts.accountSlot, slot)).orderBy(desc(draftPosts.id)).limit(DRAFT_PREVIEW),
    db.select({ count: sql<number>`count(*)` }).from(draftPosts).where(eq(draftPosts.accountSlot, slot)),
  ]);
  const drafts = rows.map((row) => {
    const isThread = isThreadDraftSource(row.source);
    return {
      id: row.id,
      text: isThread ? splitThreadDraft(row.text)[0] ?? row.text : row.text,
      isThread,
      tweets: isThread ? splitThreadDraft(row.text).length : 1,
      source: row.source,
      createdAt: toIso(row.createdAt),
    };
  });
  return { drafts, draftCount: Number(countRows[0]?.count ?? 0) };
}

async function buildSlot(profile: AccountProfileView, now: Date): Promise<SlotOverview> {
  const slot = profile.slot;
  const [policy, campaignId, posts, draftInfo] = await Promise.all([
    getSlotPolicy(slot),
    findAutopilotCampaign(slot),
    loadPosts(slot, profile.username, now),
    loadDrafts(slot),
  ]);
  const tasks = campaignId === null ? [] : await loadTasks(campaignId);

  const day = localDay(now, profile.planTimezone);
  const marker = findPlanMarker(tasks, day);
  const planAt = planRunToday(now, profile.planHour, profile.planTimezone);
  const planner = plannerState(profile.status, profile.postsPerDay);

  const inFlight = tasks
    .filter((task) => (IN_FLIGHT_STATUSES as readonly string[]).includes(task.status) && task.assignedAgent !== PLANNER_AGENT)
    .slice(0, 10)
    .map((task) => toTask(task));
  const taskDrafts = await loadTaskDrafts(slot);
  const waitingApproval = tasks.filter((task) => task.status === 'waiting_approval').slice(0, 10).map((task) => toTask(task, taskDrafts.get(task.id) ?? null));

  return {
    slot,
    status: profile.status,
    stored: profile.stored,
    connected: profile.connected,
    username: profile.username,
    displayName: profile.displayName,
    postMode: profile.postMode,
    inboundReplyMode: profile.inboundReplyMode,
    outboundReplyMode: profile.outboundReplyMode,
    postsPerDay: profile.postsPerDay,
    planHour: profile.planHour,
    planTimezone: profile.planTimezone,
    policy: { windowStart: policy.allowedWindowStart, windowEnd: policy.allowedWindowEnd, timezone: policy.timezone },
    campaignId,
    today: {
      day,
      marker,
      planAt: planAt.toISOString(),
      due: planner.active && marker === null && planAt.getTime() <= now.getTime(),
      plannerActive: planner.active,
      reason: planner.reason,
    },
    queue: posts.queue,
    inFlight,
    waitingApproval,
    drafts: draftInfo.drafts,
    draftCount: draftInfo.draftCount,
    published: posts.published,
    failed: posts.failed,
  };
}

/** Everything the Overview screen shows, for every slot. */
export async function getOverview(now: Date = new Date()): Promise<Overview> {
  const profiles = await listAccountProfiles();
  const slots = await Promise.all(
    ACCOUNT_SLOTS.map((slot) => {
      const profile = profiles.find((item) => item.slot === slot);
      if (!profile) throw new Error(`Missing profile for slot ${slot}`);
      return buildSlot(profile, now);
    }),
  );
  return { generatedAt: now.toISOString(), slots };
}

/** Deletes today's planner marker so the next worker pass plans the slot again. */
export async function replanToday(slot: AccountSlot, now: Date = new Date()): Promise<{ day: string; deleted: number; taskId: number | null }> {
  const profiles = await listAccountProfiles();
  const profile = profiles.find((item) => item.slot === slot);
  if (!profile) throw new Error(`Missing profile for slot ${slot}`);
  const day = localDay(now, profile.planTimezone);
  const campaignId = await findAutopilotCampaign(slot);
  if (campaignId === null) return { day, deleted: 0, taskId: null };
  const marker = findPlanMarker(await loadTasks(campaignId), day);
  if (!marker) return { day, deleted: 0, taskId: null };
  const deleted = await db.delete(campaignTasks).where(eq(campaignTasks.id, marker.taskId)).returning({ id: campaignTasks.id });
  return { day, deleted: deleted.length, taskId: marker.taskId };
}
