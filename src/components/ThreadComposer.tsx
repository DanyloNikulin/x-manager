'use client';

import { useState, useCallback, useRef, useMemo, type DragEvent, type ChangeEvent } from 'react';
import { Plus, Eye, EyeOff, Scissors, Send, Loader2, Clock } from 'lucide-react';
import ConnectingLine from './thread/ConnectingLine';
import TweetCard from './thread/TweetCard';
import PreviewCard from './thread/PreviewCard';
import { MAX_CHARS, autoSplitText, generateId, weightedLength } from './thread/text';
import type { ThreadComposerProps, TweetItem } from './thread/types';
import { defaultFutureDateTime, parseDateTimeInput } from './scheduler/datetime';

export type { ThreadComposerProps };

function seedTweets(
  initialItems?: Array<{ text: string; mediaUrls?: string[] }>,
  initialTweets?: string[],
): TweetItem[] {
  if (initialItems && initialItems.length > 0) {
    return initialItems.map((item) => ({
      id: generateId(),
      text: item.text,
      mediaUrls: item.mediaUrls,
    }));
  }
  const texts = initialTweets && initialTweets.length > 0 ? initialTweets : [''];
  return texts.map((text) => ({ id: generateId(), text }));
}

export default function ThreadComposer({
  initialTweets,
  initialItems,
  accountSlot: initialAccountSlot = 1,
  previewAccount,
  onSubmit,
  onCancel,
  isSubmitting = false,
  scheduledTime: initialScheduledTime,
}: ThreadComposerProps) {
  const [tweets, setTweets] = useState<TweetItem[]>(() => seedTweets(initialItems, initialTweets));
  const [accountSlot, setAccountSlot] = useState(initialAccountSlot);
  const [previewMode, setPreviewMode] = useState(() =>
    seedTweets(initialItems, initialTweets).some((tweet) => tweet.text.trim().length > 0),
  );
  const [scheduledTime, setScheduledTime] = useState(initialScheduledTime ?? defaultFutureDateTime());
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const updateTweet = useCallback((id: string, text: string) => {
    setTweets((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
  }, []);

  const deleteTweet = useCallback((id: string) => {
    setTweets((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const addTweetAt = useCallback((index: number) => {
    setTweets((prev) => {
      const next = [...prev];
      next.splice(index, 0, { id: generateId(), text: '' });
      return next;
    });
  }, []);

  const addTweetAtEnd = useCallback(() => {
    setTweets((prev) => [...prev, { id: generateId(), text: '' }]);
  }, []);

  const handleAutoSplit = useCallback(() => {
    setTweets((prev) => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      if (weightedLength(first.text) <= MAX_CHARS) return prev;

      const chunks = autoSplitText(first.text);
      const newTweets: TweetItem[] = chunks.map((text, i) =>
        i === 0 ? { ...first, text } : { id: generateId(), text, mediaUrls: undefined }
      );

      return [...newTweets, ...prev.slice(1)];
    });
  }, []);

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      setDragSourceId(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragTargetId(id);
    },
    []
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      if (!dragSourceId || dragSourceId === targetId) {
        setDragSourceId(null);
        setDragTargetId(null);
        return;
      }

      setTweets((prev) => {
        const sourceIdx = prev.findIndex((t) => t.id === dragSourceId);
        const targetIdx = prev.findIndex((t) => t.id === targetId);
        if (sourceIdx === -1 || targetIdx === -1) return prev;

        const next = [...prev];
        const [moved] = next.splice(sourceIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });

      setDragSourceId(null);
      setDragTargetId(null);
    },
    [dragSourceId]
  );

  const handleDragEnd = useCallback(() => {
    setDragSourceId(null);
    setDragTargetId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const nonEmpty = tweets.filter((t) => t.text.trim().length > 0);
    if (nonEmpty.length === 0) return;

    const payload = nonEmpty.map((t) => ({ text: t.text, mediaUrls: t.mediaUrls }));
    const parsed = scheduledTime ? parseDateTimeInput(scheduledTime) : null;
    const time = parsed ? parsed.toISOString() : null;
    await onSubmit(payload, time, accountSlot);
  }, [tweets, scheduledTime, accountSlot, onSubmit]);

  const hasOverLimit = useMemo(
    () => tweets.some((t) => weightedLength(t.text) > MAX_CHARS),
    [tweets]
  );

  const hasContent = useMemo(
    () => tweets.some((t) => t.text.trim().length > 0),
    [tweets]
  );

  const canAutoSplit = useMemo(
    () => tweets.length > 0 && weightedLength(tweets[0]?.text ?? '') > MAX_CHARS,
    [tweets]
  );

  const scheduledTimeInputValue = useMemo(() => {
    if (!scheduledTime) return '';
    try {
      const d = new Date(scheduledTime);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return scheduledTime;
    }
  }, [scheduledTime]);

  const handleTimeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      setScheduledTime('');
      return;
    }
    setScheduledTime(new Date(val).toISOString());
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setPreviewMode(!previewMode)}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
            transition-colors duration-150
            ${
              previewMode
                ? 'bg-teal-500 text-white hover:bg-teal-600'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }
          `}
        >
          {previewMode ? (
            <>
              <EyeOff className="w-4 h-4" />
              Edit
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              Preview
            </>
          )}
        </button>

        {!previewMode && (
          <button
            type="button"
            onClick={handleAutoSplit}
            disabled={!canAutoSplit}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              transition-colors duration-150
              ${
                canAutoSplit
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'
              }
            `}
            title={canAutoSplit ? 'Split first tweet into multiple tweets at sentence boundaries' : 'First tweet must exceed 280 characters to auto-split'}
          >
            <Scissors className="w-4 h-4" />
            Auto-split
          </button>
        )}

        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {tweets.length} tweet{tweets.length !== 1 ? 's' : ''} in thread
        </span>
      </div>

      {previewMode ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#15202b] p-4">
          {tweets.filter((t) => t.text.trim()).length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
              Nothing to preview. Add some content to your tweets.
            </p>
          ) : (
            <div>
              {tweets
                .filter((t) => t.text.trim())
                .map((tweet, i, list) => (
                  <PreviewCard
                    key={tweet.id}
                    text={tweet.text}
                    index={i}
                    total={list.length}
                    account={previewAccount}
                    mediaUrls={tweet.mediaUrls}
                  />
                ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {tweets.map((tweet, index) => (
            <div key={tweet.id}>
              {index > 0 && (
                <ConnectingLine
                  showAddButton
                  onAdd={() => addTweetAt(index)}
                />
              )}

              <TweetCard
                tweet={tweet}
                index={index}
                total={tweets.length}
                onChange={updateTweet}
                onDelete={deleteTweet}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragTarget={dragTargetId === tweet.id && dragSourceId !== tweet.id}
              />
            </div>
          ))}

          <div className="flex flex-col items-center mt-1">
            <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-600" />
            <button
              type="button"
              onClick={addTweetAtEnd}
              className="
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                text-teal-600 dark:text-teal-400
                bg-teal-50 dark:bg-teal-500/10
                hover:bg-teal-100 dark:hover:bg-teal-500/20
                border border-teal-200 dark:border-teal-500/30
                transition-colors duration-150
              "
            >
              <Plus className="w-4 h-4" />
              Add Tweet
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              Schedule
            </span>
            <input
              type="datetime-local"
              value={scheduledTimeInputValue}
              onChange={handleTimeChange}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Account</span>
            <select
              value={accountSlot}
              onChange={(event) => setAccountSlot(Number(event.target.value))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value={1}>Slot 1</option>
              <option value={2}>Slot 2</option>
              <option value={3}>Slot 3</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !hasContent || hasOverLimit}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-teal-500/50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {scheduledTime ? 'Schedule Thread' : 'Post Thread'}
              </>
            )}
          </button>
        </div>

        {hasOverLimit && (
          <p className="mt-2 text-xs text-red-500 font-medium">
            One or more tweets exceed the 280-character limit. Please shorten them or use Auto-split.
          </p>
        )}
      </div>
    </div>
  );
}
