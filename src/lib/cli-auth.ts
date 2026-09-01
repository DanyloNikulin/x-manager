import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

export const CLI_AUTH_PROVIDERS = ['claude', 'codex', 'kimi'] as const;
export type CliAuthProvider = (typeof CLI_AUTH_PROVIDERS)[number];
export type CliLoginState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type CliProviderStatus = {
  provider: CliAuthProvider;
  label: string;
  available: boolean;
  authenticated: boolean;
  authKind: string | null;
  detail: string;
};

export type CliLoginSessionView = {
  id: string;
  provider: CliAuthProvider;
  state: CliLoginState;
  output: string;
  authUrl: string | null;
  deviceCode: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
};

type CliLoginSession = CliLoginSessionView & {
  child: ChildProcessWithoutNullStreams;
  timeout: NodeJS.Timeout | null;
};

type CliAuthStore = {
  sessions: Map<CliAuthProvider, CliLoginSession>;
  statusCache: { expiresAt: number; value: CliProviderStatus[] } | null;
};

type CommandSpec = { program: string; args: string[]; windowsVerbatimArguments?: boolean };
type BufferedResult = { exitCode: number | null; stdout: string; stderr: string; unavailable: boolean };

const MAX_SESSION_OUTPUT = 16 * 1024;
const MAX_STATUS_OUTPUT = 128 * 1024;
const LOGIN_TIMEOUT_MS = 20 * 60 * 1000;
const STATUS_CACHE_MS = 5_000;

const storeGlobal = globalThis as typeof globalThis & { __xManagerCliAuthStore?: CliAuthStore };
const store = storeGlobal.__xManagerCliAuthStore ?? {
  sessions: new Map<CliAuthProvider, CliLoginSession>(),
  statusCache: null,
};
storeGlobal.__xManagerCliAuthStore = store;

const providerLabels: Record<CliAuthProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  kimi: 'Kimi Code',
};

const allowedAuthHosts: Record<CliAuthProvider, string[]> = {
  claude: ['claude.ai', 'claude.com', 'anthropic.com'],
  codex: ['openai.com', 'chatgpt.com'],
  kimi: ['kimi.ai', 'kimi.com'],
};

export function parseCliAuthProvider(value: string): CliAuthProvider | null {
  return CLI_AUTH_PROVIDERS.includes(value as CliAuthProvider)
    ? value as CliAuthProvider
    : null;
}

export function isAllowedCliAuthOrigin(
  requestUrl: string,
  originHeader: string | null,
  configuredAppUrl?: string,
): boolean {
  if (!originHeader) return true;

  try {
    const allowedOrigins = new Set([new URL(requestUrl).origin]);
    if (configuredAppUrl?.trim()) {
      try {
        allowedOrigins.add(new URL(configuredAppUrl.trim()).origin);
      } catch {
        // An invalid public URL must not add another allowed origin.
      }
    }
    return allowedOrigins.has(new URL(originHeader).origin);
  } catch {
    return false;
  }
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const blocked = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
    'CODEX_ACCESS_TOKEN',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'XAI_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'KIMI_API_KEY',
    'MOONSHOT_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'X_MANAGER_ADMIN_TOKEN',
  ];
  for (const name of blocked) delete env[name];
  return env;
}

function wrapWindowsBatch(program: string, args: string[]): CommandSpec {
  const quoted = [program, ...args]
    .map((value) => `"${value.replace(/"/g, '""')}"`)
    .join(' ');
  return {
    program: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${quoted}"`],
    windowsVerbatimArguments: true,
  };
}

function resolveWindowsCommand(name: string, args: string[]): CommandSpec | null {
  const where = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
  const result = spawnSync(where, [name], {
    encoding: 'utf8',
    env: cleanEnvironment(),
    windowsHide: true,
  });
  if (result.status !== 0) return null;

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => /\.(?:exe|cmd|bat)$/i.test(candidate));
  for (const extension of ['.exe', '.cmd', '.bat']) {
    const candidate = candidates.find((value) => value.toLowerCase().endsWith(extension));
    if (!candidate) continue;
    return extension === '.exe'
      ? { program: candidate, args }
      : wrapWindowsBatch(candidate, args);
  }
  return null;
}

export function cliAuthArgsFor(
  provider: CliAuthProvider,
  operation: 'status' | 'login',
): string[] {
  return operation === 'login'
    ? provider === 'claude'
      ? ['auth', 'login', '--claudeai']
      : provider === 'codex'
        ? ['login', '--device-auth']
        : ['login']
    : provider === 'claude'
      ? ['auth', 'status']
      : provider === 'codex'
        ? ['login', 'status']
        : ['--version'];
}

