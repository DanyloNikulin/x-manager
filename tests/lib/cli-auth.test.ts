import { afterEach, describe, expect, it } from 'vitest';
import {
  CliAuthError,
  cliAuthArgsFor,
  isAllowedAuthUrl,
  isAllowedCliAuthOrigin,
  loginKeepsStdinOpen,
  parseCliAuthProvider,
  submitCliLoginInput,
  type CliAuthProvider,
} from '../../src/lib/cli-auth';

type CliAuthStore = {
  sessions: Map<CliAuthProvider, {
    id: string;
    provider: CliAuthProvider;
    state: 'running' | 'succeeded' | 'failed' | 'cancelled';
    output: string;
    authUrl: string | null;
    deviceCode: string | null;
    acceptsInput: boolean;
    startedAt: string;
    finishedAt: string | null;
    exitCode: number | null;
    child: { stdin: { destroyed: boolean; writableEnded: boolean; write: (value: string) => void }; kill: () => void };
    timeout: null;
  }>;
};

function authStore(): CliAuthStore {
  return (globalThis as typeof globalThis & { __xManagerCliAuthStore: CliAuthStore }).__xManagerCliAuthStore;
}

afterEach(() => {
  authStore().sessions.clear();
});

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

  it('accepts the Claude CLI authorize URL on claude.com', () => {
    const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    expect(isAllowedAuthUrl('claude', url)).toBe(true);
    expect(isAllowedAuthUrl('claude', 'https://platform.claude.com/oauth/code/callback')).toBe(true);
    expect(isAllowedAuthUrl('claude', 'https://evil.example/oauth')).toBe(false);
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

  it('keeps stdin open only for the Claude browser-code flow', () => {
    expect(loginKeepsStdinOpen('claude')).toBe(true);
    expect(loginKeepsStdinOpen('codex')).toBe(false);
    expect(loginKeepsStdinOpen('kimi')).toBe(false);
  });

  it('rejects submitting a code when no login is running', () => {
    try {
      submitCliLoginInput('claude', 'ABCD');
      throw new Error('expected submitCliLoginInput to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliAuthError);
      expect((error as CliAuthError).status).toBe(409);
    }
  });

  it('rejects an empty login code', () => {
    try {
      submitCliLoginInput('claude', '   ');
      throw new Error('expected submitCliLoginInput to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliAuthError);
      expect((error as CliAuthError).status).toBe(400);
    }
  });

  it('rejects submit when the running session has closed stdin', () => {
    const writes: string[] = [];
    authStore().sessions.set('codex', {
      id: 'session-1',
      provider: 'codex',
      state: 'running',
      output: '',
      authUrl: null,
      deviceCode: null,
      acceptsInput: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      child: {
        stdin: { destroyed: false, writableEnded: true, write: (value: string) => writes.push(value) },
        kill: () => undefined,
      },
      timeout: null,
    });
    try {
      submitCliLoginInput('codex', 'ABCD');
      throw new Error('expected submitCliLoginInput to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliAuthError);
      expect((error as CliAuthError).status).toBe(409);
      expect(writes).toEqual([]);
    }
  });

  it('writes a pasted code to an open stdin', () => {
    const writes: string[] = [];
    authStore().sessions.set('claude', {
      id: 'session-2',
      provider: 'claude',
      state: 'running',
      output: '',
      authUrl: null,
      deviceCode: null,
      acceptsInput: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      child: {
        stdin: { destroyed: false, writableEnded: false, write: (value: string) => writes.push(value) },
        kill: () => undefined,
      },
      timeout: null,
    });
    const session = submitCliLoginInput('claude', '  ABCD  ');
    expect(writes).toEqual(['ABCD\n']);
    expect(session.acceptsInput).toBe(true);
    expect(session.output).toContain('submitted the browser login code');
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
