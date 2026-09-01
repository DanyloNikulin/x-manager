import { describe, expect, it } from 'vitest';
import { isSqliteConstraintError } from '@/lib/sqlite-errors';
import { parseStringArray } from '@/lib/json-array';

describe('sqlite constraint helper', () => {
  it('detects SQLITE_CONSTRAINT messages', () => {
    expect(isSqliteConstraintError(new Error('SQLITE_CONSTRAINT: UNIQUE'))).toBe(true);
    expect(isSqliteConstraintError('other')).toBe(false);
  });
});

describe('parseStringArray', () => {
  it('parses JSON string arrays and treats junk as empty', () => {
    expect(parseStringArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseStringArray('[1,"b"]')).toEqual(['b']);
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray('not-json')).toEqual([]);
  });
});
