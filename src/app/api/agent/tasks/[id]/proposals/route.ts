import { NextResponse } from 'next/server';

import { parsePositiveTaskId } from '@/lib/subscription-worker';
import { decideProposal, ProposalError } from '@/lib/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator decision on one analyst proposal: `{ index, action: "apply" | "reject" }`.
 * Applying edits the account profile (text targets replace `current` with `proposed`,
 * settings take the proposed number); both decisions are recorded on the task.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const taskId = parsePositiveTaskId(rawId);
  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
  }
  let body: { index?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { index?: unknown; action?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const index = body.index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'index must be a non-negative integer.' }, { status: 400 });
  }
  if (body.action !== 'apply' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be apply or reject.' }, { status: 400 });
  }
  try {
    const result = await decideProposal(taskId, index, body.action);
    return NextResponse.json({ ok: true, task_id: taskId, ...result });
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes('was not found')) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error('Failed to decide proposal:', error);
    return NextResponse.json({ error: 'Failed to decide proposal.' }, { status: 500 });
  }
}
