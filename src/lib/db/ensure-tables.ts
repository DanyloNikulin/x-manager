import { getTableName } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type BetterSqlite3 from 'better-sqlite3';
import * as schema from './schema';
import { SCHEMA_INDEXES } from './schema-indexes';

type SqliteDb = BetterSqlite3.Database;

function isSqliteTable(value: unknown): value is SQLiteTable {
  try {
    return typeof value === 'object' && value !== null && typeof getTableName(value as SQLiteTable) === 'string';
  } catch {
    return false;
  }
}

export function schemaTables(): SQLiteTable[] {
  return Object.values(schema).filter(isSqliteTable);
}

export function schemaTableNames(): string[] {
  return schemaTables().map((table) => getTableConfig(table).name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatDefault(column: ReturnType<typeof getTableConfig>['columns'][number]): string | null {
  if (column.primary || !column.hasDefault || column.default === undefined) return null;
  const value = column.default as unknown;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (value && typeof value === 'object' && 'queryChunks' in value) {
    return '(unixepoch())';
  }
  return null;
}

export function buildCreateTableSql(table: SQLiteTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const parts = [quoteIdent(column.name), column.getSQLType().toUpperCase()];
    if (column.primary) parts.push('PRIMARY KEY');
    else if (column.notNull) parts.push('NOT NULL');
    if (column.isUnique && !column.primary) parts.push('UNIQUE');
    const defaultSql = formatDefault(column);
    if (defaultSql) parts.push(`DEFAULT ${defaultSql}`);
    return parts.join(' ');
  });
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)} (\n  ${columns.join(',\n  ')}\n)`;
}

export function buildCreateIndexSql(index: (typeof SCHEMA_INDEXES)[number]): string {
  const unique = index.unique ? 'UNIQUE ' : '';
  const cols = index.columns.map(quoteIdent).join(', ');
  const where = index.where ? ` WHERE ${index.where}` : '';
  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(index.name)} ON ${quoteIdent(index.table)} (${cols})${where}`;
}

export function ensureTablesFromSchema(sqlite: SqliteDb): void {
  const statements = [
    ...schemaTables().map(buildCreateTableSql),
    ...SCHEMA_INDEXES.map(buildCreateIndexSql),
  ];
  sqlite.exec(statements.join(';\n'));
}
