'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { twitterWeightedLength } from '@/lib/twitter-text';

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
  generation?: {
    provider: string;
    requested_posts: number;
    returned_posts: number;
  };
};

interface CreateThreadFromArticleProps {
  onScheduled?: () => void;
}

export default function CreateThreadFromArticle({ onScheduled }: CreateThreadFromArticleProps) {
  const [articleUrl, setArticleUrl] = useState('');
  const [accountSlot, setAccountSlot] = useState(1);
  const [maxTweets, setMaxTweets] = useState(4);
  const [includeImages, setIncludeImages] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);

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

  const draftIsValid = useMemo(
    () => Boolean(draft?.draft.tweets.length)
      && draft!.draft.tweets.every(
        (tweet) => tweet.text.trim().length > 0 && twitterWeightedLength(tweet.text) <= 280,
      ),
    [draft],
  );

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
      if (!response.ok) throw new Error(data?.error || 'Failed to create thread draft.');

      setDraft(data as DraftResponse);
      setSuccess(`${data.draft?.tweets?.length || maxTweets} AI-written posts are ready for review.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread draft.');
    } finally {
      setLoadingDraft(false);
    }
  };

  const updateTweetText = (index: number, text: string) => {
    if (!draft) return;
    const tweets = [...draft.draft.tweets];
    tweets[index] = { ...tweets[index], text };
    setDraft({ ...draft, draft: { ...draft.draft, tweets } });
  };

  const handleSchedule = async () => {
    if (!draft) {
      setError('Create a draft first.');
      return;
    }
    if (!draftIsValid) {
      setError('Every post must contain text and stay within 280 characters.');
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
          account_slot: accountSlot,
          scheduled_time: parsedTime.toISOString(),
          dedupe: true,
          source_url: draft.draft.source_url,
          tweets: draft.draft.tweets,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to schedule thread.');

      const scheduledCount = Number(data?.scheduled || draft.draft.tweets.length);
      setSuccess(`Thread scheduled (${scheduledCount} posts).`);
      setDraft(null);
      onScheduled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule thread.');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="dashboard-card fade-up">
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-teal-500/10 p-2 text-teal-600 dark:text-teal-300">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Article to X thread</h3>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Claude reads the source and prepares an exact-size draft. Nothing publishes until you schedule it.
            </p>
          </div>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              Posts in thread
            </label>
            <input
              id="article-count"
              type="number"
              min={2}
              max={12}
              value={maxTweets}
              onChange={(event) => setMaxTweets(Math.max(2, Math.min(12, Number(event.target.value) || 4)))}
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
          onClick={handleCreateDraft}
          disabled={loadingDraft}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2.5 font-medium text-white shadow-sm transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingDraft ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          <span>{loadingDraft ? 'Claude is reading the article…' : `Create ${maxTweets}-post draft`}</span>
        </button>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {success && !draft && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>
        )}
      </div>

      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="article-draft-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <header className="border-b border-slate-800 bg-slate-900/90 px-5 py-4 sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-teal-300">
                    <CheckCircle2 size={14} />
                    Claude draft · {draft.draft.tweets.length} posts · Slot {accountSlot}
                  </div>
                  <h2 id="article-draft-title" className="text-xl font-semibold leading-tight text-white sm:text-2xl">
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
                    <ExternalLink size={13} className="shrink-0" />
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

            <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.08),transparent_32%)] px-5 py-5 sm:px-7">
              <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5">
                  <ImageIcon size={13} />
                  {draft.article.downloaded_media_urls.length} images attached
                </span>
                <span>Read every post, edit freely, then choose a time.</span>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {draft.draft.tweets.map((tweet, index) => {
                  const weightedLength = twitterWeightedLength(tweet.text);
                  const tooLong = weightedLength > 280;
                  return (
                    <section key={index} className="rounded-xl border border-slate-700 bg-slate-900/90 p-4 shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label htmlFor={`article-tweet-${index}`} className="text-sm font-semibold text-slate-200">
                          Post {index + 1}
                        </label>
                        <span className={`font-mono text-xs ${tooLong ? 'text-red-400' : 'text-slate-500'}`}>
                          {weightedLength}/280
                        </span>
                      </div>
                      <textarea
                        id={`article-tweet-${index}`}
                        value={tweet.text}
                        onChange={(event) => updateTweetText(index, event.target.value)}
                        rows={6}
                        className={`w-full resize-y rounded-lg border bg-slate-950 p-3 text-[15px] leading-6 text-slate-100 outline-none transition focus:ring-2 ${
                          tooLong
                            ? 'border-red-500 focus:border-red-400 focus:ring-red-500/20'
                            : 'border-slate-700 focus:border-teal-500 focus:ring-teal-500/20'
                        }`}
                      />
                      {tweet.media_urls?.length ? (
                        <p className="mt-2 truncate text-xs text-slate-500">Media: {tweet.media_urls.join(', ')}</p>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </div>

            <footer className="border-t border-slate-800 bg-slate-900 px-5 py-4 sm:px-7">
              {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="w-full sm:max-w-sm">
                  <label htmlFor="article-schedule-time" className="mb-1.5 inline-flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Calendar size={14} />
                    Schedule time
                  </label>
                  <input
                    id="article-schedule-time"
                    type="datetime-local"
                    value={scheduledTime}
                    onChange={(event) => setScheduledTime(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-100"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    disabled={scheduling}
                    className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Close without scheduling
                  </button>
                  <button
                    type="button"
                    onClick={handleSchedule}
                    disabled={scheduling || !draftIsValid || !scheduledTime}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {scheduling ? <Loader2 className="animate-spin" size={16} /> : <Calendar size={16} />}
                    {scheduling ? 'Scheduling…' : 'Schedule reviewed thread'}
                  </button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
