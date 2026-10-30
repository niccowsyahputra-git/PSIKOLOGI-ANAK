import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { builderFixture, sampleDefinition } from "../helpers/builder-fixture";
import * as templates from "@/server/services/template.service";
import * as ai from "@/server/services/question-ai.service";
import * as legacy from "@/server/services/assessment.service";
import { createResponse } from "@/server/services/response.service";
import { ensureAiSettings, updateAiSettingsRow, type AiSettingsPatch } from "@/server/repositories/ai-settings.repository";
import { aiQuestionJobs, aiQuestionCandidates, aiQuestionDecisions } from "@/lib/db/question-ai-schema";
import { aiUsageCounters } from "@/lib/db/ai-schema";
import { auditLogs, staffMemberships } from "@/lib/db/domain-schema";
import { aiConfigFingerprint } from "@/lib/ai/config";
import { mockQuestionOutput, type QuestionOutput } from "@/lib/assessment-builder/ai-output";
import { ConflictError, ForbiddenError, NotFoundError, NotReadyError, RateLimitError, UnauthenticatedError } from "@/lib/errors";
import { PermissionDeniedError } from "@/lib/permissions";
import { reserveQuota, todayKey } from "@/server/services/ai.service";

let f: Awaited<ReturnType<typeof builderFixture>>;
beforeEach(async () => { f = await builderFixture(); });
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); if (f) await f.cleanup(); });
async function configure(patch: AiSettingsPatch = {}) {
  const current = await ensureAiSettings(f.db, f.admin.organizationId);
  const updated = await updateAiSettingsRow(f.db, { organizationId: f.admin.organizationId, expectedRevision: current.revision, patch: { enabled: true, mode: "mock", dailyLimit: 50, ...patch } });
  return updated!;
}
async function local() {
  const settings = await configure({ mode: "local_endpoint", baseUrl: "http://127.0.0.1:11434", model: "fixture-local", maxTokens: 2000 });
  await updateAiSettingsRow(f.db, { organizationId: f.admin.organizationId, expectedRevision: settings.revision, patch: { lastTestStatus: "passed", lastTestFingerprint: aiConfigFingerprint(settings) } });
}
async function draft() {
  const created = await templates.createTemplate(f.admin, { name: "Question suggestions fixture" });
  return templates.saveDraft(f.admin, created.version.id, { revision: 1, definition: sampleDefinition() });
}
function request(detail: Awaited<ReturnType<typeof draft>>) {
  return { revision: detail.version.revision, idempotencyKey: crypto.randomUUID(), instructions: "Suggest supportive fictional intake questions", target: detail.definition.target, count: 2, sources: [{ versionId: detail.version.id, questionId: detail.definition.questions[0].id }] };
}
function output(): QuestionOutput { return mockQuestionOutput({ instructions: "Fixture", target: "both", count: 2, sources: [] }); }
function stub(outputValue: unknown = output()) {
  const fetchSpy = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: typeof outputValue === "string" ? outputValue : JSON.stringify(outputValue) } }] })));
  vi.stubGlobal("fetch", fetchSpy); return fetchSpy;
}
const note = "Reviewed as an unvalidated intake suggestion";
async function usage() { return (await f.db.select().from(aiUsageCounters).where(eq(aiUsageCounters.organizationId, f.admin.organizationId)))[0]; }

