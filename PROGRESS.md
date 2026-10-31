# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Original file names + the vocal stem's timing as the base ✅ (to verify on the Windows PC)
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

### L1a. Vocal stem (vocals.wav) as the main guide for lyric timing ✅ (verified by the user on the Windows PC, 31 Oct 2026: These Empty Roads "the result is perfect now")
- Put Suno's vocal stem, untouched, in the song folder as **vocals.wav** (Assets tab: "Vocal stem" →
  Add… / Replace…; the old one goes to .studio\replaced\). From then on everything that listens to the voice uses
  it: pnpm align, the voice map, the recognised first words, the vocal-start check and QA "Lines start with the
  vocals". Demucs is only the fallback for a song without a usable stem.
- **The app checks the stem itself** (analysis only): it compares the stem with your trimmed song.wav
  (cross-correlation on the voice band) for one offset over the whole song, then measures it again at 5 points from
  start to end. One steady offset → lined up by itself: "Vocal stem lined up: 1.8 s offset, from trimming the
  song's start." (only the part that overlaps the song counts). The offset changes along the song (a part cut or
  repeated, a tempo change) or no clear match (another Suno version) → "This vocal stem doesn't follow the song:
  probably another version of the song, or the song was edited in the middle." and Demucs is used. Any sample rate.
- **Adding or replacing vocals.wav re-aligns the song by itself**: a "Lyric timing · vocal stem" task runs (Tasks
  menu; alignment + vocal-start check, no videos), with your stored hints and hand-set starts kept. Caches are keyed
  by the stem's content and offset; everything aligned on Demucs before keeps its key (nothing is redone for songs
  without a stem). The manifest (lyrics.voice_source) and pnpm make's log say which voice was used ("vocal
  stem, offset 1.8 s" / "separated by the app"). Prepare's to-do suggests "Add the vocal stem for better lyric
  timing" (never a blocker). backing-vocals.wav may sit in the folder; it is never used for alignment.
- **The song file is never touched**; vocals.wav and backing-vocals.wav are only read (never edited, mixed back
  or in any output). Tests check the hashes before and after, and that a planned video's props hold no stem.
