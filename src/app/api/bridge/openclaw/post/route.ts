import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { getResolvedXConfig } from '@/lib/x-config';
import { uploadMedia } from '@/lib/twitter-api-client';
import { decryptAccountTokens } from '@/lib/x-account-crypto';
import { twitterWeightedLength } from '@/lib/twitter-text';
import { validateTweetUrls } from '@/lib/tweet-url-validator';
import { asBool, asInt, asString, clamp } from '@/lib/http-parse';
import { executeXAction, XActionError } from '@/lib/execute-x-action';
import { normalizeAccountSlot } from '@/lib/account-slots';
import {
  BridgePostBody,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
  DEFAULT_RATE_LIMIT_PER_MIN,
  MAX_BODY_BYTES,
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

export async function POST(req: Request) {
  try {
    const configuredToken = asString(process.env.OPENCLAW_BRIDGE_TOKEN);
    if (!configuredToken) {
      return noStoreJson(
        { error: 'Bridge token is not configured. Set OPENCLAW_BRIDGE_TOKEN and restart x-manager.' },
        503,
      );
    }

    const providedToken = getIncomingBridgeToken(req);
    if (!providedToken || !constantTimeTokenMatch(configuredToken, providedToken)) {
      return noStoreJson({ error: 'Unauthorized bridge request.' }, 401);
    }

    const rateLimitPerMinute = clamp(
      asInt(process.env.OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN) || DEFAULT_RATE_LIMIT_PER_MIN,
      1,
      600,
    );
    const rate = checkRateLimit(req, configuredToken, rateLimitPerMinute);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for bridge requests.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rate.retryAfter) } },
      );
    }

    const contentLength = asInt(req.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
      return noStoreJson({ error: 'Request body too large.' }, 413);
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return noStoreJson({ error: 'Request body too large.' }, 413);
    }

    const signingSecret = asString(process.env.OPENCLAW_BRIDGE_SIGNING_SECRET);
    const requireSignature = asBool(process.env.OPENCLAW_BRIDGE_REQUIRE_SIGNATURE, Boolean(signingSecret));
    if (requireSignature) {
      if (!signingSecret) {
        return noStoreJson({ error: 'Bridge signing secret is required but not configured.' }, 503);
      }
      const maxClockSkewSeconds = clamp(
        asInt(process.env.OPENCLAW_BRIDGE_MAX_CLOCK_SKEW_SECONDS) || DEFAULT_MAX_CLOCK_SKEW_SECONDS,
        30,
        3600,
      );
      const verification = verifySignedRequest(req, rawBody, signingSecret, maxClockSkewSeconds);
      if (!verification.ok) {
        return noStoreJson({ error: verification.error || 'Invalid request signature.' }, 401);
      }
    }

    let body: BridgePostBody = {};
    try {
      body = (rawBody ? JSON.parse(rawBody) : {}) as BridgePostBody;
    } catch {
      return noStoreJson({ error: 'Invalid JSON request body.' }, 400);
    }

    const text = resolveText(body);
    if (!text) {
      return noStoreJson({ error: 'Missing text. Provide text/content/message/tweet_text.' }, 400);
    }
    if (twitterWeightedLength(text) > MAX_TWEET_CHARS) {
      return noStoreJson({ error: `Tweet text exceeds ${MAX_TWEET_CHARS} characters (Twitter-weighted).` }, 400);
    }

    try {
      await validateTweetUrls(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tweet contains broken URLs.';
      return noStoreJson({ error: message }, 422);
    }

    let accountSlot = 1;
    try {
      accountSlot = await resolveAccountSlot(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid account selector.';
      return noStoreJson({ error: message }, 400);
    }

    const allowedSlots = parseAllowedSlots(process.env.OPENCLAW_BRIDGE_ALLOWED_SLOTS);
    if (!allowedSlots.has(accountSlot)) {
      return noStoreJson({ error: 'Account slot is not allowed for bridge posting.' }, 403);
    }

    const communityId = resolveCommunityId(body);
    const replyToTweetId = resolveReplyToTweetId(body);
    const dryRun = asBool(body.dry_run ?? body.dryRun ?? body.simulate, false);
    const mediaUrlValues = resolveMediaUrls(body);
    if (mediaUrlValues.length > MAX_MEDIA_ITEMS) {
      return noStoreJson(
        { error: `Too many media URLs. Maximum ${MAX_MEDIA_ITEMS} attachments are supported.` },
        400,
      );
    }
    const mediaUrls = mediaUrlValues.slice(0, MAX_MEDIA_ITEMS);

    if (dryRun) {
      return noStoreJson({
        ok: true,
        dry_run: true,
        post: {
          account_slot: accountSlot,
          account_hint: asString(body.account) || asString(body.handle) || asString(body.username) || null,
          text,
          media_urls: mediaUrls,
          community_id: communityId || null,
          reply_to_tweet_id: replyToTweetId || null,
        },
      });
    }

    const accountRows = await db.select().from(xAccounts).where(eq(xAccounts.slot, accountSlot)).limit(1);
    const account = accountRows[0] ? decryptAccountTokens(accountRows[0]) : null;
    if (!account?.twitterAccessToken || !account?.twitterAccessTokenSecret) {
      return noStoreJson({ error: `Account slot ${accountSlot} is not connected.` }, 400);
    }

    const config = await getResolvedXConfig();
    let mediaBuffers: Buffer[] = [];
    try {
      mediaBuffers = await resolveMediaBuffers(mediaUrls);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid media URL.';
      return noStoreJson({ error: message }, 400);
    }

    const mediaIds: string[] = [];
    for (let index = 0; index < mediaBuffers.length; index += 1) {
      const uploadResult = await uploadMedia(
        mediaBuffers[index],
        account.twitterAccessToken,
        account.twitterAccessTokenSecret,
        config,
      );
      if (!uploadResult?.media_id_string) {
        return noStoreJson({ error: `Failed to upload media at index ${index}.` }, 502);
      }
      mediaIds.push(uploadResult.media_id_string);
    }

    try {
      const postResult = await executeXAction({
        type: replyToTweetId ? 'reply' : 'post',
        slot: normalizeAccountSlot(accountSlot, 1),
        text,
        targetId: replyToTweetId,
        mediaIds,
        communityId,
        config,
        record: false,
      }) as { data?: { id?: string; text?: string }; errors?: Array<{ message: string }> };

      if (!postResult.data?.id) {
        return noStoreJson({ error: 'X API returned an unexpected response for bridge post.' }, 502);
      }

      return noStoreJson({
        ok: true,
        account_slot: accountSlot,
        tweet_id: postResult.data.id,
        text: postResult.data.text || text,
      });
    } catch (error) {
      if (error instanceof XActionError) {
        const details = Array.isArray((error.result as { errors?: Array<{ message: string }> } | undefined)?.errors)
          ? (error.result as { errors: Array<{ message: string }> }).errors.map((entry) => entry.message)
          : [error.message];
        return noStoreJson({ error: 'X API rejected bridge post.', details }, 502);
      }
      throw error;
    }
  } catch (error) {
    console.error('Error posting via OpenClaw bridge:', error);
    return noStoreJson({ error: 'Failed to post via bridge.' }, 500);
  }
}
