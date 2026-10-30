# Data model and workspace folders

_Part of the project brief (CLAUDE.md links here). Database tables and the workspace folder layout. Moved word for word from CLAUDE.md on 30 Oct 2026; keep it up to date when this area changes._

- Project: id, title, artist, cover_path, audio_path, bpm, duration_ms, downbeat_offset (0-3: bar 1 starts N beats later than detected), folder (workspace-relative song folder "songs/<artist>/<title>"; empty = old layout projects/<id>, until migrated), created_at
- LyricLine: id, project_id, index, text, start_ms, end_ms, is_hook, words_json (optional word timings)
- Beat: project_id, time_ms, strength, is_downbeat (as detected; Project.downbeat_offset is applied when read)
- Section: id, project_id, name, start_ms, end_ms, energy (low | medium | high: low halves the cut rate, high doubles it)
- Collection: id, name
- Clip: id, collection_id, path, duration_ms, width, height, thumb_path, source (upload | stock | ai)
- StylePreset: id, name, font, weight, text_case, effect, animation, default_size
- Variation: id, project_id, section_id, seed, cut_rate, style_id, text_size, colour, cinematic_bars, overrides_json
- RenderJob: id, variation_id, status (queued | rendering | done | failed | interrupted), progress, output_path, error, started_at, finished_at, pid (the owning process; queued/rendering jobs whose process is gone become "interrupted", checked by the worker at start and every minute and by the studio)
- VideoMark: id, project_id, video (workspace-relative manifest path, unique), favourite, status (generated | approved | discarded), updated_at
- MakeRun: id, project_id, status (queued | running | done | failed | stopped | interrupted), label, options_json, progress, current, states_json, message, export_dir, pid, stop_requested, created_at, started_at, finished_at, cleared_at (Tasks "Clear finished": hides the entry only) (studio runs; a running run whose worker is gone becomes interrupted; an interrupted/failed job counts only until a later job of the same run, platform and seed is done)

Workspace folder layout (Step 6.2c): one folder per song `workspace/songs/<artist>/<title>/` with `song.wav|mp3`, `lyrics.txt`, `cover.jpg|png`, `hints.lrc` (optional), `clips/` (the song's own clips; `clips/_removed/` = removed, never deleted), `clips.json` (optional: the storyboard's story order and clip edits), `exports/<YYYY-MM-DD_HHmm>/<platform>/`, `song.json` (the recipe) and hidden `.studio/` (tool files: `lyrics/` alignments + stored hints + lyrics copies, `settings.json`, `replaced/`, `project-files/`); shared collections `workspace/collections/<name>/`; `workspace/thumbs/`, `workspace/cache/`, `workspace/studio.db`; `workspace/.studio/moved-paths.json` (every folder move, so old manifests still resolve); `workspace/migrations/<date>/` (migration backups + journals). Folder names are readable and Windows-safe (accents kept, `<>:"/\|?*` -> `_`, max 60 chars, " (2)" when taken); renaming title/artist renames the folder (not while another process renders it) and every database path follows. Every song path goes through `songPaths()` (packages/video/src/node/song-folder.ts), which also serves songs still in the old layout (`workspace/projects/<id>/{audio,lyrics,exports,settings.json}`, collections in `workspace/clips/<name>/`) until `pnpm songs:migrate --apply`.
