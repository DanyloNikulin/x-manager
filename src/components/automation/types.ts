export type TabKey = 'rules' | 'feeds' | 'searches';

export type AutomationRule = {
  id: number;
  name: string;
  triggerType: 'event' | 'schedule' | 'keyword';
  triggerConfig: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  actionType: 'like' | 'reply' | 'repost' | 'schedule_post' | 'send_dm' | 'dismiss' | 'tag' | 'webhook';
  actionConfig: Record<string, unknown>;
  accountSlot: number;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
};

export type AutomationRun = {
  id: number;
  status: 'success' | 'failed' | 'skipped';
  triggerSource: string | null;
  error: string | null;
  createdAt: string | null;
};

export type Feed = {
  id: number;
  url: string;
  title: string | null;
  accountSlot: number;
  checkIntervalMinutes: number;
  lastCheckedAt: string | null;
  lastEntryId: string | null;
  autoSchedule: boolean;
  template: string | null;
  status: 'active' | 'paused';
};

export type SavedSearch = {
  id: number;
  keywords: string[];
  accountSlot: number;
  checkIntervalMinutes: number;
  lastCheckedAt: string | null;
  autoAction: 'like' | 'reply' | null;
  replyTemplate: string | null;
  notify: boolean;
  language: string | null;
  status: 'active' | 'paused';
};

export const ruleTriggerOptions: Array<AutomationRule['triggerType']> = ['event', 'schedule', 'keyword'];
export const ruleActionOptions: Array<AutomationRule['actionType']> = [
  'like',
  'reply',
  'repost',
  'schedule_post',
  'send_dm',
  'dismiss',
  'tag',
  'webhook',
];

export type WorkbenchFeedback = {
  busyKey: string;
  setBusyKey: (key: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  clearNotices: () => void;
};

export type WorkbenchTabProps = WorkbenchFeedback & {
  refreshEpoch: number;
  onRefreshSettled: () => void;
};
