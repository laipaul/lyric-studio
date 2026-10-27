// Database schema. Mirrors the data model in CLAUDE.md exactly (table and column names in snake_case).
// File paths are stored RELATIVE to the workspace folder (with "/" separators), so the
// workspace can be moved to another drive by changing WORKSPACE_DIR.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const CLIP_SOURCES = ["upload", "stock", "ai"] as const;
export const CUT_RATES = ["0.5x", "1x", "2x", "off"] as const;
// interrupted: the process rendering it is gone (stopped or crashed); "pnpm make --resume" continues.
export const RENDER_STATUSES = ["queued", "rendering", "done", "failed", "interrupted"] as const;
export const VIDEO_MARKS = ["generated", "approved", "discarded"] as const;
export const RUN_STATUSES = ["queued", "running", "done", "failed", "stopped", "interrupted"] as const;
export const TEXT_CASES = ["none", "upper", "lower", "title"] as const;
export const ENERGY_LEVELS = ["low", "medium", "high"] as const;

export type ClipSource = (typeof CLIP_SOURCES)[number];
export type CutRate = (typeof CUT_RATES)[number];
export type RenderStatus = (typeof RENDER_STATUSES)[number];
export type VideoMarkStatus = (typeof VIDEO_MARKS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type TextCase = (typeof TEXT_CASES)[number];
export type Energy = (typeof ENERGY_LEVELS)[number];

// Optional word-level timings inside a lyric line.
export type WordTiming = { text: string; start_ms: number; end_ms: number };

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

export const project = sqliteTable(
  "project",
  {
    id: id(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    cover_path: text("cover_path"),
    audio_path: text("audio_path"),
    bpm: real("bpm"),
    duration_ms: integer("duration_ms"),
    // Bar 1 starts this many beats (0-3) later than the detected downbeats.
    downbeat_offset: integer("downbeat_offset").notNull().default(0),
    // SHA-256 of the song file: "pnpm make" reuses the project when the same song comes back.
    audio_hash: text("audio_hash"),
    // Moves every lyric line later (positive) or earlier, applied at render time. The aligned LRC
    // itself is never rewritten.
    lyrics_offset_ms: integer("lyrics_offset_ms").notNull().default(0),
    // The song's own folder (Step 6.2c): workspace-relative, e.g. "songs/Life Lyrics/Hold On". Empty for
    // songs still in the old layout (projects/<id>/) until "pnpm songs:migrate --apply".
    folder: text("folder"),
    created_at: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check("project_downbeat_offset", sql.raw("downbeat_offset between 0 and 3")),
    index("project_audio_hash").on(t.audio_hash),
  ],
);

export const lyricLine = sqliteTable(
  "lyric_line",
  {
    id: id(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    text: text("text").notNull(),
    start_ms: integer("start_ms"),
    end_ms: integer("end_ms"),
    is_hook: integer("is_hook", { mode: "boolean" }).notNull().default(false),
    words_json: text("words_json", { mode: "json" }).$type<WordTiming[]>(),
  },
  (t) => [uniqueIndex("lyric_line_project_index").on(t.project_id, t.index)],
);

export const beat = sqliteTable(
  "beat",
  {
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    time_ms: integer("time_ms").notNull(),
    strength: real("strength").notNull().default(1),
    is_downbeat: integer("is_downbeat", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.project_id, t.time_ms] })],
);

export const section = sqliteTable(
  "section",
  {
    id: id(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    start_ms: integer("start_ms").notNull(),
    end_ms: integer("end_ms").notNull(),
    // Low halves the cut rate, high doubles it.
    energy: text("energy", { enum: ENERGY_LEVELS }).notNull().default("medium"),
  },
  (t) => [
    index("section_project").on(t.project_id),
    check("section_range", sql.raw("end_ms > start_ms")),
    check("section_energy", inList("energy", ENERGY_LEVELS)),
  ],
);

export const collection = sqliteTable("collection", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const clip = sqliteTable(
  "clip",
  {
    id: id(),
    collection_id: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    duration_ms: integer("duration_ms").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    thumb_path: text("thumb_path"),
    source: text("source", { enum: CLIP_SOURCES }).notNull().default("upload"),
    // SHA-256 of the video file: "pnpm make" re-imports a clip only when its content changes.
    content_hash: text("content_hash"),
  },
  (t) => [
    index("clip_collection").on(t.collection_id),
    index("clip_content_hash").on(t.content_hash),
    check("clip_source", inList("source", CLIP_SOURCES)),
  ],
);

export const stylePreset = sqliteTable(
  "style_preset",
  {
    id: id(),
    name: text("name").notNull().unique(),
    font: text("font").notNull(),
    weight: integer("weight").notNull(),
    text_case: text("text_case", { enum: TEXT_CASES }).notNull(),
    effect: text("effect").notNull(),
    animation: text("animation").notNull(),
    default_size: integer("default_size").notNull(),
  },
  (t) => [check("style_preset_text_case", inList("text_case", TEXT_CASES))],
);

export const variation = sqliteTable(
  "variation",
  {
    id: id(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    section_id: text("section_id").references(() => section.id, { onDelete: "set null" }),
    seed: integer("seed").notNull(),
    cut_rate: text("cut_rate", { enum: CUT_RATES }).notNull().default("1x"),
    style_id: text("style_id").references(() => stylePreset.id, { onDelete: "set null" }),
    text_size: integer("text_size"),
    colour: text("colour"),
    cinematic_bars: integer("cinematic_bars", { mode: "boolean" }).notNull().default(false),
    overrides_json: text("overrides_json", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index("variation_project").on(t.project_id),
    check("variation_cut_rate", inList("cut_rate", CUT_RATES)),
  ],
);

export const renderJob = sqliteTable(
  "render_job",
  {
    id: id(),
    variation_id: text("variation_id")
      .notNull()
      .references(() => variation.id, { onDelete: "cascade" }),
    status: text("status", { enum: RENDER_STATUSES }).notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    output_path: text("output_path"),
    error: text("error"),
    started_at: integer("started_at", { mode: "timestamp_ms" }),
    finished_at: integer("finished_at", { mode: "timestamp_ms" }),
    // The process (pnpm make / the worker) that owns the job, to detect interrupted runs.
    pid: integer("pid"),
  },
  (t) => [
    index("render_job_status").on(t.status),
    check("render_job_status_values", inList("status", RENDER_STATUSES)),
    check("render_job_progress", sql.raw("progress >= 0 and progress <= 1")),
  ],
);

// Every table, in display order (used by db:show and tests).
// The user's marks on a finished video (studio exports grid): favourite, and generated / approved /
// discarded (discarded = hidden, never deleted). `video` is the workspace-relative manifest path.
export const videoMark = sqliteTable(
  "video_mark",
  {
    id: id(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    video: text("video").notNull().unique(),
    favourite: integer("favourite", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: VIDEO_MARKS }).notNull().default("generated"),
    updated_at: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("video_mark_project").on(t.project_id), check("video_mark_status", inList("status", VIDEO_MARKS))],
);

// A "pnpm make" run started from the studio (Generate, Resume): queued, then done by the worker one at
// a time. options_json: the choices; states_json: the videos with their progress (Tasks menu).
export const makeRun = sqliteTable(
  "make_run",
  {
    id: id(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
    label: text("label").notNull(),
    options_json: text("options_json", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    progress: real("progress").notNull().default(0),
    current: text("current"),
    states_json: text("states_json", { mode: "json" }).$type<{ platform: string; name: string; status: string; progress: number }[]>(),
    message: text("message"),
    export_dir: text("export_dir"),
    pid: integer("pid"),
    stop_requested: integer("stop_requested", { mode: "boolean" }).notNull().default(false),
    created_at: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    started_at: integer("started_at", { mode: "timestamp_ms" }),
    finished_at: integer("finished_at", { mode: "timestamp_ms" }),
    cleared_at: integer("cleared_at", { mode: "timestamp_ms" }), // "Clear finished" in the Tasks menu (hides the entry only)
  },
  (t) => [
    index("make_run_status").on(t.status),
    check("make_run_status_values", inList("status", RUN_STATUSES)),
    check("make_run_progress", sql.raw("progress >= 0 and progress <= 1")),
  ],
);

export const TABLES = {
  project,
  lyric_line: lyricLine,
  beat,
  section,
  collection,
  clip,
  style_preset: stylePreset,
  variation,
  render_job: renderJob,
  video_mark: videoMark,
  make_run: makeRun,
} as const;

export type Project = typeof project.$inferSelect;
export type VideoMark = typeof videoMark.$inferSelect;
export type MakeRun = typeof makeRun.$inferSelect;
export type LyricLine = typeof lyricLine.$inferSelect;
export type Beat = typeof beat.$inferSelect;
export type Section = typeof section.$inferSelect;
export type Collection = typeof collection.$inferSelect;
export type Clip = typeof clip.$inferSelect;
export type StylePreset = typeof stylePreset.$inferSelect;
export type Variation = typeof variation.$inferSelect;
export type RenderJob = typeof renderJob.$inferSelect;
