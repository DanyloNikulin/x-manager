/**
 * Read-only view of `orchestrator/config.toml` for the Orchestrator screen.
 *
 * A small TOML subset is enough for that file (tables, strings, numbers, booleans,
 * arrays that may span lines). The summary only ever copies whitelisted keys, so the
 * admin token can never leak even if someone pastes it into the file.
 */

export type TomlValue = string | number | boolean | TomlValue[];
export type TomlTable = { [key: string]: TomlValue | TomlTable };

export type AgentCommandSummary = {
  program: string | null;
  args: string[];
  schemaPath: string | null;
  timeoutSeconds: number | null;
};

export type LegacyAccountSummary = {
  slot: number;
  workspace: string | null;
  language: string | null;
  postMode: string | null;
  inboundReplyMode: string | null;
  outboundReplyMode: string | null;
  postsPerDay: number | null;
};

export type OrchestratorConfigSummary = {
  manager: { baseUrl: string | null; adminTokenEnv: string | null };
  worker: {
    id: string | null;
    assignedAgent: string | null;
    maxTasksPerRun: number | null;
    maxRevisionRounds: number | null;
    planHour: number | null;
    planTimezone: string | null;
  };
  agents: { planner: AgentCommandSummary; writer: AgentCommandSummary; validator: AgentCommandSummary };
  accounts: LegacyAccountSummary[];
};

export const AGENT_ROLES = ['planner', 'writer', 'validator'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

type Quote = '"' | "'" | null;

function stripComment(line: string): string {
  let quote: Quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

function bracketDepth(text: string): number {
  let depth = 0;
  let quote: Quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
  }
  return depth;
}

function splitTopLevel(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: Quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      items.push(text.slice(start, index));
      start = index + 1;
    }
  }
  items.push(text.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

function unescapeBasic(value: string): string {
  return value.replace(/\\(["\\nrt])/g, (_match, code: string) => {
    if (code === 'n') return '\n';
    if (code === 'r') return '\r';
    if (code === 't') return '\t';
    return code;
  });
}

export function parseTomlValue(raw: string): TomlValue {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return unescapeBasic(value.slice(1, -1));
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1).replace(/\r?\n/g, ' ')).map(parseTomlValue);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(value)) return Number(value.replace(/_/g, ''));
  return value;
}

function ensureTable(root: TomlTable, pathSegments: string[]): TomlTable {
  let table = root;
  for (const segment of pathSegments) {
    const existing = table[segment];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      table = existing as TomlTable;
    } else {
      const created: TomlTable = {};
      table[segment] = created;
      table = created;
    }
  }
  return table;
}

function unquoteKey(key: string): string {
  const trimmed = key.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses the TOML subset used by orchestrator/config.toml. Unknown syntax is skipped, never thrown. */
export function parseTomlSubset(text: string): TomlTable {
  const root: TomlTable = {};
  let table = root;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = ensureTable(root, header[1].split('.').map(unquoteKey));
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = unquoteKey(line.slice(0, eq));
    let rawValue = line.slice(eq + 1).trim();
    if (rawValue.startsWith('[')) {
      while (bracketDepth(rawValue) > 0 && index + 1 < lines.length) {
        index += 1;
        rawValue += '\n' + stripComment(lines[index]);
      }
    }
    table[key] = parseTomlValue(rawValue);
  }
  return root;
}

function tableAt(root: TomlTable, ...pathSegments: string[]): TomlTable | null {
  let table: TomlTable = root;
  for (const segment of pathSegments) {
    const next = table[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
    table = next as TomlTable;
  }
  return table;
}

function str(table: TomlTable | null, key: string): string | null {
  const value = table?.[key];
  return typeof value === 'string' ? value : null;
}

function num(table: TomlTable | null, key: string): number | null {
  const value = table?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strArray(table: TomlTable | null, key: string): string[] {
  const value = table?.[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item : String(item)));
}

function agentSummary(root: TomlTable, role: AgentRole): AgentCommandSummary {
  const table = tableAt(root, role);
  return {
    program: str(table, 'program'),
    args: strArray(table, 'args'),
    schemaPath: str(table, 'schema_path'),
    timeoutSeconds: num(table, 'timeout_seconds'),
  };
}

/** Copies only the keys the Orchestrator screen shows. Everything else stays on disk. */
export function summarizeOrchestratorConfig(root: TomlTable): OrchestratorConfigSummary {
  const manager = tableAt(root, 'manager');
  const worker = tableAt(root, 'worker');
  const accountsTable = tableAt(root, 'accounts');
  const accounts: LegacyAccountSummary[] = [];
  if (accountsTable) {
    for (const key of Object.keys(accountsTable).sort()) {
      const slot = Number(key);
      const table = tableAt(accountsTable, key);
      if (!Number.isInteger(slot) || !table) continue;
      accounts.push({
        slot,
        workspace: str(table, 'workspace'),
        language: str(table, 'language'),
        postMode: str(table, 'post_mode'),
        inboundReplyMode: str(table, 'inbound_reply_mode'),
        outboundReplyMode: str(table, 'outbound_reply_mode'),
        postsPerDay: num(table, 'posts_per_day'),
      });
    }
  }
  return {
    manager: { baseUrl: str(manager, 'base_url'), adminTokenEnv: str(manager, 'admin_token_env') },
    worker: {
      id: str(worker, 'id'),
      assignedAgent: str(worker, 'assigned_agent'),
      maxTasksPerRun: num(worker, 'max_tasks_per_run'),
      maxRevisionRounds: num(worker, 'max_revision_rounds'),
      planHour: num(worker, 'plan_hour'),
      planTimezone: str(worker, 'plan_timezone'),
    },
    agents: {
      planner: agentSummary(root, 'planner'),
      writer: agentSummary(root, 'writer'),
      validator: agentSummary(root, 'validator'),
    },
    accounts,
  };
}
