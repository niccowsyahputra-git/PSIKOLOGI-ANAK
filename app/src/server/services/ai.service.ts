import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { callLocalModel, LocalModelError } from "@/lib/ai/local-model";
import { MOCK_PROVIDER, runMockAnalysis } from "@/lib/ai/mock";
import { parseAiResult, type AiResult } from "@/lib/ai/result.schema";
import { buildSnapshot, resolveRefs, type SourceAssessment } from "@/lib/ai/snapshot";
import { openSecret, sha256Hex } from "@/lib/crypto";
import { getDbReady, type AppDatabase } from "@/lib/db";
import * as ai from "@/lib/db/ai-schema";
import * as s from "@/lib/db/assessment-schema";
import { user } from "@/lib/db/auth-schema";
import { organizations, staffMemberships } from "@/lib/db/domain-schema";
import { getEnv } from "@/lib/env";
import { DomainError, ConflictError, ForbiddenError, NotFoundError, NotReadyError, RateLimitError, ValidationError } from "@/lib/errors";
import type { Answer, Module } from "@/lib/instruments";
import { assertCan, can } from "@/lib/permissions";
import { aiJobInput, aiReviewInput } from "@/lib/validation/ai.schema";
import { ensureAiSettings, type AiSettingsRow } from "@/server/repositories/ai-settings.repository";
import { activeActor, assertGate, consentGranted, cycle, linkedGuardian, person } from "./assessment.service";
import { recordAudit } from "./audit.service";
import type { StaffActor } from "./staff.service";

/**
 * AI assistance workflow (PRD section 11, FR-11/FR-12). Three invariants shape
 * this file: a stored result is never edited, a mock result can never be
 * approved as real support, and the provider is called exactly once per job.
 */
type Executor = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;
type Scope = "child" | "guardian" | "combined";

/** A crashed generation must not block the target forever (PRD section 11.3). */
const LEASE_MS = 180_000;

const audit = (db: Executor, actor: StaffActor, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) =>
  recordAudit(db, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action, entityType, entityId, metadata });

export type AnalysisView = {
  id: string;
  scope: Scope;
  childId: string;
  guardianId: string | null;
  cycleId: string;
  sourceAssessmentIds: string[];
  result: AiResult;
  resultOrigin: ai.AiAnalysisRow["resultOrigin"];
  simulated: boolean;
  provider: string;
  model: string | null;
  promptVersion: string;
  generationReason: string | null;
  generatedBy: string;
  generatedByName: string | null;
  createdAt: Date;
};

export type ReviewView = {
  id: string;
  disposition: ai.AiReviewRow["disposition"];
  simulated: boolean;
  comment: string;
  reviewerId: string;
  reviewerName: string | null;
  createdAt: Date;
};

export type AnalysisDetail = {
  analysis: AnalysisView;
  reviews: ReviewView[];
  /** Latest authorized disposition, or null while nobody has reviewed yet. */
  disposition: ai.AiReviewRow["disposition"] | null;
};

function toAnalysisView(row: ai.AiAnalysisRow, generatedByName: string | null): AnalysisView {
  return {
    id: row.id,
    scope: row.scope,
    childId: row.childId,
    guardianId: row.guardianId,
    cycleId: row.cycleId,
    sourceAssessmentIds: JSON.parse(row.sourceAssessmentIds) as string[],
    result: JSON.parse(row.resultJson) as AiResult,
    resultOrigin: row.resultOrigin,
    simulated: row.resultOrigin === "mock",
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    generationReason: row.generationReason,
    generatedBy: row.generatedBy,
    generatedByName,
    createdAt: row.createdAt,
  };
}

/** Calendar day in the organization timezone, so a quota resets when staff expect. */
export function todayKey(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function organizationTimezone(db: Executor, organizationId: string): Promise<string> {
  const [row] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId));
  if (!row) throw new NotFoundError("Panti tidak ditemukan pada instalasi ini");
  return row.timezone;
}

export async function staffName(db: Executor, membershipId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name }).from(staffMemberships).innerJoin(user, eq(user.id, staffMemberships.authUserId)).where(eq(staffMemberships.id, membershipId));
  return row?.name ?? null;
}

