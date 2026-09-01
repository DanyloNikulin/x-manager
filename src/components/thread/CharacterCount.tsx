'use client';

import { useMemo } from 'react';
import { TWITTER_MAX_CHARS, TWITTER_WARN_CHARS, twitterWeightedLength } from '@/lib/twitter-text';

export default function CharacterCount({ text }: { text: string }) {
  const count = useMemo(() => twitterWeightedLength(text), [text]);
  const pct = Math.min((count / TWITTER_MAX_CHARS) * 100, 100);

  const barColor =
    count > TWITTER_MAX_CHARS
      ? 'bg-red-500'
      : count >= TWITTER_WARN_CHARS
      ? 'bg-yellow-500'
      : 'bg-teal-500';

  const textColor =
    count > TWITTER_MAX_CHARS
      ? 'text-red-500 font-semibold'
      : count >= TWITTER_WARN_CHARS
      ? 'text-yellow-500 font-medium'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className={`h-1 rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums whitespace-nowrap ${textColor}`}>
        {count} / {TWITTER_MAX_CHARS}
      </span>
    </div>
  );
}
