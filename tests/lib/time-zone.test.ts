import { describe, expect, it } from 'vitest';
import { localDay, nextPlanRun, planRunToday, safeTimeZone, timeZoneOffsetMinutes, toIso, zonedTimeToUtc } from '@/lib/time-zone';

describe('safeTimeZone', () => {
  it('keeps valid zones and falls back to UTC', () => {
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
    expect(safeTimeZone('')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
  });
});

describe('localDay', () => {
  it('uses the wall clock of the zone', () => {
    const late = new Date('2026-09-02T02:30:00Z');
    expect(localDay(late, 'UTC')).toBe('2026-09-02');
    expect(localDay(late, 'America/New_York')).toBe('2026-09-01');
    expect(localDay(late, 'Asia/Tokyo')).toBe('2026-09-02');
  });
});

describe('zonedTimeToUtc', () => {
  it('honours daylight saving time', () => {
    expect(zonedTimeToUtc(2026, 9, 2, 9, 0, 'America/New_York').toISOString()).toBe('2026-09-02T13:00:00.000Z');
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(timeZoneOffsetMinutes(new Date('2026-09-02T13:00:00Z'), 'America/New_York')).toBe(-240);
  });
});

describe('planRunToday / nextPlanRun', () => {
  const zone = 'America/New_York';

  it('finds today\'s planning instant even when it already passed', () => {
    const afternoon = new Date('2026-09-02T20:00:00Z');
    expect(planRunToday(afternoon, 9, zone).toISOString()).toBe('2026-09-02T13:00:00.000Z');
  });

  it('moves to tomorrow once the hour has passed', () => {
    const morning = new Date('2026-09-02T09:00:00Z');
    expect(nextPlanRun(morning, 9, zone).toISOString()).toBe('2026-09-02T13:00:00.000Z');
    const afternoon = new Date('2026-09-02T20:00:00Z');
    expect(nextPlanRun(afternoon, 9, zone).toISOString()).toBe('2026-09-03T13:00:00.000Z');
  });
});

describe('toIso', () => {
  it('normalizes every timestamp shape found in the rows', () => {
    expect(toIso(new Date('2026-09-02T10:00:00Z'))).toBe('2026-09-02T10:00:00.000Z');
    expect(toIso(new Date('nope'))).toBeNull();
    expect(toIso(1788338941)).toBe('2026-09-02T08:49:01.000Z');
    expect(toIso(1788338941000)).toBe('2026-09-02T08:49:01.000Z');
    expect(toIso('1788338941')).toBe('2026-09-02T08:49:01.000Z');
    expect(toIso('2026-09-02 08:39:37')).toBe('2026-09-02T08:39:37.000Z');
    expect(toIso('2026-09-02T08:39:37.000Z')).toBe('2026-09-02T08:39:37.000Z');
    expect(toIso('')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso(0)).toBeNull();
  });
});
