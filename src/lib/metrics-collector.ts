import crypto from 'crypto';
import { and, eq, gte, isNotNull, desc } from 'drizzle-orm';
import { db } from './db';
import { scheduledPosts, postMetrics, xAccounts } from './db/schema';
import { getResolvedXConfig, type ResolvedXConfig } from './x-config';
import { decryptAccountTokens } from './x-account-crypto';
import { logger, type Logger } from './logger';
import { createOwnerId, withLease } from './scheduler-lock';
import { startIntervalLoop } from './interval-loop';

type MetricsLogger = Logger;

const defaultLogger: MetricsLogger = logger('metrics-collector');

const metricsOwnerId = createOwnerId();
const metricsLockKey = 'metrics-collector';

async function getConnectedAccounts() {
  const rows = await db.select().from(xAccounts);
  return rows
    .map((account) => decryptAccountTokens(account))
    .filter((account) => Boolean(account.twitterAccessToken && account.twitterAccessTokenSecret));
}

async function getPostedTweets() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // S1 fix: Limit to 200 most recent to prevent unbounded fetch as post count grows
  return db
    .select({
      id: scheduledPosts.id,
      twitterPostId: scheduledPosts.twitterPostId,
      accountSlot: scheduledPosts.accountSlot,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, 'posted'),
        isNotNull(scheduledPosts.twitterPostId),
        gte(scheduledPosts.scheduledTime, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(scheduledPosts.scheduledTime))
    .limit(200);
}

export async function fetchTweetMetrics(
  ids: string[],
  accessToken: string,
  accessTokenSecret: string,
  config: ResolvedXConfig,
): Promise<Record<string, { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number }>> {
  if (ids.length === 0) return {};

  const OAuth = (await import('oauth-1.0a')).default;

  // S13 fix: Use Node crypto instead of unmaintained crypto-js
  const oauth = new OAuth({
    consumer: { key: config.xApiKey, secret: config.xApiSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return crypto.createHmac('sha1', key).update(base_string).digest('base64');
    },
  });

  const results: Record<string, { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number }> = {};

  // Batch in chunks of 100 (X API limit)
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = `${config.xApiBaseUrl}/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics`;

    const token = { key: accessToken, secret: accessTokenSecret };
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, token));

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: authHeader.Authorization,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        continue;
      }

      const body = await response.json() as {
        data?: Array<{
          id: string;
          public_metrics?: {
            impression_count?: number;
            like_count?: number;
            retweet_count?: number;
            reply_count?: number;
            quote_count?: number;
            bookmark_count?: number;
          };
        }>;
      };

      if (body.data) {
        for (const tweet of body.data) {
          const m = tweet.public_metrics;
          if (m) {
            results[tweet.id] = {
              impressions: m.impression_count ?? 0,
              likes: m.like_count ?? 0,
              retweets: m.retweet_count ?? 0,
              replies: m.reply_count ?? 0,
              quotes: m.quote_count ?? 0,
              bookmarks: m.bookmark_count ?? 0,
            };
          }
        }
      }
    } catch {
      // Continue with next batch on failure
    }
  }

  return results;
}

export async function runMetricsCollectionCycle(logger: MetricsLogger = defaultLogger): Promise<{ collected: number }> {
  const leaseSeconds = 120;

  return withLease(
    {
      lockKey: metricsLockKey,
      ownerId: metricsOwnerId,
      leaseSeconds,
      onSkip: () => ({ collected: 0 }),
    },
    async (): Promise<{ collected: number }> => {
      try {
    const config = await getResolvedXConfig();
    const accounts = await getConnectedAccounts();
    if (accounts.length === 0) return { collected: 0 };

    const postedTweets = await getPostedTweets();
    if (postedTweets.length === 0) return { collected: 0 };

    // Group by account slot
    const bySlot = new Map<number, typeof postedTweets>();
    for (const tweet of postedTweets) {
      const slot = tweet.accountSlot;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot)!.push(tweet);
    }

    let collected = 0;

    for (const account of accounts) {
      const tweets = bySlot.get(account.slot) || [];
      if (tweets.length === 0) continue;

      const tweetIds = tweets
        .map((t) => t.twitterPostId)
        .filter((id): id is string => Boolean(id));

      if (tweetIds.length === 0) continue;

      const metrics = await fetchTweetMetrics(
        tweetIds,
        account.twitterAccessToken!,
        account.twitterAccessTokenSecret!,
        config,
      );

      for (const tweet of tweets) {
        const m = metrics[tweet.twitterPostId!];
        if (!m) continue;

        await db.insert(postMetrics).values({
          scheduledPostId: tweet.id,
          twitterPostId: tweet.twitterPostId!,
          accountSlot: account.slot,
          impressions: m.impressions,
          likes: m.likes,
          retweets: m.retweets,
          replies: m.replies,
          quotes: m.quotes,
          bookmarks: m.bookmarks,
        });
        collected++;
      }
    }

    if (collected > 0) {
      logger.info(`Collected metrics for ${collected} tweets.`);
    }

    return { collected };
      } catch (error) {
        logger.error('Metrics collection cycle failed:', error);
        return { collected: 0 };
      }
    },
  );
}

export function startMetricsCollectorLoop(intervalSeconds = 900): () => void {
  return startIntervalLoop({
    key: 'metrics-collector',
    intervalSeconds,
    runOnStart: false,
    unref: true,
    run: async () => {
      await runMetricsCollectionCycle();
    },
    onError: (error) => {
      defaultLogger.error('Cycle error', error instanceof Error ? error : undefined);
    },
    logger: defaultLogger,
  });
}
