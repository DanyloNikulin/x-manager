import { NextResponse } from 'next/server';

import { parseAccountSlot } from '@/lib/account-slots';
import { buildDigest, MAX_DIGEST_DAYS } from '@/lib/digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The account digest the analyst reads: posts of the last `days` days with their tasks,
 * verdicts, lengths and metrics at several ages, replies and mentions, drafts held for
 * review, follower counts, the previous analysis and the current brief. Read-only.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'slot must be 1, 2, or 3.' }, { status: 400 });
  }
  const raw = new URL(req.url).searchParams.get('days');
  const days = raw === null ? 7 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DIGEST_DAYS) {
    return NextResponse.json({ error: `days must be an integer between 1 and ${MAX_DIGEST_DAYS}.` }, { status: 400 });
  }
  try {
    const digest = await buildDigest(slot, days);
    return NextResponse.json({ digest });
  } catch (error) {
    console.error('Failed to build the account digest:', error);
    return NextResponse.json({ error: 'Failed to build the account digest.' }, { status: 500 });
  }
}
