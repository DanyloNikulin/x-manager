export interface TweetItem {
  id: string;
  text: string;
  mediaUrls?: string[];
}

export interface PreviewAccount {
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface ThreadComposerProps {
  initialTweets?: string[];
  initialItems?: Array<{ text: string; mediaUrls?: string[] }>;
  accountSlot?: number;
  previewAccount?: PreviewAccount;
  onSubmit: (
    tweets: Array<{ text: string; mediaUrls?: string[] }>,
    scheduledTime: string | null,
    accountSlot: number,
  ) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  scheduledTime?: string;
}
