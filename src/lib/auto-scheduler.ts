import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { contentQueue } from './db/schema';
import { createScheduledPost } from './post-scheduler';
import { normalizeAccountSlot } from './account-slots';
import { parseStringArray } from './json-array';
import { suggestNextAvailableSlots } from './optimal-time';

export async function processQueue(accountSlot: number): Promise<{ scheduled: number }> {
  const queuedItems = await db
    .select()
    .from(contentQueue)
    .where(
      and(
        eq(contentQueue.accountSlot, accountSlot),
        eq(contentQueue.status, 'queued'),
      ),
    )
    .orderBy(asc(contentQueue.position));

  if (queuedItems.length === 0) {
    return { scheduled: 0 };
  }

  const timeSlots = suggestNextAvailableSlots(accountSlot, queuedItems.length);
  let scheduled = 0;

  for (let i = 0; i < queuedItems.length && i < timeSlots.length; i++) {
    const item = queuedItems[i];
    const { post, skipped } = await createScheduledPost({
      accountSlot: normalizeAccountSlot(item.accountSlot, 1),
      text: item.text,
      mediaUrls: parseStringArray(item.mediaUrls),
      communityId: item.communityId,
      scheduledTime: timeSlots[i],
    });

    await db.update(contentQueue).set({
      status: 'scheduled',
      scheduledPostId: post.id,
      updatedAt: new Date(),
    }).where(eq(contentQueue.id, item.id));

    if (!skipped) {
      scheduled++;
    }
  }

  return { scheduled };
}
