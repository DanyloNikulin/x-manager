import { runScheduledAutomationRules } from './automation-executor';
import { runFeedProcessor } from './feed-processor';
import { runKeywordMonitor } from './keyword-monitor';
import { createOwnerId, withLease } from './scheduler-lock';
import { startIntervalLoop } from './interval-loop';
import { logger, type Logger } from './logger';

const defaultLogger: Logger = logger('background-processors');
const ownerId = createOwnerId();
const lockKey = 'background-processors';

export async function runBackgroundProcessorCycle(
  cycleLogger: Logger = defaultLogger,
): Promise<{ skipped: boolean }> {
  const leaseSeconds = Math.max(30, Number(process.env.SCHEDULER_LOCK_LEASE_SECONDS || 90));

  return withLease(
    {
      lockKey,
      ownerId,
      leaseSeconds,
      onSkip: (): { skipped: boolean } => {
        cycleLogger.warn('Another background-processor instance owns the lease. Skipping this cycle.');
        return { skipped: true };
      },
    },
    async (): Promise<{ skipped: boolean }> => {
      try {
        await runScheduledAutomationRules(cycleLogger);
      } catch (error) {
        cycleLogger.error('Automation processor failure:', error);
      }
      try {
        await runFeedProcessor(cycleLogger);
      } catch (error) {
        cycleLogger.error('Feed processor failure:', error);
      }
      try {
        await runKeywordMonitor(cycleLogger);
      } catch (error) {
        cycleLogger.error('Keyword monitor failure:', error);
      }
      return { skipped: false };
    },
  );
}

export function startBackgroundProcessorLoop(intervalSeconds = 60): () => void {
  return startIntervalLoop({
    key: 'background-processors',
    intervalSeconds: Math.max(10, Math.floor(intervalSeconds)),
    runOnStart: true,
    unref: true,
    run: async () => {
      await runBackgroundProcessorCycle();
    },
    onError: (error) => {
      defaultLogger.error('Background processor cycle error:', error);
    },
    logger: defaultLogger,
  });
}
