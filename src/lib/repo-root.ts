import fs from 'fs';
import path from 'path';

/**
 * The repository checkout on the host. The standalone Next.js server chdirs into
 * `.next/standalone`, so in production `process.cwd()` sits two levels below the
 * checkout; in development it is the checkout itself.
 */
export function resolveRepoRoot(cwd: string = process.cwd()): string {
  const candidates = [
    process.env.X_MANAGER_REPO_ROOT,
    cwd,
    path.resolve(cwd, '..', '..'),
    process.env.X_MANAGER_DB_PATH ? path.resolve(path.dirname(process.env.X_MANAGER_DB_PATH), '..') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (looksLikeRepoRoot(candidate)) return candidate;
  }
  return cwd;
}

export function looksLikeRepoRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'orchestrator'));
}
