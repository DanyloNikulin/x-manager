import { describe, expect, it } from 'vitest';
import {
  hourInTimezone,
  isInsideWindow,
  nextOpenSlot,
  planWorkerPublishTime,
  type PublishWindow,
} from '@/lib/worker-publish';

const utcWindow: PublishWindow = { start: 6, end: 23, timezone: 'UTC' };
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('hourInTimezone', () => {
  it('returns the wall-clock hour in the requested timezone', () => {
    const date = new Date('2026-09-01T21:30:00Z');
    expect(hourInTimezone(date, 'UTC')).toBe(21);
    expect(hourInTimezone(date, 'Europe/Berlin')).toBe(23);
  });

  it('never yields 24 at midnight', () => {
    expect(hourInTimezone(new Date('2026-09-02T00:05:00Z'), 'UTC')).toBe(0);
  });
});

describe('isInsideWindow', () => {
  it('treats the end hour as exclusive', () => {
    expect(isInsideWindow(6, utcWindow)).toBe(true);
    expect(isInsideWindow(22, utcWindow)).toBe(true);
    expect(isInsideWindow(23, utcWindow)).toBe(false);
    expect(isInsideWindow(3, utcWindow)).toBe(false);
  });

  it('supports windows that wrap past midnight', () => {
    const night: PublishWindow = { start: 22, end: 6, timezone: 'UTC' };
    expect(isInsideWindow(23, night)).toBe(true);
    expect(isInsideWindow(2, night)).toBe(true);
    expect(isInsideWindow(12, night)).toBe(false);
  });
});

describe('planWorkerPublishTime for replies', () => {
  it('publishes a minute after now when the window is open', () => {
    const plan = planWorkerPublishTime({
      now: new Date('2026-09-01T12:00:00Z'),
      actionType: 'reply',
      candidates: [],
      existingScheduled: [epoch('2026-09-01T12:00:30Z')],
      window: utcWindow,
    });
    expect(plan.source).toBe('reply-immediate');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-01T12:01:00.000Z');
  });

  it('waits for the window to open when it is closed', () => {
    const plan = planWorkerPublishTime({
      now: new Date('2026-09-01T23:30:00Z'),
      actionType: 'reply',
      candidates: [],
      existingScheduled: [],
      window: utcWindow,
    });
    expect(plan.source).toBe('next-open-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-02T06:00:00.000Z');
  });

  it('evaluates the window in the policy timezone', () => {
    const plan = planWorkerPublishTime({
      now: new Date('2026-09-01T21:30:00Z'), // 23:30 in Berlin -> closed
      actionType: 'reply',
      candidates: [],
      existingScheduled: [],
      window: { start: 6, end: 23, timezone: 'Europe/Berlin' },
    });
    expect(plan.source).toBe('next-open-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-02T04:00:00.000Z'); // 06:00 Berlin
  });
});

describe('planWorkerPublishTime for posts', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  it('takes the best candidate that is inside the window and spaced', () => {
    const plan = planWorkerPublishTime({
      now,
      actionType: 'post',
      candidates: [new Date('2026-09-01T14:00:00Z'), new Date('2026-09-01T16:00:00Z')],
      existingScheduled: [],
      window: utcWindow,
    });
    expect(plan.source).toBe('optimal-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-01T14:00:00.000Z');
  });

  it('skips candidates that are too close to an existing post', () => {
    const plan = planWorkerPublishTime({
      now,
      actionType: 'post',
      candidates: [new Date('2026-09-01T14:00:00Z'), new Date('2026-09-01T16:00:00Z')],
      existingScheduled: [epoch('2026-09-01T14:20:00Z')], // 20 min from 14:00, 100 min from 16:00
      window: utcWindow,
    });
    expect(plan.source).toBe('optimal-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-01T16:00:00.000Z');
  });

  it('falls through to the next open slot when every candidate crowds an existing post', () => {
    const plan = planWorkerPublishTime({
      now,
      actionType: 'post',
      candidates: [new Date('2026-09-01T14:00:00Z'), new Date('2026-09-01T16:00:00Z')],
      existingScheduled: [epoch('2026-09-01T14:45:00Z')], // 45 min from 14:00, 75 min from 16:00
      window: utcWindow,
    });
    expect(plan.source).toBe('next-open-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-01T11:00:00.000Z');
  });

  it('skips candidates outside the window and in the past', () => {
    const plan = planWorkerPublishTime({
      now,
      actionType: 'post',
      candidates: [
        new Date('2026-09-01T09:00:00Z'), // already past
        new Date('2026-09-01T23:00:00Z'), // window closed
        new Date('2026-09-02T08:00:00Z'),
      ],
      existingScheduled: [],
      window: utcWindow,
    });
    expect(plan.source).toBe('optimal-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-02T08:00:00.000Z');
  });

  it('falls back to the next open, spaced hour when no candidate fits', () => {
    const plan = planWorkerPublishTime({
      now: new Date('2026-09-01T10:20:00Z'),
      actionType: 'post',
      candidates: [],
      existingScheduled: [epoch('2026-09-01T11:30:00Z')],
      window: utcWindow,
    });
    // earliest = 10:50 -> 11:00 is within 90 min of 11:30, 12:00 too -> 13:00
    expect(plan.source).toBe('next-open-slot');
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-01T13:00:00.000Z');
  });

  it('never returns a time before now plus the lead', () => {
    const plan = planWorkerPublishTime({
      now: new Date('2026-09-01T22:50:00Z'),
      actionType: 'post',
      candidates: [],
      existingScheduled: [],
      window: utcWindow,
    });
    expect(plan.scheduledAt.getTime()).toBeGreaterThanOrEqual(new Date('2026-09-01T23:20:00Z').getTime());
    expect(plan.scheduledAt.toISOString()).toBe('2026-09-02T06:00:00.000Z');
  });
});

describe('nextOpenSlot', () => {
  it('rounds up to the next whole hour before searching', () => {
    const slot = nextOpenSlot(new Date('2026-09-01T10:01:00Z'), {
      window: utcWindow,
      existingScheduled: [],
      spacingMinutes: 90,
      maxSearchHours: 48,
    });
    expect(slot.toISOString()).toBe('2026-09-01T11:00:00.000Z');
  });
});
