import { eq, and, asc, lte, inArray } from 'drizzle-orm';
import { db } from './db';
import {
  campaignTasks,
  campaigns,
  campaignApprovals,
} from './db/schema';
import { executeXAction } from './execute-x-action';
import { normalizeAccountSlot } from './account-slots';
import { validateTweetUrls } from './tweet-url-validator';
import { completeRun, completeStep, insertRun, insertStep } from './agent-run-ledger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecuteTaskOptions = {
  dryRun?: boolean;
  idempotencyKey?: string;
  actor?: string;
};

export type ExecuteTaskResult = {
  runId: number;
  taskId: number;
  status: 'completed' | 'failed' | 'skipped' | 'waiting_approval' | 'dry_run';
  output?: unknown;
  error?: string;
  steps: Array<{ stepType: string; status: string; output?: unknown; error?: string }>;
};

export type ExecuteCampaignOptions = {
  maxTasks?: number;
  dryRun?: boolean;
  onlyTypes?: string[];
  until?: Date;
  actor?: string;
};

export type ExecuteCampaignResult = {
  runId: number;
  campaignId: number;
  tasksProcessed: number;
  results: ExecuteTaskResult[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDetailsJson(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { raw: details };
  } catch {
    return { raw: details };
  }
}

// ---------------------------------------------------------------------------
// Task type executors
// ---------------------------------------------------------------------------

const RESEARCH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'about',
  'research', 'find', 'search', 'look', 'discover',
]);

function extractResearchKeywords(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): string[] {
  // 1. Explicit keywords from details
  if (details.keywords) {
    if (Array.isArray(details.keywords)) {
      const arr = (details.keywords as string[]).map((k) => k.trim()).filter(Boolean);
      if (arr.length > 0) return arr;
    }
    if (typeof details.keywords === 'string') {
      const arr = (details.keywords as string).split(',').map((k) => k.trim()).filter(Boolean);
      if (arr.length > 0) return arr;
    }
  }

  // 2. Fallback: split task title, filter stop words
  if (task.title) {
    const words = task.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RESEARCH_STOP_WORDS.has(w));
    if (words.length > 0) return words;
  }

  // 3. Fallback: topic or query from details
  if (typeof details.topic === 'string' && details.topic.trim()) {
    return [details.topic.trim()];
  }
  if (typeof details.query === 'string' && details.query.trim()) {
    return [details.query.trim()];
  }

  return [];
}

async function executeResearchTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const keywords = extractResearchKeywords(task, details);

  if (keywords.length === 0) {
    return {
      output: {
        summary: 'Research skipped: no keywords could be extracted from the task.',
        keywords: [],
        collectedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const { searchDiscoveryTopics } = await import('./discovery-search');
    const data = await searchDiscoveryTopics({
      keywords,
      language: typeof details.language === 'string' ? details.language : 'en',
      limit: Number(details.limit || 10),
    });
    const topics = data.topics ?? [];

    return {
      output: {
        summary: `Found ${topics.length} relevant posts for keywords: ${keywords.join(', ')}`,
        keywords,
        topicCount: topics.length,
        topics: topics.slice(0, 5).map((t) => ({
          id: t.id,
          text: t.text,
          url: t.url,
          author: t.author?.username,
          relevanceScore: t.relevanceScore,
          metrics: t.metrics,
        })),
        collectedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown fetch error';
    return {
      output: {
        summary: `Research failed: ${errorMessage}`,
        keywords,
        error: errorMessage,
        collectedAt: new Date().toISOString(),
      },
    };
  }
}

async function executePostTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? (details.raw as string) ?? task.title;
  const slot = normalizeAccountSlot(details.accountSlot, 1);
  const mediaIds = Array.isArray(details.mediaIds) ? (details.mediaIds as string[]) : [];
  const communityId = typeof details.communityId === 'string' ? details.communityId : undefined;
  const replyToTweetId = typeof details.replyToTweetId === 'string' ? details.replyToTweetId : undefined;

  await validateTweetUrls(content);

  const result = await executeXAction({
    type: 'post',
    slot,
    text: content,
    targetId: replyToTweetId,
    mediaIds,
    communityId,
    enforcePolicy: true,
    record: false,
    payload: { taskId: task.id },
  }) as { data?: unknown };

  return { output: result.data };
}

async function executeReplyTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? task.title;
  const replyToTweetId = details.replyToTweetId as string;
  const slot = normalizeAccountSlot(details.accountSlot, 1);

  if (!replyToTweetId) {
    throw new Error('Reply task missing replyToTweetId in details.');
  }

  const result = await executeXAction({
    type: 'reply',
    slot,
    text: content,
    targetId: replyToTweetId,
    enforcePolicy: true,
    payload: { content, taskId: task.id },
  }) as { data?: unknown };

  return { output: result.data };
}

async function executeDmTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? task.title;
  const recipientUserId = details.recipientUserId as string;
  const slot = normalizeAccountSlot(details.accountSlot, 1);

  if (!recipientUserId) {
    throw new Error('DM task missing recipientUserId in details.');
  }

  const result = await executeXAction({
    type: 'dm',
    slot,
    text: content,
    targetId: recipientUserId,
    enforcePolicy: true,
    payload: { content, taskId: task.id },
  });

  return { output: result };
}

