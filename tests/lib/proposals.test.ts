import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-proposals-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { applyTextProposal, decideProposal, readProposals, ProposalError } = await import('@/lib/proposals');
const { getAccountProfile, saveAccountProfile } = await import('@/lib/account-profiles');
const { POST } = await import('@/app/api/agent/tasks/[id]/proposals/route');

describe('applyTextProposal', () => {
  it('replaces the first exact occurrence and appends when current is empty', () => {
    expect(applyTextProposal('a\r\nold line\r\nold line', 'old line', 'new line')).toBe('a\nnew line\nold line');
    expect(applyTextProposal('# Voice\n\nline\n', '', 'Added rule')).toBe('# Voice\n\nline\n\nAdded rule\n');
    expect(applyTextProposal('', '', 'Only rule')).toBe('Only rule\n');
  });

  it('is exact: surrounding whitespace in current must match, and proposed is kept as approved', () => {
    expect(() => applyTextProposal('text old text', ' old ', 'x')).not.toThrow();
    expect(() => applyTextProposal('textoldtext', ' old ', 'x')).toThrow(/not found/);
    expect(applyTextProposal('a old b', 'old', '  new  ')).toBe('a   new   b');
  });

  it('refuses a stale or empty proposal', () => {
    expect(() => applyTextProposal('text', 'missing', 'x')).toThrow(/not found/);
    expect(() => applyTextProposal('text', 'text', '   ')).toThrow(/empty/);
  });
});

let taskId = 0;
let campaignId = 0;

function insertAnalysis(proposals: unknown[]): number {
  const details = JSON.stringify({ week: '2026-W36', report: 'quiet week', observations: ['thin'], proposals });
  return Number(
    sqlite
      .prepare(`INSERT INTO campaign_tasks (campaign_id, task_type, title, details, priority, assigned_agent, status)
                VALUES (?, 'research', 'Autopilot 2026-W36: analysis', ?, 3, 'analyst', 'waiting_approval')`)
      .run(campaignId, details).lastInsertRowid,
  );
}

