import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';
import { executeXAction, XActionError } from '@/lib/execute-x-action';

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
    try {
      const body = (await req.json()) as ReplyBody;
      const accountSlot = normalizeAccountSlot(body.account_slot, 1);
      const inboxId = asInt(body.inbox_id);
      const replyToTweetId = asString(body.reply_to_tweet_id);
      const text = asString(body.text);

      if (!replyToTweetId || !text) {
        return apiError('VALIDATION_ERROR', 'reply_to_tweet_id and text are required.');
      }

      const result = await executeXAction({
        type: 'reply',
        slot: accountSlot,
        text,
        targetId: replyToTweetId,
        inboxId,
        payload: { text },
      }) as { data?: { id?: string; text?: string } };

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
      console.error('Failed to send reply:', error);
      if (error instanceof XActionError) {
        return apiError('X_API_ERROR', message);
      }
      return apiError('INTERNAL_ERROR', message);
    }
  });
}
