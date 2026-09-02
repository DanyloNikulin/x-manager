import { describe, expect, it } from 'vitest';
import { parseTomlSubset, parseTomlValue, summarizeOrchestratorConfig } from '@/lib/orchestrator-config';

const SAMPLE = `
[manager]
base_url = "http://127.0.0.1:3999" # loopback only
admin_token_env = "X_MANAGER_ADMIN_TOKEN"
admin_token = "should-never-be-shown"

[worker]
id = "station.subscription-worker-1"
assigned_agent = "subscription-agent"
max_tasks_per_run = 2
max_revision_rounds = 1
plan_hour = 9
plan_timezone = "America/New_York"

[writer]
program = "claude"
args = [
  "-p",
  "--output-format", "json",
  "--json-schema", "{schema_json}", # placeholder
  "--tools", "",
]
schema_path = "schemas/writer-output.schema.json"
timeout_seconds = 600

[validator]
program = "codex"
args = ["exec", "--sandbox", "read-only", "-"]
timeout_seconds = 1_200

[accounts.1]
workspace = "../accounts/slot-1"
language = "en"
post_mode = "auto"
inbound_reply_mode = "approval"
outbound_reply_mode = "approval"
posts_per_day = 1
secret = 'literal # not a comment'

[accounts.2]
workspace = "../accounts/slot-2"
posts_per_day = 0
`;

describe('parseTomlValue', () => {
  it('handles strings, numbers, booleans and nested arrays', () => {
    expect(parseTomlValue('"a \\"quoted\\" value"')).toBe('a "quoted" value');
    expect(parseTomlValue("'raw \\n'")).toBe('raw \\n');
    expect(parseTomlValue('42')).toBe(42);
    expect(parseTomlValue('1_200')).toBe(1200);
    expect(parseTomlValue('true')).toBe(true);
    expect(parseTomlValue('["a", ["b", 2], "c,d"]')).toEqual(['a', ['b', 2], 'c,d']);
  });
});

describe('parseTomlSubset', () => {
  it('parses tables, dotted tables, comments and multi-line arrays', () => {
    const parsed = parseTomlSubset(SAMPLE);
    expect(parsed.manager).toMatchObject({ base_url: 'http://127.0.0.1:3999' });
    expect(parsed.writer).toMatchObject({
      args: ['-p', '--output-format', 'json', '--json-schema', '{schema_json}', '--tools', ''],
      timeout_seconds: 600,
    });
    expect((parsed.accounts as Record<string, unknown>)['1']).toMatchObject({ posts_per_day: 1, secret: 'literal # not a comment' });
  });
});

describe('summarizeOrchestratorConfig', () => {
  it('copies only whitelisted keys', () => {
    const summary = summarizeOrchestratorConfig(parseTomlSubset(SAMPLE));
    expect(summary.manager).toEqual({ baseUrl: 'http://127.0.0.1:3999', adminTokenEnv: 'X_MANAGER_ADMIN_TOKEN' });
    expect(JSON.stringify(summary)).not.toContain('should-never-be-shown');
    expect(JSON.stringify(summary)).not.toContain('literal # not a comment');
    expect(summary.worker).toEqual({
      id: 'station.subscription-worker-1',
      assignedAgent: 'subscription-agent',
      maxTasksPerRun: 2,
      maxRevisionRounds: 1,
      planHour: 9,
      planTimezone: 'America/New_York',
    });
    expect(summary.agents.writer.program).toBe('claude');
    expect(summary.agents.writer.args).toHaveLength(7);
    expect(summary.agents.validator.timeoutSeconds).toBe(1200);
    expect(summary.agents.planner).toEqual({ program: null, args: [], schemaPath: null, timeoutSeconds: null });
    expect(summary.accounts).toEqual([
      { slot: 1, workspace: '../accounts/slot-1', language: 'en', postMode: 'auto', inboundReplyMode: 'approval', outboundReplyMode: 'approval', postsPerDay: 1 },
      { slot: 2, workspace: '../accounts/slot-2', language: null, postMode: null, inboundReplyMode: null, outboundReplyMode: null, postsPerDay: 0 },
    ]);
  });

  it('survives an empty file', () => {
    const summary = summarizeOrchestratorConfig(parseTomlSubset(''));
    expect(summary.accounts).toEqual([]);
    expect(summary.worker.id).toBeNull();
  });
});
