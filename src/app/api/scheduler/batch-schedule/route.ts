import { NextResponse } from 'next/server';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { createScheduledPost } from '@/lib/post-scheduler';
import { asInt, asString, clamp, isProvided } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const tweets = Array.isArray(body?.tweets) ? body.tweets : null;
    if (!tweets || tweets.length === 0) {
      return apiError('VALIDATION_ERROR', 'No tweets provided.');
    }

    const rawSlot = body?.account_slot ?? body?.accountSlot;
    let accountSlot: AccountSlot = 1;
    if (isProvided(rawSlot)) {
      const parsed = parseAccountSlot(rawSlot);
      if (!parsed) {
        return apiError('INVALID_SLOT', 'Invalid account_slot. Use 1, 2, or 3.');
      }
      accountSlot = parsed;
    }

    const days = clamp(asInt(body?.days) ?? DEFAULT_DAYS, 1, 30);
    const windowStartHour = clamp(asInt(body?.window_start_hour ?? body?.start_hour) ?? 7, 0, 23);
    const windowEndHour = clamp(asInt(body?.window_end_hour ?? body?.end_hour) ?? 23, 1, 24);

    if (windowEndHour <= windowStartHour) {
      return apiError('VALIDATION_ERROR', 'Invalid window hours. end_hour must be greater than start_hour.');
    }

    const startTimeRaw = asString(body?.start_time ?? body?.startTime);
    const base = startTimeRaw ? new Date(startTimeRaw) : new Date();
    if (startTimeRaw && Number.isNaN(base.getTime())) {
      return apiError('VALIDATION_ERROR', 'Invalid start_time. Provide an ISO date string.');
    }

    const totalTweets = tweets.length;
    const baseTweetsPerDay = Math.floor(totalTweets / days);
    const extraTweets = totalTweets % days;
    const tweetsPerDay = Array(days).fill(baseTweetsPerDay);
    for (let i = 0; i < extraTweets; i += 1) {
      tweetsPerDay[i] += 1;
    }

    let tweetIndex = 0;
    let scheduled = 0;
    let skipped = 0;

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const tweetsForThisDay = tweetsPerDay[dayOffset];
      if (tweetsForThisDay <= 0) continue;

      const scheduledDate = new Date(base);
      scheduledDate.setDate(base.getDate() + dayOffset);
      scheduledDate.setSeconds(0, 0);

      const totalMinutes = (windowEndHour - windowStartHour) * 60;
      const intervalMinutes = tweetsForThisDay > 1 ? totalMinutes / (tweetsForThisDay - 1) : 0;

      for (let postInDay = 0; postInDay < tweetsForThisDay && tweetIndex < totalTweets; postInDay += 1) {
        const currentDate = new Date(scheduledDate);
        const minutesFromStart = postInDay * intervalMinutes;
        currentDate.setHours(
          windowStartHour + Math.floor(minutesFromStart / 60),
          Math.floor(minutesFromStart % 60),
          0,
          0,
        );

        const text = String(tweets[tweetIndex] ?? '');
        const result = await createScheduledPost({
          accountSlot,
          text,
          scheduledTime: currentDate,
        });
        if (result.skipped) skipped += 1;
        else scheduled += 1;
        tweetIndex += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Tweets scheduled successfully',
      accountSlot,
      days,
      window: {
        startHour: windowStartHour,
        endHour: windowEndHour,
      },
      scheduled,
      skipped,
    });
  } catch (error) {
    console.error('Error batch scheduling tweets:', error);
    return apiError('INTERNAL_ERROR', 'Failed to schedule tweets.');
  }
}
