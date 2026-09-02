import { describe, expect, it } from 'vitest';
import { assessWorker, parseTracingMessage, parseWorkerLog, stripAnsi } from '@/lib/worker-log';

const ESC = '\x1b';
const dim = (text: string) => `${ESC}[2m${text}${ESC}[0m`;
const italic = (text: string) => `${ESC}[3m${text}${ESC}[0m`;
const info = (at: string, target: string, rest: string) =>
  `${dim(at)} ${ESC}[32m INFO${ESC}[0m ${dim(target)}${dim(':')} ${rest}`;
const warn = (at: string, target: string, rest: string) =>
  `${dim(at)} ${ESC}[33m WARN${ESC}[0m ${dim(target)}${dim(':')} ${rest}`;
const field = (key: string, value: string) => `${italic(key)}${dim('=')}${value}`;

const SAMPLE = [
  '[2026-09-02T10:29:45.4761103+02:00] starting subscription worker pass',
  warn('2026-09-02T08:29:45.503742Z', 'x_manager_orchestrator::planner', `planner skipped slot ${field('slot', '2')} ${field('error', 'account ../accounts/slot-2 has not completed onboarding')}`),
  info('2026-09-02T08:29:45.509743Z', 'x_manager_orchestrator', `worker pass completed ${field('processed', '0')}`),
  '[2026-09-02T10:29:45.5078550+02:00] worker exit code: 0',
  '[2026-09-02T10:42:25.1648546+02:00] starting subscription worker pass',
  warn('2026-09-02T08:43:15.656151Z', 'x_manager_orchestrator::worker', `task requires operator review ${field('task_id', '6')}`),
  'stray stderr line from a CLI',
  info('2026-09-02T08:43:15.656209Z', 'x_manager_orchestrator', `worker pass completed ${field('processed', '1')}`),
  '[2026-09-02T10:43:15.6500304+02:00] worker exit code: 0',
  '[2026-09-02T10:48:00.0000000+02:00] starting subscription worker pass',
  '[2026-09-02T10:48:01.0000000+02:00] worker launcher error: Required worker file is missing',
].join('\r\n');

describe('stripAnsi', () => {
  it('removes colour codes and keeps the text', () => {
    expect(stripAnsi(dim('hello'))).toBe('hello');
  });
});

describe('parseTracingMessage', () => {
  it('separates the message from key=value fields, values may contain spaces', () => {
    const parsed = parseTracingMessage('planner skipped slot slot=2 error=account ../accounts/slot-2 has not completed onboarding');
    expect(parsed.message).toBe('planner skipped slot');
    expect(parsed.fields).toEqual({ slot: '2', error: 'account ../accounts/slot-2 has not completed onboarding' });
  });

  it('accepts a line that is only fields', () => {
    expect(parseTracingMessage('processed=3')).toEqual({ message: '', fields: { processed: '3' } });
  });
});

describe('parseWorkerLog', () => {
  it('groups tracing lines into launcher passes', () => {
    const summary = parseWorkerLog(SAMPLE);
    expect(summary.passes).toHaveLength(3);
    expect(summary.truncated).toBe(false);

    const [first, second, third] = summary.passes;
    expect(first.startedAt).toBe('2026-09-02T10:29:45.4761103+02:00');
    expect(first.finishedAt).toBe('2026-09-02T10:29:45.5078550+02:00');
    expect(first.exitCode).toBe(0);
    expect(first.processed).toBe(0);
    expect(first.warnings).toBe(1);
    expect(first.events[0]).toMatchObject({
      level: 'WARN',
      target: 'x_manager_orchestrator::planner',
      message: 'planner skipped slot',
      fields: { slot: '2', error: 'account ../accounts/slot-2 has not completed onboarding' },
    });

    expect(second.processed).toBe(1);
    expect(second.events.map((event) => event.message)).toEqual([
      'task requires operator review',
      'stray stderr line from a CLI',
      'worker pass completed',
    ]);
    expect(second.events[1].level).toBeNull();

    expect(third.exitCode).toBeNull();
    expect(third.launcherError).toBe('Required worker file is missing');
    expect(summary.lastPass).toBe(third);
  });

  it('drops a leading partial pass and flags it', () => {
    const tail = SAMPLE.split('\r\n').slice(2).join('\n');
    const summary = parseWorkerLog(tail);
    expect(summary.truncated).toBe(true);
    expect(summary.passes).toHaveLength(2);
    expect(summary.passes[0].startedAt).toBe('2026-09-02T10:42:25.1648546+02:00');
  });

  it('keeps only the newest passes and caps events per pass', () => {
    const summary = parseWorkerLog(SAMPLE, { maxPasses: 1, maxEventsPerPass: 1 });
    expect(summary.passes).toHaveLength(1);
    expect(summary.passes[0].launcherError).toBe('Required worker file is missing');
    const capped = parseWorkerLog(SAMPLE, { maxEventsPerPass: 1 });
    expect(capped.passes[1].events).toHaveLength(1);
    expect(capped.passes[1].processed).toBe(1);
  });

  it('closes a pass that never reported an exit code when the next one starts', () => {
    const text = [
      '[2026-09-02T10:00:00+02:00] starting subscription worker pass',
      '[2026-09-02T10:05:00+02:00] starting subscription worker pass',
      '[2026-09-02T10:05:01+02:00] worker exit code: 1',
    ].join('\n');
    const summary = parseWorkerLog(text);
    expect(summary.passes).toHaveLength(2);
    expect(summary.passes[0].finishedAt).toBeNull();
    expect(summary.passes[1].exitCode).toBe(1);
  });
});

describe('assessWorker', () => {
  const interval = 300;

  it('is unknown without passes', () => {
    expect(assessWorker(parseWorkerLog(''), new Date(), interval).liveness).toBe('unknown');
  });

  it('is idle shortly after a finished pass and stale much later', () => {
    const summary = parseWorkerLog(SAMPLE.split('\r\n').slice(0, 4).join('\n'));
    expect(assessWorker(summary, new Date('2026-09-02T08:35:00Z'), interval)).toMatchObject({ liveness: 'idle', ageSeconds: 314 });
    expect(assessWorker(summary, new Date('2026-09-02T09:35:00Z'), interval).liveness).toBe('stale');
  });

  it('is running while the last pass has not finished', () => {
    const summary = parseWorkerLog('[2026-09-02T10:00:00+02:00] starting subscription worker pass');
    expect(assessWorker(summary, new Date('2026-09-02T08:03:00Z'), interval).liveness).toBe('running');
    expect(assessWorker(summary, new Date('2026-09-02T09:03:00Z'), interval).liveness).toBe('stale');
  });
});
