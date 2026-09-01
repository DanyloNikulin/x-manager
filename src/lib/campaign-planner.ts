import { DEFAULT_CAMPAIGN_PLAN_STEPS } from './campaign-plan-fixture';

export type CampaignPlanInput = {
  objective: string;
  instructions?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
};

export type DraftTask = {
  taskType: 'research' | 'post' | 'reply' | 'dm' | 'approval';
  title: string;
  details: string;
  dueAt: Date | null;
  priority: number;
  status: 'pending' | 'waiting_approval';
};

function interpolateDueAt(startAt: Date | null, endAt: Date | null, progress: number): Date | null {
  if (!startAt || !endAt) return null;
  const start = startAt.getTime();
  const end = endAt.getTime();
  if (end <= start) return new Date(start);
  return new Date(start + Math.floor((end - start) * progress));
}

function fillDetails(template: string, objective: string, instructionLine: string): string {
  return template.replaceAll('{objective}', objective).replaceAll('{instructionLine}', instructionLine);
}

export function buildDefaultCampaignPlan(input: CampaignPlanInput): DraftTask[] {
  const objective = input.objective.trim();
  const trimmedInstructions = input.instructions?.trim();
  const instructionLine = trimmedInstructions
    ? `Constraints: ${trimmedInstructions}`
    : 'No extra constraints provided.';

  return DEFAULT_CAMPAIGN_PLAN_STEPS.map((step) => ({
    taskType: step.taskType,
    title: step.title,
    details: fillDetails(step.details, objective, instructionLine),
    dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, step.progress),
    priority: step.priority,
    status: step.status,
  }));
}
