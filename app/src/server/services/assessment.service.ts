import { randomUUID } from "node:crypto";
import { and, eq, desc, asc, like, or, count, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDbReady, type AppDatabase } from "@/lib/db";
import * as s from "@/lib/db/assessment-schema";
import { staffMemberships } from "@/lib/db/domain-schema";
import { session as staffSessions } from "@/lib/db/auth-schema";
import { getEnv } from "@/lib/env";
import { sha256Hex, generateOpaqueToken, hashOpaqueToken } from "@/lib/crypto";
import { assertCan, can } from "@/lib/permissions";
import { ConflictError, ForbiddenError, NotFoundError, NotReadyError, UnauthenticatedError, ValidationError } from "@/lib/errors";
import { ageAtStart, moduleForAge, validateAnswers, INSTRUMENT_DEFINITION, INSTRUMENT_VERSION, type Answer } from "@/lib/instruments";
import * as v from "@/lib/validation/assessment.schema";
import { recordAudit, type AuditActor } from "./audit.service";
import type { StaffActor } from "./staff.service";
type Executor = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;
export type AssessmentRow = typeof s.assessments.$inferSelect;
export type IntakeRow = typeof s.intakeSessions.$inferSelect;
export type CycleRow = typeof s.assessmentCycles.$inferSelect;
export const INTAKE_COOKIE = "panti.intake";
const hash = sha256Hex(JSON.stringify(INSTRUMENT_DEFINITION));
const audit = (db: Executor, actor: StaffActor, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) => recordAudit(db, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action, entityType, entityId, metadata });
export async function activeActor(db: Executor, actor: StaffActor): Promise<void> {
  const [row] = await db.select().from(staffMemberships).where(and(eq(staffMemberships.id, actor.membershipId), eq(staffMemberships.organizationId, actor.organizationId), eq(staffMemberships.active, true)));
  if (!row || row.role !== actor.role || row.authUserId !== actor.authUserId) throw new UnauthenticatedError();
}
export async function person(db: Executor, org: string, kind: "children" | "guardians", id: string) {
  const table = kind === "children" ? s.children : s.guardians;
  const [row] = await db.select().from(table).where(and(eq(table.organizationId, org), eq(table.id, id)));
  if (!row) throw new NotFoundError();
  return row;
}
export async function cycle(db: Executor, org: string, id: string) {
  const [row] = await db.select().from(s.assessmentCycles).where(and(eq(s.assessmentCycles.organizationId, org), eq(s.assessmentCycles.id, id)));
  if (!row) throw new NotFoundError();
  return row;
}
export async function assessment(db: Executor, org: string, id: string) {
  const [row] = await db.select().from(s.assessments).where(and(eq(s.assessments.organizationId, org), eq(s.assessments.id, id)));
  if (!row) throw new NotFoundError();
  return row;
}
export async function ensureInstrument(db: Executor) {
  await db.insert(s.instrumentVersions).values({ version: INSTRUMENT_VERSION, contentHash: hash, definitionJson: JSON.stringify(INSTRUMENT_DEFINITION) }).onConflictDoNothing();
  const [existing] = await db.select().from(s.instrumentVersions).where(eq(s.instrumentVersions.version, INSTRUMENT_VERSION));
  if (!existing || existing.contentHash !== hash) throw new ConflictError("Instrumen v1 berubah; gunakan versi instrumen baru");
}
export async function listProfiles(actor: StaffActor, kind: "children" | "guardians", search = "", page = 1) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor);
  const table = kind === "children" ? s.children : s.guardians;
  const filter = and(eq(table.organizationId, actor.organizationId), or(like(table.name, `%${search.slice(0, 100)}%`), like(table.code, `%${search.slice(0, 100)}%`)));
  const [{ total }] = await db.select({ total: count() }).from(table).where(filter);
  const rows = await db.select().from(table).where(filter).orderBy(asc(table.name), asc(table.id)).limit(25).offset((Math.max(1, Math.min(page, 10000)) - 1) * 25);
  return { rows, total, page };
}
export async function createProfile(actor: StaffActor, kind: "children" | "guardians", input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const db = await getDbReady();
  return db.transaction(async (tx) => {
    await activeActor(tx, actor); const id = randomUUID(); const code = `${kind === "children" ? "AN" : "WL"}-${id.slice(0, 8).toUpperCase()}`;
    if (kind === "children") {
      const data = v.childInput.parse(input);
      if (!data.fictional && !getEnv().liveIntakeEnabled) throw new NotReadyError("Penggunaan nyata belum diaktifkan. Gunakan data fiktif untuk demonstrasi.");
      const { background, accessibility, ...fields } = data;
      await tx.insert(s.children).values({ ...fields, id, code, organizationId: actor.organizationId, backgroundJson: JSON.stringify(background), accessibilityJson: JSON.stringify({ needs: accessibility }) });
    } else {
      const data = v.guardianInput.parse(input);
      if (!data.fictional && !getEnv().liveIntakeEnabled) throw new NotReadyError("Penggunaan nyata belum diaktifkan. Gunakan data fiktif untuk demonstrasi.");
      await tx.insert(s.guardians).values({ ...data, id, code, organizationId: actor.organizationId });
    }
    await audit(tx, actor, "profile.create", kind, id); return person(tx, actor.organizationId, kind, id);
  });
}
export async function updateProfile(actor: StaffActor, kind: "children" | "guardians", id: string, input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const db = await getDbReady();
  const { revision, ...raw } = z.object({ revision: z.number().int().min(1) }).passthrough().parse(input);
  return db.transaction(async (tx) => {
    await activeActor(tx, actor); const old = await person(tx, actor.organizationId, kind, id);
    if (old.revision !== revision || old.profileState === "archived") throw new ConflictError();
    if (kind === "children") { const { background, accessibility, ...data } = v.childInput.parse(raw); if (data.fictional !== old.fictional) throw new ValidationError("Status data fiktif tidak dapat diubah"); await tx.update(s.children).set({ ...data, backgroundJson: JSON.stringify(background), accessibilityJson: JSON.stringify({ needs: accessibility }), revision: revision + 1, profileState: "draft", verifiedAt: null, verifiedBy: null }).where(eq(s.children.id, id)); }
    else { const data = v.guardianInput.parse(raw); if (data.fictional !== old.fictional) throw new ValidationError("Status data fiktif tidak dapat diubah"); await tx.update(s.guardians).set({ ...data, revision: revision + 1, profileState: "draft", verifiedAt: null, verifiedBy: null }).where(eq(s.guardians.id, id)); }
    await audit(tx, actor, "profile.update", kind, id, { revision: revision + 1 }); return person(tx, actor.organizationId, kind, id);
  });
}
export async function profileTransition(actor: StaffActor, kind: "children" | "guardians", id: string, action: "verify" | "archive" | "restore", input: unknown) {
  assertCan(actor.role, action === "verify" ? "profile.intake.write" : action === "archive" ? "profile.archive" : "profile.restore"); const db = await getDbReady();
  const { revision } = z.object({ revision: z.number().int().min(1) }).strict().parse(input);
  return db.transaction(async (tx) => { await activeActor(tx, actor); const old = await person(tx, actor.organizationId, kind, id); if (revision !== old.revision) throw new ConflictError();
    if (action === "verify" && old.profileState !== "draft") throw new ConflictError("Hanya profil draft yang dapat diverifikasi");
    const table = kind === "children" ? s.children : s.guardians;
    await tx.update(table).set({ profileState: action === "verify" ? "verified" : action === "archive" ? "archived" : "draft", verifiedBy: action === "verify" ? actor.membershipId : null, verifiedAt: action === "verify" ? new Date() : null, archivedAt: action === "archive" ? new Date() : null, revision: revision + 1 }).where(eq(table.id, id));
    await audit(tx, actor, `profile.${action}`, kind, id); return person(tx, actor.organizationId, kind, id);
  });
}
export async function linkGuardian(actor: StaffActor, childId: string, input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const data = v.linkInput.parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); const child = await person(tx, actor.organizationId, "children", childId); const guardian = await person(tx, actor.organizationId, "guardians", data.guardianId); if (child.fictional !== guardian.fictional || child.profileState === "archived" || guardian.profileState === "archived") throw new ValidationError("Profil tidak sesuai konteks");
    const [existing] = await tx.select().from(s.childGuardians).where(and(eq(s.childGuardians.childId, childId), eq(s.childGuardians.guardianId, data.guardianId))); if (existing) throw new ConflictError("Wali sudah terhubung dengan anak");
    const id = randomUUID(); await tx.insert(s.childGuardians).values({ ...data, id, organizationId: actor.organizationId, childId, contactReviewBy: data.contactReviewNote ? actor.membershipId : null, contactReviewAt: data.contactReviewNote ? new Date() : null }); await audit(tx, actor, "guardian.link", "child_guardians", id); return { id };
  });
}
export async function linkedGuardian(db: Executor, org: string, childId: string, guardianId: string) {
  await person(db, org, "guardians", guardianId);
  const [link] = await db.select().from(s.childGuardians).where(and(eq(s.childGuardians.organizationId, org), eq(s.childGuardians.childId, childId), eq(s.childGuardians.guardianId, guardianId), isNull(s.childGuardians.validTo)));
  if (!link) throw new NotFoundError("Wali tidak terhubung dengan anak ini"); return link;
}
export async function createCycle(actor: StaffActor, childId: string, input: unknown = {}) {
  assertCan(actor.role, "profile.intake.write"); const data = z.object({ kind: z.enum(["initial", "followup"]).default("initial"), priorCycleId: z.uuid().optional() }).strict().parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); const [child] = await tx.select().from(s.children).where(and(eq(s.children.id, childId), eq(s.children.organizationId, actor.organizationId))); if (!child) throw new NotFoundError(); if (child.profileState !== "verified") throw new ValidationError("Verifikasi profil anak sebelum membuat siklus"); await ensureInstrument(tx);
    if (data.priorCycleId && (await cycle(tx, actor.organizationId, data.priorCycleId)).childId !== childId) throw new NotFoundError();
    const startedAt = new Date(); const age = ageAtStart(child.birthDate, child.estimatedAge, child.ageReferenceDate, startedAt); const instrumentModule = moduleForAge(age.age);
    const links = await tx.select().from(s.childGuardians).where(and(eq(s.childGuardians.childId, childId), isNull(s.childGuardians.validTo))); const id = randomUUID();
    await tx.insert(s.assessmentCycles).values({ id, organizationId: actor.organizationId, childId, kind: data.kind, priorCycleId: data.priorCycleId, ageAtStart: age.age, ageIsEstimated: age.estimated, startedAt, module: instrumentModule, instrumentVersion: INSTRUMENT_VERSION, guardianAvailability: links.length ? "available" : "unavailable", fictional: child.fictional });
    await audit(tx, actor, "cycle.create", "assessment_cycles", id, { module: instrumentModule, ageIsEstimated: age.estimated }); return cycle(tx, actor.organizationId, id);
  });
}
export async function consentGranted(db: Executor, cycleId: string, subjectId: string, type: typeof s.consents.$inferSelect["type"]): Promise<boolean> {
  const [row] = await db.select().from(s.consents).where(and(eq(s.consents.cycleId, cycleId), eq(s.consents.subjectId, subjectId), eq(s.consents.type, type))).orderBy(desc(s.consents.capturedAt), desc(s.consents.id)).limit(1); return row?.status === "granted";
}
export async function assertGate(db: Executor, c: CycleRow, target: "child" | "guardian", guardianId: string | null = null, media = false) {
  await assertContextGate(db, c, target, guardianId, media);
  if (c.fictional) return;
  const [approval] = await db.select().from(s.instrumentApprovals).where(and(eq(s.instrumentApprovals.organizationId, c.organizationId), eq(s.instrumentApprovals.instrumentVersion, c.instrumentVersion), eq(s.instrumentApprovals.contentHash, hash))).orderBy(desc(s.instrumentApprovals.approvedAt), desc(s.instrumentApprovals.id)).limit(1);
  if (approval?.status !== "approved") throw new ForbiddenError("Instrumen belum disahkan psikolog atau telah dicabut");
}
export async function assertContextGate(db: Executor, c: CycleRow, target: "child" | "guardian", guardianId: string | null = null, media = false) {
  const child = await person(db, c.organizationId, "children", c.childId); if (child.profileState !== "verified" || c.status === "closed") throw new ForbiddenError("Profil belum diverifikasi atau siklus sudah ditutup");
  if (guardianId) { await linkedGuardian(db, c.organizationId, c.childId, guardianId); const guardian = await person(db, c.organizationId, "guardians", guardianId); if (guardian.profileState !== "verified" || guardian.fictional !== c.fictional) throw new ForbiddenError("Verifikasi profil wali dan konteksnya"); }
  if (c.fictional) { if (!child.fictional) throw new ForbiddenError(); return; }
  if (!getEnv().liveIntakeEnabled) throw new NotReadyError("Intake nyata belum diaktifkan");
  const [authority] = await db.select().from(s.authorityReviews).where(eq(s.authorityReviews.cycleId, c.id)).orderBy(desc(s.authorityReviews.reviewedAt), desc(s.authorityReviews.id)).limit(1);
  if (authority?.decision !== "approved" || !await consentGranted(db, c.id, c.childId, "intake")) throw new ForbiddenError("Dasar kewenangan dan persetujuan intake anak belum sah");
  if (target === "child" && !await consentGranted(db, c.id, c.childId, "assent")) throw new ForbiddenError("Anak belum menyetujui kegiatan atau menarik persetujuan");
  if (target === "guardian" && (!guardianId || !await consentGranted(db, c.id, guardianId, "intake"))) throw new ForbiddenError("Persetujuan wali untuk datanya sendiri diperlukan");
  if (media && !await consentGranted(db, c.id, target === "guardian" ? guardianId! : c.childId, "media")) throw new ForbiddenError("Persetujuan media subjek belum diberikan");
}
export async function addConsent(actor: StaffActor, cycleId: string, input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const data = v.consentInput.parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); const c = await cycle(tx, actor.organizationId, cycleId); if (data.subjectType === "child" ? data.subjectId !== c.childId : !data.subjectId) throw new NotFoundError(); if (data.subjectType === "guardian") await linkedGuardian(tx, actor.organizationId, c.childId, data.subjectId); if (data.type === "assent" && data.subjectType !== "child") throw new ValidationError();
    const id = randomUUID(); await tx.insert(s.consents).values({ ...data, id, organizationId: actor.organizationId, cycleId, childId: c.childId, guardianId: data.subjectType === "guardian" ? data.subjectId : null, capturedBy: actor.membershipId }); await audit(tx, actor, "consent.record", "consents", id, { status: data.status, subjectId: data.subjectId }); return { id };
  });
}
export async function addAuthority(actor: StaffActor, cycleId: string, input: unknown) {
  assertCan(actor.role, "authority.review"); const data = v.reviewInput.parse(input); const db = await getDbReady(); return db.transaction(async (tx) => { await activeActor(tx, actor); await cycle(tx, actor.organizationId, cycleId); const id = randomUUID(); await tx.insert(s.authorityReviews).values({ ...data, id, organizationId: actor.organizationId, cycleId, reviewerId: actor.membershipId }); await audit(tx, actor, "authority.review", "authority_reviews", id, { decision: data.decision }); return { id }; });
}
export async function instrumentDecision(actor: StaffActor, action: "approvals" | "revocations", input: unknown) {
  assertCan(actor.role, action === "approvals" ? "instrument.approve" : "instrument.revoke"); const data = z.object({ contentHash: z.string().length(64), note: z.string().trim().min(10).max(2000) }).strict().parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); await ensureInstrument(tx); if (data.contentHash !== hash) throw new ConflictError(); const [staff] = await tx.select().from(staffMemberships).where(eq(staffMemberships.id, actor.membershipId));
    if (action === "approvals" && !staff?.credentialVerifiedAt) throw new ForbiddenError("Kredensial psikolog belum diverifikasi");
    const [last] = await tx.select().from(s.instrumentApprovals).where(eq(s.instrumentApprovals.organizationId, actor.organizationId)).orderBy(desc(s.instrumentApprovals.approvedAt)).limit(1);
    if (action === "revocations" && actor.role !== "ketua" && last?.psychologistId !== actor.membershipId) throw new ForbiddenError();
    const id = randomUUID(); await tx.insert(s.instrumentApprovals).values({ id, organizationId: actor.organizationId, instrumentVersion: INSTRUMENT_VERSION, contentHash: hash, status: action === "approvals" ? "approved" : "revoked", psychologistId: action === "approvals" ? actor.membershipId : last?.psychologistId ?? actor.membershipId, reviewNote: data.note, revokedBy: action === "revocations" ? actor.membershipId : null, revokedAt: action === "revocations" ? new Date() : null, revokedReason: action === "revocations" ? data.note : null }); await audit(tx, actor, `instrument.${action}`, "instrument_approvals", id); return { id };
  });
}
export async function instrumentOverview(actor: StaffActor) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor); await ensureInstrument(db);
  const approvals = await db.select().from(s.instrumentApprovals).where(eq(s.instrumentApprovals.organizationId, actor.organizationId)).orderBy(desc(s.instrumentApprovals.approvedAt), desc(s.instrumentApprovals.id));
  return { contentHash: hash, approvals, effective: approvals[0]?.status === "approved" && approvals[0].contentHash === hash };
}
export async function createAssessment(actor: StaffActor, cycleId: string, input: unknown) {
  assertCan(actor.role, "profile.intake.write"); const data = v.draftInput.parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); const c = await cycle(tx, actor.organizationId, cycleId); if (data.target === "guardian" && !data.guardianId || data.target === "child" && data.guardianId) throw new ValidationError("Konteks wali diperlukan hanya pada asesmen wali"); await assertGate(tx, c, data.target, data.guardianId ?? null);
    let answersJson = "[]";
    if (data.parentAssessmentId) { const old = await assessment(tx, actor.organizationId, data.parentAssessmentId); if (old.status !== "submitted" || old.cycleId !== cycleId || old.target !== data.target || old.guardianId !== (data.guardianId ?? null) || !data.correctionReason) throw new ValidationError("Koreksi memerlukan sumber submitted yang sesuai dan alasan"); answersJson = old.answersJson; }
    const drafts = await tx.select().from(s.assessments).where(and(eq(s.assessments.cycleId, cycleId), eq(s.assessments.target, data.target), eq(s.assessments.status, "draft"), data.guardianId ? eq(s.assessments.guardianId, data.guardianId) : isNull(s.assessments.guardianId))); if (drafts.length) throw new ConflictError("Draft untuk peserta ini sudah tersedia");
    const id = randomUUID(); await tx.insert(s.assessments).values({ id, organizationId: actor.organizationId, cycleId, childId: c.childId, guardianId: data.guardianId, target: data.target, module: data.target === "child" ? c.module : "W", instrumentVersion: c.instrumentVersion, respondentType: data.target, facilitatorId: actor.membershipId, parentAssessmentId: data.parentAssessmentId, answersJson }); await audit(tx, actor, data.parentAssessmentId ? "assessment.correction" : "assessment.create", "assessments", id, { parentAssessmentId: data.parentAssessmentId });
    if (data.correctionReason) await tx.insert(s.assessmentObservations).values({ organizationId: actor.organizationId, assessmentId: id, authorId: actor.membershipId, observation: `Correction reason: ${data.correctionReason}` }); return assessment(tx, actor.organizationId, id);
  });
}
export async function saveAssessment(db: AppDatabase, org: string, id: string, input: unknown, actor: AuditActor, final = false) {
  const data = v.saveInput.parse(input);
  return db.transaction(async (tx) => { const a = await assessment(tx, org, id); if (a.status !== "draft" || a.revision !== data.revision) throw new ConflictError("Jawaban berubah atau telah dikirim. Muat ulang jawaban tersimpan."); const c = await cycle(tx, org, a.cycleId);
    if (actor.type === "participant") { const scoped = await validSession(tx, actor.sessionId); if (scoped.assessmentId !== id) throw new NotFoundError(); }
    await assertGate(tx, c, a.target, a.guardianId); const answers = validateAnswers(a.module, data.answers, final);
    for (const answer of answers) if (answer.kind === "media" && answer.initialAttachmentId) { await assertGate(tx, c, a.target, a.guardianId, true); const [file] = await tx.select().from(s.attachments).where(and(eq(s.attachments.id, answer.initialAttachmentId), eq(s.attachments.assessmentId, id), eq(s.attachments.status, "ready"), isNull(s.attachments.archivedAt))); if (!file) throw new ValidationError("Gambar tidak tersedia untuk sesi ini"); }
    const rows = await tx.update(s.assessments).set({ answersJson: JSON.stringify(answers), revision: a.revision + 1, ...(final ? { status: "submitted" as const, submittedAt: new Date(), submittedBy: actor.type === "staff" ? actor.membershipId : actor.type === "participant" ? actor.sessionId : actor.label } : {}) }).where(and(eq(s.assessments.id, id), eq(s.assessments.status, "draft"), eq(s.assessments.revision, data.revision))).returning(); if (!rows.length) throw new ConflictError();
    await recordAudit(tx, { organizationId: org, actor, action: final ? "assessment.submit" : "assessment.save", entityType: "assessments", entityId: id, metadata: { revision: a.revision + 1, itemCount: answers.length } }); return rows[0];
  });
}
export async function createIntakeSession(actor: StaffActor, cycleId: string, input: unknown) {
  assertCan(actor.role, "intake_session.create"); const { assessmentId } = v.sessionInput.parse(input); const db = await getDbReady();
  return db.transaction(async (tx) => { await activeActor(tx, actor); const c = await cycle(tx, actor.organizationId, cycleId); const a = await assessment(tx, actor.organizationId, assessmentId); if (a.cycleId !== cycleId || a.status !== "draft") throw new ConflictError(); await assertGate(tx, c, a.target, a.guardianId);
    await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(and(eq(s.intakeSessions.assessmentId, a.id), isNull(s.intakeSessions.revokedAt))); const id = randomUUID(); const token = generateOpaqueToken(); const expiresAt = new Date(Date.now() + 86400000);
    await tx.insert(s.intakeSessions).values({ id, organizationId: actor.organizationId, scope: a.target === "child" ? "child_assessment" : "guardian_assessment", targetType: a.target, targetId: a.guardianId ?? a.childId, cycleId, assessmentId, tokenHash: hashOpaqueToken(token), expiresAt, createdBy: actor.membershipId }); await tx.update(s.assessments).set({ intakeSessionId: id }).where(eq(s.assessments.id, assessmentId)); await audit(tx, actor, "intake_session.create", "intake_sessions", id); return { id, token, expiresAt, path: `/intake/${id}#token=${token}` };
  });
}
export async function validSession(db: Executor, id: string): Promise<IntakeRow> {
  const [row] = await db.select().from(s.intakeSessions).where(eq(s.intakeSessions.id, id)); if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.exchangedAt) throw new UnauthenticatedError(); return row;
}
export async function exchangeIntake(sessionId: string, token: string, staffActor?: StaffActor | null) {
  const db = await getDbReady(); return db.transaction(async (tx) => { const [row] = await tx.select().from(s.intakeSessions).where(and(eq(s.intakeSessions.id, sessionId), eq(s.intakeSessions.tokenHash, hashOpaqueToken(token)))); if (!row || row.exchangedAt || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw new UnauthenticatedError("Kode sesi telah kedaluwarsa, dicabut, atau sudah digunakan"); const a = await assessment(tx, row.organizationId, row.assessmentId); if (a.status !== "draft") throw new ConflictError(); await assertGate(tx, await cycle(tx, row.organizationId, row.cycleId), a.target, a.guardianId);
    if (staffActor) { await activeActor(tx, staffActor); await tx.delete(staffSessions).where(eq(staffSessions.userId, staffActor.authUserId)); }
    const secret = generateOpaqueToken(); const updated = await tx.update(s.intakeSessions).set({ cookieHash: hashOpaqueToken(secret), exchangedAt: new Date() }).where(and(eq(s.intakeSessions.id, row.id), isNull(s.intakeSessions.exchangedAt), isNull(s.intakeSessions.revokedAt))).returning(); if (!updated.length) throw new UnauthenticatedError(); await recordAudit(tx, { organizationId: row.organizationId, actor: { type: "participant", sessionId: row.id }, action: "intake_session.exchange", entityType: "intake_sessions", entityId: row.id }); return { secret, expiresAt: row.expiresAt };
  });
}
export async function resolveIntake(secret: string | undefined) {
  if (!secret) throw new UnauthenticatedError(); const db = await getDbReady(); const [row] = await db.select().from(s.intakeSessions).where(eq(s.intakeSessions.cookieHash, hashOpaqueToken(secret))); if (!row) throw new UnauthenticatedError(); await validSession(db, row.id); const a = await assessment(db, row.organizationId, row.assessmentId); if (a.status === "withdrawn") throw new ForbiddenError(); await assertGate(db, await cycle(db, row.organizationId, row.cycleId), a.target, a.guardianId); return row;
}
export async function revokeSession(actor: StaffActor, id: string, input: unknown) {
  const { reason } = v.reasonInput.parse(input); const db = await getDbReady(); return db.transaction(async (tx) => { await activeActor(tx, actor); const [row] = await tx.select().from(s.intakeSessions).where(and(eq(s.intakeSessions.id, id), eq(s.intakeSessions.organizationId, actor.organizationId))); if (!row) throw new NotFoundError(); if (row.createdBy !== actor.membershipId && !can(actor.role, "intake_session.revoke_any")) throw new ForbiddenError(); await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(eq(s.intakeSessions.id, id)); await audit(tx, actor, "intake_session.revoke", "intake_sessions", id); await tx.insert(s.assessmentObservations).values({ organizationId: actor.organizationId, assessmentId: row.assessmentId, authorId: actor.membershipId, observation: `Session revocation: ${reason}` }); return { revoked: true }; });
}
export function participantWire(a: AssessmentRow, c: CycleRow) {
  if (a.status === "submitted") return { sessionId: a.intakeSessionId, status: "submitted" as const, submittedAt: a.submittedAt, fictional: c.fictional };
  return { sessionId: a.intakeSessionId, status: "draft" as const, revision: a.revision, module: a.module, instrumentVersion: a.instrumentVersion, answers: JSON.parse(a.answersJson) as Answer[], fictional: c.fictional, target: a.target };
}
export async function workspaceStats(actor: StaffActor) {
  const db = await getDbReady(); await activeActor(db, actor); assertCan(actor.role, "assessment.internal.read");
  const [childCount] = await db.select({ total: count() }).from(s.children).where(eq(s.children.organizationId, actor.organizationId)); const [guardianCount] = await db.select({ total: count() }).from(s.guardians).where(eq(s.guardians.organizationId, actor.organizationId)); const [submitted] = await db.select({ total: count() }).from(s.assessments).where(and(eq(s.assessments.organizationId, actor.organizationId), eq(s.assessments.status, "submitted"))); const [drafts] = await db.select({ total: count() }).from(s.assessments).where(and(eq(s.assessments.organizationId, actor.organizationId), eq(s.assessments.status, "draft"))); return { children: childCount.total, guardians: guardianCount.total, submitted: submitted.total, drafts: drafts.total };
}
export async function profileDetail(actor: StaffActor, kind: "children" | "guardians", id: string) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor); const profile = await person(db, actor.organizationId, kind, id); const links = await db.select({ link: s.childGuardians, child: s.children, guardian: s.guardians }).from(s.childGuardians).innerJoin(s.children, eq(s.children.id, s.childGuardians.childId)).innerJoin(s.guardians, eq(s.guardians.id, s.childGuardians.guardianId)).where(and(eq(s.childGuardians.organizationId, actor.organizationId), kind === "children" ? eq(s.childGuardians.childId, id) : eq(s.childGuardians.guardianId, id)));
  const cycles = kind === "children" ? await db.select().from(s.assessmentCycles).where(and(eq(s.assessmentCycles.organizationId, actor.organizationId), eq(s.assessmentCycles.childId, id))).orderBy(desc(s.assessmentCycles.startedAt)) : [];
  const assessments = await db.select({ id: s.assessments.id, cycleId: s.assessments.cycleId, childId: s.assessments.childId, target: s.assessments.target, guardianId: s.assessments.guardianId, module: s.assessments.module, status: s.assessments.status, createdAt: s.assessments.createdAt, submittedAt: s.assessments.submittedAt }).from(s.assessments).where(and(eq(s.assessments.organizationId, actor.organizationId), kind === "children" ? eq(s.assessments.childId, id) : eq(s.assessments.guardianId, id))).orderBy(desc(s.assessments.createdAt));
  return { profile, links, cycles, assessments };
}
export async function cycleDetail(actor: StaffActor, id: string) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor); const c = await cycle(db, actor.organizationId, id); const child = await person(db, actor.organizationId, "children", c.childId); const detail = await profileDetail(actor, "children", c.childId); const items = detail.assessments.filter((a) => a.cycleId === id); const consentHistory = await db.select().from(s.consents).where(eq(s.consents.cycleId, id)).orderBy(desc(s.consents.capturedAt)); const reviews = await db.select().from(s.authorityReviews).where(eq(s.authorityReviews.cycleId, id)).orderBy(desc(s.authorityReviews.reviewedAt));
  const full = await db.select().from(s.assessments).where(and(eq(s.assessments.organizationId, actor.organizationId), eq(s.assessments.cycleId, id))).orderBy(desc(s.assessments.createdAt));
  const sessionRows = await db.select({ id: s.intakeSessions.id, assessmentId: s.intakeSessions.assessmentId, expiresAt: s.intakeSessions.expiresAt, exchangedAt: s.intakeSessions.exchangedAt, revokedAt: s.intakeSessions.revokedAt, createdAt: s.intakeSessions.createdAt }).from(s.intakeSessions).where(and(eq(s.intakeSessions.organizationId, actor.organizationId), eq(s.intakeSessions.cycleId, id))).orderBy(desc(s.intakeSessions.createdAt)); const now = Date.now(); const sessions = sessionRows.map((row) => ({ ...row, live: !row.revokedAt && row.expiresAt.getTime() > now }));
  const gateMessage = async (target: "child" | "guardian", guardianId: string | null) => { try { await assertGate(db, c, target, guardianId); return null; } catch (error) { return (error as Error).message; } };
  const gates = { child: await gateMessage("child", null), guardians: Object.fromEntries(await Promise.all(detail.links.map(async ({ guardian }) => [guardian.id, await gateMessage("guardian", guardian.id)] as const))) };
  return { cycle: c, child, links: detail.links, assessments: items, full: full.map(({ answersJson, ...row }) => ({ ...row, answers: row.status === "withdrawn" ? [] : JSON.parse(answersJson) as Answer[] })), sessions, gates, consents: consentHistory, reviews };
}
export async function resultDetail(actor: StaffActor, id: string) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor); const a = await assessment(db, actor.organizationId, id); if (a.status === "withdrawn") throw new ForbiddenError("Asesmen telah ditarik; akses jawaban dibatasi"); const c = await cycle(db, actor.organizationId, a.cycleId); const child = await person(db, actor.organizationId, "children", a.childId); const guardian = a.guardianId ? await person(db, actor.organizationId, "guardians", a.guardianId) : null; const media = await db.select().from(s.attachments).where(and(eq(s.attachments.assessmentId, id), eq(s.attachments.status, "ready"), isNull(s.attachments.archivedAt))); const events = await db.select().from(s.attachmentEvents).where(eq(s.attachmentEvents.assessmentId, id)); const observations = await db.select().from(s.assessmentObservations).where(eq(s.assessmentObservations.assessmentId, id)); return { assessment: a, cycle: c, child, guardian, media: media.map((file) => ({ ...file, storageKey: undefined })), events, observations, answers: JSON.parse(a.answersJson) as Answer[] };
}
export async function listResults(actor: StaffActor, target?: "child" | "guardian", page = 1) {
  assertCan(actor.role, "assessment.internal.read"); const db = await getDbReady(); await activeActor(db, actor); const where = and(eq(s.assessments.organizationId, actor.organizationId), target ? eq(s.assessments.target, target) : undefined); const [{ total }] = await db.select({ total: count() }).from(s.assessments).where(where);
  const rows = await db.select({ id: s.assessments.id, target: s.assessments.target, status: s.assessments.status, module: s.assessments.module, childName: s.children.name, guardianName: s.guardians.name, createdAt: s.assessments.createdAt, submittedAt: s.assessments.submittedAt, cycleId: s.assessments.cycleId, fictional: s.assessmentCycles.fictional }).from(s.assessments).innerJoin(s.children, eq(s.children.id, s.assessments.childId)).innerJoin(s.assessmentCycles, eq(s.assessmentCycles.id, s.assessments.cycleId)).leftJoin(s.guardians, eq(s.guardians.id, s.assessments.guardianId)).where(where).orderBy(desc(s.assessments.createdAt), desc(s.assessments.id)).limit(25).offset((page - 1) * 25); return { rows, total, page };
}
