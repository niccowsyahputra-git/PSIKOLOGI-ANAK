import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDbReady, type AppDatabase } from "@/lib/db";
import { assessments, intakeSessions } from "@/lib/db/assessment-schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError, NotReadyError, UnauthenticatedError, ValidationError } from "@/lib/errors";
import { INSTRUMENTS, type Answer } from "@/lib/instruments";
import { resolveFromProjectRoot } from "@/lib/paths";
import { PermissionDeniedError } from "@/lib/permissions";
import { createOrganization } from "@/server/repositories/organization.repository";
import * as service from "@/server/services/assessment.service";
import { mediaContent, uploadMedia } from "@/server/services/media.service";
import { ensureStaffAccount, type StaffActor } from "@/server/services/staff.service";

let tempDir: string;
let db: AppDatabase;
let pengasuh: StaffActor;
let ketua: StaffActor;
let outsider: StaffActor;
let childId: string;
let guardianId: string;
let cycleId: string;
let childAssessmentId: string;
let guardianAssessmentId: string;
let childSession: service.IntakeRow;
let attachmentId: string;

const today = new Date().toISOString().slice(0, 10);
const yearsAgo = (years: number) => `${new Date().getUTCFullYear() - years}${today.slice(4)}`;

async function staff(organizationId: string, email: string, role: StaffActor["role"]): Promise<StaffActor> {
  const result = await ensureStaffAccount(db, { organizationId, email, name: `Staf ${role}`, password: "StafLokal2026!", role, actorLabel: "test" });
  return { membershipId: result.membershipId, authUserId: result.authUserId, organizationId, role };
}

async function fictionalChild(input: Record<string, unknown>) {
  const child = await service.createProfile(pengasuh, "children", { name: "Anak Fiktif", fictional: true, background: ["kehilangan_ayah"], ...input });
  await service.profileTransition(pengasuh, "children", child.id, "verify", { revision: child.revision });
  return child.id;
}

async function startSession(assessmentId: string) {
  const created = await service.createIntakeSession(pengasuh, cycleId, { assessmentId });
  const { secret } = await service.exchangeIntake(created.id, created.token, null);
  return { created, secret, row: await service.resolveIntake(secret) };
}

const participant = (row: service.IntakeRow) => ({ type: "participant" as const, sessionId: row.id });
const png = async () => new File([new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffffff" } }).png().toBuffer())], "gambar.png", { type: "image/png" });

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "panti-assessment-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_MODE: "local-development",
    LOCAL_ONLY: "true",
    DATABASE_PROVIDER: "local",
    DATABASE_URL: `file:${path.join(tempDir, "test.db")}`,
    STORAGE_PROVIDER: "local",
    LOCAL_STORAGE_ROOT: path.join(tempDir, "storage"),
    BACKUP_ROOT: path.join(tempDir, "backups"),
    AI_MODE: "mock",
    LIVE_INTAKE_ENABLED: "false",
    BETTER_AUTH_SECRET: "c".repeat(48),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  resetEnvCacheForTests();
  db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });
  const home = await createOrganization(db, { name: "Panti Uji", timezone: "Asia/Jakarta" });
  const other = await createOrganization(db, { name: "Panti Lain", timezone: "Asia/Jakarta" });
  pengasuh = await staff(home.id, "pengasuh@panti.test", "pengasuh");
  ketua = await staff(home.id, "ketua@panti.test", "ketua");
  outsider = await staff(other.id, "pengasuh@lain.test", "pengasuh");
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("profiles and cycles", () => {
  it("refuses real (non-fictional) profiles while live intake is disabled", async () => {
    await expect(service.createProfile(pengasuh, "children", { name: "Anak Nyata", fictional: false, estimatedAge: 7, ageReferenceDate: today })).rejects.toThrow(NotReadyError);
    await expect(service.createProfile(pengasuh, "guardians", { name: "Wali Nyata", fictional: false })).rejects.toThrow(NotReadyError);
  });

  it("requires a verified profile before a cycle starts", async () => {
    const child = await service.createProfile(pengasuh, "children", { name: "Belum Verifikasi", fictional: true, estimatedAge: 6, ageReferenceDate: today });
    await expect(service.createCycle(pengasuh, child.id)).rejects.toThrow(ValidationError);
  });

  it("selects the module from the age at the start of the cycle", async () => {
    const a = await service.createCycle(pengasuh, await fictionalChild({ estimatedAge: 7, ageReferenceDate: today }));
    const b = await service.createCycle(pengasuh, await fictionalChild({ birthDate: yearsAgo(10) }));
    const c = await service.createCycle(pengasuh, await fictionalChild({ estimatedAge: 15, ageReferenceDate: today }));
    expect([a.module, b.module, c.module]).toEqual(["A", "B", "C"]);
    expect(a.fictional).toBe(true);
  });

  it("refuses ages outside 4–18", async () => {
    await expect(service.createCycle(pengasuh, await fictionalChild({ estimatedAge: 3, ageReferenceDate: today }))).rejects.toThrow(ValidationError);
  });

  it("links a verified guardian and opens a module A cycle", async () => {
    childId = await fictionalChild({ estimatedAge: 6, ageReferenceDate: today });
    const guardian = await service.createProfile(pengasuh, "guardians", { name: "Wali Fiktif", fictional: true });
    guardianId = guardian.id;
    await service.profileTransition(pengasuh, "guardians", guardianId, "verify", { revision: guardian.revision });
    await service.linkGuardian(pengasuh, childId, { guardianId, relationship: "Nenek", isPrimary: true });
    await expect(service.linkGuardian(pengasuh, childId, { guardianId, relationship: "Nenek" })).rejects.toThrow(ConflictError);
    cycleId = (await service.createCycle(pengasuh, childId)).id;
  });

  it("isolates organizations", async () => {
    await expect(service.cycleDetail(outsider, cycleId)).rejects.toThrow(NotFoundError);
    await expect(service.profileDetail(outsider, "children", childId)).rejects.toThrow(NotFoundError);
    await expect(service.createAssessment(outsider, cycleId, { target: "child" })).rejects.toThrow(NotFoundError);
    expect((await service.listProfiles(outsider, "children")).total).toBe(0);
  });
});

