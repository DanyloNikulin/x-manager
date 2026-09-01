'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import AutomationWorkbench from './AutomationWorkbench';
import EngagementInbox from './ops/EngagementInbox';
import CampaignsPanel from './ops/CampaignsPanel';
import ApprovalsPanel from './ops/ApprovalsPanel';

export default function OpsCenter() {
  const [accountSlot, setAccountSlot] = useState(1);
  const [includeDms, setIncludeDms] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSavedRepliesManager, setShowSavedRepliesManager] = useState(false);
  const [inboxEpoch, setInboxEpoch] = useState(0);

  const onStatus = (message: string) => {
    setErrorMessage('');
    setStatusMessage(message);
  };
  const onError = (message: string) => {
    setStatusMessage('');
    setErrorMessage(message);
  };

  const syncInbox = async () => {
    setErrorMessage('');
    setStatusMessage('');
    setWorkingId('sync');
    try {
      const response = await fetch('/api/engagement/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: accountSlot,
          include_mentions: true,
          include_dms: includeDms,
          count: 25,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to sync inbox.');
      onStatus(`Synced inbox: ${data.synced.mentions} mentions, ${data.synced.dms} DMs.`);
      setInboxEpoch((value) => value + 1);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to sync inbox.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Ops Center</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">Agent-ready engagement inbox, campaign orchestration, and approvals.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={accountSlot}
              onChange={(event) => setAccountSlot(Number(event.target.value))}
              className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm dark:bg-slate-700 dark:text-slate-200"
            >
              <option value={1}>Slot 1</option>
              <option value={2}>Slot 2</option>
              <option value={3}>Slot 3</option>
            </select>
            <label className="text-sm text-slate-700 dark:text-slate-200 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDms}
                onChange={(event) => setIncludeDms(event.target.checked)}
              />
              Sync DMs
            </label>
            <button
              onClick={() => setShowSavedRepliesManager(true)}
              className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-sm dark:text-slate-200"
            >
              Quick Replies
            </button>
            <button
              onClick={() => void syncInbox()}
              disabled={workingId === 'sync'}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 dark:bg-slate-600 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-slate-500 disabled:opacity-50"
            >
              {workingId === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>Sync Inbox</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 p-3 text-sm text-green-800 dark:text-green-300 inline-flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-300 inline-flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <EngagementInbox
          accountSlot={accountSlot}
          refreshEpoch={inboxEpoch}
          onStatus={onStatus}
          onError={onError}
          showSavedRepliesManager={showSavedRepliesManager}
          onCloseSavedReplies={() => setShowSavedRepliesManager(false)}
        />
        <section className="space-y-6">
          <CampaignsPanel accountSlot={accountSlot} onStatus={onStatus} onError={onError} />
          <ApprovalsPanel onStatus={onStatus} onError={onError} />
        </section>
      </div>

      <AutomationWorkbench />
    </div>
  );
}
