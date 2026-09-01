export interface ScheduledPost {
  id: string;
  accountSlot?: number;
  text: string;
  media_ids: string[];
  mediaUrls?: string | null;
  communityId?: string;
  replyToTweetId?: string | null;
  scheduledTime: string;
  status: 'scheduled' | 'posted' | 'failed' | 'cancelled';
  twitterPostId?: string | null;
  twitter_post_id?: string;
  errorMessage?: string;
  metrics?: {
    impressions: number;
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    bookmarks: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityTag {
  id: string;
  tagName: string;
  communityId: string;
  communityName?: string;
  createdAt: string;
  updatedAt: string;
}

export type CalendarViewMode = 'day' | 'week' | 'month' | 'queue';

export interface QueueItem {
  id: number;
  accountSlot: number;
  text: string;
  mediaUrls: string | null;
  communityId: string | null;
  position: number;
  status: string;
  scheduledPostId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerProps {
  onUpdate?: () => void;
  refreshTrigger?: number;
  compact?: boolean;
}
