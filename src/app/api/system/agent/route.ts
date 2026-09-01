import { NextResponse } from 'next/server';
import { buildAgentCatalog } from './catalog';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return NextResponse.json(buildAgentCatalog(baseUrl));
}
