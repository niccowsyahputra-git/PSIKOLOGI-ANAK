import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, sql, count } from "drizzle-orm";
import { z } from "zod";
import { compileDefinition, emptyDefinition, remapDefinition, type Definition, type Question } from "@/lib/assessment-builder/definition";
import { sha256Hex } from "@/lib/crypto";
import { getDbReady, type AppDatabase } from "@/lib/db";
import * as s from "@/lib/db/template-schema";
import { auditLogs, staffMemberships } from "@/lib/db/domain-schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, can } from "@/lib/permissions";
import { activeActor } from "./assessment.service";
import { recordAudit } from "./audit.service";
import type { StaffActor } from "./staff.service";

export type TemplateExecutor = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;
export type VersionRow = typeof s.templateVersions.$inferSelect;
export const definitionHash = (d: Definition) => sha256Hex(JSON.stringify(d));
const editInput = z.object({ revision: z.number().int().positive(), definition: z.unknown() }).strict();
const actionInput = z.object({ revision: z.number().int().positive(), note: z.string().trim().min(5).max(2000), decision: z.enum(["approved", "changes_requested"]).optional() }).strict();
export const templateAudit = (tx: TemplateExecutor, actor: StaffActor, action: string, templateId: string, versionId?: string, metadata: Record<string, unknown> = {}) => recordAudit(tx, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action: `form.${action}`, entityType: "assessment_templates", entityId: templateId, metadata: { templateId, versionId, ...metadata } });

