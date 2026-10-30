# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Tidy-up — a short brief, details in docs/ ✅ (30 Oct 2026; no app changes)
- CLAUDE.md is now ~9 KB (was 55 KB): what we build, the guiding principle, the hard rules, the stack, how to work
  with the user, and an index of docs/. Every rule moved word for word into docs/<area>.md (screens, data model,
  launcher, audio and output, pacing and cuts, endings and loops, assessment, lyrics, brand and fonts, YouTube and
  Canvas, recipe and songs); a check confirmed no line of the old brief or of PROGRESS.md was lost.
- PROGRESS.md keeps the agreed order, open issues, backlog and these latest steps; the full step history, the
  verification checklist and the 29 Oct plan are in docs/history.md.

### Fix — verification pass 30 Oct (A Heart For Two) ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Tasks:** a stopped or interrupted run that can still resume has a **Resume** button in its entry (POST
  /api/runs/resume into its own folder, with every platform of the run, also those that never started); once a
  Resume of that folder is waiting, going or done, the old entry no longer offers it (Tasks runs[].resumable).
  The result line uses the verdicts ("3 videos: 2 ready to post · 1 to improve", from the same assessment as
  the Videos tab) instead of PASS / WARN. "Stop after this video" is a real button ("Stopping after this
  video…" once asked). The panel closes on a click outside it and on Escape.
- **Stop between videos (checked):** a stop asked while video N renders never starts video N+1 or a later
  platform (shouldStop before every video and platform); test with 2 platforms × 3 videos, then Resume makes
  the rest.
- **Lyrics tab:** flag reasons in plain words ("The singing may start about 2 s later than shown. Listen with
  ▶."; the technical reason on hover; vocal-guard.ts flagReason). A flagged line with a likely start (two
  signals within 1 s; the earlier one) gets **Use 1:04.0** next to ▶: saved at once as a hand-set start
  (likelyStart). Sticky column headers (the lines scroll in their own box); the "Lands on" button reads "Choose a clip" (the old "Lands on…" looked cut off).
- **Generate:** the "Standard" preset is no longer offered (pnpm make without --platforms unchanged).
- Tests: runs (resume with a platform that never started, resumable), make (stop during v1 of 3), vocal-guard
  (likelyStart, flagReason), lyrics-view, runSummary verdicts; e2e lyrics-tab (plain reason, tooltip, sticky
  header, label not cut) and videos-post pass. Not browser-tested: the Tasks menu (Resume, outside click).

### Step G — Collections: rename, delete, clearer cards ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- Each collection card has a **⋯ menu**: **Rename**, **Open folder**, **Delete…** (fixes "a collection's
  name cannot be changed or deleted").
- **Rename**: the folder gets the new name; every song using it follows (song.json "collections", also a
  locked one, and the remembered collection of older songs), the database paths follow and the move is
  recorded in moved-paths.json, so old videos still re-render. A change of case only works too. Not while
  a song using it is rendering.
- **Delete**: asks first and names the songs that use it; the folder moves to
  collections\_removed\<name> (removed <date>) — nothing is deleted — and those songs stop naming it
  (their own clips and other collections stay). **Removed collections** at the bottom of the page with
  **Restore** (as "<name> (2)" if the name was taken since; tick it again in a song's Generate tab).
- **Cards**: an empty collection shows "Add clips" instead of a black box; "9:16 · N" and "16:9 · N" chips
  (amber when a format cannot use every clip); "Used by N songs" (names on hover); "Same clips as X" when two
  collections hold exactly the same clips (the copy no song uses is the one flagged).
- **New collection** is a button with a small dialog instead of an always-visible name box.
- Tests: collections.test.ts (rename incl. database paths, moves and songs; delete; restore; same clips);
  browser: collections.e2e.ts (⋯ menu, rename, delete with the song named, restore, empty card).

### Step F — Collections page ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- Header **Collections** next to Library: a card per collection (thumbnails, clip count, video length,
  what 9:16 and 16:9 can use, which songs use it) and **New collection**.
- A collection's page: thumbnail grid (hover plays the clip), drag-and-drop or **Add clips** (copied in,
  the same content never twice), **Remove** -> _removed\ (never deleted) with **Restore**, **Open folder**.
