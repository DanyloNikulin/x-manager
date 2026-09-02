import { NextResponse } from 'next/server';

import { parseAccountSlot } from '@/lib/account-slots';
import { appendMemoryObservations } from '@/lib/account-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_OBSERVATIONS = 20;
const MAX_OBSERVATION_LENGTH = 600;

/**
 * Appends dated observations to the account's memory field, server-side and atomically,
 * so the analyst never has to read, modify and write the field across two requests.
 * Body: `{ day: "YYYY-MM-DD", observations: string[] }`. 404 when no profile is stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'slot must be 1, 2, or 3.' }, { status: 400 });
  }
  let body: { day?: unknown; observations?: unknown };
  try {
    body = (await req.json()) as { day?: unknown; observations?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if (typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
    return NextResponse.json({ error: 'day must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (!Array.isArray(body.observations) || body.observations.length === 0 || body.observations.length > MAX_OBSERVATIONS) {
    return NextResponse.json({ error: `observations must be 1 to ${MAX_OBSERVATIONS} strings.` }, { status: 400 });
  }
  const observations = body.observations.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (observations.some((item) => !item || item.length > MAX_OBSERVATION_LENGTH || item.includes('\n'))) {
    return NextResponse.json({ error: `each observation must be one non-empty line of at most ${MAX_OBSERVATION_LENGTH} characters.` }, { status: 400 });
  }
  try {
    const result = appendMemoryObservations(slot, body.day, observations);
    if (!result) {
      return NextResponse.json({ error: 'The account has no stored profile.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, slot, memory: result.memory });
  } catch (error) {
    console.error('Failed to append memory observations:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to append memory observations.' }, { status: 500 });
  }
}
