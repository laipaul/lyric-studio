# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Transport bar under the video ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026. Under the Shape page's viewer, instead of the play button inside the
  video: ⏮ go to start, ⏪ back one bar, ▶/⏸ play or pause, ⏹ stop (pause and back to the start), ⏩ forward
  one bar, ⏭ go to end. The steps land on bar lines (where cuts fall); Shift-click moves one frame.
- On the right: the time (0:35 / 1:30), **Speed** 1x / 0.75x / 0.5x / 0.25x to have time to check the lyrics,
  **Loop** on / off, mute with a **volume slider**, full screen. Speed and volume change only the preview, never
  the song file or a made video.
- Keys (when no field is being typed in): Space play / pause, ← / → one bar (Shift: one frame), Home, End.
- Tests: transport.test.ts (bar steps forward / back, the grace while playing, frame steps); browser:
  storyboard.e2e.ts (each button, Shift steps, 0.5x plays at half speed, Loop plays on from the start, mute and
  the volume slider, the keys).

### Shape page, Canva style (rail, menus, panels) ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026, after the first Shape page. **The top stage bar is gone**: Prepare, Shape,
  Make and Review sit in a slim **rail on the left**, with a coloured dot for their status. On Shape the rail
  also lists its menus: **Fonts, Effects, Colour, Clips, Text, This song, To make, Automatic**.
- A menu opens **one panel** beside the rail (click again or ✕ to close it); with no panel open the editor uses
  the whole width. **Clips** works like Canva's Uploads: the clips used as a grid, dragged onto a shot or a
  lyric line, or onto each other to reorder. Clicking a shot opens its details in the panel; clicking a text
  card opens the Text panel (card editor and templates).
- **The editor fills the rest**: the viewer as tall as the screen allows, the timeline across the full width,
  the verdict with **Next: Make →**, and the plan's details folded behind it.
- **Slim header**: back arrow, the cover, the song title, the artist and the video chips (Reels 1 …) on one line.
- Tests: song-stages.e2e.ts (the rail with the four stages and the eight menus, one panel at a time, open /
  close, the panel left of the viewer, each panel's rows and summary lines), storyboard.e2e.ts (viewer above a
  full-width timeline, Clips panel, details folded, drags from the panel), pairings.e2e.ts (Fonts panel, fits
  at 1024 px), textboard.e2e.ts (Text panel), style-lock.e2e.ts (settings reached through the menus).

### Shape as one page (Style + Storyboard merged) ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 (replaces the "Style tab rebuild" open decision). Shape has no tabs any
  more: **the video viewer at the top in the middle**, under it the **soundtrack** (bar lines, waveform, lyric
  lines), the **shots**, and the **clips used** (drag to reorder). **All the tools in one column on the left**:
  Look (font pairing dropdown, the fonts line with Fine-tune, Set effect, accent colour), This song, What to
  make, Automatic (folded); a clicked shot's details (and the clip / card editors) appear at the top of it.
  **"Next: Make →"** under the viewer. Old links (?tab=style, ?tab=storyboard) open the Shape page.
- **Every setting once, saved at once**: the display-only rows (Verse effect, Hook effect, Breathe, Held-note
  glow, Chorus lift, Shine) are gone; Set effect is the only place, with a **Verses / Choruses** switch; every
  click is saved to song.json straight away ("✓ Saved"); no Save to recipe buttons, no "not saved yet" line.
  Their per-platform values: Set effect's ⋯ → Per platform….
