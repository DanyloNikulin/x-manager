import { describe, expect, it } from 'vitest';
import {
  autopilotCampaignName,
  groupThreadPosts,
  parseMarkerDetails,
  planMarkerTitle,
  plannerState,
  summarizeTaskOutput,
  tweetUrl,
  type RawPostRow,
} from '@/lib/overview-model';

const row = (overrides: Partial<RawPostRow>): RawPostRow => ({
  id: 1,
  text: 'text',
  scheduledTime: new Date('2026-09-02T22:00:00Z'),
  status: 'scheduled',
  twitterPostId: null,
  threadId: null,
  threadIndex: null,
  errorMessage: null,
  ...overrides,
});

describe('names shared with the planner', () => {
  it('match orchestrator/src/planner.rs', () => {
    expect(autopilotCampaignName(1)).toBe('Autopilot slot 1');
    expect(planMarkerTitle('2026-09-02')).toBe('Autopilot 2026-09-02: plan');
  });
});

describe('tweetUrl', () => {
  it('prefers the handle and falls back to the anonymous form', () => {
    expect(tweetUrl('LoopedHuman', '2094897731730898963')).toBe('https://x.com/LoopedHuman/status/2094897731730898963');
    expect(tweetUrl('@LoopedHuman', '1')).toBe('https://x.com/LoopedHuman/status/1');
    expect(tweetUrl(null, '1')).toBe('https://x.com/i/status/1');
    expect(tweetUrl('x', null)).toBeNull();
  });
});

describe('groupThreadPosts', () => {
  it('collapses a thread into its first tweet and keeps standalone posts', () => {
    const grouped = groupThreadPosts(
      [
        row({ id: 1, text: 'solo', scheduledTime: 1788300000 }),
        row({ id: 3, text: 'second', threadId: 't', threadIndex: 1 }),
        row({ id: 2, text: 'first', threadId: 't', threadIndex: 0, twitterPostId: '99' }),
        row({ id: 4, text: 'third', threadId: 't', threadIndex: 2 }),
      ],
      'LoopedHuman',
    );
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ id: 1, text: 'solo', tweets: 1, scheduledTime: '2026-09-01T22:00:00.000Z', url: null });
    expect(grouped[1]).toMatchObject({ id: 2, text: 'first', tweets: 3, url: 'https://x.com/LoopedHuman/status/99' });
  });
});

describe('summarizeTaskOutput', () => {
  it('reads the validator verdict and the publication mode', () => {
    const output = JSON.stringify({ publication_mode: 'draft', validation: { score: 82, verdict: 'revise' } });
    expect(summarizeTaskOutput(output)).toEqual({ score: 82, verdict: 'revise', publicationMode: 'draft' });
    expect(summarizeTaskOutput('not json')).toEqual({ score: null, verdict: null, publicationMode: null });
    expect(summarizeTaskOutput(null).score).toBeNull();
  });
});

describe('parseMarkerDetails', () => {
  it('extracts created and notes', () => {
    expect(parseMarkerDetails(JSON.stringify({ created: 1, notes: '  Searched two pillars. ' }))).toEqual({ created: 1, notes: 'Searched two pillars.' });
    expect(parseMarkerDetails('{}')).toEqual({ created: null, notes: null });
    expect(parseMarkerDetails('{')).toEqual({ created: null, notes: null });
  });
});

describe('plannerState', () => {
  it('explains why the planner would skip a slot', () => {
    expect(plannerState('ready', 1)).toEqual({ active: true, reason: null });
    expect(plannerState('ready', 0).active).toBe(false);
    expect(plannerState('paused', 1).reason).toMatch(/Paused/);
    expect(plannerState('needs-onboarding', 1).reason).toMatch(/onboarding/);
  });
});