function commandFor(provider: CliAuthProvider, operation: 'status' | 'login'): CommandSpec {
  const override = process.env[`X_MANAGER_${provider.toUpperCase()}_BIN`]?.trim();
  const args = cliAuthArgsFor(provider, operation);

  if (override) {
    return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(override)
      ? wrapWindowsBatch(override, args)
      : { program: override, args };
  }

  if (process.platform === 'win32') {
    return resolveWindowsCommand(provider, args) ?? { program: `${provider}.exe`, args };
  }

  return {
    program: provider,
    args,
  };
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-api-key]')
    .replace(/((?:access|refresh|id)[_-]?token\s*[:=]\s*)[^\s"']+/gi, '$1[redacted]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1[redacted]');
}

function appendOutput(session: CliLoginSession, chunk: Buffer | string): void {
  if (session.output.length >= MAX_SESSION_OUTPUT) return;
  session.output = sanitizeOutput(`${session.output}${chunk.toString()}`).slice(0, MAX_SESSION_OUTPUT);
  extractLoginHints(session);
}

export function isAllowedAuthUrl(provider: CliAuthProvider, candidate: string): boolean {
  try {
    const url = new URL(candidate.replace(/[),.;]+$/, ''));
    return url.protocol === 'https:' && allowedAuthHosts[provider].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function extractLoginHints(session: CliLoginSession): void {
  if (!session.authUrl) {
    const urls = session.output.match(/https:\/\/[^\s<>"']+/g) ?? [];
    const allowed = urls.find((candidate) => isAllowedAuthUrl(session.provider, candidate));
    if (allowed) session.authUrl = allowed.replace(/[),.;]+$/, '');
  }
  if (!session.deviceCode) {
    const explicit = session.output.match(/(?:enter\s+code|user[_ -]?code)\s*[:=]?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})?)/i);
    const generic = session.output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
    session.deviceCode = explicit?.[1]?.toUpperCase() ?? generic?.[1]?.toUpperCase() ?? null;
  }
}

function sessionView(session: CliLoginSession): CliLoginSessionView {
  return {
    id: session.id,
    provider: session.provider,
    state: session.state,
    output: session.output,
    authUrl: session.authUrl,
    deviceCode: session.deviceCode,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    exitCode: session.exitCode,
  };
}

function runBuffered(spec: CommandSpec, timeoutMs = 10_000): Promise<BufferedResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(spec.program, spec.args, {
      cwd: process.cwd(),
      env: cleanEnvironment(),
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: BufferedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, stderr: `${stderr}\nStatus check timed out.`, unavailable: false });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_STATUS_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STATUS_OUTPUT) stderr += chunk.toString();
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ exitCode: null, stdout, stderr: error.message, unavailable: error.code === 'ENOENT' });
    });
    child.on('close', (exitCode) => {
      finish({ exitCode, stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr), unavailable: false });
    });
  });
}

async function statusFor(provider: CliAuthProvider): Promise<CliProviderStatus> {
  const result = await runBuffered(commandFor(provider, 'status'));
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (result.unavailable) {
    return {
      provider,
      label: providerLabels[provider],
      available: false,
      authenticated: false,
      authKind: null,
      detail: 'CLI is not installed or not visible to the X-Manager service user.',
    };
  }

  if (provider === 'claude') {
    try {
      const parsed = JSON.parse(result.stdout) as { loggedIn?: boolean; authMethod?: string };
      return {
        provider,
        label: providerLabels[provider],
        available: true,
        authenticated: parsed.loggedIn === true,
        authKind: parsed.loggedIn ? parsed.authMethod || 'Claude subscription' : null,
        detail: parsed.loggedIn ? `Connected with ${parsed.authMethod || 'Claude subscription'}.` : 'Not signed in.',
      };
    } catch {
      return { provider, label: providerLabels[provider], available: true, authenticated: false, authKind: null, detail: combined || 'Could not parse Claude auth status.' };
    }
  }

  if (provider === 'codex') {
    const authenticated = /logged in using/i.test(combined);
    return {
      provider,
      label: providerLabels[provider],
      available: true,
      authenticated,
      authKind: authenticated ? combined.replace(/^.*logged in using\s*/i, '').trim() || 'ChatGPT' : null,
      detail: authenticated ? combined : 'Not signed in.',
    };
  }

  const credentialPath = path.join(os.homedir(), '.kimi-code', 'credentials', 'kimi-code.json');
  const credentialResult = await runBuffered({
    program: process.execPath,
    args: [
      '-e',
      `process.exit(require('fs').existsSync(${JSON.stringify(credentialPath)}) ? 0 : 1)`,
    ],
  });
  const authenticated = credentialResult.exitCode === 0;
  return {
    provider,
    label: providerLabels[provider],
    available: result.exitCode === 0,
    authenticated,
    authKind: authenticated ? 'stored OAuth' : null,
    detail: authenticated ? 'Stored Kimi OAuth credentials found; validity is confirmed on the next run.' : 'Not signed in.',
  };
}

