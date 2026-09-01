'use client';

import { useEffect, useState } from 'react';
import { Loader2, Newspaper, Plus, Trash2 } from 'lucide-react';
import type { Feed, WorkbenchTabProps } from './types';

export default function FeedsTab({
  busyKey,
  setBusyKey,
  onStatus,
  onError,
  clearNotices,
  refreshEpoch,
  onRefreshSettled,
}: WorkbenchTabProps) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedTemplate, setFeedTemplate] = useState('{title} {url}');
  const [feedInterval, setFeedInterval] = useState('15');
  const [feedAutoSchedule, setFeedAutoSchedule] = useState(true);

  const loadFeeds = async () => {
    const response = await fetch('/api/feeds');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load feeds.');
    setFeeds(data.feeds || []);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadFeeds();
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Failed to load feeds.');
        }
      } finally {
        if (!cancelled) onRefreshSettled();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEpoch]);

  const createFeed = async () => {
    if (!feedUrl.trim()) {
      onError('Feed URL is required.');
      return;
    }

    clearNotices();
    setBusyKey('create-feed');
    try {
      const response = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: feedUrl.trim(),
          template: feedTemplate.trim(),
          check_interval_minutes: Number(feedInterval) || 15,
          auto_schedule: feedAutoSchedule,
          account_slot: 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create feed.');
      setFeedUrl('');
      onStatus(`Feed created: ${data.feed.url}`);
      await loadFeeds();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to create feed.');
    } finally {
      setBusyKey('');
    }
  };

  const updateFeedStatus = async (feed: Feed, status: 'active' | 'paused') => {
    clearNotices();
    setBusyKey(`feed-toggle-${feed.id}`);
    try {
      const response = await fetch(`/api/feeds/${feed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update feed.');
      onStatus(`Feed ${data.feed.url} ${status === 'active' ? 'activated' : 'paused'}.`);
      await loadFeeds();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update feed.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteFeed = async (feed: Feed) => {
    clearNotices();
    setBusyKey(`feed-delete-${feed.id}`);
    try {
      const response = await fetch(`/api/feeds/${feed.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete feed.');
      onStatus(`Feed deleted: ${feed.url}`);
      await loadFeeds();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete feed.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          <Plus size={14} />
          <span>Add RSS/Atom feed</span>
        </div>
        <div className="space-y-3">
          <input
            value={feedUrl}
            onChange={(event) => setFeedUrl(event.target.value)}
            placeholder="https://example.com/feed.xml"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
          <textarea
            value={feedTemplate}
            onChange={(event) => setFeedTemplate(event.target.value)}
            placeholder="Post template"
            className="min-h-[88px] w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={feedInterval}
              onChange={(event) => setFeedInterval(event.target.value)}
              placeholder="Check interval"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={feedAutoSchedule}
                onChange={(event) => setFeedAutoSchedule(event.target.checked)}
              />
              Auto-schedule
            </label>
          </div>
        </div>
        <button
          onClick={createFeed}
          disabled={busyKey === 'create-feed'}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50"
        >
          {busyKey === 'create-feed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Newspaper size={14} />}
          <span>Create Feed</span>
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Monitored feeds</h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">{feeds.length} total</span>
        </div>
        <div className="space-y-3">
          {feeds.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No feeds configured yet.</p>
          ) : (
            feeds.map((feed) => (
              <div key={feed.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{feed.title || feed.url}</div>
                    <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{feed.url}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] ${feed.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                    {feed.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-3">
                  <div>Every {feed.checkIntervalMinutes} min</div>
                  <div>{feed.autoSchedule ? 'Auto-scheduling on' : 'Manual only'}</div>
                  <div>{feed.lastCheckedAt ? new Date(feed.lastCheckedAt).toLocaleString() : 'Never checked'}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => updateFeedStatus(feed, feed.status === 'active' ? 'paused' : 'active')}
                    disabled={busyKey === `feed-toggle-${feed.id}`}
                    className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {feed.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteFeed(feed)}
                    disabled={busyKey === `feed-delete-${feed.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-700 px-2 py-1 text-xs text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