- **This song** and **What to make** are one line each ("Tagline: none · EP: none · YouTube: cover · Title
  opening: off", "Reels 3 · YouTube 1 · clips: the song's own + wedding"); click to edit.
- **⋯ menu** on each setting: Per platform…, Back to the inherited value, Lock / Unlock, Use for all my songs…
  (Breathe and add-ons: in Set effect's ⋯). A locked setting shows a padlock.
- **One live viewer**: the planned video (as Make renders it). The plan shows on opening the page (no Show
  button); after any change the app plans again by itself (one plan at a time); meanwhile the new fonts,
  effects, Breathe, add-ons and accent are shown in the viewer at once, and pointing at a font pairing tries it
  there. Without a plan yet (no clips, lyrics not timed) a stand-in preview of your first lines shows instead.
- **Drag a clip onto a shot**: it is pinned (⚓) on the lyric line that starts in that shot; a shot with no
  line starting in it (intro, break) gets the clip by moving it to that place in the clip order. Dropping on a
  lyric line works as before.
- Font pairing kept as a dropdown (its list now always fits the window). Slimming the plan's details (analysis
  text, textboard templates) stays U2b.
- Tests: look-patch.test.ts (the viewer's patch: fonts and files, effects, Breathe, add-ons, nothing patched
  without a change); browser: song-stages.e2e.ts (one page, tools left of the viewer, blocks, compact lines,
  ⋯ menu, instant save with the Verses / Choruses switch, brand for all songs, accent, Next: Make),
  storyboard.e2e.ts (planned on opening, viewer → soundtrack → shots → clips, drop on a shot anchors, a look
  change patches the viewer then re-plans, the tempo re-plans on the same page), style-lock.e2e.ts (locks via
  the ⋯ menu, locked chips greyed out), pairings.e2e.ts, textboard.e2e.ts.

### Fix — vocal stem check corrects a small speed difference ✅ (verified by the user on the Windows PC, 31 Oct 2026: all 4 songs pass with the vocal stem)
- A song exported from the DAW can play a little faster or slower than Suno's stem (Love Is A Good Thing:
  about 0.2 %, so the gap grew from 0.66 s to 0.77 s along the song and the stem was refused). The check now
  measures that speed (up to 1 %) and lines up the app's private analysis copy of the stem with it; your song
  and stem files are never changed and nothing reaches a video. Assets says e.g. "Vocal stem lined up: 0.7 s
  offset, from trimming the song's start; the song plays 0.2 % faster than the stem (from the export),
  corrected for the lyric timing." A song edited in the middle, another take, or more than 1 % stays refused.
- Stored checks are redone once (new version), so a stem refused before is checked again by itself.
- Assets wording: adding a stem says your taps are kept and starts set by hand before the stem are reset once.
- Tests: test_vocal_stem.py (speed corrected at 0.4 %, the real song's case at 48/44.1 kHz with a lined-up copy
  checked at 30 s and 80 s, a 4-minute song 0.2 % off, 2 % refused, middle edit + speed refused),
  vocal-stem.test.ts (label, key and record with a speed).

