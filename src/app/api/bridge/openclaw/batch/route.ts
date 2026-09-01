import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { getResolvedXConfig } from '@/lib/x-config';
import { uploadMedia } from '@/lib/twitter-api-client';
import { decryptAccountTokens } from '@/lib/x-account-crypto';
import { twitterWeightedLength } from '@/lib/twitter-text';
import { validateTweetUrls } from '@/lib/tweet-url-validator';
import { asBool, asInt, asString, clamp } from '@/lib/http-parse';
import { apiError } from '@/lib/api-error';
import { executeXAction, XActionError } from '@/lib/execute-x-action';
import { normalizeAccountSlot } from '@/lib/account-slots';
import {
  BridgePostBody,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
  DEFAULT_RATE_LIMIT_PER_MIN,
  MAX_MEDIA_ITEMS,
  MAX_TWEET_CHARS,
  checkRateLimit,
  constantTimeTokenMatch,
  getIncomingBridgeToken,
  noStoreJson,
  parseAllowedSlots,
  resolveAccountSlot,
  resolveCommunityId,
  resolveMediaBuffers,
  resolveMediaUrls,
  resolveReplyToTweetId,
  resolveText,
  verifySignedRequest,
} from '@/lib/bridge-openclaw';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BATCH_SIZE = 10;
const MAX_BODY_BYTES = 500_000;

type BatchItemResult = {
  index: number;
  ok: boolean;
  tweet_id?: string;
  text?: string;
  account_slot?: number;
  dry_run?: boolean;
  error?: string;
  code?: string;
};

