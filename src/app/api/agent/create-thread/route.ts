import { NextResponse } from 'next/server';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { asBool, asIntOr, asString } from '@/lib/http-parse';
import { isPrivateHostname } from '@/lib/network-safety';
import { scheduleThread } from '@/lib/thread-scheduler';
import {
  buildThreadDraft,
  downloadRemoteImages,
  fetchAndExtractArticle,
} from '@/lib/create-thread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateThreadRequest = {
  article_url?: unknown;
  articleUrl?: unknown;
  account_slot?: unknown;
  accountSlot?: unknown;
  scheduled_time?: unknown;
  scheduledTime?: unknown;
  schedule?: unknown;
  dedupe?: unknown;
  include_images?: unknown;
  includeImages?: unknown;
  max_tweets?: unknown;
  maxTweets?: unknown;
  community_id?: unknown;
  communityId?: unknown;
  reply_to_tweet_id?: unknown;
  replyToTweetId?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateThreadRequest;
    const rawArticleUrl = asString(body.article_url ?? body.articleUrl);
    if (!rawArticleUrl) {
      return NextResponse.json({ error: 'Missing article_url.' }, { status: 400 });
    }

    let articleUrl: string;
    try {
      const parsed = new URL(rawArticleUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'article_url must use http or https.' }, { status: 400 });
      }
      if (isPrivateHostname(parsed.hostname)) {
        return NextResponse.json({ error: 'Private/local network URLs are not allowed.' }, { status: 400 });
      }
      articleUrl = parsed.toString();
    } catch {
      return NextResponse.json({ error: 'Invalid article_url.' }, { status: 400 });
    }

    const accountSlot = normalizeAccountSlot(body.account_slot ?? body.accountSlot, 1);
    const maxTweets = Math.max(2, Math.min(12, asIntOr(body.max_tweets ?? body.maxTweets, 6)));
    const includeImages = asBool(body.include_images ?? body.includeImages, true);
    const schedule = asBool(body.schedule, false);
    const dedupe = asBool(body.dedupe, true);

    const article = await fetchAndExtractArticle(articleUrl);
    const downloadedMediaUrls = includeImages
      ? await downloadRemoteImages(article.imageUrls, Math.max(0, maxTweets - 1))
      : [];

    const draft = buildThreadDraft(article, downloadedMediaUrls, maxTweets);

    const baseResponse = {
      ok: true,
      article: {
        url: article.url,
        canonical_url: article.canonicalUrl,
        title: article.title,
        description: article.description,
        quote_candidates: article.quoteCandidates,
        article_image_urls: article.imageUrls,
        downloaded_media_urls: downloadedMediaUrls,
        excerpt: article.excerpt,
      },
      draft: {
        account_slot: accountSlot,
        source_url: draft.source_url,
        tweets: draft.tweets,
      },
    };

    if (!schedule) {
      return NextResponse.json({
        ...baseResponse,
        scheduled: false,
      });
    }

    const scheduledTime = asString(body.scheduled_time ?? body.scheduledTime);
    if (!scheduledTime) {
      return NextResponse.json({ error: 'Missing scheduled_time when schedule=true.' }, { status: 400 });
    }

    const parsedScheduled = new Date(scheduledTime);
    if (Number.isNaN(parsedScheduled.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_time. Provide an ISO date string.' }, { status: 400 });
    }

    try {
      const scheduleResult = await scheduleThread({
        accountSlot,
        scheduledTime: parsedScheduled,
        dedupe,
        communityId: asString(body.community_id ?? body.communityId),
        replyToTweetId: asString(body.reply_to_tweet_id ?? body.replyToTweetId),
        sourceUrl: draft.source_url,
        tweets: draft.tweets,
      });
      return NextResponse.json({
        ...baseResponse,
        scheduled: true,
        schedule_result: scheduleResult,
      });
    } catch (scheduleError) {
      const message = scheduleError instanceof Error ? scheduleError.message : 'Failed to schedule generated thread.';
      return NextResponse.json(
        {
          error: 'Failed to schedule generated thread.',
          details: { error: message },
          ...baseResponse,
          scheduled: false,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error('Error creating thread from article:', error);
    const message = error instanceof Error ? error.message : 'Failed to create thread.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
