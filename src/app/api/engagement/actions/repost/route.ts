import { NextResponse } from 'next/server';
import { repostTweet } from '@/lib/twitter-api-client';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from '@/lib/engagement-ops';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';

type RepostBody = {
  account_slot?: unknown;
  tweet_id?: unknown;
  inbox_id?: unknown;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return withIdempotency('engagement-repost', req, async () => {
    let accountSlot: 1 | 2 | 3 = 1;
    let inboxId: number | null = null;
    let tweetId: string | null = null;

    try {
      const body = (await req.json()) as RepostBody;
    accountSlot = parseAccountSlot(body.account_slot ?? 1);
    inboxId = asInt(body.inbox_id);
    tweetId = asString(body.tweet_id);

    if (!tweetId) {
      return NextResponse.json({ error: 'tweet_id is required.' }, { status: 400 });
    }

    const account = await requireConnectedAccount(accountSlot);
    if (!account.twitterUserId) {
      return NextResponse.json({ error: 'Connected account is missing twitter user id.' }, { status: 400 });
    }

    await repostTweet(
      account.twitterAccessToken,
      account.twitterAccessTokenSecret,
      account.twitterUserId,
      tweetId,
    );

    await recordEngagementAction({
      inboxId,
      accountSlot,
      actionType: 'repost',
      targetId: tweetId,
      payload: {},
      status: 'success',
    });

    return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to repost tweet.';
      await recordEngagementAction({
        inboxId,
        accountSlot,
        actionType: 'repost',
        targetId: tweetId,
        payload: {},
        status: 'failed',
        errorMessage: message,
      }).catch(() => {
        // Ignore follow-up logging failures.
      });

      console.error('Failed to repost tweet:', error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
