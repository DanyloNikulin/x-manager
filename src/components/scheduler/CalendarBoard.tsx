'use client';

import { useState, type DragEvent } from 'react';
import { Edit, Trash2, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarViewMode, CommunityTag, ScheduledPost } from './types';
import { formatDateForDisplay, formatTimeForDisplay, generateWeekDays, getMonthDays } from './datetime';
import { getMediaCount, getStatusColor, getStatusIcon } from './status';
import { QueuePanel } from './QueuePanel';

function groupUpcomingPosts(posts: ScheduledPost[], visibleSlots: number[]) {
  const upcoming = posts
    .filter((post) => post.status === 'scheduled' && visibleSlots.includes(post.accountSlot || 1))
    .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());

  const groups: ScheduledPost[][] = [];
  const seen = new Set<string>();
  for (const post of upcoming) {
    const id = String(post.id);
    if (seen.has(id)) continue;
    const threadId = post.threadId;
    if (threadId) {
      const thread = upcoming
        .filter((item) => item.threadId === threadId)
        .sort((a, b) => (a.threadIndex ?? 0) - (b.threadIndex ?? 0));
      thread.forEach((item) => seen.add(String(item.id)));
      groups.push(thread);
    } else {
      seen.add(id);
      groups.push([post]);
    }
  }
  return groups;
}

interface CalendarBoardProps {
  compact: boolean;
  scheduledPosts: ScheduledPost[];
  visibleSlots: number[];
  communityTags: CommunityTag[];
  onCreatePost: (date?: Date) => void;
  onEditPost: (post: ScheduledPost) => void;
  onDeletePost: (postId: string) => void;
  onDropOnDate: (targetDate: Date, targetHour?: number) => void;
  onDragStart: (postId: string) => void;
  onBulkAction: (action: string, postIds: string[]) => void;
  onPostsChanged?: () => void;
}

