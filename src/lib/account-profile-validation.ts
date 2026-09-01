/**
 * Pure validation for account profiles — no database import, so it can be unit-tested
 * and reused by the UI without opening SQLite.
 */

export const PUBLICATION_MODES = ['auto', 'approval', 'draft'] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const PROFILE_STATUSES = ['needs-onboarding', 'ready', 'paused'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const BRIEF_FIELDS = ['profile', 'voice', 'strategy', 'memory'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

export const MAX_BRIEF_FIELD_BYTES = 128 * 1024;
export const MAX_POSTS_PER_DAY = 5;

export type AccountProfileFields = {
  status: ProfileStatus;
  language: string;
  profile: string;
  voice: string;
  strategy: string;
  memory: string;
  postMode: PublicationMode;
  inboundReplyMode: PublicationMode;
  outboundReplyMode: PublicationMode;
  postsPerDay: number;
  planHour: number;
  planTimezone: string;
};

export type AccountProfilePatch = Partial<AccountProfileFields>;

export const PROFILE_DEFAULTS: AccountProfileFields = {
  status: 'needs-onboarding',
  language: 'en',
  profile: '',
  voice: '',
  strategy: '',
  memory: '',
  postMode: 'draft',
  inboundReplyMode: 'approval',
  outboundReplyMode: 'approval',
  postsPerDay: 0,
  planHour: 9,
  planTimezone: 'UTC',
};

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an incoming patch. Returns the cleaned patch or a list of field errors.
 * Unknown keys are ignored so the API stays tolerant of UI drift.
 */
export function validateProfilePatch(input: unknown): { ok: true; patch: AccountProfilePatch } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  const body = input as Record<string, unknown>;
  const errors: string[] = [];
  const patch: AccountProfilePatch = {};

  if (body.status !== undefined) {
    if (typeof body.status === 'string' && PROFILE_STATUSES.includes(body.status as ProfileStatus)) {
      patch.status = body.status as ProfileStatus;
    } else {
      errors.push(`status must be one of ${PROFILE_STATUSES.join(', ')}`);
    }
  }

  if (body.language !== undefined) {
    if (typeof body.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(body.language.trim())) {
      patch.language = body.language.trim();
    } else {
      errors.push('language must be a BCP-47 tag such as en or pt-BR');
    }
  }

  for (const field of BRIEF_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      errors.push(`${field} must be a string`);
      continue;
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_BRIEF_FIELD_BYTES) {
      errors.push(`${field} exceeds ${MAX_BRIEF_FIELD_BYTES} bytes`);
      continue;
    }
    patch[field] = value.replace(/\r\n/g, '\n');
  }

  for (const key of ['postMode', 'inboundReplyMode', 'outboundReplyMode'] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && PUBLICATION_MODES.includes(value as PublicationMode)) {
      patch[key] = value as PublicationMode;
    } else {
      errors.push(`${key} must be one of ${PUBLICATION_MODES.join(', ')}`);
    }
  }

  if (body.postsPerDay !== undefined) {
    const value = Number(body.postsPerDay);
    if (Number.isInteger(value) && value >= 0 && value <= MAX_POSTS_PER_DAY) {
      patch.postsPerDay = value;
    } else {
      errors.push(`postsPerDay must be an integer between 0 and ${MAX_POSTS_PER_DAY}`);
    }
  }

  if (body.planHour !== undefined) {
    const value = Number(body.planHour);
    if (Number.isInteger(value) && value >= 0 && value <= 23) {
      patch.planHour = value;
    } else {
      errors.push('planHour must be an integer between 0 and 23');
    }
  }

  if (body.planTimezone !== undefined) {
    if (typeof body.planTimezone === 'string' && isValidTimezone(body.planTimezone.trim())) {
      patch.planTimezone = body.planTimezone.trim();
    } else {
      errors.push('planTimezone must be a valid IANA timezone such as America/New_York');
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch };
}
