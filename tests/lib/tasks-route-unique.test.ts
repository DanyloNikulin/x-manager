import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-tasks-unique-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { POST } = await import('@/app/api/agent/campaigns/[id]/tasks/route');

let campaignId = 0;

beforeAll(() => {
  campaignId = Number(
    sqlite.prepare("INSERT INTO campaigns (name, objective, account_slot, status) VALUES ('Autopilot slot 1', 'objective', 1, 'active')").run().lastInsertRowid,
  );
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function create(body: Record<string, unknown>) {
  return POST(new Request(`http://127.0.0.1/api/agent/campaigns/${campaignId}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(campaignId) }),
  });
}

describe('POST /api/agent/campaigns/:id/tasks with unique_title', () => {
  const marker = { task_type: 'research', title: 'Autopilot 2026-W36: analysis', details: '{"week":"2026-W36"}', priority: 3, assigned_agent: 'analyst', status: 'in_progress', unique_title: true };

  it('reserves a title once and refuses the second reservation with the existing id', async () => {
    const first = await create(marker);
    expect(first.status).toBe(200);
    const created = (await first.json()) as { ok: boolean; task: { id: number; status: string; title: string } };
    expect(created.task).toMatchObject({ status: 'in_progress', title: marker.title });

    const second = await create(marker);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { task_id: number }).task_id).toBe(created.task.id);
    expect((sqlite.prepare('SELECT count(*) AS n FROM campaign_tasks WHERE title = ?').get(marker.title) as { n: number }).n).toBe(1);
  });

  it('still allows duplicate titles when uniqueness is not requested', async () => {
    const response = await create({ ...marker, unique_title: false });
    expect(response.status).toBe(200);
    expect((sqlite.prepare('SELECT count(*) AS n FROM campaign_tasks WHERE title = ?').get(marker.title) as { n: number }).n).toBe(2);
  });
});
