import { statfsSync, accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { jsonOk, withApiHandler } from "@/lib/api";
import { getDbReady } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * Local readiness probe (T01/T02). It reports operational status only: no
 * organisation data, no file contents, no configuration secrets.
 */
export const GET = withApiHandler(async () => {
  const env = getEnv();
  let database: "ok" | "error" = "ok";
  let storage: "ok" | "error" = "ok";
  let freeBytes: number | null = null;

  try {
    const db = await getDbReady();
    await db.run(sql`select 1`);
  } catch {
    database = "error";
  }

  try {
    mkdirSync(env.storage.rootAbsolutePath, { recursive: true, mode: 0o700 });
    accessSync(env.storage.rootAbsolutePath, constants.W_OK);
    const stats = statfsSync(path.dirname(env.storage.rootAbsolutePath));
    freeBytes = stats.bavail * stats.bsize;
  } catch {
    storage = "error";
  }

  return jsonOk({
    status: database === "ok" && storage === "ok" ? "ok" : "degraded",
    appMode: env.appMode,
    localOnly: env.localOnly,
    runtime: {
      aiMode: env.ai.mode,
      liveIntakeEnabled: env.liveIntakeEnabled,
    },
    checks: {
      database,
      storage,
      freeBytes,
    },
  });
});