export async function POST(req: Request) {
  try {
    const configuredToken = asString(process.env.OPENCLAW_BRIDGE_TOKEN);
    if (!configuredToken) {
      return apiError(
        'BRIDGE_NOT_CONFIGURED',
        'Bridge token is not configured. Set OPENCLAW_BRIDGE_TOKEN and restart x-manager.',
      );
    }

    const providedToken = getIncomingBridgeToken(req);
    if (!providedToken || !constantTimeTokenMatch(configuredToken, providedToken)) {
      return apiError('UNAUTHORIZED', 'Unauthorized bridge request.');
    }

    const contentLength = asInt(req.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
      return apiError('VALIDATION_ERROR', 'Request body too large.', { status: 413 });
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return apiError('VALIDATION_ERROR', 'Request body too large.', { status: 413 });
    }

    const signingSecret = asString(process.env.OPENCLAW_BRIDGE_SIGNING_SECRET);
    const requireSignature = asBool(process.env.OPENCLAW_BRIDGE_REQUIRE_SIGNATURE, Boolean(signingSecret));
    if (requireSignature) {
      if (!signingSecret) {
        return apiError('BRIDGE_NOT_CONFIGURED', 'Bridge signing secret is required but not configured.');
      }
      const maxClockSkewSeconds = clamp(
        asInt(process.env.OPENCLAW_BRIDGE_MAX_CLOCK_SKEW_SECONDS) || DEFAULT_MAX_CLOCK_SKEW_SECONDS,
        30,
        3600,
      );
      const verification = verifySignedRequest(req, rawBody, signingSecret, maxClockSkewSeconds);
      if (!verification.ok) {
        return apiError('UNAUTHORIZED', verification.error || 'Invalid request signature.');
      }
    }

    let body: Record<string, unknown>;
    try {
      body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
    } catch {
      return apiError('VALIDATION_ERROR', 'Invalid JSON request body.');
    }

    const posts = body.posts;
    if (!Array.isArray(posts)) {
      return apiError('VALIDATION_ERROR', 'Missing or invalid "posts" array in request body.');
    }
    if (posts.length === 0) {
      return apiError('VALIDATION_ERROR', 'The "posts" array must not be empty.');
    }
    if (posts.length > MAX_BATCH_SIZE) {
      return apiError('VALIDATION_ERROR', `Batch size ${posts.length} exceeds maximum of ${MAX_BATCH_SIZE}.`);
    }

    const globalDryRun = asBool(body.dryRun ?? body.dry_run ?? body.simulate, false);
    const rateLimitPerMinute = clamp(
      asInt(process.env.OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN) || DEFAULT_RATE_LIMIT_PER_MIN,
      1,
      600,
    );
    const rate = checkRateLimit(req, configuredToken, rateLimitPerMinute, posts.length);
    if (!rate.ok) {
      return apiError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded for bridge requests.', {
        retryAfter: rate.retryAfter,
      });
    }

    const allowedSlots = parseAllowedSlots(process.env.OPENCLAW_BRIDGE_ALLOWED_SLOTS);
    const config = globalDryRun ? null : await getResolvedXConfig();
    const accountCache = new Map<number, { twitterAccessToken: string; twitterAccessTokenSecret: string } | null>();

    async function getAccount(slot: number) {
      if (accountCache.has(slot)) return accountCache.get(slot)!;
      const rows = await db.select().from(xAccounts).where(eq(xAccounts.slot, slot)).limit(1);
      const raw = rows[0] ? decryptAccountTokens(rows[0]) : null;
      const result =
        raw?.twitterAccessToken && raw?.twitterAccessTokenSecret
          ? { twitterAccessToken: raw.twitterAccessToken, twitterAccessTokenSecret: raw.twitterAccessTokenSecret }
          : null;
      accountCache.set(slot, result);
      return result;
    }

    const results: BatchItemResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!post || typeof post !== 'object' || Array.isArray(post)) {
        results.push({ index: i, ok: false, error: 'Post entry must be a JSON object.', code: 'VALIDATION_ERROR' });
        failed++;
        continue;
      }

      const postObj = post as BridgePostBody;

      try {
        const accountSlot = await resolveAccountSlot(postObj);
        if (!allowedSlots.has(accountSlot)) {
          results.push({ index: i, ok: false, error: 'Account slot is not allowed for bridge posting.', code: 'POLICY_REJECTED' });
          failed++;
          continue;
        }

        const text = resolveText(postObj);
        if (!text) {
          results.push({ index: i, ok: false, error: 'Missing text. Provide text/content/message/tweet_text.', code: 'VALIDATION_ERROR' });
          failed++;
          continue;
        }
        if (twitterWeightedLength(text) > MAX_TWEET_CHARS) {
          results.push({ index: i, ok: false, error: `Tweet text exceeds ${MAX_TWEET_CHARS} characters (Twitter-weighted).`, code: 'VALIDATION_ERROR' });
          failed++;
          continue;
        }

        try {
          await validateTweetUrls(text);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tweet contains broken URLs.';
          results.push({ index: i, ok: false, error: message, code: 'VALIDATION_ERROR' });
          failed++;
          continue;
        }

        const communityId = resolveCommunityId(postObj);
        const replyToTweetId = resolveReplyToTweetId(postObj);
        const itemDryRun = globalDryRun || asBool(postObj.dry_run ?? postObj.dryRun ?? postObj.simulate, false);
        const mediaUrls = resolveMediaUrls(postObj);
        if (mediaUrls.length > MAX_MEDIA_ITEMS) {
          results.push({ index: i, ok: false, error: `Too many media URLs. Maximum ${MAX_MEDIA_ITEMS} attachments are supported.`, code: 'VALIDATION_ERROR' });
          failed++;
          continue;
        }

        if (itemDryRun) {
          results.push({ index: i, ok: true, dry_run: true, account_slot: accountSlot, text });
          succeeded++;
          continue;
        }

        const account = await getAccount(accountSlot);
        if (!account) {
          results.push({ index: i, ok: false, error: `Account slot ${accountSlot} is not connected.`, code: 'ACCOUNT_NOT_CONNECTED' });
          failed++;
          continue;
        }

        let mediaBuffers: Buffer[] = [];
        try {
          mediaBuffers = await resolveMediaBuffers(mediaUrls);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid media URL.';
          results.push({ index: i, ok: false, error: message, code: 'MEDIA_UPLOAD_FAILED' });
          failed++;
          continue;
        }

        const mediaIds: string[] = [];
        let mediaFailed = false;
        for (let mi = 0; mi < mediaBuffers.length; mi++) {
          const uploadResult = await uploadMedia(
            mediaBuffers[mi],
            account.twitterAccessToken,
            account.twitterAccessTokenSecret,
            config!,
          );
          if (!uploadResult?.media_id_string) {
            results.push({ index: i, ok: false, error: `Failed to upload media at index ${mi}.`, code: 'MEDIA_UPLOAD_FAILED' });
            failed++;
            mediaFailed = true;
            break;
          }
          mediaIds.push(uploadResult.media_id_string);
        }
        if (mediaFailed) continue;

        const postResult = await executeXAction({
          type: replyToTweetId ? 'reply' : 'post',
          slot: normalizeAccountSlot(accountSlot, 1),
          text,
          targetId: replyToTweetId,
          mediaIds,
          communityId,
          config: config!,
          record: false,
        }) as { data?: { id?: string; text?: string } };

        if (!postResult.data?.id) {
          results.push({ index: i, ok: false, error: 'X API returned an unexpected response.', code: 'X_API_ERROR' });
          failed++;
          continue;
        }

        results.push({
          index: i,
          ok: true,
          tweet_id: postResult.data.id,
          text: postResult.data.text || text,
          account_slot: accountSlot,
        });
        succeeded++;
      } catch (error) {
        const message = error instanceof XActionError ? error.message : error instanceof Error ? error.message : 'Unexpected error processing post.';
        results.push({ index: i, ok: false, error: message, code: error instanceof XActionError ? 'X_API_ERROR' : 'INTERNAL_ERROR' });
        failed++;
      }
    }

    return noStoreJson({
      ok: failed === 0,
      results,
      summary: { total: posts.length, succeeded, failed },
    });
  } catch (error) {
    console.error('Error in batch bridge endpoint:', error);
    return apiError('INTERNAL_ERROR', 'Failed to process batch bridge request.');
  }
}
