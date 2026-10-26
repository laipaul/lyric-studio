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

### Step 3 — Audio analysis service ✅ (verified on Windows)
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

### Step 4 — Cut points, seeded shuffle, beat-grid checks ✅
- Migration `0001_downbeat_offset_and_energy` (hand-written `ALTER TABLE ... ADD`, so existing data
  is kept; the generated version would have rebuilt tables): `project.downbeat_offset` (0–3),
  `section.energy` (low | medium | high). Upgrade tested with existing rows.
- Beat table keeps detected downbeats; the project's offset is applied when reading
  (`applyDownbeatOffset` in TS, `apply_downbeat_offset` in Python — same rule).
- `pnpm analyze --click` writes `<song>_click.wav` (original quality and channels, music at 70%,
  1 kHz click per beat, louder 2 kHz click per downbeat). `--downbeat-offset N` changes bars, the
  click file and, for a project's song, saves the offset. `/analyze` accepts `downbeat_offset`.
- `packages/video`: `getCutPoints(beats, section, options)` — rate 0.5x/1x/2x/off, energy factor,
  frame-accurate early cut, grid anchored on the section's first bar, minimum shot 0.8 s by
  stepping to the next coarser regular grid (edge shots merged), holdOnLyricLines.
  `assignClips(plan, clips, seed)` — mulberry32, clips sorted by id, never the same clip twice in
  a row, avoids the last 3 when possible, prefers clips long enough, seeded start offset inside the
  clip; a too-short clip is slowed down (playback_rate ≥ 0.5) or plays at 0.5x and holds its last frame.
- `pnpm cuts <song> --section a-b [--rate --energy --early --downbeat-offset --json]`.
- Tests: 25 TypeScript (video) — same/different seed, early-cut frames, offset, 2x doubles,
  low halves, hold never inside a line, min shot for all rates/energies/tempos, thinned cuts evenly
  spaced, edge shots, offsets inside clips, slow-down and hold cases; verified that deliberately
  broken code makes them fail. 5 Python (click file, offset, saving). 1 DB upgrade test.

### Step 5 — Composition, first real render, preview ✅
- `LyricVideo` (packages/video): 1080x1920, 30 fps. Shots from `getCutPoints` + `assignClips`
  (cover-cropped, seeded start, `playbackRate`, hold last frame via `Freeze`), song audio from the
  section start with 0.3 s fade-in / 0.5 s fade-out, lyric lines on the vocal (Simple = Inter 600
  fade, Bold = Montserrat 900 upper-case shadow pop), text size, colour, cinematic bars.
- Safe zones: lyrics never in the bottom 20% / right 12%; centred in the safe area at 62.5% height.
  Long lines: 1 line → 2 balanced lines → shrink ≤ 25% → 3 lines only as a last resort (never more)
  with "Line N is too long for phone screens; split it in lyrics.txt" warnings (tap + render:test).
  Text is measured in Node with fontkit using the same font files (matches the browser in tests).
- Fonts from @fontsource (served locally, works offline). Props hold workspace-relative paths +
  `mediaBaseUrl`; render uses a local media server, preview uses `/api/media` (Range support).
- `composeProps(base, seed, style)` is the single function used by both render:test and /preview.
- `pnpm render:test`: imports clips into collection "test", normalises them (FFmpeg: H.264
  1080x1920 30 fps cover-crop, cached in `workspace/cache/normalised`), snaps the section start to
  the nearest downbeat (reported), renders with Remotion (h264, aac 192k, yuv420p bt709 limited range,
  faststart verified).
- `pnpm tap`: Python (sounddevice) player using the sound card clock; Enter / Backspace / r / q;
  blank line = pause; writes `lyrics.lrc` (backup `.lrc.bak`); `--shift`.
- `/preview` page (approved UI exception): @remotion/player, Shuffle, Simple/Bold, safe-zone guides,
  shows the matching render:test command.
- GitHub Actions (`.github/workflows/test.yml`): ubuntu-latest, pnpm + pip caches, 20 min, on push to main.
- Tests: render tests with real Remotion renders (3 s sample format check incl. faststart + audio
  fades, cuts on exact getCutPoints frames, lyric visible exactly from first to last frame, long
  lines inside the safe zone on 2 lines, 3-line last resort, never more than 3, playbackRate and
  start offset, hold last frame); layout/LRC unit tests; 9 Python tap tests (simulated keys/clock).

### Step 5b — Timing, clip order, pins, fonts ✅
- Lyric timing: lines appear 0.25 s before their stamp (`--lead`), plus `--lyrics-offset`;
  `/preview` slider (−1…+1 s) with the matching command; `pnpm lrc:shift <lrc> <s>` (keeps `.bak`);
  `pnpm tap` defaults to `--shift -0.15`.
- Hooks: `* ` in lyrics.txt or after the stamp in the .lrc; all identical lines become hooks
  (case/punctuation/spaces ignored); `pnpm lrc:hook <lrc> "<line>"`.
- Bold preset 72 px (existing databases updated only if still 84 px).
- Clip order `--order story|shuffle` (default story: natural file-name order, cycling, resumes inside
  a clip, never twice in a row); `/preview` toggle.
- Pins (`pins.txt`): clip forced onto the shot where the line appears (after lead/offset), at every
  occurrence; override the order; warnings for unknown lines/clips, outside the section, conflicts.
- Fonts: 14 Google Fonts bundled via @fontsource (+ Inter, Montserrat), italics where published;
  user fonts in `WORKSPACE_DIR\fonts` (family/weight/italic read with fontkit); `pnpm fonts`;
  `--font`, `--font-hook`; props carry the exact font files. All 16 bundled families have
  é è à ç œ and their capitals.
