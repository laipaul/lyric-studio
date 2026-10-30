# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Effects, batch 2 step 1: Clarify, Ascend, Ink ✅ (to verify on the Windows PC)
- **clarify**: each word pulls into focus (blurred and dim -> sharp) as it is sung, like a camera finding focus.
- **ascend**: the letters rise into place one after another, a soft wave across the line (titles too).
- **ink**: the line flows in left to right behind a soft-edged reveal, in time with the singing, row after row;
  made for script fonts (titles too).
- All three in Verse / Hook effect, the Textboard and "Try an effect". Tests: effects-canva.test.ts (sharp when
  sung, letters in place on time, uncovered by the last word, QA box counts the rising letters), effects.test.ts
  (14 effects, no jumps).
- Step 2 next: Held-note glow, Chorus lift, Shine (music-reactive add-ons, off by default).

### Fix — title opening fits itself, loop check accepts its lead-in ✅ (verified by the user on the Windows PC, 30 Oct 2026: These Empty Roads Reel now "Ready to post")
- Found on These Empty Roads (Reels, title opening on): "Not ready — the title opening reaches under the
  platform's buttons" (asking you to shorten the title or pick a smaller size) and "the jump back to the start may
  be noticeable (phrase)". Both were the app's job.
- **Title opening fits itself** (src/card-layout.ts fitCardBlocks): a long title wraps onto at most 2 balanced
  lines inside the safe area, then the title block shrinks step by step (at most 25% smaller), and it is moved
  inside the safe area (and the 3:4 profile grid when it fits). The composition draws exactly what QA measures.
  Only when it truly cannot fit does QA fail, and the advice is creative ("a shorter title or tagline").
- **Loop check**: with the title opening on, the "phrase" point accepts the app's own lead-in (up to 2 bars
  before the first sung line) instead of warning about it.
- Built by a Sonnet helper (bug-fix rule), checked here: the change made the Textboard's server code load the
  video renderer and broke the production build; fixed by moving the layout into its own Remotion-free file
  (src/card-layout.ts). All browser tests and the title / textboard / loop / QA tests pass; a real render
  could not be checked in the cloud (renders need a download this sandbox cannot make).

### Effects: letter-by-letter typewriter, Spread, Breathe ✅ (to verify on the Windows PC)
- **Typewriter** now types **letter by letter** like Canva, at a steady pace, with a thin **cursor** in your
  accent colour that blinks softly once the line is typed. Never behind the singer: every word is fully typed
  when it is sung. **Typing pace** = the effect's intensity: calm / normal / quick.
  **typewriter-erase**: un-types the line when it leaves. **typewriter-words**: the old word-by-word version.
- **Spread**: the letters open up to their spacing as the line fades in (never wider than the line).
- **Breathe** (Style → Breathe: off / gentle / with the beat): the lyrics swell softly while on screen, with
  the beat = once a bar, at its fullest on each downbeat; works with every effect; a little deeper on choruses.
- **Title cards**: Typewriter types the title letter by letter (done a second before it leaves); Spread works too.
- **Style → "Try an effect"**: your song's first lines played in a loop with any effect, pace and Breathe,
  exactly as the video draws them; trying saves nothing.
- Fixed a flaky Releases browser test (it clicked the hidden page left behind after a rename).
- Tests: effects-canva.test.ts (typed by the time it is sung, steady, cursor, pace, erase, title cards,
  spread never wider, breathe on the downbeats and in the safe-zone box); effects.test.ts updated (11 effects);
  song-stages.e2e.ts (Breathe setting, the preview).
- Next (proposed, from the Canva toolbar): a per-card styling row in the Textboard (colour, case, letter
  spacing, line height, transparency) and a Text effect (soft / strong shadow, outline, glow, background band).

### Releases + Make all (step 1) ✅ (to verify on the Windows PC)
- **Releases** in the header (Library · Releases · Collections): a release groups the songs you put out
  together (an EP, a batch). **New release**: a name and the songs; "Pick an EP" ticks the songs that share it.
  Each release is a small file in workspace\releases\ (songs are only referenced, never changed).
- **The grid**: songs x platforms in the Library's colours (✓ approved, to review, failed, — not made, "·" not a
  platform of that song); "9 of 15 ready to post"; click a cell to open the song.
- **Make all**: first a preview of what will be made (song by song), what cannot be made yet and why (e.g. no
  clips) and an estimate from your past renders; then one click queues it all, one video per missing
  platform, never redoing videos waiting for review or approved. Stop / Resume as usual.
- **Songs / Rename / Delete** (moved to releases\_removed\, Restore on the Releases page).
- Fixed on the way: after creating a release the "New release" window stayed open in the background and blocked
  clicks (the page behind stays alive after navigating): every dialog now closes before moving on.
- Tests: releases.test.ts (file, grid, what is missing, blocked songs, the estimate learning from past renders,
  rename / delete / restore); browser: releases.e2e.ts (in pnpm test:e2e).

### Four-stage song page, part 2 ✅ (to verify on the Windows PC)
- **Post: "Ready to post — approve?"**: videos the app judged ✅ with nothing to improve, not yet approved or
  discarded, with one-click **Approve**. Nothing is approved without your click.
