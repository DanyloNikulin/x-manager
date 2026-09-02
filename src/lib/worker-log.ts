import fs from 'fs';

/**
 * Reader for `logs/worker.log`, written by `deploy/windows/run-worker-loop.ps1`.
 *
 * Launcher lines wrap every pass:
 *   `[<local ISO>] starting subscription worker pass`
 *   `[<local ISO>] worker exit code: <n>`  or  `[<local ISO>] worker launcher error: <text>`
 * Between them sits the orchestrator's tracing output, ANSI-coloured:
 *   `<UTC ISO> LEVEL target: message key=value key=value`
 */

export type WorkerLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type WorkerLogEvent = {
  at: string | null;
  level: WorkerLogLevel | null;
  target: string | null;
  message: string;
  fields: Record<string, string>;
};

export type WorkerPass = {
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  launcherError: string | null;
  processed: number | null;
  warnings: number;
  errors: number;
  events: WorkerLogEvent[];
};

export type WorkerLogSummary = {
  passes: WorkerPass[];
  lastPass: WorkerPass | null;
  /** True when the read window started inside a pass; that partial pass was dropped. */
  truncated: boolean;
};

export type WorkerLiveness = 'running' | 'idle' | 'stale' | 'unknown';

export type WorkerAssessment = {
  liveness: WorkerLiveness;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  /** Seconds since the last pass finished (or started, while running). */
  ageSeconds: number | null;
};

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;
const LAUNCHER_START = /^\[([^\]]+)\] starting subscription worker pass\s*$/;
const LAUNCHER_EXIT = /^\[([^\]]+)\] worker exit code: (-?\d+)\s*$/;
const LAUNCHER_ERROR = /^\[([^\]]+)\] worker launcher error: (.*)$/;
const TRACING_LINE = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([A-Za-z0-9_:]+):\s?(.*)$/;
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_.]*=/;
const FIELD_SPLIT = /\s+(?=[A-Za-z_][A-Za-z0-9_.]*=)/;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/** Splits `message key=value key=value with spaces` the way tracing's default formatter prints it. */
export function parseTracingMessage(raw: string): { message: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const parts = raw.trim().split(FIELD_SPLIT);
  const [first, ...rest] = parts;
  let message = '';
  const fieldParts = [...rest];
  if (first !== undefined) {
    if (FIELD_KEY.test(first)) fieldParts.unshift(first);
    else message = first.trim();
  }
  for (const part of fieldParts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1).trim();
  }
  return { message, fields };
}

export function parseWorkerLog(
  text: string,
  options: { maxPasses?: number; maxEventsPerPass?: number } = {},
): WorkerLogSummary {
  const maxPasses = Math.max(1, options.maxPasses ?? 20);
  const maxEventsPerPass = Math.max(1, options.maxEventsPerPass ?? 200);
  const passes: WorkerPass[] = [];
  let current: WorkerPass | null = null;
  let sawStart = false;
  let truncated = false;

  const finish = (finishedAt: string, exitCode: number | null, launcherError: string | null) => {
    if (!current) {
      if (!sawStart) truncated = true;
      return;
    }
    current.finishedAt = finishedAt;
    current.exitCode = exitCode;
    current.launcherError = launcherError;
    passes.push(current);
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripAnsi(rawLine).trimEnd();
    if (!line.trim()) continue;

    let match = LAUNCHER_START.exec(line);
    if (match) {
      // A start without a preceding exit line means the previous pass never reported back.
      if (current) passes.push(current);
      current = { startedAt: match[1], finishedAt: null, exitCode: null, launcherError: null, processed: null, warnings: 0, errors: 0, events: [] };
      sawStart = true;
      continue;
    }
    match = LAUNCHER_EXIT.exec(line);
    if (match) {
      finish(match[1], Number(match[2]), null);
      continue;
    }
    match = LAUNCHER_ERROR.exec(line);
    if (match) {
      finish(match[1], null, match[2].trim());
      continue;
    }
    if (!current) {
      if (!sawStart) truncated = true;
      continue;
    }

    match = TRACING_LINE.exec(line);
    const event: WorkerLogEvent = match
      ? { at: match[1], level: match[2] as WorkerLogLevel, target: match[3], ...parseTracingMessage(match[4]) }
      : { at: null, level: null, target: null, message: line.trim(), fields: {} };
    if (event.level === 'WARN') current.warnings += 1;
    if (event.level === 'ERROR') current.errors += 1;
    if (/worker pass completed/.test(event.message) && event.fields.processed !== undefined) {
      const processed = Number(event.fields.processed);
      if (Number.isFinite(processed)) current.processed = processed;
    }
    if (current.events.length < maxEventsPerPass) current.events.push(event);
  }
  if (current) passes.push(current);

  const kept = passes.slice(-maxPasses);
  return { passes: kept, lastPass: kept[kept.length - 1] ?? null, truncated };
}

/** Reads at most `maxBytes` from the end of a log file, dropping the first partial line. */
export function readLogTail(filePath: string, maxBytes = 512 * 1024): string | null {
  if (!fs.existsSync(filePath)) return null;
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    if (length === 0) return '';
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    let text = buffer.toString('utf8');
    if (length < size) {
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function toMillis(value: string | null): number | null {
  if (!value) return null;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

/** Judges whether the worker loop is still alive from the timing of its last pass. */
export function assessWorker(summary: WorkerLogSummary, now: Date, intervalSeconds: number): WorkerAssessment {
  const last = summary.lastPass;
  if (!last) return { liveness: 'unknown', lastStartedAt: null, lastFinishedAt: null, ageSeconds: null };
  const started = toMillis(last.startedAt);
  const finished = toMillis(last.finishedAt);
  const staleAfterSeconds = intervalSeconds * 2 + 120;
  if (finished === null) {
    const age = started === null ? null : Math.max(0, Math.round((now.getTime() - started) / 1000));
    const liveness: WorkerLiveness = age !== null && age <= 20 * 60 ? 'running' : 'stale';
    return { liveness, lastStartedAt: last.startedAt, lastFinishedAt: null, ageSeconds: age };
  }
  const age = Math.max(0, Math.round((now.getTime() - finished) / 1000));
  return {
    liveness: age <= staleAfterSeconds ? 'idle' : 'stale',
    lastStartedAt: last.startedAt,
    lastFinishedAt: last.finishedAt,
    ageSeconds: age,
  };
}
