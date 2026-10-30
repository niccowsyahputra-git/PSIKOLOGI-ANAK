CREATE TABLE ai_question_jobs (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), version_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
 origin TEXT NOT NULL CHECK(origin IN ('mock','ai')), model TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version TEXT NOT NULL, settings_version INTEGER NOT NULL,
 quota_date TEXT NOT NULL, generated_by TEXT NOT NULL REFERENCES staff_memberships(id), lease_expires_at INTEGER, safe_error TEXT, output_json TEXT, warnings_json TEXT,
 started_at INTEGER NOT NULL, finished_at INTEGER,
 FOREIGN KEY(organization_id,version_id) REFERENCES assessment_template_versions(organization_id,id),
 CHECK((status='running' AND lease_expires_at IS NOT NULL AND finished_at IS NULL AND output_json IS NULL AND safe_error IS NULL)
 OR (status='succeeded' AND lease_expires_at IS NULL AND finished_at IS NOT NULL AND output_json IS NOT NULL AND json_valid(output_json) AND warnings_json IS NOT NULL AND json_valid(warnings_json) AND safe_error IS NULL)
 OR (status='failed' AND lease_expires_at IS NULL AND finished_at IS NOT NULL AND safe_error IS NOT NULL AND output_json IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX question_job_idempotency ON ai_question_jobs(organization_id,idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX question_job_context ON ai_question_jobs(organization_id,version_id,id);
--> statement-breakpoint
CREATE INDEX question_job_rate ON ai_question_jobs(organization_id,generated_by,started_at);
--> statement-breakpoint
CREATE TABLE ai_question_candidates (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), version_id TEXT NOT NULL, job_id TEXT NOT NULL,
 position INTEGER NOT NULL, question_id TEXT NOT NULL, question_json TEXT NOT NULL CHECK(json_valid(question_json)), section_json TEXT NOT NULL CHECK(json_valid(section_json)), original_json TEXT NOT NULL CHECK(json_valid(original_json)), warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json)),
 FOREIGN KEY(organization_id,version_id,job_id) REFERENCES ai_question_jobs(organization_id,version_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX question_candidate_context ON ai_question_candidates(organization_id,version_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX question_candidate_position ON ai_question_candidates(job_id,position);
--> statement-breakpoint
CREATE UNIQUE INDEX question_candidate_identity ON ai_question_candidates(question_id);
--> statement-breakpoint
CREATE TABLE ai_question_candidate_decisions (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), version_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('accept','edit_and_accept','reject')), note TEXT NOT NULL, request_hash TEXT NOT NULL, applied_revision INTEGER NOT NULL CHECK(applied_revision > 0), applied_question_json TEXT,
 actor_id TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,version_id,candidate_id) REFERENCES ai_question_candidates(organization_id,version_id,id),
 CHECK((decision='reject' AND applied_question_json IS NULL) OR (decision IN ('accept','edit_and_accept') AND applied_question_json IS NOT NULL AND json_valid(applied_question_json)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX question_decision_once ON ai_question_candidate_decisions(candidate_id);
--> statement-breakpoint
CREATE TRIGGER question_job_insert BEFORE INSERT ON ai_question_jobs BEGIN
 SELECT CASE WHEN NEW.status <> 'running' OR NOT EXISTS(SELECT 1 FROM assessment_template_versions v JOIN staff_memberships m ON m.id=NEW.generated_by WHERE v.id=NEW.version_id AND v.organization_id=NEW.organization_id AND v.status='draft' AND v.revision=NEW.revision AND m.organization_id=NEW.organization_id AND m.active=1 AND m.role='admin') THEN RAISE(ABORT,'invalid question job context') END;
END;
--> statement-breakpoint
CREATE TRIGGER question_job_update BEFORE UPDATE ON ai_question_jobs BEGIN
 SELECT CASE WHEN OLD.status <> 'running' OR NEW.status='running' OR NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.version_id IS NOT OLD.version_id OR NEW.revision IS NOT OLD.revision OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash OR NEW.input_json IS NOT OLD.input_json OR NEW.origin IS NOT OLD.origin OR NEW.model IS NOT OLD.model OR NEW.prompt_version IS NOT OLD.prompt_version OR NEW.schema_version IS NOT OLD.schema_version OR NEW.settings_version IS NOT OLD.settings_version OR NEW.quota_date IS NOT OLD.quota_date OR NEW.generated_by IS NOT OLD.generated_by OR NEW.started_at IS NOT OLD.started_at THEN RAISE(ABORT,'question job immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER question_job_delete BEFORE DELETE ON ai_question_jobs BEGIN SELECT RAISE(ABORT,'question job retained'); END;
--> statement-breakpoint
CREATE TRIGGER question_candidate_insert BEFORE INSERT ON ai_question_candidates BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ai_question_jobs j WHERE j.id=NEW.job_id AND j.status='running' AND j.organization_id=NEW.organization_id AND j.version_id=NEW.version_id AND json_extract(NEW.question_json,'$.id')=NEW.question_id AND json_extract(NEW.question_json,'$.provenance.candidateId')=NEW.id AND json_extract(NEW.question_json,'$.provenance.origin')=j.origin) THEN RAISE(ABORT,'invalid candidate provenance') END;
END;
--> statement-breakpoint
CREATE TRIGGER question_candidate_update BEFORE UPDATE ON ai_question_candidates BEGIN SELECT RAISE(ABORT,'candidate immutable'); END;
--> statement-breakpoint
CREATE TRIGGER question_candidate_delete BEFORE DELETE ON ai_question_candidates BEGIN SELECT RAISE(ABORT,'candidate retained'); END;
--> statement-breakpoint
CREATE TRIGGER question_decision_insert BEFORE INSERT ON ai_question_candidate_decisions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ai_question_candidates c JOIN ai_question_jobs j ON j.id=c.job_id JOIN assessment_template_versions v ON v.id=c.version_id JOIN staff_memberships m ON m.id=NEW.actor_id WHERE c.id=NEW.candidate_id AND c.organization_id=NEW.organization_id AND c.version_id=NEW.version_id AND j.status='succeeded' AND v.status='draft' AND v.revision=NEW.applied_revision AND m.organization_id=NEW.organization_id AND m.role='admin' AND m.active=1) THEN RAISE(ABORT,'invalid candidate decision context') END;
 SELECT CASE WHEN NEW.decision <> 'reject' AND NOT EXISTS(SELECT 1 FROM assessment_questions q JOIN ai_question_candidates c ON c.question_id=q.question_id WHERE c.id=NEW.candidate_id AND q.version_id=NEW.version_id AND json_extract(q.data_json,'$.provenance.candidateId')=NEW.candidate_id AND json_extract(NEW.applied_question_json,'$.id')=q.question_id) THEN RAISE(ABORT,'candidate not applied to exact version') END;
END;
--> statement-breakpoint
CREATE TRIGGER question_decision_update BEFORE UPDATE ON ai_question_candidate_decisions BEGIN SELECT RAISE(ABORT,'candidate decisions append only'); END;
--> statement-breakpoint
CREATE TRIGGER question_decision_delete BEFORE DELETE ON ai_question_candidate_decisions BEGIN SELECT RAISE(ABORT,'candidate decisions retained'); END;
