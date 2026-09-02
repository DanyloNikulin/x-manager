/**
 * Pure rules for turning inbound mentions into reply tasks. No database import, so the
 * intake decision is unit-testable and the same helpers can be used from the UI.
 */

export const SUBSCRIPTION_AGENT = 'subscription-agent';
export const INBOX_ASSIGNEE_UNASSIGNED = 'unassigned';

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

/** Task details the writer receives. Everything from the mention is untrusted data. */
export function buildReplyTaskDetails(row: InboxMentionRow): Record<string, unknown> {
  return {
    reply_to_tweet_id: row.sourceId,
    reply_kind: 'inbound',
    parent_author: row.authorUsername,
    parent_author_id: row.authorUserId,
    parent_text: row.text,
    parent_url: mentionUrl(row),
    conversation_id: row.conversationId ?? null,
    inbox_id: row.id,
    intake: { source: 'inbox-autopilot' },
  };
}
