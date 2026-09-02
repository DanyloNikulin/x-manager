import { describe, expect, it } from 'vitest';
import { mapMentionsV2, newestTweetId } from '@/lib/mentions-v2';

describe('mapMentionsV2', () => {
  it('maps tweets, resolves authors from includes and finds the replied-to tweet', () => {
    const items = mapMentionsV2({
      data: [
        { id: '10', text: '@LoopedHuman hi', author_id: '7', created_at: '2026-09-02T10:00:00.000Z', referenced_tweets: [{ type: 'replied_to', id: '9' }] },
        { id: '11', text: 'no author info', author_id: '8' },
        { id: '', text: 'dropped: no id' },
        { id: '12', text: '' },
      ],
      includes: { users: [{ id: '7', username: 'alice' }] },
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sourceId: '10', authorUserId: '7', authorUsername: 'alice', inReplyToTweetId: '9', createdAt: '2026-09-02T10:00:00.000Z' });
    expect(items[1]).toMatchObject({ sourceId: '11', authorUserId: '8', authorUsername: null, inReplyToTweetId: null });
  });

  it('tolerates empty and malformed payloads', () => {
    expect(mapMentionsV2(undefined)).toEqual([]);
    expect(mapMentionsV2({ meta: { result_count: 0 } })).toEqual([]);
  });
});

describe('newestTweetId', () => {
  it('compares 64-bit ids as decimal strings', () => {
    expect(newestTweetId(['999', '1000', '99'])).toBe('1000');
    expect(newestTweetId(['2094897731730898963', '2094837325788332081'])).toBe('2094897731730898963');
    expect(newestTweetId([null, 'abc', ''])).toBeNull();
  });
});
