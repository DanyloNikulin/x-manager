'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Approval, OpsFeedback } from './types';

export default function ApprovalsPanel({ onStatus, onError }: OpsFeedback) {
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [workingId, setWorkingId] = useState('');
  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => approval.status === 'pending'),
    [approvals],
  );

  const loadApprovals = async () => {
    setLoadingApprovals(true);
    try {
      const response = await fetch('/api/agent/approvals');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load approvals.');
      setApprovals(data.items || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load approvals.');
    } finally {
      setLoadingApprovals(false);
    }
  };

  useEffect(() => {
    void loadApprovals();
  }, []);

  const decideApproval = async (approval: Approval, status: 'approved' | 'rejected') => {
    setWorkingId(`approval-${approval.id}`);
    try {
      const response = await fetch('/api/agent/approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: approval.id,
          status,
          decision_note: status === 'approved' ? 'Approved from Ops Center.' : 'Rejected from Ops Center.',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update approval.');
      onStatus(`Approval ${approval.id} marked ${status}.`);
      await loadApprovals();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update approval.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 md:p-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2 mb-3">
        <ClipboardCheck size={18} className="text-slate-700 dark:text-slate-200" />
        Approvals
      </h3>

      <button
        onClick={() => void loadApprovals()}
        disabled={loadingApprovals}
        className="mb-3 text-sm px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200"
      >
        {loadingApprovals ? 'Loading...' : 'Refresh Approvals'}
      </button>

      {pendingApprovals.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No pending approvals.</p>
      ) : (
        <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
          {pendingApprovals.map((approval) => (
            <div key={approval.id} className="border border-slate-200 dark:border-slate-700 rounded-md p-3 space-y-2">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Campaign {approval.campaignId} • Task {approval.taskId ?? 'n/a'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Requested by {approval.requestedBy} at {new Date(approval.requestedAt).toLocaleString()}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void decideApproval(approval, 'approved')}
                  disabled={workingId === `approval-${approval.id}`}
                  className="text-xs px-2 py-1 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-md hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => void decideApproval(approval, 'rejected')}
                  disabled={workingId === `approval-${approval.id}`}
                  className="text-xs px-2 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