beforeAll(async () => {
  await saveAccountProfile(1, { status: 'ready', voice: '# Voice\n\nReplies: answer 80% of the point, then stop.\n', postsPerDay: 1 });
  campaignId = Number(
    sqlite.prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'objective', 1, 'active')").run().lastInsertRowid,
  );
  taskId = insertAnalysis([
    { target: 'voice', current: 'Replies: answer 80% of the point, then stop.', proposed: 'Replies: answer the point, then stop.', rationale: 'r', evidence: 'e', confidence: 0.6, status: 'open' },
    { target: 'postsPerDay', current: '1', proposed: '2', rationale: 'r', evidence: 'e', confidence: 0.4, status: 'open' },
    { target: 'strategy', current: 'not in the field', proposed: 'x', rationale: 'r', evidence: 'e', confidence: 0.2, status: 'open' },
  ]);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function call(id: number, body: Record<string, unknown>) {
  return POST(new Request(`http://127.0.0.1/api/agent/tasks/${id}/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

function storedProposals(id: number) {
  return readProposals((sqlite.prepare('SELECT details FROM campaign_tasks WHERE id = ?').get(id) as { details: string }).details);
}

describe('deciding proposals', () => {
  it('applies a text proposal to the profile and records it on the task', async () => {
    const result = await decideProposal(taskId, 0, 'apply', { now: new Date('2026-09-07T10:00:00Z') });
    expect(result.proposals[0]).toMatchObject({ status: 'applied', decidedAt: '2026-09-07T10:00:00.000Z' });
    expect(result.taskStatus).toBe('waiting_approval');
    expect((await getAccountProfile(1)).voice).toBe('# Voice\n\nReplies: answer the point, then stop.\n');
    await expect(decideProposal(taskId, 0, 'apply')).rejects.toMatchObject({ status: 409 });
  });

  it('applies a setting through the route and remembers the previous value', async () => {
    const response = await call(taskId, { index: 1, action: 'apply' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { proposals: Array<{ status: string; previous?: string }>; taskStatus: string };
    expect(body.proposals[1]).toMatchObject({ status: 'applied', previous: '1' });
    expect((await getAccountProfile(1)).postsPerDay).toBe(2);
    expect(body.taskStatus).toBe('waiting_approval');
  });

  it('reports a stale text proposal instead of guessing, and rejecting closes the task', async () => {
    const stale = await call(taskId, { index: 2, action: 'apply' });
    expect(stale.status).toBe(422);
    expect(storedProposals(taskId)[2].status).toBe('open');

    const rejected = await call(taskId, { index: 2, action: 'reject' });
    expect(rejected.status).toBe(200);
    expect(((await rejected.json()) as { taskStatus: string }).taskStatus).toBe('done');
    expect((sqlite.prepare('SELECT status FROM campaign_tasks WHERE id = ?').get(taskId) as { status: string }).status).toBe('done');
  });

  it('refuses a setting proposal whose current value no longer matches', async () => {
    const stale = insertAnalysis([{ target: 'postsPerDay', current: '1', proposed: '3', rationale: 'r', evidence: 'e', confidence: 0.5, status: 'open' }]);
    // postsPerDay is 2 by now.
    const response = await call(stale, { index: 0, action: 'apply' });
    expect(response.status).toBe(422);
    expect((await getAccountProfile(1)).postsPerDay).toBe(2);
    expect(storedProposals(stale)[0].status).toBe('open');
  });

  it('is one transaction: a concurrent change to the task leaves the profile untouched', async () => {
    const racy = insertAnalysis([{ target: 'strategy', current: '', proposed: 'Pillar 4: something new', rationale: 'r', evidence: 'e', confidence: 0.5, status: 'open' }]);
    const before = (await getAccountProfile(1)).strategy;
    await expect(
      decideProposal(racy, 0, 'apply', {
        beforeWrite: () => {
          sqlite.prepare("UPDATE campaign_tasks SET details = json_set(details, '$.proposals[0].status', 'rejected') WHERE id = ?").run(racy);
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getAccountProfile(1)).strategy).toBe(before);
    expect(storedProposals(racy)[0].status).toBe('rejected');
  });

  it('is one transaction: a concurrent edit of the profile field rolls the decision back', async () => {
    const racy = insertAnalysis([
      { target: 'voice', current: 'answer the point', proposed: 'answer the whole point', rationale: 'r', evidence: 'e', confidence: 0.5, status: 'open' },
      { target: 'maxRepliesPerConversation', current: '2', proposed: '3', rationale: 'r', evidence: 'e', confidence: 0.5, status: 'open' },
    ]);
    await expect(
      decideProposal(racy, 0, 'apply', {
        beforeWrite: () => {
          sqlite.prepare("UPDATE account_profiles SET voice_md = '# Voice\n\nedited meanwhile\n' WHERE slot = 1").run();
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getAccountProfile(1)).voice).toBe('# Voice\n\nedited meanwhile\n');
    expect(storedProposals(racy)[0].status).toBe('open');

    await expect(
      decideProposal(racy, 1, 'apply', {
        beforeWrite: () => {
          sqlite.prepare('UPDATE account_profiles SET max_replies_per_conversation = 4 WHERE slot = 1').run();
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getAccountProfile(1)).maxRepliesPerConversation).toBe(4);
    expect(storedProposals(racy)[1].status).toBe('open');
  });

  it('validates the request and the task', async () => {
    expect((await call(taskId, { index: -1, action: 'apply' })).status).toBe(400);
    expect((await call(taskId, { index: null, action: 'apply' })).status).toBe(400);
    expect((await call(taskId, { index: '0', action: 'apply' })).status).toBe(400);
    expect((await call(taskId, { action: 'apply' })).status).toBe(400);
    expect((await call(taskId, { index: 0, action: 'maybe' })).status).toBe(400);
    expect((await call(999999, { index: 0, action: 'apply' })).status).toBe(404);
    expect(new ProposalError('x', 409).status).toBe(409);
  });
});
