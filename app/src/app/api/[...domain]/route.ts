import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { assertMutationOrigin, jsonOk, withApiHandler } from "@/lib/api";
import { getStaffSession, requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import * as s from "@/lib/db/assessment-schema";
import { getEnv } from "@/lib/env";
import { assertCan } from "@/lib/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { INSTRUMENT_DEFINITION } from "@/lib/instruments";
import * as service from "@/server/services/assessment.service";
import * as aiService from "@/server/services/ai.service";
import * as aiChatService from "@/server/services/ai-chat.service";
import { uploadMedia, mediaContent, MAX_IMAGE_BYTES } from "@/server/services/media.service";
import { recordAudit } from "@/server/services/audit.service";
import { reasonInput } from "@/lib/validation/assessment.schema";
import { boundedJson } from "@/lib/bounded-body";
import * as templates from "@/server/services/template.service";
import * as responses from "@/server/services/response.service";
import * as questionAi from "@/server/services/question-ai.service";
import { responseMediaContent, responseUploadBody, uploadResponseMedia } from "@/server/services/response-media.service";

async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 100000) throw new ValidationError("Permintaan terlalu besar");
  const raw = await request.text(); if (raw.length > 100000) throw new ValidationError("Permintaan terlalu besar");
  try { return JSON.parse(raw); } catch { throw new ValidationError("JSON tidak valid"); }
}
async function uploadedFile(request: Request): Promise<{ file: File; assessmentId: string | null }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 100000) throw new ValidationError("Gambar maksimal 5 MB");
  const form = await request.formData(); const file = form.get("file"); if (!(file instanceof File)) throw new ValidationError("Gambar diperlukan"); const id = form.get("assessmentId"); return { file, assessmentId: typeof id === "string" ? id : null };
}
const handler = withApiHandler(async (request: NextRequest, context: { params: Promise<{ domain: string[] }> }) => {
  const paths = (await context.params).domain; const [domain, id, action, extra] = paths; const method = request.method; if (paths.length > 4) throw new NotFoundError();
  if (method !== "GET") {
    const env = getEnv();
    assertMutationOrigin(request, [env.appBaseUrl, env.betterAuthUrl]);
  }
  const jar = await cookies();
  if (domain === "intake") {
    if (id === "exchange" && !action && method === "POST") {
      const data = z.object({ sessionId: z.uuid(), token: z.string().min(20).max(100) }).strict().parse(await body(request)); const staff = await getStaffSession();
      const exchange = data.token.startsWith(responses.DYNAMIC_TOKEN_PREFIX) ? responses.exchangeDynamic : service.exchangeIntake;
      const result = await exchange(data.sessionId, data.token, staff ? toStaffActor(staff) : null);
      const response = jsonOk({ exchanged: true }); response.cookies.set(service.INTAKE_COOKIE, result.secret, { httpOnly: true, sameSite: "strict", secure: new URL(getEnv().appBaseUrl).protocol === "https:", path: "/", expires: result.expiresAt });
      for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data"]) response.cookies.set(name, "", { path: "/", maxAge: 0, expires: new Date(0) }); return response;
    }
    const intakeSecret = jar.get(service.INTAKE_COOKIE)?.value;
    if (intakeSecret?.startsWith(responses.DYNAMIC_TOKEN_PREFIX)) {
      if (id === "end" && !action && method === "POST") { const response = jsonOk(await responses.endDynamicSession(intakeSecret)); response.cookies.set(service.INTAKE_COOKIE, "", { path: "/", maxAge: 0, expires: new Date(0) }); return response; }
      const session = await responses.resolveDynamic(intakeSecret); const participant = { type: "participant" as const, sessionId: session.id };
      if (id === "current" && !action && method === "GET") return jsonOk(await responses.dynamicWire(session));
      if (!action && (id === "current" && method === "PATCH" || id === "submit" && method === "POST")) {
        await responses.saveResponse(session.organizationId, session.responseId, await boundedJson(request), participant, id === "submit");
        return jsonOk(await responses.dynamicWire(session));
      }
      if (id === "attachments" && action && extra === "content" && method === "GET") return responseMediaContent(session.organizationId, action, participant);
      if (id === "attachments" && !action && method === "POST") { const upload = await responseUploadBody(request); if (upload.responseId !== null) throw new ValidationError("Response ditentukan sesi, bukan klien."); return jsonOk(await uploadResponseMedia(session.organizationId, session.responseId, upload.questionId, upload.file, participant)); }
      throw new NotFoundError();
    }
    const scoped = await service.resolveIntake(intakeSecret); const db = await getDbReady(); const actor = { type: "participant" as const, sessionId: scoped.id };
    if (id === "current" && method === "GET") return jsonOk(service.participantWire(await service.assessment(db, scoped.organizationId, scoped.assessmentId), await service.cycle(db, scoped.organizationId, scoped.cycleId)));
    if ((id === "current" && method === "PATCH") || (id === "submit" && method === "POST")) { const a = await service.saveAssessment(db, scoped.organizationId, scoped.assessmentId, await body(request), actor, id === "submit"); return jsonOk(service.participantWire(a, await service.cycle(db, scoped.organizationId, scoped.cycleId))); }
    if (id === "attachments" && action && extra === "content" && method === "GET") return mediaContent(scoped.organizationId, action, scoped);
    if (id === "attachments" && !action && method === "POST") { const { file } = await uploadedFile(request); return jsonOk(await uploadMedia(scoped.organizationId, scoped.assessmentId, file, actor)); }
    if (id === "end" && method === "POST") { await db.transaction(async (tx) => { await service.validSession(tx, scoped.id); await tx.update(s.intakeSessions).set({ revokedAt: new Date() }).where(eq(s.intakeSessions.id, scoped.id)); await recordAudit(tx, { organizationId: scoped.organizationId, actor, action: "intake_session.end", entityType: "intake_sessions", entityId: scoped.id }); }); const response = jsonOk({ ended: true }); response.cookies.set(service.INTAKE_COOKIE, "", { path: "/", maxAge: 0, expires: new Date(0) }); return response; }
    throw new NotFoundError();
  }
  if (jar.get(service.INTAKE_COOKIE)?.value) throw new ForbiddenError("Sesi peserta tidak dapat mengakses aplikasi staf");
  const contextStaff = await requireStaffSessionForApi(); const actor = toStaffActor(contextStaff); const db = await getDbReady(); await service.activeActor(db, actor);
  if (domain === "assessment-responses") {
    if (extra) throw new NotFoundError();
    if (!id && method === "GET") return jsonOk(await responses.listResponses(actor, Object.fromEntries(request.nextUrl.searchParams)));
    if (!id && method === "POST") return jsonOk(await responses.createResponse(actor, await boundedJson(request)), { status: 201 });
    if (id && !action && method === "GET") return jsonOk(await responses.responseDetail(actor, id));
    if (id && !action && method === "PATCH" || id && action === "submit" && method === "POST") return jsonOk(await responses.saveResponse(actor.organizationId, id, await boundedJson(request), { type: "staff", staff: actor }, action === "submit"));
    if (id && action === "sessions" && method === "POST") { z.object({}).strict().parse(await boundedJson(request)); return jsonOk(await responses.createResponseSession(actor, id)); }
    if (id && action === "withdraw" && method === "POST") return jsonOk(await responses.withdrawResponse(actor, id, await boundedJson(request)));
    if (id && action === "corrections" && method === "POST") return jsonOk(await responses.correctResponse(actor, id, await boundedJson(request)), { status: 201 });
    throw new NotFoundError();
  }
  if (domain === "response-sessions") {
    if (id && action === "revoke" && !extra && method === "POST") return jsonOk(await responses.revokeResponseSession(actor, id, await boundedJson(request)));
    throw new NotFoundError();
  }
  if (domain === "response-attachments") {
    if (extra) throw new NotFoundError();
    if (id && action === "content" && method === "GET") return responseMediaContent(actor.organizationId, id, { type: "staff", staff: actor });
    if (!id && method === "POST") { const upload = await responseUploadBody(request); const responseId = z.uuid().parse(upload.responseId); return jsonOk(await uploadResponseMedia(actor.organizationId, responseId, upload.questionId, upload.file, { type: "staff", staff: actor })); }
    throw new NotFoundError();
  }
  if (domain === "assessment-templates") {
    if (extra) throw new NotFoundError();
    if (!id && method === "GET") return jsonOk(await templates.listTemplates(actor, Object.fromEntries(request.nextUrl.searchParams)));
    if (!id && method === "POST") return jsonOk(await templates.createTemplate(actor, await boundedJson(request)), { status: 201 });
    if (id && !action && method === "GET") return jsonOk(await templates.templateDetail(actor, id));
    if (id && action === "versions" && method === "POST") return jsonOk(await templates.cloneVersion(actor, id, await boundedJson(request)), { status: 201 });
    if (id && action === "active" && method === "GET") return jsonOk(await templates.activeTemplate(actor, id));
    if (id && action === "history" && method === "GET") return jsonOk(await templates.templateDetail(actor, id));
    if (id && action === "audit" && method === "GET") return jsonOk(await templates.templateAuditHistory(actor, id));
    throw new NotFoundError();
  }
  if (domain === "ai-question-jobs") {
    if (id && !action && !extra && method === "GET") return jsonOk(await questionAi.questionJobDetail(actor, id));
    throw new NotFoundError();
  }
  if (domain === "ai-question-candidates") {
    if (id && action === "decision" && !extra && method === "POST") return jsonOk(await questionAi.decideQuestionCandidate(actor, id, await boundedJson(request)));
    throw new NotFoundError();
  }
  if (domain === "template-versions") {
    if (!id || extra) throw new NotFoundError();
    if (action === "ai-drafts" && method === "POST") return jsonOk(await questionAi.generateQuestionDrafts(actor, id, await boundedJson(request)), { status: 201 });
    if (action === "ai-drafts" && method === "GET") return jsonOk(await questionAi.listQuestionJobs(actor, id));
    if (!action && method === "GET") return jsonOk(await templates.versionDetail(actor, id));
    if (!action && method === "PATCH") return jsonOk(await templates.saveDraft(actor, id, await boundedJson(request)));
    if ((action === "validate" || action === "preview") && method === "POST") return jsonOk(await templates.validateDraft(actor, id, await boundedJson(request)));
    if (method === "POST" && ["submit-review", "review", "publish", "archive", "revoke"].includes(action)) return jsonOk(await templates.transitionVersion(actor, id, action as "submit-review" | "review" | "publish" | "archive" | "revoke", await boundedJson(request)));
    throw new NotFoundError();
  }
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
  if (domain === "ai") {
    if (id === "availability" && method === "GET") return jsonOk(await aiService.aiAvailability(actor));
    if (id === "analyses" && !action && method === "POST") return jsonOk(await aiService.generateAnalysis(actor, await body(request)), { status: 201 });
    if (id === "analyses" && action && !extra && method === "GET") return jsonOk(await aiService.analysisDetail(actor, action));
    if (id === "analyses" && action && extra === "reviews" && method === "POST") return jsonOk(await aiService.reviewAnalysis(actor, action, await body(request)), { status: 201 });
  }
  // Own top-level domain rather than `ai/chat/threads/...`: the router above
  // rejects more than four segments, which that nesting would exceed.
  if (domain === "ai-chat") {
    if (!id && method === "GET") return jsonOk({ threads: await aiChatService.listThreads(actor) });
    if (!id && method === "POST") return jsonOk(await aiChatService.createThread(actor, await body(request)), { status: 201 });
    if (id && !action && method === "GET") return jsonOk(await aiChatService.threadDetail(actor, id));
    if (id && action === "messages" && !extra && method === "POST") return jsonOk(await aiChatService.postMessage(actor, id, await body(request)), { status: 201 });
  }
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