/**
 * Reserves one slot inside the same transaction that creates the job, so two
 * concurrent requests can never both pass the daily limit (BR-16). Shared with
 * the discussion assistant, which spends the same daily budget.
 */
export async function reserveQuota(tx: Executor, organizationId: string, dateKey: string, dailyLimit: number): Promise<void> {
  await tx.insert(ai.aiUsageCounters).values({ organizationId, dateKey }).onConflictDoNothing();
  const [row] = await tx.select().from(ai.aiUsageCounters).where(and(eq(ai.aiUsageCounters.organizationId, organizationId), eq(ai.aiUsageCounters.dateKey, dateKey)));
  if (!row) throw new ConflictError("Penghitung kuota harian tidak dapat dibaca");
  if (row.requestCount + row.reservedCount >= dailyLimit) {
    throw new RateLimitError(`Kuota AI hari ini sudah terpakai (${dailyLimit} permintaan). Coba lagi besok atau naikkan batas di Konfigurasi AI.`);
  }
  await tx.update(ai.aiUsageCounters).set({ reservedCount: sql`${ai.aiUsageCounters.reservedCount} + 1` }).where(eq(ai.aiUsageCounters.id, row.id));
}

/**
 * Releases the reservation and records the attempt. A failed attempt still
 * counts, because it already consumed local provider capacity.
 */
export async function settleQuota(tx: Executor, organizationId: string, dateKey: string, mock: boolean): Promise<void> {
  await tx
    .update(ai.aiUsageCounters)
    .set({
      reservedCount: sql`max(${ai.aiUsageCounters.reservedCount} - 1, 0)`,
      requestCount: sql`${ai.aiUsageCounters.requestCount} + 1`,
      ...(mock ? { mockCount: sql`${ai.aiUsageCounters.mockCount} + 1` } : {}),
    })
    .where(and(eq(ai.aiUsageCounters.organizationId, organizationId), eq(ai.aiUsageCounters.dateKey, dateKey)));
}

/** Translates alias references back to real assessment ids before storing. */
function materializeRefs(result: AiResult, aliasToAssessmentId: ReadonlyMap<string, string>): AiResult {
  return {
    ...result,
    attentionIndicators: result.attentionIndicators.map((indicator) => ({ ...indicator, sourceAnswerRefs: resolveRefs(indicator.sourceAnswerRefs, aliasToAssessmentId) })),
    safetyConcern: { ...result.safetyConcern, sourceAnswerRefs: resolveRefs(result.safetyConcern.sourceAnswerRefs, aliasToAssessmentId) },
  };
}

/** Only sanitized text reaches the stored row; driver and network details stay in the log. */
export function safeErrorOf(error: unknown): string {
  if (error instanceof LocalModelError || error instanceof DomainError) return error.message;
  return "Permintaan AI gagal karena kesalahan tak terduga di server lokal. Periksa log server.";
}

function scopeFilter(organizationId: string, childId: string, cycleId: string, scope: Scope, guardianId: string | null) {
  return and(
    eq(ai.aiAnalyses.organizationId, organizationId),
    eq(ai.aiAnalyses.childId, childId),
    eq(ai.aiAnalyses.cycleId, cycleId),
    eq(ai.aiAnalyses.scope, scope),
    guardianId ? eq(ai.aiAnalyses.guardianId, guardianId) : isNull(ai.aiAnalyses.guardianId),
  );
}

export async function analysisDetail(actor: StaffActor, id: string): Promise<AnalysisDetail> {
  assertCan(actor.role, "assessment.internal.read");
  const db = await getDbReady();
  await activeActor(db, actor);
  const [row] = await db.select().from(ai.aiAnalyses).where(and(eq(ai.aiAnalyses.organizationId, actor.organizationId), eq(ai.aiAnalyses.id, id)));
  if (!row) throw new NotFoundError("Analisis tidak ditemukan");
  const reviewRows = await db
    .select({ review: ai.aiReviews, reviewerName: user.name })
    .from(ai.aiReviews)
    .leftJoin(staffMemberships, eq(staffMemberships.id, ai.aiReviews.reviewerId))
    .leftJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(eq(ai.aiReviews.analysisId, id))
    .orderBy(desc(ai.aiReviews.createdAt), desc(ai.aiReviews.id));
  const reviews: ReviewView[] = reviewRows.map(({ review, reviewerName }) => ({
    id: review.id,
    disposition: review.disposition,
    simulated: review.simulated,
    comment: review.comment,
    reviewerId: review.reviewerId,
    reviewerName,
    createdAt: review.createdAt,
  }));
  return { analysis: toAnalysisView(row, await staffName(db, row.generatedBy)), reviews, disposition: reviews[0]?.disposition ?? null };
}

