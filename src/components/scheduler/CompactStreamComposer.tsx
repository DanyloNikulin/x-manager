'use client';

import { useMemo, useState } from 'react';
import { Calendar, Loader2, Send } from 'lucide-react';
import { autoSplitText, weightedLength, MAX_CHARS } from '../thread/text';
import PreviewCard from '../thread/PreviewCard';
import { defaultFutureDateTime, isDateTimeInPast, parseDateTimeInput } from './datetime';
import { useToast } from '../ui/Toast';
import type { PreviewAccount } from '../thread/types';

export function CompactStreamComposer({
  previewAccount,
  onScheduled,
}: {
  previewAccount?: PreviewAccount;
  onScheduled?: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [scheduledTime, setScheduledTime] = useState(defaultFutureDateTime);
  const [accountSlot, setAccountSlot] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const chunks = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return weightedLength(trimmed) > MAX_CHARS ? autoSplitText(trimmed) : [trimmed];
  }, [text]);

  const isThread = chunks.length > 1;
  const overLimit = chunks.some((chunk) => weightedLength(chunk) > MAX_CHARS);
  const dateError = scheduledTime && isDateTimeInPast(scheduledTime)
    ? 'Pick a time in the future.'
    : '';

  const handleSchedule = async () => {
    if (!text.trim() || !scheduledTime || dateError || overLimit) return;
    const parsed = parseDateTimeInput(scheduledTime);
    if (!parsed) return;

    setIsSubmitting(true);
    try {
      const endpoint = isThread ? '/api/scheduler/thread' : '/api/scheduler/posts';
      const response = isThread
        ? await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_slot: accountSlot,
              scheduled_time: parsed.toISOString(),
              tweets: chunks.map((chunk) => ({ text: chunk })),
            }),
          })
        : await fetch(endpoint, {
            method: 'POST',
            body: (() => {
              const form = new FormData();
              form.append('text', chunks[0]);
              form.append('scheduled_time', parsed.toISOString());
              form.append('account_slot', String(accountSlot));
              return form;
            })(),
          });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to schedule');
      }

      toast({
        variant: 'success',
        title: isThread ? 'Thread scheduled' : 'Post scheduled',
        description: isThread ? `${chunks.length} posts in one thread` : undefined,
      });
      setText('');
      setShowPreview(false);
      setScheduledTime(defaultFutureDateTime());
      onScheduled?.();
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Schedule failed',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What's happening?"
        rows={4}
        className="w-full resize-none rounded-lg border border-slate-200 bg-transparent p-3 text-[15px] leading-relaxed text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
      />

      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {isThread
            ? `Will post as a ${chunks.length}-tweet thread`
            : `${weightedLength(text)} / ${MAX_CHARS}`}
        </span>
        <button
          type="button"
          onClick={() => setShowPreview((value) => !value)}
          disabled={chunks.length === 0}
          className="text-teal-600 hover:text-teal-500 disabled:opacity-40"
        >
          {showPreview ? 'Hide preview' : 'X preview'}
        </button>
      </div>

      {showPreview && chunks.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#15202b]">
          {chunks.map((chunk, index) => (
            <PreviewCard
              key={`${index}-${chunk.slice(0, 12)}`}
              text={chunk}
              index={index}
              total={chunks.length}
              account={previewAccount}
            />
          ))}
        </div>
      )}

      <label className="block">
        <span className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Calendar size={12} />
          Schedule
        </span>
        <input
          type="datetime-local"
          value={scheduledTime}
          onChange={(event) => setScheduledTime(event.target.value)}
          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      <div className="flex items-center gap-2">
        <select
          value={accountSlot}
          onChange={(event) => setAccountSlot(Number(event.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value={1}>Slot 1</option>
          <option value={2}>Slot 2</option>
          <option value={3}>Slot 3</option>
        </select>
        <button
          type="button"
          onClick={() => void handleSchedule()}
          disabled={!text.trim() || isSubmitting || Boolean(dateError) || overLimit}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {isThread ? 'Schedule thread' : 'Schedule'}
        </button>
      </div>
      {dateError && <p className="text-xs text-red-500">{dateError}</p>}
    </div>
  );
}