### Original file names + the vocal stem's timing as the base ✅ (verified by the user on the Windows PC, 31 Oct 2026)
- **Your files keep their own names.** The song, the lyrics, the vocal stem and the backing vocals are stored
  under the names they came with ("These Empty Roads (Master).wav", "TER lyrics v3.txt", "These Empty Roads
  (Lead Vocal).wav"); the app remembers which file is which in the song's hidden .studio\files.json. "+ New
  song" and the Assets tab's Add / Replace no longer rename anything; Replace moves the old file to
  .studio\replaced\ under its own name. A new file never overwrites another one ("name-2.wav").
- **Files put into the song folder by hand are recognised**: the song by its content (also after renaming it in
  Explorer; a copy of it is simply not used), the only .txt as the lyrics, "Lead Vocal / Vocals / Vox /
  Acapella" as the vocal stem, "Backing / Harmonies / BGV" as the backing vocals, and a WAV with any other name
  as the vocal stem when it lines up on the song. A new vocal stem re-times the lyrics by itself. What is still
  unclear is asked once on the Assets tab: **"What is this file?"** (Lyrics / Vocal stem / Backing vocals / Not used).
- A stem that lost its extension ("Love Is A Good Thing Lead Vocal", no .wav) is accepted when its content is a WAV
  (stored with ".wav" added; dropped by hand it keeps its name). Before, Add… refused it.
- New **"Backing vocals"** row on the Assets tab (optional; kept with the song, never used for timing or output).
- **Songs made before work unchanged**: song.wav, lyrics.txt, vocals.wav and backing-vocals.wav are the fallback,
  nothing is renamed. The song file is never renamed, edited or written (tests compare its content hash).
- `pnpm make "<song folder>"`, `pnpm lyrics:compare-voice` and the audio service's `--stem auto` use the same links.
- **The vocal stem's timing is the base (your decision, 31 Oct):** the start times you set by hand before the
  song had a vocal stem were corrections of the old timing, so they are reset once, as soon as the timing on the
  stem is used; the old hints.lrc is kept in .studio\replaced\ and the Lyrics tab shows a notice with **Undo**.
  Starts you set from now on stay on top of the stem's timing. Back to the stem's timing any time: ↺ on a line,
  or the new **"Reset all to the vocal stem's timing"** (with Undo). Taps (pnpm tap) are never touched.
- Tests: song-files.test.ts (19: a stem without extension, original names in all four roles, Replace keeping names, no overwrite, hand-dropped
  files, the unclear file asked once, the song renamed in Explorer, a stem found by lining up, old songs unchanged,
  the song hash unchanged, the reset once / Undo / Reset all), test_vocal_stem.py (the linked stem).

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
- **Next bug-fix round (noted 30 Oct):** (1) the song page header chips still use the old colours (green "Standard 0",
  orange "Reels !"): show the Library card's chips (grey —, amber to review, green approved, red failed / stopped,
  Standard only when made); (2) old Tasks entries say "2 PASS" (messages written before the wording fix) and two
  old stopped runs have no Resume button; (3) lint: 3 errors in song-view.tsx / storyboard-tab.tsx (setState in an
  effect, a hook in a callback), already there before 30 Oct.
- Fixed (31 Oct): Make forgot the ticked platforms (e.g. YouTube) after a trip to Prepare and back. The Generate tab
  now stays loaded (hidden) while you are on the song page, so every choice in it survives; checked in song-stages e2e.
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

**Lyric timing first (agreed 31 Oct 2026; done 31 Oct: L1a verified on 4 songs, L1b dropped). Next: the UX
steps below (U2b first); the open decisions stay paused.**
- ✅ (verified 31 Oct: These Empty Roads "perfect"; then all 4 of the user's songs pass with the vocal stem) **L1a. Vocal stem (vocals.wav) as the main guide for lyric timing**; Demucs only
  the fallback (see Latest steps). Verify with `pnpm lyrics:compare-voice` on These Empty Roads.
- ✅ (verified 31 Oct) **Original file names + the vocal stem's timing as the base** (see Latest steps).
- ~~L1b. The Lyric Map~~ **dropped by the user on 31 Oct 2026** ("not needed anymore"): the vocal stem's timing
  plus the hand-set starts and "checked by ear" do the job (the idea, for reference: song sections as a map,
  the few points most worth checking by ear, confirmed points as fixed anchors, re-alignment between them).
- **L2 (later).** The user's confirmed songs become a test set to measure accuracy and to compare aligner models on
  his own songs. Candidates noted 31 Oct (from outside reviews): a phoneme-based or singing-trained aligner (DALI),
  a trained voice detector (Silero VAD) and pitch (pYIN) as a sign of quiet / breathy singing, snapping word starts
  to consonant attacks, a per-word confidence score. Skipped on purpose: parsing DAW screenshots, snapping lyrics to
  the beat, a spectrogram to drag by hand.

**UX order agreed 30 Oct 2026 (after the Style tab simplification and an outside UX review).** Do these
before Releases step 2 and the Lyric Sheet, one step each, plan first:
- ✅ (built 30 Oct, to verify) **U1. Simpler font cards (Shape):** each card = picture, name, ✓ when chosen; descriptions and font
  details on hover/click; warnings only on the chosen look, as one plain line; readability over the clips is
  the app's job (it adds the backing by itself when needed), not a setting for the user.
- ✅ (built 30 Oct, to verify) **U2. One big live preview that stays on screen (Shape):** fonts + effect + accent together on the song's
  own clip, updating at once with every choice; replaces the Set effect's small player (as built: the font
  cards keep their small pictures as the visual picker; pointing at a card tries it in the big preview).
  Fix 30 Oct: save buttons under the controls; preview fits narrower windows; long clip names shortened; font pairings as a dropdown with live preview (hover / arrow keys), card thumbnails removed (replaces the U1 card grid).