describe("local question drafting service and migration guards", () => {
  it("requires active admin, same organization, exact revision, and ready settings", async () => {
    const d = await draft(); const body = request(d);
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, body)).rejects.toThrow(NotReadyError);
    await configure();
    for (const actor of [f.caregiver, f.psychologist, f.chair]) await expect(ai.generateQuestionDrafts(actor, d.version.id, body)).rejects.toThrow(PermissionDeniedError);
    await expect(ai.generateQuestionDrafts(f.outsider, d.version.id, body)).rejects.toThrow(NotFoundError);
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, { ...body, revision: 100 })).rejects.toThrow(ConflictError);
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, { ...body, score: 1 })).rejects.toThrow();
    await f.db.update(staffMemberships).set({ active: false }).where(eq(staffMemberships.id, f.admin.membershipId));
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, body)).rejects.toThrow(UnauthenticatedError);
  });

  it("makes no network call in mock mode, keeps candidates separate, and replays without quota", async () => {
    await configure(); const d = await draft(); const body = request(d);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("No network allowed")); vi.stubGlobal("fetch", fetchSpy);
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, body);
    expect(result.job.status).toBe("succeeded"); expect(result.job.origin).toBe("mock");
    expect(result.candidates).toHaveLength(2); expect(fetchSpy).not.toHaveBeenCalled();
    expect((await templates.versionDetail(f.admin, d.version.id)).definition).toEqual(d.definition);
    expect((await ai.generateQuestionDrafts(f.admin, d.version.id, body)).job.id).toBe(result.job.id);
    expect(await usage()).toMatchObject({ requestCount: 1, reservedCount: 0, mockCount: 1 });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, { ...body, instructions: "Different request" })).rejects.toThrow(ConflictError);
    expect((await ai.questionJobDetail(f.psychologist, result.job.id)).candidates).toHaveLength(2);
    await expect(ai.questionJobDetail(f.outsider, result.job.id)).rejects.toThrow(NotFoundError);
    await expect(ai.questionJobDetail(f.caregiver, result.job.id)).rejects.toThrow(PermissionDeniedError);
    const audits = await f.db.select().from(auditLogs).where(eq(auditLogs.entityId, result.job.id));
    expect(JSON.stringify(audits)).not.toContain(body.instructions);
    expect(await f.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it("accepts once under revision control and preserves provenance through edits and duplication", async () => {
    await configure(); const d = await draft(); const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    const candidate = result.candidates[0]; const body = { revision: d.version.revision, decision: "accept", note };
    await expect(ai.decideQuestionCandidate(f.caregiver, candidate.id, body)).rejects.toThrow(PermissionDeniedError);
    await expect(ai.decideQuestionCandidate(f.outsider, candidate.id, body)).rejects.toThrow(NotFoundError);
    const first = await ai.decideQuestionCandidate(f.admin, candidate.id, body);
    expect((await ai.decideQuestionCandidate(f.admin, candidate.id, body)).id).toBe(first.id);
    await expect(ai.decideQuestionCandidate(f.admin, candidate.id, { ...body, decision: "reject" })).rejects.toThrow(ConflictError);
    let saved = await templates.versionDetail(f.admin, d.version.id);
    expect(saved.version).toMatchObject({ status: "draft", demoOnly: true, revision: d.version.revision + 1 });
    expect(saved.definition.questions.at(-1)?.provenance).toEqual({ origin: "mock", candidateId: candidate.id });
    const q = saved.definition.questions.at(-1)!;
    q.label = "Human edited wording"; q.provenance = { origin: "manual" };
    saved = await templates.saveDraft(f.admin, d.version.id, { revision: saved.version.revision, definition: saved.definition });
    expect(saved.definition.questions.at(-1)?.provenance.origin).toBe("mock");
    saved.definition.questions.push({ ...saved.definition.questions.at(-1)!, id: crypto.randomUUID() });
    saved = await templates.saveDraft(f.admin, d.version.id, { revision: saved.version.revision, definition: saved.definition });
    expect(saved.definition.questions.at(-1)?.provenance.candidateId).toBe(candidate.id);
    await expect(ai.decideQuestionCandidate(f.admin, result.candidates[1].id, { ...body, decision: "reject" })).rejects.toThrow(ConflictError);
    await ai.decideQuestionCandidate(f.admin, result.candidates[1].id, { ...body, revision: saved.version.revision, decision: "reject" });
    expect((await templates.versionDetail(f.admin, d.version.id)).version.revision).toBe(saved.version.revision);
  });

  it("locks candidate identity/type/provenance and rejects executable edited content", async () => {
    await configure(); const d = await draft(); const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    const c = result.candidates[0];
    for (const changes of [{ id: crypto.randomUUID() }, { type: "yes_no" }, { provenance: { origin: "manual", candidateId: null } }, { label: "<script>danger()</script>" }, { instructions: "data:text/html,unsafe" }, { label: "onclick=unsafe()" }, { score: 5 }]) {
      await expect(ai.decideQuestionCandidate(f.admin, c.id, { revision: d.version.revision, decision: "edit_and_accept", note, question: { ...c.question, ...changes } })).rejects.toThrow();
    }
    await ai.decideQuestionCandidate(f.admin, c.id, { revision: d.version.revision, decision: "edit_and_accept", note, question: { ...c.question, label: "Human reviewed supportive question" } });
    expect((await templates.versionDetail(f.admin, d.version.id)).definition.questions.at(-1)?.label).toBe("Human reviewed supportive question");
  });

  it("uses only selected definitions and refuses other-organization and duplicate sources", async () => {
    await local(); const d = await draft(); const body = request(d); const fetchSpy = stub();
    await legacy.createProfile(f.admin, "children", { name: "PRIVATE CHILD MARKER", fictional: true, estimatedAge: 12, ageReferenceDate: "2026-10-01", notes: "PRIVATE NOTES MARKER" });
    const other = await templates.createTemplate(f.outsider, { name: "Other organization source" });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, { ...body, sources: [{ versionId: other.version.id, questionId: crypto.randomUUID() }] })).rejects.toThrow(NotFoundError);
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, { ...body, sources: [body.sources[0], body.sources[0]] })).rejects.toThrow();
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, body);
    expect(result.job.status).toBe("succeeded"); expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = fetchSpy.mock.calls[0][1].body as string;
    expect(payload).toContain(d.definition.questions[0].label);
    expect(payload).not.toContain(d.definition.questions[1].label);
    expect(payload).not.toContain("PRIVATE CHILD MARKER"); expect(payload).not.toContain("PRIVATE NOTES MARKER");
    expect(result.job.input.sources[0].hash).toHaveLength(64);
  });

  it("requires current local configuration testing and forbids remote configuration", async () => {
    const d = await draft(); const body = request(d); const fetchSpy = stub();
    await configure({ mode: "local_endpoint", baseUrl: "http://127.0.0.1:11434", model: "fixture-local" });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, body)).rejects.toThrow(NotReadyError);
    await local(); await configure({ mode: "local_endpoint", temperature: 0.91 });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, body)).rejects.toThrow(NotReadyError);
    await configure({ mode: "remote_endpoint" });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, body)).rejects.toThrow(ForbiddenError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("settles failed malformed generation with no partial output or automatic retry", async () => {
    await local(); const d = await draft(); const body = request(d); const malformed = output();
    malformed.questions[1].sourceRefs = ["fabricated"];
    const fetchSpy = stub(malformed);
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, body);
    expect(result.job.status).toBe("failed"); expect(result.candidates).toEqual([]);
    expect(await usage()).toMatchObject({ requestCount: 1, reservedCount: 0 });
    await ai.generateQuestionDrafts(f.admin, d.version.id, body);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await templates.versionDetail(f.admin, d.version.id)).definition).toEqual(d.definition);
  });

  it("rejects dangling follow-ups until their parent is accepted; rejection does not insert dependencies", async () => {
    await local(); const d = await draft(); const o = output();
    o.questions[0].type = "yes_no"; o.questions[1].condition = { questionKey: "q1", operator: "equals", value: true }; stub(o);
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    expect(result.job.status).toBe("succeeded");
    const [parent, child] = result.candidates; const body = { revision: d.version.revision, decision: "accept", note };
    await expect(ai.decideQuestionCandidate(f.admin, child.id, body)).rejects.toThrow();
    const accepted = await ai.decideQuestionCandidate(f.admin, parent.id, body);
    await ai.decideQuestionCandidate(f.admin, child.id, { ...body, revision: accepted.appliedRevision });
    const next = await ai.generateQuestionDrafts(f.admin, d.version.id, { ...request(d), revision: accepted.appliedRevision + 1 });
    await ai.decideQuestionCandidate(f.admin, next.candidates[0].id, { ...body, revision: accepted.appliedRevision + 1, decision: "reject" });
    await expect(ai.decideQuestionCandidate(f.admin, next.candidates[1].id, { ...body, revision: accepted.appliedRevision + 1 })).rejects.toThrow();
  });

  it("requires explicit image policy before accepting file suggestions", async () => {
    await local(); const d = await draft(); const o = output(); o.questions[0].type = "file"; stub(o);
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    expect(result.job.status).toBe("succeeded");
    await expect(ai.decideQuestionCandidate(f.admin, result.candidates[0].id, { revision: d.version.revision, decision: "accept", note })).rejects.toThrow();
    d.definition.allowImages = true;
    const saved = await templates.saveDraft(f.admin, d.version.id, { revision: d.version.revision, definition: d.definition });
    await ai.decideQuestionCandidate(f.admin, result.candidates[0].id, { revision: saved.version.revision, decision: "accept", note });
  });

  it("keeps mock-derived templates demo-only after human edits, cloning, and local-model derivation", async () => {
    await configure(); let d = await draft(); const mock = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    await ai.decideQuestionCandidate(f.admin, mock.candidates[0].id, { revision: d.version.revision, decision: "accept", note });
    d = await templates.versionDetail(f.admin, d.version.id);
    d = await templates.transitionVersion(f.admin, d.version.id, "submit-review", { revision: d.version.revision, note });
    d = await templates.transitionVersion(f.psychologist, d.version.id, "review", { revision: d.version.revision, decision: "approved", note });
    d = await templates.transitionVersion(f.admin, d.version.id, "publish", { revision: d.version.revision, note });
    const child = await legacy.createProfile(f.admin, "children", { name: "Fictional real-policy fixture", fictional: false, estimatedAge: 12, ageReferenceDate: "2026-10-01" });
    await legacy.profileTransition(f.admin, "children", child.id, "verify", { revision: child.revision });
    const cycle = await legacy.createCycle(f.admin, child.id);
    await legacy.addAuthority(f.chair, cycle.id, { decision: "approved", lawfulBasisNote: "Fictional fixture authorization" });
    for (const type of ["intake", "assent"] as const) await legacy.addConsent(f.admin, cycle.id, { subjectType: "child", subjectId: child.id, type, status: "granted", actorType: type === "assent" ? "child" : "authorized_representative", noticeVersion: "test", authorityBasis: "Fictional consent" });
    await expect(createResponse(f.admin, { templateId: d.version.templateId, cycleId: cycle.id, target: "child" })).rejects.toThrow(/simulasi|fiktif/i);
    const clone = await templates.cloneVersion(f.admin, d.version.templateId, { sourceVersionId: d.version.id }); expect(clone.version.demoOnly).toBe(true);
    const dest = await draft(); await local(); stub();
    const localJob = await ai.generateQuestionDrafts(f.admin, dest.version.id, { ...request(dest), sources: [{ versionId: d.version.id, questionId: d.definition.questions[0].id }] });
    await ai.decideQuestionCandidate(f.admin, localJob.candidates[0].id, { revision: dest.version.revision, decision: "accept", note });
    expect((await templates.versionDetail(f.admin, dest.version.id)).version.demoOnly).toBe(true);
  });

  it("enforces five attempts per minute and the shared daily budget", async () => {
    await configure(); const d = await draft();
    for (let i = 0; i < 5; i++) await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, request(d))).rejects.toThrow(RateLimitError);
    expect(await usage()).toMatchObject({ requestCount: 5, reservedCount: 0 });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 61000);
    await configure({ dailyLimit: 5 });
    await expect(ai.generateQuestionDrafts(f.admin, d.version.id, request(d))).rejects.toThrow(RateLimitError);
  });

  it("recovers expired leases once, using their original quota date", async () => {
    await configure(); const d = await draft(); const id = crypto.randomUUID(); const date = "2026-01-01";
    await f.db.transaction(async (tx) => {
      await reserveQuota(tx, f.admin.organizationId, date, 50);
      await tx.insert(aiQuestionJobs).values({ id, organizationId: f.admin.organizationId, versionId: d.version.id, revision: d.version.revision, idempotencyKey: crypto.randomUUID(), requestHash: "a".repeat(64), inputJson: JSON.stringify({ instructions: "Fixture", target: "both", count: 2, sources: [] }), origin: "mock", model: "fixture", promptVersion: "p1", schemaVersion: "s1", settingsVersion: 1, quotaDate: date, generatedBy: f.admin.membershipId, leaseExpiresAt: new Date(Date.now() - 1000) });
    });
    expect((await ai.questionJobDetail(f.admin, id)).job.status).toBe("failed");
    await ai.listQuestionJobs(f.admin, d.version.id);
    expect(await usage()).toMatchObject({ dateKey: date, requestCount: 1, reservedCount: 0 });
  });

  it("discards late model output after lease recovery without double settlement", async () => {
    await local(); const d = await draft();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 300000);
      await ai.listQuestionJobs(f.admin, d.version.id);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output()) } }] }));
    }));
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    expect(result.job.status).toBe("failed"); expect(result.candidates).toEqual([]);
    expect(await usage()).toMatchObject({ requestCount: 1, reservedCount: 0 });
  });

  it("rolls back partial candidates on storage failure and releases the reservation", async () => {
    await configure(); const d = await draft();
    await f.db.run(sql`CREATE TRIGGER fixture_candidate_failure BEFORE INSERT ON ai_question_candidates WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`);
    const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    expect(result.job.status).toBe("failed"); expect(result.candidates).toEqual([]);
    expect(await usage()).toMatchObject({ requestCount: 1, reservedCount: 0 });
  });

  it("guards immutable completed jobs, candidates, decisions, and contextual inserts in SQL", async () => {
    await configure(); const d = await draft(); const result = await ai.generateQuestionDrafts(f.admin, d.version.id, request(d));
    const c = result.candidates[0];
    await expect(f.db.update(aiQuestionJobs).set({ status: "running" }).where(eq(aiQuestionJobs.id, result.job.id))).rejects.toThrow();
    await expect(f.db.delete(aiQuestionJobs).where(eq(aiQuestionJobs.id, result.job.id))).rejects.toThrow();
    await expect(f.db.update(aiQuestionCandidates).set({ originalJson: "{}" }).where(eq(aiQuestionCandidates.id, c.id))).rejects.toThrow();
    await expect(f.db.delete(aiQuestionCandidates).where(eq(aiQuestionCandidates.id, c.id))).rejects.toThrow();
    const decision = await ai.decideQuestionCandidate(f.admin, c.id, { revision: d.version.revision, decision: "reject", note });
    await expect(f.db.update(aiQuestionDecisions).set({ note: "rewrite" }).where(eq(aiQuestionDecisions.id, decision.id))).rejects.toThrow();
    await expect(f.db.delete(aiQuestionDecisions).where(eq(aiQuestionDecisions.id, decision.id))).rejects.toThrow();
    await expect(f.db.insert(aiQuestionJobs).values({ organizationId: f.outsider.organizationId, versionId: d.version.id, revision: d.version.revision, idempotencyKey: crypto.randomUUID(), requestHash: "a".repeat(64), inputJson: "{}", origin: "mock", model: "fixture", promptVersion: "p1", schemaVersion: "s1", settingsVersion: 1, quotaDate: todayKey("Asia/Jakarta"), generatedBy: f.outsider.membershipId, leaseExpiresAt: new Date(Date.now() + 60000) })).rejects.toThrow();
  });
});
