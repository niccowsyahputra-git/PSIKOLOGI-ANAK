import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { jsonOk, withApiHandler } from "@/lib/api";
import { getStaffSession, requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import * as s from "@/lib/db/assessment-schema";
import { getEnv } from "@/lib/env";
import { assertCan } from "@/lib/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { INSTRUMENT_DEFINITION } from "@/lib/instruments";
import * as service from "@/server/services/assessment.service";
import { uploadMedia, mediaContent, MAX_IMAGE_BYTES } from "@/server/services/media.service";
import { recordAudit } from "@/server/services/audit.service";
import { reasonInput } from "@/lib/validation/assessment.schema";

async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 100000) throw new ValidationError("Permintaan terlalu besar");
  const raw = await request.text(); if (raw.length > 100000) throw new ValidationError("Permintaan terlalu besar");
  try { return JSON.parse(raw); } catch { throw new ValidationError("JSON tidak valid"); }
}
function mutationOrigin(request: NextRequest) {
  // Same-origin only: the configured base URLs plus the host the browser actually used (localhost vs 127.0.0.1).
  const origin = request.headers.get("origin"); const allowed = new Set([new URL(getEnv().appBaseUrl).origin, new URL(getEnv().betterAuthUrl).origin, request.nextUrl.origin]);
  if (origin && !allowed.has(origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new ForbiddenError("Permintaan harus berasal dari aplikasi lokal");
}
async function uploadedFile(request: Request): Promise<{ file: File; assessmentId: string | null }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 100000) throw new ValidationError("Gambar maksimal 5 MB");
  const form = await request.formData(); const file = form.get("file"); if (!(file instanceof File)) throw new ValidationError("Gambar diperlukan"); const id = form.get("assessmentId"); return { file, assessmentId: typeof id === "string" ? id : null };
}
const handler = withApiHandler(async (request: NextRequest, context: { params: Promise<{ domain: string[] }> }) => {
  const paths = (await context.params).domain; const [domain, id, action, extra] = paths; const method = request.method; if (paths.length > 4) throw new NotFoundError();
  if (method !== "GET") mutationOrigin(request);
  const jar = await cookies();
  if (domain === "intake") {
    if (id === "exchange" && method === "POST") {
      const data = z.object({ sessionId: z.uuid(), token: z.string().min(20).max(100) }).strict().parse(await body(request)); const staff = await getStaffSession();
      const result = await service.exchangeIntake(data.sessionId, data.token, staff ? toStaffActor(staff) : null);
      const response = jsonOk({ exchanged: true }); response.cookies.set(service.INTAKE_COOKIE, result.secret, { httpOnly: true, sameSite: "strict", secure: new URL(getEnv().appBaseUrl).protocol === "https:", path: "/", expires: result.expiresAt });
      for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data"]) response.cookies.set(name, "", { path: "/", maxAge: 0, expires: new Date(0) }); return response;
    }
    const scoped = await service.resolveIntake(jar.get(service.INTAKE_COOKIE)?.value); const db = await getDbReady(); const actor = { type: "participant" as const, sessionId: scoped.id };
    if (id === "current" && method === "GET") return jsonOk(service.participantWire(await service.assessment(db, scoped.organizationId, scoped.assessmentId), await service.cycle(db, scoped.organizationId, scoped.cycleId)));
    if ((id === "current" && method === "PATCH") || (id === "submit" && method === "POST")) { const a = await service.saveAssessment(db, scoped.organizationId, scoped.assessmentId, await body(request), actor, id === "submit"); return jsonOk(service.participantWire(a, await service.cycle(db, scoped.organizationId, scoped.cycleId))); }
    if (id === "attachments" && action && extra === "content" && method === "GET") return mediaContent(scoped.organizationId, action, scoped);
    if (id === "attachments" && !action && method === "POST") { const { file } = await uploadedFile(request); return jsonOk(await uploadMedia(scoped.organizationId, scoped.assessmentId, file, actor)); }
    if (id === "end" && method === "POST") { await db.transaction(async (tx) => { await service.validSession(tx, scoped.id); await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(eq(s.intakeSessions.id, scoped.id)); await recordAudit(tx, { organizationId: scoped.organizationId, actor, action: "intake_session.end", entityType: "intake_sessions", entityId: scoped.id }); }); const response = jsonOk({ ended: true }); response.cookies.set(service.INTAKE_COOKIE, "", { path: "/", maxAge: 0, expires: new Date(0) }); return response; }
    throw new NotFoundError();
  }
  if (jar.get(service.INTAKE_COOKIE)?.value) throw new ForbiddenError("Sesi peserta tidak dapat mengakses aplikasi staf");
  const contextStaff = await requireStaffSessionForApi(); const actor = toStaffActor(contextStaff); const db = await getDbReady(); await service.activeActor(db, actor);
  if (domain === "children" || domain === "guardians") {
    if (!id && method === "GET") { const page = z.coerce.number().int().min(1).max(10000).default(1).parse(request.nextUrl.searchParams.get("page") ?? undefined); return jsonOk(await service.listProfiles(actor, domain, request.nextUrl.searchParams.get("q") ?? "", page)); }
    if (!id && method === "POST") return jsonOk(await service.createProfile(actor, domain, await body(request)), { status: 201 });
    if (id && !action && method === "GET") return jsonOk(await service.profileDetail(actor, domain, id));
    if (id && !action && method === "PATCH") return jsonOk(await service.updateProfile(actor, domain, id, await body(request)));
    if (id && ["verify", "archive", "restore"].includes(action) && method === "POST") return jsonOk(await service.profileTransition(actor, domain, id, action as "verify" | "archive" | "restore", await body(request)));
    if (domain === "children" && action === "guardian-links" && method === "POST") return jsonOk(await service.linkGuardian(actor, id, await body(request)));
    if (domain === "children" && action === "cycles" && method === "POST") return jsonOk(await service.createCycle(actor, id, await body(request)));
  }
  if (domain === "cycles") {
    if (id && !action && method === "GET") return jsonOk(await service.cycleDetail(actor, id));
    if (action === "assessments" && method === "POST") return jsonOk(await service.createAssessment(actor, id, await body(request)));
    if (action === "intake-sessions" && method === "POST") return jsonOk(await service.createIntakeSession(actor, id, await body(request)));
    if (action === "consents" && method === "POST") return jsonOk(await service.addConsent(actor, id, await body(request)));
    if (action === "authority-reviews" && method === "POST") return jsonOk(await service.addAuthority(actor, id, await body(request)));
    if (["activate", "close"].includes(action) && method === "POST") { assertCan(actor.role, "profile.intake.write"); const reason = action === "close" ? reasonInput.parse(await body(request)).reason : null; await db.transaction(async (tx) => { await service.activeActor(tx, actor); const c = await service.cycle(tx, actor.organizationId, id); if (action === "activate") await service.assertGate(tx, c, "child"); await tx.update(s.assessmentCycles).set({ status: action === "activate" ? "active" : "closed" }).where(eq(s.assessmentCycles.id, id)); await recordAudit(tx, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action: `cycle.${action}`, entityType: "assessment_cycles", entityId: id }); if (reason) await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(eq(s.intakeSessions.cycleId, id)); }); return jsonOk({ status: action === "activate" ? "active" : "closed" }); }
  }
  if (domain === "assessments") {
    if (!id && method === "GET") return jsonOk(await service.listResults(actor, z.enum(["child", "guardian"]).optional().parse(request.nextUrl.searchParams.get("target") ?? undefined), z.coerce.number().int().min(1).max(10000).default(1).parse(request.nextUrl.searchParams.get("page") ?? undefined)));
    if (id && !action && method === "GET") return jsonOk(await service.resultDetail(actor, id));
    if (id && !action && method === "PATCH" || action === "submit" && method === "POST") { assertCan(actor.role, "profile.intake.write"); return jsonOk(await service.saveAssessment(db, actor.organizationId, id, await body(request), { type: "staff", membershipId: actor.membershipId }, action === "submit")); }
    if (action === "late-attachments" && method === "POST") { assertCan(actor.role, "profile.intake.write"); const { file } = await uploadedFile(request); return jsonOk(await uploadMedia(actor.organizationId, id, file, { type: "staff", membershipId: actor.membershipId }, true)); }
    if (action === "observations" && method === "POST") { assertCan(actor.role, "monitoring.note.write"); const data = z.object({ observation: z.string().trim().min(1).max(4000) }).strict().parse(await body(request)); await service.assessment(db, actor.organizationId, id); await db.transaction(async (tx) => { await tx.insert(s.assessmentObservations).values({ ...data, organizationId: actor.organizationId, assessmentId: id, authorId: actor.membershipId }); await recordAudit(tx, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action: "assessment.observation", entityType: "assessments", entityId: id }); }); return jsonOk({ saved: true }); }
    if (action === "withdraw" && method === "POST") { assertCan(actor.role, "assessment.withdraw"); reasonInput.parse(await body(request)); await db.transaction(async (tx) => { await service.assessment(tx, actor.organizationId, id); await tx.update(s.assessments).set({ status: "withdrawn" }).where(eq(s.assessments.id, id)); await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(eq(s.intakeSessions.assessmentId, id)); await recordAudit(tx, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action: "assessment.withdraw", entityType: "assessments", entityId: id }); }); return jsonOk({ withdrawn: true }); }
  }
  if (domain === "intake-sessions" && action === "revoke" && method === "POST") return jsonOk(await service.revokeSession(actor, id, await body(request)));
  if (domain === "instruments") {
    assertCan(actor.role, "assessment.internal.read"); await service.ensureInstrument(db);
    if (method === "GET") return jsonOk({ definition: INSTRUMENT_DEFINITION, contentHash: (await db.select().from(s.instrumentVersions))[0].contentHash, approvals: await db.select().from(s.instrumentApprovals).where(eq(s.instrumentApprovals.organizationId, actor.organizationId)).orderBy(desc(s.instrumentApprovals.approvedAt)) });
    if (id === INSTRUMENT_DEFINITION.version && ["approvals", "revocations"].includes(action) && method === "POST") return jsonOk(await service.instrumentDecision(actor, action as "approvals" | "revocations", await body(request)));
  }
  if (domain === "attachments") {
    assertCan(actor.role, method === "GET" ? "assessment.internal.read" : "profile.intake.write");
    if (id && action === "content" && method === "GET") return mediaContent(actor.organizationId, id);
    if (!id && method === "POST") { const { file, assessmentId } = await uploadedFile(request); if (!assessmentId) throw new ValidationError(); return jsonOk(await uploadMedia(actor.organizationId, assessmentId, file, { type: "staff", membershipId: actor.membershipId })); }
  }
  if (domain === "guardian-links" && id && method === "PATCH") { assertCan(actor.role, "profile.intake.write"); const data = z.object({ revision: z.number().int().min(1), contactSafety: z.enum(["safe", "unsafe", "unknown"]), contactReviewNote: z.string().trim().min(5).max(1000) }).strict().parse(await body(request)); const rows = await db.update(s.childGuardians).set({ ...data, revision: data.revision + 1, contactReviewBy: actor.membershipId, contactReviewAt: new Date() }).where(and(eq(s.childGuardians.id, id), eq(s.childGuardians.organizationId, actor.organizationId), eq(s.childGuardians.revision, data.revision))).returning(); if (!rows.length) throw new NotFoundError(); return jsonOk(rows[0]); }
  throw new NotFoundError();
});
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
