import { normalizeAccountSlot } from '@/lib/account-slots';
import { asInt, asString } from '@/lib/http-parse';
import { EngagementValidationError, handleEngagementRequest } from '@/lib/engagement-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleEngagementRequest('engagement-like', req, (body) => {
    const tweetId = asString(body.tweet_id);
    if (!tweetId) throw new EngagementValidationError('tweet_id is required.');
    return {
      input: {
        type: 'like',
        slot: normalizeAccountSlot(body.account_slot, 1),
        targetId: tweetId,
        inboxId: asInt(body.inbox_id),
        payload: {},
      },
    };
  });
}
