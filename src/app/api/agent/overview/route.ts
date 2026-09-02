import { NextResponse } from 'next/server';

import { getOverview } from '@/lib/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Level 1: one payload with every slot's plan, queue, waiting items and first numbers. */
export async function GET() {
  try {
    const overview = await getOverview();
    return NextResponse.json(overview);
  } catch (error) {
    console.error('Failed to build overview:', error);
    return NextResponse.json({ error: 'Failed to build overview.' }, { status: 500 });
  }
}