- **Vocal-start rules on a clean stem**: same thresholds (no new settings). The clean-stem tests showed two
  places where a *wet* stem (Suno's keeps the reverb) differs from Demucs, both fixed: a reverb tail filling a
  short pause no longer joins two phrases (a pause followed by a sharp attack starts a new voice stretch), and a
  tail ending just before a line's stamp no longer counts as that line's voice. Every earlier PC case still passes.
- **New command** `pnpm lyrics:compare-voice "<song folder>"`: Demucs and the vocal stem side by side (per line:
  start, confidence, check result; totals: flagged for review, low confidence, moved by the vocal-start check),
  also saved to .studio\lyrics\compare-voice-<time>.md.
- Tests: services/audio tests/test_vocal_stem.py (identical, trimmed start, trimmed end, stem starting later,
  48 kHz stem, middle cut and repeated part rejected, another version rejected, tempo change rejected, silent stem,
  check cached, lined-up copy on the song's timeline, fallback to Demucs, voice map / first words on the stem,
  song and stem hashes unchanged); packages/video test/vocal-stem.test.ts (voice source, cache keys, re-align on
  add/replace with hints kept, rejected stem → stored Demucs alignment, Assets slot, Prepare to-do, the queued
  lyric-timing run, nothing from the stems in the planned video); vocal-guard.test.ts (clean-stem block).
- Not checked here: a real stem against a real Suno mix (no songs in the cloud). The before/after on These Empty
  Roads is the real test (commands in the step's reply).

### U2. One big live preview ✅ (to verify on the Windows PC)
- Shape → Style → Look is now **two columns** on a wide screen: your choices on the left (font cards, the Fonts
  line + Fine-tune, Set effect, Accent colour, the effect rows) and **one big preview** on the right (9:16, about
  340 px wide) that **stays on screen** while you scroll the left side. On a narrow window it sits on top instead.
- The preview is the video's own lyric drawing (same effects, fonts, size and lyric area as a Reel) on your song's
  first lines (the middle one as a chorus), over the **same frame of your clip** the font cards use. It follows at
  once: the song's verse and chorus fonts, the effect / intensity / Breathe / add-ons you try in Set effect, the
  accent colour (as soon as you pick it), and the **soft backing** behind the lyrics when the render would add it
  over that frame (Lyric readability auto / strong / normal, the render's own rule).
- **Point at (or tab to) a font card**: the big preview shows that pair; move away and it goes back to the song's
  fonts. Nothing is saved until you click the card.
- Set effect lost its own small player (the big preview plays what you try); everything else stays: what you
  tried is kept per song (survives Shape → Make → Shape and a reload), the "Not saved to the recipe yet" line and
  the two Save to recipe buttons. **The font cards keep their small pictures** as the visual picker (now up to 5 per
  row beside the preview).
- Background is the still frame (a looping clip would decode video all the time on the PC for little gain).
- Tests: look-preview.test.ts (sample-line timing, the exact font faces loaded, the tried state read back, the
  backing by the render's rule); browser: pairings.e2e.ts (one preview, sticky and ~340 px on a wide screen, the
  clip's frame, backing over the bright cream frame, hovering a card shows its pair without saving and leaving
  restores, still fully visible at the middle of the Look block; narrow window: on top, not sticky),
  song-stages.e2e.ts (the preview plays the tried effect and Breathe, follows a new effect at once, Set effect has
  no player of its own, the accent colour reaches the preview at once and after the save).

### U1. Simpler font cards ✅ (to verify on the Windows PC)
- Shape → Style → Look: the font pairings are now a **grid of small cards** (3-5 per row depending on the width,
  no sideways scrolling), each a smaller picture of the pair (drawn exactly as before) and its name. **Click a card
  to use it for this song**: it gets a ✓ and the pink border (pink only marks the chosen one). The big
  "This song" buttons are gone. The description and the exact fonts show when you point at a card;
  "Save to brand…" is a small link there (and always on the chosen card) and still asks first. "Back to the
  brand" and the "try this" tag stay.
- Warnings: none on the other cards (just a tiny grey "!" with the details as tooltip). Under the grid, the
  chosen pair's points in plain words, e.g. "Lyrics may be hard to read over bright clips like this one: the
  app adds a soft backing behind them when your clips need it" or "Great Vibes is a thin script: short hooks
  only…"; the technical text (contrast ratios) under "Details". Missing accents / characters stay (they need
  another pair), in plain words.
- **Readability is now the app's job**: Lyric readability has a new default **auto**: each video measures its
  clips behind the lyrics and, when at least a quarter of them are too bright for the lyric colour or the accent,
  adds the soft dark band behind the lyrics by itself. The run's log and manifest say which and why. "strong"
  (always) and "normal" (never) stay as overrides (Automatic → Lyric readability, now a list). The music is never
  touched.
- Tests: readability.test.ts (contrast, the auto rule, overrides, recipe), readability-make.test.ts (dry run: dark
  clips no backing, bright clips backing, "normal" wins), pairings.test.ts (plain notes); browser:
  pairings.e2e.ts (grid without horizontal scroll, click chooses (✓, song.json), hover details, warnings only for
  the chosen pair, Details).

### Style tab simplified ✅ (to verify on the Windows PC)
- Shape → Style is now four blocks, each with a heading and one muted line:
  **This song** (Tagline, EP, YouTube layout, Title opening) · **Look** (the font pairing cards, one line
  "Fonts: verses … · choruses …" with **Fine-tune** to show the six font rows, Set effect, Accent colour, then the
  effect rows) · **What to make** (Platforms, Videos per platform, Shared collections) · **Automatic — the app
  handles these** (Shot length, Tempo, Section, Target length, Ending, Transitions, Pace adjustment, Lyric
  readability), folded, with one line: "All automatic" or "2 set by you: Tempo, Ending".
- "Show all settings" and "This song changes N settings…" are gone: everything shows, except the folded
  Automatic block and the font rows under Fine-tune.
- Calmer rows: only the "This song" badge shows (where else a setting comes from is in the tooltip on its name);
  the padlock shows when locked, otherwise when you point at the row; "per platform" too, unless a platform has
  its own value (then the line shows as before); long explanations stay on one line (hover for the whole text).
- Nothing removed: Use for all my songs, reset, lock, the ✓ Saved highlight, the tempo tools and the per-platform
  editors all work as before.
- Tests: song-stages.e2e.ts (blocks in order, Automatic folded with its summary, badges, hover padlock and
  "per platform", font summary and Fine-tune), pairings.e2e.ts (font summary follows a pairing, with "This song").

### Fix — "Set effect" keeps what you tried ✅ (to verify on the Windows PC)
- Reported 30 Oct: after setting an effect, going to Make and back to Shape, the tried effect, intensity,
  Breathe and add-ons were gone (the stage tabs unmount the panel). Now what you tried is kept per song (browser
  tab storage: survives Shape -> Make -> Shape and a reload) and a muted line says "Not saved to the recipe yet: …".
- The two buttons are now **Save to recipe — verses / — choruses** and save everything that differs in one click
  (the effect to the verse or chorus effect, plus Breathe and the three add-ons); locked settings are skipped and
  named ("Locked, kept: Shine"). "Use these add-ons" is gone. The panel is now called **Set effect**, and the Verse effect /
  Hook effect rows below it are display only (the effect is set there; only Per platform keeps dropdowns); Breathe, Held-note glow, Chorus lift and Shine rows are display only too ("Use for all my songs" stays). After a save the note lists what was saved, in the
  rows' own names, those rows get a "✓ Saved" highlight for 4 s, and the "not saved yet" line disappears.
- Tests: song-stages.e2e.ts (tried values kept across Make and back, unsaved line, one-click save, highlight).

### Fix — "Try an effect" can save what you tried ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- Reported 30 Oct: the preview said "pick it in Verse / Hook effect below", but those settings were hidden in
  Style's short list (only what the song changes). Now: **Use for verses / Use for choruses** buttons (the effect
  with its pace) and **Use these add-ons** (Breathe, Held-note glow, Chorus lift, Shine) save to the song in one
  click (locked settings: button disabled); Verse effect and Hook effect always show in the short list; the
  Platforms note says what an empty choice does (Make release pack: all five; More options: Reels + YouTube).
- Built by a Sonnet helper (bug-fix rule), checked here (clean build, Style / Storyboard / Pairings / Song-stages
  browser tests pass).

### Effects, batch 2 step 2: Held-note glow, Chorus lift, Shine ✅ (to verify on the Windows PC)
- Three settings in Shape → Style, next to Breathe (off by default, per platform), each with **"Use for all my
  songs"** (asks first; writes your brand, and the song follows it):
  - **Held-note glow**: a word sung for about a second or longer glows softly in your accent colour while it is
    held, then settles (needs the song's word timings, which every aligned song has).
  - **Chorus lift**: the first line of each chorus arrives about 5% bigger with a soft glow, then eases back.
  - **Shine**: one soft light sweep across each chorus line, on a downbeat.
- All three work with every effect, are in "Try an effect" (checkboxes) and count in the safe-zone check.
- Tests: accents.test.ts (glow only on held words, lift only on the first chorus line, one shine on a downbeat,
  smooth, settings checked); song-stages.e2e.ts (setting saved, Use for all my songs -> brand.json).
- Next: Focus Word + Slide, then Emotion presets (Creative Director).

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

**Lyric timing first (agreed 31 Oct 2026): L1a and L1b come before the Style rebuild and the UX steps below;
the open decisions stay paused.**
- ✅ (verified 31 Oct: These Empty Roads "perfect") **L1a. Vocal stem (vocals.wav) as the main guide for lyric timing**; Demucs only
  the fallback (see Latest steps). Verify with `pnpm lyrics:compare-voice` on These Empty Roads.
- ✅ (built 31 Oct, to verify) **Original file names + the vocal stem's timing as the base** (see Latest steps).
- **L1b. The Lyric Map** (do not build before the user's OK; plan first): a stable ID per word from the song's
  structure (V1.L2.W3); the song as a map of sections; the app picks the few points most worth checking by ear
  (section starts, the first word after a gap, chorus entries, the least-certain lines); the user hears 2 s around
  a point and confirms ✓ or taps the right moment; confirmed points become fixed anchors and the song re-aligns
  between them at once (alignment section by section, so a repeated chorus can never jump to another one); a fix
  in one chorus is offered for its repeats. Ideas noted 31 Oct: Suno's bar grid (BPM, 4/4, bar 1) placed on the
  trimmed song with the L1a offset, so section starts and chorus entries fall on bars; a DAW marker list (Verse 1,
  Chorus...) as section starts if the user exports one.
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
  "Adjust shot" for in/out, speed and the rest; a fixed "Next: Make →" at the bottom of Shape (Style and
  Storyboard) with a status line ("Storyboard ready · 5 shots") — moved here from U4.
- **U3. Review & Post around the videos:** per platform, the approved (else the best) video first, then the
  alternatives; run-by-run history as a secondary view.
- **U4. Clearer wording:** one meaning each for made / ready / approved everywhere (Library, Releases, stages);
  verdict badge "Good · 1 to improve" with the point on hover; a one-line summary before Make starts (videos,
  platforms, length, clips); after generating, go straight to Review; Make's per-run choices clearly marked
  "this run only" vs saved to the song.
- **U5.** Then Releases step 2 (item 5 above) and the Lyric Sheet (item 6).
**Open decisions (paused 30 Oct 2026, 23:40 — the user is rethinking the strategy; build nothing of this until he decides):**
- Style tab rebuild proposed: each setting shown once (the display-only effect / add-on rows removed), every
  change saved at once (no Save to recipe buttons; a Verses / Choruses switch for the effect), compact lines for
  Words on screen and What to make, Automatic folded, big preview + "Next: Make →", "Use for all my songs" and
  locks in a ⋯ menu. Font pairings: dropdown (built) or Canva-style text tiles — undecided.
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
