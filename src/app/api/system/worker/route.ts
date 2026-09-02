import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

import { parseTomlSubset, summarizeOrchestratorConfig } from '@/lib/orchestrator-config';
import { resolveRepoRoot } from '@/lib/repo-root';
import { assessWorker, parseWorkerLog, readLogTail } from '@/lib/worker-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_INTERVAL_SECONDS = 300;
const MAX_PASSES = 50;
const MAX_EVENTS_PER_PASS = 40;

function fileInfo(filePath: string): { path: string; exists: boolean; sizeBytes: number | null; modifiedAt: string | null } {
  try {
    const stat = fs.statSync(filePath);
    return { path: filePath, exists: true, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return { path: filePath, exists: false, sizeBytes: null, modifiedAt: null };
  }
}

/**
 * Level 3: the machine view of the subscription worker, read from the host: the launcher log,
 * the orchestrator binary and the whitelisted parts of orchestrator/config.toml.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const passes = Math.min(MAX_PASSES, Math.max(1, Number(url.searchParams.get('passes') || 12)));
    const root = resolveRepoRoot();
    const now = new Date();
    const intervalSeconds = Math.max(30, Number(process.env.X_MANAGER_WORKER_INTERVAL_SECONDS || DEFAULT_INTERVAL_SECONDS));

    const logPath = path.join(root, 'logs', 'worker.log');
    const logText = readLogTail(logPath);
    const summary = parseWorkerLog(logText ?? '', { maxPasses: passes, maxEventsPerPass: MAX_EVENTS_PER_PASS });
    const assessment = assessWorker(summary, now, intervalSeconds);

    const configPath = path.join(root, 'orchestrator', 'config.toml');
    const configExists = fs.existsSync(configPath);
    const config = configExists ? summarizeOrchestratorConfig(parseTomlSubset(fs.readFileSync(configPath, 'utf8'))) : null;

    return NextResponse.json({
      checkedAt: now.toISOString(),
      root,
      worker: {
        ...assessment,
        intervalSeconds,
        log: { ...fileInfo(logPath), truncated: summary.truncated },
        passes: summary.passes,
      },
      binary: fileInfo(path.join(root, 'bin', 'x-manager-orchestrator.exe')),
      config: { path: configPath, exists: configExists, summary: config },
    });
  } catch (error) {
    console.error('Failed to read worker state:', error);
    return NextResponse.json({ error: 'Failed to read worker state.' }, { status: 500 });
  }
}
