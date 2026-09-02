/**
 * Shape mapping for X API v2 `GET /2/users/:id/mentions`. Pure, so it can be unit-tested;
 * the signed request itself lives in twitter-api-client.ts.
 */

export type MentionItem = {
  sourceId: string;
  text: string;
  authorUserId: string | null;
  authorUsername: string | null;
  createdAt: string | null;
  inReplyToTweetId: string | null;
  raw: unknown;
};

export type MentionsV2Response = {
  data?: Array<{
    id?: string;
    text?: string;
    author_id?: string;
    created_at?: string;
    conversation_id?: string;
    in_reply_to_user_id?: string;
    referenced_tweets?: Array<{ type?: string; id?: string }>;
  }>;
  includes?: {
    users?: Array<{ id?: string; username?: string; name?: string }>;
  };
  meta?: { result_count?: number; newest_id?: string; oldest_id?: string; next_token?: string };
  errors?: unknown[];
};

export function mapMentionsV2(payload: MentionsV2Response | null | undefined): MentionItem[] {
  const users = new Map<string, string>();
  for (const user of payload?.includes?.users ?? []) {
    if (user?.id && user?.username) users.set(user.id, user.username);
  }
  return (payload?.data ?? [])
    .map((tweet) => {
      const authorUserId = tweet.author_id ?? null;
      const repliedTo = (tweet.referenced_tweets ?? []).find((ref) => ref?.type === 'replied_to' && ref.id);
      return {
        sourceId: tweet.id ?? '',
        text: tweet.text ?? '',
        authorUserId,
        authorUsername: authorUserId ? users.get(authorUserId) ?? null : null,
        createdAt: tweet.created_at ?? null,
        inReplyToTweetId: repliedTo?.id ?? null,
        raw: tweet,
      };
    })
    .filter((item) => item.sourceId && item.text);
}

/** Largest tweet id (as a decimal string) — ids are 64-bit, so compare by length then lexically. */
export function newestTweetId(ids: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d+$/.test(id)) continue;
    if (best === null || id.length > best.length || (id.length === best.length && id > best)) best = id;
  }
  return best;
}
