'use client';

import { useState } from 'react';
import type { SavedReply } from './types';

export default function SavedRepliesModal({
  open,
  savedReplies,
  onClose,
  onChanged,
}: {
  open: boolean;
  savedReplies: SavedReply[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newReplyName, setNewReplyName] = useState('');
  const [newReplyText, setNewReplyText] = useState('');
  const [newReplyCategory, setNewReplyCategory] = useState('');

  if (!open) return null;

  const createSavedReply = async () => {
    if (!newReplyName.trim() || !newReplyText.trim()) return;
    try {
      await fetch('/api/engagement/saved-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newReplyName, text: newReplyText, category: newReplyCategory || undefined }),
      });
      setNewReplyName('');
      setNewReplyText('');
      setNewReplyCategory('');
      onChanged();
    } catch { /* ignore */ }
  };

  const deleteSavedReply = async (id: number) => {
    await fetch(`/api/engagement/saved-replies/${id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Saved Quick Replies</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl">&times;</button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 mb-4 space-y-2">
          <input
            type="text"
            value={newReplyName}
            onChange={(e) => setNewReplyName(e.target.value)}
            placeholder="Reply name (e.g. 'Thank you')"
            className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
          />
          <textarea
            value={newReplyText}
            onChange={(e) => setNewReplyText(e.target.value)}
            placeholder="Reply text..."
            className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
            rows={2}
          />
          <input
            type="text"
            value={newReplyCategory}
            onChange={(e) => setNewReplyCategory(e.target.value)}
            placeholder="Category (optional)"
            className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
          />
          <button
            onClick={() => void createSavedReply()}
            disabled={!newReplyName.trim() || !newReplyText.trim()}
            className="px-4 py-2 bg-slate-900 dark:bg-slate-600 text-white rounded-md text-sm hover:bg-slate-800 dark:hover:bg-slate-500 disabled:opacity-50"
          >
            Add Reply
          </button>
        </div>

        {savedReplies.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No saved replies yet.</p>
        ) : (
          <div className="space-y-2">
            {savedReplies.map((reply) => (
              <div key={reply.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{reply.name}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{reply.text}</p>
                  <div className="flex gap-2 mt-1">
                    {reply.category && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 rounded dark:text-slate-300">{reply.category}</span>}
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">Used {reply.useCount}x</span>
                  </div>
                </div>
                <button
                  onClick={() => void deleteSavedReply(reply.id)}
                  className="text-red-500 hover:text-red-700 text-xs ml-2"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