/** Analyses attached to one assessment, newest first, for the result page card. */
export async function listAnalysesForAssessment(actor: StaffActor, assessmentId: string): Promise<AnalysisView[]> {
  assertCan(actor.role, "assessment.internal.read");
  const db = await getDbReady();
  await activeActor(db, actor);
  const rows = await db
    .select({ analysis: ai.aiAnalyses, generatedByName: user.name })
    .from(ai.aiAnalyses)
    .leftJoin(staffMemberships, eq(staffMemberships.id, ai.aiAnalyses.generatedBy))
    .leftJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(and(eq(ai.aiAnalyses.organizationId, actor.organizationId), sql`instr(${ai.aiAnalyses.sourceAssessmentIds}, ${assessmentId}) > 0`))
    .orderBy(desc(ai.aiAnalyses.createdAt), desc(ai.aiAnalyses.id))
    .limit(25);
  return rows.map(({ analysis, generatedByName }) => toAnalysisView(analysis, generatedByName));
}

/** Latest failed job for a target, so the page can show an honest error instead of silence. */
export async function lastFailedJob(actor: StaffActor, cycleId: string): Promise<{ safeError: string; finishedAt: Date | null } | null> {
  const db = await getDbReady();
  const [row] = await db
    .select({ safeError: ai.aiJobs.safeError, finishedAt: ai.aiJobs.finishedAt })
    .from(ai.aiJobs)
    .where(and(eq(ai.aiJobs.organizationId, actor.organizationId), eq(ai.aiJobs.cycleId, cycleId), eq(ai.aiJobs.status, "failed")))
    .orderBy(desc(ai.aiJobs.startedAt), desc(ai.aiJobs.id))
    .limit(1);
  return row?.safeError ? { safeError: row.safeError, finishedAt: row.finishedAt } : null;
}

/** Availability for the UI, so the button explains itself instead of failing on click. */
export async function aiAvailability(actor: StaffActor): Promise<{ ready: boolean; reason: string | null; mode: AiSettingsRow["mode"]; simulated: boolean; dailyLimit: number; usedToday: number }> {
  const db = await getDbReady();
  const settings = await ensureAiSettings(db, actor.organizationId);
  const dateKey = todayKey(await organizationTimezone(db, actor.organizationId));
  const [counter] = await db.select().from(ai.aiUsageCounters).where(and(eq(ai.aiUsageCounters.organizationId, actor.organizationId), eq(ai.aiUsageCounters.dateKey, dateKey)));
  const usedToday = (counter?.requestCount ?? 0) + (counter?.reservedCount ?? 0);
  const reason = !settings.enabled
    ? "Bantuan AI belum diaktifkan admin di halaman Konfigurasi AI."
    : settings.mode === "remote_endpoint"
      ? "Provider jarak jauh ditolak kebijakan local-only instalasi ini."
      : usedToday >= settings.dailyLimit
        ? `Kuota harian ${settings.dailyLimit} permintaan sudah terpakai.`
        : null;
  return { ready: reason === null, reason, mode: settings.mode, simulated: settings.mode === "mock", dailyLimit: settings.dailyLimit, usedToday };
}

/**
 * Runs one bounded generation. The provider call happens outside any database
 * transaction, so a slow local model never holds a write lock on the SQLite
 * file; the job row carries the lease that makes the attempt visible meanwhile.
 */