describe("child and guardian questionnaires", () => {
  it("creates one draft per participant", async () => {
    const child = await service.createAssessment(pengasuh, cycleId, { target: "child" });
    const guardian = await service.createAssessment(pengasuh, cycleId, { target: "guardian", guardianId });
    expect([child.module, guardian.module]).toEqual(["A", "W"]);
    childAssessmentId = child.id; guardianAssessmentId = guardian.id;
    await expect(service.createAssessment(pengasuh, cycleId, { target: "child" })).rejects.toThrow(ConflictError);
    await expect(service.createAssessment(pengasuh, cycleId, { target: "child", guardianId })).rejects.toThrow(ValidationError);
  });

  it("exchanges a session token once and rejects wrong tokens", async () => {
    const created = await service.createIntakeSession(pengasuh, cycleId, { assessmentId: childAssessmentId });
    expect(created.path).toBe(`/intake/${created.id}#token=${created.token}`);
    await expect(service.exchangeIntake(created.id, "x".repeat(43), null)).rejects.toThrow(UnauthenticatedError);
    const { secret } = await service.exchangeIntake(created.id, created.token, null);
    await expect(service.exchangeIntake(created.id, created.token, null)).rejects.toThrow(UnauthenticatedError);
    childSession = await service.resolveIntake(secret);
    expect(childSession.assessmentId).toBe(childAssessmentId);
    await expect(service.resolveIntake("bukan-rahasia")).rejects.toThrow(UnauthenticatedError);
  });

  it("autosaves with revisions and rejects stale writes with a conflict", async () => {
    const first = await service.saveAssessment(db, childSession.organizationId, childAssessmentId, { revision: 1, answers: [{ itemId: "A01", kind: "emotion", state: "answered", assistance: "read_aloud", value: "sedih" }] }, participant(childSession));
    expect(first.revision).toBe(2);
    await expect(service.saveAssessment(db, childSession.organizationId, childAssessmentId, { revision: 1, answers: [] }, participant(childSession))).rejects.toThrow(ConflictError);
  });

  it("stores the A02 drawing privately and scopes it to its own session", async () => {
    const upload = await uploadMedia(childSession.organizationId, childAssessmentId, await png(), participant(childSession));
    attachmentId = upload.id;
    const response = await mediaContent(childSession.organizationId, attachmentId, childSession);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const guardian = await startSession(guardianAssessmentId);
    await expect(mediaContent(guardian.row.organizationId, attachmentId, guardian.row)).rejects.toThrow(NotFoundError);
    await expect(uploadMedia(guardian.row.organizationId, guardianAssessmentId, await png(), participant(guardian.row))).rejects.toThrow(ConflictError);
    await expect(mediaContent(outsider.organizationId, attachmentId)).rejects.toThrow(NotFoundError);
  });

  it("rejects incomplete submissions, then submits atomically and immutably", async () => {
    const partial: Answer[] = [
      { itemId: "A01", kind: "emotion", state: "answered", assistance: "read_aloud", value: "sedih" },
      { itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "canvas", initialAttachmentId: attachmentId },
    ];
    await expect(service.saveAssessment(db, childSession.organizationId, childAssessmentId, { revision: 2, answers: partial }, participant(childSession), true)).rejects.toThrow(ValidationError);
    const submitted = await service.saveAssessment(db, childSession.organizationId, childAssessmentId, { revision: 2, answers: [...partial, { itemId: "A03", kind: "text", state: "skipped", assistance: "none", value: null }] }, participant(childSession), true);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedBy).toBe(childSession.id);
    await expect(service.saveAssessment(db, childSession.organizationId, childAssessmentId, { revision: submitted.revision, answers: [] }, participant(childSession))).rejects.toThrow(ConflictError);
    await expect(db.update(assessments).set({ answersJson: "[]" }).where(eq(assessments.id, childAssessmentId))).rejects.toThrow();
    await expect(db.delete(assessments).where(eq(assessments.id, childAssessmentId))).rejects.toThrow();
  });

  it("lets the guardian complete W with skips and shows both results to staff only", async () => {
    const [session] = await db.select().from(intakeSessions).where(eq(intakeSessions.assessmentId, guardianAssessmentId));
    const answers: Answer[] = INSTRUMENTS.W.map((item, index) => item.kind === "likert"
      ? { itemId: item.id, kind: "likert", state: "answered", assistance: "none", value: (index % 5) + 1 }
      : item.sensitive ? { itemId: item.id, kind: "text", state: "skipped", assistance: "none", value: null }
        : { itemId: item.id, kind: "text", state: "answered", assistance: "none", value: `Jawaban fiktif ${item.id}` });
    const a = await service.assessment(db, session.organizationId, guardianAssessmentId);
    await service.saveAssessment(db, session.organizationId, guardianAssessmentId, { revision: a.revision, answers }, participant(session), true);

    const detail = await service.cycleDetail(pengasuh, cycleId);
    expect(detail.full.filter((row) => row.status === "submitted")).toHaveLength(2);
    const result = await service.resultDetail(pengasuh, childAssessmentId);
    expect(result.answers.map((answer) => answer.itemId)).toEqual(["A01", "A02", "A03"]);
    expect(result.media[0]?.storageKey).toBeUndefined();
    expect(service.participantWire(await service.assessment(db, session.organizationId, guardianAssessmentId), detail.cycle)).not.toHaveProperty("answers");
  });

  it("creates corrections as a new version and keeps the original", async () => {
    await expect(service.createAssessment(pengasuh, cycleId, { target: "child", parentAssessmentId: childAssessmentId })).rejects.toThrow(ValidationError);
    const correction = await service.createAssessment(pengasuh, cycleId, { target: "child", parentAssessmentId: childAssessmentId, correctionReason: "Pendamping salah mencatat bantuan" });
    expect(correction.status).toBe("draft");
    expect(correction.parentAssessmentId).toBe(childAssessmentId);
    expect(JSON.parse(correction.answersJson)).toHaveLength(3);
    expect((await service.assessment(db, correction.organizationId, childAssessmentId)).status).toBe("submitted");
  });
});

