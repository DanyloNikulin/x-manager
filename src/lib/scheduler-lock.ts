import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { sqlite as defaultSqlite } from './db';

export type SqliteDatabase = Database.Database;

export function createOwnerId(): string {
  return `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

export function acquireLease(
  lockKey: string,
  ownerId: string,
  leaseSeconds: number,
  nowEpoch = Math.floor(Date.now() / 1000),
  db: SqliteDatabase = defaultSqlite,
): boolean {
  const leaseUntil = nowEpoch + leaseSeconds;

  db.prepare(
    `INSERT INTO scheduler_locks (lock_key, owner_id, lease_until, created_at, updated_at)
     VALUES (?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(lock_key) DO NOTHING`,
  ).run(lockKey, ownerId, leaseUntil);

  const result = db
    .prepare(
      `UPDATE scheduler_locks
       SET owner_id = ?, lease_until = ?, updated_at = unixepoch()
       WHERE lock_key = ?
         AND (lease_until < ? OR owner_id = ?)`,
    )
    .run(ownerId, leaseUntil, lockKey, nowEpoch, ownerId);

  return result.changes > 0;
}

export function extendLease(
  lockKey: string,
  ownerId: string,
  leaseSeconds: number,
  db: SqliteDatabase = defaultSqlite,
): boolean {
  const leaseUntil = Math.floor(Date.now() / 1000) + leaseSeconds;
  const result = db
    .prepare(
      `UPDATE scheduler_locks
       SET lease_until = ?, updated_at = unixepoch()
       WHERE lock_key = ? AND owner_id = ?`,
    )
    .run(leaseUntil, lockKey, ownerId);
  return result.changes > 0;
}

export function releaseLease(
  lockKey: string,
  ownerId: string,
  db: SqliteDatabase = defaultSqlite,
): void {
  db.prepare(
    `UPDATE scheduler_locks
     SET lease_until = 0, updated_at = unixepoch()
     WHERE lock_key = ? AND owner_id = ?`,
  ).run(lockKey, ownerId);
}

export async function withLease<T>(
  options: {
    lockKey: string;
    ownerId: string;
    leaseSeconds: number;
    onSkip: () => NoInfer<T> | Promise<NoInfer<T>>;
    db?: SqliteDatabase;
  },
  fn: (ctx: { extend: () => boolean }) => Promise<T>,
): Promise<T> {
  const db = options.db ?? defaultSqlite;
  const acquired = acquireLease(
    options.lockKey,
    options.ownerId,
    options.leaseSeconds,
    Math.floor(Date.now() / 1000),
    db,
  );
  if (!acquired) {
    return await options.onSkip();
  }

  try {
    return await fn({
      extend: () => extendLease(options.lockKey, options.ownerId, options.leaseSeconds, db),
    });
  } finally {
    releaseLease(options.lockKey, options.ownerId, db);
  }
}
