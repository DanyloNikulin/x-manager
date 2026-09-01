import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { acquireLease, extendLease, releaseLease, withLease } from '@/lib/scheduler-lock';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scheduler_locks (
      id INTEGER PRIMARY KEY,
      lock_key TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);
  return db;
}

describe('scheduler-lock', () => {
  it('grants the first owner and skips a second owner while the lease is live', () => {
    const db = makeDb();
    const now = 1_700_000_000;
    expect(acquireLease('posts', 'a', 90, now, db)).toBe(true);
    expect(acquireLease('posts', 'b', 90, now + 10, db)).toBe(false);
  });

  it('lets a new owner take an expired lease', () => {
    const db = makeDb();
    const now = 1_700_000_000;
    expect(acquireLease('posts', 'a', 90, now, db)).toBe(true);
    expect(acquireLease('posts', 'b', 90, now + 91, db)).toBe(true);
  });

  it('lets the current owner refresh and then release so another owner can acquire', () => {
    const db = makeDb();
    const now = 1_700_000_000;
    expect(acquireLease('posts', 'a', 90, now, db)).toBe(true);
    expect(extendLease('posts', 'a', 90, db)).toBe(true);
    expect(extendLease('posts', 'b', 90, db)).toBe(false);
    releaseLease('posts', 'a', db);
    expect(acquireLease('posts', 'b', 90, now + 1, db)).toBe(true);
  });

  it('withLease skips when the lock is held and always releases on completion', async () => {
    const db = makeDb();
    const now = Math.floor(Date.now() / 1000);
    expect(acquireLease('metrics', 'holder', 120, now, db)).toBe(true);

    const skipped = await withLease(
      {
        lockKey: 'metrics',
        ownerId: 'other',
        leaseSeconds: 120,
        db,
        onSkip: () => 'skipped',
      },
      async () => 'ran',
    );
    expect(skipped).toBe('skipped');

    releaseLease('metrics', 'holder', db);

    const ran = await withLease(
      {
        lockKey: 'metrics',
        ownerId: 'other',
        leaseSeconds: 120,
        db,
        onSkip: () => 'skipped',
      },
      async () => 'ran',
    );
    expect(ran).toBe('ran');
    expect(acquireLease('metrics', 'third', 120, Math.floor(Date.now() / 1000), db)).toBe(true);
  });
});