- Tests: LRC shift/hook, lead/offset frames, pins (parse, match, every occurrence, both orders,
  follows timing, warnings), story order, font catalog (user fonts, italics, nearest weight,
  accents, serving), Bold update, tap default shift and hook marker, renders: line visible exactly
  0.25 s early, user font + hook font drawn.

### Step 5c — Automatic lyric alignment (`pnpm align`) ✅ (accepted, verified on the Windows PC)
- `pnpm audio:setup --ai`: optional AI extra in the same `.venv`. PyTorch 2.8.0 from the PyTorch
  index (CUDA 12.8 build on Windows for RTX 50-series/Blackwell, CPU build on Linux; `--torch cpu`
  for the smaller CPU build), then pinned `requirements-ai-<platform>.txt` (WhisperX 3.8.6,
  Demucs 4.1.0; all with ready-made wheels; checked in CI that the Windows cu128 wheels exist).
- Models download on first use into `services/audio/models` (HF_HOME, TORCH_HOME, NLTK_DATA).
- Device line at start (GPU name, CUDA version, compute capability, or CPU with the reason);
  GPU failures retry on the CPU with a message; `--device auto|cuda|cpu`.
- Demucs htdemucs vocal stem cached by song hash (`workspace/cache/stems`); WhisperX forced
  alignment (en: WAV2VEC2_ASR_BASE_960H, fr: jonatasgrosman/wav2vec2-large-xlsr-53-french,
  `--align-model` to change), audio processed in 30 s windows so an 8 GB GPU is plenty; alignment
  cached (`workspace/cache/align`).
- `--trim on|off` (default on): a word stretched across a silent gap (before or after it) is cut
  back to its strongest burst of voice on the vocal track.
- Output: enhanced LRC (line stamps + `<mm:ss.xx>` word tags), hooks and pauses kept, `.bak`;
  per-line confidence, < 0.5 in orange; `--compare` (per-line diff, median, worst 5, typical
  offset + `pnpm lrc:shift` suggestion, tapped time next to low-confidence lines); never overwrites
  the comparison file (writes `<lyrics>.aligned.lrc` instead).
- LRC reader/`lrc:shift`/`lrc:hook` understand word tags.
- `--diagnose <lines>`: words + scores, loudness chart around aligned/tapped time, voice bursts,
  best-guess label (reverb tail / breath / quieter backing vocal / earlier phrase), WAV snippets.
- `--hint <taps.lrc>`: lines < 0.7 confidence (threshold confirmed by the user) are moved to the
  voice onset nearest to (tap + typical offset), within ±1.5 s, and re-aligned on their own
  (fallback: words shifted); adjusted lines reported. Real-model test: a line forced 2.8 s early is
  restored to 11 ms.
- List options accept commas, spaces or both (`--diagnose "2,9"`, `"2 9"`, or PowerShell's unquoted
  `2,9`, which arrives as two arguments). Windows examples quote lists.

#### Results on the user's song (Windows, RTX 5060)
- Plain alignment was audibly right except lines 2 ("When the night won't let you sleep", 0.55)
  and 9 ("When the world has moved along", 0.67): both ~2.8 s before the taps.
- `--hint workspace\test\Lyrics.lrc` moved lines 2, 9 and 19; line 2 is now at 15.82 s, matching
  an independent reference. Re-rendered with `Lyrics.aligned.lrc`: sync judged perfect by the user.

#### Recommended workflow for lyric timing
1. Write `lyrics.txt` (one line per lyric line, blank line = pause, `* ` = hook).
2. If you have tapped times (`pnpm tap`), align with them as hints:
   `pnpm align <song> <lyrics.txt> --hint <taps.lrc>` (writes `<lyrics>.aligned.lrc` when the
   taps file would otherwise be overwritten). Without taps: `pnpm align <song> <lyrics.txt>`.
