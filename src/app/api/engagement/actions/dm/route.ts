import { normalizeAccountSlot } from '@/lib/account-slots';
import { asInt, asString } from '@/lib/http-parse';
import { EngagementValidationError, handleEngagementRequest } from '@/lib/engagement-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleEngagementRequest('engagement-dm', req, (body) => {
    const recipientUserId = asString(body.recipient_user_id);
    const text = asString(body.text);
    if (!recipientUserId || !text) {
      throw new EngagementValidationError('recipient_user_id and text are required.');
    }
    return {
      input: {
        type: 'dm',
        slot: normalizeAccountSlot(body.account_slot, 1),
        text,
        targetId: recipientUserId,
        inboxId: asInt(body.inbox_id),
        payload: { text },
      },
      json: (result) => {
        const data = result as { eventId?: string };
        return { ok: true, eventId: data.eventId };
      },
    };
  });
}
