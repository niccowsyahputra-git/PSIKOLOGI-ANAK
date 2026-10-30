import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { organizations, staffMemberships } from "./domain-schema";
import { children, guardians, assessmentCycles } from "./assessment-schema";

/**
 * AI assistance tables (PRD section 9.2, FR-11/FR-12). The analysis row is the
 * immutable result; reviews are append-only events beside it and never edit it.
 */
const id = () => text("id").primaryKey().$defaultFn(randomUUID);
const org = () => text("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" });
const time = (name: string) => integer(name, { mode: "timestamp_ms" });
const created = () => time("created_at").notNull().$defaultFn(() => new Date());
const scope = () => text("scope", { enum: ["child", "guardian", "combined"] }).notNull();
/** `combined` needs both sources unless a leader/psychologist recorded a partial reason. */
const scopeTargets = sql`(scope = 'child' and guardian_id is null) or (scope in ('guardian','combined') and guardian_id is not null)`;

/**
 * Immutable successful result. `result_origin` separates the deterministic local
 * simulation from a real model so a mock can never be mistaken for analysis
 * (BR-26); the server refuses real approval on `mock`.
 */
export const aiAnalyses = sqliteTable("ai_analyses", {
  id: id(), organizationId: org(), scope: scope(), childId: text("child_id").notNull().references(() => children.id), guardianId: text("guardian_id").references(() => guardians.id), cycleId: text("cycle_id").notNull().references(() => assessmentCycles.id),
  sourceAssessmentIds: text("source_assessment_ids").notNull(), snapshotJson: text("snapshot_json").notNull(), resultJson: text("result_json").notNull(),
  resultOrigin: text("result_origin", { enum: ["mock", "local_model", "remote_model"] }).notNull(), inputHash: text("input_hash").notNull(),
  provider: text("provider").notNull(), model: text("model"), promptVersion: text("prompt_version").notNull(), settingsVersion: integer("settings_version").notNull(),
  generatedBy: text("generated_by").notNull().references(() => staffMemberships.id), generationReason: text("generation_reason"), createdAt: created(),
}, (t) => [
  index("ai_analyses_target").on(t.organizationId, t.childId, t.cycleId, t.createdAt),
  check("ai_analyses_scope_check", sql`scope in ('child','guardian','combined')`),
  check("ai_analyses_origin_check", sql`result_origin in ('mock','local_model','remote_model')`),
  check("ai_analyses_targets_check", scopeTargets),
]);

/**
 * One bounded generation attempt. The unique idempotency key makes a replayed
 * POST return the existing job instead of calling the provider again (BR-15).
 */
export const aiJobs = sqliteTable("ai_jobs", {
  id: id(), organizationId: org(), scope: scope(), childId: text("child_id").notNull().references(() => children.id), guardianId: text("guardian_id").references(() => guardians.id), cycleId: text("cycle_id").notNull().references(() => assessmentCycles.id),
  idempotencyKey: text("idempotency_key").notNull(), inputHash: text("input_hash").notNull(), requestHash: text("request_hash").notNull(), settingsVersion: integer("settings_version").notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull().default("queued"),
  generatedBy: text("generated_by").notNull().references(() => staffMemberships.id), leaseExpiresAt: time("lease_expires_at"), safeError: text("safe_error"),
  analysisId: text("analysis_id").references((): AnySQLiteColumn => aiAnalyses.id), startedAt: time("started_at").notNull().$defaultFn(() => new Date()), finishedAt: time("finished_at"),
}, (t) => [
  uniqueIndex("ai_jobs_idempotency_unique").on(t.organizationId, t.idempotencyKey),
  index("ai_jobs_recovery").on(t.organizationId, t.childId, t.cycleId, t.startedAt),
  check("ai_jobs_status_check", sql`status in ('queued','running','succeeded','failed')`),
  check("ai_jobs_targets_check", scopeTargets),
  // A succeeded job must point at its result; a failed job must explain itself.
  check("ai_jobs_outcome_check", sql`(status = 'succeeded' and analysis_id is not null and safe_error is null) or (status = 'failed' and safe_error is not null and analysis_id is null) or status in ('queued','running')`),
]);

