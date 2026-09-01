import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildCreateTableSql, ensureTablesFromSchema, schemaTableNames } from '@/lib/db/ensure-tables';
import { scheduledPosts } from '@/lib/db/schema';

describe('ensure-tables', () => {
  it('builds CREATE TABLE SQL from the drizzle schema', () => {
    const sql = buildCreateTableSql(scheduledPosts);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "scheduled_posts"');
    expect(sql).toContain('"text" TEXT NOT NULL');
    expect(sql).toContain('"account_slot" INTEGER NOT NULL DEFAULT 1');
  });

  it('creates every schema table on a blank database', () => {
    const db = new Database(':memory:');
    ensureTablesFromSchema(db);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>;
    const names = new Set(tables.map((row) => row.name));
    for (const name of schemaTableNames()) {
      expect(names.has(name)).toBe(true);
    }
    const unique = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_engagement_inbox_source'`).get();
    expect(unique).toBeTruthy();
  });
});
