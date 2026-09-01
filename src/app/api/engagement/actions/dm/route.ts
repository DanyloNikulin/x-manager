import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { sendDirectMessage } from '@/lib/twitter-api-client';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from '@/lib/engagement-ops';
import { withIdempotency } from '@/lib/idempotency';
import { asInt, asString } from '@/lib/http-parse';

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
    let accountSlot: 1 | 2 | 3 = 1;
    let inboxId: number | null = null;
    let recipientUserId: string | null = null;
    let text: string | null = null;

    try {
      const body = (await req.json()) as DmBody;
    accountSlot = parseAccountSlot(body.account_slot ?? 1);
    inboxId = asInt(body.inbox_id);
    recipientUserId = asString(body.recipient_user_id);
    text = asString(body.text);

    if (!recipientUserId || !text) {
      return NextResponse.json({ error: 'recipient_user_id and text are required.' }, { status: 400 });
    }

    const account = await requireConnectedAccount(accountSlot);

    const result = await sendDirectMessage(
      account.twitterAccessToken,
      account.twitterAccessTokenSecret,
      recipientUserId,
      text,
    );

    await recordEngagementAction({
      inboxId,
      accountSlot,
      actionType: 'dm_send',
      targetId: recipientUserId,
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
      eventId: result.eventId,
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send direct message.';
      await recordEngagementAction({
        inboxId,
        accountSlot,
        actionType: 'dm_send',
        targetId: recipientUserId,
        payload: { text },
        status: 'failed',
        errorMessage: message,
      }).catch(() => {
        // Ignore follow-up logging failures.
      });

      console.error('Failed to send direct message:', error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
