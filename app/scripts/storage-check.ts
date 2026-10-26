import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  readdirSync,
  readFileSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getEnv } from "../src/lib/env";
import { PROJECT_ROOT, ensurePrivateDirectory } from "../src/lib/paths";
import { printDone, printHeader, printStep } from "./lib/cli";

/**
 * Local storage health check (FR-08, FR-17, section 11.3). It verifies the
 * private root exists, is writable, sits outside `public/` and `src/`, and that
 * a write/read round trip succeeds. File contents are never printed.
 */
function isInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

async function main(): Promise<void> {
  printHeader("storage:check (filesystem privat lokal)");
  const env = getEnv();
  const root = env.storage.rootAbsolutePath;

  const forbiddenRoots = [
    path.join(PROJECT_ROOT, "public"),
    path.join(PROJECT_ROOT, "src"),
    path.join(PROJECT_ROOT, ".next"),
  ];
  const offending = forbiddenRoots.find((forbidden) => isInside(root, forbidden));
  if (offending) {
    throw new Error(
      `LOCAL_STORAGE_ROOT tidak boleh berada di dalam ${path.relative(PROJECT_ROOT, offending)}/`,
    );
  }

  // Tighten the private roots: the storage and backup directories must stay
  // owner-only (section 12.4).
  ensurePrivateDirectory(root);
  const backupRoot = ensurePrivateDirectory(env.backup.rootAbsolutePath);
  accessSync(root, constants.R_OK | constants.W_OK);

  const probePath = path.join(
    root,
    `.storage-check-${randomBytes(6).toString("hex")}.tmp`,
  );
  const payload = randomBytes(64);
  try {
    writeFileSync(probePath, payload, { mode: 0o600 });
    const roundTrip = readFileSync(probePath);
    if (!roundTrip.equals(payload)) {
      throw new Error("Verifikasi tulis/baca file storage gagal");
    }
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      // Probe cleanup failure must not hide a successful check.
    }
  }

  const rootStats = statSync(root);
  const filesystem = statfsSync(root);
  const freeBytes = filesystem.bavail * filesystem.bsize;
  let entryCount = 0;
  try {
    entryCount = readdirSync(root).length;
  } catch {
    entryCount = 0;
  }

  printStep(`root: ${root}`);
  printStep(`mode: 0${(rootStats.mode & 0o777).toString(8)}`);
  printStep("writable: ya (uji tulis/baca + checksum lulus)");
  printStep(`free space: ${formatBytes(freeBytes)}`);
  printStep(`entri tingkat atas: ${entryCount}`);
  printStep(`backup root: ${backupRoot} (mode 0700)`);
  printDone("Storage lokal privat siap digunakan. Tidak ada akses OAuth/Drive.");
}

main().catch((error: unknown) => {
  console.error(
    `✖ storage:check gagal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