- **U2b. Storyboard simplified (Shape; added 30 Oct after an outside review):** header = a short summary of
  what the app decided (Pacing, Transitions, Ending, Section + the predicted verdict, e.g. "Ready to
  generate"); the detailed analysis lines folded under "View technical analysis" (no invented "mood": only
  what the app really decides); three clearly labelled tracks Music (taller waveform) / Lyrics / Video (shots
  with thumbnail + short name), same precise timing and dragging; click a lyric line = the preview jumps
  there, a selected shot is highlighted (check what already works, add only what is missing); a shorter
  selected-shot panel ("Shot 5: 01_dress · 5.6 s · speed 0.92× · best moment chosen automatically") with
  "Adjust shot" for in/out, speed and the rest. (31 Oct: Shape is now one page; "Next: Make →", the
  verdict under the viewer, the taller waveform and shots as drop targets are built; what is left is the
  folded analysis, labelled tracks and the shorter shot panel, on the left column.)
- **U3. Review & Post around the videos:** per platform, the approved (else the best) video first, then the
  alternatives; run-by-run history as a secondary view.
- **U4. Clearer wording:** one meaning each for made / ready / approved everywhere (Library, Releases, stages);
  verdict badge "Good · 1 to improve" with the point on hover; a one-line summary before Make starts (videos,
  platforms, length, clips); after generating, go straight to Review; Make's per-run choices clearly marked
  "this run only" vs saved to the song.
- **U5.** Then Releases step 2 (item 5 above) and the Lyric Sheet (item 6).
**Open decisions (paused 30 Oct 2026, 23:40 — the user is rethinking the strategy; build nothing of this until he decides):**
- ✅ Style tab rebuild: decided and built 31 Oct 2026 as "Shape as one page" (see Latest steps); font
  pairings stay a dropdown.
- Canva: no Canva-style editor (too much, and against the guiding principle). Idea: design looks in Canva and
  import them (.pptx keeps text boxes with font, size, colour, position; SVG outlines text; Canva animations
  and Canva-only fonts don't transfer).
- The user's worry: being frozen in one style. Proposed answer: looks as a growing collection per artist, a look
  is only a starting point per song, "Try 3 looks" in Make, vary looks across a release, a nudge when the last
  posts all used the same look.
Later (not scheduled): Library "Continue working" section, auto-director (after complete looks), collection merge.
Product note: the app is for the user's own use; once fully tested on his own songs he may sell it to other
artists as a one-off purchase installed on their own PC (like Borumi). Not now — but avoid choices that would
block that (hard-coded personal paths, single-artist assumptions).

6. **Lyric Sheet + section retakes** (ideas from Borumi): the song as a page (sections as headed blocks, each
   line with the clip it plays over as a thumbnail; drag a clip onto a line, move it down a line); "Try another
   take" per section with a quick low-res preview, both takes kept. Later: a **clip shopping list** before
   gathering footage (what each section and the Canvas need).

**Targets, checked on every test pass:** the user's time per song (new song → posted Reel) under 15 min;
decisions asked of the user per song under 5, all creative; share of first renders "Ready to post" above 70%.
When a target misses, it decides what to improve next.
