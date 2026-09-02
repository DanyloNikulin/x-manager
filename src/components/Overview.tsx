'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Cpu,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  KeyRound,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Settings2,
  TerminalSquare,
} from 'lucide-react';
import type { Overview as OverviewPayload, OverviewPost, OverviewTask, SlotOverview } from '@/lib/overview-model';

/**
 * Level 1: one screen across every account slot. What is planned today, what is queued,
 * what went out and how it did, what waits for a human, and whether the machinery is alive.
 * Per-account editing happens in the Account console (level 2); the machine view is the
 * Orchestrator screen (level 3).
 */

type ReadinessResponse = {
  ready: boolean;
  env: { xApiKey: boolean; xApiSecret: boolean; xBearerToken: boolean; appUrl: boolean };
  auth: { connectedSlots: number[] };
  scheduler: { inAppEnabled: boolean; intervalSeconds: number; running?: boolean; lastCycleAt?: string | null; consecutiveErrors?: number };
};

type CliProviderStatus = { provider: string; label: string; available: boolean; authenticated: boolean };

type WorkerResponse = {
  worker: {
    liveness: 'running' | 'idle' | 'stale' | 'unknown';
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    ageSeconds: number | null;
    intervalSeconds: number;
    passes: Array<{ exitCode: number | null; processed: number | null; warnings: number; errors: number; launcherError: string | null }>;
  };
};

type Tone = 'good' | 'warn' | 'bad' | 'muted';

interface OverviewProps {
  onNavigate: (view: string) => void;
  onOpenConsole: (slot: number) => void;
}

const REFRESH_MS = 60_000;

const cardClass = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
const primaryButton = 'inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-3 py-1.5 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const linkButton = 'inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline';

const toneDot: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  muted: 'bg-slate-400',
};

const toneBadge: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  warn: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  bad: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
  muted: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
};

