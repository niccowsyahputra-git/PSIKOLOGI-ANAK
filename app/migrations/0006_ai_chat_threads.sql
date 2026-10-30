CREATE TABLE `ai_chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`child_id` text,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_message_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_chat_threads_recent` ON `ai_chat_threads` (`organization_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `ai_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`author_id` text,
	`content` text NOT NULL,
	`result_origin` text,
	`provider` text,
	`model` text,
	`prompt_version` text,
	`context_hash` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_chat_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `staff_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_chat_messages_role_check" CHECK(role in ('staff','assistant')),
	CONSTRAINT "ai_chat_messages_author_check" CHECK((role = 'staff' and author_id is not null and result_origin is null) or (role = 'assistant' and author_id is null and result_origin in ('mock','local_model')))
);
--> statement-breakpoint
CREATE INDEX `ai_chat_messages_thread` ON `ai_chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_chat_messages_idempotency` ON `ai_chat_messages` (`organization_id`,`idempotency_key`);--> statement-breakpoint
-- A discussion turn is a record of what was really asked and really answered,
-- so it is append-only like every other AI table in 0005.
CREATE TRIGGER ai_chat_message_no_update BEFORE UPDATE ON ai_chat_messages BEGIN SELECT RAISE(ABORT, 'AI chat turns are append-only'); END;--> statement-breakpoint
CREATE TRIGGER ai_chat_message_no_delete BEFORE DELETE ON ai_chat_messages BEGIN SELECT RAISE(ABORT, 'AI chat history is retained'); END;--> statement-breakpoint
-- The thread keeps its subject for its whole life; only the activity marker and
-- the staff-chosen title may change afterwards.
CREATE TRIGGER ai_chat_thread_scope_immutable BEFORE UPDATE ON ai_chat_threads
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.child_id IS NOT OLD.child_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'AI chat thread scope is immutable'); END;
