CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`folder` text NOT NULL,
	`scope_kind` text DEFAULT 'artist' NOT NULL,
	`scope_value` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "card_kind_values" CHECK(kind in ('character', 'scene')),
	CONSTRAINT "card_status_values" CHECK(status in ('draft', 'locked')),
	CONSTRAINT "card_scope_values" CHECK(scope_kind in ('artist', 'ep', 'song'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_kind_name` ON `card` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `card_job` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`label` text NOT NULL,
	`options_json` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`current` text,
	`message` text,
	`cost_usd` real,
	`pid` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`cleared_at` integer,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_job_status_values" CHECK(status in ('queued', 'running', 'done', 'failed', 'stopped', 'interrupted')),
	CONSTRAINT "card_job_kind_values" CHECK(kind in ('pack', 'view', 'fetch', 'calibrate')),
	CONSTRAINT "card_job_progress" CHECK(progress >= 0 and progress <= 1)
);
--> statement-breakpoint
CREATE INDEX `card_job_status` ON `card_job` (`status`);