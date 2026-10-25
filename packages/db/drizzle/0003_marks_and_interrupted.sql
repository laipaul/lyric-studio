CREATE TABLE `video_mark` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`video` text NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "video_mark_status" CHECK(status in ('generated', 'approved', 'discarded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_mark_video_unique` ON `video_mark` (`video`);--> statement-breakpoint
CREATE INDEX `video_mark_project` ON `video_mark` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_render_job` (
	`id` text PRIMARY KEY NOT NULL,
	`variation_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`output_path` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`pid` integer,
	FOREIGN KEY (`variation_id`) REFERENCES `variation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "render_job_status_values" CHECK(status in ('queued', 'rendering', 'done', 'failed', 'interrupted')),
	CONSTRAINT "render_job_progress" CHECK(progress >= 0 and progress <= 1)
);
--> statement-breakpoint
INSERT INTO `__new_render_job`("id", "variation_id", "status", "progress", "output_path", "error", "started_at", "finished_at", "pid") SELECT "id", "variation_id", "status", "progress", "output_path", "error", "started_at", "finished_at", NULL FROM `render_job`;--> statement-breakpoint
DROP TABLE `render_job`;--> statement-breakpoint
ALTER TABLE `__new_render_job` RENAME TO `render_job`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `render_job_status` ON `render_job` (`status`);