export function CalendarBoard({
  compact,
  scheduledPosts,
  visibleSlots,
  communityTags,
  onCreatePost,
  onEditPost,
  onDeletePost,
  onDropOnDate,
  onDragStart,
  onBulkAction,
  onPostsChanged,
}: CalendarBoardProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());

  const weekDays = generateWeekDays(currentWeek);

  const navigatePrev = () => {
    if (viewMode === 'day') {
      const next = new Date(currentDate);
      next.setDate(next.getDate() - 1);
      setCurrentDate(next);
    } else if (viewMode === 'week') {
      const next = new Date(currentWeek);
      next.setDate(next.getDate() - 7);
      setCurrentWeek(next);
    } else {
      const next = new Date(currentDate);
      next.setMonth(next.getMonth() - 1);
      setCurrentDate(next);
    }
  };

  const navigateNext = () => {
    if (viewMode === 'day') {
      const next = new Date(currentDate);
      next.setDate(next.getDate() + 1);
      setCurrentDate(next);
    } else if (viewMode === 'week') {
      const next = new Date(currentWeek);
      next.setDate(next.getDate() + 7);
      setCurrentWeek(next);
    } else {
      const next = new Date(currentDate);
      next.setMonth(next.getMonth() + 1);
      setCurrentDate(next);
    }
  };

  const navigateToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setCurrentWeek(today);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const getPostsForDate = (date: Date) => {
    const dateString = date.toDateString();
    const postsForDate = scheduledPosts.filter(post => {
      const postDate = new Date(post.scheduledTime);
      // Filter by date AND visible slots
      return postDate.toDateString() === dateString && visibleSlots.includes(post.accountSlot || 1);
    });
    
    // Sort by time (earliest to latest) and limit to 17 posts
    return postsForDate
      .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())
      .slice(0, 17);
  };

  const getHourSlots = () => {
    return Array.from({ length: 24 }, (_, h) => h);
  };

  const getPostsForHour = (date: Date, hour: number) => {
    return scheduledPosts.filter((post) => {
      const postDate = new Date(post.scheduledTime);
      return (
        postDate.toDateString() === date.toDateString() &&
        postDate.getHours() === hour &&
        visibleSlots.includes(post.accountSlot || 1)
      );
    });
  };

  const compactGroups = compact ? groupUpcomingPosts(scheduledPosts, visibleSlots) : [];

  return (
    <>
      {/* Search and Filter Bar */}
      {!compact && (
        <div className="dashboard-card p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search posts..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
            >
              <option value="">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted">Posted</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedPostIds(new Set()); }}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                bulkMode ? 'bg-slate-900 text-white' : 'bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
            >
              {bulkMode ? 'Cancel Bulk' : 'Bulk Select'}
            </button>
            {bulkMode && selectedPostIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-slate-300">{selectedPostIds.size} selected</span>
                <button onClick={() => onBulkAction('cancel', Array.from(selectedPostIds))} className="px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded-lg text-xs font-medium hover:bg-yellow-200">Cancel</button>
                <button onClick={() => onBulkAction('delete', Array.from(selectedPostIds))} className="px-3 py-1.5 bg-red-100 text-red-800 rounded-lg text-xs font-medium hover:bg-red-200">Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calendar View */}
      <div className={compact ? "overflow-hidden" : "dashboard-card overflow-hidden"}>
        {/* Calendar Header */}
        {!compact && (
        <div className="bg-gray-50 dark:bg-slate-900 px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100">
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {viewMode === 'week' && `Week of ${formatDateForDisplay(weekDays[0])}`}
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'queue' && 'Content Queue'}
            </h3>
            <div className="flex items-center gap-3">
              {/* View mode toggle */}
              <div className="flex bg-white dark:bg-slate-800 border border-slate-200 rounded-lg p-0.5">
                {(['day', 'week', 'month', 'queue'] as CalendarViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all capitalize ${
                      viewMode === mode
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {mode === 'queue' ? 'Queue' : mode}
                  </button>
                ))}
              </div>
              <div className="flex items-center space-x-1">
                <button onClick={navigatePrev} className="p-2 text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-md transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={navigateToday} className="px-3 py-1 text-sm text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-md transition-colors">
                  Today
                </button>
                <button onClick={navigateNext} className="p-2 text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-md transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {compact && (
           <div className="space-y-3">
             {compactGroups.length === 0 ? (
                   <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                     <p className="text-sm">No upcoming posts.</p>
                   </div>
             ) : (
               compactGroups.map((group) => {
                 const lead = group[0];
                 const isThread = group.length > 1;
                 return (
                   <div
                     key={lead.threadId || lead.id}
                     className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                   >
                     <div className="mb-2 flex items-start justify-between gap-2">
                       <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                         {new Date(lead.scheduledTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                         {' • '}
                         {formatTimeForDisplay(lead.scheduledTime)}
                         {isThread ? ` • ${group.length}-post thread` : ''}
                       </span>
                       <div className="flex shrink-0 gap-1">
                         <button type="button" onClick={() => onEditPost(lead)} className="text-slate-400 hover:text-blue-600" title="Edit">
                           <Edit size={12} />
                         </button>
                         <button
                           type="button"
                           onClick={() => group.forEach((post) => onDeletePost(post.id))}
                           className="text-slate-400 hover:text-red-600"
                           title={isThread ? 'Delete thread' : 'Delete'}
                         >
                           <Trash2 size={12} />
                         </button>
                       </div>
                     </div>
                     <div className="space-y-2">
                       {group.map((post, index) => (
                         <div key={post.id} className={index > 0 ? 'border-t border-slate-100 pt-2 dark:border-slate-700' : ''}>
                           {isThread && (
                             <p className="mb-0.5 text-[11px] font-medium text-slate-400">Tweet {index + 1}</p>
                           )}
                           <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{post.text}</p>
                         </div>
                       ))}
                     </div>
                     <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                       <span>Slot {lead.accountSlot || 1}</span>
                       {getMediaCount(lead) > 0 && <span>• 📎 {getMediaCount(lead)}</span>}
                     </div>
                   </div>
                 );
               })
             )}
           </div>
        )}

        {/* Calendar Grid - Mobile: Single column, Desktop: 7 columns */}
        {!compact && (
        <div className="block sm:hidden">
          {/* Mobile View - Stack days vertically */}
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {weekDays.map((day, index) => {
              const dayPosts = getPostsForDate(day);
              const isToday = day.toDateString() === new Date().toDateString();
              
              return (
                <div
                  key={index}
                  className={`p-4 ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-slate-800'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`text-base font-medium ${
                      isToday ? 'text-blue-600' : 'text-gray-900 dark:text-slate-100'
                    }`}>
                      {day.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                    <button
                      onClick={() => onCreatePost(day)}
                      className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
                      title="Add post"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  
                  {/* Posts for this day */}
                  {dayPosts.length > 0 ? (
                    <div className="space-y-2">
                      {dayPosts.map((post) => (
                        <div
                          key={post.id}
                          className="group relative p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-700 dark:text-slate-200 text-sm">
                              {formatTimeForDisplay(post.scheduledTime)}
                            </span>
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditPost(post);
                                }}
                                className="p-1 text-gray-400 dark:text-slate-500 hover:text-blue-600 transition-colors"
                                title="Edit"
                              >
                                <Edit size={14} />
                              </button>
                                                          <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onDeletePost(post.id);
                              }}
                              className="p-1 text-gray-400 dark:text-slate-500 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                            </div>
                          </div>
                          
                          <div className="text-gray-600 dark:text-slate-300 mb-2 text-sm leading-relaxed">
                            {post.text.length > 80 ? `${post.text.slice(0, 80)}...` : post.text}
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs ${getStatusColor(post.status)}`}>
                                {getStatusIcon(post.status)}
                                <span className="capitalize">{post.status}</span>
                              </div>
                              <div className="text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                                Account #{post.accountSlot || 1}
                              </div>
                              {post.communityId && (
                                <div className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-full">
                                  {communityTags.find(tag => tag.communityId === post.communityId)?.tagName || 'Community'}
                                </div>
                              )}
                              {post.replyToTweetId && (
                                <div className="text-xs text-cyan-700 bg-cyan-50 px-2 py-1 rounded-full">
                                  Reply
                                </div>
                              )}
                            </div>
                            {getMediaCount(post) > 0 && (
                              <div className="text-gray-400 dark:text-slate-500 text-xs">
                                📎 {getMediaCount(post)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-500 dark:text-slate-400 text-sm">
                      No posts scheduled
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Day View */}
        {!compact && viewMode === 'day' && (
          <div className="hidden sm:block">
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {getHourSlots().map((hour) => {
                const hourPosts = getPostsForHour(currentDate, hour);
                return (
                  <div
                    key={hour}
                    className="flex min-h-[48px] hover:bg-slate-50 transition-colors"
                    onDragOver={handleDragOver}
                    onDrop={() => onDropOnDate(currentDate, hour)}
                  >
                    <div className="w-16 flex-shrink-0 py-2 px-3 text-xs text-slate-500 font-medium border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 p-1 flex flex-wrap gap-1">
                      {hourPosts.map((post) => (
                        <div
                          key={post.id}
                          draggable={post.status === 'scheduled'}
                          onDragStart={() => onDragStart(String(post.id))}
                          className={`group relative p-2 rounded border text-xs cursor-grab active:cursor-grabbing flex-1 min-w-[200px] max-w-[400px] ${
                            (post.accountSlot || 1) === 1
                              ? 'bg-indigo-50/50 border-indigo-100 hover:border-indigo-300'
                              : 'bg-amber-50/50 border-amber-100 hover:border-amber-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{formatTimeForDisplay(post.scheduledTime)}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => onEditPost(post)} className="p-1 text-gray-400 dark:text-slate-500 hover:text-blue-600"><Edit size={12} /></button>
                              <button onClick={() => onDeletePost(post.id)} className="p-1 text-gray-400 dark:text-slate-500 hover:text-red-600"><Trash2 size={12} /></button>
                            </div>
                          </div>
                          <p className="text-gray-600 dark:text-slate-300 line-clamp-2">{post.text}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${getStatusColor(post.status)}`}>
                              {getStatusIcon(post.status)} {post.status}
                            </span>
                            <span className="text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full text-[10px]">#{post.accountSlot || 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Month View */}
        {!compact && viewMode === 'month' && (
          <div className="hidden sm:block">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-xs font-medium text-gray-600 dark:text-slate-300 text-center py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {getMonthDays(currentDate).map((day, idx) => {
                if (!day) {
                  return <div key={`pad-${idx}`} className="min-h-[80px] border-r border-b border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-900/50" />;
                }
                const dayPosts = getPostsForDate(day);
                const isToday = day.toDateString() === new Date().toDateString();
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[80px] border-r border-b border-gray-200 dark:border-slate-700 p-1 ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${!isCurrentMonth ? 'opacity-50' : ''}`}
                    onDragOver={handleDragOver}
                    onDrop={() => onDropOnDate(day)}
                    onClick={() => {
                      setCurrentDate(day);
                      setViewMode('day');
                    }}
                  >
                    <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-600' : 'text-gray-700 dark:text-slate-200'}`}>
                      {day.getDate()}
                    </div>
                    {dayPosts.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {dayPosts.slice(0, 3).map((post) => (
                          <div
                            key={post.id}
                            draggable={post.status === 'scheduled'}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              onDragStart(String(post.id));
                            }}
                            className={`w-full text-[10px] px-1 py-0.5 rounded truncate cursor-grab ${
                              (post.accountSlot || 1) === 1
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                            title={post.text}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {formatTimeForDisplay(post.scheduledTime)} {post.text.slice(0, 20)}
                          </div>
                        ))}
                        {dayPosts.length > 3 && (
                          <span className="text-[10px] text-gray-500 dark:text-slate-400 px-1">+{dayPosts.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Desktop View - 7 column grid (Week) */}
        {!compact && viewMode === 'week' && (
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-0">
            {weekDays.map((day, index) => {
              const dayPosts = getPostsForDate(day);
              const isToday = day.toDateString() === new Date().toDateString();
              
              return (
                <div
                  key={index}
                  className={`min-h-32 border-r border-b border-gray-200 dark:border-slate-700 p-2 ${
                    isToday ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-slate-800'
                  } last:border-r-0`}
                  onDragOver={handleDragOver}
                  onDrop={() => onDropOnDate(day)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-sm font-medium ${
                      isToday ? 'text-blue-600' : 'text-gray-900 dark:text-slate-100'
                    }`}>
                      {formatDateForDisplay(day)}
                    </div>
                    <button
                      onClick={() => onCreatePost(day)}
                      className="p-1 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
                      title="Add post"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  
                  {/* Posts for this day */}
                  <div className="space-y-1">
                                          {dayPosts.map((post) => (
                                          <div
                                            key={post.id}
                                            draggable={post.status === 'scheduled'}
                                            onDragStart={() => onDragStart(String(post.id))}
                                            className={`group relative p-2 rounded border text-xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                                              (post.accountSlot || 1) === 1
                                                ? 'bg-indigo-50/50 border-indigo-100 hover:border-indigo-300'
                                                : 'bg-amber-50/50 border-amber-100 hover:border-amber-300'
                                            }`}
                                          >
                                            <div className="flex items-center justify-between mb-1">
                                              <span className={`font-medium ${
                                                (post.accountSlot || 1) === 1 ? 'text-indigo-900' : 'text-amber-900'
                                              }`}>
                                                {formatTimeForDisplay(post.scheduledTime)}
                                              </span>
                                              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditPost(post);
                              }}
                              className="p-1 text-gray-400 dark:text-slate-500 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onDeletePost(post.id);
                              }}
                              className="p-1 text-gray-400 dark:text-slate-500 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        
                        <div className="text-gray-600 dark:text-slate-300 mb-1 line-clamp-2">
                          {post.text.length > 50 ? `${post.text.slice(0, 50)}...` : post.text}
                        </div>
                        
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <div className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs ${getStatusColor(post.status)}`}>
                                {getStatusIcon(post.status)}
                                <span className="capitalize">{post.status}</span>
                              </div>
                              <div className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                                #{post.accountSlot || 1}
                              </div>
                            </div>
                            {getMediaCount(post) > 0 && (
                              <div className="text-gray-400 dark:text-slate-500">
                                📎 {getMediaCount(post)}
                              </div>
                            )}
                          </div>
                          {post.communityId && (
                            <div className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full self-start">
                              {communityTags.find(tag => tag.communityId === post.communityId)?.tagName || 'Community'}
                            </div>
                          )}
                          {post.replyToTweetId && (
                            <div className="text-xs text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full self-start">
                              Reply
                            </div>
                          )}
                          {post.status === 'posted' && post.metrics && (
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-slate-400">
                              <span title="Likes">♥ {post.metrics.likes}</span>
                              <span title="Retweets">⟲ {post.metrics.retweets}</span>
                              <span title="Impressions">👁 {post.metrics.impressions}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {viewMode === 'queue' && <QueuePanel communityTags={communityTags} onScheduled={onPostsChanged} />}
      </div>
    </>
  );
}
