import { twitterWeightedLength, TWITTER_MAX_CHARS } from '@/lib/twitter-text';

/**
 * A thread that must wait for a human is stored as one draft; the separator keeps the
 * tweets apart so Drafts → Schedule can rebuild the thread.
 */
export const THREAD_DRAFT_SEPARATOR = '\n\n---\n\n';
export const MAX_THREAD_TWEETS = 25;

export function joinThreadDraft(tweets: string[]): string {
  return tweets.map((tweet) => tweet.trim()).filter(Boolean).join(THREAD_DRAFT_SEPARATOR);
}

export function splitThreadDraft(text: string): string[] {
  return text
    .split(/\n[ \t]*---[ \t]*\n/)
    .map((tweet) => tweet.trim())
    .filter(Boolean);
}

export function isThreadDraftSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && source.includes(':thread:');
}

export function validateThreadTweets(
  input: unknown,
  maxTweets = MAX_THREAD_TWEETS,
): { ok: true; tweets: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'draft.tweets must be an array of strings.' };
  const tweets = input.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  if (tweets.length !== input.length) return { ok: false, error: 'draft.tweets must contain non-empty strings only.' };
  if (tweets.length < 2) return { ok: false, error: 'A thread needs at least two tweets.' };
  if (tweets.length > maxTweets) return { ok: false, error: `A thread may have at most ${maxTweets} tweets.` };
  const tooLong = tweets.findIndex((tweet) => twitterWeightedLength(tweet) > TWITTER_MAX_CHARS);
  if (tooLong >= 0) return { ok: false, error: `Tweet ${tooLong + 1} exceeds ${TWITTER_MAX_CHARS} weighted characters.` };
  return { ok: true, tweets };
}
