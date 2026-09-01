import { describe, expect, it } from 'vitest';
import { parseTweetSegments, twitterWeightedLength } from '@/lib/twitter-text';

describe('twitter-text', () => {
  it('counts t.co-weighted URLs as 23 characters', () => {
    expect(twitterWeightedLength('hello')).toBe(5);
    expect(twitterWeightedLength('see https://example.com/very/long/path')).toBe(4 + 23);
  });

  it('splits mentions, hashtags, and URLs', () => {
    const segments = parseTweetSegments('hi @you #tag https://x.com');
    expect(segments.map((segment) => `${segment.type}:${segment.value.trim()}`).filter((value) => value.endsWith(':') === false)).toEqual([
      'text:hi',
      'mention:@you',
      'hashtag:#tag',
      'url:https://x.com',
    ]);
  });
});
