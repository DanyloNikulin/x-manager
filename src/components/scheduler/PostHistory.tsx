'use client';

import { Calendar, Edit, Trash2 } from 'lucide-react';
import type { ScheduledPost } from './types';
import { getMediaCount, getStatusColor, getStatusIcon } from './status';

interface PostHistoryProps {
  scheduledPosts: ScheduledPost[];
  handleClearAllPosts: () => void;
  handleEditPost: (post: ScheduledPost) => void;
  handleDeletePost: (postId: string) => void;
}

export function PostHistory({
  scheduledPosts,
  handleClearAllPosts,
  handleEditPost,
  handleDeletePost,
}: PostHistoryProps) {
  return (
      <div className="dashboard-card dark:bg-slate-800 dark:border-slate-700">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100">Scheduled Posts History</h3>
          {scheduledPosts.length > 0 && (
            <button
              onClick={handleClearAllPosts}
              className="flex items-center space-x-2 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-300 hover:border-red-400 rounded-md transition-colors"
            >
              <Trash2 size={14} />
              <span>Clear All</span>
            </button>
          )}
        </div>
        <div className="p-4 sm:p-6">
          {scheduledPosts.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="mx-auto h-12 w-12 text-gray-400 dark:text-slate-500 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100 mb-2">No scheduled posts</h3>
              <p className="text-gray-500 dark:text-slate-400">
                Create your first scheduled post to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {scheduledPosts
                .sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime())
                .map((post) => (
                  <div key={post.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 dark:bg-slate-800/50">
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                      <div className="flex-1 w-full">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2">
                          <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-sm ${getStatusColor(post.status)}`}>
                            {getStatusIcon(post.status)}
                            <span className="capitalize">{post.status}</span>
                          </div>
                          <div className="text-sm text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                            Account #{post.accountSlot || 1}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-slate-400">
                            {new Date(post.scheduledTime).toLocaleString()}
                          </div>
                          {post.communityId && (
                            <div className="text-sm text-blue-600">
                              🏘️ Community Post
                            </div>
                          )}
                          {post.replyToTweetId && (
                            <div className="text-sm text-cyan-700">
                              💬 Reply Thread
                            </div>
                          )}
                        </div>
                        <p className="text-gray-900 dark:text-slate-100 mb-2 leading-relaxed">{post.text}</p>
                        {post.replyToTweetId && (
                          <div className="text-sm text-cyan-700 mb-2">
                            Replying to post: {post.replyToTweetId}
                          </div>
                        )}
                        {getMediaCount(post) > 0 && (
                          <div className="text-sm text-gray-500 dark:text-slate-400 mb-2">
                            📎 {getMediaCount(post)} media file(s)
                          </div>
                        )}
                        {post.errorMessage && (
                          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                            Error: {post.errorMessage}
                          </div>
                        )}
                        {(post.twitterPostId || post.twitter_post_id) && (
                          <div className="text-sm text-green-600">
                            Posted on X: {post.twitterPostId || post.twitter_post_id}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                        {post.status === 'scheduled' && (
                          <>
                            <button
                              onClick={() => handleEditPost(post)}
                              className="p-2 text-gray-400 dark:text-slate-500 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                handleDeletePost(post.id);
                              }}
                              className="p-2 text-gray-400 dark:text-slate-500 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
  );
}
