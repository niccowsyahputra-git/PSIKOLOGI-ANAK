import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as t from "@/lib/db/template-schema";
import { staffMemberships } from "@/lib/db/domain-schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { PermissionDeniedError } from "@/lib/permissions";
import * as service from "@/server/services/template.service";
import { builderFixture, publishedTemplate, sampleDefinition } from "../helpers/builder-fixture";
let f: Awaited<ReturnType<typeof builderFixture>>;
beforeAll(async () => { f = await builderFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });
const note = "Ditinjau dengan catatan manusia";

describe("template authoring and publication", () => {
  it("restricts draft editing and reading, including another organization", async () => {
    await expect(service.createTemplate(f.caregiver, { name: "Dilarang" })).rejects.toThrow(PermissionDeniedError);
    const draft = await service.createTemplate(f.admin, { name: "Template privat" });
    await expect(service.versionDetail(f.outsider, draft.version.id)).rejects.toThrow(NotFoundError);
    await expect(service.versionDetail(f.caregiver, draft.version.id)).rejects.toThrow(PermissionDeniedError);
    expect((await service.listTemplates(f.caregiver)).rows).toHaveLength(0);
    expect((await service.versionDetail(f.psychologist, draft.version.id)).definition.name).toBe("Template privat");
  });
  it("round-trips normalized rows, rejects stale saves and type reuse", async () => {
    const draft = await service.createTemplate(f.admin, { name: "Template normalisasi" }); const definition = sampleDefinition();
    const saved = await service.saveDraft(f.admin, draft.version.id, { revision: 1, definition });
    expect(saved.definition).toEqual(definition); expect(saved.version.revision).toBe(2);
    await expect(service.saveDraft(f.admin, draft.version.id, { revision: 1, definition })).rejects.toThrow(ConflictError);
    definition.questions[0].type = "short_text";
    await expect(service.saveDraft(f.admin, draft.version.id, { revision: 2, definition })).rejects.toThrow();
    expect((await service.versionDetail(f.admin, draft.version.id)).definition).toEqual(saved.definition);
  });
  it("requires a separate verified psychologist and never publishes from a draft", async () => {
    let d = await service.createTemplate(f.admin, { name: "Tinjauan wajib" });
    d = await service.saveDraft(f.admin, d.version.id, { revision: 1, definition: sampleDefinition() });
    await expect(service.transitionVersion(f.admin, d.version.id, "publish", { revision: d.version.revision, note })).rejects.toThrow(ConflictError);
    d = await service.transitionVersion(f.admin, d.version.id, "submit-review", { revision: d.version.revision, note });
    await expect(service.transitionVersion(f.admin, d.version.id, "review", { revision: d.version.revision, note, decision: "approved" })).rejects.toThrow(PermissionDeniedError);
    await expect(service.transitionVersion(f.admin, d.version.id, "publish", { revision: d.version.revision, note })).rejects.toThrow(ForbiddenError);
    await f.db.update(staffMemberships).set({ credentialVerifiedAt: null }).where(eq(staffMemberships.id, f.psychologist.membershipId));
    await expect(service.transitionVersion(f.psychologist, d.version.id, "review", { revision: d.version.revision, note, decision: "approved" })).rejects.toThrow(ForbiddenError);
    await f.db.update(staffMemberships).set({ credentialVerifiedAt: new Date() }).where(eq(staffMemberships.id, f.psychologist.membershipId));
  });
  it("invalidates approval on return to draft and retains review snapshots", async () => {
    let d = await service.createTemplate(f.admin, { name: "Perbaikan review" });
    d = await service.saveDraft(f.admin, d.version.id, { revision: 1, definition: sampleDefinition() });
    d = await service.transitionVersion(f.admin, d.version.id, "submit-review", { revision: d.version.revision, note });
    d = await service.transitionVersion(f.psychologist, d.version.id, "review", { revision: d.version.revision, note, decision: "approved" });
    const approvedHash = d.version.contentHash;
    d = await service.transitionVersion(f.psychologist, d.version.id, "review", { revision: d.version.revision, note, decision: "changes_requested" });
    d.definition.questions[0].label = "Kalimat diperjelas";
    d = await service.saveDraft(f.admin, d.version.id, { revision: d.version.revision, definition: d.definition });
    expect(d.version.contentHash).not.toBe(approvedHash);
    expect(d.reviews.find((r) => r.decision === "approved")?.snapshotJson).not.toContain("Kalimat diperjelas");
    d = await service.transitionVersion(f.admin, d.version.id, "submit-review", { revision: d.version.revision, note });
    await expect(service.transitionVersion(f.admin, d.version.id, "publish", { revision: d.version.revision, note })).rejects.toThrow(ForbiddenError);
  });
  it("publishes new versions without changing older labels, IDs, or hashes", async () => {
    const first = await publishedTemplate(f); const v1 = first.version;
    let next = await service.cloneVersion(f.admin, v1.templateId, { sourceVersionId: v1.id });
    expect(next.version.number).toBe(2); expect(next.definition.questions[0].id).toBe(first.definition.questions[0].id);
    await expect(service.cloneVersion(f.admin, v1.templateId, { sourceVersionId: v1.id })).rejects.toThrow(ConflictError);
    next.definition.questions[0].label = "Penghasilan reguler tersedia?";
    next = await service.saveDraft(f.admin, next.version.id, { revision: next.version.revision, definition: next.definition });
    next = await service.transitionVersion(f.admin, next.version.id, "submit-review", { revision: next.version.revision, note });
    next = await service.transitionVersion(f.psychologist, next.version.id, "review", { revision: next.version.revision, note, decision: "approved" });
    const attempts = await Promise.allSettled([service.transitionVersion(f.admin, next.version.id, "publish", { revision: next.version.revision, note }), service.transitionVersion(f.admin, next.version.id, "publish", { revision: next.version.revision, note })]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const old = await service.versionDetail(f.admin, v1.id);
    expect(old.definition).toEqual(first.definition); expect(old.version.contentHash).toBe(v1.contentHash); expect(old.version.status).toBe("archived");
    expect((await service.activeTemplate(f.caregiver, v1.templateId)).version.id).toBe(next.version.id);
    const history = await service.templateAuditHistory(f.admin, v1.templateId);
    expect(history.map((r) => r.action)).toContain("form.publish");
    expect(JSON.stringify(history)).not.toContain("Penghasilan reguler");
  });
  it("enforces frozen definitions and append-only history through actual SQL writes", async () => {
    const d = await publishedTemplate(f); const id = d.version.id;
    await expect(f.db.update(t.templateVersions).set({ status: "draft", publishedAt: null }).where(eq(t.templateVersions.id, id))).rejects.toThrow();
    await expect(f.db.update(t.templateVersions).set({ metadataJson: "{}" }).where(eq(t.templateVersions.id, id))).rejects.toThrow();
    await expect(f.db.update(t.templateVersions).set({ organizationId: f.outsider.organizationId }).where(eq(t.templateVersions.id, id))).rejects.toThrow();
    await expect(f.db.delete(t.templateVersions).where(eq(t.templateVersions.id, id))).rejects.toThrow();
    await expect(f.db.update(t.assessmentQuestions).set({ dataJson: "{}" }).where(eq(t.assessmentQuestions.versionId, id))).rejects.toThrow();
    await expect(f.db.delete(t.assessmentSections).where(eq(t.assessmentSections.versionId, id))).rejects.toThrow();
    await expect(f.db.insert(t.assessmentSections).values({ versionId: id, sectionId: crypto.randomUUID(), position: 3, dataJson: "{}" })).rejects.toThrow();
    await expect(f.db.delete(t.templateReviews).where(eq(t.templateReviews.versionId, id))).rejects.toThrow();
    await expect(f.db.update(t.assessmentPublications).set({ contentHash: "bad" }).where(eq(t.assessmentPublications.versionId, id))).rejects.toThrow();
    expect((await f.db.all(sql`PRAGMA foreign_key_check`))).toHaveLength(0);
    const logs = await f.db.all(sql`SELECT * FROM assessment_audit_logs WHERE organization_id=${f.admin.organizationId}`); expect(logs.length).toBeGreaterThan(0);
  });
  it("revokes collection eligibility without deleting the published snapshot", async () => {
    const d = await publishedTemplate(f);
    await service.transitionVersion(f.chair, d.version.id, "revoke", { revision: d.version.revision, note });
    const row = await service.loadVersion(f.db, f.admin.organizationId, d.version.id);
    await expect(service.assertVersionApproved(f.db, row)).rejects.toThrow(ForbiddenError);
    await expect(service.activeTemplate(f.admin, row.templateId)).rejects.toThrow(NotFoundError);
    expect((await service.versionDetail(f.admin, row.id)).definition).toEqual(d.definition);
  });
});