export async function getCliProviderStatuses(force = false): Promise<CliProviderStatus[]> {
  if (!force && store.statusCache && store.statusCache.expiresAt > Date.now()) {
    return store.statusCache.value;
  }
  const value = await Promise.all(CLI_AUTH_PROVIDERS.map(statusFor));
  store.statusCache = { expiresAt: Date.now() + STATUS_CACHE_MS, value };
  return value;
}

export function getCliLoginSessions(): Partial<Record<CliAuthProvider, CliLoginSessionView>> {
  return Object.fromEntries(
    Array.from(store.sessions.entries(), ([provider, session]) => [provider, sessionView(session)]),
  );
}

export function startCliLogin(provider: CliAuthProvider): CliLoginSessionView {
  const existing = store.sessions.get(provider);
  if (existing?.state === 'running') return sessionView(existing);

  const spec = commandFor(provider, 'login');
  const child = spawn(spec.program, spec.args, {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const now = new Date().toISOString();
  const session: CliLoginSession = {
    id: crypto.randomUUID(),
    provider,
    state: 'running',
    output: '',
    authUrl: null,
    deviceCode: null,
    startedAt: now,
    finishedAt: null,
    exitCode: null,
    child,
    timeout: null,
  };
  // Codex/Kimi device flows never read stdin. Claude prints a browser URL,
  // then waits for the one-time code — keep stdin open so the dashboard can
  // send that code. Close stdin for everyone else so a hidden process cannot
  // hang on an interactive prompt.
  if (provider !== 'claude') {
    child.stdin.end();
  }
  session.timeout = setTimeout(() => {
    if (session.state !== 'running') return;
    session.state = 'failed';
    session.finishedAt = new Date().toISOString();
    appendOutput(session, '\nLogin timed out. Start a new login session.\n');
    child.kill();
    store.statusCache = null;
  }, LOGIN_TIMEOUT_MS);
  store.sessions.set(provider, session);

  child.stdout.on('data', (chunk) => appendOutput(session, chunk));
  child.stderr.on('data', (chunk) => appendOutput(session, chunk));
  child.on('error', (error: NodeJS.ErrnoException) => {
    if (session.state !== 'running') return;
    session.state = 'failed';
    session.finishedAt = new Date().toISOString();
    appendOutput(session, `\nCould not start ${providerLabels[provider]}: ${error.message}\n`);
    if (session.timeout) clearTimeout(session.timeout);
    store.statusCache = null;
  });
  child.on('close', (exitCode) => {
    if (session.state !== 'running') return;
    session.exitCode = exitCode;
    session.state = exitCode === 0 ? 'succeeded' : 'failed';
    session.finishedAt = new Date().toISOString();
    if (session.timeout) clearTimeout(session.timeout);
    store.statusCache = null;
  });

  return sessionView(session);
}

export function submitCliLoginInput(provider: CliAuthProvider, code: string): CliLoginSessionView {
  const session = store.sessions.get(provider);
  if (!session || session.state !== 'running') {
    throw new Error('No running login session to receive a code.');
  }
  const stdin = session.child.stdin;
  if (!stdin || stdin.destroyed) {
    throw new Error('This login session cannot accept a pasted code.');
  }
  stdin.write(`${code.trim()}\n`);
  appendOutput(session, '\n[dashboard] submitted the browser login code\n');
  return sessionView(session);
}

export function cancelCliLogin(provider: CliAuthProvider): CliLoginSessionView | null {
  const session = store.sessions.get(provider);
  if (!session) return null;
  if (session.state === 'running') {
    session.state = 'cancelled';
    session.finishedAt = new Date().toISOString();
    if (session.timeout) clearTimeout(session.timeout);
    session.child.kill();
  }
  return sessionView(session);
}
