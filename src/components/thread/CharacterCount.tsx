'use client';

import { useMemo } from 'react';
import { MAX_CHARS, WARN_THRESHOLD, weightedLength } from './text';

export default function CharacterCount({ text }: { text: string }) {
  const count = useMemo(() => weightedLength(text), [text]);
  const pct = Math.min((count / MAX_CHARS) * 100, 100);

  const barColor =
    count > MAX_CHARS
      ? 'bg-red-500'
      : count >= WARN_THRESHOLD
      ? 'bg-yellow-500'
      : 'bg-teal-500';

  const textColor =
    count > MAX_CHARS
      ? 'text-red-500 font-semibold'
      : count >= WARN_THRESHOLD
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
        {count} / {MAX_CHARS}
      </span>
    </div>
  );
}