export async function generateAnalysis(actor: StaffActor, input: unknown): Promise<AnalysisDetail> {
  const data = aiJobInput.parse(input);
  const db = await getDbReady();
  await activeActor(db, actor);

  const settings = await ensureAiSettings(db, actor.organizationId);
  if (!settings.enabled) throw new NotReadyError("Bantuan AI belum diaktifkan. Admin perlu menyimpan dan menguji konfigurasi di halaman Konfigurasi AI.");
  if (settings.mode === "remote_endpoint") throw new ForbiddenError("Provider jarak jauh ditolak kebijakan local-only instalasi ini");

  // A replayed POST must never call the provider twice (BR-15).
  const [replay] = await db.select().from(ai.aiJobs).where(and(eq(ai.aiJobs.organizationId, actor.organizationId), eq(ai.aiJobs.idempotencyKey, data.idempotencyKey)));
  if (replay) {
    const requestHash = requestHashOf(data);
    if (replay.requestHash !== requestHash) throw new ConflictError("Kunci idempotensi ini sudah dipakai untuk permintaan yang berbeda");
    if (replay.status === "succeeded" && replay.analysisId) return analysisDetail(actor, replay.analysisId);
    if (replay.status === "failed") throw new ConflictError(replay.safeError ?? "Permintaan sebelumnya dengan kunci ini sudah gagal; gunakan kunci baru untuk mencoba lagi");
    if ((replay.leaseExpiresAt?.getTime() ?? 0) > Date.now()) throw new ConflictError("Analisis untuk permintaan ini sedang berjalan");
    // The lease expired without an outcome, so the attempt is closed honestly
    // rather than left running forever.
    await db.transaction(async (tx) => {
      await tx.update(ai.aiJobs).set({ status: "failed", safeError: "Analisis sebelumnya berhenti tanpa hasil (server berhenti saat proses). Coba lagi.", finishedAt: new Date(), leaseExpiresAt: null }).where(and(eq(ai.aiJobs.id, replay.id), eq(ai.aiJobs.status, replay.status)));
      await settleQuota(tx, actor.organizationId, todayKey(await organizationTimezone(tx, actor.organizationId)), settings.mode === "mock");
      await audit(tx, actor, "ai.job.expire", "ai_jobs", replay.id, { jobStatus: "failed" });
    });
    throw new ConflictError("Analisis sebelumnya berhenti tanpa hasil; kirim ulang dengan kunci baru");
  }

  const c = await cycle(db, actor.organizationId, data.cycleId);
  if (c.childId !== data.childId) throw new NotFoundError("Siklus tidak sesuai anak yang dipilih");
  await person(db, actor.organizationId, "children", data.childId);
  const link = data.guardianId ? await linkedGuardian(db, actor.organizationId, data.childId, data.guardianId) : null;

  const [{ total: priorCount }] = await db.select({ total: count() }).from(ai.aiAnalyses).where(scopeFilter(actor.organizationId, data.childId, data.cycleId, data.scope, data.guardianId));
  if (priorCount > 0) {
    assertCan(actor.role, "ai.regenerate");
    if (!data.regenerateReason) throw new ValidationError("Analisis ulang memerlukan alasan", { regenerateReason: ["Tuliskan alasan analisis ulang minimal 10 karakter"] });
  } else {
    assertCan(actor.role, "ai.generate.first");
  }

  const uniqueIds = [...new Set(data.sourceAssessmentIds)];
  const rows = await db.select().from(s.assessments).where(and(eq(s.assessments.organizationId, actor.organizationId), inArray(s.assessments.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) throw new NotFoundError("Sebagian asesmen sumber tidak ditemukan pada panti ini");
  for (const row of rows) {
    if (row.cycleId !== data.cycleId) throw new ValidationError("Semua sumber harus berasal dari siklus yang sama");
    if (row.status !== "submitted") throw new ValidationError("Hanya asesmen yang sudah terkirim dapat dianalisis");
  }

  const childSources = rows.filter((row) => row.target === "child");
  const guardianSources = rows.filter((row) => row.target === "guardian");
  if (data.scope === "child" && guardianSources.length > 0) throw new ValidationError("Lingkup anak tidak boleh memuat asesmen wali");
  if (data.scope === "guardian" && childSources.length > 0) throw new ValidationError("Lingkup wali tidak boleh memuat asesmen anak");
  if (guardianSources.some((row) => row.guardianId !== data.guardianId)) throw new ValidationError("Asesmen wali tidak sesuai wali yang dipilih");
  const missing = (data.scope === "guardian" ? guardianSources.length === 0 : data.scope === "child" ? childSources.length === 0 : childSources.length === 0 || guardianSources.length === 0);
  if (missing) {
    if (!data.allowPartial) throw new ValidationError("Sumber untuk lingkup ini belum lengkap. Lengkapi asesmen atau jalankan mode sebagian dengan alasan.");
    // Deciding to analyse an incomplete picture is a judgement call, so it is
    // reserved for the leader or the psychologist (PRD section 12.2).
    if (!can(actor.role, "ai.review.decide")) throw new ForbiddenError("Hanya ketua atau psikolog dapat menjalankan analisis dengan sumber tidak lengkap");
  }

  if (childSources.length > 0) await assertGate(db, c, "child");
  if (guardianSources.length > 0) await assertGate(db, c, "guardian", data.guardianId);

  // FR-11: every subject whose answers are sent must have granted the separate
  // AI consent. Mock mode sends nothing outbound, but the requirement is kept
  // for real data in every mode so staff never learn to skip the conversation.
  if (!c.fictional) {
    if (childSources.length > 0 && !(await consentGranted(db, c.id, c.childId, "ai"))) throw new ForbiddenError("Persetujuan penggunaan AI untuk data anak belum diberikan atau sudah ditarik");
    if (guardianSources.length > 0 && data.guardianId && !(await consentGranted(db, c.id, data.guardianId, "ai"))) throw new ForbiddenError("Persetujuan penggunaan AI dari wali untuk datanya sendiri belum diberikan");
  }

  const sources: SourceAssessment[] = rows.map((row) => ({
    id: row.id,
    target: row.target,
    module: row.module as Module,
    guardianId: row.guardianId,
    respondentType: row.respondentType,
    submittedAt: row.submittedAt,
    answers: JSON.parse(row.answersJson) as Answer[],
  }));
  const bundle = buildSnapshot({
    scope: data.scope,
    ageAtStart: c.ageAtStart,
    ageIsEstimated: c.ageIsEstimated,
    module: c.module as Module,
    cycleKind: c.kind,
    partial: data.allowPartial,
    partialReason: data.partialReason,
    guardianRelationships: link ? [link.relationship] : [],
    sources,
  });

  const timezone = await organizationTimezone(db, actor.organizationId);
  const dateKey = todayKey(timezone);
  const jobId = randomUUID();
  const mock = settings.mode === "mock";
  await db.transaction(async (tx) => {
    await reserveQuota(tx, actor.organizationId, dateKey, settings.dailyLimit);
    await tx.insert(ai.aiJobs).values({
      id: jobId,
      organizationId: actor.organizationId,
      scope: data.scope,
      childId: data.childId,
      guardianId: data.guardianId,
      cycleId: data.cycleId,
      idempotencyKey: data.idempotencyKey,
      inputHash: bundle.inputHash,
      requestHash: requestHashOf(data),
      settingsVersion: settings.settingsVersion,
      status: "running",
      generatedBy: actor.membershipId,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    });
    await audit(tx, actor, "ai.job.start", "ai_jobs", jobId, { scope: data.scope, aiMode: settings.mode, sourceCount: rows.length, partialState: data.allowPartial ? "partial" : "complete" });
  });

  let result: AiResult;
  try {
    const raw = mock
      ? runMockAnalysis(bundle.snapshot)
      : await callLocalModel(
          { baseUrl: settings.baseUrl, model: settings.model, extension: settings.extension, temperature: settings.temperature, maxTokens: settings.maxTokens, timeoutSeconds: settings.timeoutSeconds },
          bundle.snapshot,
          settings.keyCiphertext ? openSecret(settings.keyCiphertext) : null,
          getEnv().ai.allowedEndpointOrigins,
        );
    // The simulation passes the same schema and policy checks as a real model,
    // so the contract is proven by the mock path too.
    result = parseAiResult(raw, bundle.allowedRefs);
  } catch (error) {
    const safeError = safeErrorOf(error);
    await db.transaction(async (tx) => {
      await tx.update(ai.aiJobs).set({ status: "failed", safeError, finishedAt: new Date(), leaseExpiresAt: null }).where(eq(ai.aiJobs.id, jobId));
      await settleQuota(tx, actor.organizationId, dateKey, mock);
      await audit(tx, actor, "ai.job.fail", "ai_jobs", jobId, { scope: data.scope, aiMode: settings.mode, jobStatus: "failed" });
    });
    throw error;
  }

  const analysisId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(ai.aiAnalyses).values({
      id: analysisId,
      organizationId: actor.organizationId,
      scope: data.scope,
      childId: data.childId,
      guardianId: data.guardianId,
      cycleId: data.cycleId,
      sourceAssessmentIds: JSON.stringify([...uniqueIds].sort()),
      snapshotJson: JSON.stringify(bundle.snapshot),
      resultJson: JSON.stringify(materializeRefs(result, bundle.aliasToAssessmentId)),
      resultOrigin: mock ? "mock" : "local_model",
      inputHash: bundle.inputHash,
      provider: mock ? MOCK_PROVIDER : settings.providerName,
      model: mock ? null : settings.model,
      promptVersion: settings.promptVersion,
      settingsVersion: settings.settingsVersion,
      generatedBy: actor.membershipId,
      generationReason: data.regenerateReason ?? data.partialReason,
    });
    await tx.update(ai.aiJobs).set({ status: "succeeded", analysisId, finishedAt: new Date(), leaseExpiresAt: null }).where(eq(ai.aiJobs.id, jobId));
    await settleQuota(tx, actor.organizationId, dateKey, mock);
    await audit(tx, actor, "ai.analysis.create", "ai_analyses", analysisId, { scope: data.scope, resultOrigin: mock ? "mock" : "local_model", sourceCount: rows.length, jobId });
  });

  return analysisDetail(actor, analysisId);
}

