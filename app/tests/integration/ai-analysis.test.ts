import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { MOCK_SIMULATION_NOTICE } from "@/lib/ai/mock";
import { closeDb, getDbReady, type AppDatabase } from "@/lib/db";
import { aiAnalyses, aiJobs, aiReviews, aiUsageCounters } from "@/lib/db/ai-schema";
import { auditLogs } from "@/lib/db/domain-schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError, NotReadyError, RateLimitError, ValidationError } from "@/lib/errors";
import { INSTRUMENTS, type Answer, type Module } from "@/lib/instruments";
import { resolveFromProjectRoot } from "@/lib/paths";
import { PermissionDeniedError } from "@/lib/permissions";
import { ensureAiSettings, updateAiSettingsRow } from "@/server/repositories/ai-settings.repository";
import { createOrganization } from "@/server/repositories/organization.repository";
import * as ai from "@/server/services/ai.service";
import * as service from "@/server/services/assessment.service";
import { createStaffAccount, ensureStaffAccount, type StaffActor } from "@/server/services/staff.service";

let tempDir: string;
let db: AppDatabase;
let admin: StaffActor;
let pengasuh: StaffActor;
let ketua: StaffActor;
let psikolog: StaffActor;
let outsider: StaffActor;
let outsiderKetua: StaffActor;

let childId: string;
let guardianId: string;
let cycleId: string;
let childAssessmentId: string;
let guardianAssessmentId: string;
let firstAnalysisId: string;

const today = new Date().toISOString().slice(0, 10);
const key = () => crypto.randomUUID();

async function staff(organizationId: string, email: string, role: StaffActor["role"]): Promise<StaffActor> {
  const result = await ensureStaffAccount(db, { organizationId, email, name: `Staf ${role}`, password: "StafLokal2026!", role, actorLabel: "test" });
  return { membershipId: result.membershipId, authUserId: result.authUserId, organizationId, role };
}

/** Enables AI assistance the way the admin page would, without touching the service under test. */
async function enableAi(organizationId: string, patch: { enabled?: boolean; dailyLimit?: number } = {}): Promise<void> {
  const current = await ensureAiSettings(db, organizationId);
  await updateAiSettingsRow(db, { organizationId, expectedRevision: current.revision, patch: { enabled: true, dailyLimit: 20, mode: "mock", ...patch } });
}

/** Fills every item of a module so the assessment can be submitted. */
function fullAnswers(module: Module): Answer[] {
  return INSTRUMENTS[module].map((item, index) => {
    if (item.kind === "likert") return { itemId: item.id, kind: "likert", state: "answered", assistance: "none", value: (index % 5) + 1 };
    if (item.kind === "emotion") return { itemId: "A01", kind: "emotion", state: "answered", assistance: "none", value: "sedih" };
    if (item.kind === "media") return { itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "paper_pending", initialAttachmentId: null };
    return item.sensitive
      ? { itemId: item.id, kind: "text", state: "skipped", assistance: "none", value: null }
      : { itemId: item.id, kind: "text", state: "answered", assistance: "none", value: `Jawaban fiktif ${item.id}` };
  });
}

async function submitAssessment(assessmentId: string, module: Module): Promise<void> {
  const created = await service.createIntakeSession(pengasuh, cycleId, { assessmentId });
  const { secret } = await service.exchangeIntake(created.id, created.token, null);
  const row = await service.resolveIntake(secret);
  const current = await service.assessment(db, row.organizationId, assessmentId);
  await service.saveAssessment(db, row.organizationId, assessmentId, { revision: current.revision, answers: fullAnswers(module) }, { type: "participant", sessionId: row.id }, true);
}

