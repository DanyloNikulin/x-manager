'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, X, Loader2 } from 'lucide-react';
import type { CommunityTag } from './types';
import { useToast } from '../ui/Toast';

export function TagManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [communityTags, setCommunityTags] = useState<CommunityTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newCommunityId, setNewCommunityId] = useState('');
  const [newCommunityName, setNewCommunityName] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);

  const loadTags = async () => {
    try {
      const response = await fetch('/api/scheduler/tags');
      if (response.ok) setCommunityTags(await response.json());
    } catch (error) {
      console.error('Error fetching community tags:', error);
    }
  };

  useEffect(() => {
    void loadTags();
  }, []);

  const handleSave = async () => {
    if (!newTagName.trim() || !newCommunityId.trim()) return;
    setIsSavingTag(true);
    try {
      const response = await fetch('/api/scheduler/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: newTagName,
          community_id: newCommunityId,
          community_name: newCommunityName || undefined,
        }),
      });
      if (response.ok) {
        setNewTagName('');
        setNewCommunityId('');
        setNewCommunityName('');
        await loadTags();
        onChanged();
        onClose();
      } else {
        throw new Error('Failed to save tag');
      }
    } catch (error) {
      console.error('Error saving tag:', error);
      toast({ variant: 'error', title: 'Tag save failed', description: 'Failed to save tag. Please try again.' });
    } finally {
      setIsSavingTag(false);
    }
  };

  const handleDelete = async (tagId: string) => {
    if (!confirm('Are you sure you want to delete this tag?')) return;
    try {
      const response = await fetch(`/api/scheduler/tags/${tagId}`, { method: 'DELETE' });
      if (response.ok) {
        await loadTags();
        onChanged();
      } else {
        throw new Error('Failed to delete tag');
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast({ variant: 'error', title: 'Tag delete failed', description: 'Failed to delete tag. Please try again.' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 sm:p-6 w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Manage Community Tags</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            <X size={24} />
          </button>
        </div>

        <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-3">Add New Tag</h4>
          <div className="space-y-3">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Tag name (e.g., 'Web3', 'AI News')"
              className="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={newCommunityId}
              onChange={(e) => setNewCommunityId(e.target.value)}
              placeholder="Community ID (from X/Twitter)"
              className="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={newCommunityName}
              onChange={(e) => setNewCommunityName(e.target.value)}
              placeholder="Community name (optional)"
              className="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
            />
            <button
              onClick={() => void handleSave()}
              disabled={!newTagName.trim() || !newCommunityId.trim() || isSavingTag}
              className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 w-full sm:w-auto"
            >
              {isSavingTag ? <Loader2 size={16} /> : <Plus size={16} />}
              <span>{isSavingTag ? 'Saving...' : 'Add Tag'}</span>
            </button>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-3">Existing Tags</h4>
          {communityTags.length === 0 ? (
            <p className="text-gray-500 dark:text-slate-400 text-sm">No tags created yet.</p>
          ) : (
            <div className="space-y-2">
              {communityTags.map((tag) => (
                <div key={tag.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-gray-50 dark:bg-slate-900 rounded-lg gap-2">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-slate-100">{tag.tagName}</div>
                    <div className="text-sm text-gray-500 dark:text-slate-400">
                      ID: {tag.communityId}
                      {tag.communityName && ` • ${tag.communityName}`}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleDelete(tag.id)}
                    className="text-red-600 hover:text-red-800 transition-colors self-end sm:self-center"
                    title="Delete tag"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
