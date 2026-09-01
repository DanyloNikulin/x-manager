import { NextResponse } from 'next/server';
import {
  cancelCliLogin,
  isAllowedCliAuthOrigin,
  parseCliAuthProvider,
  startCliLogin,
  submitCliLoginInput,
} from '@/lib/cli-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSameOrigin(req: Request): boolean {
  return isAllowedCliAuthOrigin(
    req.url,
    req.headers.get('origin'),
    process.env.NEXT_PUBLIC_APP_URL,
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin CLI login requests are not allowed.' }, { status: 403 });
  }
  const { provider: rawProvider } = await params;
  const provider = parseCliAuthProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown CLI provider.' }, { status: 404 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (code) {
      return NextResponse.json({ session: submitCliLoginInput(provider, code) });
    }
    return NextResponse.json({ session: startCliLogin(provider) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start CLI login.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin CLI login requests are not allowed.' }, { status: 403 });
  }
  const { provider: rawProvider } = await params;
  const provider = parseCliAuthProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown CLI provider.' }, { status: 404 });
  }
  const session = cancelCliLogin(provider);
  return NextResponse.json({ session });
}