- Tests: collections.test.ts; browser: collections.e2e.ts (now part of pnpm test:e2e).

### Step E — Instrumental songs with a story ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **+ New song → Instrumental**: no lyrics needed; an optional **story.txt** instead (one sentence per line,
  a blank line = a pause). song.json gets "instrumental": true; Assets shows "Story (instrumental)" with
  Replace; the Lyrics tab edits story.txt and can nudge a sentence.
- **The app times the story**: each sentence appears on a bar, stays long enough to read, and the
  sentences are spread through the piece with pure music in between (as in the "Tea with the monk" Reel).
  Nothing is aligned (no AI packages needed).
- **Reels / TikTok / Shorts**: the section starts at the strongest stretch of the music (no chorus to start
  on); calm pacing with dissolves; every story sentence starts with a new clip; the title opening works.
- No .lrc for lyric services; captions (.srt) carry the story; without a story: music only, no captions.
- Tests: story.test.ts (parsing, timing, too long, strongest stretch, section, forced cuts),
  instrumental-make.test.ts (New song + a Reel with and without a story); browser: the New song form.

### Step D — Title opening ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Title opening** (Style tab → Title opening: on; per platform; Reels, TikTok, Shorts): the video starts up
  to 2 bars before the first hook (1 bar when 2 bars would be over 5 s) and opens with the title + artist on
  the frame's upper third line and the tagline on the lower third line (inside the safe area). The app times
  them: they fade out as the first lyric line fades in, never overlapping it. Off (default) = as before.
- **Tagline**: its own song field (Assets tab, song.json "tagline"), empty by default, never the EP.
- **Fonts**: the card editor has a font picker and "Use as the brand's title font" (asks first, writes
  brand.json titleFont; e.g. Special Elite for Life Lyrics). Characters the title font lacks (Japanese)
  are drawn in Noto Sans JP / Serif JP automatically, the same in preview and render.
- **Cover**: every Reels / TikTok / Shorts video gets cover.jpg (vN.cover.jpg with several) with the title,
  artist and tagline on the hook's frame, inside the 3:4 profile-grid crop; download in Ready to post.
- **QA + assessment**: title cards inside the safe zone, inside the 3:4 grid, clear of the first lyric, every
  character drawn; each mapped to a plain point with a creative action (shorter tagline, smaller size,
  another font).
- Tests: title-opening.test.ts (lead bars, geometry, QA, recipe, assessment), title-opening-make.test.ts
  (a Reel with the opening + cover, off by default); browser tests: Style select, Assets tagline, card
  editor font -> brand.json.

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
- `pnpm make "workspace\songs\<artist>\<title>"` (a song folder), `pnpm songs:migrate` (dry run / `--apply` / `--undo`).
- `pnpm audio:setup --ai`, `pnpm align` (GPU path to be verified on the Windows PC).
- http://localhost:3000 (Home / Studio / Library) and http://127.0.0.1:8001/health.

## Backlog (not scheduled yet)
- **Delete a song (cleanup; asked 30 Oct, after the freeze)**: the song card's ⋯ menu -> Delete (asks first), exactly like Collections (the user, 30 Oct):
  like Collections: the folder moves to songs\_removed\<title> (removed <date>), never deleted; its database
  rows hidden; "Removed songs" with Restore; not while it renders.
- **Colour grading (plan approved, not built yet)**: a look per brand -> collection (look.json) -> song
  (white balance, contrast, saturation, black level, warmth, optional vignette; presets warm cinematic,
  cool night, soft pastel, natural, film fade; optional .cube LUT); shot matching first (brightness and
  white balance per clip, a capped gentle correction toward the collection average); graded once per
  clip in the clip cache (clip + look + strength); readability rules applied after grading; Style tab
  on/off, preset, strength, before/after frames; QA "Shot colour" naming the clip; never the audio.
  **Default strength 40%** (the user's clips already have a strong look: matching matters more than
  restyling). Tests: matching on clips with different white balance/exposure, cache reuse, strength, QA.