export async function loadVersion(tx: TemplateExecutor, org: string, id: string): Promise<VersionRow> {
  const [row] = await tx.select().from(s.templateVersions).where(and(eq(s.templateVersions.id, id), eq(s.templateVersions.organizationId, org)));
  if (!row) throw new NotFoundError();
  return row;
}
export async function loadTemplate(tx: TemplateExecutor, org: string, id: string) {
  const [row] = await tx.select().from(s.assessmentTemplates).where(and(eq(s.assessmentTemplates.id, id), eq(s.assessmentTemplates.organizationId, org)));
  if (!row) throw new NotFoundError();
  return row;
}
export async function readDefinition(tx: TemplateExecutor, row: VersionRow): Promise<Definition> {
  if (row.status !== "draft" && row.snapshotJson) {
    const definition = compileDefinition(JSON.parse(row.snapshotJson)).definition;
    if (definitionHash(definition) !== row.contentHash) throw new ConflictError("Snapshot template tidak sesuai hash.");
    return definition;
  }
  const sections = await tx.select().from(s.assessmentSections).where(eq(s.assessmentSections.versionId, row.id)).orderBy(asc(s.assessmentSections.position));
  const questions = await tx.select().from(s.assessmentQuestions).where(eq(s.assessmentQuestions.versionId, row.id)).orderBy(asc(s.assessmentQuestions.position));
  const options = await tx.select().from(s.assessmentQuestionOptions).where(eq(s.assessmentQuestionOptions.versionId, row.id)).orderBy(asc(s.assessmentQuestionOptions.position));
  const rules = await tx.select().from(s.assessmentConditionalRules).where(eq(s.assessmentConditionalRules.versionId, row.id));
  return compileDefinition({ ...JSON.parse(row.metadataJson), sections: sections.map((s) => JSON.parse(s.dataJson)), questions: questions.map((q) => ({ ...JSON.parse(q.dataJson), options: options.filter((o) => o.questionId === q.questionId).map((o) => JSON.parse(o.dataJson)), condition: JSON.parse(rules.find((r) => r.questionId === q.questionId)?.expressionJson ?? "null") })) }).definition;
}
async function writeRows(tx: TemplateExecutor, versionId: string, definition: Definition) {
  await tx.delete(s.assessmentConditionalRules).where(eq(s.assessmentConditionalRules.versionId, versionId));
  await tx.delete(s.assessmentQuestionOptions).where(eq(s.assessmentQuestionOptions.versionId, versionId));
  await tx.delete(s.assessmentQuestions).where(eq(s.assessmentQuestions.versionId, versionId));
  await tx.delete(s.assessmentSections).where(eq(s.assessmentSections.versionId, versionId));
  for (const [position, section] of definition.sections.entries()) await tx.insert(s.assessmentSections).values({ versionId, sectionId: section.id, position, dataJson: JSON.stringify(section) });
  for (const [position, question] of definition.questions.entries()) {
    const { options, condition, ...fields } = question;
    await tx.insert(s.assessmentQuestions).values({ versionId, questionId: question.id, sectionId: question.sectionId, position, dataJson: JSON.stringify(fields) });
    for (const [position, option] of options.entries()) await tx.insert(s.assessmentQuestionOptions).values({ versionId, questionId: question.id, optionId: option.id, position, dataJson: JSON.stringify(option) });
    if (condition) await tx.insert(s.assessmentConditionalRules).values({ versionId, questionId: question.id, expressionJson: JSON.stringify(condition) });
  }
}
const metadataOf = (definition: Definition) => {
  const { sections, questions, ...metadata } = definition;
  void sections; void questions;
  return JSON.stringify(metadata);
};
async function insertVersion(tx: TemplateExecutor, actor: StaffActor, templateId: string, number: number, definition: Definition, parent?: VersionRow) {
  const id = randomUUID();
  await tx.insert(s.templateVersions).values({ id, organizationId: actor.organizationId, templateId, number, parentVersionId: parent?.id, metadataJson: metadataOf(definition), contentHash: definitionHash(definition), demoOnly: parent?.demoOnly || definition.questions.some((q) => q.provenance.origin === "mock"), createdBy: actor.membershipId });
  await writeRows(tx, id, definition);
  return id;
}
export async function listTemplates(actor: StaffActor, input: unknown = {}) {
  assertCan(actor.role, "form.read"); const db = await getDbReady(); await activeActor(db, actor);
  const query = z.object({ q: z.string().max(200).default(""), category: z.string().max(100).default(""), status: z.enum(["draft", "in_review", "published", "archived"]).optional(), target: z.enum(["child", "guardian", "both"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().parse(input);
  const v = s.templateVersions;
  const publishedOnly = !can(actor.role, "form.draft.read");
  const filter = and(eq(v.organizationId, actor.organizationId), like(sql`json_extract(${v.metadataJson}, '$.name')`, `%${query.q}%`),
    query.category ? eq(sql`json_extract(${v.metadataJson}, '$.category')`, query.category) : undefined,
    query.target ? sql`json_extract(${v.metadataJson}, '$.target') in (${query.target}, 'both')` : undefined,
    publishedOnly ? eq(v.status, "published") : query.status ? eq(v.status, query.status) : undefined,
    publishedOnly ? sql`exists (select 1 from assessment_templates t join assessment_publications p on p.id=t.active_publication_id where t.id=${v.templateId} and p.version_id=${v.id})` : undefined);
  const [{ total }] = await db.select({ total: count() }).from(v).where(filter);
  const rows = await db.select().from(v).where(filter).orderBy(desc(v.createdAt), desc(v.number), desc(v.id)).limit(25).offset((query.page - 1) * 25);
  return { rows: rows.map(({ metadataJson, snapshotJson, ...row }) => { void snapshotJson; return { ...row, metadata: JSON.parse(metadataJson) as Omit<Definition, "sections" | "questions"> }; }), total, page: query.page };
}
export async function createTemplate(actor: StaffActor, input: unknown) {
  assertCan(actor.role, "form.write"); const data = z.object({ name: z.string().trim().min(3).max(200), sourceVersionId: z.uuid().optional() }).strict().parse(input);
  const db = await getDbReady();
  const id = await db.transaction(async (tx) => {
    await activeActor(tx, actor);
    const source = data.sourceVersionId ? await loadVersion(tx, actor.organizationId, data.sourceVersionId) : undefined;
    const definition = source ? remapDefinition(await readDefinition(tx, source)) : emptyDefinition(data.name);
    definition.name = data.name;
    const templateId = randomUUID();
    await tx.insert(s.assessmentTemplates).values({ id: templateId, organizationId: actor.organizationId, name: data.name, createdBy: actor.membershipId });
    const versionId = await insertVersion(tx, actor, templateId, 1, definition);
    if (source?.demoOnly) await tx.update(s.templateVersions).set({ demoOnly: true }).where(eq(s.templateVersions.id, versionId));
    await templateAudit(tx, actor, "create", templateId, versionId);
    return versionId;
  });
  return versionDetail(actor, id);
}
export async function cloneVersion(actor: StaffActor, templateId: string, input: unknown) {
  assertCan(actor.role, "form.write"); const { sourceVersionId } = z.object({ sourceVersionId: z.uuid() }).strict().parse(input); const db = await getDbReady();
  const id = await db.transaction(async (tx) => {
    await activeActor(tx, actor); await loadTemplate(tx, actor.organizationId, templateId);
    const source = await loadVersion(tx, actor.organizationId, sourceVersionId);
    if (source.templateId !== templateId) throw new NotFoundError();
    const working = await tx.select().from(s.templateVersions).where(and(eq(s.templateVersions.templateId, templateId), inArray(s.templateVersions.status, ["draft", "in_review"])));
    if (working.length) throw new ConflictError("Selesaikan atau arsipkan versi draft yang sudah ada.");
    const [{ maximum }] = await tx.select({ maximum: sql<number>`max(number)` }).from(s.templateVersions).where(eq(s.templateVersions.templateId, templateId));
    const next = await insertVersion(tx, actor, templateId, Number(maximum) + 1, await readDefinition(tx, source), source);
    await templateAudit(tx, actor, "clone", templateId, next, { sourceVersionId }); return next;
  });
  return versionDetail(actor, id);
}
export async function latestReview(tx: TemplateExecutor, versionId: string) {
  const [row] = await tx.select().from(s.templateReviews).where(eq(s.templateReviews.versionId, versionId)).orderBy(desc(s.templateReviews.createdAt), desc(s.templateReviews.id)).limit(1);
  return row ?? null;
}
export async function assertVersionApproved(tx: TemplateExecutor, row: VersionRow) {
  const review = await latestReview(tx, row.id);
  if (!review || review.decision !== "approved" || review.contentHash !== row.contentHash || review.revision !== row.revision) throw new ForbiddenError("Versi ini belum disetujui psikolog atau persetujuannya dicabut.");
  const [reviewer] = await tx.select().from(staffMemberships).where(and(eq(staffMemberships.id, review.actorId), eq(staffMemberships.organizationId, row.organizationId), eq(staffMemberships.active, true)));
  if (reviewer?.role !== "psikolog" || !reviewer.credentialVerifiedAt) throw new ForbiddenError("Psikolog pemberi persetujuan tidak lagi berwenang.");
  return review;
}
export async function versionDetail(actor: StaffActor, versionId: string) {
  assertCan(actor.role, "form.read"); const db = await getDbReady(); await activeActor(db, actor);
  const version = await loadVersion(db, actor.organizationId, versionId);
  if (!version.publishedAt) assertCan(actor.role, "form.draft.read");
  const definition = await readDefinition(db, version);
  const reviews = can(actor.role, "form.draft.read") || can(actor.role, "form.revoke") ? await db.select().from(s.templateReviews).where(eq(s.templateReviews.versionId, versionId)).orderBy(desc(s.templateReviews.createdAt), desc(s.templateReviews.id)) : [];
  return { version, definition, reviews, warnings: compileDefinition(definition).warnings };
}
export async function templateDetail(actor: StaffActor, id: string) {
  const db = await getDbReady(); await activeActor(db, actor); assertCan(actor.role, "form.draft.read");
  const template = await loadTemplate(db, actor.organizationId, id);
  const versions = await db.select().from(s.templateVersions).where(eq(s.templateVersions.templateId, id)).orderBy(desc(s.templateVersions.number));
  return { template, versions };
}
export async function activeTemplate(actor: StaffActor, id: string) {
  const db = await getDbReady(); await activeActor(db, actor); assertCan(actor.role, "form.read");
  const template = await loadTemplate(db, actor.organizationId, id);
  const [publication] = template.activePublicationId ? await db.select().from(s.assessmentPublications).where(eq(s.assessmentPublications.id, template.activePublicationId)) : [];
  if (!publication) throw new NotFoundError("Belum ada versi aktif.");
  const version = await loadVersion(db, actor.organizationId, publication.versionId);
  if (version.status !== "published") throw new NotFoundError();
  await assertVersionApproved(db, version);
  return { version, definition: await readDefinition(db, version) };
}

/** Internal transactional edit also used by candidate acceptance; provenance is never client-authoritative. */
export async function saveDraftInTransaction(tx: TemplateExecutor, actor: StaffActor, versionId: string, revision: number, input: unknown, accepted?: Question) {
  assertCan(actor.role, "form.write"); await activeActor(tx, actor);
  const row = await loadVersion(tx, actor.organizationId, versionId);
  if (row.status !== "draft" || row.revision !== revision) throw new ConflictError("Draft berubah atau terkunci. Muat ulang versi tersimpan.");
  const previous = await readDefinition(tx, row);
  const { definition, warnings } = compileDefinition(input);
  for (const q of definition.questions) {
    const old = previous.questions.find((x) => x.id === q.id);
    if (old && old.type !== q.type) throw new ValidationError("Perubahan jenis memerlukan ID pertanyaan baru (duplikasi pertanyaan).");
    if (accepted?.id === q.id) q.provenance = accepted.provenance;
    else if (old) q.provenance = old.provenance;
    else if (q.provenance.origin !== "manual" || q.provenance.candidateId) {
      const source = previous.questions.find((x) => x.provenance.candidateId && x.provenance.candidateId === q.provenance.candidateId);
      if (!source) throw new ValidationError("Provenance AI hanya melalui penerimaan kandidat.");
      q.provenance = source.provenance;
    }
  }
  const contentHash = definitionHash(definition);
  const rows = await tx.update(s.templateVersions).set({ metadataJson: metadataOf(definition), contentHash, snapshotJson: null, revision: revision + 1, demoOnly: row.demoOnly || definition.questions.some((q) => q.provenance.origin === "mock") }).where(and(eq(s.templateVersions.id, row.id), eq(s.templateVersions.revision, revision), eq(s.templateVersions.status, "draft"))).returning();
  if (!rows.length) throw new ConflictError();
  await writeRows(tx, row.id, definition);
  await tx.update(s.assessmentTemplates).set({ name: definition.name, revision: sql`revision + 1` }).where(eq(s.assessmentTemplates.id, row.templateId));
  await templateAudit(tx, actor, "save", row.templateId, row.id, { revision: revision + 1, questionCount: definition.questions.length });
  return { version: rows[0], definition, warnings };
}
export async function saveDraft(actor: StaffActor, id: string, input: unknown) {
  assertCan(actor.role, "form.write"); const data = editInput.parse(input); const db = await getDbReady();
  await db.transaction(async (tx) => { await activeActor(tx, actor); await saveDraftInTransaction(tx, actor, id, data.revision, data.definition); });
  return versionDetail(actor, id);
}
export async function validateDraft(actor: StaffActor, id: string, input: unknown) {
  await versionDetail(actor, id); assertCan(actor.role, "form.draft.read");
  const { definition } = z.object({ definition: z.unknown() }).strict().parse(input);
  const compiled = compileDefinition(definition, true);
  return { definition: compiled.definition, warnings: compiled.warnings };
}
export async function transitionVersion(actor: StaffActor, id: string, action: "submit-review" | "review" | "publish" | "archive" | "revoke", input: unknown) {
  assertCan(actor.role, action === "review" ? "form.review" : action === "revoke" ? "form.revoke" : action === "publish" ? "form.publish" : "form.write");
  const data = actionInput.parse(input); const db = await getDbReady();
  await db.transaction(async (tx) => {
    await activeActor(tx, actor); const row = await loadVersion(tx, actor.organizationId, id);
    if (row.revision !== data.revision) throw new ConflictError();
    if (!row.publishedAt && action === "revoke") assertCan(actor.role, "form.draft.read");
    const definition = await readDefinition(tx, row);
    const last = await latestReview(tx, row.id);
    const reviewTime = new Date(Math.max(Date.now(), (last?.createdAt.getTime() ?? 0) + 1));
    const append = (decision: typeof s.templateReviews.$inferInsert["decision"], revision = row.revision) => tx.insert(s.templateReviews).values({ organizationId: actor.organizationId, versionId: id, revision, contentHash: row.contentHash, snapshotJson: JSON.stringify(definition), decision, note: data.note, actorId: actor.membershipId, createdAt: reviewTime });
    if (action === "submit-review") {
      if (row.status !== "draft") throw new ConflictError();
      compileDefinition(definition, true);
      await tx.update(s.templateVersions).set({ status: "in_review", snapshotJson: JSON.stringify(definition), revision: row.revision + 1 }).where(eq(s.templateVersions.id, id));
      await append("submitted", row.revision + 1);
    } else if (action === "review") {
      if (row.status !== "in_review" || !data.decision) throw new ConflictError("Hanya versi dalam review yang dapat dinilai.");
      const [reviewer] = await tx.select().from(staffMemberships).where(eq(staffMemberships.id, actor.membershipId));
      if (!reviewer?.credentialVerifiedAt || actor.membershipId === row.createdBy) throw new ForbiddenError("Review memerlukan psikolog terverifikasi selain penulis.");
      await append(data.decision);
      if (data.decision === "changes_requested") await tx.update(s.templateVersions).set({ status: "draft", revision: row.revision + 1 }).where(eq(s.templateVersions.id, id));
    } else if (action === "publish") {
      if (row.status !== "in_review") throw new ConflictError();
      const review = await assertVersionApproved(tx, row);
      compileDefinition(definition, true);
      const publicationId = randomUUID();
      await tx.insert(s.assessmentPublications).values({ id: publicationId, organizationId: actor.organizationId, templateId: row.templateId, versionId: id, reviewId: review.id, contentHash: row.contentHash, publishedBy: actor.membershipId });
      await tx.update(s.templateVersions).set({ status: "archived" }).where(and(eq(s.templateVersions.templateId, row.templateId), eq(s.templateVersions.status, "published")));
      await tx.update(s.templateVersions).set({ status: "published", publishedAt: new Date() }).where(eq(s.templateVersions.id, id));
      await tx.update(s.assessmentTemplates).set({ activePublicationId: publicationId, revision: sql`revision + 1` }).where(eq(s.assessmentTemplates.id, row.templateId));
    } else {
      if (action === "revoke") {
        if (last?.decision !== "approved") throw new ConflictError("Tidak ada persetujuan aktif untuk dicabut.");
        await append("revoked");
      }
      await tx.update(s.templateVersions).set({ status: "archived" }).where(eq(s.templateVersions.id, id));
      const template = await loadTemplate(tx, actor.organizationId, row.templateId);
      const [publication] = template.activePublicationId ? await tx.select().from(s.assessmentPublications).where(eq(s.assessmentPublications.id, template.activePublicationId)) : [];
      if (publication?.versionId === row.id) await tx.update(s.assessmentTemplates).set({ activePublicationId: null, revision: sql`revision + 1` }).where(eq(s.assessmentTemplates.id, template.id));
    }
    await templateAudit(tx, actor, action, row.templateId, id, { revision: row.revision, decision: data.decision });
  });
  return versionDetail(actor, id);
}
export async function templateAuditHistory(actor: StaffActor, id: string) {
  assertCan(actor.role, "form.draft.read"); const db = await getDbReady(); await activeActor(db, actor); await loadTemplate(db, actor.organizationId, id);
  return db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, actor.organizationId), eq(auditLogs.entityId, id), like(auditLogs.action, "form.%"))).orderBy(desc(auditLogs.createdAt)).limit(200);
}
