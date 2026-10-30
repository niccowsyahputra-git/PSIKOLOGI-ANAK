-- 0004 stored the job start time in `created_at`, which hid what the column
-- means for a row that is specifically one attempt. Renamed before the trigger
-- below depends on it.
ALTER TABLE `ai_jobs` RENAME COLUMN `created_at` TO `started_at`;
--> statement-breakpoint
-- The stored AI result and its review history are append-only (FR-11, FR-12):
-- an edited result would make the review decision unverifiable afterwards.
-- Enforced in the database like every other append-only table in 0001.
CREATE TRIGGER ai_analysis_no_update BEFORE UPDATE ON ai_analyses BEGIN SELECT RAISE(ABORT, 'AI analysis output is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_analysis_no_delete BEFORE DELETE ON ai_analyses BEGIN SELECT RAISE(ABORT, 'AI analysis history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER ai_review_no_update BEFORE UPDATE ON ai_reviews BEGIN SELECT RAISE(ABORT, 'AI review history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER ai_review_no_delete BEFORE DELETE ON ai_reviews BEGIN SELECT RAISE(ABORT, 'AI review history is append-only'); END;
--> statement-breakpoint
-- A job records what was really sent; only its outcome fields may change.
CREATE TRIGGER ai_job_input_immutable BEFORE UPDATE ON ai_jobs
WHEN NEW.input_hash IS NOT OLD.input_hash OR NEW.request_hash IS NOT OLD.request_hash OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.organization_id IS NOT OLD.organization_id OR NEW.generated_by IS NOT OLD.generated_by OR NEW.started_at IS NOT OLD.started_at
BEGIN SELECT RAISE(ABORT, 'AI job input record is immutable'); END;
