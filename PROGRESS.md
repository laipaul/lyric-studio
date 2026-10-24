# Progress

## Steps done

### Step 1 — Monorepo skeleton ✅
- pnpm workspaces: `apps/studio`, `apps/worker`, `packages/video`, `packages/db`, `services/audio`.
- `apps/studio`: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui, dark theme.
  Placeholder pages: Home (`/`), Studio (`/studio`), Library (`/library`).
  Studio has the three-panel layout (project panel, phone-shaped 9:16 preview with a disabled
  "Render video" button, media panel).
- `apps/worker`: Node + TypeScript, prints `worker ready` and stays running.
- `packages/video`: Remotion 4 with a placeholder `LyricVideo` composition (1080x1920, 30 fps).
- `packages/db`: empty package, ready for Drizzle + SQLite.
- `services/audio`: FastAPI on port 8001 with `GET /health`, in a project-local `.venv`
  (Python 3.12, created automatically by `pnpm audio:setup` or the first `pnpm dev`).
- One root `pnpm dev` starts studio + worker + audio together.
- Test: `packages/video/src/config.test.ts` checks the video format (1080x1920, 9:16, 30 fps).

### Setup fixes (after Step 1)
- Work happens directly on `main`.
- Accept Node 22/24 and pnpm 10/11/12: removed the pnpm version pin, added the pnpm 11+
  `allowBuilds` setting, and rebuilt the lockfile with pnpm 12 (pnpm 12 rejects packages published
  in the last 24 hours, and the old lockfile contained some).
- Audio service always uses Python 3.12 (`py -3.12` on Windows, `python3.12` elsewhere). An
  existing `.venv` built with another version is rebuilt; a clear error is shown if 3.12 is missing.
- Next.js telemetry is disabled for this project (`NEXT_TELEMETRY_DISABLED=1` via `cross-env`
  in the studio scripts). Check with `pnpm --filter @lyric/studio telemetry`.

### Step 2 — Database and workspace ✅
- `packages/db`: Drizzle ORM + SQLite (`better-sqlite3` 13, which includes a ready-built Windows
  x64 file — no compiler or download needed) at `<workspace>/studio.db`.
- All 9 tables from CLAUDE.md: project, lyric_line, beat, section, collection, clip,
  style_preset, variation, render_job. Foreign keys with cascade delete; checks on clip.source,
  variation.cut_rate (0.5x / 1x / 2x / off), render_job.status, render_job.progress (0–1),
  style_preset.text_case, section end > start.
- Migration `packages/db/drizzle/0000_init.sql` (regenerate after schema changes with `pnpm db:generate`).
- Seed: 10 style presets (Simple, Bold, Blur, Brat, TikTok, Inked, Hollow, Subtitle, Matrix,
  Elegant). Safe to re-run.
- Workspace service (`packages/db/src/workspace.ts`): `openWorkspace`, `createProject` (copies the
  song to `projects/<id>/audio`, creates `exports`, reads duration), `createCollection`
  (`clips/<name>/`), `addClip` (copies the video, reads duration/width/height incl. phone rotation,
  JPG thumbnail to `thumbs/<clip id>.jpg` taken at 1 s, or the middle of clips under 2 s).
  File names are made Windows-safe and never overwrite existing files.
- Paths in the database are relative to the workspace, so `WORKSPACE_DIR` (in `.env`, default
  `./workspace`) can point to another drive.
- FFmpeg/ffprobe from the PATH (override with `FFMPEG_PATH` / `FFPROBE_PATH`).
- Commands: `pnpm db:show`, `pnpm db:setup`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate`.
  `pnpm dev` runs `db:setup` first.
- Tests (`packages/db/test`, 12): all tables created, seed gives exactly 10 presets twice,
  invalid status rejected, project creation, clip + thumbnail creation (checks the thumbnail is
  from ~1 s by using a clip that is black for its first 0.5 s), short-clip thumbnail, non-video
  rejected, WORKSPACE_DIR resolution, Windows-safe names.

### Step 3 — Audio analysis service ✅
- `services/audio` (Python 3.12, librosa 1.0.0): `POST /analyze` with a workspace-relative
  `path`, optional `project_id` and optional manual `bpm`. Returns `bpm`, `bpm_source`
  (detected | manual), `bpm_alternatives` (half / double), `duration_ms`, `downbeat_confidence`,
  `beats` [{time_ms, strength 0–1, is_downbeat}], `file_hash`, `cached`.
- Method: librosa beat tracking → each beat snapped to the actual hit (short 512-sample window,
  sub-frame interpolation) → exact BPM from a straight-line fit of the beat grid → second
  tracking pass at that exact BPM. Downbeats (4/4): the beat phase with the strongest
  low-frequency (< 150 Hz) onsets; confidence = how much it beats the runner-up.
- Manual BPM: half/double of the detected tempo is derived from the detected beats (half keeps
  the stronger beats); any other value re-tracks around it. Fine-tuned by at most 3%.
- Cache: `<workspace>/cache/analysis/<sha256>-v<version>[-bpm<n>].json`.
- With `project_id`: updates project.bpm / duration_ms and replaces its beats in one transaction.
- Paths outside the workspace are refused (400); missing file 404; unreadable audio 422.
- `pnpm analyze <file> [--bpm N] [--json]` runs the analysis directly (no server needed).
- Python packages pinned in `requirements.txt` (generated from `requirements.in`); all 46 have
  Windows x64 / Python 3.12 wheels (verified) and install with `--only-binary=:all:`.
  The `.venv` reinstalls automatically when `requirements.txt` changes.
- Tests (`services/audio/tests`, 25, run by `pnpm test` / `pnpm test:audio`): click tracks at
  90 / 120 / 128 BPM with accented downbeats and a pickup beat (BPM ±1, every beat and downbeat
  within 50 ms), other pickups, a 100-bar song (BPM ±0.1), a realistic groove with kick on 1 and 3,
  MP3 input, manual half/double/near BPM, cache, path safety, saving to Project/Beat tables.

## What works
- `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm --filter @lyric/studio build`.
- `pnpm db:show` / `db:setup` / `db:migrate` / `db:seed`.
- `pnpm analyze <file>`, `POST /analyze`, `pnpm test:audio`.
- http://localhost:3000 (Home / Studio / Library) and http://127.0.0.1:8001/health.

## Known issues
- Downbeats assume 4/4. When the kick is equally strong on beats 1 and 3 (and nothing else
  marks the bar), beat 1 vs 3 is a guess; the confidence value shows this.
- Beats are placed on the attack of each hit, typically within ~10 ms; real songs not yet validated
  (to be checked on the user's PC).
- shadcn/ui components (button, card, input, tabs) were added by hand in the same format the
  shadcn CLI produces, because the build environment could not reach the shadcn website.
  `pnpm dlx shadcn@latest add <name>` works normally on your PC for future components.
- FFmpeg (and ffprobe) must be on the PATH for adding clips and for the db tests.
- The workspace service is used by tests only so far; commands and UI that use it come in later steps.

## Next
- Step 4 — waiting for instructions.