describe("session lifecycle", () => {
  it("stops a revoked session", async () => {
    const draft = await service.createAssessment(pengasuh, cycleId, { target: "guardian", guardianId, parentAssessmentId: guardianAssessmentId, correctionReason: "Wali ingin menambah jawaban" });
    const { created, secret } = await startSession(draft.id);
    await service.revokeSession(pengasuh, created.id, { reason: "Perangkat dikembalikan" });
    await expect(service.resolveIntake(secret)).rejects.toThrow(UnauthenticatedError);
  });

  it("stops an expired session and refuses its unused link", async () => {
    const correction = (await service.cycleDetail(pengasuh, cycleId)).full.find((row) => row.status === "draft" && row.target === "child");
    const created = await service.createIntakeSession(pengasuh, cycleId, { assessmentId: correction!.id });
    await db.update(intakeSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(intakeSessions.id, created.id));
    await expect(service.exchangeIntake(created.id, created.token, null)).rejects.toThrow(UnauthenticatedError);
  });

  it("requires the authority role for authority reviews and gates closed cycles", async () => {
    await expect(service.addAuthority(pengasuh, cycleId, { decision: "approved", lawfulBasisNote: "Dasar kewenangan uji coba" })).rejects.toThrow(PermissionDeniedError);
    await service.addAuthority(ketua, cycleId, { decision: "approved", lawfulBasisNote: "Dasar kewenangan uji coba" });
    await db.run(sql`update assessment_cycles set status = 'closed' where id = ${cycleId}`);
    await expect(db.run(sql`update assessment_cycles set module = 'B' where id = ${cycleId}`)).rejects.toThrow();
    await expect(service.createAssessment(pengasuh, cycleId, { target: "guardian", guardianId })).rejects.toThrow(ForbiddenError);
  });
});
