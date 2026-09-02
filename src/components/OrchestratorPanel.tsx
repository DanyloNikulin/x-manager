'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, ChevronDown, ChevronRight, Cpu, FileText, Loader2, RefreshCw } from 'lucide-react';
import CliAuthPanel from '@/components/CliAuthPanel';
import ReadinessPanel from '@/components/ReadinessPanel';
import SetupPanel from '@/components/SetupPanel';
import type { AgentCommandSummary, OrchestratorConfigSummary } from '@/lib/orchestrator-config';
import type { WorkerAssessment, WorkerPass } from '@/lib/worker-log';

/**
 * Level 3: the machine view. Worker loop and its recent passes, the agent commands the
 * orchestrator runs, CLI logins, X API keys and readiness. Nothing per-account lives here.
 */

type FileInfo = { path: string; exists: boolean; sizeBytes: number | null; modifiedAt: string | null };

type WorkerResponse = {
  checkedAt: string;
  root: string;
  worker: WorkerAssessment & { intervalSeconds: number; log: FileInfo & { truncated: boolean }; passes: WorkerPass[] };
  binary: FileInfo;
  config: { path: string; exists: boolean; summary: OrchestratorConfigSummary | null };
};

const cardClass = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4';
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors';
const mono = 'font-mono text-xs text-slate-700 dark:text-slate-200 break-all';

