export interface TweetItem {
  id: string;
  text: string;
}

export interface ThreadComposerProps {
  initialTweets?: string[];
  accountSlot?: number;
  onSubmit: (tweets: string[], scheduledTime: string | null) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  scheduledTime?: string;
}