async function verifiedProfile(kind: "children" | "guardians", input: Record<string, unknown>): Promise<string> {
  const profile = await service.createProfile(pengasuh, kind, { name: kind === "children" ? "Anak Fiktif" : "Wali Fiktif", fictional: true, ...input });
  await service.profileTransition(pengasuh, kind, profile.id, "verify", { revision: profile.revision });
  return profile.id;
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "panti-ai-"));
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
    LIVE_INTAKE_ENABLED: "true",
    BETTER_AUTH_SECRET: "d".repeat(48),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  resetEnvCacheForTests();
  db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });

  const home = await createOrganization(db, { name: "Panti AI", timezone: "Asia/Jakarta" });
  const other = await createOrganization(db, { name: "Panti Lain", timezone: "Asia/Jakarta" });
  admin = await staff(home.id, "admin@ai.test", "admin");
  pengasuh = await staff(home.id, "pengasuh@ai.test", "pengasuh");
  ketua = await staff(home.id, "ketua@ai.test", "ketua");
  outsider = await staff(other.id, "pengasuh@lain.test", "pengasuh");
  outsiderKetua = await staff(other.id, "ketua@lain.test", "ketua");
  // Both organizations have AI enabled, so an isolation test proves isolation
  // rather than accidentally hitting the "not configured" refusal.
  await enableAi(other.id);
  const created = await createStaffAccount(db, {
    actor: admin,
    input: { name: "Psikolog Uji", email: "psikolog@ai.test", password: "PsikologLokal2026!", role: "psikolog", credentialReference: "STR-9876543210", chairpersonConfirmation: true },
  });
  psikolog = { membershipId: created.membershipId, authUserId: created.authUserId, organizationId: home.id, role: "psikolog" };

  // A fictional cycle keeps this suite away from real children's data while
  // still exercising the full generate/review path.
  childId = await verifiedProfile("children", { estimatedAge: 15, ageReferenceDate: today, background: ["kehilangan_ayah"] });
  guardianId = await verifiedProfile("guardians", {});
  await service.linkGuardian(pengasuh, childId, { guardianId, relationship: "Nenek", isPrimary: true });
  cycleId = (await service.createCycle(pengasuh, childId)).id;
  childAssessmentId = (await service.createAssessment(pengasuh, cycleId, { target: "child" })).id;
  guardianAssessmentId = (await service.createAssessment(pengasuh, cycleId, { target: "guardian", guardianId })).id;
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("availability before anything is configured", () => {
  it("refuses to generate while the admin has not enabled AI", async () => {
    const availability = await ai.aiAvailability(pengasuh);
    expect(availability.ready).toBe(false);
    expect(availability.reason).toContain("belum diaktifkan");
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(NotReadyError);
  });

  it("reports mock mode as a simulation, so the UI can label it honestly", async () => {
    await enableAi(pengasuh.organizationId);
    const availability = await ai.aiAvailability(pengasuh);
    expect(availability).toMatchObject({ ready: true, reason: null, mode: "mock", simulated: true });
  });
});

