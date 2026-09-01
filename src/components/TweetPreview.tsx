'use client';

import { useMemo } from 'react';
import {
  TWITTER_MAX_CHARS,
  TWITTER_WARN_CHARS,
  parseTweetSegments,
  twitterWeightedLength,
} from '@/lib/twitter-text';

interface TweetPreviewProps {
  text: string;
  className?: string;
}

export default function TweetPreview({ text, className = '' }: TweetPreviewProps) {
  const segments = useMemo(() => parseTweetSegments(text), [text]);
  const charCount = useMemo(() => twitterWeightedLength(text), [text]);

  const countColor =
    charCount > TWITTER_MAX_CHARS
      ? 'text-red-500 font-semibold'
      : charCount >= TWITTER_WARN_CHARS
      ? 'text-yellow-500 font-medium'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 ${className}`}>
      <p className="font-sans text-[15px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words min-h-[3rem]">
        {text.length === 0 ? (
          <span className="text-slate-300 dark:text-slate-600 italic">Tweet preview will appear here...</span>
        ) : (
          segments.map((seg, i) => {
            if (seg.type === 'url') {
              return (
                <span key={i} className="text-blue-500 hover:underline cursor-pointer" title={seg.value}>
                  {seg.value}
                </span>
              );
            }
            if (seg.type === 'mention' || seg.type === 'hashtag') {
              return (
                <span key={i} className="text-blue-500 font-medium">
                  {seg.value}
                </span>
              );
            }
            return <span key={i}>{seg.value}</span>;
          })
        )}
      </p>

      <div className="mt-3 flex items-center justify-end border-t border-slate-100 dark:border-slate-700 pt-2">
        <span className={`text-xs tabular-nums ${countColor}`}>
          {charCount} / {TWITTER_MAX_CHARS}
        </span>
      </div>
    </div>
  );
}
