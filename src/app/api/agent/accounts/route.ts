import { NextResponse } from 'next/server';
import { listAccountProfiles } from '@/lib/account-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** All slots with their brief, autopilot switches and X connection state. */
export async function GET() {
  try {
    const items = await listAccountProfiles();
    return NextResponse.json({ items });
  } catch (error) {
    console.error('Failed to list account profiles:', error);
    return NextResponse.json({ error: 'Failed to list account profiles.' }, { status: 500 });
  }
}
