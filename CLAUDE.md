# Lyric Studio — project brief for Claude Code

## What we are building
A personal, single-user, LOCAL lyric-video studio for the artist "Life Lyrics".
Input: one song (WAV/MP3) + lyrics + a pool of video clips.
Output: several 9:16 (1080x1920) beat-synced lyric videos as MP4, ready for Instagram Reels, TikTok, YouTube Shorts.

Three screens:
- **Home**: drop a song to create a project; list recent projects.
- **Studio**: left panel (project, sections, lyrics, text styles, cinematic bars), centre phone-shaped live preview with "Render video", right panel (media collections, add clips, filter all / in use / unused), bottom bar (play, undo, shuffle, Beat Synced with cut rate 0.5x / 1x / 2x / Off, timeline with clip thumbnails and beat ruler), variations strip under the preview.
- **Library**: tabs Projects, Exports, Uploads, Collections, with search.
A header "Tasks" menu shows render progress.

## Out of scope — never build these
Payments, credits, user accounts, login, multi-user, cloud hosting, cloud rendering, social posting, analytics.

## Tech stack (do not change without asking)
- Monorepo with pnpm workspaces
- `apps/studio`: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, dark theme
- `packages/video`: Remotion composition `LyricVideo` used by BOTH `@remotion/player` (preview) and `renderMedia` (export)
- `services/audio`: Python FastAPI on port 8001 — librosa for BPM/beats/downbeats; later WhisperX + Demucs for lyric alignment
- `apps/worker`: Node render worker that processes RenderJob rows
- SQLite via Drizzle ORM, file `workspace/studio.db`
- FFmpeg for thumbnails and clip normalisation (30 fps, 1080x1920, cover-crop)
- One `pnpm dev` command starts studio + worker + audio service

## Data model
- Project: id, title, artist, cover_path, audio_path, bpm, duration_ms, created_at
- LyricLine: id, project_id, index, text, start_ms, end_ms, is_hook, words_json (optional word timings)
- Beat: project_id, time_ms, strength, is_downbeat
- Section: id, project_id, name, start_ms, end_ms
- Collection: id, name
- Clip: id, collection_id, path, duration_ms, width, height, thumb_path, source (upload | stock | ai)
- StylePreset: id, name, font, weight, text_case, effect, animation, default_size
- Variation: id, project_id, section_id, seed, cut_rate, style_id, text_size, colour, cinematic_bars, overrides_json
- RenderJob: id, variation_id, status (queued | rendering | done | failed), progress, output_path, error, started_at, finished_at

Workspace folder layout: `workspace/projects/<id>/audio`, `workspace/projects/<id>/exports`, `workspace/clips/<collection>/`, `workspace/thumbs/`, `workspace/studio.db`.

## Core logic rules
- Cut points come from beats inside the selected section. Cut rate 1x = cut every downbeat (every bar), 2x = every half bar, 0.5x = every 2 bars, Off = one clip per lyric line.
- Shuffle is DETERMINISTIC: same seed + same inputs = same clip sequence. Use a seeded PRNG (e.g. mulberry32). Avoid the same clip twice in a row.
- Clips are cover-cropped to 9:16 and start at a random (seeded) offset inside the clip.
- Preview and render must use the exact same composition and props.
- Video: 30 fps, H.264, AAC 192 kbps, yuv420p, faststart.

## How to work with me (the user)
- I am an experienced IT consultant but NOT a developer. I am on Windows, using Cursor's terminal.
- Do ONE step at a time. Before writing code, give me a short plan (max 6 bullets).
- After each step: tell me exactly which command to run, what I should see, and how to check it works.
- Write a small automated test for any core logic (beat cuts, shuffle, timing).
- Commit to git at the end of each step with a clear message.
- Never install global tools or delete files outside this project without asking me.
- If something fails, explain the cause in plain words, then fix it.
- Keep `PROGRESS.md` updated: steps done, what works, known issues.
- Workflow: Claude builds and tests in a cloud session and commits and pushes every step directly to the `main` branch of GitHub `laipaul/videomaker`, so I only ever need `git pull`. I pull and run on Windows in Cursor's terminal (PowerShell). After each step, give me the exact Windows commands to pull and run it.
- Follow the steps strictly in the order I give. Never merge steps and never pull UI work forward.
- Phase 1 (Steps 2–5) has no UI. It ends when a beat-synced MP4 renders from the command line.
- After finishing a step, stop and wait for my next message. Do not start the next step on your own.
