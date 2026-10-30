import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { closeDb, getDbReady } from "@/lib/db";
import { emptyDefinition, newQuestion } from "@/lib/assessment-builder/definition";
import { resetEnvCacheForTests } from "@/lib/env";
import { resolveFromProjectRoot } from "@/lib/paths";
import { createOrganization } from "@/server/repositories/organization.repository";
import { createStaffAccount, ensureStaffAccount, type StaffActor } from "@/server/services/staff.service";
import * as templates from "@/server/services/template.service";

export async function builderFixture(options: { migrationThrough?: number } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "panti-builder-"));
  Object.assign(process.env, { NODE_ENV: "test", APP_MODE: "local-development", LOCAL_ONLY: "true", DATABASE_PROVIDER: "local", DATABASE_URL: `file:${path.join(root, "test.db")}`, STORAGE_PROVIDER: "local", LOCAL_STORAGE_ROOT: path.join(root, "storage"), BACKUP_ROOT: path.join(root, "backups"), AI_MODE: "mock", LIVE_INTAKE_ENABLED: "true", LOCAL_AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:11434", BETTER_AUTH_SECRET: "f".repeat(48), APP_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64") });
  resetEnvCacheForTests(); const db = await getDbReady();
  let migrationsFolder = resolveFromProjectRoot("migrations");
  if (options.migrationThrough !== undefined) {
    const source = migrationsFolder;
    migrationsFolder = path.join(root, "old-migrations");
    mkdirSync(path.join(migrationsFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(source, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= options.migrationThrough!);
    for (const entry of journal.entries) copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(migrationsFolder, `${entry.tag}.sql`));
    writeFileSync(path.join(migrationsFolder, "meta/_journal.json"), JSON.stringify(journal));
  }
  await migrate(db, { migrationsFolder });
  const home = await createOrganization(db, { name: "Panti Template Fiktif", timezone: "Asia/Jakarta" });
  const other = await createOrganization(db, { name: "Panti Lain", timezone: "Asia/Jakarta" });
  const staff = async (organizationId: string, role: StaffActor["role"]): Promise<StaffActor> => {
    const row = await ensureStaffAccount(db, { organizationId, email: `${role}-${organizationId}@builder.test`, name: `Staf ${role}`, password: "FictionalBuilder2026!", role, actorLabel: "test" });
    return { membershipId: row.membershipId, authUserId: row.authUserId, organizationId, role };
  };
  const admin = await staff(home.id, "admin"); const caregiver = await staff(home.id, "pengasuh"); const chair = await staff(home.id, "ketua"); const outsider = await staff(other.id, "admin");
  const psych = await createStaffAccount(db, { actor: admin, input: { name: "Psikolog Fiktif", email: "psikolog@builder.test", password: "FictionalPsych2026!", role: "psikolog", credentialReference: "STR-FIKTIF-123456", chairpersonConfirmation: true } });
  const psychologist: StaffActor = { membershipId: psych.membershipId, authUserId: psych.authUserId, organizationId: home.id, role: "psikolog" };
  return { db, root, admin, caregiver, chair, psychologist, outsider, cleanup: async () => { await closeDb(); rmSync(root, { recursive: true, force: true }); } };
}
export function sampleDefinition() {
  const d = emptyDefinition("Kondisi sosial keluarga");
  const sectionId = crypto.randomUUID(); d.sections = [{ id: sectionId, title: "Dukungan keluarga", instructions: "Boleh dilewati", active: true, archived: false }];
  const first = { ...newQuestion(sectionId, "yes_no"), label: "Apakah keluarga memiliki penghasilan tetap?", required: true };
  const second = { ...newQuestion(sectionId, "long_text"), label: "Sumber dukungan apa yang tersedia?", required: true, condition: { questionId: first.id, operator: "equals" as const, value: false } };
  d.questions = [first, second]; return d;
}
export async function publishedTemplate(f: Awaited<ReturnType<typeof builderFixture>>, definition = sampleDefinition()) {
  let result = await templates.createTemplate(f.admin, { name: "Kondisi sosial keluarga" });
  result = await templates.saveDraft(f.admin, result.version.id, { revision: result.version.revision, definition });
  result = await templates.transitionVersion(f.admin, result.version.id, "submit-review", { revision: result.version.revision, note: "Siap ditinjau psikolog" });
  result = await templates.transitionVersion(f.psychologist, result.version.id, "review", { revision: result.version.revision, decision: "approved", note: "Layak sebagai pertanyaan intake, bukan instrumen tervalidasi" });
  return templates.transitionVersion(f.admin, result.version.id, "publish", { revision: result.version.revision, note: "Publikasi setelah tinjauan" });
}