async function executeLikeTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const tweetIds = Array.isArray(details.tweetIds)
    ? (details.tweetIds as string[])
    : typeof details.tweetId === 'string'
      ? [details.tweetId as string]
      : [];
  const slot = normalizeAccountSlot(details.accountSlot, 1);

  if (tweetIds.length === 0) {
    throw new Error('Like task missing tweetIds or tweetId in details.');
  }

  const results: Array<{ tweetId: string; status: string }> = [];

  for (const tweetId of tweetIds) {
    try {
      await executeXAction({
        type: 'like',
        slot,
        targetId: tweetId,
        enforcePolicy: true,
        payload: { taskId: task.id },
      });
      results.push({ tweetId, status: 'liked' });
    } catch (err) {
      results.push({ tweetId, status: `failed: ${err instanceof Error ? err.message : 'unknown'}` });
    }
  }

  return { output: results };
}

// ---------------------------------------------------------------------------
// Approval gating
// ---------------------------------------------------------------------------

async function ensureApproval(
  task: typeof campaignTasks.$inferSelect,
): Promise<{ approved: boolean; approvalId: number }> {
  // Check for existing approved approval
  if (task.approvalId) {
    const existing = await db
      .select()
      .from(campaignApprovals)
      .where(eq(campaignApprovals.id, task.approvalId))
      .limit(1);

    if (existing[0]) {
      return { approved: existing[0].status === 'approved', approvalId: existing[0].id };
    }
  }

  // Check for an approval linked to this task
  const linked = await db
    .select()
    .from(campaignApprovals)
    .where(eq(campaignApprovals.taskId, task.id))
    .limit(1);

  if (linked[0]) {
    // Sync the approvalId on the task if not set
    if (!task.approvalId) {
      await db
        .update(campaignTasks)
        .set({ approvalId: linked[0].id, updatedAt: new Date() })
        .where(eq(campaignTasks.id, task.id));
    }
    return { approved: linked[0].status === 'approved', approvalId: linked[0].id };
  }

  // Create a new pending approval
  const [newApproval] = await db
    .insert(campaignApprovals)
    .values({
      campaignId: task.campaignId,
      taskId: task.id,
      requestedBy: 'agent',
      status: 'pending',
    })
    .returning();

  await db
    .update(campaignTasks)
    .set({ approvalId: newApproval.id, updatedAt: new Date() })
    .where(eq(campaignTasks.id, task.id));

  return { approved: false, approvalId: newApproval.id };
}

// ---------------------------------------------------------------------------
// executeTask
// ---------------------------------------------------------------------------

