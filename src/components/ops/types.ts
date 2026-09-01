export type InboxStatus = 'new' | 'reviewed' | 'replied' | 'dismissed';

export type InboxItem = {
  id: number;
  accountSlot: number;
  sourceType: 'mention' | 'dm';
  sourceId: string;
  conversationId: string | null;
  authorUserId: string | null;
  authorUsername: string | null;
  text: string;
  status: InboxStatus;
  receivedAt: string;
  inReplyToTweetId?: string | null;
};

export type ConversationMessage = {
  id: number;
  source_id: string;
  author_username: string | null;
  text: string;
  received_at: number;
  status: string;
};

export type Campaign = {
  id: number;
  name: string;
  objective: string;
  accountSlot: number;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  startAt: string | null;
  endAt: string | null;
};

export type Approval = {
  id: number;
  campaignId: number;
  taskId: number | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  decisionNote: string | null;
};

export type SavedReply = {
  id: number;
  name: string;
  text: string;
  category: string | null;
  useCount: number;
};

export type OpsFeedback = {
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};
