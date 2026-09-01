'use client';

import { useEffect, useState } from 'react';
import { Link2, Loader2, Sparkles, X } from 'lucide-react';
import ThreadComposer from './ThreadComposer';
import ModalPortal from './ui/ModalPortal';
import { defaultFutureDateTime } from './scheduler/datetime';
import type { PreviewAccount } from './thread/types';

type DraftTweet = {
  text: string;
  media_urls?: string[];
};

type DraftResponse = {
  article: {
    title: string;
    canonical_url: string;
    quote_candidates: string[];
    downloaded_media_urls: string[];
  };
  draft: {
    account_slot: number;
    source_url: string;
    tweets: DraftTweet[];
  };
};

interface CreateThreadFromArticleProps {
  onScheduled?: () => void;
  embedded?: boolean;
}

export default function CreateThreadFromArticle({ onScheduled, embedded = false }: CreateThreadFromArticleProps) {
  const [articleUrl, setArticleUrl] = useState('');
  const [accountSlot, setAccountSlot] = useState(1);
  const [maxTweets, setMaxTweets] = useState(4);
  const [includeImages, setIncludeImages] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [previewAccount, setPreviewAccount] = useState<PreviewAccount>();

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/user');
        if (!response.ok) return;
        const data = await response.json();
        const account = (data.accounts || []).find((item: { slot?: number; connected?: boolean }) =>
          item.slot === accountSlot && item.connected,
        ) || (data.accounts || []).find((item: { connected?: boolean }) => item.connected);
        if (account) {
          setPreviewAccount({
            username: account.twitterUsername,
            displayName: account.twitterDisplayName,
            avatarUrl: account.twitterProfileImageUrl,
          });
        }
      } catch {
        // Preview falls back to a generic handle.
      }
    })();
  }, [accountSlot]);

  useEffect(() => {
    if (!draft) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scheduling) setDraft(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [draft, scheduling]);

  const handleCreateDraft = async () => {
    if (!articleUrl.trim()) {
      setError('Enter an article URL first.');
      return;
    }

    setLoadingDraft(true);
    setError('');
    setSuccess('');
    setDraft(null);

    try {
      const response = await fetch('/api/agent/create-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: articleUrl.trim(),
          account_slot: accountSlot,
          max_tweets: maxTweets,
          include_images: includeImages,
          schedule: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to split article into posts.');

      setDraft(data as DraftResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to split article into posts.');
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleSchedule = async (
    tweets: Array<{ text: string; mediaUrls?: string[] }>,
    scheduledTime: string | null,
    slot: number,
  ) => {
    if (!draft) {
      setError('Split the article first.');
      return;
    }
    if (!scheduledTime) {
      setError('Pick a scheduled time.');
      return;
    }

    const parsedTime = new Date(scheduledTime);
    if (Number.isNaN(parsedTime.getTime())) {
      setError('Invalid scheduled time.');
      return;
    }

    setScheduling(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/scheduler/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: slot,
          scheduled_time: parsedTime.toISOString(),
          dedupe: true,
          source_url: draft.draft.source_url,
          tweets: tweets.map((tweet) => ({
            text: tweet.text,
            media_urls: tweet.mediaUrls,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to schedule thread.');

      const scheduledCount = Number(data?.scheduled || tweets.length);
      const asThread = scheduledCount > 1;
      setSuccess(asThread
        ? `Thread scheduled (${scheduledCount} posts).`
        : 'Post scheduled.');
      setDraft(null);
      onScheduled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule thread.');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className={embedded ? '' : 'dashboard-card fade-up'}>
      <div className={embedded ? 'space-y-4' : 'space-y-4 p-4'}>
        <div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">Article to X thread</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Paste a URL. We split it into posts, show an X preview, then you schedule the thread.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="article-url" className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Article URL
          </label>
          <input
            id="article-url"
            type="url"
            value={articleUrl}
            onChange={(event) => setArticleUrl(event.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="article-account" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Account
            </label>
            <select
              id="article-account"
              value={accountSlot}
              onChange={(event) => setAccountSlot(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value={1}>Slot 1</option>
              <option value={2}>Slot 2</option>
              <option value={3}>Slot 3</option>
            </select>
          </div>
          <div>
            <label htmlFor="article-count" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Max posts
            </label>
            <input
              id="article-count"
              type="number"
              min={1}
              max={12}
              value={maxTweets}
              onChange={(event) => setMaxTweets(Math.max(1, Math.min(12, Number(event.target.value) || 4)))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(event) => setIncludeImages(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Pull relevant images from the article
        </label>

        <button
          type="button"
          onClick={() => void handleCreateDraft()}
          disabled={loadingDraft}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2.5 font-medium text-white shadow-sm transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingDraft ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          <span>{loadingDraft ? 'Splitting into posts…' : 'Split into posts'}</span>
        </button>

        {error && !draft && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
        {success && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>
        )}
      </div>

      {draft && (
        <ModalPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="article-draft-title"
            className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          >
            <div className="my-4 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
              <header className="border-b border-slate-800 bg-slate-900/90 px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-teal-300">
                      {draft.draft.tweets.length > 1
                        ? `${draft.draft.tweets.length}-post thread`
                        : 'Single post'}
                    </p>
                    <h2 id="article-draft-title" className="text-lg font-semibold leading-tight text-white sm:text-xl">
                      {draft.article.title}
                    </h2>
                    <a
                      href={draft.article.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-slate-400 hover:text-teal-300"
                    >
                      <Link2 size={14} className="shrink-0" />
                      <span className="truncate">{draft.article.canonical_url}</span>
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    disabled={scheduling}
                    className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-40"
                    aria-label="Close draft review"
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
                <ThreadComposer
                  accountSlot={accountSlot}
                  previewAccount={previewAccount}
                  initialItems={draft.draft.tweets.map((tweet) => ({
                    text: tweet.text,
                    mediaUrls: tweet.media_urls,
                  }))}
                  scheduledTime={new Date(defaultFutureDateTime()).toISOString()}
                  isSubmitting={scheduling}
                  onSubmit={handleSchedule}
                  onCancel={() => setDraft(null)}
                />
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
