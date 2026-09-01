import { NextResponse } from 'next/server';
import { parseAccountSlot } from '@/lib/account-slots';
import { importAccountProfileFromFiles } from '@/lib/account-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One-time seed of the brief from the legacy accounts/slot-N/*.md workspace on this host. */
export async function POST(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'slot must be 1, 2, or 3.' }, { status: 400 });
  }
  try {
    const result = await importAccountProfileFromFiles(slot);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to import account profile from files:', error);
    return NextResponse.json({ error: 'Failed to import account profile from files.' }, { status: 500 });
  }
}
