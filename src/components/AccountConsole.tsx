'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, Save, Settings2, Activity as ActivityIcon, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  BRIEF_FIELDS,
  MAX_POSTS_PER_DAY,
  PROFILE_STATUSES,
  PUBLICATION_MODES,
  type BriefField,
  type ProfileStatus,
  type PublicationMode,
} from '@/lib/account-profile-validation';

type ProfileView = {
  slot: number;
  status: ProfileStatus;
  language: string;
  profile: string;
  voice: string;
  strategy: string;
  memory: string;
  postMode: PublicationMode;
  inboundReplyMode: PublicationMode;
  outboundReplyMode: PublicationMode;
  postsPerDay: number;
  planHour: number;
  planTimezone: string;
  updatedAt: string | null;
  stored: boolean;
  connected: boolean;
  username: string | null;
  displayName: string | null;
};

type SlotPolicy = {
  maxPostsPerDay: number;
  maxRepliesPerHour: number;
  maxDmsPerDay: number;
  maxLikesPerHour: number;
  allowedWindowStart: number;
  allowedWindowEnd: number;
  timezone: string;
};

type CampaignTask = {
  id: number;
  title: string;
  status: string;
  taskType: string;
  assignedAgent: string | null;
  details: string | null;
  output: string | null;
};

type RecentPost = {
  id: number;
  status: string;
  text: string;
  scheduledTime: string | null;
  twitterPostId?: string | null;
};

type Tab = 'brief' | 'behaviour' | 'activity';

const COMMON_TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Kyiv', 'Asia/Tokyo'];

const BRIEF_HINTS: Record<BriefField, string> = {
  profile: 'Who this account is: handle, niche, audience, goal, hard constraints. The writer and planner treat this as trusted context.',
  voice: 'Representative posts, preferred phrasing, forbidden patterns, tone boundaries.',
  strategy: 'Content pillars, target conversations, cadence, conversion goal, topics that need operator review.',
  memory: 'Dated observations about what performed and validated voice lessons. Never secrets or private messages.',
};

const MODE_HINTS: Record<PublicationMode, string> = {
  auto: 'validated content is scheduled into the policy window without a human',
  approval: 'validated content waits in Drafts for a human',
  draft: 'everything lands in Drafts',
};

function statusBadge(status: ProfileStatus): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
  if (status === 'paused') return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
  return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600';
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const inputClass = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';
const labelClass = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';
const primaryButton = 'inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-3 py-1.5 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors';

interface AccountConsoleProps {
  /** Slot to open first, e.g. from the Overview's "Open console" action. */
  initialSlot?: number;
}

