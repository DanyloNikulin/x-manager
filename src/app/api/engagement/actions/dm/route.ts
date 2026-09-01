import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';
import { executeXAction, XActionError } from '@/lib/execute-x-action';

type DmBody = {
  account_slot?: unknown;
  inbox_id?: unknown;
  recipient_user_id?: unknown;
  text?: unknown;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return withIdempotency('engagement-dm', req, async () => {
    try {
      const body = (await req.json()) as DmBody;
      const accountSlot = normalizeAccountSlot(body.account_slot, 1);
      const inboxId = asInt(body.inbox_id);
      const recipientUserId = asString(body.recipient_user_id);
      const text = asString(body.text);

      if (!recipientUserId || !text) {
        return apiError('VALIDATION_ERROR', 'recipient_user_id and text are required.');
      }

      const result = await executeXAction({
        type: 'dm',
        slot: accountSlot,
        text,
        targetId: recipientUserId,
        inboxId,
        payload: { text },
      }) as { eventId?: string };

      if (inboxId) {
        await db
          .update(engagementInbox)
          .set({ status: 'replied', updatedAt: new Date() })
          .where(eq(engagementInbox.id, inboxId));
      }

      return NextResponse.json({
        ok: true,
        eventId: result.eventId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send direct message.';
      console.error('Failed to send direct message:', error);
      if (error instanceof XActionError) {
        return apiError('X_API_ERROR', message);
      }
      return apiError('INTERNAL_ERROR', message);
    }
  });
}
