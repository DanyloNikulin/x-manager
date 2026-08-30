import { describe, expect, it } from 'vitest';
import {
  cliAuthArgsFor,
  isAllowedCliAuthOrigin,
  parseCliAuthProvider,
} from '../../src/lib/cli-auth';

describe('CLI auth contracts', () => {
  it('accepts only the fixed provider allow-list', () => {
    expect(parseCliAuthProvider('claude')).toBe('claude');
    expect(parseCliAuthProvider('codex')).toBe('codex');
    expect(parseCliAuthProvider('kimi')).toBe('kimi');
    expect(parseCliAuthProvider('../powershell')).toBeNull();
    expect(parseCliAuthProvider('bash')).toBeNull();
  });

  it('uses login arguments supported by each subscription CLI', () => {
    expect(cliAuthArgsFor('claude', 'login')).toEqual(['auth', 'login', '--claudeai']);
    expect(cliAuthArgsFor('codex', 'login')).toEqual(['login', '--device-auth']);
    expect(cliAuthArgsFor('kimi', 'login')).toEqual(['login']);
  });

  it('accepts the configured public origin behind a local reverse proxy', () => {
    expect(isAllowedCliAuthOrigin(
      'http://127.0.0.1:3999/api/system/cli-auth/kimi',
      'https://station.example.test:8443',
      'https://station.example.test:8443',
    )).toBe(true);
  });

  it('accepts direct same-origin and non-browser requests', () => {
    expect(isAllowedCliAuthOrigin(
      'http://127.0.0.1:3999/api/system/cli-auth/kimi',
      'http://127.0.0.1:3999',
    )).toBe(true);
    expect(isAllowedCliAuthOrigin(
      'http://127.0.0.1:3999/api/system/cli-auth/kimi',
      null,
    )).toBe(true);
  });

  it('rejects foreign and malformed origins', () => {
    expect(isAllowedCliAuthOrigin(
      'http://127.0.0.1:3999/api/system/cli-auth/kimi',
      'https://evil.example',
      'https://station.example.test:8443',
    )).toBe(false);
    expect(isAllowedCliAuthOrigin(
      'http://127.0.0.1:3999/api/system/cli-auth/kimi',
      'not-a-url',
      'https://station.example.test:8443',
    )).toBe(false);
  });
});
