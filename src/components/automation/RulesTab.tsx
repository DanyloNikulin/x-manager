'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  ruleActionOptions,
  ruleTriggerOptions,
  type AutomationRule,
  type AutomationRun,
  type WorkbenchTabProps,
} from './types';

export default function RulesTab({
  busyKey,
  setBusyKey,
  onStatus,
  onError,
  clearNotices,
  refreshEpoch,
  onRefreshSettled,
}: WorkbenchTabProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [ruleRuns, setRuleRuns] = useState<AutomationRun[]>([]);

  const [ruleName, setRuleName] = useState('');
  const [ruleTriggerType, setRuleTriggerType] = useState<AutomationRule['triggerType']>('event');
  const [ruleActionType, setRuleActionType] = useState<AutomationRule['actionType']>('reply');
  const [ruleEventType, setRuleEventType] = useState('inbox.new_mention');
  const [ruleCron, setRuleCron] = useState('0 9 * * *');
  const [ruleKeywords, setRuleKeywords] = useState('agent, launch');
  const [ruleActionText, setRuleActionText] = useState('Thanks for the mention: {text}');

  const loadRules = async () => {
    const response = await fetch('/api/automation/rules');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load automation rules.');
    setRules(data.rules || []);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadRules();
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Failed to load automation rules.');
        }
      } finally {
        if (!cancelled) onRefreshSettled();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEpoch]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );

  const loadRuleRuns = async (ruleId: number) => {
    setBusyKey(`runs-${ruleId}`);
    try {
      const response = await fetch(`/api/automation/rules/${ruleId}/log?limit=8`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load rule runs.');
      setSelectedRuleId(ruleId);
      setRuleRuns(data.runs || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load rule runs.');
    } finally {
      setBusyKey('');
    }
  };

  const createRule = async () => {
    if (!ruleName.trim()) {
      onError('Rule name is required.');
      return;
    }

    const triggerConfig =
      ruleTriggerType === 'event'
        ? { event_type: ruleEventType.trim() || '*' }
        : ruleTriggerType === 'schedule'
          ? { cron: ruleCron.trim() }
          : { keywords: ruleKeywords.split(',').map((value) => value.trim()).filter(Boolean) };

    const actionConfig =
      ruleActionType === 'reply' || ruleActionType === 'send_dm' || ruleActionType === 'schedule_post'
        ? { text: ruleActionText.trim() }
        : ruleActionType === 'webhook'
          ? { url: ruleActionText.trim() }
          : ruleActionType === 'tag'
            ? { tag: ruleActionText.trim() }
            : {};

    clearNotices();
    setBusyKey('create-rule');
    try {
      const response = await fetch('/api/automation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ruleName.trim(),
          trigger_type: ruleTriggerType,
          trigger_config: triggerConfig,
          action_type: ruleActionType,
          action_config: actionConfig,
          account_slot: 1,
          conditions: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create rule.');

      setRuleName('');
      onStatus(`Rule created: ${data.rule.name}`);
      await loadRules();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to create rule.');
    } finally {
      setBusyKey('');
    }
  };

  const updateRuleEnabled = async (rule: AutomationRule, enabled: boolean) => {
    clearNotices();
    setBusyKey(`rule-toggle-${rule.id}`);
    try {
      const response = await fetch(`/api/automation/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update rule.');
      onStatus(`Rule ${data.rule.name} ${enabled ? 'enabled' : 'paused'}.`);
      await loadRules();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update rule.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteRule = async (rule: AutomationRule) => {
    clearNotices();
    setBusyKey(`rule-delete-${rule.id}`);
    try {
      const response = await fetch(`/api/automation/rules/${rule.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete rule.');
      onStatus(`Rule ${rule.name} deleted.`);
      if (selectedRuleId === rule.id) {
        setSelectedRuleId(null);
        setRuleRuns([]);
      }
      await loadRules();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete rule.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          <Plus size={14} />
          <span>Create automation rule</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={ruleName}
            onChange={(event) => setRuleName(event.target.value)}
            placeholder="Rule name"
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
          <select
            value={ruleTriggerType}
            onChange={(event) => setRuleTriggerType(event.target.value as AutomationRule['triggerType'])}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          >
            {ruleTriggerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select
            value={ruleActionType}
            onChange={(event) => setRuleActionType(event.target.value as AutomationRule['actionType'])}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          >
            {ruleActionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Slot 1 default. Conditions can be edited later through the API.
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {ruleTriggerType === 'event' && (
            <input
              value={ruleEventType}
              onChange={(event) => setRuleEventType(event.target.value)}
              placeholder="Event type, e.g. inbox.new_mention"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
          )}
          {ruleTriggerType === 'schedule' && (
            <input
              value={ruleCron}
              onChange={(event) => setRuleCron(event.target.value)}
              placeholder="Cron expression"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
          )}
          {ruleTriggerType === 'keyword' && (
            <input
              value={ruleKeywords}
              onChange={(event) => setRuleKeywords(event.target.value)}
              placeholder="Keywords, comma separated"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
          )}
          <textarea
            value={ruleActionText}
            onChange={(event) => setRuleActionText(event.target.value)}
            placeholder="Reply/template/tag/webhook URL"
            className="min-h-[88px] w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
          />
        </div>

        <button
          onClick={createRule}
          disabled={busyKey === 'create-rule'}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50"
        >
          {busyKey === 'create-rule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot size={14} />}
          <span>Create Rule</span>
        </button>
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Live rules</h4>
            <span className="text-xs text-slate-500 dark:text-slate-400">{rules.length} total</span>
          </div>
          <div className="space-y-3">
            {rules.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No automation rules yet.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{rule.name}</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {rule.triggerType} → {rule.actionType} • runs {rule.runCount}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] ${rule.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      {rule.enabled ? 'enabled' : 'paused'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => updateRuleEnabled(rule, !rule.enabled)}
                      disabled={busyKey === `rule-toggle-${rule.id}`}
                      className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {rule.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      onClick={() => loadRuleRuns(rule.id)}
                      disabled={busyKey === `runs-${rule.id}`}
                      className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {busyKey === `runs-${rule.id}` ? 'Loading...' : 'View Runs'}
                    </button>
                    <button
                      onClick={() => deleteRule(rule)}
                      disabled={busyKey === `rule-delete-${rule.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-700 px-2 py-1 text-xs text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Execution log</h4>
            {selectedRule && <span className="text-xs text-slate-500 dark:text-slate-400">{selectedRule.name}</span>}
          </div>
          {selectedRuleId == null ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Choose a rule to inspect recent runs.</p>
          ) : ruleRuns.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No runs recorded yet for this rule.</p>
          ) : (
            <div className="space-y-2">
              {ruleRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                      run.status === 'success'
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        : run.status === 'failed'
                          ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                      {run.status}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{run.createdAt ? new Date(run.createdAt).toLocaleString() : 'unknown time'}</span>
                  </div>
                  {run.triggerSource && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Trigger: {run.triggerSource}</div>}
                  {run.error && <div className="mt-1 text-xs text-rose-600">{run.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
