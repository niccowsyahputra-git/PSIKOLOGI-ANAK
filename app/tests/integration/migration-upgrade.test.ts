import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { assertIntegrity, historicalManifest, migrateWithBackup } from "../../scripts/lib/migration-safety";
import { builderFixture } from "../helpers/builder-fixture";
import { getDbClient } from "@/lib/db";
import { resolveFromProjectRoot } from "@/lib/paths";
import { INSTRUMENTS, type Answer } from "@/lib/instruments";
import * as legacy from "@/server/services/assessment.service";

const migrations = resolveFromProjectRoot("migrations");
describe("non-destructive migration rehearsal and WAL-aware backup", () => {
  it("installs all migrations on an empty local database", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "panti-fresh-upgrade-"));
    const client = createClient({ url: `file:${path.join(root, "fresh.sqlite")}` });
    try {
      await client.execute("PRAGMA foreign_keys=ON");
      const result = await migrateWithBackup(client, migrations, path.join(root, "backups"));
      expect(result.historicalTables).toBe(0);
      expect((await client.execute("SELECT * FROM __drizzle_migrations")).rows).toHaveLength(10);
      await assertIntegrity(client);
      expect(statSync(result.backupPath).mode & 0o777).toBe(0o600);
    } finally { client.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("upgrades 0006 with committed WAL answers while preserving every existing row hash", async () => {
    const f = await builderFixture({ migrationThrough: 6 });
    try {
      const child = await legacy.createProfile(f.admin, "children", { name: "Historical fictional child", fictional: true, estimatedAge: 10, ageReferenceDate: "2026-10-01" });
      await legacy.profileTransition(f.admin, "children", child.id, "verify", { revision: child.revision });
      const cycle = await legacy.createCycle(f.admin, child.id);
      const assessment = await legacy.createAssessment(f.admin, cycle.id, { target: "child" });
      const answers: Answer[] = INSTRUMENTS.B.map((item) => item.kind === "likert"
        ? { itemId: item.id, kind: "likert", value: 3, state: "answered", assistance: "none" }
        : { itemId: item.id, kind: "text", value: "Preserved fictional historical answer", state: "answered", assistance: "none" });
      await legacy.saveAssessment(f.db, f.admin.organizationId, assessment.id, { revision: assessment.revision, answers }, { type: "staff", membershipId: f.admin.membershipId }, true);
      const client = getDbClient();
      await client.execute("PRAGMA wal_autocheckpoint=0");
      await client.execute("CREATE TABLE fixture_wal (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
      await client.execute("INSERT INTO fixture_wal VALUES ('committed', 'must survive WAL snapshot')");
      const before = await historicalManifest(client);
      const result = await migrateWithBackup(client, migrations, path.join(f.root, "backups"));
      expect(await historicalManifest(client, Object.keys(before))).toEqual(before);
      expect((await client.execute("SELECT * FROM __drizzle_migrations")).rows).toHaveLength(10);
      const backup = createClient({ url: `file:${result.backupPath}` });
      try {
        expect((await backup.execute("SELECT value FROM fixture_wal")).rows[0].value).toBe("must survive WAL snapshot");
        expect((await backup.execute("SELECT * FROM __drizzle_migrations")).rows).toHaveLength(7);
        expect(await historicalManifest(backup)).toEqual(before);
        await assertIntegrity(backup);
      } finally { backup.close(); }
      const repeated = await migrateWithBackup(client, migrations, path.join(f.root, "backups"));
      expect(repeated.backupPath).not.toBe(result.backupPath);
      expect(await historicalManifest(client, Object.keys(before))).toEqual(before);
    } finally { await f.cleanup(); }
  });
});
