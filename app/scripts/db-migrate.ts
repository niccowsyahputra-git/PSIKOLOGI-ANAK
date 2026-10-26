import { migrate } from "drizzle-orm/libsql/migrator";
import { closeDb, getDbReady } from "../src/lib/db";
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

  const db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });
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
