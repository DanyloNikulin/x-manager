import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SLOTS,
  isAccountSlot,
  normalizeAccountSlot,
  parseAccountSlot,
  requireAccountSlot,
} from '@/lib/account-slots';

describe('account slots', () => {
  it('supports all three posting account slots', () => {
    expect(ACCOUNT_SLOTS).toEqual([1, 2, 3]);
    expect(isAccountSlot(3)).toBe(true);
    expect(parseAccountSlot('3')).toBe(3);
    expect(requireAccountSlot(3)).toBe(3);
  });

  it('rejects slots outside the configured range', () => {
    expect(isAccountSlot(4)).toBe(false);
    expect(parseAccountSlot(4)).toBeNull();
    expect(normalizeAccountSlot(4, 2)).toBe(2);
    expect(() => requireAccountSlot(4)).toThrow('Invalid account slot. Use 1, 2, or 3.');
  });
});
