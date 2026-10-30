import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, count } from "drizzle-orm";
import { z } from "zod";
import { getDbReady } from "@/lib/db";
import * as s from "@/lib/db/response-schema";
import { assessmentPublications } from "@/lib/db/template-schema";
import { children, guardians } from "@/lib/db/assessment-schema";
import { session as staffSessions } from "@/lib/db/auth-schema";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/crypto";
import { compileDefinition, normalizeAnswers, type DynamicAnswer } from "@/lib/assessment-builder/definition";
import { activeActor, assertContextGate, cycle } from "./assessment.service";
import { loadTemplate, loadVersion, readDefinition, assertVersionApproved, type TemplateExecutor } from "./template.service";
import { recordAudit, type AuditActor } from "./audit.service";
import type { StaffActor } from "./staff.service";
export type ResponseRow = typeof s.assessmentResponses.$inferSelect;
export type DynamicSession = typeof s.responseSessions.$inferSelect;
export type ResponseActor = { type: "staff"; staff: StaffActor } | { type: "participant"; sessionId: string };
export const DYNAMIC_TOKEN_PREFIX = "d1.";
export const responseAuditActor = (actor: ResponseActor): AuditActor => actor.type === "staff" ? { type: "staff", membershipId: actor.staff.membershipId } : actor;
const audit = (tx: TemplateExecutor, org: string, actor: ResponseActor, action: string, id: string, metadata: Record<string, unknown> = {}) => recordAudit(tx, { organizationId: org, actor: responseAuditActor(actor), action: `response.${action}`, entityType: "assessment_responses", entityId: id, metadata });