- **Proposed Step 5j.1 — Lyric readability on bright clips** (reported on the wedding collection: the
  waiting next line and the pink karaoke highlight get lost on white / cream footage). Idea:
  - measure the brightness behind the lyric area per shot (FFmpeg on the prepared clip frames, cached
    like the posters) and pass it in the props, so preview and render stay identical;
  - when it is bright, automatically add a soft text shadow and/or a subtle scrim (a soft dark gradient
    behind the lyric band), faded in and out with the shot, never a hard box; strength per brand.json
    (e.g. `readability: { auto: true, shadow, scrim }`), overridable per platform and per run;
  - the karaoke highlight and the next line get extra contrast (a darker outline or a deeper accent tint)
    on bright shots;
  - QA "Lyric contrast": WARN naming the shot / line when the contrast between text and background stays
    too low (WCAG-style ratio on sampled frames), also for the waiting next line and the highlighted word;
  - tests: brightness measurement, the on/off decision with hysteresis (no flicker between shots), QA.
  - D1 (from the review): test on real wedding footage (white dresses, skin tones, soft focus), not only
    on synthetic frames.
  - Open questions: shadow vs scrim as the default; how strong the scrim may get before it looks like a
    box; one decision per shot or per line.
- **Proposed Step 7.1 — EP film for YouTube (16:9)** (D2): the songs of an EP (song.json `ep`) in a set
  order become one video. Intro card (EP title, artist, EP cover, written like a short letter from the
  artist); each song with its own stored alignment, lyrics, effects and layout plus a title card;
  transitions crossfade or a short silence (recipe choice), never a hard cut; audio levels matched;
  publish.txt with YouTube chapters (00:00 Intro + one per song, exact times), tracklist, EP thumbnail;
  one .srt / .lrc for the whole video with the right offsets; songs with low-confidence lines or missing
  clips flagged before rendering. Later the same as a vertical Reel EP film.
  Open questions: where the EP's order, intro text and cover live (an `eps\<name>\ep.json`?); loudness
  target (e.g. -14 LUFS for YouTube); length of the title cards; one render or songs rendered separately
  and joined (faster re-renders).
- **Proposed Step 7.2 — Song notes** (D3): notes.txt per song (1–2 sentences by the artist, in the
  song's language), editable in the Assets tab. In the EP film shown during the instrumental intro (or on
  the title card when the intro is too short), reading-speed timing (~3 words/s, at least 4 s), soft fade,
  brand fonts; also under each chapter in publish.txt. Note text is never generated automatically.
  Open questions: also in single-song YouTube videos?; position on screen (above the lyrics band?).
- **Proposed Step 7.3 — Line annotations** (D4): annotations.txt (line number + a short artist note),
  shown only in an "annotated" render, during the next instrumental gap after that line, never over sung
  lyrics; pnpm make can render a "clean" and an "annotated" version of the same run.
  Open questions: what happens when a gap is too short (skip with a warning, or the next gap?); line
  numbers vs the line's text as the key (numbers move when lyrics.txt changes).
