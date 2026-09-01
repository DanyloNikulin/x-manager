import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMPAIGN_PLAN_STEPS } from '@/lib/campaign-plan-fixture';
import { buildDefaultCampaignPlan } from '@/lib/campaign-planner';

describe('buildDefaultCampaignPlan', () => {
  it('materializes the six fixture steps with objective and due dates', () => {
    const startAt = new Date('2026-01-01T00:00:00.000Z');
    const endAt = new Date('2026-01-11T00:00:00.000Z');
    const plan = buildDefaultCampaignPlan({
      objective: 'Launch the agent',
      instructions: 'Keep replies short',
      startAt,
      endAt,
    });

    expect(plan).toHaveLength(DEFAULT_CAMPAIGN_PLAN_STEPS.length);
    expect(plan.map((task) => task.taskType)).toEqual(
      DEFAULT_CAMPAIGN_PLAN_STEPS.map((step) => step.taskType),
    );
    expect(plan[0].details).toContain('Launch the agent');
    expect(plan[0].details).toContain('Constraints: Keep replies short');
    expect(plan[1].details).toContain('Launch the agent');
    expect(plan[2].status).toBe('waiting_approval');
    expect(plan[0].dueAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('skips due dates when the campaign has no window', () => {
    const plan = buildDefaultCampaignPlan({ objective: '  Grow replies  ' });
    expect(plan.every((task) => task.dueAt === null)).toBe(true);
    expect(plan[0].details).toContain('Grow replies');
    expect(plan[0].details).toContain('No extra constraints provided.');
  });
});
