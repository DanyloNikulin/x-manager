import { NextResponse } from 'next/server';
import { parseAccountSlot } from '@/lib/account-slots';
import { getAccountProfile, saveAccountProfile, validateProfilePatch } from '@/lib/account-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'slot must be 1, 2, or 3.' }, { status: 400 });
  }
  try {
    const profile = await getAccountProfile(slot);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Failed to load account profile:', error);
    return NextResponse.json({ error: 'Failed to load account profile.' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: rawSlot } = await params;
  const slot = parseAccountSlot(rawSlot);
  if (!slot) {
    return NextResponse.json({ error: 'slot must be 1, 2, or 3.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const validated = validateProfilePatch(body);
  if (!validated.ok) {
    return NextResponse.json({ error: 'Invalid account profile.', details: validated.errors }, { status: 400 });
  }

  try {
    const profile = await saveAccountProfile(slot, validated.patch);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    console.error('Failed to save account profile:', error);
    return NextResponse.json({ error: 'Failed to save account profile.' }, { status: 500 });
  }
}
