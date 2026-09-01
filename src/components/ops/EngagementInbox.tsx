'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, MessageSquare, Repeat2, Send, ThumbsUp } from 'lucide-react';
import type { ConversationMessage, InboxItem, InboxStatus, OpsFeedback, SavedReply } from './types';
import SavedRepliesModal from './SavedRepliesModal';

export default function EngagementInbox({
  accountSlot,
  refreshEpoch,
  onStatus,
  onError,
  showSavedRepliesManager,
  onCloseSavedReplies,
}: {
  accountSlot: number;
  refreshEpoch: number;
  showSavedRepliesManager: boolean;
  onCloseSavedReplies: () => void;
} & OpsFeedback) {
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [dmDrafts, setDmDrafts] = useState<Record<number, string>>({});
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([]);
  const [workingId, setWorkingId] = useState('');
  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxStatusFilter, setInboxStatusFilter] = useState('');

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const params = new URLSearchParams();
      params.set('account_slot', String(accountSlot));
      params.set('limit', '50');
      if (inboxSearch) params.set('search', inboxSearch);
      params.set('status', inboxStatusFilter || 'new,reviewed,replied');
      const response = await fetch(`/api/engagement/inbox?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load inbox.');
      setInboxItems(data.items || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load inbox.');
    } finally {
      setLoadingInbox(false);
    }
  };

  const loadSavedReplies = async () => {
    try {
      const response = await fetch('/api/engagement/saved-replies');
      const data = await response.json();
      if (response.ok) setSavedReplies(data.items || []);
    } catch { /* ignore */ }
  };

  const loadThread = async (sourceId: string) => {
    setSelectedThread(sourceId);
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/engagement/inbox/conversations/${encodeURIComponent(sourceId)}`);
      const data = await response.json();
      setThreadMessages(response.ok ? data.messages || [] : []);
    } catch {
      setThreadMessages([]);
    } finally {
      setLoadingThread(false);
    }
  };

  const groupedInbox = (() => {
    const threads = new Map<string, InboxItem[]>();
    for (const item of inboxItems) {
      const key = item.conversationId || item.sourceId;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key)!.push(item);
    }
    return Array.from(threads.entries())
      .map(([key, items]) => ({
        threadId: key,
        latest: items[items.length - 1],
        items,
        hasMultiple: items.length > 1,
      }))
      .sort((a, b) => new Date(b.latest.receivedAt).getTime() - new Date(a.latest.receivedAt).getTime());
  })();

  useEffect(() => {
    void loadInbox();
  }, [accountSlot, refreshEpoch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadInbox();
    }, 300);
    return () => clearTimeout(timer);
  }, [inboxSearch, inboxStatusFilter]);

  useEffect(() => {
    void loadSavedReplies();
  }, []);

  const insertSavedReply = (itemId: number, replyText: string, replyId: number, isDm: boolean) => {
    if (isDm) {
      setDmDrafts((prev) => ({ ...prev, [itemId]: (prev[itemId] || '') + replyText }));
    } else {
      setReplyDrafts((prev) => ({ ...prev, [itemId]: (prev[itemId] || '') + replyText }));
    }
    void fetch(`/api/engagement/saved-replies/${replyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incrementUseCount: true }),
    });
  };

  const updateInboxStatus = async (item: InboxItem, status: InboxStatus) => {
    setWorkingId(`status-${item.id}`);
    try {
      const response = await fetch(`/api/engagement/inbox/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update inbox item.');
      onStatus(`Inbox item ${item.id} updated to ${status}.`);
      await loadInbox();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update inbox item.');
    } finally {
      setWorkingId('');
    }
  };

  const sendReply = async (item: InboxItem) => {
    const text = (replyDrafts[item.id] || '').trim();
    if (!text) {
      onError('Enter a reply first.');
      return;
    }
    setWorkingId(`reply-${item.id}`);
    try {
      const response = await fetch('/api/engagement/actions/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          reply_to_tweet_id: item.sourceId,
          text,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send reply.');
      onStatus(`Reply sent (tweet id: ${data.tweetId || 'unknown'}).`);
      setReplyDrafts((prev) => ({ ...prev, [item.id]: '' }));
      await loadInbox();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to send reply.');
    } finally {
      setWorkingId('');
    }
  };

  const sendDmReply = async (item: InboxItem) => {
    const text = (dmDrafts[item.id] || '').trim();
    if (!text) {
      onError('Enter a DM response first.');
      return;
    }
    if (!item.authorUserId) {
      onError('Cannot reply to this DM: sender id missing.');
      return;
    }
    setWorkingId(`dm-${item.id}`);
    try {
      const response = await fetch('/api/engagement/actions/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          recipient_user_id: item.authorUserId,
          text,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send DM.');
      onStatus(`DM sent (event id: ${data.eventId || 'unknown'}).`);
      setDmDrafts((prev) => ({ ...prev, [item.id]: '' }));
      await loadInbox();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to send DM.');
    } finally {
      setWorkingId('');
    }
  };

  const runEngagementAction = async (type: 'like' | 'repost', item: InboxItem) => {
    setWorkingId(`${type}-${item.id}`);
    try {
      const response = await fetch(`/api/engagement/actions/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          tweet_id: item.sourceId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Failed to ${type}.`);
      onStatus(type === 'like' ? 'Post liked.' : 'Post reposted.');
    } catch (error) {
      onError(error instanceof Error ? error.message : `Failed to ${type}.`);
    } finally {
      setWorkingId('');
    }
  };

  const selectedItem = selectedThread
    ? inboxItems.find((item) => item.sourceId === selectedThread || item.conversationId === selectedThread)
    : undefined;

  return (
    <section className="xl:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
          <MessageSquare size={18} className="text-slate-700 dark:text-slate-200" />
          Engagement Inbox
        </h3>
        <button
          onClick={() => void loadInbox()}
          disabled={loadingInbox}
          className="text-sm px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200"
        >
          {loadingInbox ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={inboxSearch}
          onChange={(e) => setInboxSearch(e.target.value)}
          placeholder="Search inbox..."
          className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
        />
        <select
          value={inboxStatusFilter}
          onChange={(e) => setInboxStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:bg-slate-700 dark:text-slate-200"
        >
          <option value="">All</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="replied">Replied</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {loadingInbox ? (
        <div className="py-8 flex items-center justify-center text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : inboxItems.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No inbox items yet. Run sync to ingest mentions/DMs.</p>
      ) : (
        <div className="flex gap-4 max-h-[720px]">
          <div className={`space-y-2 overflow-y-auto pr-1 ${selectedThread ? 'w-2/5 hidden xl:block' : 'w-full'}`}>
            {groupedInbox.map((thread) => {
              const item = thread.latest;
              const isSelected = selectedThread === thread.threadId;
              return (
                <div
                  key={thread.threadId}
                  onClick={() => void loadThread(thread.threadId)}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    isSelected ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {item.sourceType === 'dm' ? <Mail size={12} className="text-slate-400 dark:text-slate-500" /> : <MessageSquare size={12} className="text-slate-400 dark:text-slate-500" />}
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">@{item.authorUsername || 'unknown'}</span>
                      {thread.hasMultiple && (
                        <span className="text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 px-1.5 rounded-full">{thread.items.length}</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.status === 'new' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">{item.text}</p>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{new Date(item.receivedAt).toLocaleString()}</span>
                </div>
              );
            })}
          </div>

          {selectedThread && (
            <div className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col">
              <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900 rounded-t-lg">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">Thread</h4>
                <button onClick={() => setSelectedThread(null)} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">Close</button>
              </div>

              {loadingThread ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {threadMessages.map((msg) => (
                    <div key={msg.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">@{msg.author_username || 'unknown'}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{new Date(msg.received_at * 1000).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 rounded-lg p-2">{msg.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {selectedItem?.sourceType === 'mention' && (
                <div className="p-3 border-t border-slate-100 dark:border-slate-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <textarea
                      value={replyDrafts[selectedItem.id] || ''}
                      onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [selectedItem.id]: event.target.value }))}
                      placeholder="Reply to thread..."
                      className="flex-1 p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
                      rows={2}
                    />
                    {savedReplies.length > 0 && (
                      <div className="relative group">
                        <button className="px-2 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-xs hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap dark:text-slate-200">Quick</button>
                        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 w-48 hidden group-hover:block max-h-48 overflow-y-auto">
                          {savedReplies.map((sr) => (
                            <button
                              key={sr.id}
                              onClick={() => insertSavedReply(selectedItem.id, sr.text, sr.id, false)}
                              className="block w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-0"
                            >
                              <span className="font-medium dark:text-slate-200">{sr.name}</span>
                              <p className="text-slate-500 dark:text-slate-400 truncate">{sr.text}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void sendReply(selectedItem)}
                      disabled={workingId === `reply-${selectedItem.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {workingId === `reply-${selectedItem.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send size={12} />}
                      Reply
                    </button>
                    <button onClick={() => void runEngagementAction('like', selectedItem)} disabled={workingId === `like-${selectedItem.id}`} className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200">
                      <ThumbsUp size={12} /> Like
                    </button>
                    <button onClick={() => void runEngagementAction('repost', selectedItem)} disabled={workingId === `repost-${selectedItem.id}`} className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200">
                      <Repeat2 size={12} /> Repost
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void updateInboxStatus(selectedItem, 'reviewed')} disabled={workingId === `status-${selectedItem.id}`} className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200">Mark Reviewed</button>
                    <button onClick={() => void updateInboxStatus(selectedItem, 'dismissed')} disabled={workingId === `status-${selectedItem.id}`} className="text-xs px-2 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50">Dismiss</button>
                  </div>
                </div>
              )}

              {selectedItem?.sourceType === 'dm' && (
                <div className="p-3 border-t border-slate-100 dark:border-slate-700 space-y-2">
                  <textarea
                    value={dmDrafts[selectedItem.id] || ''}
                    onChange={(event) => setDmDrafts((prev) => ({ ...prev, [selectedItem.id]: event.target.value }))}
                    placeholder="Reply to DM..."
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
                    rows={2}
                  />
                  <button
                    onClick={() => void sendDmReply(selectedItem)}
                    disabled={workingId === `dm-${selectedItem.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {workingId === `dm-${selectedItem.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send size={12} />}
                    Send DM
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SavedRepliesModal
        open={showSavedRepliesManager}
        savedReplies={savedReplies}
        onClose={onCloseSavedReplies}
        onChanged={() => void loadSavedReplies()}
      />
    </section>
  );
}
