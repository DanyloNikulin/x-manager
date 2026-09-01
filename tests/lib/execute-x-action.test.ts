import { describe, expect, it } from 'vitest';
import { engagementTypeFor, is429Error, XActionError } from '@/lib/execute-x-action';

describe('execute-x-action helpers', () => {
  it('maps action types onto engagement audit names', () => {
    expect(engagementTypeFor('reply')).toBe('reply');
    expect(engagementTypeFor('dm')).toBe('dm_send');
    expect(engagementTypeFor('post')).toBeNull();
  });

  it('detects rate-limit errors', () => {
    expect(is429Error(new Error('429 Too Many Requests'))).toBe(true);
    expect(is429Error(new Error('nope'))).toBe(false);
    expect(new XActionError('denied', { retryable: true }).retryable).toBe(true);
  });
});
