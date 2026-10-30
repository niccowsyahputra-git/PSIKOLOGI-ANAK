import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

export type HistoryManifest = Record<string, { rows: number; sha256: string }>;
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Hash records, not SQLite pages; VACUUM can safely rearrange physical pages. */
export async function historicalManifest(client: Client, tables?: string[]): Promise<HistoryManifest> {
  const names = tables ?? (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name")).rows.map((r) => String(r.name));
  const manifest: HistoryManifest = {};
  for (const name of names) {
    const columns = (await client.execute(`PRAGMA table_info(${identifier(name)})`)).rows;
    const primary = columns.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    const order = (primary.length ? primary : columns).map((c) => identifier(String(c.name))).join(",");
    const digest = createHash("sha256"); let rows = 0;
    // Bound memory even for a large local answer/audit history.
    for (;;) {
      const page = await client.execute(`SELECT * FROM ${identifier(name)} ORDER BY ${order} LIMIT 500 OFFSET ${rows}`);
      for (const row of page.rows) {
        digest.update(JSON.stringify(page.columns.map((column) => row[column]), (_, value) => typeof value === "bigint" ? value.toString() : value instanceof ArrayBuffer ? Buffer.from(value).toString("base64") : value));
        digest.update("\n");
      }
      rows += page.rows.length;
      if (page.rows.length < 500) break;
    }
    manifest[name] = { rows, sha256: digest.digest("hex") };
  }
  return manifest;
}
export async function assertIntegrity(client: Client): Promise<void> {
  const result = await client.execute("PRAGMA integrity_check");
  if (result.rows.length !== 1 || result.rows[0][0] !== "ok") throw new Error("SQLite integrity check failed; no automatic recovery is attempted.");
  if ((await client.execute("PRAGMA foreign_key_check")).rows.length) throw new Error("SQLite foreign key check failed; no automatic recovery is attempted.");
}
async function assertHistory(client: Client, expected: HistoryManifest): Promise<void> {
  const actual = await historicalManifest(client, Object.keys(expected));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Historical record hashes changed. Stop the application and inspect the retained backup; no destructive rollback was performed.");
}

/**
 * Run with application writers stopped. VACUUM INTO reads a consistent SQLite
 * snapshot including committed WAL records; copying the main file alone does not.
 * The backup is never migrated. A separate clone rehearses the upgrade first.
 */
export async function migrateWithBackup(client: Client, migrationsFolder: string, backupRoot: string) {
  await assertIntegrity(client);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  chmodSync(backupRoot, 0o700);
  const directory = path.join(backupRoot, `migration-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const backupPath = path.join(directory, "before.sqlite");
  const rehearsalPath = path.join(directory, "rehearsal.sqlite");
  await client.execute({ sql: "VACUUM INTO ?", args: [backupPath] });
  chmodSync(backupPath, 0o600);
  const backup = createClient({ url: `file:${backupPath}` });
  let manifest: HistoryManifest;
  try {
    await assertIntegrity(backup);
    manifest = await historicalManifest(backup);
    await backup.execute({ sql: "VACUUM INTO ?", args: [rehearsalPath] });
  } finally { backup.close(); }
  chmodSync(rehearsalPath, 0o600);
  const rehearsal = createClient({ url: `file:${rehearsalPath}` });
  try {
    await rehearsal.execute("PRAGMA foreign_keys = ON");
    await migrate(drizzle(rehearsal), { migrationsFolder });
    await assertIntegrity(rehearsal);
    await assertHistory(rehearsal, manifest);
  } finally { rehearsal.close(); }
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ backupPath, rehearsalPath, tables: manifest, rehearsal: "passed" }, null, 2), { mode: 0o600, flag: "wx" });
  // Detect an active writer before touching the installation's schema.
  await assertHistory(client, manifest);
  await migrate(drizzle(client), { migrationsFolder });
  await assertIntegrity(client);
  await assertHistory(client, manifest);
  writeFileSync(path.join(directory, "verified.json"), JSON.stringify({ completedAt: new Date().toISOString(), historicalTables: Object.keys(manifest).length, integrity: "ok", unchangedHistoricalHashes: true }, null, 2), { mode: 0o600, flag: "wx" });
  return { backupPath, rehearsalPath, historicalTables: Object.keys(manifest).length };
}
