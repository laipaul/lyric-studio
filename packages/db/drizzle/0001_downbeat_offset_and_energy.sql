-- Hand-written: adds the columns in place. (The generated version rebuilt the tables, which inside
-- the migration transaction would cascade-delete existing beats, sections and variations.)
ALTER TABLE `project` ADD `downbeat_offset` integer DEFAULT 0 NOT NULL CONSTRAINT "project_downbeat_offset" CHECK(downbeat_offset between 0 and 3);--> statement-breakpoint
ALTER TABLE `section` ADD `energy` text DEFAULT 'medium' NOT NULL CONSTRAINT "section_energy" CHECK(energy in ('low', 'medium', 'high'));
