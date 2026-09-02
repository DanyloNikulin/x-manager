import { sqlite } from '@/lib/db';
import { validateProfilePatch } from '@/lib/account-profiles';
import { isAccountSlot } from '@/lib/account-slots';
import { ANALYST_AGENT } from '@/lib/digest-model';

/**
 * Analyst proposals: one concrete edit each to an account-layer field or setting, filed by
 * the weekly analyst in its task details and applied or rejected here by the operator.
 * Nothing in the brief changes without this step, and a decision is one transaction:
 * the profile write and the task update commit together or not at all.
 */

export const TEXT_TARGETS = ['voice', 'strategy', 'memory', 'playbook'] as const;
export const NUMBER_TARGETS = ['postsPerDay', 'maxRepliesPerConversation'] as const;
export type ProposalTarget = (typeof TEXT_TARGETS)[number] | (typeof NUMBER_TARGETS)[number];

/** Profile column behind each target. */
const COLUMN: Record<ProposalTarget, string> = {
  voice: 'voice_md',
  strategy: 'strategy_md',
  memory: 'memory_md',
  playbook: 'playbook_md',
  postsPerDay: 'posts_per_day',
  maxRepliesPerConversation: 'max_replies_per_conversation',
};

export type StoredProposal = {
  target: string;
  current: string;
  proposed: string;
  rationale: string;
  evidence: string;
  confidence: number;
  status: 'open' | 'applied' | 'rejected';
  decidedAt?: string;
  /** For a setting: the value before the change, so it can be put back by hand. */
  previous?: string;
  error?: string;
};

export type ProposalDecision = 'apply' | 'reject';

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Applies a text proposal: replaces the first occurrence of `current` (exactly, after
 * line-ending normalisation) with `proposed`, or appends `proposed` as a new paragraph when
 * `current` is empty. Throws when `current` is not found, so a stale proposal never
 * rewrites the wrong place. `proposed` is kept as the operator approved it.
 */
export function applyTextProposal(fieldText: string, current: string, proposed: string): string {
  const text = normalize(fieldText);
  const needle = normalize(current);
  const replacement = normalize(proposed);
  if (!replacement.trim()) throw new Error('The proposed text is empty.');
  if (needle === '') {
    const body = text.replace(/\n+$/, '');
    return body ? `${body}\n\n${replacement}\n` : `${replacement}\n`;
  }
  const at = text.indexOf(needle);
  if (at < 0) throw new Error('The text the proposal replaces was not found; the field has changed since the analysis.');
  return text.slice(0, at) + replacement + text.slice(at + needle.length);
}

export function isTextTarget(target: string): target is (typeof TEXT_TARGETS)[number] {
  return (TEXT_TARGETS as readonly string[]).includes(target);
}

export function isNumberTarget(target: string): target is (typeof NUMBER_TARGETS)[number] {
  return (NUMBER_TARGETS as readonly string[]).includes(target);
}

type TaskRow = { id: number; account_slot: number; assigned_agent: string | null; status: string; details: string | null };

function loadAnalystTask(taskId: number): TaskRow | null {
  const row = sqlite
    .prepare(
      `SELECT ct.id, c.account_slot, ct.assigned_agent, ct.status, ct.details
       FROM campaign_tasks ct JOIN campaigns c ON c.id = ct.campaign_id
       WHERE ct.id = ? LIMIT 1`,
    )
    .get(taskId) as TaskRow | undefined;
  return row ?? null;
}

export function readProposals(details: string | null): StoredProposal[] {
  if (!details) return [];
  try {
    const parsed = JSON.parse(details) as { proposals?: unknown };
    if (!Array.isArray(parsed.proposals)) return [];
    return parsed.proposals
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        target: String(item.target ?? ''),
        current: typeof item.current === 'string' ? item.current : '',
        proposed: typeof item.proposed === 'string' ? item.proposed : '',
        rationale: typeof item.rationale === 'string' ? item.rationale : '',
        evidence: typeof item.evidence === 'string' ? item.evidence : '',
        confidence: typeof item.confidence === 'number' ? item.confidence : 0,
        status: item.status === 'applied' || item.status === 'rejected' ? item.status : 'open',
        ...(typeof item.decidedAt === 'string' ? { decidedAt: item.decidedAt } : {}),
        ...(typeof item.previous === 'string' ? { previous: item.previous } : {}),
        ...(typeof item.error === 'string' ? { error: item.error } : {}),
      }));
  } catch {
    return [];
  }
}

export class ProposalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type ProfileValues = Record<string, string | number | null>;

