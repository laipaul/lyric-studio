# Lyric Studio — project brief for Claude Code

## What we are building
A personal, single-user, LOCAL lyric-video studio for the artist "Life Lyrics".
Input: one song (WAV/MP3) + lyrics + a pool of video clips.
Output: several beat-synced lyric videos as MP4, ready for Instagram Reels, TikTok, YouTube Shorts (9:16, 1080x1920), YouTube (16:9) and Spotify Canvas. Size, length, variations, safe zones, text scale and bitrate come per platform from `presets/platforms.json` (editable); without --platforms the "standard" preset applies.

Screens: **Library** (start page), **Song page** (tabs Assets, Lyrics, Style, Storyboard, Generate, Videos, Post), **Collections**, header **Tasks** menu; planned: Content board / Releases, Studio editor. Details: `docs/screens.md`.
- Every visible menu item must lead somewhere real (the Studio editor is not in the menu until it has content).
- Principle (9 Nov 2026): "Shape = work on this video. Theme = manage reusable looks." A video's theme is changed directly in Shape (Look bar → Change); editing and creating themes belong in the Theme area. A theme is a reusable set of rules, not a replacement storyboard: applying one never touches lyric timing or the user's locked edits.

## Guiding principle — who does what (decided by the user, 29 Oct 2026)
- **The user does the creative part**: provides the clips, puts them in order, shortens a clip when needed
  (and makes artistic choices: fonts, effects, anchors, which take to post).
- **The app does all the technical work automatically**: beat-synced cuts, pacing / shot lengths, section
  and ending choice, loops, fades, lyric timing, readability, blending the clips together — with
  professional defaults, never asking the user to tune a technical setting to get a good result. Settings
  stay available as overrides, never as requirements.
