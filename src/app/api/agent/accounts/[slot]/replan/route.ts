import { NextResponse } from 'next/server';

import { parseAccountSlot } from '@/lib/account-slots';
import { replanToday } from '@/lib/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Forgets today's planner run for the slot. The subscription worker plans the slot again on
 * its next pass, provided the slot is ready, has a daily budget, and the planning hour has passed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'Invalid account slot. Use 1, 2, or 3.' }, { status: 400 });
  }

  try {
    const result = await replanToday(slot);
    if (result.deleted === 0) {
      return NextResponse.json({ ok: false, error: `Nothing was planned for ${result.day} yet.`, day: result.day }, { status: 409 });
    }
    return NextResponse.json({ ok: true, day: result.day, taskId: result.taskId });
  } catch (error) {
    console.error('Failed to reset the daily plan:', error);
    return NextResponse.json({ error: 'Failed to reset the daily plan.' }, { status: 500 });
  }
}
