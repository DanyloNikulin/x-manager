import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-memory-'));
process.env.X_MANAGER_DB_PATH = path.join(tempDir, 'test.sqlite.db');
process.env.NEXT_PHASE = '';

const { sqlite } = await import('@/lib/db');
const { withObservations, getAccountProfile, saveAccountProfile } = await import('@/lib/account-profiles');
const { POST } = await import('@/app/api/agent/accounts/[slot]/memory/route');

function call(slot: number, body: unknown) {
  return POST(new Request(`http://127.0.0.1/api/agent/accounts/${slot}/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ slot: String(slot) }),
  });
}

beforeAll(async () => {
  await saveAccountProfile(1, { status: 'ready', memory: '# Memory\r\n\r\nold\r\n' });
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('withObservations', () => {
  it('appends a dated section, one bullet per line, normalising line endings', () => {
    expect(withObservations('# Memory\r\n\r\nold\r\n', '2026-09-07', ['a', ' b ', ''])).toBe('# Memory\n\nold\n\n## 2026-09-07 analyst\n- a\n- b\n');
    expect(withObservations('', '2026-09-07', ['thin'])).toBe('## 2026-09-07 analyst\n- thin\n');
  });
});

describe('POST /api/agent/accounts/:slot/memory', () => {
  it('appends atomically and keeps both sections when called twice', async () => {
    const first = await call(1, { day: '2026-09-07', observations: ['claims first got replies'] });
    expect(first.status).toBe(200);
    const second = await call(1, { day: '2026-09-14', observations: ['threads got no follows', 'quiet week'] });
    expect(second.status).toBe(200);
    expect((await getAccountProfile(1)).memory).toBe(
      '# Memory\n\nold\n\n## 2026-09-07 analyst\n- claims first got replies\n\n## 2026-09-14 analyst\n- threads got no follows\n- quiet week\n',
    );
  });

  it('refuses bad input and unknown profiles', async () => {
    expect((await call(1, { day: 'today', observations: ['x'] })).status).toBe(400);
    expect((await call(1, { day: '2026-09-07', observations: [] })).status).toBe(400);
    expect((await call(1, { day: '2026-09-07', observations: ['two\nlines'] })).status).toBe(400);
    expect((await call(2, { day: '2026-09-07', observations: ['x'] })).status).toBe(404);
  });
});
