# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Theme editor fixes: colour codes, save bar on top, a clear Box, no typewriter cursor ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026.
- **Text colour / Accent colour** (Edit theme → Colours): next to the picker, a box to type or paste the colour
  code: #FF2D95, FF2D95, #F29, rgb(255, 45, 149) or 255, 45, 149 (Enter or click away saves it; anything else
  says what to type). src/colour-ref.ts parseColourRef.
- **"Theme" written above the name** in the Themes page's detail view (a theme made from a song carries the song's
  name, which read as the song); its pencil is "Rename the theme"; "Used by the song …"; Edit theme says
  "Editing theme: X".
- **This song → Card text**: every card's words for this song in one place: Title (the same as the header's
  pencil), Tagline, Hook card text, End card text. Theme → Cards keeps only the look, with a link "This song →
  Card text".
- **An effect's name over a title card**: when the paused frame shows a title / tagline / hook / end card, the
  effect's name gets a dark veil over the frame, so the two never read on top of each other.
- **Cards** is now the first section of Edit theme (the order a design is made in), then Text, Motion, Colours,
  Picture.
- **Save · Save as new theme · Cancel** moved from the bottom to right below "Editing: X", and stay in view
  while the sections scroll.
- **Behind the words → Box** did draw, but too faint to notice (55 % black, no room above or below the words):
  now 72 % black with room around the words, the lines staying exactly where they were.
- **Typewriter**: no cursor any more (the accent-coloured bar was irritating); only the letters type in.
- **Typewriter feels like typing again** (the user: "it just glides, even at 0 %"): with the stronger effect
  amounts the typing pace had run away (a short line typed in half a second, mostly during its fade-in). Now
  Strength is only the speed: 0 % calm ~8 letters/s, 50 % ~15, 100 % ~22 (typing.ts typingPace), and
  typing starts halfway through the line's quick fade-in, so the letters appear one by one at full strength.
- **The viewer while choosing an effect** (the user: "the effects stop working"): after pressing play once, the
  viewer no longer showed the effect's name, so paused at the start (no lyric yet) it looked empty. Now the
  name comes back when paused where no lyric is on screen, and pointing at any tile always shows it.
- Tests: colour-ref.test.ts, effects-canva.test.ts (no cursor on screen); browser: song-stages (Box drawn,
  save bar position, typed RGB code, a wrong code).

### Themes, step 7: Hook card and End card ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("yes" to building them).
- **Edit theme → Cards** has **Hook card** and **End card** next to Title: Off / On and a Style each (Plain,
  Outline, Layered outline, 3D extrude, Label bar), with a sample. Switching one on shows it in the viewer at
  once (the cards are always planned, off until the theme has them on; look-patch.ts patches them).
- Reels, TikTok, Shorts only (YouTube has its own end screen); the app places and times them, never over a
  lyric line (src/extra-cards.ts):
  - **Hook card**: big, in the hook font and accent, in the pause right before the first chorus line (up to
    2.5 s, at least 0.8 s of pause); no pause = no card, and the plan's notes say so. Words: This song →
    "Hook card text", else the chorus's first line.
  - **End card**: the call to action, default "Stream {title} on Spotify" (This song → "End card text";
    {title} / {artist} filled in), in the title font and text colour, Label bar by default; the last 3.5 s,
    in the lyric spot after the last line, else above or below the lyrics; it stays to the very end.
- Fitted into the safe zone by the same layout as the title opening; QA's title-card checks include them;
  the manifest records settings.extra_cards. On the timeline they show as "Hook card" / "End card" (a
  click opens the Theme panel).
- Tests: extra-cards.test.ts (placement, no pause, end, {title}, patch on/off), title-opening-make.test.ts
  (End card on a Reel, manifest, QA); browser: storyboard (End card on → viewer, saved, on the timeline),
  song-stages.

### Fix a lyric line's words on its card; effect names in the viewer; stronger effects and Neon ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("how do i correct the text here directly?", and "pick an effect and
  display immediately the effect name on the viewer").
