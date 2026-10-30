import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { closeDb, getDbReady } from "../src/lib/db";
import { resetEnvCacheForTests } from "../src/lib/env";
import { createOrganization } from "../src/server/repositories/organization.repository";
import { createStaffAccount, ensureStaffAccount } from "../src/server/services/staff.service";

/** Each e2e run gets its own database, keys and media directory, never the dev installation. */
async function main() {
  mkdirSync(path.resolve("var"), { recursive: true, mode: 0o700 });
  const root = mkdtempSync(path.resolve("var/e2e-"));
  Object.assign(process.env, {
    NODE_ENV: "production", APP_MODE: "local-development", LOCAL_ONLY: "true",
    // Mirror the dev installation: configured localhost, server/browser IPv4 loopback.
    APP_BASE_URL: "http://localhost:3100", BETTER_AUTH_URL: "http://localhost:3100",
    DATABASE_PROVIDER: "local", DATABASE_URL: `file:${path.join(root, "test.db")}`,
    STORAGE_PROVIDER: "local", LOCAL_STORAGE_ROOT: path.join(root, "storage"), BACKUP_ROOT: path.join(root, "backups"),
    LIVE_INTAKE_ENABLED: "false", AI_MODE: "mock",
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  resetEnvCacheForTests();
  const db = await getDbReady();
  await migrate(db, { migrationsFolder: path.resolve("migrations") });
  const organization = await createOrganization(db, { name: "Panti Fiktif E2E", timezone: "Asia/Jakarta" });
  for (const identity of ["a", "b", "c"]) {
    await ensureStaffAccount(db, { organizationId: organization.id, email: `e2e-${identity}@panti.test`, name: "Staf Uji", password: "FictionalE2e2026!", role: "admin", actorLabel: "test:e2e" });
  }
  await ensureStaffAccount(db, { organizationId: organization.id, email: "e2e-pengasuh@panti.test", name: "Pengasuh Uji", password: "FictionalE2e2026!", role: "pengasuh", actorLabel: "test:e2e" });
  const builder = await ensureStaffAccount(db, { organizationId: organization.id, email: "e2e-builder@panti.test", name: "Builder Admin", password: "FictionalE2e2026!", role: "admin", actorLabel: "test:e2e" });
  await createStaffAccount(db, { actor: { ...builder, organizationId: organization.id, role: "admin" }, input: { name: "Builder Psychologist", email: "e2e-psych@panti.test", password: "FictionalE2e2026!", role: "psikolog", credentialReference: "FICTIONAL-STR-987654", chairpersonConfirmation: true } });
  const other = await createOrganization(db, { name: "Other fictional organization", timezone: "Asia/Jakarta" });
  await ensureStaffAccount(db, { organizationId: other.id, email: "e2e-other@panti.test", name: "Other Admin", password: "FictionalE2e2026!", role: "admin", actorLabel: "test:e2e" });
  await closeDb();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], { stdio: "inherit", env: process.env });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
