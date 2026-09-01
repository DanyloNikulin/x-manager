/**
 * Publish-time planning for content that the subscription worker submits in auto mode.
 *
 * Pure functions only: the caller gathers the ranked optimal slots, the already
 * scheduled posts for the account and the slot policy window, and this module
 * decides *when* the post goes out. Keeping it free of DB access makes the rules
 * unit-testable with a fixed clock.
 */

export type PublishWindow = {
  /** First allowed hour (0-23) in `timezone`, inclusive. */
  start: number;
  /** Hour (0-23) in `timezone` at which the window closes, exclusive. */
  end: number;
  /** IANA timezone the window is expressed in. */
  timezone: string;
};

export type PublishPlanInput = {
  now: Date;
  actionType: 'post' | 'reply';
  /** Ranked optimal slots (best first). Only consulted for posts. */
  candidates: Date[];
  /** Epoch seconds of posts already scheduled or recently posted for the same account. */
  existingScheduled: number[];
  window: PublishWindow;
  /** Earliest distance from `now`; defaults to 30 min for posts and 1 min for replies. */
  minLeadMinutes?: number;
  /** Minimum distance between two posts of the account; defaults to 90 min (posts only). */
  spacingMinutes?: number;
  /** How far `nextOpenSlot` may search before giving up; defaults to 7 days. */
  maxSearchHours?: number;
};

export type PublishPlan = {
  scheduledAt: Date;
  source: 'reply-immediate' | 'optimal-slot' | 'next-open-slot';
};

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Hour (0-23) of `date` in an IANA timezone. */
export function hourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  });
  return Number(formatter.format(date)) % 24;
}

/**
 * Same semantics as the slot policy: `start <= end` is a plain range `[start, end)`,
 * otherwise the window wraps past midnight (e.g. 22..6).
 */
export function isInsideWindow(hour: number, window: PublishWindow): boolean {
  if (window.start <= window.end) {
    return hour >= window.start && hour < window.end;
  }
  return hour >= window.start || hour < window.end;
}

function isSpaced(candidate: Date, existingScheduled: number[], spacingMinutes: number): boolean {
  if (spacingMinutes <= 0) return true;
  const candidateEpoch = Math.floor(candidate.getTime() / 1000);
  const spacingSeconds = spacingMinutes * 60;
  return existingScheduled.every((epoch) => Math.abs(epoch - candidateEpoch) >= spacingSeconds);
}

function ceilToHour(date: Date): Date {
  const ceiled = new Date(date);
  if (ceiled.getUTCMinutes() !== 0 || ceiled.getUTCSeconds() !== 0 || ceiled.getUTCMilliseconds() !== 0) {
    ceiled.setUTCMinutes(0, 0, 0);
    ceiled.setTime(ceiled.getTime() + HOUR);
  }
  return ceiled;
}

/**
 * Walk forward from `from` in whole-hour steps until a slot is inside the window and
 * spaced away from the existing posts. Returns `from` rounded up if nothing is found
 * within `maxSearchHours`, so the caller always gets a usable time.
 */
export function nextOpenSlot(
  from: Date,
  input: Pick<PublishPlanInput, 'window' | 'existingScheduled'> & { spacingMinutes: number; maxSearchHours: number },
): Date {
  const first = ceilToHour(from);
  for (let step = 0; step <= input.maxSearchHours; step += 1) {
    const candidate = new Date(first.getTime() + step * HOUR);
    if (
      isInsideWindow(hourInTimezone(candidate, input.window.timezone), input.window)
      && isSpaced(candidate, input.existingScheduled, input.spacingMinutes)
    ) {
      return candidate;
    }
  }
  return first;
}

/**
 * Decide when a worker-produced post or reply should be published.
 *
 * - Replies go out as soon as the scheduler ticks, unless the policy window is closed,
 *   in which case they wait for the window to open again.
 * - Posts take the best-ranked optimal slot that is inside the window, far enough in
 *   the future and not crowding another post; otherwise the next open hour.
 */
export function planWorkerPublishTime(input: PublishPlanInput): PublishPlan {
  const isReply = input.actionType === 'reply';
  const minLeadMinutes = input.minLeadMinutes ?? (isReply ? 1 : 30);
  const spacingMinutes = isReply ? 0 : (input.spacingMinutes ?? 90);
  const maxSearchHours = input.maxSearchHours ?? 7 * 24;
  const earliest = new Date(input.now.getTime() + minLeadMinutes * MINUTE);
  const search = { window: input.window, existingScheduled: input.existingScheduled, spacingMinutes, maxSearchHours };

  if (isReply) {
    if (isInsideWindow(hourInTimezone(earliest, input.window.timezone), input.window)) {
      return { scheduledAt: earliest, source: 'reply-immediate' };
    }
    return { scheduledAt: nextOpenSlot(earliest, search), source: 'next-open-slot' };
  }

  for (const candidate of input.candidates) {
    if (candidate.getTime() < earliest.getTime()) continue;
    if (!isInsideWindow(hourInTimezone(candidate, input.window.timezone), input.window)) continue;
    if (!isSpaced(candidate, input.existingScheduled, spacingMinutes)) continue;
    return { scheduledAt: candidate, source: 'optimal-slot' };
  }

  return { scheduledAt: nextOpenSlot(earliest, search), source: 'next-open-slot' };
}
