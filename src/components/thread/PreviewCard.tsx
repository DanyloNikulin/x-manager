'use client';

import { useMemo } from 'react';
import { BarChart2, Heart, MessageCircle, Repeat2, Share } from 'lucide-react';
import { parseTweetSegments } from '@/lib/twitter-text';
import type { PreviewAccount } from './types';

function initials(name: string) {
  return (name.trim()[0] || 'X').toUpperCase();
}

export default function PreviewCard({
  text,
  index,
  total,
  account,
  mediaUrls,
}: {
  text: string;
  index: number;
  total: number;
  account?: PreviewAccount;
  mediaUrls?: string[];
}) {
  const segments = useMemo(() => parseTweetSegments(text), [text]);
  const displayName = account?.displayName || account?.username || 'You';
  const handle = account?.username ? `@${account.username}` : '@handle';
  const isLast = index === total - 1;
  const timestamp = index === 0 ? 'now' : `${index}m`;

  return (
    <article className="flex gap-3">
      <div className="flex flex-col items-center">
        {account?.avatarUrl ? (
          <img
            src={account.avatarUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover bg-slate-300 dark:bg-slate-600"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">
            {initials(displayName)}
          </div>
        )}
        {!isLast && <div className="mt-1 w-0.5 flex-1 min-h-[20px] bg-slate-300 dark:bg-slate-600" />}
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-5'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[15px] font-bold text-slate-900 dark:text-slate-100">
            {displayName}
          </span>
          <span className="truncate text-[15px] text-slate-500 dark:text-slate-400">{handle}</span>
          <span className="shrink-0 text-slate-400 dark:text-slate-500">·</span>
          <span className="shrink-0 text-[13px] text-slate-500 dark:text-slate-400">{timestamp}</span>
        </div>

        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5 text-slate-900 dark:text-slate-100">
          {text.length === 0 ? (
            <span className="italic text-slate-400 dark:text-slate-500">Empty post</span>
          ) : (
            segments.map((seg, i) => {
              if (seg.type === 'url' || seg.type === 'mention' || seg.type === 'hashtag') {
                return (
                  <span key={i} className="text-[#1d9bf0]">
                    {seg.value}
                  </span>
                );
              }
              return <span key={i}>{seg.value}</span>;
            })
          )}
        </p>

        {mediaUrls && mediaUrls.length > 0 && (
          <div className={`mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 ${
            mediaUrls.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'
          }`}>
            {mediaUrls.slice(0, 4).map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="max-h-64 w-full object-cover bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        )}

        {total > 1 && index === 0 && (
          <p className="mt-1 text-[13px] text-[#1d9bf0]">Show this thread</p>
        )}

        <div className="mt-3 flex max-w-sm items-center justify-between text-slate-500 dark:text-slate-400">
          <MessageCircle size={16} />
          <Repeat2 size={16} />
          <Heart size={16} />
          <BarChart2 size={16} />
          <Share size={16} />
        </div>
      </div>
    </article>
  );
}
