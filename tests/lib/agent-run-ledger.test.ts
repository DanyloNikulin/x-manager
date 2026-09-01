import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { completeRun, completeStep, insertRun, insertStep } from '@/lib/agent-run-ledger';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      dry_run INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE agent_run_steps (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL,
      task_id INTEGER,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER
    );
  `);
  return db;
}

describe('agent-run-ledger', () => {
  it('starts a run as running and completes it with serialized output', () => {
    const db = makeDb();
    const runId = insertRun(
      {
        campaignId: 7,
        dryRun: true,
        requestedBy: 'agent',
        inputJson: JSON.stringify({ campaignId: 7 }),
      },
      db,
    );

    const started = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as {
      status: string;
      dry_run: number;
      campaign_id: number;
      output_json: string | null;
    };
    expect(started.status).toBe('running');
    expect(started.dry_run).toBe(1);
    expect(started.campaign_id).toBe(7);
    expect(started.output_json).toBeNull();

    completeRun(runId, 'completed', { tasksProcessed: 2 }, undefined, db);

    const finished = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as {
      status: string;
      output_json: string;
      error: string | null;
      finished_at: number | null;
    };
    expect(finished.status).toBe('completed');
    expect(JSON.parse(finished.output_json)).toEqual({ tasksProcessed: 2 });
    expect(finished.error).toBeNull();
    expect(finished.finished_at).toBeTypeOf('number');
  });

  it('records a failed step without serializing undefined output', () => {
    const db = makeDb();
    const runId = insertRun(
      { campaignId: null, dryRun: false, requestedBy: null, inputJson: null },
      db,
    );
    const stepId = insertStep(
      { runId, taskId: 3, stepType: 'reply', inputJson: '{"text":"hi"}' },
      db,
    );

    completeStep(stepId, 'failed', undefined, 'missing tweet id', db);
    completeRun(runId, 'failed', undefined, 'missing tweet id', db);

    const step = db.prepare('SELECT * FROM agent_run_steps WHERE id = ?').get(stepId) as {
      status: string;
      output_json: string | null;
      error: string;
    };
    expect(step.status).toBe('failed');
    expect(step.output_json).toBeNull();
    expect(step.error).toBe('missing tweet id');

    const run = db.prepare('SELECT status, output_json, error FROM agent_runs WHERE id = ?').get(runId) as {
      status: string;
      output_json: string | null;
      error: string;
    };
    expect(run.status).toBe('failed');
    expect(run.output_json).toBeNull();
    expect(run.error).toBe('missing tweet id');
  });
});
