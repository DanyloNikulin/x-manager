import { NextResponse } from 'next/server';

import { DraftScheduleError, scheduleDraftFromDrafts } from '@/lib/draft-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Schedules a draft at `scheduled_time` (ISO) and removes it, in one transaction: a reply
 * keeps its target, a worker thread draft becomes chained rows, and the worker task the
 * draft came from is closed. Replaces the Drafts page's schedule-then-delete pair.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const draftId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid draft id.' }, { status: 400 });
  }
  let body: { scheduled_time?: unknown };
  try {
    body = (await req.json()) as { scheduled_time?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const scheduledAt = typeof body.scheduled_time === 'string' ? new Date(body.scheduled_time) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'scheduled_time must be an ISO date-time.' }, { status: 400 });
  }
  try {
    const result = scheduleDraftFromDrafts(draftId, scheduledAt);
    return NextResponse.json({ ok: true, draft_id: draftId, ...result });
  } catch (error) {
    if (error instanceof DraftScheduleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to schedule draft:', error);
    return NextResponse.json({ error: 'Failed to schedule draft.' }, { status: 500 });
  }
}
