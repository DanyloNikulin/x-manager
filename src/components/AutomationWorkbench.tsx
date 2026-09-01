'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Bot, Loader2, Newspaper, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import Panel from './automation/Panel';
import RulesTab from './automation/RulesTab';
import FeedsTab from './automation/FeedsTab';
import SearchesTab from './automation/SearchesTab';
import type { TabKey, WorkbenchTabProps } from './automation/types';

const TAB_COUNT = 3;

export default function AutomationWorkbench() {
  const [activeTab, setActiveTab] = useState<TabKey>('rules');
  const [busyKey, setBusyKey] = useState('refresh');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const pendingRefreshes = useRef(TAB_COUNT);

  const clearNotices = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const onStatus = (message: string) => {
    setErrorMessage('');
    setStatusMessage(message);
  };

  const onError = (message: string) => {
    setStatusMessage('');
    setErrorMessage(message);
  };

  const onRefreshSettled = () => {
    pendingRefreshes.current -= 1;
    if (pendingRefreshes.current <= 0) {
      setBusyKey((key) => (key === 'refresh' ? '' : key));
    }
  };

  const refreshAll = () => {
    clearNotices();
    setBusyKey('refresh');
    pendingRefreshes.current = TAB_COUNT;
    setRefreshEpoch((value) => value + 1);
  };

  const tabProps: WorkbenchTabProps = {
    busyKey,
    setBusyKey,
    onStatus,
    onError,
    clearNotices,
    refreshEpoch,
    onRefreshSettled,
  };

  return (
    <div className="space-y-6">
      <Panel
        title="Automation Workbench"
        subtitle="Rule triggers, RSS ingestion, and persistent keyword monitoring for Sprint 3."
        icon={<Bot size={18} />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'rules', label: 'Rules', icon: <ShieldAlert size={14} /> },
              { key: 'feeds', label: 'RSS Feeds', icon: <Newspaper size={14} /> },
              { key: 'searches', label: 'Saved Searches', icon: <Search size={14} /> },
            ] as Array<{ key: TabKey; label: string; icon: ReactNode }>).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                  activeTab === tab.key
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={refreshAll}
            disabled={busyKey === 'refresh'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {busyKey === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>Refresh</span>
          </button>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            {errorMessage}
          </div>
        )}

        <div hidden={activeTab !== 'rules'}>
          <RulesTab {...tabProps} />
        </div>
        <div hidden={activeTab !== 'feeds'}>
          <FeedsTab {...tabProps} />
        </div>
        <div hidden={activeTab !== 'searches'}>
          <SearchesTab {...tabProps} />
        </div>
      </Panel>
    </div>
  );
}
