import { NextResponse } from 'next/server';
import { withIdempotency } from './idempotency';
import { apiError } from './api-error';
import { executeXAction, XActionError, type ExecuteXActionInput } from './execute-x-action';

export class EngagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngagementValidationError';
  }
}

export async function handleEngagementRequest(
  scope: string,
  req: Request,
  build: (body: Record<string, unknown>) => {
    input: ExecuteXActionInput;
    json?: (result: unknown) => Record<string, unknown>;
  },
): Promise<Response> {
  return withIdempotency(scope, req, async () => {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const { input, json } = build(body);
      const result = await executeXAction(input);
      return NextResponse.json(json ? json(result) : { ok: true });
    } catch (error) {
      if (error instanceof EngagementValidationError) {
        return apiError('VALIDATION_ERROR', error.message);
      }
      const message = error instanceof Error ? error.message : 'Failed to execute action.';
      console.error(`Failed ${scope}:`, error);
      if (error instanceof XActionError) {
        return apiError('X_API_ERROR', message);
      }
      return apiError('INTERNAL_ERROR', message);
    }
  });
}
