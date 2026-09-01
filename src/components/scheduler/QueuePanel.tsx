'use client';

import { useEffect, useState } from 'react';
import { Plus, X, List, Loader2, Sparkles } from 'lucide-react';
import type { CommunityTag, QueueItem } from './types';

export function QueuePanel({
  communityTags,
  onScheduled,
}: {
  communityTags: CommunityTag[];
  onScheduled?: () => void;
}) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueSlot, setQueueSlot] = useState(1);
  const [queueText, setQueueText] = useState('');
  const [isAutoScheduling, setIsAutoScheduling] = useState(false);

  const fetchQueue = async () => {
    try {
      const response = await fetch(`/api/scheduler/queue?account_slot=${queueSlot}`);
      if (response.ok) {
        const data = await response.json();
        setQueueItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching queue:', error);
    }
  };

  useEffect(() => {
    void fetchQueue();
  }, [queueSlot]);

  const addToQueue = async () => {
    if (!queueText.trim()) return;
    try {
      const response = await fetch('/api/scheduler/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queueText.trim(), accountSlot: queueSlot }),
      });
      if (response.ok) {
        setQueueText('');
        await fetchQueue();
      }
    } catch (error) {
      console.error('Error adding to queue:', error);
    }
  };

  const removeFromQueue = async (id: number) => {
    try {
      await fetch(`/api/scheduler/queue/${id}`, { method: 'DELETE' });
      await fetchQueue();
    } catch (error) {
      console.error('Error removing from queue:', error);
    }
  };

  const autoScheduleQueue = async () => {
    setIsAutoScheduling(true);
    try {
      const response = await fetch('/api/scheduler/queue/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountSlot: queueSlot }),
      });
      if (response.ok) {
        await fetchQueue();
        onScheduled?.();
      }
    } catch (error) {
      console.error('Error auto-scheduling:', error);
    } finally {
      setIsAutoScheduling(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <select
          value={queueSlot}
          onChange={(e) => setQueueSlot(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
        >
          <option value={1}>Account #1</option>
          <option value={2}>Account #2</option>
          <option value={3}>Account #3</option>
        </select>
        <button
          onClick={() => void autoScheduleQueue()}
          disabled={isAutoScheduling || queueItems.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isAutoScheduling ? (
            <><Loader2 size={14} className="h-4 w-4 animate-spin" /> Scheduling...</>
          ) : (
            <><Sparkles size={14} /> Auto-Schedule All</>
          )}
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        <textarea
          value={queueText}
          onChange={(e) => setQueueText(e.target.value)}
          placeholder="Write a post to add to the queue..."
          className="flex-1 p-3 border border-gray-300 dark:border-slate-600 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
          rows={2}
        />
        <button
          onClick={() => void addToQueue()}
          disabled={!queueText.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {queueItems.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-slate-400">
          <List size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium">Queue is empty</p>
          <p className="text-xs mt-1">Add posts above and click Auto-Schedule to assign optimal times.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {queueItems.map((item, index) => (
            <div
              key={item.id}
              className="flex items-start gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
            >
              <span className="flex-shrink-0 w-6 h-6 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center text-xs font-medium">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-slate-100 whitespace-pre-wrap break-words">{item.text}</p>
                {item.communityId && (
                  <span className="inline-block mt-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                    {communityTags.find((tag) => tag.communityId === item.communityId)?.tagName || 'Community'}
                  </span>
                )}
              </div>
              <button
                onClick={() => void removeFromQueue(item.id)}
                className="flex-shrink-0 p-1 text-gray-400 dark:text-slate-500 hover:text-red-600 transition-colors"
                title="Remove from queue"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
