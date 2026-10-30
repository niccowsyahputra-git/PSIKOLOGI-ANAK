CREATE TABLE `ai_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`child_id` text NOT NULL,
	`guardian_id` text,
	`cycle_id` text NOT NULL,
	`source_assessment_ids` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`result_json` text NOT NULL,
	`result_origin` text NOT NULL,
	`input_hash` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`prompt_version` text NOT NULL,
	`settings_version` integer NOT NULL,
	`generated_by` text NOT NULL,
	`generation_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generated_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_analyses_scope_check" CHECK(scope in ('child','guardian','combined')),
	CONSTRAINT "ai_analyses_origin_check" CHECK(result_origin in ('mock','local_model','remote_model')),
	CONSTRAINT "ai_analyses_targets_check" CHECK((scope = 'child' and guardian_id is null) or (scope in ('guardian','combined') and guardian_id is not null))
);
--> statement-breakpoint
CREATE INDEX `ai_analyses_target` ON `ai_analyses` (`organization_id`,`child_id`,`cycle_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`child_id` text NOT NULL,
	`guardian_id` text,
	`cycle_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`settings_version` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generated_by` text NOT NULL,
	`lease_expires_at` integer,
	`safe_error` text,
	`analysis_id` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generated_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `ai_analyses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_jobs_status_check" CHECK(status in ('queued','running','succeeded','failed')),
	CONSTRAINT "ai_jobs_targets_check" CHECK((scope = 'child' and guardian_id is null) or (scope in ('guardian','combined') and guardian_id is not null)),
	CONSTRAINT "ai_jobs_outcome_check" CHECK((status = 'succeeded' and analysis_id is not null and safe_error is null) or (status = 'failed' and safe_error is not null and analysis_id is null) or status in ('queued','running'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_idempotency_unique` ON `ai_jobs` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_jobs_recovery` ON `ai_jobs` (`organization_id`,`child_id`,`cycle_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`disposition` text NOT NULL,
	`simulated` integer DEFAULT false NOT NULL,
	`comment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analysis_id`) REFERENCES `ai_analyses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_reviews_disposition_check" CHECK(disposition in ('support_approved','needs_revision','rejected'))
);
--> statement-breakpoint
CREATE INDEX `ai_reviews_analysis` ON `ai_reviews` (`analysis_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`date_key` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`reserved_count` integer DEFAULT 0 NOT NULL,
	`mock_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_usage_bounds_check" CHECK(request_count >= 0 and reserved_count >= 0 and mock_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_day_unique` ON `ai_usage_counters` (`organization_id`,`date_key`);