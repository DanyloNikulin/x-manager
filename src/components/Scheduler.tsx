'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Tag, List, Loader2 } from 'lucide-react';
import ThreadComposer from './ThreadComposer';
import { useToast } from './ui/Toast';
import { ACCOUNT_SLOTS } from '@/lib/account-slots';
import type { CommunityTag, ScheduledPost, SchedulerProps } from './scheduler/types';
import { CalendarBoard } from './scheduler/CalendarBoard';
import { PostComposer } from './scheduler/PostComposer';
import { TagManager } from './scheduler/TagManager';
import { PostHistory } from './scheduler/PostHistory';
import { CompactStreamComposer } from './scheduler/CompactStreamComposer';
import ModalPortal from './ui/ModalPortal';
import type { PreviewAccount } from './thread/types';

export default function Scheduler({ onUpdate, refreshTrigger, compact = false }: SchedulerProps) {
  const { toast } = useToast();
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [communityTags, setCommunityTags] = useState<CommunityTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleSlots, setVisibleSlots] = useState<number[]>([...ACCOUNT_SLOTS]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [composerSeedDate, setComposerSeedDate] = useState<Date | undefined>(undefined);
  const [showManageTags, setShowManageTags] = useState(false);
  const [showThreadComposer, setShowThreadComposer] = useState(false);
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [previewAccount, setPreviewAccount] = useState<PreviewAccount>();
  const [threadSubmitting, setThreadSubmitting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fetchScheduledPosts = async () => {
    try {
      const response = await fetch('/api/scheduler/posts?include_metrics=true');
      if (response.ok) {
        const data = await response.json();
        const rows = Array.isArray(data) ? data : Array.isArray(data.posts) ? data.posts : [];
        setScheduledPosts(rows.map((post: ScheduledPost & { thread_id?: string | null; thread_index?: number | null }) => ({
          ...post,
          threadId: post.threadId ?? post.thread_id ?? null,
          threadIndex: post.threadIndex ?? post.thread_index ?? null,
        })));
      }
    } catch (error) {
      console.error('Error fetching scheduled posts:', error);
    }
  };

  const fetchCommunityTags = async () => {
    try {
      const response = await fetch('/api/scheduler/tags');
      if (response.ok) setCommunityTags(await response.json());
    } catch (error) {
      console.error('Error fetching community tags:', error);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await Promise.all([fetchScheduledPosts(), fetchCommunityTags()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/user');
        if (!response.ok) return;
        const data = await response.json();
        const account = (data.accounts || []).find((item: { connected?: boolean }) => item.connected)
          || data.accounts?.[0];
        if (account) {
          setPreviewAccount({
            username: account.twitterUsername,
            displayName: account.twitterDisplayName,
            avatarUrl: account.twitterProfileImageUrl,
          });
        }
      } catch {
        // Preview falls back to generic handle.
      }
    })();
  }, []);

  useEffect(() => {
    if (refreshTrigger) void fetchScheduledPosts();
  }, [refreshTrigger]);

  const preserveScroll = async (work: () => Promise<void>) => {
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    await work();
    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollTop;
      scrollContainer.scrollLeft = scrollLeft;
    });
  };

  const handleDropOnDate = async (targetDate: Date, targetHour?: number) => {
    if (!draggedPostId) return;
    const scheduled = new Date(targetDate);
    if (typeof targetHour === 'number') scheduled.setHours(targetHour, 0, 0, 0);
    try {
      const response = await fetch(`/api/scheduler/posts/${draggedPostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_time: scheduled.toISOString() }),
      });
      if (response.ok) await fetchScheduledPosts();
    } catch (error) {
      console.error('Failed to reschedule post:', error);
    } finally {
      setDraggedPostId(null);
    }
  };

  const handleDeletePost = useCallback(async (postId: string) => {
    await preserveScroll(async () => {
      try {
        const response = await fetch(`/api/scheduler/posts/${postId}`, { method: 'DELETE' });
        if (response.ok) await fetchScheduledPosts();
        else throw new Error('Failed to delete post');
      } catch (error) {
        console.error('Error deleting post:', error);
        toast({ variant: 'error', title: 'Delete failed', description: 'Failed to delete post. Please try again.' });
      }
    });
  }, [toast]);

  const handleClearAllPosts = useCallback(async () => {
    if (scheduledPosts.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete all ${scheduledPosts.length} scheduled posts? This action cannot be undone.`)) return;
    await preserveScroll(async () => {
      try {
        const response = await fetch('/api/scheduler/posts?confirm=delete-all', { method: 'DELETE' });
        if (response.ok) await fetchScheduledPosts();
        else throw new Error('Failed to delete all posts');
      } catch (error) {
        console.error('Error deleting all posts:', error);
        toast({ variant: 'error', title: 'Delete failed', description: 'Failed to delete all posts. Please try again.' });
      }
    });
  }, [scheduledPosts.length, toast]);

  const handleBulkAction = async (action: string, postIds: string[]) => {
    if (postIds.length === 0) return;
    try {
      const response = await fetch('/api/scheduler/posts/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds, action }),
      });
      if (response.ok) await fetchScheduledPosts();
    } catch (error) {
      console.error('Bulk action failed:', error);
    }
  };

  const openCreate = (date?: Date) => {
    setEditingPost(null);
    setComposerSeedDate(date);
    setShowCreateForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin h-8 w-8 text-gray-400 dark:text-slate-500" />
        <span className="ml-3 text-gray-600 dark:text-slate-300">Loading scheduler...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-up" ref={scrollContainerRef}>
      {!compact && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {([1, 2] as const).map((slot) => (
              <button
                key={slot}
                onClick={() => setVisibleSlots((prev) => prev.includes(slot) ? prev.filter((value) => value !== slot) : [...prev, slot])}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  visibleSlots.includes(slot)
                    ? slot === 1 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm' : 'bg-amber-50 text-amber-700 border border-amber-200 shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${visibleSlots.includes(slot) ? (slot === 1 ? 'bg-indigo-500' : 'bg-amber-500') : 'bg-slate-300'}`} />
                Account {slot}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button onClick={() => setShowManageTags(true)} className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors w-full sm:w-auto">
              <Tag size={16} /><span>Manage Tags</span>
            </button>
            <button onClick={() => setShowThreadComposer(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors w-full sm:w-auto justify-center">
              <List size={14} /> Thread
            </button>
            <button onClick={() => openCreate()} className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto">
              <Plus size={16} /><span>Create Post</span>
            </button>
          </div>
        </div>
      )}

      {compact && (
        <>
          <div className="flex items-center justify-between mb-2 px-1">
            <button onClick={() => setShowManageTags(true)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors" title="Manage Tags">
              <Tag size={16} />
            </button>
            <div className="flex gap-2">
              <button onClick={() => setShowThreadComposer(true)} className="p-1.5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors" title="New Thread">
                <List size={16} />
              </button>
              <button onClick={() => openCreate()} className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors" title="New Post">
                <Plus size={16} />
              </button>
            </div>
          </div>
          <CompactStreamComposer
            previewAccount={previewAccount}
            onScheduled={() => {
              void fetchScheduledPosts();
              onUpdate?.();
            }}
          />
        </>
      )}

      <CalendarBoard
        compact={compact}
        scheduledPosts={scheduledPosts}
        visibleSlots={visibleSlots}
        communityTags={communityTags}
        onCreatePost={openCreate}
        onEditPost={(post) => { setEditingPost(post); setComposerSeedDate(undefined); setShowCreateForm(true); }}
        onDeletePost={(id) => void handleDeletePost(id)}
        onDropOnDate={(date, hour) => void handleDropOnDate(date, hour)}
        onDragStart={setDraggedPostId}
        onBulkAction={(action, ids) => void handleBulkAction(action, ids)}
        onPostsChanged={() => { void fetchScheduledPosts(); }}
      />

      {showCreateForm && (
        <PostComposer
          editingPost={editingPost}
          seedDate={composerSeedDate}
          communityTags={communityTags}
          onClose={() => { setShowCreateForm(false); setEditingPost(null); }}
          onSaved={() => { void fetchScheduledPosts(); if (!editingPost) onUpdate?.(); }}
        />
      )}

      {showManageTags && (
        <TagManager onClose={() => setShowManageTags(false)} onChanged={() => { void fetchCommunityTags(); }} />
      )}

      {!compact && (
        <PostHistory
          scheduledPosts={scheduledPosts}
          handleClearAllPosts={() => void handleClearAllPosts()}
          handleEditPost={(post) => { setEditingPost(post); setShowCreateForm(true); }}
          handleDeletePost={(id) => void handleDeletePost(id)}
        />
      )}

      {showThreadComposer && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8"
            onClick={(e) => { if (e.target === e.currentTarget) setShowThreadComposer(false); }}
            onKeyDown={(e) => { if (e.key === 'Escape') setShowThreadComposer(false); }}
          >
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <ThreadComposer
                previewAccount={previewAccount}
                isSubmitting={threadSubmitting}
                onSubmit={async (tweets, scheduledTime, accountSlot) => {
                  setThreadSubmitting(true);
                  try {
                    const response = await fetch('/api/scheduler/thread', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tweets: tweets.map((tweet) => ({
                          text: tweet.text,
                          media_urls: tweet.mediaUrls,
                        })),
                        account_slot: accountSlot,
                        scheduled_time: scheduledTime,
                      }),
                    });
                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      throw new Error(data.error || `Failed to create thread (${response.status})`);
                    }
                    setShowThreadComposer(false);
                    toast({ variant: 'success', title: 'Thread scheduled', description: `${tweets.length} tweets queued` });
                    await fetchScheduledPosts();
                    onUpdate?.();
                  } catch (err) {
                    toast({ variant: 'error', title: 'Thread failed', description: err instanceof Error ? err.message : 'Unknown error' });
                  } finally {
                    setThreadSubmitting(false);
                  }
                }}
                onCancel={() => setShowThreadComposer(false)}
              />
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
