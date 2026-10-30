import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, foreignKey, check } from "drizzle-orm/sqlite-core";
import { organizations, staffMemberships } from "./domain-schema";
import { assessmentCycles, children, guardians } from "./assessment-schema";
import { assessmentTemplates, templateVersions, assessmentQuestions } from "./template-schema";
const id = () => text("id").primaryKey().$defaultFn(randomUUID);
const org = () => text("organization_id").notNull().references(() => organizations.id);
const time = (name: string) => integer(name, { mode: "timestamp_ms" });
const created = () => time("created_at").notNull().$defaultFn(() => new Date());
export const assessmentResponses = sqliteTable("assessment_responses", {
  id: id(), organizationId: org(), templateId: text("template_id").notNull().references(() => assessmentTemplates.id), templateVersionId: text("template_version_id").notNull(), contentHash: text("content_hash").notNull(),
  cycleId: text("cycle_id").notNull().references(() => assessmentCycles.id), childId: text("child_id").notNull().references(() => children.id), guardianId: text("guardian_id").references(() => guardians.id), target: text("target", { enum: ["child", "guardian"] }).notNull(),
  status: text("status", { enum: ["draft", "submitted", "withdrawn"] }).notNull().default("draft"), revision: integer("revision").notNull().default(1), parentResponseId: text("parent_response_id"), correctionReason: text("correction_reason"),
  createdBy: text("created_by").notNull().references(() => staffMemberships.id), createdAt: created(), submittedAt: time("submitted_at"), submittedBy: text("submitted_by"), withdrawnAt: time("withdrawn_at"), withdrawnBy: text("withdrawn_by").references(() => staffMemberships.id), withdrawalReason: text("withdrawal_reason"),
}, (t) => [uniqueIndex("response_org_identity").on(t.organizationId, t.id), uniqueIndex("response_version_identity").on(t.id, t.templateVersionId), index("response_context").on(t.organizationId, t.cycleId, t.childId, t.guardianId),
  uniqueIndex("response_child_draft").on(t.templateId, t.cycleId).where(sql`target='child' and status='draft'`), uniqueIndex("response_guardian_draft").on(t.templateId, t.cycleId, t.guardianId).where(sql`target='guardian' and status='draft'`),
  foreignKey({ columns: [t.organizationId, t.templateVersionId], foreignColumns: [templateVersions.organizationId, templateVersions.id] }), foreignKey({ columns: [t.templateId, t.templateVersionId], foreignColumns: [templateVersions.templateId, templateVersions.id] }),
  check("response_target", sql`(target='child' and guardian_id is null) or (target='guardian' and guardian_id is not null)`), check("response_status", sql`status in ('draft','submitted','withdrawn')`),
]);
export const assessmentAnswers = sqliteTable("assessment_answers", {
  responseId: text("response_id").notNull(), templateVersionId: text("template_version_id").notNull(), questionId: text("question_id").notNull(), state: text("state", { enum: ["answered", "skipped", "not_applicable"] }).notNull(), valueJson: text("value_json").notNull(), assistance: text("assistance").notNull(), skipReason: text("skip_reason"),
}, (t) => [primaryKey({ columns: [t.responseId, t.questionId] }), foreignKey({ columns: [t.responseId, t.templateVersionId], foreignColumns: [assessmentResponses.id, assessmentResponses.templateVersionId] }), foreignKey({ columns: [t.templateVersionId, t.questionId], foreignColumns: [assessmentQuestions.versionId, assessmentQuestions.questionId] })]);
export const responseSessions = sqliteTable("assessment_response_sessions", {
  id: id(), organizationId: org(), responseId: text("response_id").notNull(), cycleId: text("cycle_id").notNull().references(() => assessmentCycles.id), tokenHash: text("token_hash").notNull(), cookieHash: text("cookie_hash"), expiresAt: time("expires_at").notNull(), exchangedAt: time("exchanged_at"), revokedAt: time("revoked_at"), createdBy: text("created_by").notNull().references(() => staffMemberships.id), createdAt: created(),
}, (t) => [foreignKey({ columns: [t.organizationId, t.responseId], foreignColumns: [assessmentResponses.organizationId, assessmentResponses.id] }), uniqueIndex("response_session_token").on(t.tokenHash), uniqueIndex("response_session_cookie").on(t.cookieHash)]);
export const responseAttachments = sqliteTable("assessment_response_attachments", {
  id: id(), organizationId: org(), responseId: text("response_id").notNull(), templateVersionId: text("template_version_id").notNull(), questionId: text("question_id").notNull(), storageKey: text("storage_key").notNull(), mime: text("mime").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), actorStaffId: text("actor_staff_id").references(() => staffMemberships.id), actorSessionId: text("actor_session_id").references(() => responseSessions.id), createdAt: created(),
}, (t) => [foreignKey({ columns: [t.organizationId, t.responseId], foreignColumns: [assessmentResponses.organizationId, assessmentResponses.id] }), foreignKey({ columns: [t.responseId, t.templateVersionId], foreignColumns: [assessmentResponses.id, assessmentResponses.templateVersionId] }), foreignKey({ columns: [t.templateVersionId, t.questionId], foreignColumns: [assessmentQuestions.versionId, assessmentQuestions.questionId] })]);
export const responseAttachmentEvents = sqliteTable("assessment_response_attachment_events", {
  id: id(), organizationId: org(), responseId: text("response_id").notNull(), attachmentId: text("attachment_id").notNull().references(() => responseAttachments.id), eventType: text("event_type").notNull().default("uploaded"), createdAt: created(),
}, (t) => [foreignKey({ columns: [t.organizationId, t.responseId], foreignColumns: [assessmentResponses.organizationId, assessmentResponses.id] })]);
