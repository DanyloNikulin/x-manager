import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campaignTasks, campaigns, engagementInbox } from '@/lib/db/schema';
import { ACCOUNT_SLOTS, type AccountSlot } from '@/lib/account-slots';
import { getAccountProfile } from '@/lib/account-profiles';
import { requireConnectedAccount } from '@/lib/engagement-ops';
import { fetchMentionsTimeline } from '@/lib/twitter-api-client';
import { emitEvent } from '@/lib/events';
import { deliverEventToWebhooks } from '@/lib/webhook-delivery';
import { logger } from '@/lib/logger';
import {
  SUBSCRIPTION_AGENT,
  INBOX_ASSIGNEE_UNASSIGNED,
  buildReplyTaskDetails,
  replyTaskTitle,
  shouldCreateReplyTask,
} from '@/lib/inbox-autopilot-rules';

/**
 * Ring 4: replies without a human in the loop for the intake.
 *
 * Every cycle, for each account whose stored profile is `ready` and whose X account is
 * connected: pull the mentions timeline, store new mentions in the inbox, and turn each
 * new inbound mention into a `reply` task assigned to the subscription worker. The
 * account's `inbound_reply_mode` then decides whether the written reply is published
 * automatically, waits in Drafts, or is only drafted.
 */

const log = logger('inbox-autopilot');
const MENTION_FETCH_COUNT = 25;
const MAX_REPLY_TASKS_PER_CYCLE = 10;
const MENTION_MAX_AGE_HOURS = 48;

export type InboxAutopilotSlotStats = {
  slot: AccountSlot;
  fetched: number;
  newMentions: number;
  replyTasks: number;
};

export async function syncMentionsForSlot(slot: AccountSlot, count = MENTION_FETCH_COUNT): Promise<{ fetched: number; created: number }> {
  const account = await requireConnectedAccount(slot);
  const mentions = await fetchMentionsTimeline(account.twitterAccessToken, account.twitterAccessTokenSecret, { count });
  let created = 0;
  for (const mention of mentions) {
    if (!mention.sourceId) continue;
    const existing = await db
      .select({ id: engagementInbox.id })
      .from(engagementInbox)
      .where(and(
        eq(engagementInbox.accountSlot, slot),
        eq(engagementInbox.sourceType, 'mention'),
        eq(engagementInbox.sourceId, mention.sourceId),
      ))
      .limit(1);
    // Known mentions keep their status and assignment; only new ones are inserted.
    if (existing[0]) continue;

    const inserted = await db
      .insert(engagementInbox)
      .values({
        accountSlot: slot,
        sourceType: 'mention',
        sourceId: mention.sourceId,
        conversationId: mention.inReplyToTweetId,
        authorUserId: mention.authorUserId,
        authorUsername: mention.authorUsername,
        text: mention.text,
        rawPayload: JSON.stringify(mention.raw),
        receivedAt: mention.createdAt ? new Date(mention.createdAt) : new Date(),
        status: 'new',
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted[0]) continue;
    created += 1;

    try {
      const event = {
        eventType: 'inbox.new_mention' as const,
        entityType: 'inbox',
        entityId: inserted[0].id,
        accountSlot: slot,
        payload: {
          sourceId: mention.sourceId,
          authorUserId: mention.authorUserId,
          authorUsername: mention.authorUsername,
          text: mention.text,
        },
      };
      const eventId = emitEvent(event);
      deliverEventToWebhooks(eventId, event);
    } catch {
      // Intake must not fail because event fanout failed.
    }
  }
  return { fetched: mentions.length, created };
}

async function ensureAutopilotCampaign(slot: AccountSlot): Promise<number> {
  const name = `Autopilot slot ${slot}`;
  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.accountSlot, slot), eq(campaigns.name, name), eq(campaigns.status, 'active')))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(campaigns)
    .values({
      name,
      objective: `Original posts and replies for account slot ${slot} in its own register, one sourced angle per task. Use only the facts in the task's source notes; no calls to action; no claims beyond the sources.`,
      accountSlot: slot,
      status: 'active',
    })
    .returning({ id: campaigns.id });
  return inserted[0].id;
}

