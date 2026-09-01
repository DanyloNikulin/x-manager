import { TWITTER_MAX_CHARS, twitterWeightedLength } from '@/lib/twitter-text';

export const MAX_CHARS = TWITTER_MAX_CHARS;
export const WARN_THRESHOLD = 260;
export { twitterWeightedLength as weightedLength };

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Split long text into tweet-sized chunks at sentence boundaries. */
export function autoSplitText(text: string): string[] {
  if (twitterWeightedLength(text) <= MAX_CHARS) return [text];

  const sentenceBreaks = /(?<=[.!?])\s+/g;
  const sentences: string[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(sentenceBreaks)) {
    const idx = (match.index ?? 0) + match[0].length;
    sentences.push(text.slice(lastIdx, idx).trim());
    lastIdx = idx;
  }
  const remainder = text.slice(lastIdx).trim();
  if (remainder) sentences.push(remainder);

  if (sentences.length <= 1) {
    return splitByWords(text);
  }

  const tweets: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (twitterWeightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current.trim());
      if (twitterWeightedLength(sentence) > MAX_CHARS) {
        const wordChunks = splitByWords(sentence);
        tweets.push(...wordChunks.slice(0, -1));
        current = wordChunks[wordChunks.length - 1] || '';
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim()) tweets.push(current.trim());

  return tweets.length > 0 ? tweets : [text];
}

function splitByWords(text: string): string[] {
  const words = text.split(/\s+/);
  const tweets: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (twitterWeightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current);
      current = word;
    }
  }
  if (current) tweets.push(current);

  return tweets;
}
