import { NextResponse } from 'next/server';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeXAction } from '@/lib/execute-x-action';
import { apiError } from '@/lib/api-error';
import { recordEngagementAction } from '@/lib/engagement-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 25;

type BulkAction = {
  action: 'like' | 'repost' | 'reply' | 'dismiss';
  inbox_id?: number;
  tweet_id?: string;
  text?: string;
  account_slot?: unknown;
};

type BulkResult = {
  index: number;
  action: string;
  status: 'ok' | 'error';
  error?: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items = body.items as BulkAction[] | undefined;

    if (!Array.isArray(items) || items.length === 0) {
      return apiError('VALIDATION_ERROR', 'items array is required.');
    }

    if (items.length > MAX_ITEMS) {
      return apiError('VALIDATION_ERROR', `Too many items. Maximum ${MAX_ITEMS} per request.`);
    }

    const results: BulkResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (i > 0 && item.action !== 'dismiss') {
        await new Promise((r) => setTimeout(r, 250));
      }

      try {
        const accountSlot = normalizeAccountSlot(item.account_slot, 1);

        switch (item.action) {
          case 'like':
          case 'repost':
          case 'reply': {
            if (!item.tweet_id) {
              results.push({ index: i, action: item.action, status: 'error', error: 'tweet_id required.' });
              break;
            }
            if (item.action === 'reply' && !item.text?.trim()) {
              results.push({ index: i, action: 'reply', status: 'error', error: 'tweet_id and text required.' });
              break;
            }
            await executeXAction({
              type: item.action,
              slot: accountSlot,
              targetId: item.tweet_id,
              text: item.text,
              inboxId: item.inbox_id ?? null,
              payload: item.action === 'reply' ? { text: item.text } : {},
            });
            results.push({ index: i, action: item.action, status: 'ok' });
            break;
          }

          case 'dismiss': {
            if (!item.inbox_id) {
              results.push({ index: i, action: 'dismiss', status: 'error', error: 'inbox_id required.' });
              break;
            }
            await db
              .update(engagementInbox)
              .set({ status: 'dismissed', updatedAt: new Date() })
              .where(eq(engagementInbox.id, item.inbox_id));
            await recordEngagementAction({
              inboxId: item.inbox_id,
              accountSlot,
              actionType: 'dismiss',
              targetId: null,
              payload: {},
              status: 'success',
            });
            results.push({ index: i, action: 'dismiss', status: 'ok' });
            break;
          }

          default:
            results.push({ index: i, action: String(item.action), status: 'error', error: 'Unknown action.' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ index: i, action: item.action, status: 'error', error: message });
      }
    }

    const succeeded = results.filter((r) => r.status === 'ok').length;
    const failed = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({ results, summary: { total: items.length, succeeded, failed } });
  } catch (error) {
    console.error('Bulk engagement error:', error);
    return apiError('INTERNAL_ERROR', 'Failed to process bulk actions.');
  }
}