function relative(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const millis = new Date(iso).getTime();
  if (!Number.isFinite(millis)) return '—';
  const diff = Math.round((millis - now) / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? [abs, 's'] : abs < 3600 ? [Math.round(abs / 60), 'min'] : abs < 86_400 ? [Math.round(abs / 3600), 'h'] : [Math.round(abs / 86_400), 'd'];
  if (abs < 10) return diff <= 0 ? 'just now' : 'in a moment';
  return diff < 0 ? `${unit[0]} ${unit[1]} ago` : `in ${unit[0]} ${unit[1]}`;
}

function clock(iso: string | null | undefined, timeZone: string, now: number): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const options: Intl.DateTimeFormatOptions = { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' };
  if (sameDay.format(date) !== sameDay.format(new Date(now))) {
    options.month = 'short';
    options.day = 'numeric';
  }
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function statusTone(status: SlotOverview['status']): Tone {
  if (status === 'ready') return 'good';
  if (status === 'paused') return 'warn';
  return 'muted';
}

function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneBadge[tone]}`}>
      {children}
    </span>
  );
}

function Pill({ icon, label, value, tone, title }: { icon: React.ReactNode; label: string; value: string; tone: Tone; title?: string }) {
  return (
    <div title={title} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 min-w-0">
      <span className={`h-2 w-2 rounded-full shrink-0 ${toneDot[tone]}`} />
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{icon}</span>
      <span className="text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0">{label}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{value}</span>
    </div>
  );
}

function SectionTitle({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon}
        {children}
      </h4>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 dark:text-slate-500">{children}</p>;
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" title={label}>
      {icon}
      {value}
    </span>
  );
}

function PostRow({ post, timeZone, now, published }: { post: OverviewPost; timeZone: string; now: number; published?: boolean }) {
  return (
    <li className="rounded-lg border border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-200">{clock(post.scheduledTime, timeZone, now)}</span>
        <span>{relative(post.scheduledTime, now)}</span>
        {post.tweets > 1 && <Badge tone="muted">thread · {post.tweets}</Badge>}
        {post.status === 'pending_approval' && <Badge tone="warn">needs approval</Badge>}
        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className={`${linkButton} ml-auto`}>
            open on X <ExternalLink size={12} />
          </a>
        )}
      </div>
      <p className="text-sm text-slate-800 dark:text-slate-100">{excerpt(post.text)}</p>
      {published && (
        <div className="flex items-center gap-3">
          {post.metrics ? (
            <>
              <Metric icon={<Eye size={12} />} value={post.metrics.impressions} label="impressions" />
              <Metric icon={<Heart size={12} />} value={post.metrics.likes} label="likes" />
              <Metric icon={<Repeat2 size={12} />} value={post.metrics.retweets} label="reposts" />
              <Metric icon={<MessageCircle size={12} />} value={post.metrics.replies} label="replies" />
              <span className="text-[11px] text-slate-400 dark:text-slate-500">as of {relative(post.metrics.fetchedAt, now)}</span>
            </>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">no numbers yet</span>
          )}
        </div>
      )}
      {post.errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{excerpt(post.errorMessage, 200)}</p>}
    </li>
  );
}

function taskLabel(task: OverviewTask): string {
  if (task.status === 'in_progress') return task.taskType === 'reply' ? 'replying' : 'writing';
  if (task.status === 'pending') return 'queued';
  if (task.status === 'waiting_approval') return 'needs review';
  return task.status;
}

function TaskRow({ task, now }: { task: OverviewTask; now: number }) {
  const tone: Tone = task.status === 'waiting_approval' ? 'warn' : task.status === 'in_progress' ? 'good' : 'muted';
  return (
    <li className="flex items-start gap-2 text-sm">
      <Badge tone={tone}>{taskLabel(task)}</Badge>
      <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
        {excerpt(task.title, 110)}
        <span className="block text-xs text-slate-400 dark:text-slate-500">
          {task.verdict && task.score !== null ? `${task.verdict} · ${task.score}` : task.taskType}
          {task.claimedBy ? ` · ${task.claimedBy}` : ''}
          {task.updatedAt ? ` · ${relative(task.updatedAt, now)}` : ''}
        </span>
      </span>
    </li>
  );
}

function PlanNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false);
  const short = notes.length > 240 && !open;
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700 px-3 py-2">
      <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{short ? `${notes.slice(0, 239).trimEnd()}…` : notes}</p>
      {notes.length > 240 && (
        <button type="button" onClick={() => setOpen((value) => !value)} className={`${linkButton} mt-1`}>
          {open ? 'Show less' : 'Show the planner notes'}
        </button>
      )}
    </div>
  );
}

function SlotCard({
  slot,
  now,
  busy,
  onNavigate,
  onOpenConsole,
  onSetStatus,
  onReplan,
}: {
  slot: SlotOverview;
  now: number;
  busy: string | null;
  onNavigate: (view: string) => void;
  onOpenConsole: (slot: number) => void;
  onSetStatus: (slot: number, status: 'ready' | 'paused') => void;
  onReplan: (slot: number) => void;
}) {
  const handle = slot.username ? `@${slot.username}` : `Slot ${slot.slot}`;
  const timeZone = slot.planTimezone || 'UTC';
  const waitingCount = slot.draftCount + slot.waitingApproval.length;

  if (!slot.stored && !slot.connected && slot.status === 'needs-onboarding') {
    return (
      <div className={`${cardClass} p-4 flex items-center justify-between gap-4`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-300">{slot.slot}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Slot {slot.slot} is not set up</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Connect an X account and write its brief in Accounts; the planner skips it until then.</p>
          </div>
        </div>
        <button type="button" onClick={() => onOpenConsole(slot.slot)} className={secondaryButton}>
          <Settings2 size={14} /> Set up
        </button>
      </div>
    );
  }

  return (
    <div className={`${cardClass} p-4 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-500 flex items-center justify-center text-white text-sm font-bold shadow-sm">{slot.slot}</span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{handle}</h3>
              {slot.displayName && <span className="text-sm text-slate-500 dark:text-slate-400">{slot.displayName}</span>}
              <Badge tone={statusTone(slot.status)}>{slot.status}</Badge>
              {!slot.connected && <Badge tone="bad">X not connected</Badge>}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              posts <span className="font-medium text-slate-700 dark:text-slate-200">{slot.postMode}</span> · inbound replies{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">{slot.inboundReplyMode}</span> · outbound replies{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">{slot.outboundReplyMode}</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {slot.postsPerDay} per day · plans at {String(slot.planHour).padStart(2, '0')}:00 {timeZone} · publishing window {slot.policy.windowStart}:00–{slot.policy.windowEnd}:00 {slot.policy.timezone}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {slot.status !== 'needs-onboarding' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onSetStatus(slot.slot, slot.status === 'paused' ? 'ready' : 'paused')}
              className={secondaryButton}
              title={slot.status === 'paused' ? 'Let the planner and autopilot run again' : 'Planner skips this slot and nothing publishes automatically'}
            >
              {busy === `status-${slot.slot}` ? <Loader2 size={14} className="animate-spin" /> : slot.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              {slot.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null || !slot.today.marker}
            onClick={() => onReplan(slot.slot)}
            className={secondaryButton}
            title={slot.today.marker ? "Forget today's plan; the next worker pass plans again" : 'Nothing planned today yet'}
          >
            {busy === `replan-${slot.slot}` ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Re-plan today
          </button>
          <button type="button" onClick={() => onOpenConsole(slot.slot)} className={primaryButton}>
            <Settings2 size={14} /> Open console
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div>
          <SectionTitle icon={<CalendarClock size={14} />}>Today · {slot.today.day}</SectionTitle>
          {slot.today.marker ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-800 dark:text-slate-100">
                Planned {clock(slot.today.marker.plannedAt, timeZone, now)}
                {slot.today.marker.created !== null && <> · {count(slot.today.marker.created, 'task')} queued</>}
              </p>
              {slot.today.marker.notes ? <PlanNotes notes={slot.today.marker.notes} /> : <Empty>The planner left no notes.</Empty>}
            </div>
          ) : !slot.today.plannerActive ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{slot.today.reason}</p>
          ) : slot.today.due ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">Planning is due: the next worker pass plans today.</p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Not planned yet · runs at {clock(slot.today.planAt, timeZone, now)} ({relative(slot.today.planAt, now)})
            </p>
          )}
          {slot.inFlight.length > 0 && (
            <ul className="mt-3 space-y-2">
              {slot.inFlight.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionTitle
            icon={<Radio size={14} />}
            action={
              <button type="button" onClick={() => onNavigate('calendar')} className={linkButton}>
                Calendar
              </button>
            }
          >
            Queue
          </SectionTitle>
          {slot.queue.length === 0 ? (
            <Empty>Nothing queued{slot.today.plannerActive ? '; the planner fills this after the planning hour.' : '.'}</Empty>
          ) : (
            <ul className="space-y-2">
              {slot.queue.slice(0, 6).map((post) => (
                <PostRow key={post.id} post={post} timeZone={timeZone} now={now} />
              ))}
              {slot.queue.length > 6 && <li className="text-xs text-slate-400 dark:text-slate-500">+ {slot.queue.length - 6} more in the calendar</li>}
            </ul>
          )}
        </div>

        <div>
          <SectionTitle
            icon={<Eye size={14} />}
            action={
              <button type="button" onClick={() => onNavigate('analytics')} className={linkButton}>
                Analytics
              </button>
            }
          >
            Published
          </SectionTitle>
          {slot.published.length === 0 ? (
            <Empty>Nothing published yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {slot.published.map((post) => (
                <PostRow key={post.id} post={post} timeZone={timeZone} now={now} published />
              ))}
            </ul>
          )}
        </div>
      </div>

      {(waitingCount > 0 || slot.failed.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-700 pt-4">
          {waitingCount > 0 && (
            <div>
              <SectionTitle
                icon={<FileText size={14} />}
                action={
                  slot.draftCount > 0 ? (
                    <button type="button" onClick={() => onNavigate('drafts')} className={linkButton}>
                      Open Drafts
                    </button>
                  ) : undefined
                }
              >
                Waiting for you · {waitingCount}
              </SectionTitle>
              <ul className="space-y-2">
                {slot.drafts.map((draft) => (
                  <li key={`draft-${draft.id}`} className="flex items-start gap-2 text-sm">
                    <Badge tone="warn">{draft.isThread ? `thread · ${draft.tweets}` : 'draft'}</Badge>
                    <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
                      {excerpt(draft.text, 120)}
                      <span className="block text-xs text-slate-400 dark:text-slate-500">{relative(draft.createdAt, now)}</span>
                    </span>
                  </li>
                ))}
                {slot.draftCount > slot.drafts.length && (
                  <li className="text-xs text-slate-400 dark:text-slate-500">+ {slot.draftCount - slot.drafts.length} more drafts</li>
                )}
                {slot.waitingApproval.map((task) => (
                  <TaskRow key={`task-${task.id}`} task={task} now={now} />
                ))}
              </ul>
            </div>
          )}
          {slot.failed.length > 0 && (
            <div>
              <SectionTitle icon={<AlertTriangle size={14} />}>Failed this week</SectionTitle>
              <ul className="space-y-2">
                {slot.failed.map((post) => (
                  <PostRow key={post.id} post={post} timeZone={timeZone} now={now} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Overview({ onNavigate, onOpenConsole }: OverviewProps) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [cli, setCli] = useState<CliProviderStatus[]>([]);
  const [worker, setWorker] = useState<WorkerResponse['worker'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [overviewRes, readinessRes, cliRes, workerRes] = await Promise.all([
        fetch('/api/agent/overview', { cache: 'no-store' }),
        fetch('/api/system/readiness', { cache: 'no-store' }),
        fetch('/api/system/cli-auth', { cache: 'no-store' }),
        fetch('/api/system/worker?passes=3', { cache: 'no-store' }),
      ]);
      const overviewBody = (await overviewRes.json()) as OverviewPayload & { error?: string };
      if (!overviewRes.ok) throw new Error(overviewBody.error || 'Failed to load the overview.');
      setOverview(overviewBody);
      setError('');
      setReadiness(readinessRes.ok ? ((await readinessRes.json()) as ReadinessResponse) : null);
      const cliBody = cliRes.ok ? ((await cliRes.json()) as { providers?: CliProviderStatus[] }) : null;
      setCli(cliBody?.providers ?? []);
      const workerBody = workerRes.ok ? ((await workerRes.json()) as WorkerResponse) : null;
      setWorker(workerBody?.worker ?? null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(true), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 5000);
  }, []);

  const setStatus = useCallback(
    async (slot: number, status: 'ready' | 'paused') => {
      setBusy(`status-${slot}`);
      try {
        const response = await fetch(`/api/agent/accounts/${slot}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error || 'Failed to update the account.');
        flash(status === 'paused' ? `Slot ${slot} paused.` : `Slot ${slot} resumed.`);
        await load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update the account.');
      } finally {
        setBusy(null);
      }
    },
    [flash, load],
  );

  const replan = useCallback(
    async (slot: number) => {
      if (!window.confirm(`Forget today's plan for slot ${slot}? The next worker pass will plan it again.`)) return;
      setBusy(`replan-${slot}`);
      try {
        const response = await fetch(`/api/agent/accounts/${slot}/replan`, { method: 'POST' });
        const body = (await response.json()) as { error?: string; day?: string };
        if (!response.ok) throw new Error(body.error || 'Failed to reset the plan.');
        flash(`Plan for ${body.day ?? 'today'} forgotten; the worker plans slot ${slot} again on its next pass.`);
        await load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reset the plan.');
      } finally {
        setBusy(null);
      }
    },
    [flash, load],
  );

  const health = useMemo(() => {
    const workerPill = (() => {
      if (!worker) return { tone: 'muted' as Tone, value: 'no data' };
      const last = worker.passes[worker.passes.length - 1];
      const detail = last ? `exit ${last.exitCode ?? '?'}${last.processed !== null ? ` · ${count(last.processed, 'task')}` : ''}${last.warnings ? ` · ${count(last.warnings, 'warning')}` : ''}` : '';
      if (worker.liveness === 'running') return { tone: 'good' as Tone, value: `pass running (${relative(worker.lastStartedAt, now)})` };
      if (worker.liveness === 'idle') {
        const tone: Tone = last && ((last.exitCode ?? 0) !== 0 || last.errors > 0 || last.launcherError) ? 'warn' : 'good';
        return { tone, value: `last pass ${relative(worker.lastFinishedAt, now)} · ${detail}` };
      }
      if (worker.liveness === 'stale') return { tone: 'bad' as Tone, value: `no pass since ${relative(worker.lastFinishedAt ?? worker.lastStartedAt, now)}` };
      return { tone: 'muted' as Tone, value: 'no worker log yet' };
    })();

    const schedulerPill = (() => {
      if (!readiness) return { tone: 'muted' as Tone, value: 'no data' };
      if (!readiness.scheduler.inAppEnabled) return { tone: 'bad' as Tone, value: 'disabled' };
      if (!readiness.scheduler.running) return { tone: 'bad' as Tone, value: 'not running' };
      const errors = readiness.scheduler.consecutiveErrors ?? 0;
      return {
        tone: (errors > 0 ? 'warn' : 'good') as Tone,
        value: `cycle ${relative(readiness.scheduler.lastCycleAt, now)}${errors > 0 ? ` · ${count(errors, 'error')}` : ''}`,
      };
    })();

    const cliPill = (() => {
      if (cli.length === 0) return { tone: 'muted' as Tone, value: 'no data' };
      const authed = cli.filter((provider) => provider.authenticated).length;
      const tone: Tone = authed === cli.length ? 'good' : authed === 0 ? 'bad' : 'warn';
      return { tone, value: cli.map((provider) => `${provider.label} ${provider.authenticated ? '✓' : '✗'}`).join(' · ') };
    })();

    const apiPill = (() => {
      if (!readiness) return { tone: 'muted' as Tone, value: 'no data' };
      const keys = [readiness.env.xApiKey, readiness.env.xApiSecret, readiness.env.xBearerToken].filter(Boolean).length;
      const slots = readiness.auth.connectedSlots;
      const tone: Tone = keys === 3 && slots.length > 0 ? 'good' : keys === 0 ? 'bad' : 'warn';
      return { tone, value: `${keys}/3 keys · ${slots.length > 0 ? `slots ${slots.join(', ')} connected` : 'no slot connected'}` };
    })();

    return { workerPill, schedulerPill, cliPill, apiPill };
  }, [cli, now, readiness, worker]);

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-160px)]">
        <Loader2 className="animate-spin h-8 w-8 text-teal-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600" aria-label="Dismiss error">
            &times;
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>
      )}

      <div className={`${cardClass} p-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 flex-1 min-w-0">
            <Pill icon={<Cpu size={14} />} label="Worker" value={health.workerPill.value} tone={health.workerPill.tone} title="Subscription worker loop on the host" />
            <Pill icon={<Radio size={14} />} label="Scheduler" value={health.schedulerPill.value} tone={health.schedulerPill.tone} title="In-app scheduler that posts to X" />
            <Pill icon={<TerminalSquare size={14} />} label="CLI logins" value={health.cliPill.value} tone={health.cliPill.tone} title="Subscription CLIs the agents run through" />
            <Pill icon={<KeyRound size={14} />} label="X API" value={health.apiPill.value} tone={health.apiPill.tone} title="App credentials and connected account slots" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load(true)} disabled={loading} className={secondaryButton} title={overview ? `Updated ${relative(overview.generatedAt, now)}` : undefined}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button type="button" onClick={() => onNavigate('settings')} className={secondaryButton}>
              <Cpu size={14} /> Orchestrator
            </button>
          </div>
        </div>
      </div>

      {overview?.slots.map((slot) => (
        <SlotCard
          key={slot.slot}
          slot={slot}
          now={now}
          busy={busy}
          onNavigate={onNavigate}
          onOpenConsole={onOpenConsole}
          onSetStatus={(target, status) => void setStatus(target, status)}
          onReplan={(target) => void replan(target)}
        />
      ))}
    </div>
  );
}
