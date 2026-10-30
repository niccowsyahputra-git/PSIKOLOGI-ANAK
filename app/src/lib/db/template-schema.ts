import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, foreignKey, check } from "drizzle-orm/sqlite-core";
import { organizations, staffMemberships } from "./domain-schema";
const id = () => text("id").primaryKey().$defaultFn(randomUUID);
const org = () => text("organization_id").notNull().references(() => organizations.id);
const time = (name: string) => integer(name, { mode: "timestamp_ms" });
const created = () => time("created_at").notNull().$defaultFn(() => new Date());
export const assessmentTemplates = sqliteTable("assessment_templates", {
  id: id(), organizationId: org(), name: text("name").notNull(), activePublicationId: text("active_publication_id"), revision: integer("revision").notNull().default(1), createdBy: text("created_by").notNull().references(() => staffMemberships.id), createdAt: created(),
}, (t) => [uniqueIndex("template_org_id").on(t.organizationId, t.id), index("template_org_name").on(t.organizationId, t.name)]);
export const templateVersions = sqliteTable("assessment_template_versions", {
  id: id(), organizationId: org(), templateId: text("template_id").notNull(), number: integer("number").notNull(), parentVersionId: text("parent_version_id"),
  status: text("status", { enum: ["draft", "in_review", "published", "archived"] }).notNull().default("draft"), revision: integer("revision").notNull().default(1),
  metadataJson: text("metadata_json").notNull(), contentHash: text("content_hash").notNull(), snapshotJson: text("snapshot_json"),
  demoOnly: integer("demo_only", { mode: "boolean" }).notNull().default(false), publishedAt: time("published_at"), createdBy: text("created_by").notNull().references(() => staffMemberships.id), createdAt: created(),
}, (t) => [uniqueIndex("template_version_number").on(t.templateId, t.number), uniqueIndex("template_version_org_id").on(t.organizationId, t.id), uniqueIndex("template_version_identity").on(t.templateId, t.id),
  uniqueIndex("template_one_working_version").on(t.templateId).where(sql`status in ('draft','in_review')`),
  foreignKey({ columns: [t.organizationId, t.templateId], foreignColumns: [assessmentTemplates.organizationId, assessmentTemplates.id] }),
  check("template_version_status", sql`status in ('draft','in_review','published','archived')`),
]);
export const assessmentSections = sqliteTable("assessment_sections", {
  versionId: text("version_id").notNull().references(() => templateVersions.id), sectionId: text("section_id").notNull(), position: integer("position").notNull(), dataJson: text("data_json").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.sectionId] })]);
export const assessmentQuestions = sqliteTable("assessment_questions", {
  versionId: text("version_id").notNull().references(() => templateVersions.id), questionId: text("question_id").notNull(), sectionId: text("section_id").notNull(), position: integer("position").notNull(), dataJson: text("data_json").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.questionId] }), foreignKey({ columns: [t.versionId, t.sectionId], foreignColumns: [assessmentSections.versionId, assessmentSections.sectionId] })]);
export const assessmentQuestionOptions = sqliteTable("assessment_question_options", {
  versionId: text("version_id").notNull(), questionId: text("question_id").notNull(), optionId: text("option_id").notNull(), position: integer("position").notNull(), dataJson: text("data_json").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.optionId] }), foreignKey({ columns: [t.versionId, t.questionId], foreignColumns: [assessmentQuestions.versionId, assessmentQuestions.questionId] })]);
export const assessmentConditionalRules = sqliteTable("assessment_conditional_rules", {
  versionId: text("version_id").notNull(), questionId: text("question_id").notNull(), expressionJson: text("expression_json").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.questionId] }), foreignKey({ columns: [t.versionId, t.questionId], foreignColumns: [assessmentQuestions.versionId, assessmentQuestions.questionId] })]);
export const templateReviews = sqliteTable("assessment_template_reviews", {
  id: id(), organizationId: org(), versionId: text("version_id").notNull(), revision: integer("revision").notNull(), contentHash: text("content_hash").notNull(), snapshotJson: text("snapshot_json").notNull(),
  decision: text("decision", { enum: ["submitted", "approved", "changes_requested", "revoked"] }).notNull(), note: text("note").notNull(), actorId: text("actor_id").notNull().references(() => staffMemberships.id), createdAt: created(),
}, (t) => [foreignKey({ columns: [t.organizationId, t.versionId], foreignColumns: [templateVersions.organizationId, templateVersions.id] }), index("template_review_latest").on(t.versionId, t.createdAt), check("template_review_decision", sql`decision in ('submitted','approved','changes_requested','revoked')`)]);
export const assessmentPublications = sqliteTable("assessment_publications", {
  id: id(), organizationId: org(), templateId: text("template_id").notNull(), versionId: text("version_id").notNull(), reviewId: text("review_id").notNull().references(() => templateReviews.id), contentHash: text("content_hash").notNull(), publishedBy: text("published_by").notNull().references(() => staffMemberships.id), createdAt: created(),
}, (t) => [uniqueIndex("template_publication_once").on(t.versionId), foreignKey({ columns: [t.organizationId, t.versionId], foreignColumns: [templateVersions.organizationId, templateVersions.id] }), foreignKey({ columns: [t.templateId, t.versionId], foreignColumns: [templateVersions.templateId, templateVersions.id] })]);