3. Check orange (low-confidence) lines; for any that still sound off, `--diagnose "<line numbers>"`
   and listen to the snippets in `workspace\cache\diagnose\`.
4. Render with that file: `pnpm render:test --lrc <lyrics>.aligned.lrc`.
- Tests: 20+ Python unit tests (LRC output, word mapping, compare, path safety, device choice and
  fallback, gap trim, switch); real-model tests in the "AI alignment" GitHub workflow (Demucs +
  WhisperX on CPU, synthetic espeak-ng song in English and French; windowed processing identical
  to whole-audio processing). Latest run: all 8 line starts within 15-65 ms of the truth, no word
  reaching into the next line.

### Step 5d — One-click Auto Generate (`pnpm make`, `pnpm rerender`) ✅ (to verify on the Windows PC)
- `pnpm make <song> <lyrics.txt> --collection <name> [--collection-path] [--variations 6]
  [--section auto|full|a-b] [--hint] [--realign] [--lrc] [--lang] [--rate] [--energy] [--lead]
  [--lyrics-offset] [--font] [--font-hook] [--pins] [--parallel N] [--no-open]`.
- Migration `0002_hashes_and_lyrics_offset` (in place, data kept): `project.audio_hash`,
  `project.lyrics_offset_ms` (default 0), `clip.content_hash`.
- Project found again by the song's SHA-256 (rename/move does not matter). Beats from the cached analysis.
- Collections: `WORKSPACE_DIR\clips\<name>\` (or `--collection-path`), clips recorded in place (not
  copied); new / changed / unchanged / removed by content hash (hashes cached by size + date in
  `cache\hashes.json`); prepared 1080x1920 copies are keyed by content hash.
- Lyrics: `pnpm align` runs automatically (`--report` JSON with per-line confidence and sung end,
  `--fresh` for `--realign`); each alignment is stored once in `projects\<id>\lyrics\aligned-<key>-<time>.lrc`
  and never rewritten (key = lyrics.txt + hint + language). Project lyrics offset applied at render
  time. Hooks from `* ` in lyrics.txt. `--lrc` stores a given LRC as-is (no AI needed).
- Section auto: anchor = first hook line (one marked line per chorus is enough), else the most
  repeated block, else line 1. Start = one bar before the anchor; if the line before it is still being
  sung there, the bar before that line (at most 2 lines back, else a warning). End = first bar after a
  lyric line finishes, 45-60 s, chorus line preferred; up to 65 s rather than cutting a line; reason printed.
  A line whose singing is over but still on screen at the start (an LRC line lasts until the next
  stamp) is not shown.
- Variations: v1 story, v2..vN shuffle seed N; Simple/Bold alternate; bars on v2, v4, ...; all share
  one section, audio and cut grid (tested). Variation + RenderJob rows written (status, progress, output).
- Parallel rendering: 2 videos at a time with up to 8 frames in parallel each on 8+ threads / 16+ GB
  (your PC: 2 x 8, about 10 GB at most); memory kept under half of RAM; `--parallel N` overrides.
- Output `projects\<id>\exports\<YYYY-MM-DD_HHmm>\v1.mp4`, `v1.manifest.json` (tool version + git
  commit, clip files + hashes, in/out frames, playbackRate, cuts, lyric timings incl. lead/offset,
  style, font files + hashes, settings, full props), `v1.qa.txt`. Summary table; Explorer opens.
- QA: confidence < 0.5, clip repeated within 3 shots, black/frozen frames (FFmpeg blackdetect /
  freezedetect, 10 frames per second sampled; held last frames named as cause), > 2 text lines,
  shots < 0.8 s, lyric box outside the safe zone (measured with the real fonts). PASS / WARN + reasons.
- `pnpm rerender <manifest>`: checks song, clips and fonts by hash (clear error naming the changed
  file), remakes a deleted prepared copy, renders the stored props to `v1.rerender.mp4`.
- Tests: 14 section (hook lead-in, pickup, never mid-line start/end, 65 s extension, cut-line warning,
  repeated block, no hooks, short song, lingering line), 10 QA (each check with a bad case, real FFmpeg
  black/frozen detection), 16 make (collection new/changed/removed/outside, project by hash, stored /
  realign / hint / given LRC, variations, render limit, full run with renders, manifest contents,
  identical section across variations, rerender = same props + identical sampled frames, LRC hash
  unchanged after make and rerender, changed clip refused), 1 Python report test, 1 DB upgrade test.
- Cloud check: a 60 s, 2-variation run of a synthetic song rendered and passed QA; the rerender
  of v1 was frame-identical (all 1800 frames). Cloud machine: 4 threads, ~3 min per 60 s video.

### Step 5d.1 — Windows memory, retry, `--resume` ✅ (verified on the Windows PC)
- Cause of "Compositor quit: memory allocation … failed" with `--parallel 2`: Remotion's clip-frame
  cache defaults to half of the free memory **per render**, so two renders each claimed half.
- Now: `--parallel 1` by default on Windows; the clip cache is capped (2 GB with one render, smaller
  with more); the estimate counts 0.75 GB per browser tab + 1.5 GB per render + the cache and stays
  under 40% of RAM (your PC: 1 video, 8 frames in parallel, about 9.5 GB at most).
- A failed variation is retried once with half the frames in parallel and half the cache; a render
  with no progress for 5 minutes is cancelled (watchdog); the FFmpeg QA check has a 10-minute limit.
  The other variations always continue; failures are listed with a hint to use `--resume`.
- `pnpm make … --resume`: reuses the latest export folder and renders only variations without all
  three files (mp4, manifest, qa); refuses with the reason if the section, LRC, lead/offset, cuts,
  settings or clips changed since that run. The summary marks kept and retried variations.
- Tests: render limit on Windows and Linux (memory always ≤ 40%), retry settings, watchdog (timer
  and a real Remotion render cancelled with no partial file left), capped cache in a real render,
  failure + retry + carry-on, --resume (only missing, interrupted, nothing left), --resume refused.

### Step 5g.1 — Platform presets: Reels, TikTok, Shorts ✅ (tested on the Windows PC: 8 videos, 450 s, all PASS, 6/6 clips vertical-usable, song.lrc exported; timing issues fixed in 5g.1b)
- `presets/platforms.json` (editable, checked at start; every mistake named with platform and field):
  standard (today's behaviour), reels, tiktok, shorts; youtube and canvas were listed but marked
  "comes in Step 5g.2 / 5g.3". Per platform: size, aspect, length (target +-tolerance / range / full /
  loop), anchor (lead-in or centre), variations, safe zones (top/bottom/left/right), lyricsAt, text
  scale, video bitrate, fade-out, loop ending, lyrics/audio switches.
- `pnpm make … --platforms reels,tiktok,shorts` (or `all`): one subfolder per platform in the run's
  folder, each with its own videos, manifests (with the preset and brand) and QA; "standard" (no
  --platforms) stays directly in the run's folder. `--variations` overrides the preset's number.
- Composition: frame size, safe zones and lyric area come from the props (Root uses calculateMetadata),
  so preview and render stay identical. Lyric area computed from the safe zones: centred in the usable
  area at 45% (slightly above middle); with cinematic bars the bars count as covered.
  Note: this moves the lyrics of the standard preset from 62.5% to ~41.5% of the height (top 10%,
  bottom 20% safe zones), as asked ("never a fixed percentage").
- Sections per preset: target +-15% on bars (replaced in 5g.1b: hook-first, word-level line ends).
  Reels loop ending: ends on a bar, 0.12 s fade-out, last shot = the first
  clip's frames right before shot 1 (or the same photo ending where its move starts); the loop clip
  is kept out of the 3 shots before; a warning if the first clip is too short for a seamless loop.
- Sources by orientation (width/height at import): 9:16 = vertical/square, horizontal only at >= 2x
  the output height; others skipped (listed) or, with `--allow-fill`, shown whole over a blurred copy.
  QA check "Sources for this format": WARN with the count needed; no usable source = clear error.
- Photos (jpg/png/webp) in any collection: size recorded, thumbnail, prepared JPEG (max 3000 px),
  seeded Ken Burns move (zoom 1.00-1.12, gentle pan, never shows an edge) over exactly the shot.
- Brand: `workspace\brand\brand.json` created with Cinzel (title, wide spacing) / Cormorant Garamond
  (verse) / Kaushan Script (hook) / #E8A3B5 / logo bottom-left 8%; lyrics use the brand fonts unless
  --font/--font-hook (or "useForLyrics": false). Cinzel bundled (@fontsource, OFL). Logo, title font
  and accent colour are used from Step 5g.2 (thumbnails, title cards).
- Clean synced `<song>.lrc` in the run's folder (title/artist/length tags, offset applied, pauses, no
  word tags or hook markers) for Musixmatch / LyricFind.
- Fixes found while building: FFmpeg writes no thumbnail for a photo when asked to seek (`-ss 0`).
- Tests: presets file (defaults, edits respected, errors), --platforms parsing, lyric area per
  platform, no lyric block in any platform's safe zone (1-3 lines, largest text, bars, pop overshoot),
  orientation rules, Ken Burns bounds (500 seeds), loop ending (story/shuffle, too-short fallback,
  no repeat before it), platform sections (length window, bars, never mid-line, Reels centred), clean
  LRC; real renders: photo motion without edges, blurred fill, output at the preset's size; make with
  3 platforms (folders, variations, sizes, safe zones, fades, lengths, loop, photos, LRC), --allow-fill,
  too few / no sources, edited presets file, --resume per platform; photo import in the DB.

### Step 5g.1b — Timing fixes ✅ (accepted: tested on the Windows PC — all 8 PASS, hook-first at 0:10.8 (1.0 s before the hook), reels 31.6 s, shorts 45.2 s, no cut lines, hints stored)
Problems seen on the PC: Reels 38.4 s (window 25.5-34.5), Shorts 63.2 s (42.5-57.5), TikTok cut
line 7 "Still burning through the dark", Reels started 0:04.0, ~8 s before the hook.
Cause: a line was treated as sung until the next line started (and the next line counted from
0.25 s before its stamp), so with lines sung back to back almost no bar was "clean".
1. Line ends from word timings: `pnpm align` writes a trailing end tag after each line's last word
   (`<mm:ss.xx>` with no word) and the report lists every word's start and end. A cut is clean at a
   bar after the last word ends and before the next line's first word. Older LRCs: the end is
   estimated from the word starts; without word timings the line-start logic stays. A line whose
   first word is after the video's end is not shown (it would flash up in the last 0.25 s).
2. Short-form is hook-first (reels, tiktok, shorts; the "centred on the chorus" rule is removed):
   start at most 1 bar before the hook's first word, never earlier; if the line before is still
   sung there, the start stays and QA warns. Standard keeps its lead-in rule.
3. Length: within +-15%; else the nearest clean line end up to 25% shorter; else up to 30% longer;
   then (last resort) a cut with a warning. The reason line says which.
4. QA check "Section start/end": a sung line cut at the start or end is WARN with the line named.
5. Hints remembered per project: the first --hint is copied into `projects\<id>\lyrics\` (hint.json)
   and reused automatically ("using stored hints from …"), also after lyrics.txt changes; --no-hint
   or a lost copy warns clearly. Manifests record the hint source and whether it was stored.
6. Changing only hook markers in lyrics.txt does not re-align (alignments are keyed on the words);
   hook flags always follow the current lyrics.txt.
- Note: alignment store version 2 — each song aligns once more on its next run (the vocal track is
  cached, so it is quick); afterwards LRCs have the word end tags.
- Tests: 13 timing tests (end tags, clean-cut rule and the line-start fallback, regression case
  modelled on the user's song — 106.63 BPM, bars from 0:08.6, lines back to back — for reels,
  tiktok and shorts: start 0:08.6, hook within 2.5 s, lengths in the window, no cut, TikTok ending
  after line 7; hook-first never more than a bar early; shorter before longer; QA WARN on cuts;
  late lines hidden), 3 hint/hook tests, Python LRC end tags + report words.
- The regression case is a reconstruction (the cloud session cannot read the user's files); a
  fixture from the real aligned LRC and beat analysis can replace it.

### Step 5g.2 — YouTube (16:9) ✅ (verified on the Windows PC: "looks professional")
- `youtube` preset available: 1920x1080, the whole song from 0:00 (not snapped to a bar, so the
  intro is kept), 1 video, horizontal sources, 16 Mbit/s, 1.5 s fade-out. Settings in
  presets/platforms.json ("youtube": defaultLayout, endScreen seconds + clear area, grain, glow,
  coverZoom, titleSeconds).
- Layouts (`--layout`, default cover):
  - cover: square cover centred at 22% of the width (60% of the height) with a 1.00-1.05 zoom over the
    song and a soft shadow, background = the cover blurred/darkened once by FFmpeg (cached; a CSS blur
    per frame was ~3.5x slower), lyrics right of the cover (from 43% of the width), current line large,
    next line small and faded, title + artist small at the top (Cinzel, accent colour), logo.
    Cover from --cover (stored with the project), else the project's cover, else cover.jpg/.png next
    to the song; else stills, else clips, with a message.
  - stills: sections from pauses and hooks (without pauses: at hook lines and where repeated lines
    change to unique ones; unique block after the 2nd chorus = bridge), pictures from stills.txt
    (next to lyrics.txt, in the collection folder, or --stills) or file-name order (unused pictures,
    never the same twice in a row), crossfade 1.5 s centred on the downbeat nearest each section start
    (the new picture fades in over the old one: no dark dip), Ken Burns, grain, beat-pulsed glow.
  - clips: beat-cut montage with horizontal clips/photos.
- Title + "Life Lyrics" over the opening seconds (fading out by 4 s) in stills/clips; no title card.
- Last 20 s: lyrics move to a band above the bottom-right end-screen area (and below the title);
  QA check "End-screen area clear". Frozen-frame QA is skipped for cover/stills (still by design).
- thumbnail.jpg 1280x720 (Thumbnail composition: cover / chorus still / frame at the first hook,
  title in Cinzel + accent colour, artist, logo) and publish.txt from
  workspace\brand\publish-template.txt (created the first time).
- .srt captions for every video on every platform.
- TikTok and Shorts may end on any beat when no bar is clean (bars preferred in each length tier);
  Reels and standard keep bar ends.
- `--title` (saved to the project) for the title overlay, thumbnail, publish.txt and the LRC name.
- Collection import warns about files with identical content.
- Tests: 15 YouTube/beat-end unit tests (sections, stills.txt, crossfades, mid-song start, end-screen
  band for every layout, glow, .srt, layout fallback, beat ends and bar preference), 3 real renders
  (cover layout incl. logo and end-screen position, stills crossfade with grain/glow, thumbnail),
  make tests (cover layout run with title/thumbnail/publish/srt and the stored cover, cover lookup
  order, stills and clips fallbacks, .srt everywhere).
- Cloud check: 100 s cover-layout video rendered and checked frame by frame (cover, lyrics right,
  next line, hook font, end-screen band, logo, thumbnail).

### Step 5g.2b — YouTube polish ✅ (to verify on the Windows PC)
1. Length (3:30 vs 4:01 reported): could not be reproduced. The full-song section ends at the song's
   measured length (librosa, from the audio samples) and the cut plan keeps that end; a 100 s test
   song gives exactly 100.0 s. Added: the song length in the plan ("song length m:ss") and a QA
   check "Video length" (the finished file vs. the expected length, and a whole-song video vs. the
   song) so a short video can never pass silently.
2. Cover layout: active lyric 1.18x, next line 1.1x (in px), cover 0.672 of the height (+12%, centre
   at 23.5% of the width), lyrics from 44% of the width, title block centred over the lyrics column.
3. Motion: zoom 1.00 -> 1.08 (preset coverZoom), a seeded drift of up to 1.8% of the cover's side,
   the background moving 30% of that the opposite way (parallax; drawn 6% larger so no edge shows).
4. Section mood (all YouTube layouts): warm light veil on chorus sections, soft dark veil on verses
   and the bridge, none on intro/outro; 2 s smoothstep blends centred on the downbeat nearest each
   section start (at most ~1 brightness step per frame: never flashing).
5. Logo: brand.json logo.youtube (default bottom-right) and logo.vertical ("auto" = bottom right
   inside the platform's safe zone, or a corner); its height from the PNG's own size. YouTube: fades
   out over 0.5 s so it is gone when the last-20-s end-screen window starts. 9:16 videos now show the
   logo too; QA "Logo clear of the lyrics".
6. publish.txt: --ep "<name>" adds 'From the EP "<name>"' ({{epLine}}; older templates get it after
   the first description line; without --ep the line disappears).
- Tests: cover sizes and clearance, motion and parallax, mood (kinds, eased blend, per-frame limit),
  logo corners inside every platform's safe zone, logo fade, EP line (new and old templates), make
  runs (props, publish.txt, logo on 9:16 and YouTube, QA checks), a real render (drift vs. opposite
  parallax, hook veil brighter and warmer than verse, logo gone at its frame).
- Cloud check: full 100 s cover video, QA PASS (length, logo, end screen), rendered in 146 s.

### Step 5g.3 — Spotify Canvas ✅ (to verify on the Windows PC)
- `pnpm make ... --platforms canvas` (also in `--platforms all`): one silent 1080x1920 loop in
  `exports\<date>\canvas\` with manifest and QA, no .srt, no lyrics, no title, no logo.
- Length: the longest whole number of bars in 3-8 s at the song's BPM (120 BPM = 4 bars, 8.00 s;
  106.63 BPM = 3 bars, 6.75 s); at very slow tempos whole beats.
- Strongest moment: FFmpeg signalstats per vertical clip (10 samples/s): motion 50%, colour 25%,
  contrast 25%; a window with a hard scene change inside is penalised; one window per clip, best
  first (`--variations N` = N different clips).
- Seamless: the last 0.5 s fades in the 0.5 s of the clip just before the loop start, so the last
  frame is the one right before the first. Clips too short: a photo moving out and back (warning);
  nothing usable: a clear error with the length needed.
- QA: "Seamless loop" (last-to-first jump vs. an ordinary frame step), "No audio", "Length 3-8 s".
- Tests: loop length (bars, odd tempos, slow tempos), blend opacity (full on the last frame), photo
  loop, strongest window and scene-change penalty, signalstats parsing, QA checks, make wiring (props,
  folder, warnings, photo fallback, error), a real render (no audio stream; the blended loop's jump
  is within the QA limit, the unblended one is several times larger).

### Step 5j — Lyric effects library (pulled forward) ✅ (verified on the Windows PC: glide + karaoke look right, reels 3 PASS; kept as the defaults)
- `packages/video/src/effects`: one module per effect (glide, cinematic-fade, soft-blur, dreamy-glow,
  word-reveal, karaoke-highlight, floating, typewriter), each with duration, easing and intensity
  (subtle 0.6x / balanced 1x / expressive 1.5x), per line or per word. Only Remotion's own
  interpolate / Easing (no GSAP, no Framer Motion). `scene.ts` decides for every frame which lines are
  shown (leaving, active, waiting next) and how; `LyricScene.tsx` draws exactly that.
- Timing: every line is settled 0.25 s before its stamp; transitions (glide 500 ms) end there and get
  shorter when lines come fast, so a line is never moving at its own stamp. Word effects use the
  aligned word times (LRC word tags), else words spread from the stamp.
- Pauses: a line followed by a pause leaves 1 s after its last word ends (0.4 s fade).
- Choice: brand.json `motion` (glide verses, karaoke-highlight hooks), platforms.json `motion` per
  platform, `--line-effect` / `--hook-effect`; `showNextLine` per platform (default true). The plan
  prints "Effects: verses glide (brand.json), hooks karaoke-highlight (brand.json), next line shown".
  Manifests store the choice (`pnpm rerender` reproduces it); older manifests keep the old fade/pop.
- QA "Lyrics inside the safe zone" measures the space each effect moves the line and the waiting
  next line.
- `pnpm effects:preview <project>`: all 8 side by side (1920x1080, labelled, your choices marked) on
  2-3 real lines around the first hook, with your clips, fonts and song (about 12 s, ~2.5 min in the
  cloud); `--effect <name[:intensity]>`: one effect full-size, 9:16 and 16:9.
- /preview and `pnpm render:test` use the same effects (glide / karaoke-highlight).
- Tests: no frame-to-frame jumps beyond the easing (every effect x intensity, next line on/off),
  active line fully readable at its stamp (relaxed, fast and very fast lines), glide geometry,
  karaoke / word-reveal / typewriter on the word times, word fallback, pauses clear the screen,
  deterministic output, settings order (brand -> platform -> command line), QA box with the waiting
  line, effects:preview, and a real render (smooth movement and brightness, accent colour on the sung
  word, pixel-identical frames).

### Step 5g.3b — Canvas fallbacks, failure summary, logo rule ✅ (to verify on the Windows PC)
- Canvas no longer gives up when clips are short (your case: 3 bars needed 7.3 s, longest clip 5.2 s):
  1) fewer bars (3 -> 2 while the loop is >= 3 s; 2 bars = 4.5 s fits a 5.2 s clip), 2) the clip
  slowed down (down to 0.6x) for the shortest loop, with the seamless blend taken at the same speed,
  3) a vertical photo moving out and back, 4) only then an error saying what would work. The plan
  prints "fallback 1 (fewer bars): ..." / "fallback 2 (slowed down): ..." / "fallback 3 (photo): ...".
- Summary after a failure: "canvas was not made: <reason>" and "run the same command with
  --platforms canvas" (was "0 variation(s) failed: ."); failed videos are named "reels v2".
- Logo: YouTube only by default (brand.json `logo.platforms: ["youtube"]`, add a platform to show it
  there); always in a frame corner, 3% of the width from both edges (the old "auto" put it inside
  the Reels safe zone, on the subject). New QA check "Logo in a frame corner".
- `--collection` is remembered per project (`workspace\projects\<id>\settings.json`, with
  `--collection-path`): later runs may leave it out and print "using collection wedding (remembered)";
  the first run of a project without it stops with a clear message.
- Tests: the remembered collection, each canvas fallback (pure and in pnpm make), a slowed loop rendered and checked seamless,
  the summary, logo placement on every platform and corner, QA catching a mid-frame logo, logo off on
  9:16 by default and on when listed.

### Step 6.1 — Library, New song, desktop app ✅ (verified on the Windows PC: shortcut, start, own window, Library)
- The Library is the start page: a card per song (cover or Cinzel title, artist / EP / length,
  per-platform videos of the latest run with PASS / WARN / FAILED / Rendering / — and the run count,
  last made date), search, Life Lyrics look (near-black, Cinzel headings, accent pink #E8A3B5, bundled
  Inter + Cinzel). Data from studio.db and the export folders (no rendering changes).
- "+ New song": song + lyrics.txt required, cover / hints .lrc / title / artist / EP optional; stored
  with the project (lyrics in projects\<id>\lyrics\lyrics.txt, cover, hints as the stored hint, EP in
  settings.json); the same song again updates it (no duplicates); clear messages for wrong files.
  The song page is a placeholder until 6.2; the Tasks menu is in the header (live in 6.2).
- Artist per project with a dropdown of used artists (and brand folders); `pnpm make --artist`;
  per-artist brand folder workspace\brand\<artist>\ (brand.json, logo, publish template), else the
  default Life Lyrics brand. The EP is remembered with the project and used by publish.txt.
- Desktop app: "Start Lyric Studio.cmd" (background, minimised, builds after an update, waits until
  studio and audio answer, opens Edge in app mode; already running: just opens), "Stop Lyric
  Studio.cmd", "Create Desktop Shortcut.cmd" (icon from the logo). PWA: manifest, icons (192, 512,
  maskable, .ico) made by FFmpeg from workspace\brand\logo.png and cached by its content, service
  worker; Chromium reports no installability errors. The studio listens on 127.0.0.1 only
  (`pnpm dev` too; STUDIO_HOST to change).
- Effect-name checks moved to a Remotion-free module (effects/names.ts) so the studio's server can
  read brand settings; rendering is unchanged.
- Tests: new-song checks, create / update without duplicates, artists list, song card counts and
  status, per-artist brand, app icons (and remade on a new logo), localhost default, --artist / --ep in
  pnpm make. Cloud check: built app, browser run (library, dialog, upload, duplicate, wrong file,
  song page), localhost-only, app:serve start in 12 s and 4 s without a rebuild.

### Step 6.2a — Song page: exports, marks, compare, ready to post; 6.1 fixes ✅ (to verify on the Windows PC)
- 6.1 fixes: jobs record their process (pid) and run folder; queued/rendering jobs whose process is
  gone become "interrupted" (worker at start and every minute; the studio whenever it reads them), so
  a stopped run never shows "…" forever. Old jobs without a pid (your stuck Standard) count as
  interrupted. Badge "interrupted" (orange "!") with the missing videos and the resume command
  (copy; one click in 6.2b). Every WARN / FAILED / interrupted badge shows its reasons on hover and on
  click (from the vN.qa.txt files, per video, with details).
- Song page: every run (also from the command line), newest first, grouped by platform; tiles with a
  poster frame (FFmpeg, cached) that play muted on hover; QA badge with reasons; style / order /
  effects / length; favourite, approve, discard (hidden, never deleted; show / restore); filters
  (platform with counts, favourites only, show discarded); compare 2-3 side by side (one play/pause and
  timeline, drift-corrected, differences highlighted); "ready to post" (caption + hashtags from the
  artist's template per platform, YouTube title / description / tags from publish.txt, downloads with
  clear names, open folder in Explorer, "make <artist>'s own template").
- New tables: video_mark; render_job: status "interrupted" and pid (migration 0003, data kept).
- App icon fix (small and fuzzy before): the logo's transparent padding is cropped so it fills ~90% of
  the icon; every size is rendered straight from the full logo; the shortcut gets a real multi-size
  .ico (16-256 px) and the Edge window / PWA the same icons (/icons/favicon.ico). brand.json
  "appIcon": { "style": "logo" | "tile" } (tile = rounded square in the accent colour). "Create
  Desktop Shortcut.cmd" again updates the icon (and refreshes Windows' icon cache).
- Menu: only "Library" (the Studio placeholder is gone; /studio leads to the Library).
- Caption templates per artist: brand\<artist>\publish-<platform>.txt else brand\publish-<platform>.txt;
  the YouTube publish template follows the same rule.
- Tests: QA parsing, interrupted detection (alive / dead / unknown process), resume command, run
  scanning (files, settings, marks, missing videos, run links), platform state and reasons, marks
  (incl. guards), caption templates (default, artist's own, French example, placeholders, notes),
  posting pack (caption / YouTube / Canvas), posters, the studio's file guard, jobs record pid and run.
  Cloud check: browser run on a workspace with 14 runs (badges, reasons on hover and click,
  interrupted resume, marks, discard / restore, compare playing in sync, post window, download).

### Step 6.2b — Generate, worker queue, live Tasks menu, Stop / Resume ✅ (to verify on the Windows PC)
- Generate panel on the song page: platforms (videos each), clips collection (last used first),
  verse / hook effect + intensity (the artist's brand defaults), title / artist / EP / new cover;
  advanced: videos per platform, section, YouTube layout, allow fill, re-align. Checked before it is
  queued (clear messages); a song without its lyrics.txt in the app says how to add it.
- Worker: takes the oldest queued run when none is running and makes it with makeVideos (same code as
  pnpm make; jobs linked to the run), writes progress at most once a second, records the result
  ("3 videos: 2 PASS, 1 WARN", or why it failed), never leaves jobs "rendering" after a crash. Runs
  whose worker is gone become "interrupted".
- Tasks menu (header, with a count): studio runs (waiting, making with "Reels v2: 45% (2 of 3)", done /
  failed / stopped / interrupted for 24 h) and terminal runs rendering right now; Stop after this video
  (a waiting run is cancelled); the page refreshes itself when a run finishes.
- Resume (one click on an interrupted badge, also on the Library cards): queues only the missing
  videos into the same folder: studio runs with their stored options, terminal runs from the command
  in their manifests (moved song / lyrics replaced by the project's copies). A resumed run's badge goes
  back to PASS / WARN (an interrupted job counts only until a later job makes the same video).
- `pnpm make` options parsing shared (make-args.ts) between the command and Resume; new makeVideos
  options shouldStop / resumeFolder / runId; database busy timeout (studio, worker and terminal share
  the file); the aligner's last messages now go into its error (the Tasks menu says e.g. "AI packages
  not installed: pnpm audio:setup --ai" instead of "see the messages above"); hints added in
  "+ New song" are named by their file, not the temporary upload path.
- New table make_run (migration 0004).
- Tests: argument parsing (also stored commands with quotes), Generate request checks and options,
  queue (one at a time, oldest first, dead worker -> interrupted), Stop (queued / running), worker
  execution (progress, result, stop, failure), resume options (terminal and studio runs), Tasks list
  (studio + terminal), Stop in makeVideos (rest interrupted) and Resume into an older folder,
  superseded interrupted jobs, aligner messages. Cloud check: Generate in the browser -> worker ->
  live Tasks -> Stop after v1 -> Resume -> v2 made in the same folder, badge PASS; a terminal run shown
  in Tasks while rendering.

## What works
- `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm --filter @lyric/studio build`.
- `pnpm db:show` / `db:setup` / `db:migrate` / `db:seed`.
- `pnpm analyze <file>` (also `--click`, `--downbeat-offset`), `POST /analyze`, `pnpm test:audio`.
- `pnpm cuts <file> --section a-b`.
- `pnpm tap`, `pnpm render:test`, http://localhost:3000/preview.
- `pnpm make --platforms reels,tiktok,shorts,youtube` (or `all`), `--allow-fill`, photos in collections,
  YouTube cover / stills / clips layouts, thumbnails, publish.txt, .srt captions, Spotify Canvas loops, lyric effects (`--line-effect`, `--hook-effect`, `pnpm effects:preview`).
- `pnpm make` (verified on the Windows PC: 6 videos, all QA PASS, 444 s with --parallel 1; after 5d.1
  with the defaults: all 6 PASS, no memory errors, one at a time with a 2 GB clip cache, 469 s), `pnpm rerender`.
- `pnpm lrc:shift`, `pnpm lrc:hook`, `pnpm fonts`.
- `pnpm audio:setup --ai`, `pnpm align` (GPU path to be verified on the Windows PC).
- http://localhost:3000 (Home / Studio / Library) and http://127.0.0.1:8001/health.

## Backlog (not scheduled yet)
- **Effects page**: a gallery of all lyric effects (later also ambient effects and loop scenes) with
  animated previews rendered on a line of the selected song (cached), an intensity selector, "set as
  default for <artist>" for verses and hooks (writes brand.json), effect descriptions and which
  platforms use each effect.

## Known issues
- TikTok (target 25 s) ended at 31.6 s like Reels on the user's song (most likely no bar inside a gap
  between lines). Since 5g.2 TikTok and Shorts may end on any beat, which should fix it.
- Full-song YouTube videos render slowly in the cloud check (cover layout ~1.5 s per second of video on
  4 threads); expect a few minutes for a 4-minute song on the PC.
- `pnpm make`: cinematic bars on every other variation together with Simple/Bold alternating means
  bars always come with Bold (v2, v4, v6). Easy to change if you want other pairs.
- `pnpm rerender` renders the stored props with the current composition; after a Lyric Studio update
  that changes the composition, the video can differ (a note with both git versions is printed).
- QA "frozen frames" also flags a clip that is truly still (e.g. a static shot) for 1 s or more.
- `pnpm cuts` does not read lyrics yet (`--rate off` / hold are available in render:test via the LRC).
- Only the Simple and Bold styles are implemented (any font can be used with them via --font).
- Hook lines change font only (same size, colour and animation).
- `pnpm tap` real playback and keys can only be tested on the PC (logic is tested with a simulated
  keyboard and clock); the cloud machine has no sound card.
- The preview shows Remotion's license note in the browser console (free for individuals).
- After `git pull`, run `pnpm db:setup` (or `pnpm dev`) before `pnpm analyze` so the new
  `downbeat_offset` column exists; otherwise `pnpm analyze` notes it and ignores project settings.
- Real sung vocals: verified on one song (the user's). Lines can still latch onto the wrong part of
  the vocal track when confidence is low; `--hint` with taps fixes that, and confidence < 0.7 is the
  signal to check.
- "Port 3000" render problem: reported by the user, but no details of it reached this session and it
  did not reproduce here (rendering works while `pnpm dev` holds port 3000). As a safeguard,
  Remotion's internal server now uses a free port chosen by the system instead of searching from
  3000. If it happens again, note the exact error message.
- The cloud session cannot download the AI models (network policy), so `pnpm align` is tested in the
  "AI alignment" GitHub workflow instead.
- Downbeats assume 4/4. When the kick is equally strong on beats 1 and 3 (and nothing else
  marks the bar), beat 1 vs 3 is a guess; the confidence value shows this.
- Beats are placed on the attack of each hit, typically within ~10 ms.
- Validated on a real song (acoustic, low energy) on the user's PC: 106.63 BPM vs 107 from an
  independent tool, duration 4:01 correct, downbeat confidence 0.14 (low, as expected for a track
  without a clear kick on beat 1). Low-confidence songs may need manual bar alignment later.
- shadcn/ui components (button, card, input, tabs) were added by hand in the same format the
  shadcn CLI produces, because the build environment could not reach the shadcn website.
  `pnpm dlx shadcn@latest add <name>` works normally on your PC for future components.
- FFmpeg (and ffprobe) must be on the PATH for adding clips and for the db tests.
- The workspace service is used by tests only so far; commands and UI that use it come in later steps.

## Next
1. Verify Steps 6.2a and 6.2b on the PC.
2. Step 6.3 (content board with manually entered results).
3. Step 5g.4 (loop layout).
4. Step 5e (timing editor on /preview); corrections go into an automatically created "test" project
   (confirmed by the user) and plug into the same render-time layer as the lyrics offset.