export async function executeTask(
  taskId: number,
  options: ExecuteTaskOptions = {},
): Promise<ExecuteTaskResult> {
  const { dryRun = false, actor = 'system' } = options;

  // Load task
  const [task] = await db.select().from(campaignTasks).where(eq(campaignTasks.id, taskId)).limit(1);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  // Already terminal
  if (task.status === 'done' || task.status === 'skipped') {
    return {
      runId: 0,
      taskId: task.id,
      status: 'skipped',
      output: task.output ? JSON.parse(task.output) : undefined,
      steps: [],
    };
  }

  // Approval gating
  if (task.requiresApproval || task.taskType === 'approval') {
    const { approved, approvalId } = await ensureApproval(task);
    if (!approved) {
      await db
        .update(campaignTasks)
        .set({ status: 'waiting_approval', approvalId, updatedAt: new Date() })
        .where(eq(campaignTasks.id, task.id));

      return {
        runId: 0,
        taskId: task.id,
        status: 'waiting_approval',
        output: { approvalId, message: 'Task is waiting for approval.' },
        steps: [],
      };
    }
  }

  // Create agent run
  const runId = insertRun({
    campaignId: task.campaignId,
    dryRun,
    requestedBy: actor,
    inputJson: JSON.stringify({ taskId: task.id, taskType: task.taskType, dryRun }),
  });

  const details = parseDetailsJson(task.details);
  const steps: ExecuteTaskResult['steps'] = [];

  // Dry run: plan only
  if (dryRun) {
    const planStepId = insertStep({ runId, taskId: task.id, stepType: 'plan', inputJson: JSON.stringify(details) });
    const planOutput = {
      taskType: task.taskType,
      title: task.title,
      details,
      wouldExecute: true,
    };
    completeStep(planStepId, 'completed', planOutput);
    completeRun(runId, 'completed', planOutput);

    steps.push({ stepType: 'plan', status: 'completed', output: planOutput });

    return {
      runId,
      taskId: task.id,
      status: 'dry_run',
      output: planOutput,
      steps,
    };
  }

  // Mark in-progress
  await db
    .update(campaignTasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(campaignTasks.id, task.id));

  // Execute
  const execStepId = insertStep({
    runId,
    taskId: task.id,
    stepType: task.taskType,
    inputJson: JSON.stringify(details),
  });

  try {
    let result: { output: unknown };

    switch (task.taskType) {
      case 'research':
        result = await executeResearchTask(task, details);
        break;
      case 'post':
        result = await executePostTask(task, details);
        break;
      case 'reply':
        result = await executeReplyTask(task, details);
        break;
      case 'dm':
        result = await executeDmTask(task, details);
        break;
      case 'like':
        result = await executeLikeTask(task, details);
        break;
      case 'approval':
        // If we reach here, approval was already granted above
        result = { output: { message: 'Approval granted, task completed.' } };
        break;
      default:
        throw new Error(`Unknown task type: ${task.taskType}`);
    }

    // Success
    completeStep(execStepId, 'completed', result.output);
    steps.push({ stepType: task.taskType, status: 'completed', output: result.output });

    await db
      .update(campaignTasks)
      .set({
        status: 'done',
        output: JSON.stringify(result.output),
        updatedAt: new Date(),
      })
      .where(eq(campaignTasks.id, task.id));

    completeRun(runId, 'completed', result.output);

    return {
      runId,
      taskId: task.id,
      status: 'completed',
      output: result.output,
      steps,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown execution error';

    completeStep(execStepId, 'failed', undefined, errorMessage);
    steps.push({ stepType: task.taskType, status: 'failed', error: errorMessage });

    await db
      .update(campaignTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(campaignTasks.id, task.id));

    completeRun(runId, 'failed', undefined, errorMessage);

    return {
      runId,
      taskId: task.id,
      status: 'failed',
      error: errorMessage,
      steps,
    };
  }
}

// ---------------------------------------------------------------------------
// executeCampaign
// ---------------------------------------------------------------------------

export async function executeCampaign(
  campaignId: number,
  options: ExecuteCampaignOptions = {},
): Promise<ExecuteCampaignResult> {
  const { maxTasks = 10, dryRun = false, onlyTypes, until, actor = 'system' } = options;

  // Load and validate campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found.`);
  }

  if (campaign.status !== 'active') {
    throw new Error(`Campaign ${campaignId} is not active (status: ${campaign.status}).`);
  }

  // Build task query conditions
  const conditions = [
    eq(campaignTasks.campaignId, campaignId),
    inArray(campaignTasks.status, ['pending', 'failed']),
  ];

  if (until) {
    conditions.push(lte(campaignTasks.dueAt, until));
  }

  // Load eligible tasks
  let eligibleTasks = await db
    .select()
    .from(campaignTasks)
    .where(and(...conditions))
    .orderBy(asc(campaignTasks.priority), asc(campaignTasks.dueAt));

  // Filter by type if specified
  if (onlyTypes && onlyTypes.length > 0) {
    eligibleTasks = eligibleTasks.filter((t) => onlyTypes.includes(t.taskType));
  }

  // Limit
  eligibleTasks = eligibleTasks.slice(0, maxTasks);

  // Create parent run
  const parentRunId = insertRun({
    campaignId,
    dryRun,
    requestedBy: actor,
    inputJson: JSON.stringify({
      campaignId,
      maxTasks,
      dryRun,
      onlyTypes: onlyTypes ?? null,
      until: until?.toISOString() ?? null,
      eligibleTaskCount: eligibleTasks.length,
    }),
  });

  const results: ExecuteTaskResult[] = [];

  for (const task of eligibleTasks) {
    try {
      const result = await executeTask(task.id, { dryRun, actor });
      results.push(result);
    } catch (err) {
      // Single task failure should not stop the campaign
      results.push({
        runId: parentRunId,
        taskId: task.id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        steps: [],
      });
    }
  }

  // Determine parent run status
  const hasFailures = results.some((r) => r.status === 'failed');
  const allFailed = results.length > 0 && results.every((r) => r.status === 'failed');
  const parentStatus = allFailed ? 'failed' : 'completed';

  const outputSummary = {
    campaignId,
    tasksProcessed: results.length,
    completed: results.filter((r) => r.status === 'completed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    waitingApproval: results.filter((r) => r.status === 'waiting_approval').length,
    dryRun: results.filter((r) => r.status === 'dry_run').length,
  };

  completeRun(
    parentRunId,
    parentStatus,
    outputSummary,
    hasFailures ? `${outputSummary.failed} task(s) failed` : undefined,
  );

  return {
    runId: parentRunId,
    campaignId,
    tasksProcessed: results.length,
    results,
  };
}
