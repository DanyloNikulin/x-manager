import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accountProfiles, xAccounts } from '@/lib/db/schema';
import { ACCOUNT_SLOTS, type AccountSlot } from '@/lib/account-slots';
import {
  BRIEF_FIELDS,
  MAX_BRIEF_FIELD_BYTES,
  PROFILE_DEFAULTS,
  type AccountProfileFields,
  type AccountProfilePatch,
  type BriefField,
} from '@/lib/account-profile-validation';

export {
  BRIEF_FIELDS,
  MAX_BRIEF_FIELD_BYTES,
  MAX_POSTS_PER_DAY,
  PROFILE_STATUSES,
  PUBLICATION_MODES,
  isValidTimezone,
  validateProfilePatch,
} from '@/lib/account-profile-validation';
export type { AccountProfilePatch, BriefField, ProfileStatus, PublicationMode } from '@/lib/account-profile-validation';

/**
 * Per-account brief and autopilot switches.
 *
 * This is the single source of truth the Account console edits and the subscription
 * worker reads (through /api/agent/accounts/:slot). The four markdown fields replace
 * accounts/slot-N/{profile,voice,strategy,memory}.md; the switches replace the
 * [accounts.N] block of orchestrator/config.toml.
 */

export type AccountProfile = AccountProfileFields & {
  slot: AccountSlot;
  updatedAt: string | null;
  /** True when the row exists in the database (false = defaults only). */
  stored: boolean;
};

export type AccountProfileView = AccountProfile & {
  connected: boolean;
  username: string | null;
  displayName: string | null;
};

function rowToProfile(slot: AccountSlot, row: typeof accountProfiles.$inferSelect | undefined): AccountProfile {
  if (!row) {
    return { slot, ...PROFILE_DEFAULTS, updatedAt: null, stored: false };
  }
  return {
    slot,
    status: row.status,
    language: row.language,
    profile: row.profileMd,
    voice: row.voiceMd,
    strategy: row.strategyMd,
    memory: row.memoryMd,
    postMode: row.postMode,
    inboundReplyMode: row.inboundReplyMode,
    outboundReplyMode: row.outboundReplyMode,
    postsPerDay: row.postsPerDay,
    planHour: row.planHour,
    planTimezone: row.planTimezone,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    stored: true,
  };
}

export async function getAccountProfile(slot: AccountSlot): Promise<AccountProfile> {
  const rows = await db.select().from(accountProfiles).where(eq(accountProfiles.slot, slot)).limit(1);
  return rowToProfile(slot, rows[0]);
}

export async function listAccountProfiles(): Promise<AccountProfileView[]> {
  const [profileRows, accountRows] = await Promise.all([
    db.select().from(accountProfiles),
    db.select().from(xAccounts),
  ]);
  const profileBySlot = new Map(profileRows.map((row) => [row.slot, row]));
  const accountBySlot = new Map(accountRows.map((row) => [row.slot, row]));
  return ACCOUNT_SLOTS.map((slot) => {
    const account = accountBySlot.get(slot);
    return {
      ...rowToProfile(slot, profileBySlot.get(slot)),
      connected: Boolean(account?.twitterAccessToken && account?.twitterAccessTokenSecret),
      username: account?.twitterUsername ?? null,
      displayName: account?.twitterDisplayName ?? null,
    };
  });
}

export async function saveAccountProfile(slot: AccountSlot, patch: AccountProfilePatch): Promise<AccountProfile> {
  const current = await getAccountProfile(slot);
  const merged = { ...current, ...patch };
  const values = {
    slot,
    status: merged.status,
    language: merged.language,
    profileMd: merged.profile,
    voiceMd: merged.voice,
    strategyMd: merged.strategy,
    memoryMd: merged.memory,
    postMode: merged.postMode,
    inboundReplyMode: merged.inboundReplyMode,
    outboundReplyMode: merged.outboundReplyMode,
    postsPerDay: merged.postsPerDay,
    planHour: merged.planHour,
    planTimezone: merged.planTimezone,
    updatedAt: new Date(),
  };
  await db
    .insert(accountProfiles)
    .values(values)
    .onConflictDoUpdate({ target: accountProfiles.slot, set: values });
  return getAccountProfile(slot);
}

/**
 * Seed a profile from the legacy on-disk workspace (accounts/slot-N/*.md). Only the
 * four brief fields are imported; switches keep their stored values. Returns which
 * files were found so the UI can say what happened.
 */
/**
 * Where the legacy `accounts/` directory lives. The standalone Next.js server chdirs into
 * `.next/standalone`, so the process cwd is not the repository root in production.
 */
export function resolveAccountsRoot(cwd: string = process.cwd()): string {
  const candidates = [
    process.env.X_MANAGER_ACCOUNTS_ROOT,
    cwd,
    path.resolve(cwd, '..', '..'),
    process.env.X_MANAGER_DB_PATH ? path.resolve(path.dirname(process.env.X_MANAGER_DB_PATH), '..') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'accounts'))) return candidate;
  }
  return cwd;
}

export async function importAccountProfileFromFiles(
  slot: AccountSlot,
  rootDir: string = resolveAccountsRoot(),
): Promise<{ profile: AccountProfile; imported: BriefField[]; missing: BriefField[] }> {
  const workspace = path.join(rootDir, 'accounts', `slot-${slot}`);
  const patch: AccountProfilePatch = {};
  const imported: BriefField[] = [];
  const missing: BriefField[] = [];
  for (const field of BRIEF_FIELDS) {
    const file = path.join(workspace, `${field}.md`);
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_BRIEF_FIELD_BYTES) {
        missing.push(field);
        continue;
      }
      patch[field] = content.replace(/\r\n/g, '\n');
      imported.push(field);
    } catch {
      missing.push(field);
    }
  }
  if (imported.includes('profile') && patch.profile && !/status:\s*needs-onboarding/.test(patch.profile)) {
    patch.status = 'ready';
  }
  const profile = imported.length > 0 ? await saveAccountProfile(slot, patch) : await getAccountProfile(slot);
  return { profile, imported, missing };
}