const livenessStyle: Record<WorkerAssessment['liveness'], { label: string; className: string }> = {
  running: { label: 'pass running', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' },
  idle: { label: 'alive', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' },
  stale: { label: 'stale', className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
  unknown: { label: 'no log yet', className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600' },
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function relative(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const millis = new Date(iso).getTime();
  if (!Number.isFinite(millis)) return '—';
  const seconds = Math.max(0, Math.round((now - millis) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

function duration(pass: WorkerPass): string {
  if (!pass.finishedAt) return '…';
  const millis = new Date(pass.finishedAt).getTime() - new Date(pass.startedAt).getTime();
  if (!Number.isFinite(millis) || millis < 0) return '—';
  return millis < 1000 ? `${millis} ms` : `${(millis / 1000).toFixed(millis < 10_000 ? 1 : 0)} s`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  );
}

function levelClass(level: string | null): string {
  if (level === 'ERROR') return 'text-red-600 dark:text-red-400';
  if (level === 'WARN') return 'text-amber-600 dark:text-amber-400';
  if (level === 'INFO') return 'text-emerald-600 dark:text-emerald-400';
  return 'text-slate-400 dark:text-slate-500';
}

function PassRow({ pass, now }: { pass: WorkerPass; now: number }) {
  const [open, setOpen] = useState(false);
  const failed = (pass.exitCode ?? 0) !== 0 || pass.errors > 0 || Boolean(pass.launcherError);
  return (
    <>
      <tr className="border-t border-slate-100 dark:border-slate-700">
        <td className="py-1.5 pr-2">
          <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300" aria-label={open ? 'Hide events' : 'Show events'}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-sm">{formatWhen(pass.startedAt)}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{relative(pass.startedAt, now)}</span>
          </button>
        </td>
        <td className="py-1.5 pr-2 text-sm text-slate-600 dark:text-slate-300">{duration(pass)}</td>
        <td className={`py-1.5 pr-2 text-sm ${failed ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
          {pass.launcherError ? 'launcher error' : pass.exitCode ?? '…'}
        </td>
        <td className="py-1.5 pr-2 text-sm text-slate-600 dark:text-slate-300">{pass.processed ?? '—'}</td>
        <td className="py-1.5 text-sm text-slate-600 dark:text-slate-300">
          {pass.warnings > 0 && <span className="text-amber-600 dark:text-amber-400">{pass.warnings} warn</span>}
          {pass.warnings > 0 && pass.errors > 0 && ' · '}
          {pass.errors > 0 && <span className="text-red-600 dark:text-red-400">{pass.errors} error</span>}
          {pass.warnings === 0 && pass.errors === 0 && '—'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-3">
            {pass.launcherError && <p className="text-xs text-red-600 dark:text-red-400 mb-1">{pass.launcherError}</p>}
            {pass.events.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">No output recorded for this pass.</p>
            ) : (
              <ul className="space-y-0.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700 p-2">
                {pass.events.map((event, index) => (
                  <li key={index} className="font-mono text-[11px] leading-5 text-slate-700 dark:text-slate-200 break-words">
                    <span className={`inline-block w-12 ${levelClass(event.level)}`}>{event.level ?? '·'}</span>
                    {event.target && <span className="text-slate-400 dark:text-slate-500">{event.target.replace('x_manager_orchestrator', 'xmo')}: </span>}
                    {event.message}
                    {Object.entries(event.fields).map(([key, value]) => (
                      <span key={key} className="ml-2 text-slate-500 dark:text-slate-400">
                        {key}=<span className="text-slate-700 dark:text-slate-200">{value}</span>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AgentCard({ role, agent, description }: { role: string; agent: AgentCommandSummary; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 capitalize">{role}</h4>
        <span className="text-xs text-slate-500 dark:text-slate-400">{agent.timeoutSeconds !== null ? `${agent.timeoutSeconds} s timeout` : 'no timeout set'}</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      {agent.program ? (
        <p className={mono}>
          {agent.program} {agent.args.map((arg) => (arg === '' ? '""' : /\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}
        </p>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-300">Not configured; the orchestrator cannot run this role.</p>
      )}
      {agent.schemaPath && <p className="text-xs text-slate-500 dark:text-slate-400">schema {agent.schemaPath}</p>}
    </div>
  );
}

export default function OrchestratorPanel() {
  const [data, setData] = useState<WorkerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/system/worker?passes=15', { cache: 'no-store' });
      const body = (await response.json()) as WorkerResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Failed to read the worker state.');
      setData(body);
      setError('');
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the worker state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const worker = data?.worker ?? null;
  const summary = data?.config.summary ?? null;
  const liveness = worker ? livenessStyle[worker.liveness] : livenessStyle.unknown;

  return (
    <div className="space-y-4">
      <div className={`${cardClass} flex items-start gap-3`}>
        <Cpu className="h-5 w-5 text-teal-600 mt-0.5" />
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Orchestrator</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            The machine view: the subscription worker, the agent commands it runs, CLI logins and X API credentials. Per-account briefs and switches live in Accounts.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Worker</h3>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${liveness.className}`}>{liveness.label}</span>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButton}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>

        {worker && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Fact label="Last pass started">
              {formatWhen(worker.lastStartedAt)} <span className="text-xs text-slate-400 dark:text-slate-500">{relative(worker.lastStartedAt, now)}</span>
            </Fact>
            <Fact label="Last pass finished">
              {formatWhen(worker.lastFinishedAt)} <span className="text-xs text-slate-400 dark:text-slate-500">{relative(worker.lastFinishedAt, now)}</span>
            </Fact>
            <Fact label="Loop interval">every {worker.intervalSeconds} s</Fact>
            <Fact label="Binary">
              {data?.binary.exists ? (
                <>
                  built {formatWhen(data.binary.modifiedAt)} · {formatBytes(data.binary.sizeBytes)}
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">missing</span>
              )}
            </Fact>
            <Fact label="Log">
              <span className={mono}>{worker.log.path}</span>
              <span className="block text-xs text-slate-400 dark:text-slate-500">
                {worker.log.exists ? `${formatBytes(worker.log.sizeBytes)} · written ${relative(worker.log.modifiedAt, now)}` : 'not written yet'}
                {worker.log.truncated ? ' · showing the tail only' : ''}
              </span>
            </Fact>
            <Fact label="Config">
              <span className={mono}>{data?.config.path}</span>
              {!data?.config.exists && <span className="block text-xs text-amber-700 dark:text-amber-300">missing</span>}
            </Fact>
            <Fact label="Checkout">
              <span className={mono}>{data?.root}</span>
            </Fact>
          </dl>
        )}

        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Recent passes</h4>
        {!worker || worker.passes.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No passes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400">
                  <th className="font-medium pb-1 pr-2">Started</th>
                  <th className="font-medium pb-1 pr-2">Duration</th>
                  <th className="font-medium pb-1 pr-2">Exit</th>
                  <th className="font-medium pb-1 pr-2">Tasks</th>
                  <th className="font-medium pb-1">Issues</th>
                </tr>
              </thead>
              <tbody>
                {[...worker.passes].reverse().map((pass) => (
                  <PassRow key={pass.startedAt} pass={pass} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-1">
          <Bot className="h-4 w-4 text-teal-600" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Agents</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Read from orchestrator/config.toml on the host. Edit the file and restart the worker to change them.
        </p>
        {summary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <AgentCard role="planner" agent={summary.agents.planner} description="Decides what each account posts today; may search the web, never drafts or publishes." />
              <AgentCard role="writer" agent={summary.agents.writer} description="Drafts the post or thread from the task, the brief and the source notes." />
              <AgentCard role="validator" agent={summary.agents.validator} description="Judges the draft against the brief and the sources; blocks invented quotations." />
            </div>
            <dl className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <Fact label="Worker id">{summary.worker.id ?? '—'}</Fact>
              <Fact label="Claims tasks for">{summary.worker.assignedAgent ?? '—'}</Fact>
              <Fact label="Tasks per pass">{summary.worker.maxTasksPerRun ?? '—'}</Fact>
              <Fact label="Revision rounds">{summary.worker.maxRevisionRounds ?? '—'}</Fact>
              <Fact label="Fallback plan hour">
                {summary.worker.planHour !== null ? `${String(summary.worker.planHour).padStart(2, '0')}:00` : '—'} {summary.worker.planTimezone ?? ''}
              </Fact>
              <Fact label="Manager">
                <span className={mono}>{summary.manager.baseUrl ?? '—'}</span>
                {summary.manager.adminTokenEnv && <span className="block text-xs text-slate-400 dark:text-slate-500">token from ${summary.manager.adminTokenEnv}</span>}
              </Fact>
            </dl>
            {summary.accounts.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Legacy account blocks</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Fallback only: a stored Account profile always wins. Only the workspace path is still read from here.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 dark:text-slate-400">
                        <th className="font-medium pb-1 pr-3">Slot</th>
                        <th className="font-medium pb-1 pr-3">Workspace</th>
                        <th className="font-medium pb-1 pr-3">Posts</th>
                        <th className="font-medium pb-1 pr-3">Inbound replies</th>
                        <th className="font-medium pb-1 pr-3">Outbound replies</th>
                        <th className="font-medium pb-1">Per day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.accounts.map((account) => (
                        <tr key={account.slot} className="border-t border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                          <td className="py-1 pr-3">{account.slot}</td>
                          <td className={`py-1 pr-3 ${mono}`}>{account.workspace ?? '—'}</td>
                          <td className="py-1 pr-3">{account.postMode ?? '—'}</td>
                          <td className="py-1 pr-3">{account.inboundReplyMode ?? '—'}</td>
                          <td className="py-1 pr-3">{account.outboundReplyMode ?? '—'}</td>
                          <td className="py-1">{account.postsPerDay ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <FileText size={14} /> orchestrator/config.toml was not found next to this checkout.
          </p>
        )}
      </div>

      <CliAuthPanel />
      <SetupPanel />
      <ReadinessPanel />
    </div>
  );
}
