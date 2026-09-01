import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from './db';
import { scheduledActions } from './db/schema';
import { getResolvedXConfig } from './x-config';
import { normalizeAccountSlot } from './account-slots';
import { logger, type Logger } from './logger';
import { createOwnerId, withLease } from './scheduler-lock';
import { startIntervalLoop } from './interval-loop';
import { executeXAction, is429Error, XActionError, type XActionType } from './execute-x-action';

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

function asXActionType(value: string): XActionType | null {
  if (value === 'post' || value === 'reply' || value === 'dm' || value === 'like' || value === 'repost') {
    return value;
  }
  return null;
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
    async (): Promise<ActionSchedulerCycleResult> => {
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
        const accountSlot = normalizeAccountSlot(action.accountSlot, 1);
        const payload = parsePayloadJson(action.payloadJson);
        const actionType = asXActionType(action.actionType);
        if (!actionType) {
          await updateActionStatus(action.id, 'failed', undefined, `Unknown action_type: ${action.actionType}`);
          failed += 1;
          logger.error(`Action ${action.id} failed: unknown action_type "${action.actionType}".`);
          continue;
        }

        const text = typeof payload.text === 'string' ? payload.text : undefined;
        const targetId = action.targetId
          || (typeof payload.recipientUserId === 'string' ? payload.recipientUserId : null);

        const resultData = await executeXAction({
          type: actionType,
          slot: accountSlot,
          text,
          targetId,
          config,
          enforcePolicy: true,
          record: true,
          payload,
        });

        await updateActionStatus(action.id, 'completed', JSON.stringify(resultData));
        completed += 1;
        logger.info(`Action ${action.id} (${action.actionType}) completed successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const retryable = error instanceof XActionError ? error.retryable : is429Error(error);
        const errorText = retryable && !message.includes('429') ? `Rate limited (429): ${message}` : message;
        const resultJson = error instanceof XActionError && error.result ? JSON.stringify(error.result) : undefined;

        await updateActionStatus(action.id, 'failed', resultJson, errorText);
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
