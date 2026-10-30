import { closeDb, getDbReady, getDbClient } from "../src/lib/db";
import { migrateWithBackup } from "./lib/migration-safety";
import { getEnv } from "../src/lib/env";
import { resolveFromProjectRoot } from "../src/lib/paths";
import { printDone, printHeader, printStep } from "./lib/cli";

/**
 * Applies SQL migrations from `migrations/` to the local libSQL file. The same
 * files are what a future, separately approved cloud phase would reuse.
 */
async function main(): Promise<void> {
  printHeader("db:migrate (local SQLite/libSQL)");
  const env = getEnv();
  printStep(`database: ${env.database.absolutePath}`);
  printStep(`migrations: ${resolveFromProjectRoot("migrations")}`);
  printStep(`mode: ${env.appMode} (LOCAL_ONLY=${env.localOnly})`);

  printStep("Application writers must be stopped. Rehearsing on a private backup before upgrading.");
  await getDbReady();
  const result = await migrateWithBackup(getDbClient(), resolveFromProjectRoot("migrations"), env.backup.rootAbsolutePath);
  printStep(`verified backup: ${result.backupPath}`);
  printStep(`unchanged historical tables: ${result.historicalTables}`);
  printDone("Migrasi selesai. Skema lokal mutakhir.");
}

main()
  .catch((error: unknown) => {
    console.error(
      `✖ Migrasi gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
