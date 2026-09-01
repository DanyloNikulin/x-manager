import { NextResponse } from 'next/server';
import {
  cancelCliLogin,
  CliAuthError,
  isAllowedCliAuthOrigin,
  parseCliAuthProvider,
  startCliLogin,
  submitCliLoginInput,
} from '@/lib/cli-auth';
import { asString } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSameOrigin(req: Request): boolean {
  return isAllowedCliAuthOrigin(
    req.url,
    req.headers.get('origin'),
    process.env.NEXT_PUBLIC_APP_URL,
  );
}

async function resolveProvider(params: Promise<{ provider: string }>) {
  const { provider: rawProvider } = await params;
  return parseCliAuthProvider(rawProvider);
}

function forbidCrossOrigin() {
  return NextResponse.json({ error: 'Cross-origin CLI login requests are not allowed.' }, { status: 403 });
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(req)) return forbidCrossOrigin();
  const provider = await resolveProvider(params);
  if (!provider) {
    return apiError('NOT_FOUND', 'Unknown CLI provider.');
  }
  try {
    return NextResponse.json({ session: startCliLogin(provider) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start CLI login.';
    return apiError('INTERNAL_ERROR', message);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(req)) return forbidCrossOrigin();
  const provider = await resolveProvider(params);
  if (!provider) {
    return apiError('NOT_FOUND', 'Unknown CLI provider.');
  }
  try {
    const body = await req.json().catch(() => ({})) as { code?: unknown };
    const code = asString(body.code);
    if (!code) {
      return apiError('VALIDATION_ERROR', 'Login code is required.');
    }
    return NextResponse.json({ session: submitCliLoginInput(provider, code) });
  } catch (error) {
    if (error instanceof CliAuthError) {
      return apiError(error.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', error.message, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Could not submit the login code.';
    return apiError('INTERNAL_ERROR', message);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(req)) return forbidCrossOrigin();
  const provider = await resolveProvider(params);
  if (!provider) {
    return apiError('NOT_FOUND', 'Unknown CLI provider.');
  }
  const session = cancelCliLogin(provider);
  return NextResponse.json({ session });
}
