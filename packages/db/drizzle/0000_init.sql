CREATE TABLE `beat` (
	`project_id` text NOT NULL,
	`time_ms` integer NOT NULL,
	`strength` real DEFAULT 1 NOT NULL,
	`is_downbeat` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`project_id`, `time_ms`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `clip` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`path` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`thumb_path` text,
	`source` text DEFAULT 'upload' NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "clip_source" CHECK(source in ('upload', 'stock', 'ai'))
);
--> statement-breakpoint
CREATE INDEX `clip_collection` ON `clip` (`collection_id`);--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_name_unique` ON `collection` (`name`);--> statement-breakpoint
CREATE TABLE `lyric_line` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`index` integer NOT NULL,
	`text` text NOT NULL,
	`start_ms` integer,
	`end_ms` integer,
	`is_hook` integer DEFAULT false NOT NULL,
	`words_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lyric_line_project_index` ON `lyric_line` (`project_id`,`index`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`cover_path` text,
	`audio_path` text,
	`bpm` real,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `render_job` (
	`id` text PRIMARY KEY NOT NULL,
	`variation_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`output_path` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`variation_id`) REFERENCES `variation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "render_job_status_values" CHECK(status in ('queued', 'rendering', 'done', 'failed')),
	CONSTRAINT "render_job_progress" CHECK(progress >= 0 and progress <= 1)
);
--> statement-breakpoint
CREATE INDEX `render_job_status` ON `render_job` (`status`);--> statement-breakpoint
CREATE TABLE `section` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_range" CHECK(end_ms > start_ms)
);
--> statement-breakpoint
CREATE INDEX `section_project` ON `section` (`project_id`);--> statement-breakpoint
CREATE TABLE `style_preset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`font` text NOT NULL,
	`weight` integer NOT NULL,
	`text_case` text NOT NULL,
	`effect` text NOT NULL,
	`animation` text NOT NULL,
	`default_size` integer NOT NULL,
	CONSTRAINT "style_preset_text_case" CHECK(text_case in ('none', 'upper', 'lower', 'title'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `style_preset_name_unique` ON `style_preset` (`name`);--> statement-breakpoint
CREATE TABLE `variation` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`section_id` text,
	`seed` integer NOT NULL,
	`cut_rate` text DEFAULT '1x' NOT NULL,
	`style_id` text,
	`text_size` integer,
	`colour` text,
	`cinematic_bars` integer DEFAULT false NOT NULL,
	`overrides_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`style_id`) REFERENCES `style_preset`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "variation_cut_rate" CHECK(cut_rate in ('0.5x', '1x', '2x', 'off'))
);
--> statement-breakpoint
CREATE INDEX `variation_project` ON `variation` (`project_id`);