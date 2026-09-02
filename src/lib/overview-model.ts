import type { AccountSlot } from '@/lib/account-slots';
import type { ProfileStatus, PublicationMode } from '@/lib/account-profile-validation';
import { toIso } from '@/lib/time-zone';

/**
 * Shapes and pure helpers behind the Overview screen (level 1). Database access lives in
 * `overview.ts`; everything here is testable without a database.
 */

export type OverviewMetrics = {
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  fetchedAt: string | null;
};

export type OverviewPost = {
  id: number;
  text: string;
  scheduledTime: string | null;
  status: string;
  twitterPostId: string | null;
  url: string | null;
  threadId: string | null;
  tweets: number;
  errorMessage: string | null;
  metrics: OverviewMetrics | null;
};

export type OverviewTask = {
  id: number;
  title: string;
  status: string;
  taskType: string;
  claimedBy: string | null;
  updatedAt: string | null;
  score: number | null;
  verdict: string | null;
  publicationMode: string | null;
};

export type OverviewDraft = {
  id: number;
  text: string;
  isThread: boolean;
  tweets: number;
  source: string | null;
  createdAt: string | null;
};

export type PlanMarker = {
  taskId: number;
  plannedAt: string | null;
  created: number | null;
  notes: string | null;
};

export type SlotToday = {
  day: string;
  marker: PlanMarker | null;
  /** Today's planning instant in the slot's zone. */
  planAt: string;
  /** True when the planning hour has passed today and nothing was planned: the next worker pass will plan. */
  due: boolean;
  plannerActive: boolean;
  reason: string | null;
};

export type SlotOverview = {
  slot: AccountSlot;
  status: ProfileStatus;
  stored: boolean;
  connected: boolean;
  username: string | null;
  displayName: string | null;
  postMode: PublicationMode;
  inboundReplyMode: PublicationMode;
  outboundReplyMode: PublicationMode;
  postsPerDay: number;
  planHour: number;
  planTimezone: string;
  policy: { windowStart: number; windowEnd: number; timezone: string };
  campaignId: number | null;
  today: SlotToday;
  queue: OverviewPost[];
  inFlight: OverviewTask[];
  waitingApproval: OverviewTask[];
  drafts: OverviewDraft[];
  draftCount: number;
  published: OverviewPost[];
  failed: OverviewPost[];
};

export type Overview = {
  generatedAt: string;
  slots: SlotOverview[];
};

export const AUTOPILOT_CAMPAIGN_PREFIX = 'Autopilot slot ';
export const PLANNER_AGENT = 'planner';
export const PLAN_MARKER_TASK_TYPE = 'research';

/** Mirrors `campaign_name` in orchestrator/src/planner.rs. */
export function autopilotCampaignName(slot: number): string {
  return `${AUTOPILOT_CAMPAIGN_PREFIX}${slot}`;
}

/** Mirrors `marker_title` in orchestrator/src/planner.rs. */
export function planMarkerTitle(day: string): string {
  return `Autopilot ${day}: plan`;
}

export function tweetUrl(username: string | null, twitterPostId: string | null): string | null {
  if (!twitterPostId) return null;
  const handle = (username || '').replace(/^@/, '').trim();
  return `https://x.com/${handle || 'i'}/status/${twitterPostId}`;
}

export type RawPostRow = {
  id: number;
  text: string;
  scheduledTime: unknown;
  status: string;
  twitterPostId: string | null;
  threadId: string | null;
  threadIndex: number | null;
  errorMessage: string | null;
};

/**
 * Collapses thread rows (same thread_id) into one entry represented by the first tweet.
 * Standalone posts pass through. Order follows the input order of each group's first row.
 */
export function groupThreadPosts(rows: RawPostRow[], username: string | null): OverviewPost[] {
  const groups = new Map<string, { head: RawPostRow; count: number }>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.threadId ? `thread:${row.threadId}` : `post:${row.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { head: row, count: 1 });
      order.push(key);
      continue;
    }
    existing.count += 1;
    if ((row.threadIndex ?? 0) < (existing.head.threadIndex ?? 0)) existing.head = row;
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    const head = group.head;
    return {
      id: head.id,
      text: head.text,
      scheduledTime: toIso(head.scheduledTime),
      status: head.status,
      twitterPostId: head.twitterPostId,
      url: tweetUrl(username, head.twitterPostId),
      threadId: head.threadId,
      tweets: group.count,
      errorMessage: head.errorMessage,
      metrics: null,
    };
  });
}

export type TaskOutputSummary = { score: number | null; verdict: string | null; publicationMode: string | null };

/** Pulls the validator verdict and publication mode out of a worker result payload. */
export function summarizeTaskOutput(output: string | null): TaskOutputSummary {
  const empty: TaskOutputSummary = { score: null, verdict: null, publicationMode: null };
  if (!output) return empty;
  try {
    const parsed = JSON.parse(output) as { validation?: { score?: unknown; verdict?: unknown }; publication_mode?: unknown };
    const score = typeof parsed.validation?.score === 'number' ? parsed.validation.score : null;
    const verdict = typeof parsed.validation?.verdict === 'string' ? parsed.validation.verdict : null;
    const publicationMode = typeof parsed.publication_mode === 'string' ? parsed.publication_mode : null;
    return { score, verdict, publicationMode };
  } catch {
    return empty;
  }
}

/** Reads the planner's marker payload (`{ created, notes }`). */
export function parseMarkerDetails(details: string | null): { created: number | null; notes: string | null } {
  if (!details) return { created: null, notes: null };
  try {
    const parsed = JSON.parse(details) as { created?: unknown; notes?: unknown };
    return {
      created: typeof parsed.created === 'number' ? parsed.created : null,
      notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
    };
  } catch {
    return { created: null, notes: null };
  }
}

export function plannerState(status: ProfileStatus, postsPerDay: number): { active: boolean; reason: string | null } {
  if (status === 'needs-onboarding') return { active: false, reason: 'Account needs onboarding; the planner skips it.' };
  if (status === 'paused') return { active: false, reason: 'Paused: the planner skips this account and nothing publishes automatically.' };
  if (postsPerDay <= 0) return { active: false, reason: 'Planner off: posts per day is 0.' };
  return { active: true, reason: null };
}