export default function AccountConsole({ initialSlot }: AccountConsoleProps) {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number>(initialSlot ?? 1);

  useEffect(() => {
    if (initialSlot) setSelectedSlot(initialSlot);
  }, [initialSlot]);
  const [tab, setTab] = useState<Tab>('brief');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/agent/accounts', { cache: 'no-store' });
      const data = (await response.json()) as { items?: ProfileView[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to load account profiles.');
      setProfiles(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account profiles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const selected = useMemo(() => profiles.find((item) => item.slot === selectedSlot) ?? null, [profiles, selectedSlot]);

  const handleSaved = useCallback((profile: ProfileView, message: string) => {
    setProfiles((prev) => prev.map((item) => (item.slot === profile.slot ? { ...item, ...profile } : item)));
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <aside className="space-y-3">
        {loading && profiles.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
          </div>
        ) : (
          profiles.map((profile) => (
            <button
              key={profile.slot}
              onClick={() => setSelectedSlot(profile.slot)}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${
                profile.slot === selectedSlot
                  ? 'border-teal-500 bg-teal-50/60 dark:bg-teal-900/20'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {profile.username ? `@${profile.username}` : `Slot ${profile.slot}`}
                </span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusBadge(profile.status)}`}>{profile.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Slot {profile.slot} · {profile.connected ? 'connected' : 'not connected'}
              </p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                posts: <span className="font-medium">{profile.postMode}</span> · {profile.postsPerDay}/day · plan {String(profile.planHour).padStart(2, '0')}:00 {profile.planTimezone}
              </p>
            </button>
          ))
        )}
        <button onClick={() => void loadProfiles()} className={`${secondaryButton} w-full justify-center`} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </aside>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-4 min-h-[480px]">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> <span>{notice}</span>
          </div>
        )}

        {!selected ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Select a slot.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 pb-3 mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {selected.username ? `@${selected.username}` : `Slot ${selected.slot}`}
                  {selected.displayName && selected.displayName !== selected.username ? (
                    <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">{selected.displayName}</span>
                  ) : null}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selected.stored ? `Brief saved ${formatWhen(selected.updatedAt)}` : 'No brief stored yet — the worker falls back to config.toml and accounts/slot-N files.'}
                </p>
              </div>
              <nav className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
                {([
                  ['brief', 'Brief', <BookOpen key="b" className="h-3.5 w-3.5" />],
                  ['behaviour', 'Behaviour', <Settings2 key="s" className="h-3.5 w-3.5" />],
                  ['activity', 'Activity', <ActivityIcon key="a" className="h-3.5 w-3.5" />],
                ] as Array<[Tab, string, React.ReactNode]>).map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      tab === key ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </nav>
            </div>

            {tab === 'brief' && <BriefTab key={`brief-${selected.slot}-${selected.updatedAt ?? 'new'}`} profile={selected} onSaved={handleSaved} onError={setError} />}
            {tab === 'behaviour' && <BehaviourTab key={`behaviour-${selected.slot}-${selected.updatedAt ?? 'new'}`} profile={selected} onSaved={handleSaved} onError={setError} onNotice={setNotice} />}
            {tab === 'activity' && <ActivityTab key={`activity-${selected.slot}`} slot={selected.slot} />}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

function BriefTab({ profile, onSaved, onError }: { profile: ProfileView; onSaved: (p: ProfileView, m: string) => void; onError: (m: string) => void }) {
  const [texts, setTexts] = useState<Record<BriefField, string>>({
    profile: profile.profile,
    voice: profile.voice,
    strategy: profile.strategy,
    memory: profile.memory,
  });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const dirty = BRIEF_FIELDS.some((field) => texts[field] !== profile[field]);

  const save = async () => {
    setSaving(true);
    onError('');
    try {
      const response = await fetch(`/api/agent/accounts/${profile.slot}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(texts),
      });
      const data = (await response.json()) as { profile?: ProfileView; error?: string; details?: string[] };
      if (!response.ok || !data.profile) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(' '));
      onSaved({ ...profile, ...data.profile }, 'Brief saved. The worker picks it up on its next pass.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save brief.');
    } finally {
      setSaving(false);
    }
  };

  const importFromFiles = async () => {
    if (!confirm(`Replace the stored brief for slot ${profile.slot} with accounts/slot-${profile.slot}/*.md from the server?`)) return;
    setImporting(true);
    onError('');
    try {
      const response = await fetch(`/api/agent/accounts/${profile.slot}/import`, { method: 'POST' });
      const data = (await response.json()) as { profile?: ProfileView; imported?: string[]; missing?: string[]; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || 'Import failed.');
      setTexts({ profile: data.profile.profile, voice: data.profile.voice, strategy: data.profile.strategy, memory: data.profile.memory });
      onSaved({ ...profile, ...data.profile }, `Imported ${data.imported?.join(', ') || 'nothing'}${data.missing?.length ? `; missing: ${data.missing.join(', ')}` : ''}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {BRIEF_FIELDS.map((field) => (
        <div key={field}>
          <label className={labelClass}>
            {field}.md
            <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">{BRIEF_HINTS[field]}</span>
          </label>
          <textarea
            value={texts[field]}
            onChange={(event) => setTexts((prev) => ({ ...prev, [field]: event.target.value }))}
            rows={field === 'memory' ? 6 : 8}
            spellCheck={false}
            className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={saving || !dirty} className={primaryButton}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save brief
        </button>
        <button onClick={() => void importFromFiles()} disabled={importing} className={secondaryButton}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import from server files
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Behaviour (switches + policy)
// ---------------------------------------------------------------------------

function BehaviourTab({ profile, onSaved, onError, onNotice }: { profile: ProfileView; onSaved: (p: ProfileView, m: string) => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [form, setForm] = useState({
    status: profile.status,
    language: profile.language,
    postMode: profile.postMode,
    inboundReplyMode: profile.inboundReplyMode,
    outboundReplyMode: profile.outboundReplyMode,
    postsPerDay: profile.postsPerDay,
    planHour: profile.planHour,
    planTimezone: profile.planTimezone,
  });
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<SlotPolicy | null>(null);
  const [policyForm, setPolicyForm] = useState<SlotPolicy | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/agent/policy?slot=${profile.slot}`, { cache: 'no-store' });
        const data = (await response.json()) as { policy?: SlotPolicy; error?: string };
        if (!response.ok || !data.policy) throw new Error(data.error || 'Failed to load policy.');
        if (!cancelled) {
          setPolicy(data.policy);
          setPolicyForm(data.policy);
        }
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : 'Failed to load policy.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.slot, onError]);

  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((key) => form[key] !== profile[key]);
  const policyDirty = Boolean(policy && policyForm && JSON.stringify(policy) !== JSON.stringify(policyForm));

  const save = async () => {
    setSaving(true);
    onError('');
    try {
      const response = await fetch(`/api/agent/accounts/${profile.slot}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { profile?: ProfileView; error?: string; details?: string[] };
      if (!response.ok || !data.profile) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(' '));
      onSaved({ ...profile, ...data.profile }, 'Behaviour saved. The worker reads it on its next pass.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save behaviour.');
    } finally {
      setSaving(false);
    }
  };

  const savePolicy = async () => {
    if (!policyForm) return;
    setSavingPolicy(true);
    onError('');
    try {
      const response = await fetch('/api/agent/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: profile.slot, ...policyForm }),
      });
      const data = (await response.json()) as { policy?: SlotPolicy; error?: string };
      if (!response.ok || !data.policy) throw new Error(data.error || 'Failed to save policy.');
      setPolicy(data.policy);
      setPolicyForm(data.policy);
      onNotice('Policy saved. Applies to the next planned publish time.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save policy.');
    } finally {
      setSavingPolicy(false);
    }
  };

  const modeSelect = (key: 'postMode' | 'inboundReplyMode' | 'outboundReplyMode', label: string) => (
    <div>
      <label className={labelClass}>{label}</label>
      <select value={form[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value as PublicationMode }))} className={inputClass}>
        {PUBLICATION_MODES.map((mode) => (
          <option key={mode} value={mode}>{mode} — {MODE_HINTS[mode]}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Autopilot</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Status</label>
            <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as ProfileStatus }))} className={inputClass}>
              {PROFILE_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">ready = worker uses this brief · paused = planner skips, nothing auto-publishes · needs-onboarding = fall back to files</p>
          </div>
          <div>
            <label className={labelClass}>Language</label>
            <input value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} className={inputClass} placeholder="en" />
          </div>
          {modeSelect('postMode', 'Posts')}
          {modeSelect('inboundReplyMode', 'Replies to people who wrote to us')}
          {modeSelect('outboundReplyMode', 'Replies to strangers')}
          <div>
            <label className={labelClass}>Posts per day (planner budget, 0 = planner off)</label>
            <input type="number" min={0} max={MAX_POSTS_PER_DAY} value={form.postsPerDay} onChange={(event) => setForm((prev) => ({ ...prev, postsPerDay: Number(event.target.value) }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Plan at hour (0–23)</label>
            <input type="number" min={0} max={23} value={form.planHour} onChange={(event) => setForm((prev) => ({ ...prev, planHour: Number(event.target.value) }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Planner timezone</label>
            <input list="xm-timezones" value={form.planTimezone} onChange={(event) => setForm((prev) => ({ ...prev, planTimezone: event.target.value }))} className={inputClass} />
          </div>
        </div>
        <datalist id="xm-timezones">
          {COMMON_TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
        </datalist>
        <div className="flex items-center gap-2">
          <button onClick={() => void save()} disabled={saving || !dirty} className={primaryButton}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save behaviour
          </button>
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
        </div>
      </div>

      <div className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-4">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Publishing window &amp; quotas</h4>
        {!policyForm ? (
          <p className="text-sm text-slate-500 dark:text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading policy…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>Window from (hour)</label>
                <input type="number" min={0} max={23} value={policyForm.allowedWindowStart} onChange={(event) => setPolicyForm({ ...policyForm, allowedWindowStart: Number(event.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Window until (hour, exclusive)</label>
                <input type="number" min={0} max={23} value={policyForm.allowedWindowEnd} onChange={(event) => setPolicyForm({ ...policyForm, allowedWindowEnd: Number(event.target.value) })} className={inputClass} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Window timezone</label>
                <input list="xm-timezones" value={policyForm.timezone} onChange={(event) => setPolicyForm({ ...policyForm, timezone: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Max posts / day</label>
                <input type="number" min={0} value={policyForm.maxPostsPerDay} onChange={(event) => setPolicyForm({ ...policyForm, maxPostsPerDay: Number(event.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Max replies / hour</label>
                <input type="number" min={0} value={policyForm.maxRepliesPerHour} onChange={(event) => setPolicyForm({ ...policyForm, maxRepliesPerHour: Number(event.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Max likes / hour</label>
                <input type="number" min={0} value={policyForm.maxLikesPerHour} onChange={(event) => setPolicyForm({ ...policyForm, maxLikesPerHour: Number(event.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Max DMs / day</label>
                <input type="number" min={0} value={policyForm.maxDmsPerDay} onChange={(event) => setPolicyForm({ ...policyForm, maxDmsPerDay: Number(event.target.value) })} className={inputClass} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void savePolicy()} disabled={savingPolicy || !policyDirty} className={primaryButton}>
                {savingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save policy
              </button>
              {policyDirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity (autopilot tasks + recent posts for the slot)
// ---------------------------------------------------------------------------

function ActivityTab({ slot }: { slot: number }) {
  const [tasks, setTasks] = useState<CampaignTask[]>([]);
  const [posts, setPosts] = useState<RecentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const campaignsResponse = await fetch(`/api/agent/campaigns?account_slot=${slot}`, { cache: 'no-store' });
      const campaignsData = (await campaignsResponse.json()) as { items?: Array<{ id: number; name: string }>; error?: string };
      if (!campaignsResponse.ok) throw new Error(campaignsData.error || 'Failed to load campaigns.');
      const autopilot = (campaignsData.items ?? []).find((campaign) => campaign.name === `Autopilot slot ${slot}`);
      if (autopilot) {
        const tasksResponse = await fetch(`/api/agent/campaigns/${autopilot.id}/tasks`, { cache: 'no-store' });
        const tasksData = (await tasksResponse.json()) as { items?: CampaignTask[] };
        setTasks((tasksData.items ?? []).slice().sort((a, b) => b.id - a.id).slice(0, 20));
      } else {
        setTasks([]);
      }
      const postsResponse = await fetch(`/api/scheduler/posts?account_slot=${slot}&limit=10`, { cache: 'no-store' });
      const postsData = (await postsResponse.json()) as { posts?: RecentPost[]; items?: RecentPost[] };
      const list = postsData.posts ?? postsData.items ?? [];
      setPosts(list.slice().sort((a, b) => b.id - a.id).slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity.');
    } finally {
      setLoading(false);
    }
  }, [slot]);

  useEffect(() => {
    void load();
  }, [load]);

  const markerNotes = (task: CampaignTask): string | null => {
    if (task.assignedAgent !== 'planner' || !task.details) return null;
    try {
      const parsed = JSON.parse(task.details) as { notes?: string; planned?: number; created?: number; error?: string };
      if (parsed.error) return `error: ${parsed.error}`;
      return `${parsed.created ?? 0}/${parsed.planned ?? 0} task(s)${parsed.notes ? ` — ${parsed.notes}` : ''}`;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Autopilot tasks</h4>
        <button onClick={() => void load()} className={secondaryButton} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{loading ? 'Loading…' : 'No planner runs yet for this slot.'}</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{task.title}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 shrink-0">{task.status}</span>
              </div>
              {markerNotes(task) && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{markerNotes(task)}</p>}
            </li>
          ))}
        </ul>
      )}

      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 pt-2">Recent posts</h4>
      {posts.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{loading ? 'Loading…' : 'No posts yet.'}</p>
      ) : (
        <ul className="space-y-2">
          {posts.map((post) => (
            <li key={post.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400">{post.status}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{formatWhen(post.scheduledTime)}</span>
              </div>
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">{post.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
