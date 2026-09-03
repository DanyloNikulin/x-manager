import { NextResponse } from 'next/server';

import { parsePositiveTaskId } from '@/lib/subscription-worker';
import { reviewTask, ReviewError } from '@/lib/task-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator decision on a task waiting for review: `{ action: "approve" | "reject" }`.
 * Approve schedules the worker's draft (a reply keeps its target, a thread is rebuilt, a
 * post takes the next open slot) and closes the task; reject deletes the draft and skips it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const taskId = parsePositiveTaskId(rawId);
  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
  }
  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'manual') {
    return NextResponse.json({ error: 'action must be approve, reject, or manual.' }, { status: 400 });
  }
  try {
    const result = await reviewTask(taskId, body.action);
    return NextResponse.json({ ok: true, task_id: taskId, ...result });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to review task:', error);
    return NextResponse.json({ error: 'Failed to review task.' }, { status: 500 });
  }
}
