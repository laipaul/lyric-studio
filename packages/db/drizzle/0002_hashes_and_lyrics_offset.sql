ALTER TABLE `clip` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `clip_content_hash` ON `clip` (`content_hash`);--> statement-breakpoint
ALTER TABLE `project` ADD `audio_hash` text;--> statement-breakpoint
ALTER TABLE `project` ADD `lyrics_offset_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `project_audio_hash` ON `project` (`audio_hash`);