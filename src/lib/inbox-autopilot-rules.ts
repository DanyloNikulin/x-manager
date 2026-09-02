/**
 * Pure rules for turning inbound mentions into reply tasks. No database import, so the
 * intake decision is unit-testable and the same helpers can be used from the UI.
 */

export const SUBSCRIPTION_AGENT = 'subscription-agent';
export const INBOX_ASSIGNEE_UNASSIGNED = 'unassigned';
/** Assignee marking a mention the depth cap kept out of the reply queue (a human may still answer). */
export const INBOX_ASSIGNEE_DEPTH_CAP = 'depth-cap';

/** One of our published posts, keyed by its tweet id; `replyToTweetId` is set when it was itself a reply. */
export type OwnPostLink = { replyToTweetId: string | null };
/** A stored mention, keyed by its tweet id; `inReplyToTweetId` is the tweet it answered. */
export type MentionLink = { inReplyToTweetId: string | null };

/**
 * How many replies this account already sent in the chain that leads to `mention`.
 *
 * Walks up from the tweet the mention answers: if that is one of our replies, count it and
 * continue from the mention it answered; stop at our original post, at anything that is
 * not ours, or at an unknown tweet. Depth 0 means the person is answering an original post
 * of ours (or something we do not know), depth 1 means we replied once already, and so on.
 */
export function conversationDepth(
  mention: MentionLink,
  ownPosts: ReadonlyMap<string, OwnPostLink>,
  mentions: ReadonlyMap<string, MentionLink>,
  maxSteps = 20,
): number {
  let depth = 0;
  let cursor = mention.inReplyToTweetId;
  for (let step = 0; cursor && step < maxSteps; step += 1) {
    const own = ownPosts.get(cursor);
    if (!own || !own.replyToTweetId) break;
    depth += 1;
    const answered = mentions.get(own.replyToTweetId);
    if (!answered) break;
    cursor = answered.inReplyToTweetId;
  }
  return depth;
}

/** True when the intake must leave this mention alone because the chain is already `cap` replies deep. */
export function exceedsDepthCap(depth: number, cap: number): boolean {
  return depth >= Math.max(1, cap);
}

export type InboxMentionRow = {
  id: number;
  accountSlot: number;
  sourceType: string;
  sourceId: string;
  conversationId?: string | null;
  authorUserId: string | null;
  authorUsername: string | null;
  text: string;
  status: string;
  assignedTo: string | null;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A mention becomes a reply task only once, only for real inbound posts by other people. */
export function shouldCreateReplyTask(row: InboxMentionRow, ownUserId: string | null): boolean {
  if (row.sourceType !== 'mention') return false;
  if (row.status !== 'new') return false;
  if ((row.assignedTo ?? INBOX_ASSIGNEE_UNASSIGNED) !== INBOX_ASSIGNEE_UNASSIGNED) return false;
  if (!row.sourceId || !row.sourceId.trim()) return false;
  const text = collapse(row.text ?? '');
  if (!text) return false;
  if (/^RT @/i.test(text)) return false;
  if (ownUserId && row.authorUserId && row.authorUserId === ownUserId) return false;
  return true;
}

export function mentionUrl(row: Pick<InboxMentionRow, 'authorUsername' | 'sourceId'>): string {
  const handle = row.authorUsername && /^[A-Za-z0-9_]{1,15}$/.test(row.authorUsername) ? row.authorUsername : 'i';
  return `https://x.com/${handle}/status/${row.sourceId}`;
}

export function replyTaskTitle(row: InboxMentionRow): string {
  const who = row.authorUsername ? `@${row.authorUsername}` : (row.authorUserId ? `user ${row.authorUserId}` : 'someone');
  const head = collapse(row.text).slice(0, 80);
  return `Reply to ${who}: ${head}`;
}

/**
 * Task details the writer receives. Everything from the mention is untrusted data.
 * `exchange_depth` is how many replies we already sent in this chain (trusted, computed here).
 */
export function buildReplyTaskDetails(row: InboxMentionRow, exchangeDepth = 0): Record<string, unknown> {
  return {
    reply_to_tweet_id: row.sourceId,
    reply_kind: 'inbound',
    parent_author: row.authorUsername,
    parent_author_id: row.authorUserId,
    parent_text: row.text,
    parent_url: mentionUrl(row),
    conversation_id: row.conversationId ?? null,
    exchange_depth: exchangeDepth,
    inbox_id: row.id,
    intake: { source: 'inbox-autopilot' },
  };
}
