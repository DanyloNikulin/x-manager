import { checkPolicy } from './policy';
import { requireConnectedAccount, recordEngagementAction, markInboxReplied } from './engagement-ops';
import { postTweet, sendDirectMessage, likeTweet, repostTweet } from './twitter-api-client';
import { getResolvedXConfig, type ResolvedXConfig } from './x-config';
import type { AccountSlot } from './account-slots';

export type XActionType = 'post' | 'reply' | 'dm' | 'like' | 'repost';

export type EngagementRecordType = 'reply' | 'dm_send' | 'like' | 'repost';

export class XActionError extends Error {
  retryable: boolean;
  result: unknown;

  constructor(message: string, options?: { retryable?: boolean; result?: unknown }) {
    super(message);
    this.name = 'XActionError';
    this.retryable = options?.retryable ?? false;
    this.result = options?.result;
  }
}

export function is429Error(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }
  return false;
}

export function engagementTypeFor(action: XActionType): EngagementRecordType | null {
  switch (action) {
    case 'reply':
      return 'reply';
    case 'dm':
      return 'dm_send';
    case 'like':
      return 'like';
    case 'repost':
      return 'repost';
    default:
      return null;
  }
}

export interface ExecuteXActionInput {
  type: XActionType;
  slot: AccountSlot;
  text?: string;
  targetId?: string | null;
  mediaIds?: string[];
  communityId?: string;
  config?: ResolvedXConfig;
  enforcePolicy?: boolean;
  record?: boolean;
  payload?: unknown;
  inboxId?: number | null;
}

function fail(message: string, options?: { retryable?: boolean; result?: unknown }): never {
  throw new XActionError(message, options);
}

export async function executeXAction(input: ExecuteXActionInput): Promise<unknown> {
  const enforcePolicy = input.enforcePolicy ?? false;
  const record = input.record ?? input.type !== 'post';
  const config = input.config ?? await getResolvedXConfig();
  const engagementType = engagementTypeFor(input.type);

  if (enforcePolicy) {
    const policyAction = input.type === 'post' ? 'post' : input.type;
    const policyResult = await checkPolicy({ slot: input.slot, actionType: policyAction });
    if (!policyResult.allowed) {
      fail(`Policy rejected: ${policyResult.reason}`);
    }
  }

  const account = await requireConnectedAccount(input.slot);

  const recordFailure = async (message: string, result?: unknown) => {
    if (record && engagementType) {
      await recordEngagementAction({
        inboxId: input.inboxId ?? null,
        accountSlot: input.slot,
        actionType: engagementType,
        targetId: input.targetId ?? null,
        payload: input.payload ?? {},
        result,
        status: 'failed',
        errorMessage: message,
      });
    }
  };

  const recordSuccess = async (result: unknown) => {
    if (record && engagementType) {
      await recordEngagementAction({
        inboxId: input.inboxId ?? null,
        accountSlot: input.slot,
        actionType: engagementType,
        targetId: input.targetId ?? null,
        payload: input.payload ?? {},
        result,
        status: 'success',
      });
    }
  };

  try {
    let result: unknown;

    switch (input.type) {
      case 'post':
      case 'reply': {
        const text = input.text?.trim() ?? '';
        if (!text) fail(input.type === 'reply' ? 'Missing reply text.' : 'Missing post text.');
        if (input.type === 'reply' && !input.targetId) fail('Missing target tweet ID for reply.');
        const tweetResult = await postTweet(
          text,
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          input.mediaIds ?? [],
          input.communityId,
          input.targetId || undefined,
          config,
        );
        if (tweetResult.errors?.length) {
          const message = tweetResult.errors.map((entry) => entry.message).join(', ');
          await recordFailure(message, tweetResult);
          fail(message, { result: tweetResult });
        }
        result = tweetResult;
        break;
      }
      case 'dm': {
        const text = input.text?.trim() ?? '';
        const recipient = input.targetId?.trim() ?? '';
        if (!text || !recipient) fail('Missing DM text or recipient user ID.');
        result = await sendDirectMessage(
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          recipient,
          text,
          config,
        );
        break;
      }
      case 'like': {
        const tweetId = input.targetId?.trim() ?? '';
        if (!tweetId) fail('Missing target tweet ID for like.');
        if (!account.twitterUserId) fail('Account missing twitterUserId for like.');
        await likeTweet(
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          account.twitterUserId,
          tweetId,
          config,
        );
        result = { liked: true, tweetId };
        break;
      }
      case 'repost': {
        const tweetId = input.targetId?.trim() ?? '';
        if (!tweetId) fail('Missing target tweet ID for repost.');
        if (!account.twitterUserId) fail('Account missing twitterUserId for repost.');
        await repostTweet(
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          account.twitterUserId,
          tweetId,
          config,
        );
        result = { reposted: true, tweetId };
        break;
      }
      default:
        fail(`Unknown action type: ${input.type as string}`);
    }

    await recordSuccess(result);
    if (input.inboxId && (input.type === 'reply' || input.type === 'dm')) {
      await markInboxReplied(input.inboxId);
    }
    return result;
  } catch (error) {
    if (error instanceof XActionError) throw error;
    const message = error instanceof Error ? error.message : 'X action failed.';
    const retryable = is429Error(error);
    await recordFailure(message);
    fail(retryable ? `Rate limited (429): ${message}` : message, { retryable });
  }
}
