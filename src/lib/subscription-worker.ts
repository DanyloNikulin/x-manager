export const WORKER_TASK_STATUSES = [
  'pending',
  'in_progress',
  'waiting_approval',
  'done',
  'failed',
  'skipped',
] as const;

export type WorkerTaskStatus = (typeof WORKER_TASK_STATUSES)[number];

export const WORKER_TASK_TYPES = ['post', 'reply'] as const;
export type WorkerTaskType = (typeof WORKER_TASK_TYPES)[number];

export type WorkerTaskQuery = {
  status: WorkerTaskStatus;
  assignedAgent: string | null;
  accountSlot: 1 | 2 | 3 | null;
  limit: number;
};

function cleanString(value: string | null): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function parseWorkerTaskQuery(url: URL): WorkerTaskQuery {
  const rawStatus = cleanString(url.searchParams.get('status')) || 'pending';
  if (!WORKER_TASK_STATUSES.includes(rawStatus as WorkerTaskStatus)) {
    throw new Error('status is invalid.');
  }

  const rawSlot = cleanString(url.searchParams.get('account_slot'));
  let accountSlot: 1 | 2 | 3 | null = null;
  if (rawSlot !== null) {
    const parsed = Number.parseInt(rawSlot, 10);
    if (parsed !== 1 && parsed !== 2 && parsed !== 3) {
      throw new Error('account_slot must be 1, 2, or 3.');
    }
    accountSlot = parsed;
  }

  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '10', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 10;

  return {
    status: rawStatus as WorkerTaskStatus,
    assignedAgent: cleanString(url.searchParams.get('assigned_agent')),
    accountSlot,
    limit,
  };
}

export function parsePositiveTaskId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseWorkerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 100) return null;
  return /^[a-zA-Z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export function isWorkerTaskType(value: string): value is WorkerTaskType {
  return WORKER_TASK_TYPES.includes(value as WorkerTaskType);
}