/** Stable hash of the request payload, used to detect idempotency key reuse. */
function requestHashOf(data: ReturnType<typeof aiJobInput.parse>): string {
  return sha256Hex(
    JSON.stringify({
      childId: data.childId,
      guardianId: data.guardianId,
      cycleId: data.cycleId,
      scope: data.scope,
      sourceAssessmentIds: [...new Set(data.sourceAssessmentIds)].sort(),
      allowPartial: data.allowPartial,
    }),
  );
}

/**
 * Appends a review event (FR-12). The result row is never touched, so the
 * history keeps both what the engine produced and what the human decided.
 */
export async function reviewAnalysis(actor: StaffActor, analysisId: string, input: unknown): Promise<AnalysisDetail> {
  const data = aiReviewInput.parse(input);
  assertCan(actor.role, data.disposition === "needs_revision" ? "ai.mark_needs_revision" : "ai.review.decide");
  const db = await getDbReady();
  await db.transaction(async (tx) => {
    await activeActor(tx, actor);
    const [row] = await tx.select().from(ai.aiAnalyses).where(and(eq(ai.aiAnalyses.organizationId, actor.organizationId), eq(ai.aiAnalyses.id, analysisId)));
    if (!row) throw new NotFoundError("Analisis tidak ditemukan");
    const simulated = row.resultOrigin === "mock";
    // BR-26: approving a simulation as real support would teach staff to trust
    // output that never came from an analysis at all.
    if (simulated && data.disposition === "support_approved") {
      throw new ForbiddenError("Hasil simulasi tidak dapat disetujui sebagai dukungan nyata. Jalankan ulang dengan model nyata setelah admin mengaktifkannya.");
    }
    if (data.disposition === "support_approved") {
      const [staff] = await tx.select().from(staffMemberships).where(eq(staffMemberships.id, actor.membershipId));
      if (actor.role === "psikolog" && !staff?.credentialVerifiedAt) throw new ForbiddenError("Kredensial psikolog belum diverifikasi");
    }
    const id = randomUUID();
    await tx.insert(ai.aiReviews).values({ id, organizationId: actor.organizationId, analysisId, reviewerId: actor.membershipId, disposition: data.disposition, simulated, comment: data.comment });
    await audit(tx, actor, "ai.review.record", "ai_reviews", id, { reviewAction: data.disposition, analysisId, simulatedResult: simulated ? "mock" : "real" });
  });
  return analysisDetail(actor, analysisId);
}
