import { describe, expect, it } from 'vitest';
import {
  buildReplyTaskDetails,
  conversationDepth,
  exceedsDepthCap,
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

describe('conversationDepth', () => {
  // our original post P0 <- their mention M1 <- our reply R1 <- their mention M2 <- our reply R2 <- their mention M3
  const ownPosts = new Map([
    ['P0', { replyToTweetId: null }],
    ['R1', { replyToTweetId: 'M1' }],
    ['R2', { replyToTweetId: 'M2' }],
  ]);
  const mentions = new Map([
    ['M1', { inReplyToTweetId: 'P0' }],
    ['M2', { inReplyToTweetId: 'R1' }],
    ['M3', { inReplyToTweetId: 'R2' }],
  ]);

  it('counts our replies in the chain that leads to the mention', () => {
    expect(conversationDepth({ inReplyToTweetId: 'P0' }, ownPosts, mentions)).toBe(0);
    expect(conversationDepth({ inReplyToTweetId: 'R1' }, ownPosts, mentions)).toBe(1);
    expect(conversationDepth({ inReplyToTweetId: 'R2' }, ownPosts, mentions)).toBe(2);
  });

  it('is zero for a mention of something that is not ours or unknown', () => {
    expect(conversationDepth({ inReplyToTweetId: null }, ownPosts, mentions)).toBe(0);
    expect(conversationDepth({ inReplyToTweetId: 'someone-else' }, ownPosts, mentions)).toBe(0);
  });

  it('stops at an unknown link and never loops', () => {
    const looped = new Map([['R', { replyToTweetId: 'M' }]]);
    const loopedMentions = new Map([['M', { inReplyToTweetId: 'R' }]]);
    expect(conversationDepth({ inReplyToTweetId: 'R' }, looped, loopedMentions, 5)).toBe(5);
  });

  it('applies the cap as "this many of our replies already"', () => {
    expect(exceedsDepthCap(0, 2)).toBe(false);
    expect(exceedsDepthCap(1, 2)).toBe(false);
    expect(exceedsDepthCap(2, 2)).toBe(true);
    expect(exceedsDepthCap(0, 0)).toBe(false); // a cap below 1 behaves as 1
    expect(exceedsDepthCap(1, 0)).toBe(true);
  });

  it('records the depth in the task details', () => {
    expect(buildReplyTaskDetails(base, 1)).toMatchObject({ exchange_depth: 1 });
    expect(buildReplyTaskDetails(base)).toMatchObject({ exchange_depth: 0 });
  });
});
