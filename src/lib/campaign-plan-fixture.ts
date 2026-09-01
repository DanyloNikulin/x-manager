export type CampaignPlanStep = {
  taskType: 'research' | 'post' | 'reply' | 'dm' | 'approval';
  title: string;
  details: string;
  progress: number;
  priority: number;
  status: 'pending' | 'waiting_approval';
};

export const DEFAULT_CAMPAIGN_PLAN_STEPS: readonly CampaignPlanStep[] = [
  {
    taskType: 'research',
    title: 'Collect target topics and audience signals',
    details: 'Analyze mentions, discovery trends, and historical engagement for objective: {objective}. {instructionLine}',
    progress: 0.1,
    priority: 1,
    status: 'pending',
  },
  {
    taskType: 'post',
    title: 'Draft primary content sequence',
    details: 'Create 5-10 core posts/threads aligned with objective: {objective}. Include publication windows and account slot selection.',
    progress: 0.25,
    priority: 1,
    status: 'pending',
  },
  {
    taskType: 'approval',
    title: 'Approval checkpoint: scheduled content',
    details: 'Require approval before publishing campaign’s first content batch.',
    progress: 0.35,
    priority: 1,
    status: 'waiting_approval',
  },
  {
    taskType: 'reply',
    title: 'Execute daily reply workflow',
    details: 'Sync inbox and respond to high-relevance mentions with approved reply policy.',
    progress: 0.6,
    priority: 2,
    status: 'pending',
  },
  {
    taskType: 'dm',
    title: 'Run targeted DM outreach',
    details: 'Send personalized DMs to qualified accounts with clear CTA and track outcomes.',
    progress: 0.75,
    priority: 2,
    status: 'pending',
  },
  {
    taskType: 'approval',
    title: 'Approval checkpoint: campaign closeout',
    details: 'Review campaign outcomes, follow-up queue, and handoff recommendations.',
    progress: 0.95,
    priority: 2,
    status: 'waiting_approval',
  },
];