- **"Try another take"** in Videos: one button per platform makes one more video of it (take 3, 4, …: a
  different cut and look, same recipe and clips). The Canvas has no takes (it is one chosen loop).
- **Style shows what differs**: only the settings this song changes from the brand (plus its platforms);
  "Show all settings" for the rest.
- From the part 1 check: **Make counts every kept video** of the song (all runs), and Generate's **More
  options default to one video per platform** (unless the song's recipe sets a number).
- Tests: take.test.ts (a take is exactly vN, each take differs), song-stages.e2e.ts (Post offer + Approve,
  another take queued as take 3, Style's short list, Make's count); the Style and Storyboard browser tests open
  "Show all settings".

### Four-stage song page, part 1 ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Stage bar** on every song: 1 Prepare (Assets, Lyrics) → 2 Shape (Style, Storyboard) → 3 Make (Generate) →
  4 Review & Post (Videos, Post), each with a status line ("2 to check", "6 videos made", "3 to review · 1
  approved"); a stage shows only its own tabs (all tabs and features unchanged).
- **Prepare to-do list**: only what needs you — lyrics or clips missing (these block making videos), no cover,
  label lines like "Chorus:" in the lyrics, lines to check by ear; each with a button to the right tab.
- **Make release pack**: one button, one video per platform for the song's own platforms (Style → platforms;
  else Reels, TikTok, Shorts, YouTube, Canvas), with its recipe and collections. The full Generate panel is
  folded underneath ("More options").
- **Opens on the right stage**: Review when the song has videos, else Prepare when something needs doing,
  else Make. The Library card counts only the song's own platforms when it has them ("1/2 ready").
- Tests: song-stages.test.ts (to-do list, the song's platforms); browser: song-stages.e2e.ts (new) and the
  Style, Pairings and Videos browser tests now reach their tab through its stage (e2e/stage-tabs.ts).

### Step H — Library cards ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **One colour per platform chip:** grey = not made, amber = made but not approved yet ("to review"), green =
  at least one approved video (the number = approved videos), red = failed or stopped (hover: the reasons, and
  Resume for a stopped run). No more green "0": a platform whose videos were all discarded is grey.
- **Readable chips:** full names (Reels, TikTok, Shorts, YouTube, Canvas) that wrap instead of being cut off;
  "Standard" only shows when the song has Standard videos. **Titles on 2 lines.**
- **Summary line** per card: "2/5 ready · 1 to review · 1 error" (or "No videos yet").
- **One button per card:** Generate (no videos yet), Fix (a failed run -> Videos tab), Resume (a stopped run,
  one click), Review (videos waiting for approval -> Videos tab); none when everything made is approved.
- **"Same cover as …"** when two songs use the very same cover picture.
- **Filters** All · No videos · Needs review · Errors · Ready (with counts) and **Sort** Last made · Title ·
  Date added.
- Tests: library-status.test.ts (chip colours, counts, summary, action, filters, sorting), library.test.ts
  (approved per platform over every run, same cover); browser: library.e2e.ts (now part of pnpm test:e2e).

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
3. ✅ **Step H: Library cards (verified 30 Oct)** — one status colour system (grey not made / amber to review / green approved /
   red failed), short platform labels that never truncate, a "4/6 ready · 1 error" line, 2-line titles, a
   Generate / Fix button on the card, filters (All · No videos · Needs review · Errors · Ready) and sorting,
   a warning when two songs share the same cover. The card becomes the entry to the song's stages (item 4).
4. ✅ **Four-stage song page (part 1 verified 30 Oct; part 2 built 30 Oct, to verify).** Part 2 was: "Ready to post" videos offered straight in
   Post; Style shows only what differs from the brand; "Try another take"; plus from the part 1 check: Make's
   status counts every kept video of the song, not only the latest run ("4 videos made", not "1"); the Generate
   panel's "More options" default to one video per platform, like the release pack (Reels showed "3 videos").
   Original description: a stage bar Prepare → Shape → Make → Review & Post over the existing tabs (they
   stay, as detail screens). Prepare shows a **to-do list** of only what needs the user's ears or eyes ("2 lines
   to check by ear", "Canvas needs a clip of 9 s+"). Make = one button **"Make release pack"** (all the
   recipe's platforms; advanced options folded away). Default one video per platform (the app's best plan);
   "Try another take" for more. A video judged ✅ Ready to post with no points goes straight to the Post list.
   Style tab shows only what differs from the artist's look ("differs" badge), the rest collapsed.
   Noted from the Step H check (30 Oct): the card's "0/5 ready" counts every platform; once a song has a
   recipe of platforms, count only those (e.g. "1/3 ready" when TikTok is not wanted for that song).
5. ✅ **Releases + Make all (step 1 built 30 Oct, to verify; step 2 next: per-artist looks applied to a release, the release status Draft → Ready → Scheduled → Published with a planned date and results noted by hand)** (replaces Step 6.3): a release (EP / batch) groups songs; a grid songs × platforms
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
