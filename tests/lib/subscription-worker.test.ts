import { describe, expect, it } from 'vitest';
import {
  isWorkerTaskType,
  parsePositiveTaskId,
  parseWorkerId,
  parseWorkerTaskQuery,
} from '../../src/lib/subscription-worker';

describe('subscription worker contracts', () => {
  it('parses and caps task queries', () => {
    const url = new URL('http://localhost/api/agent/tasks?status=pending&assigned_agent=subscription&account_slot=2&limit=999');
    expect(parseWorkerTaskQuery(url)).toEqual({
      status: 'pending',
      assignedAgent: 'subscription',
      accountSlot: 2,
      limit: 50,
    });
  });

  it('rejects invalid task query values', () => {
    expect(() => parseWorkerTaskQuery(new URL('http://localhost/api/agent/tasks?status=unknown'))).toThrow();
    expect(() => parseWorkerTaskQuery(new URL('http://localhost/api/agent/tasks?account_slot=4'))).toThrow();
  });

  it('validates worker and task identifiers', () => {
    expect(parseWorkerId('station.worker-1')).toBe('station.worker-1');
    expect(parseWorkerId('../worker')).toBeNull();
    expect(parsePositiveTaskId('42')).toBe(42);
    expect(parsePositiveTaskId('-1')).toBeNull();
  });

  it('only delegates safe content task types', () => {
    expect(isWorkerTaskType('post')).toBe(true);
    expect(isWorkerTaskType('reply')).toBe(true);
    expect(isWorkerTaskType('research')).toBe(false);
    expect(isWorkerTaskType('dm')).toBe(false);
    expect(isWorkerTaskType('like')).toBe(false);
  });
});
