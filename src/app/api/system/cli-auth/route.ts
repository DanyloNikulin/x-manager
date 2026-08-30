import { NextResponse } from 'next/server';
import { getCliLoginSessions, getCliProviderStatuses } from '@/lib/cli-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('refresh') === 'true';
  const providers = await getCliProviderStatuses(force);
  return NextResponse.json({ providers, sessions: getCliLoginSessions() });
}