describe("source validation", () => {
  it("refuses an assessment that has not been submitted yet", async () => {
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a source from another organization", async () => {
    await submitAssessment(childAssessmentId, "C");
    await submitAssessment(guardianAssessmentId, "W");
    await expect(
      ai.generateAnalysis(outsider, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a scope that does not match the sources", async () => {
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId, cycleId, scope: "guardian", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(ValidationError);
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [guardianAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an incomplete combined scope unless a leader accepts the gap in writing", async () => {
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId, cycleId, scope: "combined", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(ValidationError);
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId, cycleId, scope: "combined", sourceAssessmentIds: [childAssessmentId], allowPartial: true, partialReason: "Wali belum sempat mengisi minggu ini", idempotencyKey: key() }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("generation in mock mode", () => {
  it("stores a simulated result without making any outbound call", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("mock mode must not reach the network")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const detail = await ai.generateAnalysis(pengasuh, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() });
      firstAnalysisId = detail.analysis.id;
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(detail.analysis.resultOrigin).toBe("mock");
      expect(detail.analysis.simulated).toBe(true);
      expect(detail.analysis.model).toBeNull();
      expect(detail.analysis.result.limitations[0]).toBe(MOCK_SIMULATION_NOTICE);
      expect(detail.disposition).toBeNull();
      expect(detail.reviews).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cites the real assessment ids, not the pseudonymous aliases", async () => {
    const detail = await ai.analysisDetail(pengasuh, firstAnalysisId);
    const cited = detail.analysis.result.attentionIndicators.flatMap((indicator) => indicator.sourceAnswerRefs);
    expect(cited.length).toBeGreaterThan(0);
    for (const ref of cited) expect(ref.assessmentId).toBe(childAssessmentId);
    expect(detail.analysis.sourceAssessmentIds).toEqual([childAssessmentId]);
  });

  it("keeps names and internal person ids out of the stored snapshot", async () => {
    const [row] = await db.select().from(aiAnalyses).where(eq(aiAnalyses.id, firstAnalysisId));
    expect(row.snapshotJson).not.toContain("Anak Fiktif");
    expect(row.snapshotJson).not.toContain("Wali Fiktif");
    expect(row.snapshotJson).not.toContain(childId);
    expect(row.snapshotJson).toContain("ASS-1");
  });

  it("records the result in the audit trail without any answer text", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, firstAnalysisId));
    expect(rows.map((row) => row.action)).toContain("ai.analysis.create");
    expect(JSON.parse(rows[0].safeMetadata)).toMatchObject({ resultOrigin: "mock", scope: "child", sourceCount: 1 });
    expect(rows[0].safeMetadata).not.toContain("Jawaban fiktif");
  });

  it("never lets a stored result or review be edited or deleted", async () => {
    await expect(db.update(aiAnalyses).set({ resultJson: "{}" }).where(eq(aiAnalyses.id, firstAnalysisId))).rejects.toThrow();
    await expect(db.delete(aiAnalyses).where(eq(aiAnalyses.id, firstAnalysisId))).rejects.toThrow();
  });

  it("isolates the analysis from another organization", async () => {
    await expect(ai.analysisDetail(outsider, firstAnalysisId)).rejects.toThrow(NotFoundError);
    expect(await ai.listAnalysesForAssessment(outsider, childAssessmentId)).toHaveLength(0);
    expect(await ai.listAnalysesForAssessment(pengasuh, childAssessmentId)).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("returns the same analysis for a replayed key and creates nothing new", async () => {
    const replayKey = key();
    const payload = { childId, guardianId, cycleId, scope: "guardian" as const, sourceAssessmentIds: [guardianAssessmentId], idempotencyKey: replayKey };
    const first = await ai.generateAnalysis(pengasuh, payload);
    const second = await ai.generateAnalysis(pengasuh, payload);
    expect(second.analysis.id).toBe(first.analysis.id);
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(aiJobs).where(eq(aiJobs.idempotencyKey, replayKey));
    expect(Number(total)).toBe(1);
  });

  it("refuses to reuse one key for a different request", async () => {
    const reused = key();
    await ai.generateAnalysis(ketua, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], regenerateReason: "Pengulangan untuk uji idempotensi", idempotencyKey: reused });
    await expect(
      ai.generateAnalysis(ketua, { childId, guardianId, cycleId, scope: "guardian", sourceAssessmentIds: [guardianAssessmentId], regenerateReason: "Permintaan berbeda dengan kunci lama", idempotencyKey: reused }),
    ).rejects.toThrow(ConflictError);
  });

  it("closes an attempt whose lease expired instead of blocking the target forever", async () => {
    // A real attempt is run first, then forced back into a running state with an
    // expired lease: that is exactly what a crashed server leaves behind, and it
    // keeps the stored request hash genuine.
    const stuck = key();
    const payload = { childId, guardianId: null, cycleId, scope: "child" as const, sourceAssessmentIds: [childAssessmentId], regenerateReason: "Percobaan yang nanti dipaksa menggantung", idempotencyKey: stuck };
    await ai.generateAnalysis(ketua, payload);
    await db.update(aiJobs).set({ status: "running", analysisId: null, safeError: null, finishedAt: null, leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(aiJobs.idempotencyKey, stuck));
    await expect(ai.generateAnalysis(ketua, payload)).rejects.toThrow(ConflictError);
    const [row] = await db.select().from(aiJobs).where(eq(aiJobs.idempotencyKey, stuck));
    expect(row.status).toBe("failed");
    expect(row.safeError).toContain("berhenti tanpa hasil");
    expect(row.leaseExpiresAt).toBeNull();
  });
});

describe("regeneration", () => {
  it("requires the regenerate permission and a written reason once a result exists", async () => {
    await expect(
      ai.generateAnalysis(pengasuh, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      ai.generateAnalysis(ketua, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], idempotencyKey: key() }),
    ).rejects.toThrow(ValidationError);
  });

  it("adds a new version and keeps the earlier one readable", async () => {
    const again = await ai.generateAnalysis(ketua, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], regenerateReason: "Pengasuh melaporkan konteks baru minggu ini", idempotencyKey: key() });
    expect(again.analysis.id).not.toBe(firstAnalysisId);
    expect(again.analysis.generationReason).toContain("konteks baru");
    await expect(ai.analysisDetail(pengasuh, firstAnalysisId)).resolves.toMatchObject({ analysis: { id: firstAnalysisId } });
    const list = await ai.listAnalysesForAssessment(pengasuh, childAssessmentId);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
  });
});

