import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import { getDbReady } from "@/lib/db";
import { aiSettings } from "@/lib/db/domain-schema";
import { templateVersions } from "@/lib/db/template-schema";
import { aiQuestionJobs as jobs, aiQuestionCandidates as candidates, aiQuestionDecisions as decisions } from "@/lib/db/question-ai-schema";
import { aiConfigFingerprint } from "@/lib/ai/config";
import { callQuestionModel } from "@/lib/ai/question-generator";
import { QUESTION_PROMPT_VERSION, QUESTION_SCHEMA_VERSION, hasExecutableText, materializeCandidates, mockQuestionOutput, parseQuestionOutput, type DefinitionSource, type QuestionGenerationInput } from "@/lib/assessment-builder/ai-output";
import { assertRuleBudget, compileDefinition, questionSchema, type Definition, type Question } from "@/lib/assessment-builder/definition";
import { openSecret, sha256Hex } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError, NotReadyError, RateLimitError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { ensureAiSettings } from "../repositories/ai-settings.repository";
import { activeActor } from "./assessment.service";
import { reserveQuota, settleQuota, todayKey, organizationTimezone } from "./ai.service";
import { recordAudit } from "./audit.service";
import { loadVersion, readDefinition, saveDraftInTransaction, type TemplateExecutor } from "./template.service";
import type { StaffActor } from "./staff.service";
const generationSchema = z.object({ revision: z.number().int().positive(), idempotencyKey: z.uuid(), instructions: z.string().trim().min(5).max(4000), target: z.enum(["child", "guardian", "both"]), count: z.number().int().min(1).max(20), sources: z.array(z.object({ versionId: z.uuid(), questionId: z.uuid() }).strict()).max(20) }).strict();
const audit = (tx: TemplateExecutor, actor: StaffActor, action: string, id: string) => recordAudit(tx, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action: `question_ai.${action}`, entityType: "ai_question_jobs", entityId: id });
const hash = (input: unknown) => sha256Hex(JSON.stringify(input));
type Job = typeof jobs.$inferSelect;
function assertSettings(settings: typeof aiSettings.$inferSelect) {
  if (!settings.enabled) throw new NotReadyError("Aktifkan dan uji konfigurasi AI terlebih dahulu.");
  if (settings.mode === "remote_endpoint") throw new ForbiddenError("Hanya model lokal / simulasi diizinkan.");
  if (settings.mode !== "mock" && (settings.lastTestStatus !== "passed" || settings.lastTestFingerprint !== aiConfigFingerprint(settings))) throw new NotReadyError("Konfigurasi model lokal harus lulus uji yang sesuai konfigurasi saat ini.");
}
async function expireJobs(tx: TemplateExecutor, actor: StaffActor) {
  const expired = await tx.update(jobs).set({ status: "failed", safeError: "Proses terhenti tanpa hasil. Buat permintaan baru untuk mencoba lagi.", finishedAt: new Date(), leaseExpiresAt: null }).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.status, "running"), lte(jobs.leaseExpiresAt, new Date()))).returning();
  for (const job of expired) { await settleQuota(tx, actor.organizationId, job.quotaDate, job.origin === "mock"); await audit(tx, actor, "expire", job.id); }
}
async function findJob(tx: TemplateExecutor, actor: StaffActor, id: string): Promise<Job> {
  const [row] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.id, id)));
  if (!row) throw new NotFoundError(); return row;
}
export async function questionJobDetail(actor: StaffActor, id: string) {
  assertCan(actor.role, "form.draft.read"); const db = await getDbReady(); await activeActor(db, actor);
  await db.transaction((tx) => expireJobs(tx, actor));
  const job = await findJob(db, actor, id);
  const rows = await db.select({ candidate: candidates, decision: decisions }).from(candidates).leftJoin(decisions, eq(decisions.candidateId, candidates.id)).where(eq(candidates.jobId, id)).orderBy(asc(candidates.position));
  return { job: { id: job.id, versionId: job.versionId, revision: job.revision, status: job.status, origin: job.origin, model: job.model, promptVersion: job.promptVersion, schemaVersion: job.schemaVersion, startedAt: job.startedAt, safeError: job.safeError, input: JSON.parse(job.inputJson) as QuestionGenerationInput, warnings: JSON.parse(job.warningsJson ?? "[]") as string[] }, candidates: rows.map(({ candidate: c, decision }) => ({ id: c.id, question: JSON.parse(c.questionJson) as Question, section: JSON.parse(c.sectionJson) as Definition["sections"][number], original: JSON.parse(c.originalJson) as unknown, warnings: JSON.parse(c.warningsJson) as string[], decision })) };
}
export async function listQuestionJobs(actor: StaffActor, versionId: string) {
  assertCan(actor.role, "form.draft.read"); const db = await getDbReady(); await activeActor(db, actor); await loadVersion(db, actor.organizationId, versionId);
  await db.transaction((tx) => expireJobs(tx, actor));
  return db.select({ id: jobs.id, status: jobs.status, origin: jobs.origin, startedAt: jobs.startedAt }).from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.versionId, versionId))).orderBy(desc(jobs.startedAt), desc(jobs.id)).limit(100);
}
export async function generateQuestionDrafts(actor: StaffActor, versionId: string, input: unknown) {
  assertCan(actor.role, "form.ai"); const data = generationSchema.parse(input); const db = await getDbReady(); await activeActor(db, actor);
  await ensureAiSettings(db, actor.organizationId);
  const requestHash = hash({ versionId, ...data });
  await db.transaction((tx) => expireJobs(tx, actor));
  const prepared = await db.transaction(async (tx) => {
    await activeActor(tx, actor);
    const [replay] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.idempotencyKey, data.idempotencyKey)));
    if (replay) { if (replay.requestHash !== requestHash) throw new ConflictError("Kunci idempotensi telah digunakan untuk permintaan berbeda."); return { kind: "replay", id: replay.id } as const; }
    const version = await loadVersion(tx, actor.organizationId, versionId);
    if (version.status !== "draft" || version.revision !== data.revision) throw new ConflictError("Simpan / muat ulang draft sebelum generasi.");
    const definition = await readDefinition(tx, version);
    if (definition.target !== data.target) throw new ValidationError("Sasaran generasi harus sesuai draft.");
    const [settings] = await tx.select().from(aiSettings).where(eq(aiSettings.organizationId, actor.organizationId)); assertSettings(settings);
    const [{ total }] = await tx.select({ total: count() }).from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.generatedBy, actor.membershipId), gt(jobs.startedAt, new Date(Date.now() - 60000))));
    if (total >= 5) throw new RateLimitError("Maksimal lima generasi per menit untuk setiap admin.");
    if (new Set(data.sources.map((s) => `${s.versionId}/${s.questionId}`)).size !== data.sources.length) throw new ValidationError("Sumber dipilih lebih dari sekali.");
    const sources: DefinitionSource[] = [];
    for (const source of data.sources) {
      const sourceVersion = await loadVersion(tx, actor.organizationId, source.versionId); const sourceDefinition = await readDefinition(tx, sourceVersion);
      const question = sourceDefinition.questions.find((q) => q.id === source.questionId);
      if (!question) throw new NotFoundError("Definisi pertanyaan sumber tidak ditemukan.");
      sources.push({ ...source, ref: `s${sources.length + 1}`, hash: hash(question), demoOnly: sourceVersion.demoOnly, question });
    }
    const generation: QuestionGenerationInput = { instructions: data.instructions, target: data.target, count: data.count, sources };
    const inputJson = JSON.stringify(generation); if (Buffer.byteLength(inputJson) > 200 * 1024) throw new ValidationError("Definisi sumber terlalu besar.");
    const quotaDate = todayKey(await organizationTimezone(tx, actor.organizationId)); const id = randomUUID(); const origin = settings.mode === "mock" ? "mock" as const : "ai" as const;
    await reserveQuota(tx, actor.organizationId, quotaDate, settings.dailyLimit);
    await tx.insert(jobs).values({ id, organizationId: actor.organizationId, versionId, revision: data.revision, idempotencyKey: data.idempotencyKey, requestHash, inputJson, origin, model: origin === "mock" ? "deterministic-simulation-v1" : settings.model!, promptVersion: QUESTION_PROMPT_VERSION, schemaVersion: QUESTION_SCHEMA_VERSION, settingsVersion: settings.settingsVersion, quotaDate, generatedBy: actor.membershipId, leaseExpiresAt: new Date(Date.now() + Math.max(120000, settings.timeoutSeconds * 1000 + 30000)) });
    await audit(tx, actor, "start", id);
    return { kind: "generation", id, settings, generation, origin, quotaDate } as const;
  });
  if (prepared.kind === "replay") return questionJobDetail(actor, prepared.id);
  try {
    const raw = prepared.origin === "mock" ? mockQuestionOutput(prepared.generation) : await callQuestionModel(prepared.settings, prepared.generation, prepared.settings.keyCiphertext ? openSecret(prepared.settings.keyCiphertext) : null, getEnv().ai.allowedEndpointOrigins);
    const output = parseQuestionOutput(raw, data.count, prepared.generation.sources.map((s) => s.ref));
    const result = materializeCandidates(output, prepared.origin, prepared.generation.sources.map((s) => s.question.label));
    await db.transaction(async (tx) => {
      await activeActor(tx, actor); const job = await findJob(tx, actor, prepared.id);
      if (job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= Date.now()) throw new ConflictError("Generasi telah berakhir; hasil terlambat tidak diterima.");
      for (const [position, c] of result.candidates.entries()) await tx.insert(candidates).values({ id: c.id, organizationId: actor.organizationId, versionId, jobId: job.id, position, questionId: c.question.id, questionJson: JSON.stringify(c.question), sectionJson: JSON.stringify(c.section), originalJson: JSON.stringify(c.original), warningsJson: JSON.stringify(c.warnings) });
      await tx.update(jobs).set({ status: "succeeded", outputJson: JSON.stringify(output), warningsJson: JSON.stringify(result.warnings), finishedAt: new Date(), leaseExpiresAt: null }).where(eq(jobs.id, job.id));
      await settleQuota(tx, actor.organizationId, job.quotaDate, job.origin === "mock"); await audit(tx, actor, "succeeded", job.id);
    });
  } catch {
    await db.transaction(async (tx) => {
      const [failed] = await tx.update(jobs).set({ status: "failed", safeError: "Generasi gagal, tidak lengkap, atau tidak sesuai kontrak. Tidak ada kandidat yang diterima sebagian.", finishedAt: new Date(), leaseExpiresAt: null }).where(and(eq(jobs.id, prepared.id), eq(jobs.status, "running"))).returning();
      if (failed) { await settleQuota(tx, actor.organizationId, failed.quotaDate, failed.origin === "mock"); await audit(tx, actor, "failed", failed.id); }
    });
  }
  return questionJobDetail(actor, prepared.id);
}
export async function decideQuestionCandidate(actor: StaffActor, id: string, input: unknown) {
  assertCan(actor.role, "form.ai");
  const data = z.object({ revision: z.number().int().positive(), decision: z.enum(["accept", "edit_and_accept", "reject"]), note: z.string().trim().min(5).max(2000), question: z.unknown().optional() }).strict().parse(input);
  if ((data.decision === "edit_and_accept") !== (data.question !== undefined)) throw new ValidationError("Pertanyaan suntingan hanya untuk edit-and-accept.");
  const requestHash = hash(data); const db = await getDbReady();
  return db.transaction(async (tx) => {
    await activeActor(tx, actor);
    const [candidate] = await tx.select().from(candidates).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.id, id)));
    if (!candidate) throw new NotFoundError();
    const [prior] = await tx.select().from(decisions).where(eq(decisions.candidateId, id));
    if (prior) { if (prior.requestHash !== requestHash) throw new ConflictError("Kandidat telah diputuskan; keputusan tidak dapat ditulis ulang."); return prior; }
    const job = await findJob(tx, actor, candidate.jobId); if (job.status !== "succeeded") throw new ConflictError();
    const version = await loadVersion(tx, actor.organizationId, candidate.versionId);
    if (version.status !== "draft" || version.revision !== data.revision) throw new ConflictError("Draft berubah atau terkunci.");
    let appliedRevision = version.revision; let applied: Question | null = null;
    if (data.decision !== "reject") {
      const original = questionSchema.parse(JSON.parse(candidate.questionJson));
      assertRuleBudget({ questions: [data.question ?? original] });
      const question = data.question === undefined ? original : questionSchema.parse(data.question);
      if (question.id !== original.id || question.type !== original.type || JSON.stringify(question.provenance) !== JSON.stringify(original.provenance)) throw new ValidationError("Identitas, jenis, dan provenance kandidat tidak boleh diganti.");
      if (hasExecutableText(JSON.stringify(question))) throw new ValidationError("Kandidat harus berupa teks biasa, bukan kode.");
      const definition = await readDefinition(tx, version);
      if (definition.questions.some((q) => q.id === question.id)) throw new ConflictError("Identitas kandidat sudah ada dalam draft.");
      if (!definition.sections.some((s) => s.id === question.sectionId)) {
        const section = JSON.parse(candidate.sectionJson) as Definition["sections"][number];
        if (question.sectionId !== section.id) throw new ValidationError("Bagian pertanyaan tidak ditemukan.");
        definition.sections.push(section);
      }
      definition.questions.push(question);
      // Compilation rejects missing/rejected follow-ups and requires explicit image policy.
      const compiled = compileDefinition(definition, true);
      const sourceInput = JSON.parse(job.inputJson) as QuestionGenerationInput;
      if (sourceInput.sources.some((s) => s.demoOnly)) await tx.update(templateVersions).set({ demoOnly: true }).where(eq(templateVersions.id, version.id));
      const saved = await saveDraftInTransaction(tx, actor, version.id, version.revision, compiled.definition, question);
      appliedRevision = saved.version.revision; applied = saved.definition.questions.find((q) => q.id === question.id)!;
    }
    const [decision] = await tx.insert(decisions).values({ organizationId: actor.organizationId, versionId: version.id, candidateId: id, decision: data.decision, note: data.note, requestHash, appliedRevision, appliedQuestionJson: applied ? JSON.stringify(applied) : null, actorId: actor.membershipId }).returning();
    await audit(tx, actor, `candidate_${data.decision}`, candidate.jobId); return decision;
  });
}
