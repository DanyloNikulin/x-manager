import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from './db';
import { scheduledActions } from './db/schema';
import { requireConnectedAccount, recordEngagementAction } from './engagement-ops';
import { postTweet, sendDirectMessage, likeTweet, repostTweet } from './twitter-api-client';
import { getResolvedXConfig } from './x-config';
import { checkPolicy } from './policy';
import { normalizeAccountSlot } from './account-slots';
import { logger, type Logger } from './logger';
import { createOwnerId, withLease } from './scheduler-lock';
import { startIntervalLoop } from './interval-loop';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

type ActionSchedulerLogger = Logger;

const defaultLogger: ActionSchedulerLogger = logger('action-scheduler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionSchedulerCycleResult {
  skipped: boolean;
  processed: number;
  completed: number;
  failed: number;
}

interface StartActionSchedulerLoopOptions {
  key?: string;
  intervalSeconds?: number;
  runOnStart?: boolean;
  logger?: ActionSchedulerLogger;
}

// ---------------------------------------------------------------------------
// Lease lock
// ---------------------------------------------------------------------------

const actionSchedulerOwnerId = createOwnerId();
const actionSchedulerLockKey = 'action-scheduler-cycle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePayloadJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed payload; return empty object.
  }
  return {};
}

function is429Error(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

export async function runActionSchedulerCycle(
  logger: ActionSchedulerLogger = defaultLogger,
): Promise<ActionSchedulerCycleResult> {
  const leaseSeconds = Math.max(30, Number(process.env.ACTION_SCHEDULER_LOCK_LEASE_SECONDS || 90));

  return withLease(
    {
      lockKey: actionSchedulerLockKey,
      ownerId: actionSchedulerOwnerId,
      leaseSeconds,
      onSkip: (): ActionSchedulerCycleResult => {
        logger.warn('Another action-scheduler instance owns the lease. Skipping this cycle.');
        return { skipped: true, processed: 0, completed: 0, failed: 0 };
      },
    },
    async () => {
    const config = await getResolvedXConfig();

    // Query all due actions.
    const dueActions = await db
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.status, 'scheduled'),
          lte(scheduledActions.scheduledTime, new Date()),
        ),
      )
      .orderBy(asc(scheduledActions.scheduledTime), asc(scheduledActions.id));

    if (dueActions.length === 0) {
      return { skipped: false, processed: 0, completed: 0, failed: 0 };
    }

    let completed = 0;
    let failed = 0;

    for (const action of dueActions) {
      try {
        // ---- Resolve account ----
        const accountSlot = normalizeAccountSlot(action.accountSlot, 1);
        const account = await requireConnectedAccount(accountSlot);

        // ---- Check policy ----
        const policyActionType = action.actionType === 'dm' ? 'dm' : action.actionType;
        const policyResult = await checkPolicy({
          slot: accountSlot,
          actionType: policyActionType,
        });

        if (!policyResult.allowed) {
          await updateActionStatus(action.id, 'failed', undefined, policyResult.reason);
          failed += 1;
          logger.warn(`Action ${action.id} blocked by policy: ${policyResult.reason}`);
          continue;
        }

        // ---- Parse payload ----
        const payload = parsePayloadJson(action.payloadJson);

        // ---- Execute action by type ----
        let resultData: unknown = null;
        let engagementActionType: 'reply' | 'dm_send' | 'like' | 'repost' = 'reply';

        switch (action.actionType) {
          case 'reply': {
            engagementActionType = 'reply';
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (!text) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing reply text in payload.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing reply text.`);
              continue;
            }

            const tweetResult = await postTweet(
              text,
              account.twitterAccessToken,
              account.twitterAccessTokenSecret,
              [],
              undefined,
              action.targetId || undefined,
              config,
            );

            if (tweetResult.errors && tweetResult.errors.length > 0) {
              const message = tweetResult.errors.map((e) => e.message).join(', ');
              await updateActionStatus(action.id, 'failed', JSON.stringify(tweetResult), message);
              await recordEngagementAction({
                accountSlot,
                actionType: 'reply',
                targetId: action.targetId,
                payload,
                result: tweetResult,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (reply) failed: ${message}`);
              continue;
            }

            resultData = tweetResult;
            break;
          }

          case 'dm': {
            engagementActionType = 'dm_send';
            const dmText = typeof payload.text === 'string' ? payload.text : '';
            const recipientUserId = action.targetId || (typeof payload.recipientUserId === 'string' ? payload.recipientUserId : '');

            if (!dmText || !recipientUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing DM text or recipient user ID.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing DM text or recipient.`);
              continue;
            }

            try {
              const dmResult = await sendDirectMessage(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                recipientUserId,
                dmText,
                config,
              );
              resultData = dmResult;
            } catch (dmError) {
              const message = dmError instanceof Error ? dmError.message : 'Failed to send DM';
              const retryable = is429Error(dmError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'dm_send',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (dm) failed: ${message}`);
              continue;
            }
            break;
          }

          case 'like': {
            engagementActionType = 'like';
            const tweetId = action.targetId;
            if (!tweetId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing target tweet ID for like.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing target tweet ID.`);
              continue;
            }

            if (!account.twitterUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Account missing twitterUserId for like.');
              failed += 1;
              logger.error(`Action ${action.id} failed: account missing twitterUserId.`);
              continue;
            }

            try {
              await likeTweet(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                account.twitterUserId,
                tweetId,
                config,
              );
              resultData = { liked: true, tweetId };
            } catch (likeError) {
              const message = likeError instanceof Error ? likeError.message : 'Failed to like tweet';
              const retryable = is429Error(likeError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'like',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (like) failed: ${message}`);
              continue;
            }
            break;
          }

          case 'repost': {
            engagementActionType = 'repost';
            const repostTweetId = action.targetId;
            if (!repostTweetId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing target tweet ID for repost.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing target tweet ID.`);
              continue;
            }

            if (!account.twitterUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Account missing twitterUserId for repost.');
              failed += 1;
              logger.error(`Action ${action.id} failed: account missing twitterUserId.`);
              continue;
            }

            try {
              await repostTweet(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                account.twitterUserId,
                repostTweetId,
                config,
              );
              resultData = { reposted: true, tweetId: repostTweetId };
            } catch (repostError) {
              const message = repostError instanceof Error ? repostError.message : 'Failed to repost tweet';
              const retryable = is429Error(repostError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'repost',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (repost) failed: ${message}`);
              continue;
            }
            break;
          }

          default: {
            await updateActionStatus(action.id, 'failed', undefined, `Unknown action_type: ${action.actionType}`);
            failed += 1;
            logger.error(`Action ${action.id} failed: unknown action_type "${action.actionType}".`);
            continue;
          }
        }

        // ---- Mark completed ----
        await updateActionStatus(action.id, 'completed', JSON.stringify(resultData));
        await recordEngagementAction({
          accountSlot,
          actionType: engagementActionType,
          targetId: action.targetId,
          payload,
          result: resultData,
          status: 'success',
        });
        completed += 1;
        logger.info(`Action ${action.id} (${action.actionType}) completed successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const retryable = is429Error(error);
        const errorText = retryable ? `Rate limited (429): ${message}` : message;

        await updateActionStatus(action.id, 'failed', undefined, errorText);
        failed += 1;
        logger.error(`Action ${action.id} failed with exception: ${errorText}`);
      }
    }

    return {
      skipped: false,
      processed: dueActions.length,
      completed,
      failed,
    };
    },
  );
}

// ---------------------------------------------------------------------------
// Status update helper
// ---------------------------------------------------------------------------

async function updateActionStatus(
  actionId: number,
  status: 'completed' | 'failed' | 'cancelled',
  resultJson?: string,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(scheduledActions)
    .set({
      status,
      resultJson: resultJson ?? null,
      error: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(scheduledActions.id, actionId));
}

// ---------------------------------------------------------------------------
// Loop management
// ---------------------------------------------------------------------------

export function startActionSchedulerLoop(options: StartActionSchedulerLoopOptions = {}): () => void {
  const key = options.key || 'action-scheduler';
  const cycleLogger = options.logger || defaultLogger;
  const intervalSeconds = Math.max(10, Math.floor(options.intervalSeconds || 30));
  const runOnStart = options.runOnStart !== false;

  return startIntervalLoop({
    key,
    intervalSeconds,
    runOnStart,
    unref: true,
    run: async () => {
      const result = await runActionSchedulerCycle(cycleLogger);
      if (result.processed > 0) {
        cycleLogger.info(`Cycle processed ${result.processed} actions.`);
      }
    },
    onError: (error) => {
      cycleLogger.error('Action scheduler cycle error:', error);
    },
    logger: cycleLogger,
  });
}
