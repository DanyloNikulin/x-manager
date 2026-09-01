'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Tag, List, Loader2 } from 'lucide-react';
import ThreadComposer from './ThreadComposer';
import { useToast } from './ui/Toast';
import { ACCOUNT_SLOTS } from '@/lib/account-slots';
import type { CommunityTag, QueueItem, ScheduledPost, SchedulerProps } from './scheduler/types';
import { formatDateTimeForInput, isDateTimeInPast, parseDateTimeInput } from './scheduler/datetime';
import { CalendarBoard } from './scheduler/CalendarBoard';
import { QueuePanel } from './scheduler/QueuePanel';
import { PostComposer } from './scheduler/PostComposer';
import { TagManager } from './scheduler/TagManager';
import { PostHistory } from './scheduler/PostHistory';
import type { IGif } from '@giphy/js-types';

export default function Scheduler({ onUpdate, refreshTrigger, compact = false }: SchedulerProps) {
  const { toast } = useToast();
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [communityTags, setCommunityTags] = useState<CommunityTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'queue'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [selectedDateTime, setSelectedDateTime] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [showManageTags, setShowManageTags] = useState(false);
  const [visibleSlots, setVisibleSlots] = useState<number[]>([...ACCOUNT_SLOTS]);

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueText, setQueueText] = useState('');
  const [queueSlot, setQueueSlot] = useState(1);
  const [isAutoScheduling, setIsAutoScheduling] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  const [postText, setPostText] = useState('');
  const [selectedCommunityTag, setSelectedCommunityTag] = useState('');
  const [replyToTweetId, setReplyToTweetId] = useState('');
  const [selectedAccountSlot, setSelectedAccountSlot] = useState(1);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [attachedGifs, setAttachedGifs] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showThreadComposer, setShowThreadComposer] = useState(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchTerm, setGifSearchTerm] = useState('');
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [dateTimeError, setDateTimeError] = useState<string>('');

  const [newTagName, setNewTagName] = useState('');
  const [newCommunityId, setNewCommunityId] = useState('');
  const [newCommunityName, setNewCommunityName] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const preserveScrollPosition = useCallback((callback: () => void) => {
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;

    callback();

    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollTop;
      scrollContainer.scrollLeft = scrollLeft;
    });
  }, []);

  useEffect(() => {
    const urls = attachedImages.map(file => URL.createObjectURL(file));
    setImagePreviewUrls(urls);
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [attachedImages]);

  const fetchScheduledPosts = async () => {
    try {
      const response = await fetch('/api/scheduler/posts?include_metrics=true');
      if (response.ok) {
        const data = await response.json();
        setScheduledPosts(Array.isArray(data) ? data : Array.isArray(data.posts) ? data.posts : []);
      }
    } catch (error) {
      console.error('Error fetching scheduled posts:', error);
    }
  };

  const fetchCommunityTags = async () => {
    try {
      const response = await fetch('/api/scheduler/tags');
      if (response.ok) {
        const tags = await response.json();
        setCommunityTags(tags);
      }
    } catch (error) {
      console.error('Error fetching community tags:', error);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchScheduledPosts(), fetchCommunityTags()]);
    } catch (error) {
      console.error('Error fetching scheduler data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (refreshTrigger) {
      fetchScheduledPosts();
    }
  }, [refreshTrigger]);

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
        fetchQueue();
      }
    } catch (error) {
      console.error('Error adding to queue:', error);
    }
  };

  const removeFromQueue = async (id: number) => {
    try {
      await fetch(`/api/scheduler/queue/${id}`, { method: 'DELETE' });
      fetchQueue();
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
        const result = await response.json();
        console.log(`Auto-scheduled ${result.scheduled} posts`);
        fetchQueue();
        fetchScheduledPosts();
      }
    } catch (error) {
      console.error('Error auto-scheduling:', error);
    } finally {
      setIsAutoScheduling(false);
    }
  };

  const handleBulkAction = async (action: string) => {
    if (selectedPostIds.size === 0) return;
    try {
      const response = await fetch('/api/scheduler/posts/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds: Array.from(selectedPostIds), action }),
      });
      if (response.ok) {
        setSelectedPostIds(new Set());
        setBulkMode(false);
        fetchScheduledPosts();
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
    }
  };

  useEffect(() => {
    if (viewMode === 'queue') {
      fetchQueue();
    }
  }, [viewMode, queueSlot]);

  const toggleSlotVisibility = (slot: number) => {
    setVisibleSlots(prev =>
      prev.includes(slot)
        ? prev.filter(s => s !== slot)
        : [...prev, slot],
    );
  };

  const handleDragStart = (postId: string) => {
    setDraggedPostId(postId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnDate = async (targetDate: Date, targetHour?: number) => {
    if (!draggedPostId) return;
    setDraggedPostId(null);

    const post = scheduledPosts.find((p) => String(p.id) === draggedPostId);
    if (!post || post.status !== 'scheduled') return;

    const newTime = new Date(targetDate);
    if (targetHour !== undefined) {
      newTime.setHours(targetHour, 0, 0, 0);
    } else {
      const orig = new Date(post.scheduledTime);
      newTime.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    }

    try {
      const response = await fetch('/api/scheduler/posts/reschedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: Number(draggedPostId), newScheduledTime: newTime.toISOString() }),
      });
      if (response.ok) {
        await fetchScheduledPosts();
      }
    } catch (error) {
      console.error('Failed to reschedule post:', error);
    }
  };

  const handlePreviousWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() - 7);
    setCurrentWeek(newWeek);
  };

  const handleNextWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() + 7);
    setCurrentWeek(newWeek);
  };

  const navigatePrev = () => {
    if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else if (viewMode === 'week') {
      handlePreviousWeek();
    } else {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() - 1);
      setCurrentDate(d);
    }
  };

  const navigateNext = () => {
    if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else if (viewMode === 'week') {
      handleNextWeek();
    } else {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() + 1);
      setCurrentDate(d);
    }
  };

  const navigateToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setCurrentWeek(today);
  };

  const resetAttachments = () => {
    setAttachedImages([]);
    setAttachedGifs([]);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setGifSearchTerm('');
  };

  const resetForm = () => {
    setPostText('');
    setSelectedDateTime('');
    setSelectedCommunityTag('');
    setReplyToTweetId('');
    setSelectedAccountSlot(1);
    setDateTimeError('');
    resetAttachments();
  };

  const validateDateTime = (value: string) => {
    if (!value) {
      setDateTimeError('');
      return true;
    }

    if (isDateTimeInPast(value)) {
      setDateTimeError('Cannot schedule posts in the past. Please select a future date and time.');
      return false;
    }

    setDateTimeError('');
    return true;
  };

  const handleCreatePost = (date?: Date) => {
    const now = new Date();
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);

    const defaultDateTime = formatDateTimeForInput(targetDate);
    resetForm();
    setSelectedDateTime(defaultDateTime);
    validateDateTime(defaultDateTime);
    setShowCreateForm(true);
    setEditingPost(null);
  };

  const handleEditPost = useCallback((post: ScheduledPost) => {
    setEditingPost(post);
    setPostText(post.text);
    const postDate = new Date(post.scheduledTime);
    const dateTimeValue = formatDateTimeForInput(postDate);
    setSelectedDateTime(dateTimeValue);
    validateDateTime(dateTimeValue);

    const communityTag = communityTags.find(tag => tag.communityId === post.communityId);
    setSelectedCommunityTag(communityTag?.tagName || '');
    setReplyToTweetId(post.replyToTweetId || '');
    setSelectedAccountSlot(post.accountSlot || 1);

    setShowCreateForm(true);
    resetAttachments();
  }, [communityTags]);

  const handleSubmitPost = useCallback(async () => {
    if (!postText.trim() || !selectedDateTime) return;

    const scheduledDateTime = parseDateTimeInput(selectedDateTime);
    if (!scheduledDateTime) {
      setDateTimeError('Please select a valid date and time.');
      return;
    }

    if (scheduledDateTime < new Date()) {
      setDateTimeError('Cannot schedule posts in the past. Please select a future date and time.');
      return;
    }

    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;

    setIsSubmitting(true);

    try {
      const selectedTag = communityTags.find(tag => tag.tagName === selectedCommunityTag);

      const formData = new FormData();
      formData.append('text', postText);
      formData.append('scheduled_time', scheduledDateTime.toISOString());
      formData.append('account_slot', String(selectedAccountSlot));
      if (selectedTag) {
        formData.append('community_id', selectedTag.communityId);
      }
      if (replyToTweetId.trim()) {
        formData.append('reply_to_tweet_id', replyToTweetId.trim());
      }

      attachedImages.forEach(file => {
        formData.append('files', file);
      });

      for (const gifUrl of attachedGifs) {
        try {
          const response = await fetch(gifUrl);
          const blob = await response.blob();
          const file = new File([blob], `gif_${Date.now()}.gif`, { type: 'image/gif' });
          formData.append('files', file);
        } catch (error) {
          console.error('Error processing GIF:', error);
        }
      }

      const url = editingPost
        ? `/api/scheduler/posts/${editingPost.id}`
        : '/api/scheduler/posts';

      const method = editingPost ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        body: formData,
      });

      if (response.ok) {
        await fetchScheduledPosts();
        setShowCreateForm(false);
        resetForm();
        toast({ variant: 'success', title: editingPost ? 'Post updated' : 'Post scheduled' });
        if (!editingPost) {
          onUpdate?.();
        }

        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to save post');
      }
    } catch (error) {
      console.error('Error saving post:', error);
      toast({ variant: 'error', title: 'Save failed', description: 'Failed to save post. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  }, [postText, selectedDateTime, selectedAccountSlot, editingPost, communityTags, selectedCommunityTag, replyToTweetId, attachedImages, attachedGifs, onUpdate]);

  const handleDeletePost = useCallback(async (postId: string) => {
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;

    try {
      const response = await fetch(`/api/scheduler/posts/${postId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchScheduledPosts();
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to delete post');
      }
    } catch (error) {
      console.error('Error deleting post:', error);
      toast({ variant: 'error', title: 'Delete failed', description: 'Failed to delete post. Please try again.' });
    }
  }, []);

  const handleClearAllPosts = useCallback(async () => {
    if (scheduledPosts.length === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete all ${scheduledPosts.length} scheduled posts? This action cannot be undone.`,
    );

    if (!confirmed) return;

    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;

    try {
      const response = await fetch('/api/scheduler/posts', {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchScheduledPosts();
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to delete all posts');
      }
    } catch (error) {
      console.error('Error deleting all posts:', error);
      toast({ variant: 'error', title: 'Delete failed', description: 'Failed to delete all posts. Please try again.' });
    }
  }, [scheduledPosts.length]);

  const handleSaveTag = async () => {
    if (!newTagName.trim() || !newCommunityId.trim()) return;

    setIsSavingTag(true);

    try {
      const response = await fetch('/api/scheduler/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tag_name: newTagName,
          community_id: newCommunityId,
          community_name: newCommunityName || undefined,
        }),
      });

      if (response.ok) {
        await fetchCommunityTags();
        setNewTagName('');
        setNewCommunityId('');
        setNewCommunityName('');
        setShowManageTags(false);
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

  const handleDeleteTag = async (tagId: string) => {
    if (!confirm('Are you sure you want to delete this tag?')) return;

    try {
      const response = await fetch(`/api/scheduler/tags/${tagId}`, { method: 'DELETE' });
      if (response.ok) {
        await fetchCommunityTags();
      } else {
        throw new Error('Failed to delete tag');
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast({ variant: 'error', title: 'Tag delete failed', description: 'Failed to delete tag. Please try again.' });
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setPostText(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleImageAttach = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const imageFiles = Array.from(files).filter(file =>
        file.type.startsWith('image/') && file.type !== 'image/gif',
      );

      const currentImageCount = attachedImages.filter(f => f.type !== 'image/gif').length;
      const availableSlots = 4 - currentImageCount;
      const allowedNewFiles = imageFiles.slice(0, availableSlots);

      if (imageFiles.length > availableSlots) {
        toast({ variant: 'warning', title: 'Image limit', description: `Max 4 images. ${imageFiles.length - availableSlots} files were not added.` });
      }

      setAttachedImages(prev => [...prev, ...allowedNewFiles]);
    }
  };

  const handleGifSelect = async (gif: IGif, e: React.SyntheticEvent) => {
    e.preventDefault();

    if (attachedGifs.length >= 1) {
      toast({ variant: 'warning', title: 'GIF limit', description: 'You can only attach 1 GIF at a time.' });
      return;
    }

    const gifUrl = gif.images.original.url;
    setAttachedGifs(prev => [...prev, gifUrl]);
    setShowGifPicker(false);
  };

  const removeAttachedImage = (index: number) => {
    if (imagePreviewUrls[index]) {
      URL.revokeObjectURL(imagePreviewUrls[index]);
    }
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeAttachedGif = (index: number) => {
    setAttachedGifs(prev => prev.filter((_, i) => i !== index));
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
           <button
             onClick={() => toggleSlotVisibility(1)}
             className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
               visibleSlots.includes(1)
                 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm'
                 : 'text-slate-500 hover:bg-slate-50'
             }`}
           >
             <span className={`w-2 h-2 rounded-full ${visibleSlots.includes(1) ? 'bg-indigo-500' : 'bg-slate-300'}`}></span>
             Account 1
           </button>
           <button
             onClick={() => toggleSlotVisibility(2)}
             className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
               visibleSlots.includes(2)
                 ? 'bg-amber-50 text-amber-700 border border-amber-200 shadow-sm'
                 : 'text-slate-500 hover:bg-slate-50'
             }`}
           >
             <span className={`w-2 h-2 rounded-full ${visibleSlots.includes(2) ? 'bg-amber-500' : 'bg-slate-300'}`}></span>
             Account 2
           </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowManageTags(true)}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors w-full sm:w-auto"
          >
            <Tag size={16} />
            <span>Manage Tags</span>
          </button>
          <button
            onClick={() => setShowThreadComposer(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors w-full sm:w-auto justify-center"
          >
            <List size={14} />
            Thread
          </button>
          <button
            onClick={() => handleCreatePost()}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto"
          >
            <Plus size={16} />
            <span>Create Post</span>
          </button>
        </div>
      </div>
      )}

      {compact && (
        <div className="flex items-center justify-between mb-2 px-1">
           <div className="flex gap-2">
             <button
                onClick={() => setShowManageTags(true)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                title="Manage Tags"
              >
                <Tag size={16} />
              </button>
           </div>
           <div className="flex gap-2">
             <button
               onClick={() => setShowThreadComposer(true)}
               className="p-1.5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
               title="New Thread"
             >
               <List size={16} />
             </button>
             <button
               onClick={() => handleCreatePost()}
               className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
               title="New Post"
             >
               <Plus size={16} />
             </button>
           </div>
        </div>
      )}

      <CalendarBoard
        compact={compact}
        viewMode={viewMode}
        setViewMode={setViewMode}
        currentDate={currentDate}
        setCurrentDate={setCurrentDate}
        currentWeek={currentWeek}
        scheduledPosts={scheduledPosts}
        visibleSlots={visibleSlots}
        communityTags={communityTags}
        queueItems={queueItems}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        bulkMode={bulkMode}
        setBulkMode={setBulkMode}
        selectedPostIds={selectedPostIds}
        setSelectedPostIds={setSelectedPostIds}
        handleBulkAction={handleBulkAction}
        navigatePrev={navigatePrev}
        navigateToday={navigateToday}
        navigateNext={navigateNext}
        handleCreatePost={handleCreatePost}
        handleEditPost={handleEditPost}
        handleDeletePost={handleDeletePost}
        handleDragStart={handleDragStart}
        handleDragOver={handleDragOver}
        handleDropOnDate={handleDropOnDate}
      >
        {!compact && viewMode === 'queue' && (
          <QueuePanel
            queueItems={queueItems}
            queueSlot={queueSlot}
            queueText={queueText}
            isAutoScheduling={isAutoScheduling}
            communityTags={communityTags}
            onSlotChange={setQueueSlot}
            onTextChange={setQueueText}
            onAdd={addToQueue}
            onRemove={removeFromQueue}
            onAutoSchedule={autoScheduleQueue}
          />
        )}
      </CalendarBoard>

      {showCreateForm && (
        <PostComposer
          editingPost={editingPost}
          postText={postText}
          setPostText={setPostText}
          showEmojiPicker={showEmojiPicker}
          setShowEmojiPicker={setShowEmojiPicker}
          showGifPicker={showGifPicker}
          setShowGifPicker={setShowGifPicker}
          gifSearchTerm={gifSearchTerm}
          setGifSearchTerm={setGifSearchTerm}
          attachedGifs={attachedGifs}
          attachedImages={attachedImages}
          imagePreviewUrls={imagePreviewUrls}
          selectedDateTime={selectedDateTime}
          setSelectedDateTime={setSelectedDateTime}
          dateTimeError={dateTimeError}
          selectedAccountSlot={selectedAccountSlot}
          setSelectedAccountSlot={setSelectedAccountSlot}
          selectedCommunityTag={selectedCommunityTag}
          setSelectedCommunityTag={setSelectedCommunityTag}
          communityTags={communityTags}
          replyToTweetId={replyToTweetId}
          setReplyToTweetId={setReplyToTweetId}
          isSubmitting={isSubmitting}
          preserveScrollPosition={preserveScrollPosition}
          setShowCreateForm={setShowCreateForm}
          resetForm={resetForm}
          handleEmojiSelect={handleEmojiSelect}
          handleGifSelect={handleGifSelect}
          handleImageAttach={handleImageAttach}
          removeAttachedImage={removeAttachedImage}
          removeAttachedGif={removeAttachedGif}
          validateDateTime={validateDateTime}
          handleSubmitPost={handleSubmitPost}
        />
      )}

      {showManageTags && (
        <TagManager
          communityTags={communityTags}
          newTagName={newTagName}
          newCommunityId={newCommunityId}
          newCommunityName={newCommunityName}
          isSavingTag={isSavingTag}
          onClose={() => setShowManageTags(false)}
          onSave={handleSaveTag}
          onDelete={handleDeleteTag}
          setNewTagName={setNewTagName}
          setNewCommunityId={setNewCommunityId}
          setNewCommunityName={setNewCommunityName}
        />
      )}

      <PostHistory
        scheduledPosts={scheduledPosts}
        handleClearAllPosts={handleClearAllPosts}
        handleEditPost={handleEditPost}
        handleDeletePost={handleDeletePost}
      />

      {showThreadComposer && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/60 overflow-y-auto pt-8 pb-8 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowThreadComposer(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowThreadComposer(false); }}
        >
          <div className="w-full max-w-2xl">
            <ThreadComposer
              onSubmit={async (tweets, scheduledTime) => {
                try {
                  const response = await fetch('/api/scheduler/thread', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tweets: tweets.map(text => ({ text })),
                      account_slot: selectedAccountSlot,
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
                }
              }}
              onCancel={() => setShowThreadComposer(false)}
              isSubmitting={isSubmitting}
            />
          </div>
        </div>
      )}
    </div>
  );
}