/** Turn unassigned, recent, inbound mentions into reply tasks. Returns the new task ids. */
export async function createReplyTasksForNewMentions(
  slot: AccountSlot,
  ownUserId: string | null,
  limit = MAX_REPLY_TASKS_PER_CYCLE,
): Promise<number[]> {
  const since = new Date(Date.now() - MENTION_MAX_AGE_HOURS * 3600 * 1000);
  const rows = await db
    .select()
    .from(engagementInbox)
    .where(and(
      eq(engagementInbox.accountSlot, slot),
      eq(engagementInbox.sourceType, 'mention'),
      eq(engagementInbox.status, 'new'),
      eq(engagementInbox.assignedTo, INBOX_ASSIGNEE_UNASSIGNED),
      gte(engagementInbox.receivedAt, since),
    ))
    .orderBy(asc(engagementInbox.receivedAt))
    .limit(limit);

  const candidates = rows.filter((row) => shouldCreateReplyTask(row, ownUserId));
  if (candidates.length === 0) return [];

  const campaignId = await ensureAutopilotCampaign(slot);
  const created: number[] = [];
  for (const row of candidates) {
    const inserted = await db
      .insert(campaignTasks)
      .values({
        campaignId,
        taskType: 'reply',
        title: replyTaskTitle(row),
        details: JSON.stringify(buildReplyTaskDetails(row)),
        priority: 1,
        assignedAgent: SUBSCRIPTION_AGENT,
        status: 'pending',
      })
      .returning({ id: campaignTasks.id });
    await db
      .update(engagementInbox)
      .set({ assignedTo: SUBSCRIPTION_AGENT, updatedAt: new Date() })
      .where(eq(engagementInbox.id, row.id));
    if (inserted[0]) created.push(inserted[0].id);
  }
  return created;
}

export async function runInboxAutopilotCycle(): Promise<InboxAutopilotSlotStats[]> {
  const stats: InboxAutopilotSlotStats[] = [];
  for (const slot of ACCOUNT_SLOTS) {
    const profile = await getAccountProfile(slot);
    if (!profile.stored || profile.status !== 'ready') continue;

    let ownUserId: string | null;
    try {
      ownUserId = (await requireConnectedAccount(slot)).twitterUserId;
    } catch {
      continue; // not connected
    }

    try {
      const sync = await syncMentionsForSlot(slot);
      const tasks = await createReplyTasksForNewMentions(slot, ownUserId);
      stats.push({ slot, fetched: sync.fetched, newMentions: sync.created, replyTasks: tasks.length });
      if (sync.created > 0 || tasks.length > 0) {
        log.info(`slot ${slot}: ${sync.created} new mention(s), ${tasks.length} reply task(s) queued`);
      }
    } catch (error) {
      log.error(`slot ${slot}: inbox autopilot cycle failed`, error instanceof Error ? error : undefined);
    }
  }
  return stats;
}

const globalState = globalThis as typeof globalThis & { __xManagerInboxAutopilotStarted?: boolean };

export function startInboxAutopilotLoop(options: { intervalSeconds: number; initialDelaySeconds?: number }): void {
  if (globalState.__xManagerInboxAutopilotStarted) return;
  globalState.__xManagerInboxAutopilotStarted = true;
  const intervalMs = Math.max(120, options.intervalSeconds) * 1000;
  const initialDelayMs = Math.max(5, options.initialDelaySeconds ?? 45) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runInboxAutopilotCycle();
    } catch (error) {
      log.error('inbox autopilot cycle error', error instanceof Error ? error : undefined);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), initialDelayMs);
  setInterval(() => void tick(), intervalMs);
}
