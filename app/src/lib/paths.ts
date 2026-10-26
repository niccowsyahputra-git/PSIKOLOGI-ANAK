import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Next.js serves dev/build/start from the project root, and every script in
 * `scripts/` is invoked from there too. Resolving from `process.cwd()` keeps a
 * single absolute root for the local database, private storage and backups so
 * the resolved paths never differ between dev, build, start and scripts.
 */
export const PROJECT_ROOT = process.cwd();

export function resolveFromProjectRoot(target: string): string {
  // `turbopackIgnore` keeps the bundler from tracing the whole project: this
  // path is a local runtime location, never a bundled asset.
  return path.resolve(/* turbopackIgnore: true */ PROJECT_ROOT, target);
}

export const LOCAL_DATA_DIRS = {
  db: resolveFromProjectRoot("var/db"),
  storage: resolveFromProjectRoot("var/storage"),
  backups: resolveFromProjectRoot("var/backups"),
} as const;

/**
 * Creates (or tightens) a directory that only the local OS user may read
 * (section 12.4: database, storage and backups stay private).
 */
export function ensurePrivateDirectory(target: string): string {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  try {
    chmodSync(target, 0o700);
  } catch {
    // A directory owned by another local user cannot be tightened here; the
    // startup checks in `storage:check` report it instead of failing silently.
  }
  return target;
}