- **Line card → Text → Fix** (Shape, click a lyric line): the words are fixed in lyrics.txt (the old one
  kept in .studio\replaced\, Restore in the Lyrics tab), for every platform and the captions. **The timing
  is kept**: the stored alignment is carried over to the new words (lyrics-view.ts fixLyricLine, lrc.ts
  retextLrcLine: respelled words keep their own times, more or fewer words share the line's sung span), so
  nothing is aligned again; the line's hand-set start and its card's look follow the new words.
- Line card wording: "the theme's" font / effect, plain effect names; "Text layout" with "Save this
  layout" / "Use this layout" instead of templates.
- **Effects made clearly visible** (the user: "some effects don't work"): Cinematic fade settles from 12%
  larger with its letters drawing together; Blur in pulls focus from 12 px (was 4 px, not seen); Dreamy glow
  comes out of a real haze and glows. **Spread** now works like Canva's: letters float in from wide apart and
  drift apart and up as the line leaves (wide only while the line is faint). New **Neon** effect: glowing
  tube letters in the accent that flicker on and hum (new gallery chip "Glow"). Also new: **Word rise** (each
  word rises into place as it is sung), **Slide in from left**, **Slide in from right**, **Slide down**, and
  **Dissolve** (the letters drift up and fade into thin air when the line ends; src/effects/slides.ts). 29 effects.
- **Strength slider** (0-100 %) right under the effect picker, its own for Verses and Choruses (the typing
  speed for typewriters), saved as "glide:70"; 50 % is clearly seen on a phone (the old "balanced" made 30%
  stronger), 100 % is twice that. Replaces the Soft / Balanced / Strong dropdown (old values still work).
- Gallery: compact name tiles, A to Z (the effect in use first, pinned when the gallery opens), a search
  box; pointing at an effect plays it in the big viewer. Dissolve and Spread are seen leaving.
- **Unsaved theme changes are kept** (in the browser, per song) when leaving the editor without Save;
  the next Edit theme brings them back with a note; Save or Cancel clears them.
- **Motion**: gallery tiles show the effect's name big; pointing at or picking an effect shows its name
  moving in that effect over the paused frame in the big viewer; pressing play plays the song with the
  effect on the real lyrics.
- Tests: slides-effects.test.ts, effects tests for all 29; retext-lrc.test.ts, lyrics-view.test.ts (fix keeps timing and hand-set start); browser: textboard
  (Text → Fix), storyboard (effect name over the frame, gone on play), song-stages.

### Themes, step 6: lyric effects gallery, nine new effects, Emphasis word, title styles ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("make all of them", with Canva MotionText / TypeCraft references).
- **Motion** is compact: one effect picker; it opens a gallery of tiles (each plays the effect on your own
  lines when pointed at) with filter chips All · Word · Calm · Slide · Bounce · Wave · 3D · Glitch · Type.
  Effects have plain names (Karaoke, Blur in, Handwriting…); the stored names stay the same.
- New effects (src/effects/trending.ts): Word pop, Highlight sweep, Mask reveal, 3D tilt, Glitch, Wave,
  Echo stack, Slice, Kinetic stack (one or two big words at a time). Already there under plain names:
  Typewriter, Blur in / Focus pull, Handwriting (ink), Beat pulse = Breathe "with the beat".
- **Emphasis word** add-on (recipe/theme emphasis on): the key word of each line (the one held longest,
  never a small word) in the hook font, a touch bigger, in the accent colour.
- **Cards → Title**: Style (Plain, Outline, Layered outline, 3D extrude, Label bar that wipes in) and Shape
  (Straight, Arc, Wave), with a live sample of the song's title; drawn on the title card (YouTube, and the
  title opening on Reels / TikTok / Shorts) and on the Reel cover.
- Picture settings and Intensity are dropdowns now. The brand pairing is called "Artist's fonts".
- Not yet: marking the emphasis word by hand in lyrics.txt; glitch on hard cuts (it glitches as a line lands
  and briefly every few seconds).
- Tests: effects.test.ts (all 23 effects: smooth, readable at the stamp; glitch may jump sideways),
  trending-effects.test.ts (emphasis pick, kinetic groups, names and gallery kinds), picture.test.ts (title
  styles and shapes); browser: song-stages (picker, gallery chips, dropdowns, title style saved), storyboard,
  themes, pairings, style-lock, videos-post, textboard.

### Themes, step 5: background and colours (the theme's Picture) ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("how about the background, colors?"). The theme editor has a new
  **Picture** section, and Colours has a **Text colour** next to the accent:
  - **Colour grade**: Natural, Warm, Cool, Faded film, Black & white, Moody: one look on every clip, so
    mixed footage feels like one film. Drawn over the clips by the video (preview = render); the clip
    files are never changed.
  - **Vignette**: Off, Soft, Strong. **Behind the words**: None, Soft shadow, Glow (in the accent),
    Dark band, Box. The app still adds the soft band by itself when a clip is too bright (readability auto).
  - **Background without a clip** (a song with no clips, a slot): Gradient in the accent, Plain colour,
    Blurred cover. **Grade the Spotify Canvas too**: on by default; off keeps the Canvas natural.
- Themes page tiles and the detail view now show the theme over a real frame of a clip (the first song
  that uses it, else another song), with its grade, vignette and text colour.
- Videos record it: manifest settings.picture (grade, vignette, text_backing, fallback, text_colour).
- Tests: picture.test.ts (grades, vignette, backing, fallback, the Canvas rule, recipe and theme checks,
  older theme.json files get the defaults, the viewer patch); song-stages.e2e.ts (Picture section, the viewer
  shows the grade at once, Save keeps all of it).

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
**Themes (approved by the user 31 Oct 2026, one step each, plan first):**
- ✅ (built 31 Oct, to verify) **T1. Theme foundation + Shape Theme panel** (see Latest steps).
- ✅ (built 31 Oct, to verify) **T1b. Building a theme:** + New theme and the theme editor with Save / Save as new / Cancel (see Latest steps).
- ✅ (built 31 Oct, to verify) **T2. Editable song title + Delete song** (moves to songs\_removed\ with Restore, like Collections).
- ✅ (built 31 Oct, to verify) **T3. Themes page** in the top nav (Library · Themes · Collections · Releases): Canva-style gallery (tall
  preview tiles that play on hover, filter chips) and a theme detail view (big preview on your own song, Use this
  theme, Duplicate / Edit, designer credit, favourite, more like this); create / duplicate / edit / delete (to
  `_removed\` with Restore); the artist's default theme. Library cards show each song's theme.
- **T4. Make:** Compare themes (up to 3); the font and effect dropdowns go; videos show their theme; reactions
  offer to fix the theme.
- Later, inside a theme: text auto-placement and placement presets per format; a **Hook card** and an **End card**
  (styled by the theme; text per song or artist such as "Stream on Spotify" or a link; per platform); a text
  section like Canva's Text panel (font search, brand fonts first, Title / Lyric line / Hook styles as live
  previews, recently used combinations); overlays; cover colours; starter themes; Phone check; drag and
  alignment; theme zip export / import (designers, resale).

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
