import fs from 'fs/promises';
import path from 'path';
import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from './db';
import { scheduledPosts, xAccounts } from './db/schema';
import { postTweet, uploadMedia } from './twitter-api-client';
import { getResolvedXConfig, type ResolvedXConfig } from './x-config';
import { normalizeAccountSlot } from './account-slots';
import { decryptAccountTokens } from './x-account-crypto';
import { markSchedulerStarted, markCycleSuccess, markCycleError } from './scheduler-health';
import { emitEvent } from './events';
import { deliverEventToWebhooks } from './webhook-delivery';
import { logger, type Logger } from './logger';
import { createOwnerId, withLease } from './scheduler-lock';
import { startIntervalLoop } from './interval-loop';
import { parseStringArray } from './json-array';

type SchedulerLogger = Logger;

interface SchedulerCycleResult {
  skipped: boolean;
  processed: number;
  posted: number;
  failed: number;
}

interface StartSchedulerLoopOptions {
  key?: string;
  intervalSeconds?: number;
  runOnStart?: boolean;
  logger?: SchedulerLogger;
}

const schedulerOwnerId = createOwnerId();
const schedulerLockKey = 'scheduler-cycle';

const defaultLogger: SchedulerLogger = logger('scheduler');

function parseMediaUrls(value: string | null): string[] {
  return parseStringArray(value);
}

function toPublicFilePath(mediaUrl: string): string {
  const normalized = mediaUrl.startsWith('/') ? mediaUrl.slice(1) : mediaUrl;
  return path.join(process.cwd(), 'public', normalized);
}

async function getDuePosts() {
  return db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, 'scheduled'), lte(scheduledPosts.scheduledTime, new Date())))
    .orderBy(
      asc(scheduledPosts.scheduledTime),
      asc(scheduledPosts.threadId),
      asc(scheduledPosts.threadIndex),
      asc(scheduledPosts.id),
    );
}

async function getConnectedAccounts() {
  const rows = await db.select().from(xAccounts);
  return rows
    .map((account) => decryptAccountTokens(account))
    .filter((account) => Boolean(account.twitterAccessToken && account.twitterAccessTokenSecret));
}

