import type BetterSqlite3 from 'better-sqlite3';
import { ensureLegacyColumns } from './init-columns';
import { ensureTablesFromSchema } from './ensure-tables';

let isInitialized = false;

type SqliteDb = BetterSqlite3.Database;

function sleepMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

function execWithRetry(sqlite: SqliteDb, fn: () => void, attempts = 8, delayMs = 120): void {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fn();
      return;
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < attempts - 1) {
        sleepMs(delayMs);
        continue;
      }
      throw error;
    }
  }
}

export function ensureSchema(sqlite: SqliteDb): void {
  if (isInitialized) {
    return;
  }

  execWithRetry(sqlite, () => {
    sqlite.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
    ensureTablesFromSchema(sqlite);
  });

  ensureLegacyColumns(sqlite);
  isInitialized = true;
}
