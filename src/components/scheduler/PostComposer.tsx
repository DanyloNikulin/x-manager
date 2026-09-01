'use client';

import { useEffect, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { Smile, ImageIcon, X, Save, Loader2, Sparkles } from 'lucide-react';
import { MdOutlineGifBox } from "react-icons/md";
import EmojiPicker, { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import type { IGif } from '@giphy/js-types';
import AiWriter from '../AiWriter';
import type { CommunityTag, ScheduledPost } from './types';
import { defaultFutureDateTime, formatDateTimeForInput, isDateTimeInPast, parseDateTimeInput } from './datetime';
import { useToast } from '../ui/Toast';
import ModalPortal from '../ui/ModalPortal';

const gf = new GiphyFetch(process.env.NEXT_PUBLIC_GIPHY_API_KEY || '__REMOVED__');

interface PostComposerProps {
  editingPost: ScheduledPost | null;
  seedDate?: Date;
  communityTags: CommunityTag[];
  onClose: () => void;
  onSaved: () => void;
}

export function PostComposer({
  editingPost,
  seedDate,
  communityTags,
  onClose,
  onSaved,
}: PostComposerProps) {
  const { toast } = useToast();
  const [postText, setPostText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchTerm, setGifSearchTerm] = useState('');
  const [attachedGifs, setAttachedGifs] = useState<string[]>([]);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [selectedDateTime, setSelectedDateTime] = useState('');
  const [dateTimeError, setDateTimeError] = useState('');
  const [selectedAccountSlot, setSelectedAccountSlot] = useState(1);
  const [selectedCommunityTag, setSelectedCommunityTag] = useState('');
  const [replyToTweetId, setReplyToTweetId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const urls = attachedImages.map((file) => URL.createObjectURL(file));
    setImagePreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [attachedImages]);

  useEffect(() => {
    if (editingPost) {
      setPostText(editingPost.text);
      const dateTimeValue = formatDateTimeForInput(new Date(editingPost.scheduledTime));
      setSelectedDateTime(dateTimeValue);
      setDateTimeError(isDateTimeInPast(dateTimeValue) ? 'Cannot schedule posts in the past. Please select a future date and time.' : '');
      const communityTag = communityTags.find((tag) => tag.communityId === editingPost.communityId);
      setSelectedCommunityTag(communityTag?.tagName || '');
      setReplyToTweetId(editingPost.replyToTweetId || '');
      setSelectedAccountSlot(editingPost.accountSlot || 1);
      setAttachedImages([]);
      setAttachedGifs([]);
      return;
    }
    const targetDate = seedDate ? new Date(seedDate) : new Date();
    if (!seedDate) {
      const defaultDateTime = defaultFutureDateTime();
      setPostText('');
      setSelectedDateTime(defaultDateTime);
      setSelectedCommunityTag('');
      setReplyToTweetId('');
      setSelectedAccountSlot(1);
      setDateTimeError('');
      setAttachedImages([]);
      setAttachedGifs([]);
      return;
    }
    const now = new Date();
    targetDate.setHours(now.getHours(), now.getMinutes() + 15, 0, 0);
    if (targetDate <= now) {
      const fallback = new Date();
      fallback.setSeconds(0, 0);
      fallback.setMinutes(fallback.getMinutes() + 15);
      targetDate.setTime(fallback.getTime());
    }
    const defaultDateTime = formatDateTimeForInput(targetDate);
    setPostText('');
    setSelectedDateTime(defaultDateTime);
    setSelectedCommunityTag('');
    setReplyToTweetId('');
    setSelectedAccountSlot(1);
    setDateTimeError(isDateTimeInPast(defaultDateTime) ? 'Cannot schedule posts in the past. Please select a future date and time.' : '');
    setAttachedImages([]);
    setAttachedGifs([]);
  }, [editingPost, seedDate, communityTags]);

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

  const handleEmojiSelect = (emoji: string) => {
    setPostText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleImageAttach = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/') && file.type !== 'image/gif');
    const currentImageCount = attachedImages.filter((file) => file.type !== 'image/gif').length;
    const availableSlots = 4 - currentImageCount;
    const allowedNewFiles = imageFiles.slice(0, availableSlots);
    if (imageFiles.length > availableSlots) {
      toast({ variant: 'warning', title: 'Image limit', description: `Max 4 images. ${imageFiles.length - availableSlots} files were not added.` });
    }
    setAttachedImages((prev) => [...prev, ...allowedNewFiles]);
  };

  const handleGifSelect = async (gif: IGif, e: SyntheticEvent) => {
    e.preventDefault();
    if (attachedGifs.length >= 1) {
      toast({ variant: 'warning', title: 'GIF limit', description: 'You can only attach 1 GIF at a time.' });
      return;
    }
    setAttachedGifs((prev) => [...prev, gif.images.original.url]);
    setShowGifPicker(false);
  };

  const handleSubmitPost = async () => {
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
    setIsSubmitting(true);
    try {
      const selectedTag = communityTags.find((tag) => tag.tagName === selectedCommunityTag);
      const formData = new FormData();
      formData.append('text', postText);
      formData.append('scheduled_time', scheduledDateTime.toISOString());
      formData.append('account_slot', String(selectedAccountSlot));
      if (selectedTag) formData.append('community_id', selectedTag.communityId);
      if (replyToTweetId.trim()) formData.append('reply_to_tweet_id', replyToTweetId.trim());
      attachedImages.forEach((file) => formData.append('files', file));
      for (const gifUrl of attachedGifs) {
        try {
          const response = await fetch(gifUrl);
          const blob = await response.blob();
          formData.append('files', new File([blob], `gif_${Date.now()}.gif`, { type: 'image/gif' }));
        } catch (error) {
          console.error('Error processing GIF:', error);
        }
      }
      const response = await fetch(
        editingPost ? `/api/scheduler/posts/${editingPost.id}` : '/api/scheduler/posts',
        { method: editingPost ? 'PUT' : 'POST', body: formData },
      );
      if (!response.ok) throw new Error('Failed to save post');
      toast({ variant: 'success', title: editingPost ? 'Post updated' : 'Post scheduled' });
      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving post:', error);
      toast({ variant: 'error', title: 'Save failed', description: 'Failed to save post. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeAttachedGif = (index: number) => {
    setAttachedGifs((prev) => prev.filter((_, i) => i !== index));
  };

  const fetchGifs = (offset: number) => {
    if (gifSearchTerm.trim()) {
      return gf.search(gifSearchTerm, { offset, limit: 10 });
    } else {
      return gf.trending({ offset, limit: 10 });
    }
  };

  return (
    <ModalPortal>
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 sm:p-6 w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                {editingPost ? 'Edit Scheduled Post' : 'Create Scheduled Post'}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Post Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Post Content
                </label>
                <div className="space-y-0">
                  <textarea
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    placeholder="What's happening?"
                    className="w-full p-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-400"
                    rows={4}
                    maxLength={280}
                  />
                  
                  {/* Character count and tools */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 px-1">
                    <div className="flex items-center space-x-1 order-2 sm:order-1">
                      {/* Emoji Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 rounded transition-colors"
                          title="Add emoji"
                        >
                          <Smile size={18} />
                        </button>
                        
                        {showEmojiPicker && (
                          <div className="absolute bottom-full left-0 mb-2 z-20">
                            <EmojiPicker
                              onEmojiClick={(emoji: EmojiClickData) => handleEmojiSelect(emoji.emoji)}
                              emojiStyle={EmojiStyle.NATIVE}
                              theme={Theme.LIGHT}
                              searchPlaceHolder="Search emojis..."
                              lazyLoadEmojis={true}
                              previewConfig={{
                                showPreview: false
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* GIF Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setGifSearchTerm('');
                            setShowGifPicker(!showGifPicker);
                          }}
                          className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 rounded transition-colors"
                          title="Add GIF"
                          disabled={attachedGifs.length >= 1}
                        >
                          <MdOutlineGifBox size={20} />
                        </button>
                        
                        {showGifPicker && (
                          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 w-full max-w-sm sm:max-w-md h-96 overflow-hidden">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Choose a GIF</h3>
                                <button
                                  onClick={() => setShowGifPicker(false)}
                                  className="text-gray-500 dark:text-slate-400 hover:text-gray-700"
                                >
                                  <X size={18} />
                                </button>
                              </div>
                              
                              <div className="mb-4">
                                <input
                                  type="text"
                                  placeholder="Search GIFs..."
                                  value={gifSearchTerm}
                                  onChange={(e) => setGifSearchTerm(e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                                />
                              </div>
                              
                              <div className="overflow-auto" style={{ height: 'calc(100% - 120px)' }}>
                                <Grid
                                  key={gifSearchTerm}
                                  width={280}
                                  columns={2}
                                  fetchGifs={fetchGifs}
                                  onGifClick={handleGifSelect}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Image Button */}
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageAttach}
                          className="hidden"
                          id="image-upload-scheduler"
                        />
                        <label
                          htmlFor="image-upload-scheduler"
                          className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 rounded transition-colors cursor-pointer inline-flex"
                          title="Attach image"
                        >
                          <ImageIcon size={18} />
                        </label>
                      </div>
                    </div>

                    <div className="text-sm text-gray-500 dark:text-slate-400 order-1 sm:order-2">
                      {postText.length}/280
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Writer */}
              <AiWriter
                onInsert={(text) => setPostText(text)}
                existingText={postText}
              />

              {/* Attached Images */}
              {attachedImages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Attached Images:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {attachedImages.map((image, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={imagePreviewUrls[index]}
                          alt={`Attached image ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border border-gray-200 dark:border-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttachedImage(index)}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attached GIFs */}
              {attachedGifs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Attached GIFs:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {attachedGifs.map((gifUrl, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={gifUrl}
                          alt={`Attached GIF ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border border-gray-200 dark:border-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttachedGif(index)}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Date and Time */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={selectedDateTime}
                    onChange={(e) => {
                      setSelectedDateTime(e.target.value);
                      validateDateTime(e.target.value);
                    }}
                    min={formatDateTimeForInput(new Date())}
                    className="w-full min-w-[16rem] p-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                    required
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/scheduler/suggest-time?account_slot=${selectedAccountSlot}&count=1`);
                        if (res.ok) {
                          const data = await res.json();
                          if (data.recommended) {
                            const dt = new Date(data.recommended);
                            setSelectedDateTime(formatDateTimeForInput(dt));
                          }
                        }
                      } catch {}
                    }}
                    className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 mt-1"
                  >
                    <Sparkles size={12} />
                    Suggest best time
                  </button>
                </div>

                {/* Date/Time Error Message */}
                {dateTimeError && (
                  <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                    {dateTimeError}
                  </div>
                )}
              </div>

              {/* Community Tag */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  X Account
                </label>
                <select
                  value={selectedAccountSlot}
                  onChange={(e) => setSelectedAccountSlot(Number(e.target.value))}
                  className="w-full p-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  <option value={1}>Account 1</option>
                  <option value={2}>Account 2</option>
                  <option value={3}>Account 3</option>
                </select>
              </div>

              {/* Community Tag */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Community (Optional)
                </label>
                <select
                  value={selectedCommunityTag}
                  onChange={(e) => setSelectedCommunityTag(e.target.value)}
                  className="w-full p-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  <option value="">Select a community...</option>
                  {communityTags.map((tag) => (
                    <option key={tag.id} value={tag.tagName}>
                      {tag.tagName} {tag.communityName && `(${tag.communityName})`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Reply To Post ID (Optional)
                </label>
                <input
                  type="text"
                  value={replyToTweetId}
                  onChange={(e) => setReplyToTweetId(e.target.value)}
                  placeholder="e.g. 1893289302711484472"
                  className="w-full p-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  If set, this scheduled post will be published as a reply thread item.
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 dark:text-slate-300 hover:text-gray-800 dark:hover:text-slate-100 transition-colors order-2 sm:order-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitPost}
                  disabled={!postText.trim() || !selectedDateTime || isSubmitting || !!dateTimeError}
                  className="flex items-center justify-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2"
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  <span>{isSubmitting ? 'Saving...' : editingPost ? 'Update Post' : 'Schedule Post'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
    </ModalPortal>
  );
}
