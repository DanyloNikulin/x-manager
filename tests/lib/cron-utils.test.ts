import { describe, expect, it } from 'vitest';
import { matchesCronExpression, shouldRunCronNow } from '@/lib/cron-utils';

describe('cron-utils', () => {
  it('matches basic cron expressions', () => {
    const date = new Date(2026, 2, 2, 10, 15, 0);
    expect(matchesCronExpression('15 10 * * *', date)).toBe(true);
    expect(matchesCronExpression('*/5 * * * *', date)).toBe(true);
    expect(matchesCronExpression('0 9 * * *', date)).toBe(false);
  });

  it('prevents duplicate runs within the same minute', () => {
    const now = new Date(2026, 2, 2, 10, 15, 0);
    const lastRunSameMinute = new Date(2026, 2, 2, 10, 15, 30);
    const lastRunEarlier = new Date(2026, 2, 2, 10, 10, 0);

    expect(shouldRunCronNow('15 10 * * *', now, lastRunSameMinute)).toBe(false);
    expect(shouldRunCronNow('15 10 * * *', now, lastRunEarlier)).toBe(true);
  });
});
