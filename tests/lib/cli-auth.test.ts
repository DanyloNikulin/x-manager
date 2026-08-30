import { describe, expect, it } from 'vitest';
import { parseCliAuthProvider } from '../../src/lib/cli-auth';

describe('CLI auth contracts', () => {
  it('accepts only the fixed provider allow-list', () => {
    expect(parseCliAuthProvider('claude')).toBe('claude');
    expect(parseCliAuthProvider('codex')).toBe('codex');
    expect(parseCliAuthProvider('kimi')).toBe('kimi');
    expect(parseCliAuthProvider('../powershell')).toBeNull();
    expect(parseCliAuthProvider('bash')).toBeNull();
  });
});