async function updatePostStatus(
  postId: number,
  status: 'posted' | 'failed' | 'cancelled',
  twitterPostId?: string,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({
      status,
      twitterPostId,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(scheduledPosts.id, postId));
}

async function resolveMediaIds(
  mediaUrlsRaw: string | null,
  accessToken: string,
  accessTokenSecret: string,
  config: ResolvedXConfig,
  logger: SchedulerLogger,
): Promise<string[]> {
  const mediaUrls = parseMediaUrls(mediaUrlsRaw);
  if (mediaUrls.length === 0) {
    return [];
  }

  const mediaIds: string[] = [];

  for (const mediaUrl of mediaUrls) {
    try {
      const filePath = toPublicFilePath(mediaUrl);
      const buffer = await fs.readFile(filePath);
      const uploadResult = await uploadMedia(buffer, accessToken, accessTokenSecret, config);
      if (uploadResult?.media_id_string) {
        mediaIds.push(uploadResult.media_id_string);
      } else {
        logger.warn(`Media upload returned no ID for ${mediaUrl}`);
      }
    } catch (error) {
      logger.warn(`Failed to upload media "${mediaUrl}"`, error);
    }
  }

  return mediaIds;
}

function emitAndDeliver(
  eventType: 'post.posted' | 'post.failed' | 'post.cancelled',
  entityType: string,
  entityId: number,
  accountSlot: number,
  payload: Record<string, unknown>,
): void {
  try {
    const eventId = emitEvent({ eventType, entityType, entityId, accountSlot, payload });
    deliverEventToWebhooks(eventId, { eventType, entityType, entityId, accountSlot, payload });
  } catch {
    // Never let event emission crash the scheduler cycle.
  }
}

export async function runSchedulerCycle(logger: SchedulerLogger = defaultLogger): Promise<SchedulerCycleResult> {
  const leaseSeconds = Math.max(30, Number(process.env.SCHEDULER_LOCK_LEASE_SECONDS || 90));
  const nowEpoch = Math.floor(Date.now() / 1000);

  return withLease(
    {
      lockKey: schedulerLockKey,
      ownerId: schedulerOwnerId,
      leaseSeconds,
      onSkip: (): SchedulerCycleResult => {
        logger.warn('Another scheduler instance owns the lease. Skipping this cycle.');
        return { skipped: true, processed: 0, posted: 0, failed: 0 };
      },
    },
    async ({ extend }): Promise<SchedulerCycleResult> => {
      try {
    const config = await getResolvedXConfig();

    const connectedAccounts = await getConnectedAccounts();
    const accountBySlot = new Map(
      connectedAccounts.map((account) => [account.slot, account]),
    );

    const duePosts = await getDuePosts();
    if (duePosts.length === 0) {
      markCycleSuccess();
      return { skipped: false, processed: 0, posted: 0, failed: 0 };
    }

    if (accountBySlot.size === 0) {
      logger.info('No connected X accounts found. Scheduler cycle skipped.');
      return { skipped: true, processed: 0, posted: 0, failed: 0 };
    }

    let posted = 0;
    let failed = 0;
    const threadLatest = new Map<string, { index: number; twitterPostId: string }>();

    for (const post of duePosts) {
      // Extend lease periodically so long cycles don't lose the lock.
      const elapsed = Math.floor(Date.now() / 1000) - nowEpoch;
      if (elapsed > leaseSeconds * 0.5) {
        if (!extend()) {
          logger.error('Scheduler lease stolen by another instance. Aborting cycle.');
          break;
        }
      }

      try {
        const accountSlot = normalizeAccountSlot(post.accountSlot, 1);
        const account = accountBySlot.get(accountSlot);
        if (!account?.twitterAccessToken || !account?.twitterAccessTokenSecret) {
          logger.warn(`Post ${post.id} waiting: no connected account for slot ${accountSlot}.`);
          continue;
        }

        let effectiveReplyToTweetId = post.replyToTweetId || undefined;
        const hasThread = typeof post.threadId === 'string' && post.threadId.length > 0;
        const threadIndex = typeof post.threadIndex === 'number' ? post.threadIndex : null;

        if (hasThread && threadIndex !== null && threadIndex > 0) {
          const threadId = post.threadId as string;
          const prevIndex = threadIndex - 1;

          const cached = threadLatest.get(threadId);
          if (cached && cached.index === prevIndex) {
            effectiveReplyToTweetId = cached.twitterPostId;
          } else {
            const prevRows = await db
              .select()
              .from(scheduledPosts)
              .where(and(eq(scheduledPosts.threadId, threadId), eq(scheduledPosts.threadIndex, prevIndex)))
              .limit(1);
            const prev = prevRows[0];

            if (!prev) {
              logger.info(`Post ${post.id} waiting: thread ${threadId} missing index ${prevIndex}.`);
              continue;
            }

            if (prev.status === 'posted' && prev.twitterPostId) {
              effectiveReplyToTweetId = prev.twitterPostId;
            } else if (prev.status === 'failed' || prev.status === 'cancelled') {
              const message = `Blocked by thread index ${prevIndex} (post ${prev.id}) which is ${prev.status}.`;
              await updatePostStatus(post.id, 'cancelled', undefined, message);
              logger.warn(`Post ${post.id} cancelled: ${message}`);
              emitAndDeliver('post.cancelled', 'post', post.id, post.accountSlot, { reason: message, threadId: post.threadId });
              continue;
            } else {
              logger.info(`Post ${post.id} waiting: thread index ${prevIndex} (post ${prev.id}) not posted yet.`);
              continue;
            }
          }
        }

        const mediaIds = await resolveMediaIds(
          post.mediaUrls,
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          config,
          logger,
        );

        const result = await postTweet(
          post.text,
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          mediaIds,
          post.communityId || undefined,
          effectiveReplyToTweetId,
          config,
        );

        if (result.errors && result.errors.length > 0) {
          const message = result.errors.map((error) => error.message).join(', ');
          await updatePostStatus(post.id, 'failed', undefined, message);
          failed += 1;
          logger.error(`Post ${post.id} failed: ${message}`);
          emitAndDeliver('post.failed', 'post', post.id, post.accountSlot, { error: message, threadId: post.threadId });
          continue;
        }

        if (result.data?.id) {
          await updatePostStatus(post.id, 'posted', result.data.id);
          posted += 1;
          logger.info(`Post ${post.id} published to X as ${result.data.id}`);
          emitAndDeliver('post.posted', 'post', post.id, post.accountSlot, { twitterPostId: result.data.id, threadId: post.threadId });

          if (hasThread && threadIndex !== null) {
            threadLatest.set(post.threadId as string, { index: threadIndex, twitterPostId: result.data.id });
          }
          continue;
        }

        const raw = JSON.stringify(result);
        const fallbackMessage = raw && raw !== '{}'
          ? `Unexpected X API response: ${raw.slice(0, 400)}`
          : 'Unexpected X API response';
        await updatePostStatus(post.id, 'failed', undefined, fallbackMessage);
        failed += 1;
        logger.error(`Post ${post.id} failed: unexpected response shape.`);
        emitAndDeliver('post.failed', 'post', post.id, post.accountSlot, { error: fallbackMessage, threadId: post.threadId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await updatePostStatus(post.id, 'failed', undefined, message);
        failed += 1;
        logger.error(`Post ${post.id} failed with exception: ${message}`);
        emitAndDeliver('post.failed', 'post', post.id, post.accountSlot, { error: message, threadId: post.threadId });
      }
    }

    markCycleSuccess();
    return {
      skipped: false,
      processed: duePosts.length,
      posted,
      failed,
    };
      } catch (error) {
        markCycleError();
        throw error;
      }
    },
  );
}

export function startSchedulerLoop(options: StartSchedulerLoopOptions = {}): () => void {
  const key = options.key || 'default';
  const cycleLogger = options.logger || defaultLogger;
  const intervalSeconds = Math.max(10, Math.floor(options.intervalSeconds || 60));
  const runOnStart = options.runOnStart !== false;

  const stop = startIntervalLoop({
    key,
    intervalSeconds,
    runOnStart,
    run: async () => {
      const result = await runSchedulerCycle(cycleLogger);
      if (result.processed > 0) {
        cycleLogger.info(`Cycle processed ${result.processed} posts.`);
      }
    },
    onError: (error) => {
      cycleLogger.error('Scheduler cycle error:', error);
      markCycleError();
    },
    logger: cycleLogger,
  });

  markSchedulerStarted();
  return stop;
}
