# Lyric Studio — project brief for Claude Code

## What we are building
A personal, single-user, LOCAL lyric-video studio for the artist "Life Lyrics".
Input: one song (WAV/MP3) + lyrics + a pool of video clips.
Output: several beat-synced lyric videos as MP4, ready for Instagram Reels, TikTok, YouTube Shorts (9:16, 1080x1920), YouTube (16:9) and Spotify Canvas. Size, length, variations, safe zones, text scale and bitrate come per platform from `presets/platforms.json` (editable); without --platforms the "standard" preset applies.

Screens (Step 6, in the Life Lyrics look: dark, Cinzel headings, accent pink):
- **Library** (start page): song cards (cover, title, artist/EP, per-platform video counts and status) with search; "+ New song" (WAV/MP3 + lyrics.txt required; cover, hints .lrc, title, artist with a dropdown of used artists, EP optional) creates or updates the project (found by the song's content).
- **Song page** (6.2a): every run of the song (also command-line runs), newest first, grouped by platform; tiles with a still frame that plays muted on hover, QA badge with reasons (hover/click), favourite / approved / discarded (hidden, never deleted), compare 2-3 videos side by side (one play/pause and timeline, differences highlighted), "ready to post" (caption + hashtags from the artist's template, downloads, open folder). Generate panel and live Tasks menu in 6.2b.
- Every visible menu item must lead somewhere real (the Studio editor is not in the menu until it has content).
- **Content board**: Generated -> Approved -> Scheduled -> Published, with manually entered results (Step 6.3).
- **Studio**: left panel (project, sections, lyrics, text styles, cinematic bars), centre phone-shaped live preview with "Render video", right panel (media collections, add clips, filter all / in use / unused), bottom bar (play, undo, shuffle, Beat Synced with cut rate 0.5x / 1x / 2x / Off, timeline with clip thumbnails and beat ruler), variations strip under the preview.
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
- FFmpeg for thumbnails and clip normalisation (30 fps, the platform's size, cover-crop; photos as JPEG)
- One `pnpm dev` command starts studio + worker + audio service; "Start Lyric Studio.cmd" / "Stop Lyric Studio.cmd" do the same in the background (production build, rebuilt after an update) and open the app; the studio listens on 127.0.0.1 only (STUDIO_HOST to change); installable PWA (manifest, icons made from workspace\brand\logo.png, service worker), no internet needed

## Data model
- Project: id, title, artist, cover_path, audio_path, bpm, duration_ms, downbeat_offset (0-3: bar 1 starts N beats later than detected), created_at
- LyricLine: id, project_id, index, text, start_ms, end_ms, is_hook, words_json (optional word timings)
- Beat: project_id, time_ms, strength, is_downbeat (as detected; Project.downbeat_offset is applied when read)
- Section: id, project_id, name, start_ms, end_ms, energy (low | medium | high: low halves the cut rate, high doubles it)
- Collection: id, name
- Clip: id, collection_id, path, duration_ms, width, height, thumb_path, source (upload | stock | ai)
- StylePreset: id, name, font, weight, text_case, effect, animation, default_size
- Variation: id, project_id, section_id, seed, cut_rate, style_id, text_size, colour, cinematic_bars, overrides_json
- RenderJob: id, variation_id, status (queued | rendering | done | failed | interrupted), progress, output_path, error, started_at, finished_at, pid (the owning process; queued/rendering jobs whose process is gone become "interrupted", checked by the worker at start and every minute and by the studio)
- VideoMark: id, project_id, video (workspace-relative manifest path, unique), favourite, status (generated | approved | discarded), updated_at

Workspace folder layout: `workspace/projects/<id>/audio`, `workspace/projects/<id>/exports`, `workspace/clips/<collection>/`, `workspace/thumbs/`, `workspace/studio.db`.

## Core logic rules
- Cut points come from beats inside the selected section. Cut rate 1x = cut every downbeat (every bar), 2x = every half bar, 0.5x = every 2 bars, Off = one clip per lyric line.
- Every cut lands earlyCutFrames (default 2, range 0-4, at 30 fps) before its beat. Section energy low halves the cut rate, high doubles it. Optional holdOnLyricLines: never cut inside a lyric line; cut at the next line start, snapped to the nearest beat.
- Minimum shot length 0.8 s. If the grid is too fast, step to the next coarser REGULAR grid (every beat -> every 2 beats -> every bar ...) instead of dropping single cuts.
- A clip shorter than its shot is slowed down to fit (playbackRate, minimum 0.5x); only if 0.5x is still too short, its last frame is held.
- Clip order: "story" (default) = clips in file-name order (01_, 02_, ...; numbers compared as numbers), cycling, a clip shown again continues where it stopped; "shuffle" = seeded random.
- Shuffle is DETERMINISTIC: same seed + same inputs = same clip sequence. Use a seeded PRNG (e.g. mulberry32). Avoid the same clip twice in a row, and avoid the last 3 clips when the pool allows.
- Pins (pins.txt: "lyric line = clip file") force a clip onto the shot where that line appears on screen, at every occurrence; pins override the order mode. Lyric lines are matched ignoring case, punctuation and extra spaces. Warn when a line or clip is not found.
- Clips are cover-cropped to 9:16 and start at a random (seeded) offset inside the clip.
- Preview and render must use the exact same composition and props.
- Lyrics stay out of each platform's UI: never inside its safe zones (presets/platforms.json, fractions of the frame per side). The vertical position is computed from those safe zones: centred in the usable area, slightly above its middle (lyricsAt, default 0.45) — never a fixed percentage.
- Sources by orientation: 9:16 uses vertical (and square) sources, horizontal ones only if at least 2x the output height; 16:9 uses horizontal sources. Too few: QA WARN with the count needed; blurred fill only with --allow-fill. Photos (jpg/png/webp) are valid sources with a slow seeded Ken Burns move (zoom 1.0-1.12, gentle pan) fitted to the shot.
- Brand: WORKSPACE_DIR\brand\brand.json (title font Cinzel, verse font Cormorant Garamond, hook font Kaushan Script, accent colour, logo corners and size) + logo.png. Logo: only on the platforms in brand.json logo.platforms (default ["youtube"]: no logo on reels, tiktok, shorts, canvas or other vertical presets); YouTube bottom-right by default (logo.youtube), fading out (0.5 s) before the last-20-s end-screen window; 9:16 when enabled: logo.vertical ("auto" = bottom right). Always anchored to a frame corner with a fixed margin (3% of the width), never mid-frame (QA "Logo in a frame corner"), never over the lyrics (QA). Lyrics use the brand fonts; --font/--font-hook override. Thumbnails and title cards use the brand title font.
- Lyric lines appear 0.25 s before their stamp (lead, configurable), plus an optional lyrics offset; no early cut.
- Lyric effects (packages/video/src/effects, Remotion interpolate/spring/Easing only, no GSAP or Framer Motion): each effect is a registered module (duration, easing, intensity subtle | balanced | expressive), per line or per word (aligned word timings, else words spread from the line's stamp). Effects: glide (default verses: Apple Music-style scroll, old line up ~40 px and out, next line rises from small/faded to full in ~500 ms ease-in-out), cinematic-fade, soft-blur (max 4 px), dreamy-glow, word-reveal, karaoke-highlight (default hooks: the sung word in the brand accent colour), floating, typewriter. Every line is settled (fully readable) at its appearance time, 0.25 s before its stamp; transitions shorten when lines come fast. Chosen in brand.json (motion.verseEffect / motion.hookEffect), overridden per platform (platforms.json motion), then per run (--line-effect / --hook-effect, "name[:intensity]"). showNextLine per platform (default true): the next line waits small underneath. Before an instrumental pause the last line fades out 1 s after its last word ends (0.4 s fade) instead of staying on screen. QA's safe-zone box includes each effect's movement and the waiting next line. Manifests without lyricEffects render with the old fade/pop. "pnpm effects:preview <project>" renders all effects side by side (labelled 1920x1080 grid) on 2-3 real lines around the first hook; --effect <name> renders one effect full-size in 9:16 and 16:9.
- Long lyric lines: one line if it fits, else two balanced lines, then shrink up to 25%. Only as an absolute last resort three lines (never more), with a warning naming the line ("Line 3 is too long for phone screens; split it in lyrics.txt") from pnpm tap and render:test.
- Hook lines: "* " at the start of a line in lyrics.txt or after the time stamp in the .lrc; every line with the same words is a hook too. Hook lines can use their own font.
- Fonts: bundled @fontsource families plus any .ttf/.otf/.woff/.woff2 in WORKSPACE_DIR\fonts; props list the exact font files, so preview and render load the same ones.
- Automatic lyric timing: `pnpm align` (Demucs htdemucs vocals + WhisperX wav2vec2 forced alignment, en/fr) writes enhanced LRC (line stamps + <mm:ss.xx> word tags), keeps hooks and pauses, flags lines below 0.5 confidence. AI packages are an optional extra (`pnpm audio:setup --ai`; PyTorch 2.8 cu128 on Windows); models live in services/audio/models.
- Audio: the section start snaps to the nearest downbeat (report the adjusted time); 0.3 s fade-in, fade-out per platform preset (default 0.5 s; Reels 0.1-0.15 s, ending exactly on a bar, with the last shot continuing into the first clip for a seamless loop).
- Clean cuts: a line's singing ends at its last word's end time (word timings from the aligned LRC: `pnpm align` writes a trailing end tag per line). A cut is clean at any bar boundary after the last word ends and before the next line's first word. Only without word timings: line-start logic (a line lasts until the next starts).
- Section ends: on a bar; TikTok and Shorts may end on any beat when no bar is clean (bars preferred); Reels keeps bar ends for the seamless loop.
- YouTube (16:9, full song from 0:00 so the intro is kept): layouts "cover" (default: --cover, else the project's cover, else cover.jpg/cover.png next to the song; else stills, else clips, with a message), "stills" (one horizontal picture per lyric section from pauses and hooks, stills.txt or name order, 1.5 s crossfade on the downbeat nearest each section start, slow Ken Burns, subtle grain and a beat-pulsed glow, switchable) and "clips" (beat-cut montage of horizontal sources). Title + artist in the brand title font (Cinzel, wide spacing, accent colour): small at the top in the cover layout (centred over the lyrics column), over the opening seconds (gone by ~4 s) otherwise; no separate title card. Logo from WORKSPACE_DIR\brand. Cover layout: cover 0.672 of the height, active lyric 1.18x and next line 1.1x the 5g.2 sizes, zoom 1.00-1.08 with a gentle seeded drift and the background moving 30% the opposite way (parallax). Section mood on YouTube: a warm, light veil on hook (chorus) sections and a soft dark veil on verses, 2 s eased changes centred on the downbeat nearest each section start, never flashing. A full-song video must be as long as the song (QA "Video length"). The last 20 s keep the bottom-right end-screen area clear (lyrics move to a band above it). Each YouTube video gets a 1280x720 thumbnail (brand title font, logo) and publish.txt (title "<Song> (Lyrics) - Life Lyrics", description with an optional "From the EP <name>" line (--ep), the full lyrics, credits, Spotify placeholder, hashtags, tags) from WORKSPACE_DIR\brand\publish-template.txt.
- Captions for posting per artist and platform: brand\<artist>\publish-<platform>.txt (e.g. Pômé in French) else brand\publish-<platform>.txt (English defaults created the first time; placeholders {{song}} {{artist}} {{ep}} {{epLine}} {{hook}} {{songTag}} {{artistTag}} {{year}}); YouTube uses the publish.txt next to the video (its template: brand\<artist>\publish-template.txt else brand\publish-template.txt). Canvas has no caption.
- Artist per project (default "Life Lyrics"; --artist or the New song form): titles, thumbnails, overlays and publish texts use it; its brand is workspace\brand\<artist>\brand.json when present, else workspace\brand\ (Life Lyrics). The EP is stored with the project too (--ep or the form) and reused.
- The clip collection (and --collection-path) is remembered per project (workspace/projects/<id>/settings.json): --collection is needed the first time, later runs may leave it out ("using collection wedding (remembered)").
- Every video on every platform gets a .srt (except the Spotify Canvas: no lyrics) with its lyric lines (times from the video's first frame).
- Spotify Canvas (--platforms canvas): 9:16, a seamless loop of the longest whole number of bars in 3-8 s (whole beats only at very slow tempos), the strongest visual moment (FFmpeg motion/colour/contrast score, no hard scene change inside); clips too short: 1) fewer bars (loop still >= 3 s), 2) slowed down (>= 0.6x) for that loop, 3) a vertical photo with slow motion, only then an error naming what would work; the fallback used is printed; NO lyrics, NO text, NO logo, NO audio; the last 0.5 s blends into the clip frames just before the start (photos: a Ken Burns move out and back). QA: Seamless loop, No audio, Length 3-8 s.
- Platform sections: short-form (reels, tiktok, shorts) is hook-first: start at most 1 bar before the first hook line (hook heard within ~2.5 s), then extend forward to the target length. Length: within +-15% of the target; if impossible, the nearest clean line end up to 25% shorter is preferred over a longer one (up to 30%); report which. A section that cuts a sung line is a QA WARN naming the line, never PASS. Every song also gets a clean synced .lrc (for Musixmatch / LyricFind) next to the videos.
- Hints (tapped times) are remembered per project: the first --hint is stored with the project and reused on every later alignment ("using stored hints from …"); aligning without them (--no-hint, or a lost copy) warns clearly. A lyrics.txt change in hook markers ("* ") only does not re-align: the stored alignment is reused and the hook flags follow the current lyrics.txt.
- Video: 30 fps, H.264, AAC 192 kbps, yuv420p, faststart; size and bitrate per platform preset.

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
- My project lives at `D:\videomaker`. Always start Windows commands with `cd D:\videomaker`.
- My clip collection is "wedding": always use `--collection wedding` in my Windows commands (never "beach").
- Follow the steps strictly in the order I give. Never merge steps and never pull UI work forward.
- Phase 1 (Steps 2–5) has no UI. It ends when a beat-synced MP4 renders from the command line.
- After finishing a step, stop and wait for my next message. Do not start the next step on your own.