/** Test hook: runs between the read and the transactional write (simulates a concurrent change). */
export type DecideOptions = { now?: Date; beforeWrite?: () => void };

/**
 * Applies or rejects proposal `index` of the analyst task `taskId`. Applying writes the
 * profile column and the task details in one SQLite transaction with a compare-and-set on
 * the task's details, so a concurrent decision or a changed setting is refused rather than
 * silently overwritten. Returns the updated proposals and the task status.
 */
export async function decideProposal(taskId: number, index: number, decision: ProposalDecision, options: DecideOptions = {}): Promise<{ proposals: StoredProposal[]; taskStatus: string }> {
  const now = options.now ?? new Date();
  const task = loadAnalystTask(taskId);
  if (!task) throw new ProposalError('Task not found.', 404);
  if (task.assigned_agent !== ANALYST_AGENT) throw new ProposalError('Not an analyst task.', 409);
  if (!isAccountSlot(task.account_slot)) throw new ProposalError('Task has no valid account slot.', 409);
  const slot = task.account_slot;
  const originalDetails = task.details;
  const proposals = readProposals(originalDetails);
  const proposal = proposals[index];
  if (!proposal) throw new ProposalError('No such proposal.', 400);
  if (proposal.status !== 'open') throw new ProposalError(`Proposal already ${proposal.status}.`, 409);

  // What to write to the profile, decided outside the transaction from a fresh read of the
  // row; the transaction re-checks that the row still holds the value the decision was
  // based on (text: the needle is still there; setting: the current value still matches).
  let column: string | null = null;
  let value: string | number | null = null;
  let readValue: string | number | null = null;
  if (decision === 'apply') {
    if (!isTextTarget(proposal.target) && !isNumberTarget(proposal.target)) {
      throw new ProposalError(`Unknown proposal target ${proposal.target}.`, 422);
    }
    column = COLUMN[proposal.target];
    const profile = sqlite.prepare(`SELECT ${column} AS value FROM account_profiles WHERE slot = ?`).get(slot) as { value: string | number | null } | undefined;
    if (!profile) throw new ProposalError('The account has no stored profile to apply the proposal to.', 409);
    readValue = profile.value;
    if (isTextTarget(proposal.target)) {
      try {
        value = applyTextProposal(String(profile.value ?? ''), proposal.current, proposal.proposed);
      } catch (error) {
        throw new ProposalError(error instanceof Error ? error.message : 'Cannot apply the proposal.', 422);
      }
    } else {
      const stored = String(profile.value ?? '');
      if (proposal.current.trim() !== stored) {
        throw new ProposalError(`The setting changed since the analysis (proposal expected ${proposal.current.trim() || 'nothing'}, it is ${stored}).`, 422);
      }
      const validated = validateProfilePatch({ [proposal.target]: proposal.proposed.trim() });
      if (!validated.ok) throw new ProposalError(validated.errors.join(' '), 422);
      value = validated.patch[proposal.target] as number;
      proposal.previous = stored;
    }
    proposal.status = 'applied';
  } else {
    proposal.status = 'rejected';
  }
  proposal.decidedAt = now.toISOString();

  const open = proposals.some((item) => item.status === 'open');
  const taskStatus = open ? task.status : 'done';
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(originalDetails ?? '{}') as Record<string, unknown>;
  } catch {
    details = {};
  }
  details.proposals = proposals;
  const nextDetails = JSON.stringify(details);

  options.beforeWrite?.();

  const committed = sqlite.transaction(() => {
    // Compare-and-set on the task: the details must still be what the decision was read from.
    const taskUpdate = sqlite
      .prepare('UPDATE campaign_tasks SET details = ?, status = ?, updated_at = unixepoch() WHERE id = ? AND details IS ?')
      .run(nextDetails, taskStatus, taskId, originalDetails);
    if (taskUpdate.changes !== 1) return 'task';
    if (column !== null) {
      // Compare-and-set on the profile too: the column must still hold the value the new
      // value was computed from, otherwise a concurrent edit would be overwritten. A miss
      // throws, which rolls the task update back with it.
      const profileUpdate = sqlite
        .prepare(`UPDATE account_profiles SET ${column} = ?, updated_at = unixepoch() WHERE slot = ? AND ${column} IS ?`)
        .run(value, slot, readValue);
      if (profileUpdate.changes !== 1) throw new ProposalError('The account profile changed while the proposal was being applied; reload and try again.', 409);
    }
    return 'ok';
  })();
  if (committed === 'task') throw new ProposalError('The proposal was decided concurrently; reload and try again.', 409);

  return { proposals, taskStatus };
}
