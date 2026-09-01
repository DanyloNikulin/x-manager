import { describe, expect, it } from 'vitest';
import { asBool, asInt, asIntOr, asString } from '@/lib/http-parse';

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
});
