import { describe, expect, it } from 'vitest';
import { isThreadDraftSource, joinThreadDraft, splitThreadDraft, validateThreadTweets } from '@/lib/thread-draft';

describe('thread drafts', () => {
  it('round-trips a thread through the draft text', () => {
    const tweets = ['First tweet.', 'Second tweet\nwith a line break.', 'Third: https://example.com/x'];
    expect(splitThreadDraft(joinThreadDraft(tweets))).toEqual(tweets);
  });

  it('recognises worker thread sources', () => {
    expect(isThreadDraftSource('subscription-worker:needs_review:thread:task:9')).toBe(true);
    expect(isThreadDraftSource('subscription-worker:drafted:task:9')).toBe(false);
    expect(isThreadDraftSource(null)).toBe(false);
  });

  it('validates tweet arrays', () => {
    expect(validateThreadTweets(['a', 'b']).ok).toBe(true);
    expect(validateThreadTweets(['only one']).ok).toBe(false);
    expect(validateThreadTweets(['a', '']).ok).toBe(false);
    expect(validateThreadTweets('nope').ok).toBe(false);
    expect(validateThreadTweets(['a', 'x'.repeat(300)]).ok).toBe(false);
    expect(validateThreadTweets(Array.from({ length: 26 }, (_, i) => `t${i}`)).ok).toBe(false);
  });
});