describe("review", () => {
  it("refuses to approve a simulated result as real support", async () => {
    await expect(ai.reviewAnalysis(ketua, firstAnalysisId, { disposition: "support_approved", comment: "Terlihat masuk akal" })).rejects.toThrow(ForbiddenError);
  });

  it("lets a caregiver flag a result for revision but not decide it", async () => {
    const detail = await ai.reviewAnalysis(pengasuh, firstAnalysisId, { disposition: "needs_revision", comment: "Ada konteks yang belum terwakili." });
    expect(detail.disposition).toBe("needs_revision");
    expect(detail.reviews[0].simulated).toBe(true);
    await expect(ai.reviewAnalysis(pengasuh, firstAnalysisId, { disposition: "rejected", comment: "Menolak hasil ini" })).rejects.toThrow(PermissionDeniedError);
  });

  it("appends the psychologist decision on top without touching the earlier one", async () => {
    const detail = await ai.reviewAnalysis(psikolog, firstAnalysisId, { disposition: "rejected", comment: "Keluaran simulasi tidak dipakai untuk pendampingan." });
    expect(detail.disposition).toBe("rejected");
    expect(detail.reviews).toHaveLength(2);
    expect(detail.reviews[1].disposition).toBe("needs_revision");
    const [row] = await db.select().from(aiAnalyses).where(eq(aiAnalyses.id, firstAnalysisId));
    expect(JSON.parse(row.resultJson).limitations[0]).toBe(MOCK_SIMULATION_NOTICE);
    await expect(db.update(aiReviews).set({ comment: "diubah" }).where(eq(aiReviews.analysisId, firstAnalysisId))).rejects.toThrow();
  });

  it("requires a comment and refuses an unknown disposition", async () => {
    await expect(ai.reviewAnalysis(ketua, firstAnalysisId, { disposition: "rejected", comment: "x" })).rejects.toThrow(ZodError);
    await expect(ai.reviewAnalysis(ketua, firstAnalysisId, { disposition: "diarsipkan", comment: "Catatan cukup panjang" })).rejects.toThrow(ZodError);
  });

  it("refuses a review from another organization", async () => {
    await expect(ai.reviewAnalysis(outsiderKetua, firstAnalysisId, { disposition: "rejected", comment: "Bukan panti ini" })).rejects.toThrow(NotFoundError);
  });
});