export async function loadResponse(tx: TemplateExecutor, org: string, id: string): Promise<ResponseRow> {
  const [row] = await tx.select().from(s.assessmentResponses).where(and(eq(s.assessmentResponses.id, id), eq(s.assessmentResponses.organizationId, org)));
  if (!row) throw new NotFoundError(); return row;
}
export async function responseDefinition(tx: TemplateExecutor, row: ResponseRow) {
  const version = await loadVersion(tx, row.organizationId, row.templateVersionId);
  if (!version.publishedAt || version.contentHash !== row.contentHash) throw new ConflictError("Versi response tidak sesuai snapshot.");
  return { version, definition: await readDefinition(tx, version) };
}
export async function assertResponseGate(tx: TemplateExecutor, row: ResponseRow, media = false) {
  if (row.status === "withdrawn") throw new ForbiddenError("Response telah ditarik.");
  const c = await cycle(tx, row.organizationId, row.cycleId);
  await assertContextGate(tx, c, row.target, row.guardianId, media);
  const { version, definition } = await responseDefinition(tx, row);
  await assertVersionApproved(tx, version);
  if (version.demoOnly && !c.fictional) throw new ForbiddenError("Template simulasi hanya untuk data fiktif.");
  if (definition.target !== "both" && definition.target !== row.target) throw new ForbiddenError("Sasaran responden tidak sesuai.");
  if (row.target === "child" && (definition.minAge !== null && c.ageAtStart < definition.minAge || definition.maxAge !== null && c.ageAtStart > definition.maxAge)) throw new ForbiddenError("Usia anak di luar rentang template.");
  if (media && !definition.allowImages) throw new ForbiddenError("Gambar tidak diizinkan.");
  return { definition, version, cycle: c };
}
export async function validDynamicSession(tx: TemplateExecutor, id: string) {
  const [row] = await tx.select().from(s.responseSessions).where(eq(s.responseSessions.id, id));
  if (!row || row.revokedAt || !row.exchangedAt || row.expiresAt.getTime() <= Date.now()) throw new UnauthenticatedError();
  return row;
}
export async function authorizeResponse(tx: TemplateExecutor, row: ResponseRow, actor: ResponseActor, write = false) {
  if (actor.type === "staff") {
    await activeActor(tx, actor.staff); assertCan(actor.staff.role, write ? "profile.intake.write" : "assessment.internal.read");
    if (actor.staff.organizationId !== row.organizationId) throw new NotFoundError();
  } else {
    const session = await validDynamicSession(tx, actor.sessionId);
    if (session.responseId !== row.id || session.organizationId !== row.organizationId) throw new NotFoundError();
  }
  if (row.status === "withdrawn") throw new ForbiddenError("Response telah ditarik; akses jawaban dibatasi.");
}
export async function readResponseAnswers(tx: TemplateExecutor, row: ResponseRow): Promise<DynamicAnswer[]> {
  const rows = await tx.select().from(s.assessmentAnswers).where(eq(s.assessmentAnswers.responseId, row.id));
  return rows.map((a) => ({ questionId: a.questionId, state: a.state, value: JSON.parse(a.valueJson), assistance: a.assistance as DynamicAnswer["assistance"], skipReason: a.skipReason }));
}
async function writeAnswers(tx: TemplateExecutor, row: ResponseRow, answers: DynamicAnswer[]) {
  await tx.delete(s.assessmentAnswers).where(eq(s.assessmentAnswers.responseId, row.id));
  for (const a of answers) await tx.insert(s.assessmentAnswers).values({ responseId: row.id, templateVersionId: row.templateVersionId, questionId: a.questionId, state: a.state, valueJson: JSON.stringify(a.value), assistance: a.assistance, skipReason: a.skipReason });
}
async function insertResponse(tx: TemplateExecutor, actor: StaffActor, row: Omit<typeof s.assessmentResponses.$inferInsert, "id" | "createdBy" | "organizationId">) {
  const existing = await tx.select({ id: s.assessmentResponses.id }).from(s.assessmentResponses).where(and(eq(s.assessmentResponses.organizationId, actor.organizationId), eq(s.assessmentResponses.templateId, row.templateId), eq(s.assessmentResponses.cycleId, row.cycleId), eq(s.assessmentResponses.target, row.target), row.guardianId ? eq(s.assessmentResponses.guardianId, row.guardianId) : isNull(s.assessmentResponses.guardianId), eq(s.assessmentResponses.status, "draft")));
  if (existing.length) throw new ConflictError("Draft template untuk responden ini sudah tersedia.");
  const id = randomUUID();
  await tx.insert(s.assessmentResponses).values({ ...row, id, organizationId: actor.organizationId, createdBy: actor.membershipId });
  const response = await loadResponse(tx, actor.organizationId, id); await assertResponseGate(tx, response);
  await audit(tx, actor.organizationId, { type: "staff", staff: actor }, row.parentResponseId ? "correction" : "create", id, { templateVersionId: row.templateVersionId, parentResponseId: row.parentResponseId });
  return response;
}
export async function createResponse(actor: StaffActor, input: unknown) {
  assertCan(actor.role, "profile.intake.write");
  const data = z.object({ templateId: z.uuid(), cycleId: z.uuid(), target: z.enum(["child", "guardian"]), guardianId: z.uuid().optional() }).strict().parse(input);
  if ((data.target === "guardian") !== !!data.guardianId) throw new ValidationError("Konteks wali tidak sesuai target.");
  const db = await getDbReady();
  return db.transaction(async (tx) => {
    await activeActor(tx, actor); const c = await cycle(tx, actor.organizationId, data.cycleId); const template = await loadTemplate(tx, actor.organizationId, data.templateId);
    const [publication] = template.activePublicationId ? await tx.select().from(assessmentPublications).where(eq(assessmentPublications.id, template.activePublicationId)) : [];
    if (!publication) throw new ForbiddenError("Template tidak mempunyai publikasi aktif.");
    const version = await loadVersion(tx, actor.organizationId, publication.versionId);
    if (version.status !== "published") throw new ForbiddenError();
    return insertResponse(tx, actor, { templateId: template.id, templateVersionId: version.id, contentHash: version.contentHash, cycleId: c.id, childId: c.childId, guardianId: data.guardianId, target: data.target });
  });
}
export async function correctResponse(actor: StaffActor, id: string, input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const { reason } = z.object({ reason: z.string().trim().min(5).max(2000) }).strict().parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => {
    await activeActor(tx, actor); const old = await loadResponse(tx, actor.organizationId, id);
    if (old.status !== "submitted") throw new ConflictError("Koreksi memerlukan response yang telah dikirim.");
    const next = await insertResponse(tx, actor, { templateId: old.templateId, templateVersionId: old.templateVersionId, contentHash: old.contentHash, cycleId: old.cycleId, childId: old.childId, guardianId: old.guardianId, target: old.target, parentResponseId: old.id, correctionReason: reason });
    const { definition } = await responseDefinition(tx, old);
    const answers = (await readResponseAnswers(tx, old)).filter((a) => definition.questions.find((q) => q.id === a.questionId)?.type !== "file");
    await writeAnswers(tx, next, answers); return next;
  });
}
export async function responseDetail(actor: StaffActor, id: string) {
  const db = await getDbReady(); await activeActor(db, actor); const row = await loadResponse(db, actor.organizationId, id); await authorizeResponse(db, row, { type: "staff", staff: actor });
  const { definition } = await responseDefinition(db, row);
  if (row.status === "draft") await assertResponseGate(db, row);
  const answers = normalizeAnswers(compileDefinition(definition), await readResponseAnswers(db, row));
  const sessions = await db.select({ id: s.responseSessions.id, createdBy: s.responseSessions.createdBy, expiresAt: s.responseSessions.expiresAt, exchangedAt: s.responseSessions.exchangedAt, revokedAt: s.responseSessions.revokedAt }).from(s.responseSessions).where(eq(s.responseSessions.responseId, id)).orderBy(desc(s.responseSessions.createdAt));
  return { response: row, definition, answers, sessions: sessions.map((s) => ({ ...s, live: !s.revokedAt && s.expiresAt.getTime() > Date.now() })) };
}
export async function saveResponse(org: string, id: string, input: unknown, actor: ResponseActor, final = false) {
  const data = z.object({ revision: z.number().int().positive(), answers: z.unknown() }).strict().parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => {
    const row = await loadResponse(tx, org, id); await authorizeResponse(tx, row, actor, true);
    if (row.status !== "draft" || row.revision !== data.revision) throw new ConflictError("Jawaban berubah atau telah dikirim. Muat ulang jawaban tersimpan.");
    const { definition } = await assertResponseGate(tx, row);
    const answers = normalizeAnswers(compileDefinition(definition), data.answers, final);
    for (const a of answers) if (a.state === "answered" && definition.questions.find((q) => q.id === a.questionId)?.type === "file") {
      await assertResponseGate(tx, row, true);
      const [file] = await tx.select().from(s.responseAttachments).where(and(eq(s.responseAttachments.id, String(a.value)), eq(s.responseAttachments.responseId, row.id), eq(s.responseAttachments.questionId, a.questionId), eq(s.responseAttachments.templateVersionId, row.templateVersionId)));
      if (!file) throw new ValidationError("Gambar tidak dimiliki pertanyaan / response ini.");
    }
    await writeAnswers(tx, row, answers);
    const [updated] = await tx.update(s.assessmentResponses).set({ revision: row.revision + 1, ...(final ? { status: "submitted" as const, submittedAt: new Date(), submittedBy: actor.type === "staff" ? actor.staff.membershipId : actor.sessionId } : {}) }).where(and(eq(s.assessmentResponses.id, row.id), eq(s.assessmentResponses.revision, row.revision), eq(s.assessmentResponses.status, "draft"))).returning();
    if (!updated) throw new ConflictError();
    await audit(tx, org, actor, final ? "submit" : "save", row.id, { revision: updated.revision, questionCount: answers.length });
    return { response: updated, definition, answers };
  });
}
export async function withdrawResponse(actor: StaffActor, id: string, input: unknown) {
  assertCan(actor.role, "assessment.withdraw"); const { reason } = z.object({ reason: z.string().trim().min(5).max(2000) }).strict().parse(input); const db = await getDbReady();
  await db.transaction(async (tx) => { await activeActor(tx, actor); const row = await loadResponse(tx, actor.organizationId, id); if (row.status === "withdrawn") throw new ConflictError(); await tx.update(s.assessmentResponses).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawnBy: actor.membershipId, withdrawalReason: reason }).where(eq(s.assessmentResponses.id, id)); await audit(tx, actor.organizationId, { type: "staff", staff: actor }, "withdraw", id); });
  return { withdrawn: true };
}
export async function listResponses(actor: StaffActor, input: unknown = {}) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor);
  const data = z.object({ cycleId: z.uuid().optional(), childId: z.uuid().optional(), guardianId: z.uuid().optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().parse(input);
  const r = s.assessmentResponses; const where = and(eq(r.organizationId, actor.organizationId), data.cycleId ? eq(r.cycleId, data.cycleId) : undefined, data.childId ? eq(r.childId, data.childId) : undefined, data.guardianId ? eq(r.guardianId, data.guardianId) : undefined);
  const [{ total }] = await db.select({ total: count() }).from(r).where(where);
  const rows = await db.select({ response: r, childName: children.name, guardianName: guardians.name }).from(r).innerJoin(children, eq(children.id, r.childId)).leftJoin(guardians, eq(guardians.id, r.guardianId)).where(where).orderBy(desc(r.createdAt), desc(r.id)).limit(25).offset((data.page - 1) * 25);
  return { rows, total, page: data.page };
}
export async function createResponseSession(actor: StaffActor, id: string) {
  assertCan(actor.role, "intake_session.create"); const db = await getDbReady();
  return db.transaction(async (tx) => {
    await activeActor(tx, actor); const row = await loadResponse(tx, actor.organizationId, id); if (row.status !== "draft") throw new ConflictError(); await assertResponseGate(tx, row);
    await tx.update(s.responseSessions).set({ revokedAt: new Date() }).where(and(eq(s.responseSessions.responseId, id), isNull(s.responseSessions.revokedAt)));
    const sessionId = randomUUID(); const token = DYNAMIC_TOKEN_PREFIX + generateOpaqueToken(); const expiresAt = new Date(Date.now() + 86400000);
    await tx.insert(s.responseSessions).values({ id: sessionId, organizationId: row.organizationId, responseId: id, cycleId: row.cycleId, tokenHash: hashOpaqueToken(token), expiresAt, createdBy: actor.membershipId });
    await audit(tx, actor.organizationId, { type: "staff", staff: actor }, "session_create", id);
    return { id: sessionId, token, expiresAt, path: `/intake/${sessionId}#token=${token}` };
  });
}
export async function revokeResponseSession(actor: StaffActor, id: string, input: unknown) {
  z.object({ reason: z.string().trim().min(5).max(2000) }).strict().parse(input);
  const db = await getDbReady();
  await db.transaction(async (tx) => {
    await activeActor(tx, actor);
    const [session] = await tx.select().from(s.responseSessions).where(and(eq(s.responseSessions.id, id), eq(s.responseSessions.organizationId, actor.organizationId)));
    if (!session) throw new NotFoundError();
    if (session.createdBy !== actor.membershipId) assertCan(actor.role, "intake_session.revoke_any");
    if (!session.revokedAt) await tx.update(s.responseSessions).set({ revokedAt: new Date() }).where(eq(s.responseSessions.id, id));
    await audit(tx, actor.organizationId, { type: "staff", staff: actor }, "session_revoke", session.responseId, { sessionId: id });
  });
  return { revoked: true };
}
export async function exchangeDynamic(sessionId: string, token: string, staff?: StaffActor | null) {
  if (!/^d1\.[A-Za-z0-9_-]{20,90}$/.test(token)) throw new UnauthenticatedError(); const db = await getDbReady();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(s.responseSessions).where(and(eq(s.responseSessions.id, sessionId), eq(s.responseSessions.tokenHash, hashOpaqueToken(token))));
    if (!session || session.exchangedAt || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthenticatedError("Kode sesi telah kedaluwarsa, dicabut, atau sudah digunakan.");
    const row = await loadResponse(tx, session.organizationId, session.responseId); if (row.status !== "draft") throw new ConflictError(); await assertResponseGate(tx, row);
    if (staff) { await activeActor(tx, staff); await tx.delete(staffSessions).where(eq(staffSessions.userId, staff.authUserId)); }
    const secret = DYNAMIC_TOKEN_PREFIX + generateOpaqueToken();
    const [updated] = await tx.update(s.responseSessions).set({ cookieHash: hashOpaqueToken(secret), exchangedAt: new Date() }).where(and(eq(s.responseSessions.id, session.id), isNull(s.responseSessions.exchangedAt), isNull(s.responseSessions.revokedAt))).returning();
    if (!updated) throw new UnauthenticatedError();
    await audit(tx, row.organizationId, { type: "participant", sessionId }, "session_exchange", row.id); return { secret, expiresAt: session.expiresAt };
  });
}
export async function resolveDynamic(secret: string) {
  if (!/^d1\.[A-Za-z0-9_-]{20,90}$/.test(secret)) throw new UnauthenticatedError(); const db = await getDbReady();
  const [session] = await db.select().from(s.responseSessions).where(eq(s.responseSessions.cookieHash, hashOpaqueToken(secret)));
  if (!session) throw new UnauthenticatedError(); await validDynamicSession(db, session.id);
  await assertResponseGate(db, await loadResponse(db, session.organizationId, session.responseId)); return session;
}
export async function dynamicWire(session: DynamicSession) {
  const db = await getDbReady(); await validDynamicSession(db, session.id); const row = await loadResponse(db, session.organizationId, session.responseId); const { definition, cycle } = await assertResponseGate(db, row);
  return { engine: "dynamic" as const, sessionId: session.id, status: row.status, revision: row.revision, submittedAt: row.submittedAt, contentHash: row.contentHash, templateVersionId: row.templateVersionId, fictional: cycle.fictional, definition, answers: row.status === "submitted" ? [] : normalizeAnswers(compileDefinition(definition), await readResponseAnswers(db, row)) };
}
export type DynamicWire = Omit<Awaited<ReturnType<typeof dynamicWire>>, "submittedAt"> & { submittedAt: string | null };
export async function endDynamicSession(secret: string) {
  if (!/^d1\.[A-Za-z0-9_-]{20,90}$/.test(secret)) return { ended: true };
  const db = await getDbReady();
  await db.transaction(async (tx) => {
    const [session] = await tx.select().from(s.responseSessions).where(eq(s.responseSessions.cookieHash, hashOpaqueToken(secret)));
    if (!session || session.revokedAt) return;
    await tx.update(s.responseSessions).set({ revokedAt: new Date() }).where(eq(s.responseSessions.id, session.id));
    await audit(tx, session.organizationId, { type: "participant", sessionId: session.id }, "session_end", session.responseId);
  });
  return { ended: true };
}