/**
 * Append-only review events (FR-12). The effective disposition is the latest
 * authorized row, so a result is never rewritten by a reviewer.
 */
export const aiReviews = sqliteTable("ai_reviews", {
  id: id(), organizationId: org(), analysisId: text("analysis_id").notNull().references(() => aiAnalyses.id),
  reviewerId: text("reviewer_id").notNull().references(() => staffMemberships.id),
  disposition: text("disposition", { enum: ["support_approved", "needs_revision", "rejected"] }).notNull(),
  /** Marks a disposition recorded against a simulated result so labels survive in history. */
  simulated: integer("simulated", { mode: "boolean" }).notNull().default(false),
  comment: text("comment").notNull(), createdAt: created(),
}, (t) => [
  index("ai_reviews_analysis").on(t.analysisId, t.createdAt),
  check("ai_reviews_disposition_check", sql`disposition in ('support_approved','needs_revision','rejected')`),
]);

/**
 * Daily usage per organization. `reserved_count` is incremented inside the same
 * transaction that creates the job so a quota can never be oversubscribed.
 */
export const aiUsageCounters = sqliteTable("ai_usage_counters", {
  id: id(), organizationId: org(), dateKey: text("date_key").notNull(),
  requestCount: integer("request_count").notNull().default(0), reservedCount: integer("reserved_count").notNull().default(0),
  mockCount: integer("mock_count").notNull().default(0), createdAt: created(),
}, (t) => [
  uniqueIndex("ai_usage_day_unique").on(t.organizationId, t.dateKey),
  check("ai_usage_bounds_check", sql`request_count >= 0 and reserved_count >= 0 and mock_count >= 0`),
]);

export type AiAnalysisRow = typeof aiAnalyses.$inferSelect;
export type AiJobRow = typeof aiJobs.$inferSelect;
export type AiReviewRow = typeof aiReviews.$inferSelect;

/**
 * Staff discussion threads with the local assistant. A thread is either
 * organization-wide or bound to one child, so the context pack sent with each
 * turn can be built from exactly the rows that thread is allowed to read — the
 * assistant never searches beyond this database.
 */
export const aiChatThreads = sqliteTable("ai_chat_threads", {
  id: id(), organizationId: org(), childId: text("child_id").references(() => children.id),
  title: text("title").notNull(), createdBy: text("created_by").notNull().references(() => staffMemberships.id),
  createdAt: created(), lastMessageAt: time("last_message_at"),
}, (t) => [index("ai_chat_threads_recent").on(t.organizationId, t.lastMessageAt)]);

/**
 * Append-only turns. `context_hash` records which locally built context pack an
 * answer was grounded on, so the stored answer stays checkable later without
 * copying participant text into a second place.
 */
export const aiChatMessages = sqliteTable("ai_chat_messages", {
  id: id(), organizationId: org(), threadId: text("thread_id").notNull().references(() => aiChatThreads.id),
  role: text("role", { enum: ["staff", "assistant"] }).notNull(),
  authorId: text("author_id").references(() => staffMemberships.id), content: text("content").notNull(),
  resultOrigin: text("result_origin", { enum: ["mock", "local_model"] }), provider: text("provider"), model: text("model"),
  promptVersion: text("prompt_version"), contextHash: text("context_hash"), idempotencyKey: text("idempotency_key"),
  createdAt: created(),
}, (t) => [
  index("ai_chat_messages_thread").on(t.threadId, t.createdAt),
  // SQLite allows repeated NULLs here, so only the staff turns carry a key.
  uniqueIndex("ai_chat_messages_idempotency").on(t.organizationId, t.idempotencyKey),
  check("ai_chat_messages_role_check", sql`role in ('staff','assistant')`),
  // A staff turn has an author and no engine fields; an answer is the reverse,
  // so a simulated reply can never be stored as if a human had written it.
  check("ai_chat_messages_author_check", sql`(role = 'staff' and author_id is not null and result_origin is null) or (role = 'assistant' and author_id is null and result_origin in ('mock','local_model'))`),
]);

export type AiChatThreadRow = typeof aiChatThreads.$inferSelect;
export type AiChatMessageRow = typeof aiChatMessages.$inferSelect;