describe("AI consent on real data", () => {
  it("refuses to send a real child's answers until the separate AI consent is granted", async () => {
    // The whole lawful chain is built first, so the only thing missing when the
    // refusal happens is the AI consent itself.
    const child = await service.createProfile(pengasuh, "children", { name: "Anak Nyata", fictional: false, estimatedAge: 14, ageReferenceDate: today, background: ["kehilangan_ayah"] });
    await service.profileTransition(pengasuh, "children", child.id, "verify", { revision: child.revision });
    const realCycleId = (await service.createCycle(pengasuh, child.id)).id;

    const overview = await service.instrumentOverview(psikolog);
    await service.instrumentDecision(psikolog, "approvals", { contentHash: overview.contentHash, note: "Instrumen ditinjau untuk uji integrasi" });
    await service.addAuthority(ketua, realCycleId, { decision: "approved", lawfulBasisNote: "Dasar kewenangan tercatat pada berkas" });
    const consent = { noticeVersion: "test-v1", authorityBasis: "Surat kuasa pengasuhan", status: "granted" as const };
    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "intake", actorType: "authorized_representative" });
    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "assent", actorType: "child" });

    const realAssessmentId = (await service.createAssessment(pengasuh, realCycleId, { target: "child" })).id;
    const created = await service.createIntakeSession(pengasuh, realCycleId, { assessmentId: realAssessmentId });
    const { secret } = await service.exchangeIntake(created.id, created.token, null);
    const row = await service.resolveIntake(secret);
    const current = await service.assessment(db, row.organizationId, realAssessmentId);
    await service.saveAssessment(db, row.organizationId, realAssessmentId, { revision: current.revision, answers: fullAnswers("C") }, { type: "participant", sessionId: row.id }, true);

    const payload = { childId: child.id, guardianId: null, cycleId: realCycleId, scope: "child" as const, sourceAssessmentIds: [realAssessmentId] };
    await enableAi(pengasuh.organizationId, { dailyLimit: 50 });
    await expect(ai.generateAnalysis(pengasuh, { ...payload, idempotencyKey: key() })).rejects.toThrow(ForbiddenError);

    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "ai", actorType: "authorized_representative" });
    const detail = await ai.generateAnalysis(pengasuh, { ...payload, idempotencyKey: key() });
    expect(detail.analysis.resultOrigin).toBe("mock");

    // A withdrawal is recorded as a newer consent row and must block the next run.
    await service.addConsent(pengasuh, realCycleId, { ...consent, status: "withdrawn", subjectType: "child", subjectId: child.id, type: "ai", actorType: "authorized_representative" });
    await expect(ai.generateAnalysis(ketua, { ...payload, regenerateReason: "Mencoba setelah persetujuan ditarik", idempotencyKey: key() })).rejects.toThrow(ForbiddenError);
  });
});

describe("daily quota", () => {
  it("counts every settled attempt and refuses the request past the limit", async () => {
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [counter] = await db.select().from(aiUsageCounters).where(and(eq(aiUsageCounters.organizationId, ketua.organizationId), eq(aiUsageCounters.dateKey, dateKey)));
    expect(counter.requestCount).toBeGreaterThan(0);
    expect(counter.mockCount).toBe(counter.requestCount);
    expect(counter.reservedCount).toBe(0);

    await enableAi(ketua.organizationId, { dailyLimit: counter.requestCount });
    await expect(
      ai.generateAnalysis(ketua, { childId, guardianId: null, cycleId, scope: "child", sourceAssessmentIds: [childAssessmentId], regenerateReason: "Percobaan melewati kuota harian", idempotencyKey: key() }),
    ).rejects.toThrow(RateLimitError);
    const availability = await ai.aiAvailability(ketua);
    expect(availability.ready).toBe(false);
    expect(availability.reason).toContain("Kuota harian");
  });
});