- **Proposed Step 5g.5 — Full song as a Reel** (D5): confirm `--section full` works for Reels (a 4:01
  song) and passes QA (length vs the preset's target, the seamless-loop ending, file size / bitrate).
  Open question: should Reels allow a full song at all, or only with a confirmation?
- **Effects page**: a gallery of all lyric effects (later also ambient effects and loop scenes) with
  animated previews rendered on a line of the selected song (cached), an intensity selector, "set as
  default for <artist>" for verses and hooks (writes brand.json), effect descriptions and which
  platforms use each effect.
- **Effects Builder** (decided: when scheduled it goes straight to "v2"): a keyframe timeline with
  per-property keyframes, custom easing curves, word / letter targeting (incl. emphasis, odd / even,
  random), entrance / hold / exit phases, 3D tilt, masks / reveals, seeded randomness and beat
  reactivity; it saves versioned, data-only presets to the effects library. Not scheduled yet.

## Known issues
- Fixed: Videos tab polish. The platform heading shows the verdict of its videos ("All 3 ready to post" /
  "1 of 3 could be better" / "2 of 3 not ready"; nothing for one video) instead of the old WARN / PASS badge
  (interrupted / failed keep their own badge with Resume; Compare's QA row is now "Verdict"). Platform groups
  and runs without a finished video are hidden, with "Show N empty runs" (remembered in the browser; nothing
  deleted, Tasks > Resume unchanged). "1 differs from the recipe now". Old runs show the same verdict badge
  (assessment is computed from v<N>.qa.txt + manifest; checked with a manifest without settings / props).
  Fast clicks on Discard / Approve / Restore / favourite: marks are applied at once, sent one after the other
  in click order, the page is refreshed once after the last one, and a refresh can no longer undo a click;
  a failed save only drops that video's change and says so. New: click a tile's picture to watch it with
  sound (player dialog with Approve / Discard / Post); the Post dialog (now titled "Post Reels v1", so it is
  not mistaken for the "Ready to post" verdict) shows the video with controls at the top.
- Fixed: YouTube cover layout, lines near the end jumped to the top ("These Empty Roads", lines 35-37). The
  fixed 20 s end-screen window put any line reaching into it in the top band. Now the app chooses the
  window (from 0.5 s after the last lyric line has left, 5-20 s long, props endScreen.seconds); lines move
  only when the singing reaches into the last 5 s, and then the lyric area glides to the band instead of
  jumping. publish.txt gets "End screen: the last N s (from m:ss)" ({{endScreen}}, or an "== End screen =="
  note after the tags for older templates). Older manifests (no endScreen.seconds) render as before.
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
- `pnpm songs:migrate --undo` replaces studio.db with the backup: stop Lyric Studio first (it asks).
  Runs made between --apply and --undo stay on disk but lose their database rows (jobs, marks).
- A song file replaced in the Assets tab keeps the stored alignment (keyed by lyrics + hints); if the new
  mix has different timing, use Generate -> advanced -> re-align.

## Next
**Agreed order (30 Oct 2026, workflow review).** Follow it strictly; each item is its own step, plan first.

1. ✅ **Verification pass (done 30 Oct 2026: quick pass, bug-fix session, second pass; every step verified).** Feature freeze until done: run 2 songs end-to-end on the PC
   (checklist below), collect every issue in one list, then ONE bug-fix session (Sonnet) for the whole list.
2. ✅ **Tidy-up step (done 30 Oct 2026; no app changes):** CLAUDE.md down to ~3 pages (guiding principle, hard rules, stack, how to
   work with the user); each feature spec into its own file under docs/ (e.g. docs/endings.md,
   docs/lyric-timing.md, docs/collections.md), opened only when working on that feature; PROGRESS.md keeps the
   last 5 steps + open issues, older history to docs/history.md. Nothing may be lost: every rule moves, none is
   dropped.
3. **Step H: Library cards** — one status colour system (grey not made / amber to review / green approved /
   red failed), short platform labels that never truncate, a "4/6 ready · 1 error" line, 2-line titles, a
   Generate / Fix button on the card, filters (All · No videos · Needs review · Errors · Ready) and sorting,
   a warning when two songs share the same cover. The card becomes the entry to the song's stages (item 4).
4. **Four-stage song page:** a stage bar Prepare → Shape → Make → Review & Post over the existing tabs (they
   stay, as detail screens). Prepare shows a **to-do list** of only what needs the user's ears or eyes ("2 lines
   to check by ear", "Canvas needs a clip of 9 s+"). Make = one button **"Make release pack"** (all the
   recipe's platforms; advanced options folded away). Default one video per platform (the app's best plan);
   "Try another take" for more. A video judged ✅ Ready to post with no points goes straight to the Post list.
   Style tab shows only what differs from the artist's look ("differs" badge), the rest collapsed.
5. **Releases + Make all** (replaces Step 6.3): a release (EP / batch) groups songs; a grid songs × platforms
   with ✅ / 🟡 / 🔴 / not made; "Make all" queues every missing video of the release (overnight); per-artist
   **looks** (named complete styles, e.g. "Life Lyrics Cinematic", "Pômé Polaroid") apply to a whole release;
   Scheduled / Published with manually entered results as planned for 6.3.
6. **Lyric Sheet + section retakes** (ideas from Borumi): the song as a page (sections as headed blocks, each
   line with the clip it plays over as a thumbnail; drag a clip onto a line, move it down a line); "Try another
   take" per section with a quick low-res preview, both takes kept. Later: a **clip shopping list** before
   gathering footage (what each section and the Canvas need).

**Targets, checked on every test pass:** the user's time per song (new song → posted Reel) under 15 min;
decisions asked of the user per song under 5, all creative; share of first renders "Ready to post" above 70%.
When a target misses, it decides what to improve next.
