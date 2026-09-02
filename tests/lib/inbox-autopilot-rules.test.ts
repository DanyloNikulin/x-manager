import { describe, expect, it } from 'vitest';
import {
  buildReplyTaskDetails,
  mentionUrl,
  replyTaskTitle,
  shouldCreateReplyTask,
  type InboxMentionRow,
} from '@/lib/inbox-autopilot-rules';

const base: InboxMentionRow = {
  id: 7,
  accountSlot: 1,
  sourceType: 'mention',
  sourceId: '123456',
  conversationId: null,
  authorUserId: '42',
  authorUsername: 'someone',
  text: 'hey @LoopedHuman what do you make of this?',
  status: 'new',
  assignedTo: 'unassigned',
};

describe('shouldCreateReplyTask', () => {
  it('accepts a fresh inbound mention from another user', () => {
    expect(shouldCreateReplyTask(base, '999')).toBe(true);
    expect(shouldCreateReplyTask(base, null)).toBe(true);
  });

  it('never replies to itself, retweets, handled or non-mention items', () => {
    expect(shouldCreateReplyTask({ ...base, authorUserId: '999' }, '999')).toBe(false);
    expect(shouldCreateReplyTask({ ...base, text: 'RT @x: something' }, null)).toBe(false);
    expect(shouldCreateReplyTask({ ...base, assignedTo: 'subscription-agent' }, null)).toBe(false);
    expect(shouldCreateReplyTask({ ...base, status: 'replied' }, null)).toBe(false);
    expect(shouldCreateReplyTask({ ...base, sourceType: 'dm' }, null)).toBe(false);
    expect(shouldCreateReplyTask({ ...base, text: '   ' }, null)).toBe(false);
  });
});

describe('reply task shape', () => {
  it('links to the mention and marks it inbound', () => {
    expect(mentionUrl(base)).toBe('https://x.com/someone/status/123456');
    expect(mentionUrl({ ...base, authorUsername: null })).toBe('https://x.com/i/status/123456');
    expect(replyTaskTitle(base)).toBe('Reply to @someone: hey @LoopedHuman what do you make of this?');
    const details = buildReplyTaskDetails(base);
    expect(details).toMatchObject({ reply_to_tweet_id: '123456', reply_kind: 'inbound', parent_author: 'someone', inbox_id: 7 });
  });
});
