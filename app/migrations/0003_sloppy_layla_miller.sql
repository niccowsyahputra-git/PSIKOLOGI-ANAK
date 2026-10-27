CREATE TABLE `ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mode` text DEFAULT 'mock' NOT NULL,
	`provider_name` text DEFAULT 'Mock lokal' NOT NULL,
	`base_url` text,
	`model` text,
	`extension` text DEFAULT '/v1/chat/completions' NOT NULL,
	`key_ciphertext` text,
	`key_version` integer,
	`key_fingerprint` text,
	`temperature` real DEFAULT 0.2 NOT NULL,
	`max_tokens` integer DEFAULT 2000 NOT NULL,
	`timeout_seconds` integer DEFAULT 45 NOT NULL,
	`daily_limit` integer DEFAULT 20 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`settings_version` integer DEFAULT 1 NOT NULL,
	`prompt_version` text DEFAULT 'p1' NOT NULL,
	`last_test_fingerprint` text,
	`last_test_status` text DEFAULT 'untested' NOT NULL,
	`last_test_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_settings_mode_check" CHECK(mode in ('mock','local_endpoint','remote_endpoint')),
	CONSTRAINT "ai_settings_test_status_check" CHECK(last_test_status in ('untested','passed','failed')),
	CONSTRAINT "ai_settings_enabled_check" CHECK(enabled in (0,1)),
	CONSTRAINT "ai_settings_bounds_check" CHECK(temperature >= 0 and temperature <= 1 and max_tokens between 1 and 2000 and timeout_seconds between 5 and 60 and daily_limit between 1 and 100),
	CONSTRAINT "ai_settings_endpoint_check" CHECK(mode = 'mock' or enabled = 0 or (base_url is not null and model is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_settings_organization_unique` ON `ai_settings` (`organization_id`);--> statement-breakpoint
ALTER TABLE `organizations` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `email` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `leader_name` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `leader_title` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `registration_number` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `print_note` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `revision` integer DEFAULT 1 NOT NULL;