export const MAX_CHARS = 280;
export const WARN_THRESHOLD = 250;
const TCO_LENGTH = 23;
const URL_REGEX = /https?:\/\/[^\s]+/g;

/** Twitter-weighted character count (URLs count as 23 chars). */
export function weightedLength(text: string): number {
  let count = 0;
  let lastIndex = 0;
  const matches = Array.from(text.matchAll(URL_REGEX));

  for (const match of matches) {
    const start = match.index ?? 0;
    count += start - lastIndex;
    count += TCO_LENGTH;
    lastIndex = start + match[0].length;
  }

  count += text.length - lastIndex;
  return count;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Split long text into tweet-sized chunks at sentence boundaries. */
export function autoSplitText(text: string): string[] {
  if (weightedLength(text) <= MAX_CHARS) return [text];

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
    if (weightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current.trim());
      if (weightedLength(sentence) > MAX_CHARS) {
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

/** Fallback: split at word boundaries when no sentence breaks available. */
function splitByWords(text: string): string[] {
  const words = text.split(/\s+/);
  const tweets: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (weightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current);
      current = word;
    }
  }
  if (current) tweets.push(current);

  return tweets;
}