- **Every result gets a professional assessment** in plain words (e.g. "Ready to post" / "Good — two things
  to improve: …"), with the technical details one click away. A WARN the user cannot act on creatively is a
  job for the app, not for the user.
- When the app truly cannot make it work with the clips given, it says what creative input would fix it
  (e.g. "a clip of at least 9 s for the Canvas"), never which technical knob to turn.
- Every new feature and fix is checked against this: if it hands the user a technical decision, rethink it.

## Out of scope — never build these
Payments, credits, user accounts, login, multi-user, cloud hosting, cloud rendering, social posting, analytics.

## Hard rules (details in docs/)
- Rule: Lyric Studio NEVER alters the music. The song file (song.wav|mp3) is only ever read (hashing, ffprobe, librosa analysis, Demucs input, the aligner, pnpm tap, Remotion's media server, the Lyrics tab's ▶, the QA comparison); nothing writes into it. It is only ever copied into the song folder, moved (migration), or moved to .studio\replaced\ when the user replaces it. Suno's vocal stems (the vocal stem and backing vocals in the song folder, under any names; formerly vocals.wav, backing-vocals.wav) are only ever read, never edited, never mixed back. They, the Demucs stems and the voice map are analysis only (workspace\cache, .studio\lyrics) and never go into any output. A video's audio is the song itself, cut to the section: a fade only where the music is cut (fadeInSeconds default 0.3 s, fadeOutSeconds per platform: standard / TikTok / Shorts 0.5 s, Reels 0.12 s for a tight loop; on Reels / TikTok / Shorts the automatic ending sets it (see Endings); never at the song's own start or end, so whole-song YouTube videos have no fades), AAC 320 kbps at the master's own sample rate (no resampling; platforms.json audioSampleRate 44100 / 48000 to force one), channels as Remotion outputs them (stereo; a mono master is the same sound on both). No volume change, loudness normalisation, EQ, compression or limiting (Remotion mixes with amix normalize=0 and only the fade curve); none is ever added unless the user sets it. QA "Audio matches the song" decodes the video's audio and the same section of the song file and WARNs when the length differs by more than 0.1 s, the level (outside the fades) by more than 0.5 dB, or the loudness curve (0.5 s blocks) by more than 1 dB on average. The manifest records settings.audio (fades, sample rate, resampled, bitrate, processing "none").
- Nothing the user made is ever deleted: removed things move to `_removed\` (clips, collections) or `.studio\replaced\` (replaced files), always with a Restore.
- Principle: a musical ending beats an exact length. Never trade a clean line / phrase ending for hitting a target duration; the tolerance exists for that. Every length or trimming feature (auto sections, target lengths, loops, EP films, future trims) must follow this.
- Preview and render must use the exact same composition and props.
- Rendering makes ZERO network calls: fonts only from our own font files (never Google Fonts, not even as a fallback), scripts and media copied locally, telemetry off (test: packages/video/test/hf-network.test.ts). Theme Engine v2 renders with HyperFrames, everything in one pass: docs/theme-engine-v2-hyperframes-plan.md.
- Shuffle is DETERMINISTIC: same seed + same inputs = same clip sequence. Use a seeded PRNG (e.g. mulberry32). Avoid the same clip twice in a row, and avoid the last 3 clips when the pool allows.

## Tech stack (do not change without asking)
- Monorepo with pnpm workspaces
- `apps/studio`: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, dark theme
- `packages/video`: Remotion composition `LyricVideo` used by BOTH `@remotion/player` (preview) and `renderMedia` (export)
- `services/audio`: Python FastAPI on port 8001 — librosa for BPM/beats/downbeats; later WhisperX + Demucs for lyric alignment
- `apps/worker`: Node render worker that processes RenderJob rows
- SQLite via Drizzle ORM, file `workspace/studio.db`
- FFmpeg for thumbnails and clip normalisation (30 fps, the platform's size, cover-crop; photos as JPEG)
- One `pnpm dev` command starts studio + worker + audio service; "Start Lyric Studio.cmd" / "Stop Lyric Studio.cmd" run the app in the background. Details: `docs/launcher.md`.

## Where the details live — read the file for the area you work on, and update it with the change
- `docs/screens.md` — Screens: Every screen of the studio: Library, Song page tabs, Storyboard, Textboard, Collections, Content board, Studio.
- `docs/data-model.md` — Data model and workspace folders: Database tables and the workspace folder layout.
- `docs/launcher.md` — Starting and stopping the app: pnpm dev, Start / Stop Lyric Studio.cmd, rebuilds, PWA and app icons.
- `docs/audio-and-output.md` — Audio and video output: The music is never altered; fades, audio and video format, captions (.srt).
- `docs/pacing-and-cuts.md` — Pacing, transitions, cuts and clip order: Automatic pacing and transitions, shot length, tempo, cut grid, clip order, shuffle, pins, sources.
- `docs/endings-and-loops.md` — Sections, endings and loops: Musical endings, target length, platform sections, clean cuts, endings, loops, loop picture.
- `docs/assessment.md` — Pro assessment and reactions: The verdict per video and the React buttons.
- `docs/lyrics.md` — Lyrics: timing, display and effects: Alignment, vocal-start check, hand-set starts, hints, safe zones, lead, effects, long lines, hooks.
- `docs/brand-fonts-publishing.md` — Brand, fonts and publishing texts: brand.json and logo, fonts, font pairings, artist per project, captions for posting.
- `docs/youtube-canvas.md` — YouTube and Spotify Canvas: The full-song YouTube video and the Canvas loop.
- `docs/recipe-and-songs.md` — Recipe, clips of a run, anchors, instrumentals, migration: song.json inheritance and locks, collections of a run, story anchors, instrumental songs, pnpm make, migration.
- `docs/history.md` — every step built so far, in full (PROGRESS.md keeps only the latest).

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
- My clip collection is "wedding" (never "beach"). Add `--collection wedding` to my Windows commands ONLY when the song has no clips of its own, or when I ask for it: a terminal run with `--collection` adds the shared clips to the song's own clips AND saves the collection into the song's song.json, so every later run mixes them in too.
- Follow the steps strictly in the order I give. Never merge steps and never pull UI work forward.
- Phase 1 (Steps 2–5) has no UI. It ends when a beat-synced MP4 renders from the command line.
- After finishing a step, stop and wait for my next message. Do not start the next step on your own.
- Bug fixes run on Sonnet: the user switches the session with /model for bug-fix sessions; in other sessions hand each bug fix to a Sonnet subagent, then check its result and run the tests before pushing.
- PROGRESS.md holds the agreed order ("Next"), open issues, backlog and the latest steps; when a step is done, add it there and move the oldest of the latest steps to docs/history.md.
