'use client';

import { useCallback, useEffect, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { GripVertical, ImageIcon, Smile, Trash2 } from 'lucide-react';
import CharacterCount from './CharacterCount';
import type { TweetItem } from './types';

export default function TweetCard({
  tweet,
  index,
  total,
  onChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragTarget,
}: {
  tweet: TweetItem;
  index: number;
  total: number;
  onChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragEnd: () => void;
  isDragTarget: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 80)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [tweet.text, adjustHeight]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(tweet.id, e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') return;
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, tweet.id)}
      onDragOver={(e) => onDragOver(e, tweet.id)}
      onDrop={(e) => onDrop(e, tweet.id)}
      onDragEnd={onDragEnd}
      className={`
        bg-white dark:bg-slate-800
        border rounded-xl shadow-sm
        transition-all duration-150
        ${
          isDragTarget
            ? 'border-teal-500 dark:border-teal-400 shadow-md ring-2 ring-teal-500/20'
            : 'border-slate-200 dark:border-slate-700'
        }
      `}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <div
          className="cursor-grab active:cursor-grabbing text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 select-none">
          Tweet {index + 1}
        </span>

        <div className="flex-1" />

        {total > 1 && (
          <button
            type="button"
            onClick={() => onDelete(tweet.id)}
            className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            aria-label={`Delete tweet ${index + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="px-4">
        <textarea
          ref={textareaRef}
          value={tweet.text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={index === 0 ? 'Start your thread...' : 'Continue the thread...'}
          className="
            w-full resize-none border-0 bg-transparent
            focus:ring-0 focus:outline-none
            text-slate-900 dark:text-slate-100
            placeholder-slate-400 dark:placeholder-slate-500
            text-[15px] leading-relaxed
            min-h-[80px]
          "
          rows={3}
        />
      </div>

      <div className="px-4 pb-2">
        <CharacterCount text={tweet.text} />
      </div>

      <div className="flex items-center gap-1 px-3 pb-3 border-t border-slate-100 dark:border-slate-700/50 pt-2 mx-1">
        <button
          type="button"
          className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          aria-label="Add emoji"
          title="Emoji"
        >
          <Smile className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          aria-label="Add media"
          title="Media"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
