import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTasks } from '@/lib/db/schema';
import { isWorkerTaskType, parsePositiveTaskId, parseWorkerId } from '@/lib/subscription-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const taskId = parsePositiveTaskId(rawId);
  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
  }

  let body: { worker_id?: unknown; assigned_agent?: unknown };
  try {
    body = (await req.json()) as { worker_id?: unknown; assigned_agent?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const workerId = parseWorkerId(body.worker_id);
  if (!workerId) {
    return NextResponse.json({ error: 'worker_id is required and must contain only safe identifier characters.' }, { status: 400 });
  }
  const assignedAgent = parseWorkerId(body.assigned_agent);
  if (!assignedAgent) {
    return NextResponse.json({ error: 'assigned_agent is required and must contain only safe identifier characters.' }, { status: 400 });
  }

  const current = await db.select().from(campaignTasks).where(eq(campaignTasks.id, taskId)).limit(1);
  if (current.length === 0) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  if (!isWorkerTaskType(current[0].taskType)) {
    return NextResponse.json({ error: 'Task type is not handled by subscription workers.' }, { status: 409 });
  }

  const claimed = await db
    .update(campaignTasks)
    .set({
      status: 'in_progress',
      claimedBy: workerId,
      claimedAt: new Date(),
      attemptCount: sql`${campaignTasks.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(campaignTasks.id, taskId),
      eq(campaignTasks.status, 'pending'),
      eq(campaignTasks.assignedAgent, assignedAgent),
      or(isNull(campaignTasks.dueAt), lte(campaignTasks.dueAt, new Date())),
      sql`EXISTS (
        SELECT 1 FROM campaigns
        WHERE campaigns.id = ${campaignTasks.campaignId}
          AND campaigns.status = 'active'
      )`,
    ))
    .returning();

  if (claimed.length === 0) {
    return NextResponse.json({ error: 'Task is no longer available for claiming.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, task: claimed[0] });
}
