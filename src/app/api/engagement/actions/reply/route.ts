import { normalizeAccountSlot } from '@/lib/account-slots';
import { asInt, asString } from '@/lib/http-parse';
import { EngagementValidationError, handleEngagementRequest } from '@/lib/engagement-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleEngagementRequest('engagement-reply', req, (body) => {
    const replyToTweetId = asString(body.reply_to_tweet_id);
    const text = asString(body.text);
    if (!replyToTweetId || !text) {
      throw new EngagementValidationError('reply_to_tweet_id and text are required.');
    }
    return {
      input: {
        type: 'reply',
        slot: normalizeAccountSlot(body.account_slot, 1),
        text,
        targetId: replyToTweetId,
        inboxId: asInt(body.inbox_id),
        payload: { text },
      },
      json: (result) => {
        const data = result as { data?: { id?: string; text?: string } };
        return { ok: true, tweetId: data.data?.id || null, text: data.data?.text || text };
      },
    };
  });
}
