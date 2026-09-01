import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { postTweet } from '@/lib/twitter-api-client';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from '@/lib/engagement-ops';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';

type ReplyBody = {
  account_slot?: unknown;
  inbox_id?: unknown;
  reply_to_tweet_id?: unknown;
  text?: unknown;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return withIdempotency('engagement-reply', req, async () => {
    let accountSlot: 1 | 2 | 3 = 1;
    let inboxId: number | null = null;
    let replyToTweetId: string | null = null;
    let text: string | null = null;

    try {
      const body = (await req.json()) as ReplyBody;
    accountSlot = parseAccountSlot(body.account_slot ?? 1);
    inboxId = asInt(body.inbox_id);
    replyToTweetId = asString(body.reply_to_tweet_id);
    text = asString(body.text);

    if (!replyToTweetId || !text) {
      return NextResponse.json({ error: 'reply_to_tweet_id and text are required.' }, { status: 400 });
    }

    const account = await requireConnectedAccount(accountSlot);

    const result = await postTweet(
      text,
      account.twitterAccessToken,
      account.twitterAccessTokenSecret,
      [],
      undefined,
      replyToTweetId,
    );

    if (result.errors && result.errors.length > 0) {
      const message = result.errors.map((entry) => entry.message).join(' ');
      await recordEngagementAction({
        inboxId,
        accountSlot,
        actionType: 'reply',
        targetId: replyToTweetId,
        payload: { text },
        result,
        status: 'failed',
        errorMessage: message,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }

    await recordEngagementAction({
      inboxId,
      accountSlot,
      actionType: 'reply',
      targetId: replyToTweetId,
      payload: { text },
      result,
      status: 'success',
    });

    if (inboxId) {
      await db
        .update(engagementInbox)
        .set({ status: 'replied', updatedAt: new Date() })
        .where(eq(engagementInbox.id, inboxId));
    }

    return NextResponse.json({
      ok: true,
      tweetId: result.data?.id || null,
      text: result.data?.text || text,
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send reply.';
      await recordEngagementAction({
        inboxId,
        accountSlot,
        actionType: 'reply',
        targetId: replyToTweetId,
        payload: { text },
        status: 'failed',
        errorMessage: message,
      }).catch(() => {
        // Ignore follow-up logging failures.
      });

      console.error('Failed to send reply:', error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
