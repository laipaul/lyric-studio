CREATE TABLE `make_run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`label` text NOT NULL,
	`options_json` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`current` text,
	`states_json` text,
	`message` text,
	`export_dir` text,
	`pid` integer,
	`stop_requested` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "make_run_status_values" CHECK(status in ('queued', 'running', 'done', 'failed', 'stopped', 'interrupted')),
	CONSTRAINT "make_run_progress" CHECK(progress >= 0 and progress <= 1)
);
--> statement-breakpoint
CREATE INDEX `make_run_status` ON `make_run` (`status`);