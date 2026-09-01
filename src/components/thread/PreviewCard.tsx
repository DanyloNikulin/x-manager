'use client';

import { useMemo } from 'react';

export default function PreviewCard({ text, index }: { text: string; index: number }) {
  const segments = useMemo(() => {
    const tokens = text.split(/(\s+)/);
    const result: { type: 'text' | 'url' | 'mention' | 'hashtag'; value: string }[] = [];

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        result.push({ type: 'text', value: token });
      } else if (/^https?:\/\//i.test(token)) {
        result.push({ type: 'url', value: token });
      } else if (/^@\w+/.test(token)) {
        const match = token.match(/^(@\w+)(.*)/s);
        if (match) {
          result.push({ type: 'mention', value: match[1] });
          if (match[2]) result.push({ type: 'text', value: match[2] });
        } else {
          result.push({ type: 'text', value: token });
        }
      } else if (/^#\w+/.test(token)) {
        const match = token.match(/^(#\w+)(.*)/s);
        if (match) {
          result.push({ type: 'hashtag', value: match[1] });
          if (match[2]) result.push({ type: 'text', value: match[2] });
        } else {
          result.push({ type: 'text', value: token });
        }
      } else {
        result.push({ type: 'text', value: token });
      }
    }
    return result;
  }, [text]);

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-slate-300 dark:bg-slate-600 flex-shrink-0" />
        <div className="w-0.5 flex-1 bg-slate-300 dark:bg-slate-600 mt-1" />
      </div>

      <div className="flex-1 pb-4 border-l-2 border-teal-500/40 dark:border-teal-400/40 pl-3 -ml-px">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
            Your Name
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            @handle
          </span>
          <span className="text-slate-400 dark:text-slate-500 text-xs">
            &middot; {index === 0 ? 'now' : `${index}m`}
          </span>
        </div>

        <p className="text-[15px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
          {text.length === 0 ? (
            <span className="text-slate-400 dark:text-slate-500 italic">
              Empty tweet
            </span>
          ) : (
            segments.map((seg, i) => {
              if (seg.type === 'url') {
                return (
                  <span key={i} className="text-blue-500 hover:underline cursor-pointer">
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

        <p className="mt-2 text-sm text-blue-500 dark:text-blue-400 cursor-pointer hover:underline">
          Show this thread
        </p>
      </div>
    </div>
  );
}
