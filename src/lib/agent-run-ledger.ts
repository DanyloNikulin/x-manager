import type Database from 'better-sqlite3';
import { sqlite as defaultSqlite } from './db';

export type SqliteDatabase = Database.Database;

export type AgentRunStatus = 'completed' | 'failed' | 'cancelled';
export type AgentStepStatus = 'completed' | 'failed' | 'skipped';

export type InsertRunParams = {
  campaignId: number | null;
  dryRun: boolean;
  requestedBy: string | null;
  inputJson: string | null;
};

export type InsertStepParams = {
  runId: number;
  taskId: number | null;
  stepType: string;
  inputJson: string | null;
};

function nowTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function toJson(value: unknown): string | null {
  return value !== undefined ? JSON.stringify(value) : null;
}

/** Insert an agent_runs row and return its id via lastInsertRowid. */
export function insertRun(params: InsertRunParams, db: SqliteDatabase = defaultSqlite): number {
  const now = nowTimestamp();
  const stmt = db.prepare(`
    INSERT INTO agent_runs (campaign_id, status, dry_run, requested_by, input_json, started_at, created_at, updated_at)
    VALUES (?, 'running', ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    params.campaignId,
    params.dryRun ? 1 : 0,
    params.requestedBy,
    params.inputJson,
    now,
    now,
    now,
  );
  return Number(info.lastInsertRowid);
}

/** Insert an agent_run_steps row and return its id. */
export function insertStep(params: InsertStepParams, db: SqliteDatabase = defaultSqlite): number {
  const now = nowTimestamp();
  const stmt = db.prepare(`
    INSERT INTO agent_run_steps (run_id, task_id, step_type, status, input_json, started_at, created_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `);
  const info = stmt.run(params.runId, params.taskId, params.stepType, params.inputJson, now, now);
  return Number(info.lastInsertRowid);
}

export function completeStep(
  stepId: number,
  status: AgentStepStatus,
  output: unknown,
  error?: string,
  db: SqliteDatabase = defaultSqlite,
): void {
  const now = nowTimestamp();
  db.prepare(`UPDATE agent_run_steps SET status = ?, output_json = ?, error = ?, finished_at = ? WHERE id = ?`).run(
    status,
    toJson(output),
    error ?? null,
    now,
    stepId,
  );
}

export function completeRun(
  runId: number,
  status: AgentRunStatus,
  outputJson: unknown,
  error?: string,
  db: SqliteDatabase = defaultSqlite,
): void {
  const now = nowTimestamp();
  db.prepare(
    `UPDATE agent_runs SET status = ?, output_json = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
  ).run(status, toJson(outputJson), error ?? null, now, now, runId);
}
