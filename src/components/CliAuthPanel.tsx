'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleOff,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';

type Provider = 'claude' | 'codex' | 'kimi';
type LoginState = 'running' | 'succeeded' | 'failed' | 'cancelled';

type ProviderStatus = {
  provider: Provider;
  label: string;
  available: boolean;
  authenticated: boolean;
  authKind: string | null;
  detail: string;
};

type LoginSession = {
  id: string;
  provider: Provider;
  state: LoginState;
  output: string;
  authUrl: string | null;
  deviceCode: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
};

type AuthPayload = {
  providers: ProviderStatus[];
  sessions: Partial<Record<Provider, LoginSession>>;
  error?: string;
};

const providerChrome: Record<Provider, { marker: string; glow: string }> = {
  claude: { marker: 'bg-orange-400', glow: 'from-orange-500/15' },
  codex: { marker: 'bg-emerald-400', glow: 'from-emerald-500/15' },
  kimi: { marker: 'bg-cyan-400', glow: 'from-cyan-500/15' },
};

export default function CliAuthPanel() {
  const [payload, setPayload] = useState<AuthPayload>({ providers: [], sessions: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeAction, setActiveAction] = useState<Provider | null>(null);
  const [codes, setCodes] = useState<Partial<Record<Provider, string>>>({});

  const load = useCallback(async (force = false) => {
    try {
      const response = await fetch(`/api/system/cli-auth${force ? '?refresh=true' : ''}`, { cache: 'no-store' });
      const data = await response.json() as AuthPayload;
      if (!response.ok) throw new Error(data.error || 'Could not read CLI authentication status.');
      setPayload(data);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not read CLI authentication status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const hasRunningLogin = useMemo(
    () => Object.values(payload.sessions).some((session) => session?.state === 'running'),
    [payload.sessions],
  );

  useEffect(() => {
    const timer = window.setInterval(() => void load(false), hasRunningLogin ? 2_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [hasRunningLogin, load]);

  const startLogin = async (provider: Provider) => {
    setActiveAction(provider);
    setError('');
    try {
      const response = await fetch(`/api/system/cli-auth/${provider}`, { method: 'POST' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `Could not start ${provider} login.`);
      await load(false);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : `Could not start ${provider} login.`);
    } finally {
      setActiveAction(null);
    }
  };

  const cancelLogin = async (provider: Provider) => {
    setActiveAction(provider);
    try {
      await fetch(`/api/system/cli-auth/${provider}`, { method: 'DELETE' });
      await load(false);
    } finally {
      setActiveAction(null);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setError('Clipboard access was denied. Select and copy the code manually.');
    }
  };

  const submitBrowserCode = async (provider: Provider) => {
    const code = (codes[provider] || '').trim();
    if (!code) return;
    setActiveAction(provider);
    setError('');
    try {
      const response = await fetch(`/api/system/cli-auth/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not submit the login code.');
      setCodes((current) => ({ ...current, [provider]: '' }));
      await load(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit the login code.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-xl shadow-slate-950/10">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative p-5 md:p-6 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-2.5">
              <Terminal className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">Subscription CLI control deck</h3>
                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">host-local</span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Start official CLI login flows on this server. X-Manager never receives your provider password or stores OAuth tokens.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh status
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-100">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" />
          Login subprocesses run as the same OS user as X-Manager. Metered API-key environment variables are removed before launch.
        </div>

        {error && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {payload.providers.map((provider) => {
            const session = payload.sessions[provider.provider];
            const running = session?.state === 'running';
            const chrome = providerChrome[provider.provider];
            return (
              <article key={provider.provider} className={`relative overflow-hidden rounded-xl border border-slate-700/90 bg-gradient-to-br ${chrome.glow} via-slate-900 to-slate-900 p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${chrome.marker} ${running ? 'animate-pulse' : ''}`} />
                      <h4 className="font-semibold text-white">{provider.label}</h4>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs">
                      {provider.authenticated ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                      ) : (
                        <CircleOff className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span className={provider.authenticated ? 'text-emerald-200' : 'text-slate-400'}>
                        {!provider.available ? 'CLI unavailable' : provider.authenticated ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{provider.authKind || 'oauth'}</span>
                </div>

                <p className="mt-3 min-h-10 text-xs leading-relaxed text-slate-400">{provider.detail}</p>

                {session && (
                  <div className="mt-3 space-y-2 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      <span>Login session</span>
                      <span className={session.state === 'succeeded' ? 'text-emerald-300' : session.state === 'failed' ? 'text-red-300' : 'text-amber-300'}>{session.state}</span>
                    </div>
                    {session.authUrl && (
                      <a
                        href={session.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open sign-in page
                      </a>
                    )}
                    {session.deviceCode && (
                      <button
                        type="button"
                        onClick={() => void copyCode(session.deviceCode!)}
                        className="flex w-full items-center justify-between rounded-md border border-dashed border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm tracking-widest text-white hover:border-slate-400"
                      >
                        <span>{session.deviceCode}</span>
                        <Copy className="h-3.5 w-3.5 text-slate-400" />
                      </button>
                    )}
                    {provider.provider === 'claude' && session.state === 'running' && (
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitBrowserCode('claude');
                        }}
                      >
                        <p className="text-[11px] leading-relaxed text-slate-300">
                          Open the sign-in page, finish in the browser, then paste the code <strong className="text-white">here</strong>. Do not paste it into Claude Code.
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={codes.claude || ''}
                            onChange={(event) => setCodes((current) => ({ ...current, claude: event.target.value }))}
                            placeholder="Paste browser code"
                            autoComplete="off"
                            className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-xs text-white"
                          />
                          <button
                            type="submit"
                            disabled={!codes.claude?.trim() || activeAction === 'claude'}
                            className="rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                          >
                            Send
                          </button>
                        </div>
                      </form>
                    )}
                    {session.output && (
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-slate-400">{session.output}</pre>
                    )}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void startLogin(provider.provider)}
                    disabled={!provider.available || running || activeAction === provider.provider}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition hover:border-slate-400 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {activeAction === provider.provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
                    {provider.authenticated ? 'Re-authenticate' : 'Start login'}
                  </button>
                  {running && (
                    <button
                      type="button"
                      onClick={() => void cancelLogin(provider.provider)}
                      className="inline-flex items-center justify-center rounded-lg border border-red-400/30 bg-red-400/10 px-3 text-red-200 hover:bg-red-400/20"
                      title="Cancel login"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {!loading && payload.providers.length === 0 && (
          <p className="text-sm text-slate-400">No CLI status was returned.</p>
        )}
      </div>
    </section>
  );
}
