/**
 * Wall-clock helpers for IANA time zones without a calendar dependency.
 * Everything falls back to UTC when a zone name is unknown to the runtime.
 */

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function safeTimeZone(timeZone: string | null | undefined): string {
  const candidate = (timeZone || '').trim();
  if (!candidate) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function wallClockIn(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') % 24, minute: read('minute'), second: read('second') };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` of the given instant in the zone, the same string the planner uses for its marker. */
export function localDay(date: Date, timeZone: string): string {
  const clock = wallClockIn(date, timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** Minutes east of UTC for the zone at the given instant. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const clock = wallClockIn(date, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The instant at which the zone's wall clock shows the given date and time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timeZoneOffsetMinutes(new Date(naive), zone);
  let result = new Date(naive - firstOffset * 60_000);
  const secondOffset = timeZoneOffsetMinutes(result, zone);
  if (secondOffset !== firstOffset) result = new Date(naive - secondOffset * 60_000);
  return result;
}

/** Today's planning instant in the zone (may already be in the past). */
export function planRunToday(now: Date, planHour: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const clock = wallClockIn(now, zone);
  return zonedTimeToUtc(clock.year, clock.month, clock.day, planHour, 0, zone);
}

/** The next planning instant strictly after `now`. */
export function nextPlanRun(now: Date, planHour: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const today = planRunToday(now, planHour, zone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = wallClockIn(new Date(now.getTime() + 24 * 60 * 60 * 1000), zone);
  return zonedTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, planHour, 0, zone);
}

/**
 * Normalizes the timestamp shapes found in the SQLite rows: Date objects (drizzle timestamp
 * mode), epoch seconds or milliseconds, `YYYY-MM-DD HH:MM:SS` from `CURRENT_TIMESTAMP`, or ISO.
 */
export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return toIso(Number(trimmed));
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed.replace(' ', 'T')}Z` : trimmed;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
