import { randomUUID } from "node:crypto";
import { sqliteTable, text, integer, index, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { organizations, staffMemberships } from "./domain-schema";
import { templateVersions } from "./template-schema";
const id = () => text("id").primaryKey().$defaultFn(randomUUID);
const org = () => text("organization_id").notNull().references(() => organizations.id);
const time = (name: string) => integer(name, { mode: "timestamp_ms" });
export const aiQuestionJobs = sqliteTable("ai_question_jobs", {
  id: id(), organizationId: org(), versionId: text("version_id").notNull(), revision: integer("revision").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), requestHash: text("request_hash").notNull(), inputJson: text("input_json").notNull(),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull().default("running"),
  origin: text("origin", { enum: ["mock", "ai"] }).notNull(), model: text("model").notNull(), promptVersion: text("prompt_version").notNull(), schemaVersion: text("schema_version").notNull(), settingsVersion: integer("settings_version").notNull(),
  quotaDate: text("quota_date").notNull(), generatedBy: text("generated_by").notNull().references(() => staffMemberships.id),
  leaseExpiresAt: time("lease_expires_at"), safeError: text("safe_error"), outputJson: text("output_json"), warningsJson: text("warnings_json"),
  startedAt: time("started_at").notNull().$defaultFn(() => new Date()), finishedAt: time("finished_at"),
}, (t) => [uniqueIndex("question_job_idempotency").on(t.organizationId, t.idempotencyKey), uniqueIndex("question_job_context").on(t.organizationId, t.versionId, t.id), index("question_job_rate").on(t.organizationId, t.generatedBy, t.startedAt), foreignKey({ columns: [t.organizationId, t.versionId], foreignColumns: [templateVersions.organizationId, templateVersions.id] })]);
export const aiQuestionCandidates = sqliteTable("ai_question_candidates", {
  id: id(), organizationId: org(), versionId: text("version_id").notNull(), jobId: text("job_id").notNull(), position: integer("position").notNull(),
  questionId: text("question_id").notNull(), questionJson: text("question_json").notNull(), sectionJson: text("section_json").notNull(), originalJson: text("original_json").notNull(), warningsJson: text("warnings_json").notNull(),
}, (t) => [uniqueIndex("question_candidate_context").on(t.organizationId, t.versionId, t.id), uniqueIndex("question_candidate_position").on(t.jobId, t.position), uniqueIndex("question_candidate_identity").on(t.questionId), foreignKey({ columns: [t.organizationId, t.versionId, t.jobId], foreignColumns: [aiQuestionJobs.organizationId, aiQuestionJobs.versionId, aiQuestionJobs.id] })]);
export const aiQuestionDecisions = sqliteTable("ai_question_candidate_decisions", {
  id: id(), organizationId: org(), versionId: text("version_id").notNull(), candidateId: text("candidate_id").notNull(),
  decision: text("decision", { enum: ["accept", "edit_and_accept", "reject"] }).notNull(), note: text("note").notNull(), requestHash: text("request_hash").notNull(), appliedRevision: integer("applied_revision").notNull(), appliedQuestionJson: text("applied_question_json"),
  actorId: text("actor_id").notNull().references(() => staffMemberships.id), createdAt: time("created_at").notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex("question_decision_once").on(t.candidateId), foreignKey({ columns: [t.organizationId, t.versionId, t.candidateId], foreignColumns: [aiQuestionCandidates.organizationId, aiQuestionCandidates.versionId, aiQuestionCandidates.id] })]);
