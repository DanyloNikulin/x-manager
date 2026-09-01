'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { Campaign, OpsFeedback } from './types';

export default function CampaignsPanel({
  accountSlot,
  onStatus,
  onError,
}: { accountSlot: number } & OpsFeedback) {
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');
  const [workingId, setWorkingId] = useState('');

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await fetch('/api/agent/campaigns');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load campaigns.');
      setCampaigns(data.items || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load campaigns.');
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    void loadCampaigns();
  }, []);

  const createCampaign = async () => {
    if (!campaignName.trim() || !campaignObjective.trim()) {
      onError('Campaign name and objective are required.');
      return;
    }

    setWorkingId('campaign-create');
    try {
      const response = await fetch('/api/agent/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          objective: campaignObjective.trim(),
          account_slot: accountSlot,
          status: 'draft',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create campaign.');

      setCampaignName('');
      setCampaignObjective('');
      onStatus(`Campaign created: ${data.campaign.name}`);
      await loadCampaigns();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to create campaign.');
    } finally {
      setWorkingId('');
    }
  };

  const buildCampaignPlan = async (campaignId: number) => {
    setWorkingId(`plan-${campaignId}`);
    try {
      const response = await fetch(`/api/agent/campaigns/${campaignId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to generate campaign plan.');
      onStatus(`Campaign plan generated with ${data.insertedCount} task(s).`);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to generate campaign plan.');
    } finally {
      setWorkingId('');
    }
  };

  const setCampaignStatus = async (campaign: Campaign, status: Campaign['status']) => {
    setWorkingId(`campaign-status-${campaign.id}`);
    try {
      const response = await fetch(`/api/agent/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update campaign status.');
      onStatus(`Campaign ${campaign.id} set to ${status}.`);
      await loadCampaigns();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to update campaign status.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 md:p-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-slate-700 dark:text-slate-200" />
        Campaigns
      </h3>

      <div className="space-y-2 mb-4">
        <input
          type="text"
          value={campaignName}
          onChange={(event) => setCampaignName(event.target.value)}
          placeholder="Campaign name"
          className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
        />
        <textarea
          value={campaignObjective}
          onChange={(event) => setCampaignObjective(event.target.value)}
          placeholder="Campaign objective"
          className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
          rows={2}
        />
        <button
          onClick={() => void createCampaign()}
          disabled={workingId === 'campaign-create'}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-slate-900 dark:bg-slate-600 text-white rounded-md text-sm hover:bg-slate-800 dark:hover:bg-slate-500 disabled:opacity-50"
        >
          {workingId === 'campaign-create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles size={14} />}
          <span>Create Campaign</span>
        </button>
      </div>

      {loadingCampaigns ? (
        <div className="py-4 text-slate-500 dark:text-slate-400 text-sm">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No campaigns yet.</p>
      ) : (
        <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="border border-slate-200 dark:border-slate-700 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{campaign.name}</p>
                <span className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 capitalize">{campaign.status}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">{campaign.objective}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void buildCampaignPlan(campaign.id)}
                  disabled={workingId === `plan-${campaign.id}`}
                  className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 dark:text-slate-200"
                >
                  {workingId === `plan-${campaign.id}` ? 'Planning...' : 'Plan + Save Tasks'}
                </button>
                {campaign.status !== 'active' ? (
                  <button
                    onClick={() => void setCampaignStatus(campaign, 'active')}
                    disabled={workingId === `campaign-status-${campaign.id}`}
                    className="text-xs px-2 py-1 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-md hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-50"
                  >
                    Activate
                  </button>
                ) : (
                  <button
                    onClick={() => void setCampaignStatus(campaign, 'paused')}
                    disabled={workingId === `campaign-status-${campaign.id}`}
                    className="text-xs px-2 py-1 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-50"
                  >
                    Pause
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
