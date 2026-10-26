CREATE TABLE `assessment_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`child_id` text NOT NULL,
	`kind` text DEFAULT 'initial' NOT NULL,
	`age_at_start` integer NOT NULL,
	`age_is_estimated` integer NOT NULL,
	`created_at` integer NOT NULL,
	`module` text NOT NULL,
	`instrument_version` text NOT NULL,
	`module_override_reason` text,
	`guardian_availability` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`fictional` integer DEFAULT false NOT NULL,
	`prior_cycle_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_version`) REFERENCES `instrument_versions`(`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prior_cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_state" CHECK(status in ('draft','active','closed')),
	CONSTRAINT "cycle_module" CHECK(module in ('A','B','C'))
);
--> statement-breakpoint
CREATE INDEX `cycles_child_time` ON `assessment_cycles` (`organization_id`,`child_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assessment_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`author_id` text NOT NULL,
	`observation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`child_id` text NOT NULL,
	`guardian_id` text,
	`target` text NOT NULL,
	`module` text NOT NULL,
	`instrument_version` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`answers_json` text DEFAULT '[]' NOT NULL,
	`respondent_type` text NOT NULL,
	`facilitator_id` text,
	`intake_session_id` text,
	`assistance` text DEFAULT 'none' NOT NULL,
	`language` text DEFAULT 'id' NOT NULL,
	`submitted_at` integer,
	`submitted_by` text,
	`parent_assessment_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_version`) REFERENCES `instrument_versions`(`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facilitator_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assessment_target_context" CHECK((target = 'child' and guardian_id is null and module in ('A','B','C')) or (target = 'guardian' and guardian_id is not null and module = 'W')),
	CONSTRAINT "assessment_status" CHECK(status in ('draft','submitted','withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `assessment_context` ON `assessments` (`organization_id`,`cycle_id`,`target`,`guardian_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_child_draft` ON `assessments` (`cycle_id`) WHERE target = 'child' and status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_guardian_draft` ON `assessments` (`cycle_id`,`guardian_id`) WHERE target = 'guardian' and status = 'draft';--> statement-breakpoint
CREATE TABLE `attachment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`item_id` text DEFAULT 'A02' NOT NULL,
	`actor_staff_id` text,
	`actor_session_id` text,
	`event_type` text NOT NULL,
	`attachment_id` text,
	`created_at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_staff_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_session_id`) REFERENCES `intake_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_event_actor" CHECK((actor_staff_id is null) != (actor_session_id is null))
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`child_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`item_id` text DEFAULT 'A02' NOT NULL,
	`purpose` text DEFAULT 'assessment' NOT NULL,
	`storage_provider` text DEFAULT 'local' NOT NULL,
	`storage_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`status` text NOT NULL,
	`actor_staff_id` text,
	`actor_session_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_staff_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_session_id`) REFERENCES `intake_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_actor" CHECK((actor_staff_id is null) != (actor_session_id is null)),
	CONSTRAINT "attachment_a02" CHECK(item_id = 'A02' and purpose = 'assessment' and storage_provider = 'local')
);
--> statement-breakpoint
CREATE TABLE `authority_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`decision` text NOT NULL,
	`lawful_basis_note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `child_guardians` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`child_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`relationship` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`authority_status` text DEFAULT 'pending' NOT NULL,
	`contact_safety` text DEFAULT 'unknown' NOT NULL,
	`contact_review_by` text,
	`contact_review_at` integer,
	`contact_review_note` text,
	`created_at` integer NOT NULL,
	`valid_to` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_review_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_safety_check" CHECK(contact_safety in ('safe','unsafe','unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_guardian_pair` ON `child_guardians` (`child_id`,`guardian_id`);--> statement-breakpoint
CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`fictional` integer DEFAULT false NOT NULL,
	`profile_state` text DEFAULT 'draft' NOT NULL,
	`source_info_json` text DEFAULT '{}' NOT NULL,
	`verified_by` text,
	`verified_at` integer,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`birth_date` text,
	`estimated_age` integer,
	`age_reference_date` text,
	`sex` text,
	`background_json` text DEFAULT '[]' NOT NULL,
	`admission_date` text,
	`accessibility_json` text DEFAULT '{}' NOT NULL,
	`notes` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "children_state" CHECK(profile_state in ('draft','verified','archived')),
	CONSTRAINT "children_age" CHECK((birth_date is not null and estimated_age is null and age_reference_date is null) or (birth_date is null and estimated_age >= 0 and age_reference_date is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `children_org_code` ON `children` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `children_org_name` ON `children` (`organization_id`,`profile_state`,`name`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`child_id` text NOT NULL,
	`guardian_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`notice_version` text NOT NULL,
	`actor_type` text NOT NULL,
	`captured_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`authority_basis` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consent_status" CHECK(status in ('granted','declined','withdrawn','pending_authority_review'))
);
--> statement-breakpoint
CREATE INDEX `consent_scope` ON `consents` (`cycle_id`,`subject_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`fictional` integer DEFAULT false NOT NULL,
	`profile_state` text DEFAULT 'draft' NOT NULL,
	`source_info_json` text DEFAULT '{}' NOT NULL,
	`verified_by` text,
	`verified_at` integer,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`safe_contact` text,
	`communication_preference` text DEFAULT 'tatap muka' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "guardians_state" CHECK(profile_state in ('draft','verified','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardians_org_code` ON `guardians` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `guardians_org_name` ON `guardians` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `instrument_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`instrument_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`psychologist_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`review_note` text NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	`revoked_reason` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_version`) REFERENCES `instrument_versions`(`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`psychologist_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instrument_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `intake_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`cookie_hash` text,
	`expires_at` integer NOT NULL,
	`exchanged_at` integer,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cycle_id`) REFERENCES `assessment_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_token_unique` ON `intake_sessions` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `intake_cookie_unique` ON `intake_sessions` (`cookie_hash`);
--> statement-breakpoint
CREATE TRIGGER assessment_submitted_immutable BEFORE UPDATE ON assessments
WHEN OLD.status != 'draft' AND (
 NEW.answers_json IS NOT OLD.answers_json OR NEW.revision IS NOT OLD.revision OR
 NEW.cycle_id IS NOT OLD.cycle_id OR NEW.child_id IS NOT OLD.child_id OR
 NEW.guardian_id IS NOT OLD.guardian_id OR NEW.module IS NOT OLD.module OR
 NEW.instrument_version IS NOT OLD.instrument_version OR NEW.target IS NOT OLD.target OR
 NEW.submitted_at IS NOT OLD.submitted_at OR NEW.submitted_by IS NOT OLD.submitted_by OR
 NEW.parent_assessment_id IS NOT OLD.parent_assessment_id OR
 NEW.status NOT IN ('submitted','withdrawn') OR (OLD.status = 'withdrawn' AND NEW.status != 'withdrawn')
) BEGIN SELECT RAISE(ABORT, 'Submitted assessment is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER assessment_no_delete BEFORE DELETE ON assessments BEGIN SELECT RAISE(ABORT, 'Assessment history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER instrument_no_update BEFORE UPDATE ON instrument_versions BEGIN SELECT RAISE(ABORT, 'Instrument definition is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER instrument_no_delete BEFORE DELETE ON instrument_versions BEGIN SELECT RAISE(ABORT, 'Instrument history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER consent_no_update BEFORE UPDATE ON consents BEGIN SELECT RAISE(ABORT, 'Consent history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER consent_no_delete BEFORE DELETE ON consents BEGIN SELECT RAISE(ABORT, 'Consent history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER authority_no_update BEFORE UPDATE ON authority_reviews BEGIN SELECT RAISE(ABORT, 'Authority history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER authority_no_delete BEFORE DELETE ON authority_reviews BEGIN SELECT RAISE(ABORT, 'Authority history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER attachment_event_no_update BEFORE UPDATE ON attachment_events BEGIN SELECT RAISE(ABORT, 'Media events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER attachment_event_no_delete BEFORE DELETE ON attachment_events BEGIN SELECT RAISE(ABORT, 'Media events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER approval_no_update BEFORE UPDATE ON instrument_approvals BEGIN SELECT RAISE(ABORT, 'Approval history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER approval_no_delete BEFORE DELETE ON instrument_approvals BEGIN SELECT RAISE(ABORT, 'Approval history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER cycle_age_immutable BEFORE UPDATE ON assessment_cycles
WHEN NEW.age_at_start IS NOT OLD.age_at_start OR NEW.age_is_estimated IS NOT OLD.age_is_estimated OR NEW.started_at IS NOT OLD.started_at OR NEW.module IS NOT OLD.module OR NEW.instrument_version IS NOT OLD.instrument_version OR NEW.child_id IS NOT OLD.child_id OR NEW.fictional IS NOT OLD.fictional
BEGIN SELECT RAISE(ABORT, 'Cycle age and instrument snapshot is immutable'); END;