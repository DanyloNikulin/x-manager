import { describe, expect, it } from 'vitest';
import { asBool, asDate, asInt, asIntOr, asPositiveInt, asString, clamp, isProvided } from '@/lib/http-parse';

describe('http-parse', () => {
  it('trims non-empty strings and rejects other values', () => {
    expect(asString('  hi ')).toBe('hi');
    expect(asString('')).toBeNull();
    expect(asString(1)).toBeNull();
  });

  it('parses common boolean spellings', () => {
    expect(asBool('YES', false)).toBe(true);
    expect(asBool('off', true)).toBe(false);
    expect(asBool(true, false)).toBe(true);
    expect(asBool('maybe', true)).toBe(true);
  });

  it('parses integers with a fallback helper', () => {
    expect(asInt('12')).toBe(12);
    expect(asInt('nope')).toBeNull();
    expect(asIntOr('nope', 4)).toBe(4);
    expect(asInt(3.9)).toBe(3);
  });

  it('treats empty strings as missing and clamps ranges', () => {
    expect(isProvided('')).toBe(false);
    expect(isProvided('x')).toBe(true);
    expect(clamp(40, 1, 10)).toBe(10);
  });

  it('parses positive ints and ISO dates', () => {
    expect(asPositiveInt('12')).toBe(12);
    expect(asPositiveInt('0')).toBeNull();
    expect(asPositiveInt('-3')).toBeNull();
    expect(asDate('2026-01-02T00:00:00.000Z')?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(asDate('nope')).toBeNull();
  });
});
