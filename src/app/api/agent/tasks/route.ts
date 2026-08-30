import { and, asc, eq, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTasks, campaigns } from '@/lib/db/schema';
import { WORKER_TASK_TYPES, parseWorkerTaskQuery } from '@/lib/subscription-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const query = parseWorkerTaskQuery(new URL(req.url));
    const conditions: SQL[] = [
      eq(campaignTasks.status, query.status),
      inArray(campaignTasks.taskType, [...WORKER_TASK_TYPES]),
    ];
    if (query.status === 'pending') {
      conditions.push(
        eq(campaigns.status, 'active'),
        or(isNull(campaignTasks.dueAt), lte(campaignTasks.dueAt, new Date()))!,
      );
    }

    if (query.assignedAgent) {
      conditions.push(eq(campaignTasks.assignedAgent, query.assignedAgent));
    }
    if (query.accountSlot !== null) {
      conditions.push(eq(campaigns.accountSlot, query.accountSlot));
    }

    const rows = await db
      .select({
        id: campaignTasks.id,
        campaignId: campaignTasks.campaignId,
        taskType: campaignTasks.taskType,
        title: campaignTasks.title,
        details: campaignTasks.details,
        dueAt: campaignTasks.dueAt,
        priority: campaignTasks.priority,
        assignedAgent: campaignTasks.assignedAgent,
        status: campaignTasks.status,
        claimedBy: campaignTasks.claimedBy,
        claimedAt: campaignTasks.claimedAt,
        attemptCount: campaignTasks.attemptCount,
        accountSlot: campaigns.accountSlot,
        campaignName: campaigns.name,
        campaignObjective: campaigns.objective,
        campaignInstructions: campaigns.instructions,
      })
      .from(campaignTasks)
      .innerJoin(campaigns, eq(campaignTasks.campaignId, campaigns.id))
      .where(and(...conditions))
      .orderBy(asc(campaignTasks.priority), asc(campaignTasks.dueAt), asc(campaignTasks.id))
      .limit(query.limit);

    return NextResponse.json({ items: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid worker task query.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
