import { NextResponse } from 'next/server';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';
import { executeXAction, XActionError } from '@/lib/execute-x-action';

type RepostBody = {
  account_slot?: unknown;
  tweet_id?: unknown;
  inbox_id?: unknown;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return withIdempotency('engagement-repost', req, async () => {
    try {
      const body = (await req.json()) as RepostBody;
      const accountSlot = normalizeAccountSlot(body.account_slot, 1);
      const inboxId = asInt(body.inbox_id);
      const tweetId = asString(body.tweet_id);

      if (!tweetId) {
        return apiError('VALIDATION_ERROR', 'tweet_id is required.');
      }

      await executeXAction({
        type: 'repost',
        slot: accountSlot,
        targetId: tweetId,
        inboxId,
        payload: {},
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to repost tweet.';
      console.error('Failed to repost tweet:', error);
      if (error instanceof XActionError) {
        return apiError('X_API_ERROR', message);
      }
      return apiError('INTERNAL_ERROR', message);
    }
  });
}
