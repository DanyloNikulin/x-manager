'use client';

import { useEffect, useState } from 'react';
import { Clock3, Loader2, Plus, Trash2 } from 'lucide-react';
import type { SavedSearch, WorkbenchTabProps } from './types';

export default function SearchesTab({
  busyKey,
  setBusyKey,
  onStatus,
  onError,
  clearNotices,
  refreshEpoch,
  onRefreshSettled,
}: WorkbenchTabProps) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [searchKeywords, setSearchKeywords] = useState('ai agents, orchestration');
  const [searchInterval, setSearchInterval] = useState('15');
  const [searchAutoAction, setSearchAutoAction] = useState<'none' | 'like' | 'reply'>('none');
  const [searchReplyTemplate, setSearchReplyTemplate] = useState('{suggestedReplyStarter}');
  const [searchNotify, setSearchNotify] = useState(true);

  const loadSearches = async () => {
    const response = await fetch('/api/discovery/saved');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load saved searches.');
    setSearches(data.searches || []);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadSearches();
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Failed to load saved searches.');
        }
      } finally {
        if (!cancelled) onRefreshSettled();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEpoch]);

  const createSearch = async () => {
    const keywords = searchKeywords.split(',').map((value) => value.trim()).filter(Boolean);
    if (keywords.length === 0) {
      onError('At least one keyword is required.');
      return;
    }

    clearNotices();
    setBusyKey('create-search');
    try {
      const response = await fetch('/api/discovery/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          check_interval_minutes: Number(searchInterval) || 15,
          auto_action: searchAutoAction === 'none' ? null : searchAutoAction,
          reply_template: searchAutoAction === 'reply' ? searchReplyTemplate.trim() : null,
          notify: searchNotify,
          account_slot: 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create saved search.');
      setSearchKeywords('');
      onStatus(`Saved search created for ${data.search.keywords.join(', ')}.`);
      await loadSearches();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to create saved search.');
    } finally {
      setBusyKey('');
    }
  };

  const updateSearchStatus = async (search: SavedSearch, status: 'active' | 'paused') => {
    clearNotices();
    setBusyKey(`search-toggle-${search.id}`);
    try {
      const response = await fetch(`/api/discovery/saved/${search.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update saved search.');
      onStatus(`Saved search ${data.search.keywords.join(', ')} ${status === 'active' ? 'activated' : 'paused'}.`);
      await loadSearches();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update saved search.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteSearch = async (search: SavedSearch) => {
    clearNotices();
    setBusyKey(`search-delete-${search.id}`);
    try {
      const response = await fetch(`/api/discovery/saved/${search.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete saved search.');
      onStatus(`Saved search deleted: ${search.keywords.join(', ')}.`);
      await loadSearches();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete saved search.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          <Plus size={14} />
          <span>Create saved search</span>
        </div>
        <div className="space-y-3">
          <input
            value={searchKeywords}
            onChange={(event) => setSearchKeywords(event.target.value)}
            placeholder="Keywords, comma separated"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={searchInterval}
              onChange={(event) => setSearchInterval(event.target.value)}
              placeholder="Check interval"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
            <select
              value={searchAutoAction}
              onChange={(event) => setSearchAutoAction(event.target.value as 'none' | 'like' | 'reply')}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            >
              <option value="none">Notify only</option>
              <option value="like">Auto like</option>
              <option value="reply">Auto reply</option>
            </select>
          </div>
          <textarea
            value={searchReplyTemplate}
            onChange={(event) => setSearchReplyTemplate(event.target.value)}
            placeholder="Reply template"
            className="min-h-[88px] w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={searchNotify}
              onChange={(event) => setSearchNotify(event.target.checked)}
            />
            Emit keyword match events
          </label>
        </div>
        <button
          onClick={createSearch}
          disabled={busyKey === 'create-search'}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50"
        >
          {busyKey === 'create-search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 size={14} />}
          <span>Create Saved Search</span>
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Watched keyword sets</h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">{searches.length} total</span>
        </div>
        <div className="space-y-3">
          {searches.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No saved searches configured yet.</p>
          ) : (
            searches.map((search) => (
              <div key={search.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{search.keywords.join(', ')}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Every {search.checkIntervalMinutes} min • {search.autoAction ? `auto ${search.autoAction}` : 'notify only'}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] ${search.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                    {search.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => updateSearchStatus(search, search.status === 'active' ? 'paused' : 'active')}
                    disabled={busyKey === `search-toggle-${search.id}`}
                    className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {search.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteSearch(search)}
                    disabled={busyKey === `search-delete-${search.id}`}
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
