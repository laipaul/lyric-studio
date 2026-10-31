# History — every step built so far

_Moved from PROGRESS.md on 30 Oct 2026 (tidy-up), word for word. PROGRESS.md keeps the agreed order, open issues, backlog and the latest steps; finished steps move here._

## Steps done

### Themes, step 3: the Themes page and the theme on Library cards ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("redesign the app around themes"). **Themes** is in the top menu
  (Library · Themes · Collections · Releases): a Canva-style gallery of tall tiles, each theme on your newest
  song's lyric lines in its fonts and colours; point at a tile and it plays. Filters: All · In use · Not used yet.
  **+ New theme** (name first, start from any theme). Deleted themes come back with Restore.
- Click a tile for its **detail view**: the theme playing large, its name, **Designer** (the credit, for themes
  you buy or sell later) and **About**, the songs that use it, **Use this theme for the song** (pick a song),
  **Edit** (opens the theme editor on a song with that theme shown; Save changes that theme only), Duplicate,
  Delete (not while songs use it), and **More like this**.
- **Library cards** now show each song's theme under the artist.
- Tests: themes.e2e.ts (new browser test: menu, cards, gallery, hover plays, new theme, designer, use for a
  song, filters, duplicate, delete, restore, edit on a song and save); themes.test.ts unchanged (pass).

### Themes, step 2: building a theme ("+ New theme" and the theme editor) ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("it's not clear how we build the themes", then "redesign the app around
  themes"). In Shape → Theme:
- **+ New theme**: name it first, pick what to start from (this song's look, Life Lyrics or any theme), then
  "Create and edit": the song uses it and the editor opens.
- **The theme editor** in four sections: **Text** (font pairing, the lyric line and the hook as live samples,
  "Choose each font"), **Motion** (Set effect, Breathe, add-ons), **Colours** (accent colour plus five colours
  from your cover), **Cards** (Hook card and End card: a next step).
- **Nothing is saved until you press Save**: the viewer shows every change straight away; the footer has
  **Save** ("Save (changes 3 songs)" when the theme is shared), **Save as new theme** (the other songs keep the
  old one) and **Cancel**. This replaces "All N songs / Only this song".
- **Each tile**: "Use for this song", and a ⋯ menu with Rename, Duplicate and Delete. Delete moves the theme to
  themes\_removed\ ("Deleted themes" with Restore); a theme a song uses, or the brand's default theme, cannot
  be deleted (it says why).
- Tests: themes.test.ts (new, save, save as, delete and restore with their refusals); browser:
  song-stages.e2e.ts (editor sections, nothing saved before Save, Cancel, Save, "Save (changes 2 songs)",
  Save as new theme, + New theme, Use for this song, Delete and Restore), pairings, storyboard updated.

### Themes, step 1: every song's look comes from a theme ✅ (to verify on the Windows PC)
- Decided by the user on 31 Oct 2026: like a website theme, a song **uses a theme** and the user no longer
  thinks about fonts, effects or colours one by one. A theme is one folder `workspace\themes\<name>\`
  (theme.json with the fonts, effects, accent colour and per-platform values, plus fonts\ and overlays\ for
  later), self-contained so themes can be shared or sold as files later.
- **Nothing looks different after the update**: the first time a song opens (or pnpm make runs), a song that
  never changed its look moves to the artist's default theme ("Life Lyrics", made from brand.json); a song with
  its own look gets its own theme named after the song. song.json keeps only the song's other settings.
- **Shape rail: Theme · Clips · This song · To make · Automatic.** Fonts, Effects and Colour are gone as menus;
  they live in the Theme panel: the song's theme with "Used by N songs", a tile per theme (point at it to try it
  in the viewer, click to use it), Rename, Duplicate, and **Edit theme** (font pairing, Fine-tune, Set effect,
  accent colour). When several songs share the theme, Edit theme asks first: **All N songs** or **Only this song
  (saves a copy)**. Theme settings have no locks, no "Back to the brand", no "Use for all my songs".
- The Text panel (text cards, textboard templates) opens by clicking a text card on the timeline (no rail menu).
- Fix after the first look on the PC (31 Oct): the Theme panel now always lists the brand's default theme and
  every song's theme (before, only the themes of songs already opened showed, so a song with its own look had
  nothing to switch to); the tiles are one per row so the names and lines are not cut; the fonts line is now
  a live sample of the two fonts.
- pnpm make uses the song's theme (the log says which); `--theme "<name>"` tries another theme for one run.
- Tests: themes.test.ts (recipe order, theme.json check, the move to themes, all songs vs a copy, Style
  actions, use / duplicate / rename, a missing theme named); style, pairings and make tests updated; browser:
  song-stages.e2e.ts (rail, Theme panel, tiles, Edit theme, saves into the theme, the "Only this song" copy),
  pairings, storyboard, style-lock and textboard e2e updated.
- Not yet (next steps, as agreed): the editable song title and Delete song; then the Themes page (Canva-style
  gallery and a detail view: big preview on your song, Use this theme, Duplicate / Edit, designer credit, more
  like this), themes on Library cards, Make "Compare themes", reactions that fix the theme.

### Controls in one bar under the timeline ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026: the transport bar sat too low on the screen. The viewer is smaller, the
  timeline sits right under it, and **one command bar under the timeline** holds everything: which video (Plan
  now / a run, platform, video, Pictures, ↻ plan again), the transport (start, bar back, play, stop, bar
  forward, end, time, Speed, Loop, volume, full screen), Follow and Zoom, the verdict and Next: Make. The
  summary line and the hint follow under it. It all fits on one screen, for 9:16 and for 16:9 (YouTube: pick
  it under Platform; the wide viewer gets the same height).
- A YouTube video in the cover layout has no clip shots (your cover art plays the whole song): the empty
  shots lane now says so, with a link to This song → YouTube layout to build it from clips instead.
- Tests: storyboard.e2e.ts (viewer, timeline and command bar on one 1440×1000 screen for Reels and for
  YouTube; the bar holds the source, the transport, Follow / Zoom and Next: Make; nothing between the viewer
  and the timeline).

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
- **Style → "Try an effect"** (now "Set effect"): your song's first lines played in a loop with any effect, pace and Breathe,
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

### Tidy-up — a short brief, details in docs/ ✅ (30 Oct 2026; no app changes)
- CLAUDE.md is now ~9 KB (was 55 KB): what we build, the guiding principle, the hard rules, the stack, how to work
  with the user, and an index of docs/. Every rule moved word for word into docs/<area>.md (screens, data model,
  launcher, audio and output, pacing and cuts, endings and loops, assessment, lyrics, brand and fonts, YouTube and
  Canvas, recipe and songs); a check confirmed no line of the old brief or of PROGRESS.md was lost.
- PROGRESS.md keeps the agreed order, open issues, backlog and these latest steps; the full step history, the
  verification checklist and the 29 Oct plan are in docs/history.md.

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

### Step 5d — One-click Auto Generate (`pnpm make`, `pnpm rerender`) ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 5g.2b — YouTube polish ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 5g.3 — Spotify Canvas ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 5g.3b — Canvas fallbacks, failure summary, logo rule ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 6.2a — Song page: exports, marks, compare, ready to post; 6.1 fixes ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 6.2b — Generate, worker queue, live Tasks menu, Stop / Resume ✅ (verified by the user on the Windows PC, 30 Oct 2026)
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

### Step 6.2c-1 — One folder per song, the recipe, migration, Assets tab ✅ (verified on the Windows PC: Love Is A Good Thing merged, no "(2)" left, "Nothing to migrate" on a re-run, pnpm make reused the stored alignment for both songs, reels PASS with cuts on the beat, the app shows the song once with all runs)
Everything for one song now lives in one readable folder, and each song has a recipe (song.json).
Built in two parts at the user's request: 6.2c-1 (this) and 6.2c-2 (the other tabs, below in Next).
- **Song folder** `WORKSPACE_DIR\songs\<artist>\<title>\`:
  `song.wav|mp3`, `lyrics.txt`, `cover.jpg|png`, `hints.lrc` (optional), `clips\` (the song's own clips;
  removed ones in `clips\_removed\`), `exports\<YYYY-MM-DD_HHmm>\` (the runs, unchanged inside),
  `song.json` (the recipe) and a hidden `.studio\` for the tool's files (`lyrics\` = alignments, stored
  hints, lyrics copies; `settings.json`; `replaced\` = files that were replaced, never deleted;
  `project-files\` = anything else from the old project folder).
  Names are readable and Windows-safe (accents kept; `<>:"/\|?*` become `_`; no trailing dots; device
  names like CON get `_`; max 60 characters); a name already used gets ` (2)`, ` (3)`, ...
  Code: `packages/video/src/node/song-folder.ts` (`folderName`, `songFolderFor`, `songPaths` /
  `songPathsById` — EVERY path of a song goes through these, and they also handle songs still in the
  old layout `projects\<id>\` when `project.folder` is empty).
- **Database**: `project.folder` (workspace-relative song folder; empty = old layout), migration 0005.
- **New songs** (`pnpm make` with a new song file, "+ New song") get their folder straight away
  (`adoptIntoSongFolder`). A song file placed by hand in an unowned `songs\<artist>\<title>\` adopts that
  folder (title and artist from the folder names).
- **Renaming** title or artist (`--title`, `--artist`, "+ New song" with the same song) renames the folder
  (`renameSongFolder`); refused while another process renders the song. Every database path follows
  (`relocatePaths`: project audio/cover/folder, clip paths, video marks, make_run export_dir + options,
  variation run/lrc, render_job output) and the move is appended to `WORKSPACE_DIR\.studio\moved-paths.json`.
- **Old manifests stay re-renderable**: manifests are never edited; `pnpm rerender` / `verifyManifest` and
  the media server follow `moved-paths.json` (`resolveMoved`, applied in order, only moves made after the
  manifest's `created_at` — `movesSince`). Also fixed: `pnpm rerender` now uses the platform's video
  bitrate from the manifest (Reels/TikTok/... re-renders were not frame-identical before).
- **Shared collections** moved to `WORKSPACE_DIR\collections\<name>\` (`collectionDir` falls back to the
  old `clips\<name>\` while that folder exists and the new one does not).
- **Clips of a run** = the song's own `clips\` + the shared collections (merged; the same content in two
  folders is used once and named in a warning). Collections: `--collection a,b` (several allowed), else
  song.json `collections`, else the one remembered in `.studio\settings.json` (old songs). The first
  time, `--collection` (or a song with its own clips) is needed; a `--collection` given on the command
  line or in Generate is saved into song.json (unless locked), so later runs print
  "using collection wedding (remembered)".
- **Recipe** `song.json` (`packages/video/src/node/recipe.ts`): fields `verseEffect`, `hookEffect`
  ("glide", "soft-blur:subtle"), `verseFont`, `hookFont`, `accentColour`, `collections`, `platforms`,
  `variations` ({ "reels": 3 }), `section` (auto | full | 0:11-1:10), `ep`, `youtubeLayout`
  (cover | stills | clips), plus `locked` (list of field names). A `_help` line explains it in the file.
  Checked on read (every problem named).
- **Inheritance** (`resolveRecipe`): library defaults (`LIBRARY_RECIPE`) -> the artist's brand
  (`brand\<artist>\brand.json`: effects, fonts, accent) -> song.json -> this run (command-line options or
  Generate). Each value records its source (library | artist | song | run); `pnpm make` prints one
  "recipe: ..." line with the sources. For lyric effects the platform's motion (platforms.json) still sits
  between artist and song: run > song > platform > artist > library.
  A **locked** field keeps the song's value: a later brand change does not reach it and a run cannot change
  it (the run's choice is ignored with "song.json locks verseEffect: keeping glide (this run asked for
  floating)"). Helpers for the UI (6.2c-2): `saveToSong` (run choices become the song's, locked fields
  untouched), `resetField` (back to inherited, unlocked), `lockField` (copies the current — possibly
  inherited — value and locks), `unlockField`. Per-decision locks (a clip on a line, a word timing) come
  with 6a. `--ep` / the EP field is stored in song.json (old songs: settings). Section default comes from
  the recipe (`pnpm make` no longer defaults `--section` to auto itself).
- **`pnpm make <song folder>`** (one argument): song.wav|mp3 (or the only audio file), lyrics.txt and
  hints.lrc (as `--hint`) come from the folder; all other options work as before.
- **Migration** (`packages/video/src/node/migrate.ts`, `pnpm songs:migrate`):
  `pnpm songs:migrate` = dry run (prints every move, changes nothing);
  `pnpm songs:migrate --apply` = asks "Make sure your regular backup is recent before continuing (y/n)",
  refuses while a run is queued/rendering, makes a light backup in `WORKSPACE_DIR\migrations\<date>\`
  (studio.db copy, every settings.json, journal.json of each step), then moves `clips\<name>\` ->
  `collections\<name>\` and `projects\<id>\` -> `songs\<artist>\<title>\` (audio -> song.<ext>, cover,
  lyrics -> .studio\lyrics, exports, settings -> .studio\settings.json, the rest -> .studio\project-files\),
  writes lyrics.txt (the song's newest lyrics), hints.lrc (stored hints) and song.json (EP + collection),
  updates the database and moved-paths.json, removes the empty old folders, prints what moved;
  `pnpm songs:migrate --undo` (Lyric Studio stopped) reverses the last apply from its journal, restores
  the database and moved-paths.json; files the migration wrote go to `migrations\<date>\undone\`.
  If a move fails half-way (a file open on Windows), it stops and says to run --undo and try again.
  Runs made after a migration stay on disk after --undo, but their database rows (jobs, marks) are gone.
- Fixes after the first migration on the PC: a folder made by hand in advance that holds no files is
  not "taken" (it is used, not given " (2)"); `pnpm songs:migrate --apply` also renames a song folder
  left with " (2)" once its plain name is free (a folder with files that no song owns is never touched;
  the dry run names it); an empty `collections\<name>\` no longer blocks moving `clips\<name>\`; a
  collection kept outside the workspace (`--collection-path`) is found again by its name after the
  migration (before, song.json's collection lost the remembered path).
- Second fix from the PC: after the migration `pnpm make` aligned "A Heart For Two" again instead of
  reusing its stored alignment. Cause: the migration wrote lyrics.txt from the newest lyrics copy by
  date, which is not always the version the newest video was made with. Now it takes the lyrics named
  in the newest video's manifest (a lyrics.txt given later in the studio wins if newer);
  `pnpm songs:migrate --apply` also repairs a lyrics.txt an earlier migration wrote and nobody changed
  since (the old one kept in .studio\replaced\; --undo reverses it). When a song with stored
  alignments is aligned again, `pnpm make` now says why: other words (with the first differing line
  and the stored copy's file), other hints, or another language.
- Third fix from the PC: "Love Is A Good Thing" was split over two folders (song, cover and
  .studio\lyrics in `Love Is A Good Thing\`; exports and an empty song.json in `... (2)\`). Root cause:
  the first version moved a song piece by piece and named its folder in the database only at the end; a
  first --apply stopped half-way (a file in use on Windows), the second saw the song as not migrated,
  found the plain name taken and put the rest into "(2)" (the stored alignments became invisible, so
  `pnpm make` aligned again). Now:
  - each song is built in `songs\.migrating-<id>\` and renamed once at the end (merged into its folder
    when an older interrupted run left files there); the database names the folder only then, so an
    interrupted --apply is finished by the next one and a song can never be split. New songs likewise
    (`songs\.adding-<id>\`, finished the next time the song is used).
  - a folder with `.studio\` or song.json counts as made by Lyric Studio.
  - split songs are detected (the song file in another folder, or a Lyric Studio "<title>" folder next
    to "<title> (2)") for every song, and --apply merges them into the plain name: everything moves over,
    nothing is overwritten (a name clash keeps both, "name (from <folder>).ext"), the empty half is removed;
    runs, marks (favourite / approved / discarded) and database paths follow.
  - repairs for every migrated song: missing lyrics.txt (the lyrics the newest video's manifest names),
    missing hints.lrc (the stored hints), empty song.json (EP / collection from its settings.json or from
    a migration backup `workspace\migrations\<date>\projects\<id>\settings.json`).
  - the dry run shows the whole merge (every move, clashes, runs and marks that follow), the repairs, a
    list "song.json without settings of its own" with the reason (no settings before the migration, or
    not migrated yet), song folders no song uses and leftover staging folders. The Library banner also
    appears when songs need tidying.
  - Per-song state before 6.2c was only settings.json (EP, remembered collection, lyrics.txt path); marks
    are in the database and follow every move; locks did not exist before 6.2c.
- Hardening after 6.2c-1: an interrupted alignment (Ctrl+C, Stop, a crash) is never stored. The aligner
  writes temporary files named with the process id; the result is checked for completeness (every
  lyric line timed in the .lrc, one report entry per line) and only then renamed into place, the .lrc
  last (the commit point). The next run removes leftovers of processes that are gone (and a report whose
  .lrc never appeared); a run still going is left alone. The lyrics copy, an --lrc copy, the hint copy
  and hint.json are written the same way. In `pnpm align` (Python) the LRC, the report and the word
  cache are written atomically, and a damaged cache is aligned again. Tests: a failing aligner, an
  incomplete result, a process killed hard in the middle (nothing stored, cleaned up, aligned again).
- UI fix: every native dropdown (Generate's effect / intensity / layout lists, the artist suggestions in
  + New song) opens dark on Windows: `color-scheme: dark` on the app, options and option groups in the
  theme colours (the selected one in the accent tint).
- **Studio**: Library banner "N songs and M collections still use the old folders" with **Preview**
  (dialog with the dry-run text) and **Migrate** (confirm with the backup reminder, then the same as
  --apply). Song page tabs **Assets / Generate / Videos** (Videos is the default when the song has runs).
  **Assets tab**: song (duration, BPM), lyrics.txt (lines), cover (thumbnail), hints.lrc (time stamps),
  each with "Replace…" (old file kept in .studio\replaced\; a new song file updates the song's hash and
  duration); clips: drag-and-drop or "Add clips" (copied into clips\, free names `name-2.mp4`, the same
  content again is reported and not copied, non-videos skipped), tiles with thumbnail, orientation,
  duration (photo), resolution, "same content as ..." warnings, usable counts for 9:16 and 16:9, Remove
  (moves to clips\_removed\, never deleted; listed under "Removed"). Generate: the song's own clips count
  plus checkboxes for shared collections (song.json's ticked), effect defaults from song.json.
  File server allows song folders' cover, exports, clips and thumbs/ (never .studio\ or the database).
  API: `/api/migrate` (GET dry run, POST apply), `/api/songs/<id>/assets` (GET, POST upload/replace,
  DELETE ?name=).
- Tests (`packages/video/test/song-folders.test.ts`, `migrate.test.ts`, updated make/library/runs/db
  tests): folder names and layout, collisions, recipe inheritance / locks / ignored run / save-to-song /
  reset / lock / unlock / checks, `pnpm make <folder>` (folder files, own clips + collection, duplicate
  across folders, lock wins), rename with database paths and move log, rename refused while busy,
  Assets (list, drop with duplicates and non-videos, remove to _removed, replace keeps old), migration
  (dry run changes nothing, apply: files + database + song.json + backup, an old manifest re-renders
  frame-identical, next make uses the folder and the stored alignment, undo restores files and database).
  Cloud check in the browser on a copy of the old e2e workspace: banner -> Preview -> Migrate -> Assets
  (drop 3 files: 2 added, duplicate reported; remove) -> Generate (collection ticked from song.json) ->
  worker made 3 Reels (3 PASS) into songs\Life Lyrics\Hold On Tight (Acoustic)\exports\; then
  `pnpm songs:migrate --undo` from the command line.

### Step 6.2c-2a — Style tab, per-platform recipe, target length, Generate from the recipe ✅ (verified on the Windows PC: per-platform verse effect (YouTube cinematic-fade), Reels target length 90 s (1:37, clean ending), lock (pink padlock, Generate greyed), fonts with French accents, Generate from the recipe)
- B1 Style tab (song page: Assets / Style / Generate / Videos): every recipe field with its value and its
  source (Library default / Artist's brand / Artist's brand (Reels) / This song / This song (Reels)), Reset
  (back to inherited) and Lock; every change is checked and saved to song.json at once. Code:
  `packages/video/src/node/style.ts`, `apps/studio/src/components/style-tab.tsx`, `/api/songs/[id]/recipe`.
- B2 Per-platform values ("perPlatform" in song.json and brand.json, `per-platform.ts`) for the verse / hook
  effect + intensity, fonts, accent colour, section and length. Order for one platform: library -> artist ->
  artist (platform) -> song -> song (platform) -> run. Decision (review point 1): platforms.json is format
  only (size, length, safe zones, text scale, bitrate, fades) and never sets the style; an old "motion"
  entry there is ignored with a message. A locked field uses only the song's own values (default and
  per-platform) and blocks run tweaks (review point 2, tested); locking copies the per-platform values seen.
  pnpm make applies the values per platform and prints them (`reels: recipe verseEffect soft-blur:subtle (song:reels)`).
- B3 Target length per platform (`length`, `--length`, Generate "Target length"): shapes an "auto" section
  only: a target of that length with the preset's tolerance, hook-first start, ending after a complete line
  (preferably a chorus line), never cutting a sung line. Longer than the song: the whole song, said so.
  Not used for YouTube / Canvas (said so). A fixed section stays exactly as given; when it is longer than the
  platform allows: QA WARN "Length for the platform", not trimmed.
- B4 Generate opens with the resolved recipe: effect lists start on "From the recipe (glide · YouTube:
  cinematic-fade)", the recipe's platforms, chips with videos and length ("Reels · 3 videos · 90 s"),
  section, layout; only changes are sent (one-run tweaks); locked fields disabled; "Save these choices to
  the song" (never over a lock; the notice names what was saved and what a lock kept).
- B5 Fonts: bundled + WORKSPACE_DIR\fonts only, grouped; live preview line "Où es-tu, mon cœur ? L'été à
  côté de toi, ça change tout — ÉÈÇÀÔ" in the chosen font (served by `/api/fonts`); a font without
  é è ç à ô (or capitals) is marked "⚠ no French accents" with a warning naming the missing letters.
- B6 Effect hints in one format in every list ("glide · verses", "karaoke-highlight · hooks",
  "cinematic-fade · verses, slow songs", ...), the brand default marked; also in pnpm effects:preview.
- Fixes after the PC test: **Lock did not stick in the app.** Cause: leaving a field (e.g. the Reels
  length) saves it, and the whole Style tab was disabled while saving, so a padlock click right after was
  dropped; with no feedback a second click unlocked again (source "This song" with the reset arrow, padlock
  open, Generate not locked). Now changes are queued and saved in order (nothing is disabled, no click is
  lost), the padlock switches at once, and "Saving… / Saved to song.json" shows the state. Polish: "videos
  per platform" inputs wider with the preset's number ("3 (preset)"); "Platforms Generate starts with":
  nothing ticked = Generate starts with Reels + YouTube (and pnpm make without --platforms makes Standard),
  said under the boxes; Generate's effect lists show "From the recipe (glide)" with the per-platform values
  on a line underneath ("YouTube: cinematic-fade").
- Fix after verification: with a default target length, the Generate chips of YouTube and Canvas showed
  "90 s" although a length never applies to them; they keep "whole song" / "loop".
- Browser test in the repo: `pnpm test:e2e` (apps/studio/e2e/style-lock.e2e.ts; needs a studio build,
  FFmpeg and Playwright, as in the cloud check): types a Reels length and clicks the Hook effect padlock
  right away, then checks the icon (at once and after saving), song.json, Generate (Hook effect greyed
  out, Reels + YouTube preselected, the short recipe option and the per-platform line), the placeholders
  and the empty-platforms note, and unlocking.
- Also: the Assets tab shows the real song-folder path, clickable (Explorer); the Hints card shows timed
  lines + end marks (the empty stamp pnpm tap writes after the last line) and warns about tapped lines that
  match no line of lyrics.txt. Fix: bundled fonts are found from the project root (inside the studio's
  server bundle require.resolve gave a number, which crashed the song page).
- Tests (style.test.ts + updated make / platform tests): per-platform order and sources, preset never beats
  the brand (glide wins), locks with song:reels and blocked run tweaks, set / reset / lock per platform,
  song.json / brand.json checks, Style data and actions, fonts with the accent check (a real font without
  accents), Generate data and save-to-song, pnpm make per platform, target lengths (reels 45 s, tiktok 20 s,
  longer than the song -> whole song), a fixed section over the limit (QA WARN, not trimmed), --length,
  effect hints. Browser check: Style (per-platform rows, lock, fonts and warning, length), Generate
  (recipe option, locked hook effect, chips with length), Assets (path, hints).

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

### Lyrics tab: "Checked by ear" ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- On a low-confidence or flagged line: **Checked by ear** (click again to take it off). Stored with the
  song (.studio\lyrics\checked-by-ear.json) with the alignment, the words and the line's start.
- While those stay the same, QA turns that line's timing WARNs (low confidence, starts before the
  vocals, flagged for review) into a note: `line 40 "A heart for two": checked by ear` (the check passes).
  pnpm make prints "lyrics: line 40 checked by ear (Lyrics tab): its timing warnings are cleared" and the
  manifest records it (lyric_timings[].checked_by_ear).
- A new alignment, changed words or a new start (a nudge, a vocal-start move) makes it lapse: the tab
  shows "Checked by ear before, but its time changed since: check it again" and QA warns again.
- The summary counts "checked by ear"; checked lines leave "Show only lines to review".
- Tests: checked-by-ear.test.ts (holds / lapses; QA notes), lyrics-view.test.ts (set, lapses after a
  nudge, holds again at the same time, taken off), make.test.ts (pnpm make reads it, logs it, the manifest
  has it; another start: no longer), browser test (the 1:10 hook checked, unflagged, taken off, lapses
  after a nudge).

### Rule — Lyric Studio never alters the music ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **The song file is only read.** Readers: the song hash (finding the project), ffprobe (length, sample
  rate), librosa (BPM / beats), Demucs (vocal stem, written to workspace\cache\stems), the aligner,
  pnpm tap (playback), Remotion's media server (render), the Lyrics tab's ▶, the new QA comparison.
  Nothing writes into it: it is only copied into the song folder (New song), moved (migration) or moved
  to .studio\replaced\ when replaced in the Assets tab. (pnpm analyze --click writes a separate
  <song>_click.wav test file next to it, on request only; never used in videos.)
- **Stems are analysis only**: the vocal stem and the voice map are never in any output.
- **What happens to the audio in a render**: the song itself, cut to the section; a fade only where the
  music is cut (0.3 s in; out 0.5 s, Reels 0.12 s for the loop); **no fades at the song's own start or
  end any more** (whole-song YouTube videos had a 0.3 s fade-in and a 1.5 s fade-out on the song's own
  intro and ending: removed). AAC **320 kbps** (was 192) at **the master's own sample rate** (44.1 kHz
  stays 44.1 kHz: no resampling; platforms.json "audioSampleRate": 48000 forces 48 kHz, then it is
  resampled, said so). No volume, loudness normalisation, EQ, compression or limiting (Remotion mixes
  with amix normalize=0 and applies only the fade curve).
- **QA "Audio matches the song"**: the video's audio against the same section of the song file:
  length within 0.1 s, level within 0.5 dB outside the fades, loudness curve within 1 dB (a different
  part of the song or a shift shows up). The manifest records settings.audio.
- Tests: audio.test.ts (the plan: whole song without fades, a section with them, 48 kHz only on request;
  real FFmpeg files: the song cut/faded/AAC 320k passes with < 0.1 dB difference, -1 dB fails, a 2 s
  shift fails), render.test.ts (a real Remotion render: AAC ~320 kbps, audio matches its source),
  make.test.ts (real renders: the song file's hash and modification time are unchanged, the song
  folder's copy is byte for byte the same, QA audio check passes, 44.1 kHz kept).

### Textboard: the text layer as its own object ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **textboard.json** in the song folder (written by the Storyboard tab): an ordered list of cards (title,
  byline, tagline, then every lyric line, numbered as the Lyrics tab) and per card only what differs:
  place (lyric spot / under the title / top / upper / centre / lower, always inside the platform's safe
  area), size (0.5-2x), hold (seconds after the last word, never into the next line; title cards: shown
  this long), effect, font / weight / italic; title cards also their text and "shown". "roles": rules per
  kind of card (title, byline, tagline, verse, hook), e.g. hook lines 1.2x. Timing always comes from the
  alignment, hand times and the display rules (never aligned again). **Without textboard.json nothing
  changes**: the brand's defaults (YouTube title + artist as before, no title on vertical videos).
- After a lyrics change a card keeps its look when its words stay (also on a new number); a card whose
  words are gone is listed ("not used any more"), never silently dropped (pnpm make says so too).
- **Render**: the same planner (dry run = render, tested): a lyric card's place, size, effect and font go
  into the props of that line; the title / byline / tagline are text cards (the YouTube title is drawn
  exactly as before). QA measures a moved or resized card at its own place, size, font and effect.
- **Storyboard**: a Textboard row (title cards above the lyric cards; ✎ = its own look). Click a card:
  place, size, hold, effect (and text / shown for title cards) with a live preview of lyric cards before
  saving; Save plans again; "Reset this card". Buttons open the title, byline and tagline cards (also
  when hidden).
- **Templates**: "Save as template" keeps the design without the words (roles and the title cards' looks)
  in workspace\templates\<artist>\<name>.json (per artist: Life Lyrics, Pômé); per-line changes are not
  part of it (it says how many). "Apply template" on another song fills in its own title, byline, tagline
  and lyrics, whatever its number of lines.
- **Picture swap**: Storyboard → Pictures: plan the same textboard over another clip set (the song's own
  clips and / or collections; this plan only, nothing saved). An anchor whose clip is not in the set
  becomes a **slot**: the line is outlined in amber and listed "needs a clip (was 02_b.mp4)" until a clip is
  dragged onto it (also a QA "Story anchors" WARN "slot: line 4 … needs a clip"). **Generate → Picture
  versions** (2-4 clip sets) or `--pictures "song,wedding"`: one video per clip set with the same textboard,
  section and order (not together with font pairings or --resume).
- **Manifest** records textboard (file, hash, template, number of changes) and picture; the Videos tab's
  settings show "Textboard" (and the template) next to the song's textboard now, and "Picture versions".
- Tests: textboard.test.ts (cards, round-trip, bad values, sync after a lyrics change, template without the
  words applied to a song with 7 lines instead of 4, a card's look and its preview, title card timing),
  textboard-make.test.ts (overrides in the rendered props and fonts, a title card on Reels, the manifest,
  dry run = render; picture versions keep the text, use other clips and turn the missing anchor into a
  slot), make.test.ts (YouTube title as text cards), textboard.e2e.ts (card editor with live preview, save,
  title card, save / apply template, picture swap, slot filled by dragging a clip).

### Storyboard stage 2 + your four findings ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **1. Shot length** (recipe "shotLength": 1, 2, 4, 8 bars or "story"; brand.json, song.json, per platform;
  Style tab with source / Reset / Lock, Generate → Advanced, `--shot-length`). "story" = 2 bars on hooks,
  4 on verses and instrumentals, more bars when that is under 3 s, never a short last shot: a 90.8 s Reels
  cut at 92 BPM now has 12-20 shots instead of 51. Bars count from the bar the section starts on. In story
  order every clip is used once before any repeats (a round), pinned / anchored clips count in the round.
  The manifest records settings.shot_length.
- **2. Clip window**: a clip's first shot in a story video is centred on its best moment (the clip
  editor's, else the strongest 2 s by motion / colour / contrast, cached in
  workspace\cache\best-moments.json), inside its in / out; later shots of the same clip continue from there. An anchor
  without its own clipIn is also centred on the best moment (was: 0.0 s). Shuffle keeps its seeded offset.
- **3. Tempo**: `pnpm tempo:check "<song folder>"` prints the detected tempo, the likeliest other tempi with
  their ratio (x2/3 = a 3:2 error) and the downbeats. Style tab → Tempo (BPM): type it, ½ / ×2 / ×2/3 /
  ×3/2, a Tap test over the song (median of the gaps, after 4 taps), or "Check the tempo" (the same list,
  click one). Saved as song.json "tempo"; the analysis re-tracks the beats around it (half / double from
  the detected beats, other tempi tracked again, fine-tuned by at most 3%); pnpm make prints "tempo: X BPM
  (song.json "tempo" Y; detected Z)", the manifest records settings.tempo, and the storyboard plans with it
  (a past run's storyboard uses the tempo that run had). `--tempo 92` on the command line. I could not
  check your song here (it is only on your PC): please run tempo:check and send me its lines.
- **4. Loop warning**: the storyboard header shows WARN "Loop flows" with each failing point (e.g. "sound:
  level jump 15.4 dB at the loop point …") and target lengths whose end loops well from the same start
  (clean bar right after a complete line, 0.5-1.5x the target, beat + level + harmony pass; nearest to the
  target first), or says none exists.
- **Stage 2 (editing, plans only)**: the story strip (every clip of the run in story order) — drag a clip
  onto another or use the arrows → song folder `clips.json` "order" (file names stay the fallback); the
  clip editor (click a clip or a shot → Edit clip): in / out with "set here" from the playing clip, speed
  0.5-1x, best moment (always wins over the automatic one), "Whole clip, automatic"; drag a clip onto a
  lyric line → an anchor in song.json (another clip on the same line replaces it; "remove the anchor" on
  the shot). Every change re-plans at once; Generate renders exactly the plan shown.
- **Flaky Lyrics tab browser test fixed** (three causes, the last two real bugs): (1) after saving or
  restoring lyrics.txt the notice appeared before the page had reloaded; the reload then rebuilt the
  "earlier versions" list and closed it, so a click hit a hidden button: the notice now waits for the
  reload, the test for the list. (2) Two lyrics.txt saves in the same second gave their backups in
  .studio\replaced\ the same name, so the second overwrote the first (an earlier version was lost):
  now each gets its own ("<time>.2-lyrics.txt"). (3) Restore refused those new names: fixed. Before: 2 of
  6 runs failed; after (1) only, every run failed on (2)/(3) because the saves got faster; after all
  three: **20 of 20 runs passed**. The failing outputs are kept in the session's scratchpad.
- Tests: story-pace.test.ts (story pacing 12-20 shots, ≥ 3 s, 2 bars on hooks / 4 on verses, 1/2/4/8 bars,
  each clip once per round, clips.json rank, best-moment window inside in / out, speed; recipe, CLI and
  Generate checks), loop.test.ts (suggestions: only clean ends after a line in 0.5-1.5x that pass; a level
  jump is not suggested), storyboard-edit.test.ts (order persists in clips.json and re-plans, clip editor
  edits re-plan, drag-to-anchor, and after each: the rendered manifest's shots equal the plan's),
  test_analysis.py (tempo candidates name the 2/3 ratio), storyboard.e2e.ts (move / drag in the strip,
  kept after reload, clip editor, drag onto a line, the Style tab's ×2/3 re-plans at ~80 BPM).

### Storyboard — stage 1 (read-only) ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Song page → Storyboard**: choose "The plan now" (per platform of the recipe, v1, v2, …) or a past
  run, then Show. The plan is a dry run of the very planner Generate renders with (makeVideos with
  dryRun): nothing is rendered or written (no run folder, no section / job rows, no song.json or .lrc
  change) and it never aligns (a song needs its stored alignment: "make a video first"). Tested: a dry
  run's props are exactly the rendered manifest's props.
- **Rows**: the bars (numbered), hook sections shaded, the song's waveform, the lyric lines at their
  on-screen times (⚓ when a clip is anchored on them), the shots as thumbnail blocks with clip, length and
  in–out; badges ⚓ line, ★ best moment, ◐ dissolve, speed when slowed, ↻ the Reels loop ending; a warning
  border and icon for choppy slow motion (< 0.75x), a clip too short (last frame held), anchor
  conflicts, the same clip within 3 shots. Click a shot for its details; anchors outside the section are
  listed; the planner's warnings below.
- **Best moment**: the strongest 2 s of each clip by motion, colour and contrast (as the Spotify Canvas
  picks them), cached in workspace\cache\best-moments.json. A best moment set in the clip editor (stage 2)
  always wins.
- **Preview**: a low-res Player of the same composition next to the timeline; clicking the timeline plays
  from that point (the playhead follows).
- Built so the studio never bundles the render code: the storyboard is planned in a child process
  (packages/video/scripts/storyboard.ts, as /preview already does).
- Tests: storyboard.test.ts (shot places, in / out, speed, badges, every warning, the loop ending, lines with
  anchors, hook sections, waveform), make.test.ts (the dry run equals the rendered manifests and makes
  nothing; a past run's storyboard with thumbnails, lines, bars and waveform), storyboard.e2e.ts (the tab:
  the plan, bars, waveform, hooks, ⚓ on line 4 and its shot with the dissolve, the outside anchor, the loop
  shot, shot details, play from a click, no run folder).

### Font pairings + font weight / italic ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Weight and italic** for the verse and hook fonts: recipe fields verseWeight / hookWeight (100-900) and
  verseItalic / hookItalic, in brand.json (verseFont / hookFont / titleFont: weight, italic), song.json and
  per platform, with sources, Reset and Lock. The exact weight / italic file is used; when the family lacks
  it, the nearest weight (upright without an italic) with a warning ("hook font Great Vibes has no italic:
  upright used (never a synthetic italic)"), printed by pnpm make. Text is drawn with font-synthesis: none.
  CLI: --weight, --hook-weight, --italic, --hook-italic. The recipe's weight now applies to every variation
  (before, Bold used the style's 900 = Cormorant 700; now the brand's 600 everywhere).
- **Bundled fonts**: Great Vibes, EB Garamond, Spline Sans, Space Mono, Bitter, Grand Hotel, Lato, Abril
  Fatface, Poppins, Arima, Mulish, Noto Sans JP, Noto Serif JP added (Cormorant Garamond, Playfair Display
  and Special Elite were bundled already, with all the faces asked for). Licences: fonts/LICENSES.md (OFL;
  Special Elite and Yellowtail Apache 2.0), each package keeps its LICENSE. Noto JP: ~120 pieces per
  weight, a video loads only those its lyrics use. Your own fonts: D:\videomaker\workspace\fonts
  (shown in the Style tab).
- **Pairings** (presets/font-pairings.json): Current brand (the artist's brand.json), Elegant (try this),
  Dramatic, Romantic script, Literary, Typewriter story (title Special Elite), Vintage romance, Bold
  statement, Gentle; checked on load (a font or weight that does not exist is named).
- **Style tab**: a Pairings row above the font fields: each card previews the pair together on this song's
  own verse and hook line, as the video draws them (PairPreview composition: the same layout, size, weight,
  italic, shadow and karaoke accent), over a frame of the song's clips (or the cover); warnings per card
  (French accents, characters the song uses, contrast over the frame, thin script on long hooks, the
  pair's own note); "This song" (locks kept and named), "Back to the brand", "Save to brand…" (asks
  first). Weight (only the family's weights, 300-800) and italic controls right under each font, the font
  preview line follows them; the folder for your own fonts is shown.
- **Compare by rendering**: Generate's "Compare font pairings" (tick 2-3) / pnpm make --pairings
  elegant,dramatic: one video per pairing with the same section, clips, order and style; the manifest
  records settings.fonts (family, weight, italic, pairing); the QA title names the pairing.
- Tests: pairings.test.ts (exact / nearest with warnings; styles carry weight and italic; song.json and
  perPlatform checks; every requested family bundled with its faces and the accents; Japanese; the
  presets file; card warnings; apply / reset / locks / Save to brand; the cards' data), make.test.ts (a
  real run comparing Elegant and Dramatic: same shots, fonts recorded), pairings.e2e.ts (cards with both
  lines over a clip frame, the italic 600 file loaded, apply writes song.json not brand.json, weight
  options, Save to brand asks first, Generate offers up to 3).

### Story anchors — part (b): the Lyrics tab and the Videos tab ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Lyrics tab, "Lands on" column**: per line the anchored clip (thumbnail, name, cut / dissolve, from
  N s) with Remove, and "Lands on…" / "Change": an inline picker with the thumbnails of the song's own
  clips and of its collections (song.json collections, else the remembered one), "Start in the clip at"
  (clipIn, seconds) and Transition (cut on the downbeat / dissolve ~1 bar); it warns at once when the
  clip is shorter than the line ("it will be slowed to cover the line (QA warns)"). Saved to song.json
  at once (every other setting kept; one anchor per line).
- Each line shows what will clash, named: a clip shorter than its line (slowed to …x), two anchors in
  one bar, the same clip twice within 8 s, a clip that is not among the song's clips or collections.
  The same rules as pnpm make (per platform the section can add "not in this section").
- "Gaps between them": story order in every video (the default with anchors) / shuffled (v1 story, the
  others shuffled), saved as song.json gapOrder.
- **Videos tab**: each run's settings have a "Story anchors" row: "line 9 → hands.mp4 (0:41.0,
  dissolve), …; not in this video: line 31 (sea.mp4)", marked when song.json's anchors differ now.
- Anchor line numbers are the Lyrics tab's (sung lines counted, blank lines not), as check-start and
  hints.lrc use.
- Tests: lyrics-view.test.ts (saved in song.json with the other settings kept, the clips with thumbnails,
  the conflicts, the Videos text), lyrics-tab.e2e.ts (pick line 3 -> 02_rings.mp4 with a dissolve from the
  thumbnails, song.json checked; a 1 s clip on line 2 is named as slowed; Remove; the gap order).

### Story anchors — part (a): rules and pnpm make ✅ (part (b): the Lyrics tab and Videos tab)
A clip "lands on" a lyric line: song.json `anchors: [{ "line": 9, "clip": "hands.mp4", "clipIn": 1.5, "transition": "dissolve" }]`
(the line by its number in the Lyrics tab, sung lines counted as in check-start: the same chorus can land on different clips as the video goes on).
- **Cut** (src/anchors.ts): on the downbeat at or just before the line's on-screen time (2 frames early,
  as every cut), held until at least the line's sung end; the next cut is the first regular cut after
  that. Anchors win over the regular cut rate; regular beat cuts fill the gaps. clipIn: where the clip starts.
- **Gaps in story order** (file-name order) in every video, with the other clips (all clips when fewer
  than 4 are left); an anchored clip never within 3 shots of its anchor. song.json `gapOrder`: "story"
  (the default when the song has anchors) or "shuffle" (as before: v1 story, the others shuffled).
  Story videos differ by style, cut rate (the run's, the run's, one coarser, one finer) and cut / dissolve
  (the anchors' own, all dissolve, the anchors' own, all cut).
- **Dissolve**: ~1 bar centred on the downbeat (at most half of either shot; the previous clip keeps
  playing under it while it has frames), in the composition, so preview and render are the same.
- **Per platform**: only anchors inside the section are used, the others listed ("not in this section:
  line 31 (hands.mp4)"). Auto prefers, among the clean line ends inside the tolerance (chorus first; on a
  loop platform the ends that loop well), the one keeping the most anchors: "; anchors: keeps 3 of 3,
  more than 0:36.5 keeps 2". Hook-first, the musical ending and never cutting a sung line come first.
- **Conflicts, never dropped silently** (QA "Story anchors", WARN, naming the lines): two anchors in one
  bar (the second cuts in on a beat, or is not shown when no beat is left: said so); an anchored clip that
  cannot stay until its line ends; the same clip anchored twice within 8 s; a line or clip not found;
  **every clip slowed to cover its line** (naming the clip). pins.txt keeps working; an anchor wins on the
  same shot and QA says so (a note).
- pnpm make prints one line per anchor ("reels: anchor line 9 "…" -> hands.mp4: at 0:41.0 (dissolve)");
  the manifest has `anchors` (used, shot, time, transition, why, playback rate; conflicts; notes) and
  settings.gap_order / transitions / the video's own cut_rate. --resume compares each video with its own cuts.
- Tests: anchors.test.ts (anchors on downbeats; gap filling in story order with clipIn; shuffled gaps keep
  the anchored clip away; a 90 s Reel vs a 25 s TikTok of the same song; anchors in one bar, no beat left,
  the same clip twice, a short clip slowed; dissolve per anchor or per video; anchor beats pin; the
  Lyrics-tab checks; song.json checks; auto end keeping more anchors; QA; story variations),
  make.test.ts (a real run with anchors in song.json).
- Known issue (2026-10-28): the Lyrics tab browser test failed one check once in a full run and passed 5
  reruns (also in the same order); its output was not kept. Probably a timing race; watch for it.
- Known issue (found while building this): QA and the manifest name lines by their row in lyrics.txt
  (blank lines counted), the Lyrics tab, check-start and anchors by sung line. They differ when
  lyrics.txt has blank lines; to be unified (proposal: the Lyrics tab's numbers everywhere).

### Tuning — a long first word is a strong signal ✅ (verified by the user on the Windows PC, 30 Oct 2026)
From the check-start results on A Heart For Two (lines 13 and 27: stamp ~2.4 s early, voice and words
0.4-0.5 s apart, so the 0.3 s rule left them flagged).
- A first word of **2 s or more** with **voice and words both later than the stamp and within 0.6 s of
  each other** moves the line to the recognised-words time ("the first word lasts 2.4 s and voice and
  words agree within 0.4 s that it starts later (moved to the recognised words)"). All other cases keep
  the 0.3 s rule. Not on the last line (a held note): line 40 stays flagged. Lines set by hand keep priority.
- Lines whose first word lasts 2 s or more (was 2.5 s) are checked by default.
- Tests: vocal-guard.test.ts (lines 13 1:11.4 -> 1:13.5 and 27 2:31.5 -> 2:33.3 moved; line 40 flagged;
  a hand-set line untouched; a short first word with voice and words 0.5 s apart still flagged).

### Loop check — "Loop flows" for Reels, TikTok, Shorts ✅ (verified by the user on the Windows PC, 30 Oct 2026)
These platforms play a video in a loop, so the wrap-around from the last frame to the first is checked.
- **QA "Loop flows"** (src/loop.ts), five points; a failing point names its cause:
  - beat: the length is a whole number of bars at the song's BPM (within 50 ms), e.g. "length 30.3 s
    is 0.3 s off a whole bar (15.15 bars at 120 BPM, 0.6 beats over; ...)";
  - phrase: it ends after a complete line and starts at most one bar before a sung line;
  - sound: the music's last 100 ms against its first 100 ms (measured on the song's own section, which
    the video carries unchanged; the fades sit in between): WARN above 3 dB;
  - harmony: a 12-note chroma of the last and the first bar, each matched against the 24 major/minor
    keys; WARN when no key fits both (best shared fit below 0.15: a key change). Ordinary chord changes
    (I-V, i-V, I-ii) fit at 0.3-0.5, a chord a tritone away at -0.07;
  - picture: WARN when the first and last shot are the same clip, except the Reels loop ending (the
    last shot plays the frames just before the first shot's, so the motion carries on).
  When all flow, one line says what was measured.
- **Loop-aware auto end**: of the clean line ends inside the length tolerance (chorus lines still
  first, never cutting a sung line), the one whose last bar flows best back into the first (whole bars,
  level, harmony) wins; a small share of the distance to the target breaks near-ties. The reason says it:
  "; loop: 0:36.5 flows best back into the start (whole bars, level jump 0.5 dB, harmony 0.87); also
  clean: 0:40.5 (whole bars, level jump 6.8 dB, harmony 0.86)".
- **Shot order**: shuffle never puts the first shot's clip on the last shot. A Reels loop ending whose
  first clip is too short to continue now gets another clip at the end (it used to show the same clip
  restarting).
- **Manifest**: `loop` (all five points, length in bars, beat offset, levels, harmony, first/last clip);
  `{ checked: false, why }` for YouTube (no loop) and the Canvas (its own loop checks).
- platforms.json: `"loops": true` on reels, tiktok and shorts (also the default for vertical presets
  with a loop ending or hook-first).
- Tests: loop.test.ts (a clean loop passes; 0.3 s off a whole bar; a 6 dB level jump at the end; the
  same clip first and last, and the Reels continuation that passes; a harmony clash C -> F#; phrase cut;
  the end choice preferring the better loop and saying why; shuffle first != last over 300 seeds).

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

### Step C — Pro assessment, reactions, better Canvas ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Pro assessment** (src/assess.ts): each video gets ✅ Ready to post / 🟡 Good — N things to improve /
  🔴 Not ready — fix N things first, with at most 3 points in plain words and the creative action for each,
  "Handled by the app" (pacing, transitions, ending) and the technical checks one click away. Videos tab:
  replaces the PASS/WARN badge; "★ strongest" on the clearly best video of a run. Storyboard header: the
  same, predicted from the plan. It learns: a point you approved videos with twice stops counting.
- **Reactions** ("React" under each video): cuts too fast / too slow, too many dissolves, more dreamy,
  ending too abrupt, lyrics hard to read, too repetitive, love this one; on a Storyboard shot: this clip
  doesn't fit here. Each says "Next run: …" first, then applies to this song or all your songs; every change
  is a normal recipe setting (Style tab, Reset undoes it). New settings behind them: Pace adjustment (bars)
  and Lyric readability (strong = a soft dark band behind the lyrics).
- **Better Canvas**: the longest loop first, slowed gently (>= 0.75x) rather than dropping to 3 s (6 s
  clips: 3 bars at 0.92x instead of 2 bars); "Use for Canvas (from here)" in the clip editor chooses the
  clip and moment; the assessment says "Add a vertical clip of at least N s" when a longer loop was possible.
- Tests: assess.test.ts, reactions.test.ts (real plans with the stand-in renderer), make test (Canvas);
  browser tests: verdict on the tile, a reaction applied to song.json, the Storyboard's prediction.

### Step B — Automatic pacing and transitions ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Pacing** (Shot length "auto", the new default): the app reads the song's feel from how densely it is
  sung (calm / mid-paced / driving; the tempo alone misleads: ballads are often tracked at 130+ BPM) and the
  clips' usable length, and picks whole-bar shots for verses and hooks that the clips can fill without
  choppy slow motion (never planned below 0.8x). E.g. a calm song with ~5 s clips: 3 bars (5.3 s) on
  verses, 2 on hooks. 1/2/4/8 bars, story and the cut rate stay available as overrides; `--rate` on the
  command line still uses the cut rate.
- **Transitions** (recipe "Transitions": auto / crisp / flowing): cuts on the hooks; calm songs dissolve
  (about half a bar) in the verses and quiet passages; mid-paced songs dissolve where nobody sings; a short
  dip to black where a verse opens into a chorus; driving songs cut. Anchors keep their own; per clip
  "Comes in with: auto / cut / dissolve" in the Storyboard clip editor (clips.json "transition").
- **Loop picture**: when the first clip cannot also fill the last shot, the last 0.4-1 s fade into the
  first shot's opening frames, so the Reel loops invisibly; the "no seamless loop ending" warning is gone.
- **Endings**: a soft fade may start in the tail of a held last note (never on the words): longer fades
  where the room after the last word is short. A tight loop now needs a clear level margin (the worst
  jump within a frame either side, under 2.25 dB) so QA always agrees (Love Is A Good Thing: the ending
  said "tight loop" at 2.6 dB, QA measured 3.9 dB on the frames). Loop suggestions never repeat the
  current end.
- Storyboard header: "Pacing: …" and "Transitions: …" lines in plain words; ● dip / ◐ dissolve badges.
- Tests: packages/video/test/pace-transitions.test.ts, ending.test.ts (margin, held note, suggestions);
  Storyboard browser test (pacing and transitions lines, the preview plays the end without errors).

### Step A — Automatic endings (Reels, TikTok, Shorts) ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- The app now chooses how a loop video's music ends, from the music at the end of the section
  (src/ending.ts): a **tight loop** (cut on the bar, the platform's short fade) only when the last bar
  flows back into the first (whole bars, level within 3 dB, keys fit); otherwise a **soft fade** over the
  room after the last sung word (up to one bar, max 3 s); with little room, a **ring-out**: the last chord
  sounds one more bar (the next detected bar line, not sung, within the platform's length) and fades.
  At the song's own end: no fade. Whole bars kept, no sung line cut, the music itself never changed.
- Fixes the abrupt stop on The House My Heart Built (loud chorus -16.7 dB into the quiet pickup -32.3 dB
  with a 0.12 s fade): now a soft fade or ring-out.
- Storyboard header: one plain line, e.g. "Ending: a soft fade over the last 1.8 s — the end is loud and
  the start quiet, so the loop starts the song again gently". pnpm make prints it; manifest settings.ending.
- QA "Loop flows": with a fade / ring-out the level jump or key change is a note ("softened by a 1.8 s
  fade"), not a WARN.
- Loop suggestions never drop a chorus line or the title line the plan has (no more 84 s ending before
  "This is the house that my heart built").
- Override (optional): Style tab "Ending (Reels, TikTok, Shorts)": auto / tight loop / soft fade /
  ring-out, per platform; `pnpm make --ending fade`.
- Tests: packages/video/test/ending.test.ts (each ending, whole bars, limits, overrides, the title line, suggestions,
  QA); make test; Style and Storyboard browser tests.

### Storyboard: "Follow playback" ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- A "Follow playback" checkbox next to Zoom (off by default, remembered in this browser): while the
  preview plays, the timeline (bars, waveform, lines, shots) scrolls so the playhead stays a third from
  the left. Scrolling the timeline by hand stops it until the next play; clicking still plays from there.
- Pure helper `followScrollLeft` (packages/video/src/follow.ts) with tests; browser test: off by default,
  no scrolling when off, scrolls when on, remembered.

### Fix — Loop beat check counts the song's own bars ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- "Loop flows" used to divide the video's length by a bar length from the song's average BPM. Real songs drift a little, so a loop of exactly 51 bars could be reported as "51.14 bars, 0.25 s off".
- Now the check counts the song's detected bars (the same downbeats the section snaps to): when the start and the end are each within 50 ms of a detected bar line, it is whole bars, and the message shows the section's own average BPM ("90.8 s = 51 bars (on the song's detected bars, avg 134.8 BPM)").
- When an end is not on a bar line, the message says how far from the nearest one it is. A video whose length does not match its section is still a beat failure.
- The auto end choice and the storyboard's "better loops" hint use the same bar counting, so ends that sit on a detected bar are no longer rejected. Without downbeats the old average-BPM division is used.

### Fix — Start always runs the current code ✅ (verified by the user on the Windows PC, 30 Oct 2026)
Reported: after `git pull` (1e233c0) the app did not show the Lyrics tab, and Start printed nothing.
- **Cause**: an older Lyric Studio was still answering on port 3000, so Start only opened the window
  (it checked "is something running?", not "is it the current code?"). Most likely Stop had not ended
  the background process that, since 6.2c-2b, restarts a stopped part on its own: the studio was killed
  and came back 3 s later with the old build.
- **Start** now compares the code version (git commit + local changes) with the build that is running
  (/api/health reports it): an older build is stopped and started again, which builds the new code
  first. It prints each step and ends with "Lyric Studio is ready (commit …)".
- **Stop** ends the whole background process (its process id is in logs\lyric-studio.pid) with
  everything under it, so nothing restarts itself, and waits until ports 3000 and 8001 are free.
- **`pnpm app:rebuild`**: a clean rebuild by hand (removes apps\studio\.next, builds, stamps the commit).
- pnpm app:serve says why it builds ("the code changed since the last build (built from …, the code is
  now …)") or that the build is up to date.

### Step 5c.2 — Lyrics tab ✅ (verified by the user on the Windows PC, 30 Oct 2026)
First real case: A Heart For Two ~1:10, the hook "You had a heart for two" whose karaoke highlight came
1-2 s early.
- **Lyrics tab** (song page, after Assets): every line with its time stamp (the stored alignment), where
  it starts now (moved by the vocal-start check, or set by hand), **what the viewer sees** (fades in /
  readable / leaves, computed by the same code as the render: lead-in, gaps), confidence. Lines flagged
  for review (with the reason) and low-confidence lines are highlighted; "Show only lines to review".
- **Nudges** −0.5 / −0.1 / +0.1 / +0.5 s per line, **▶** plays 3 s from 1 s before the line, Undo, Reset
  line, **Save**: the changed lines go into hints.lrc as hand-set lines ("[01:10.00]! #2 You had a heart
  for two"). The aligner never sees those lines, so the stored alignment is kept (no re-alignment);
  pnpm make applies them ("lyrics: line 2 set by hand: starts at 1:10.0 (was 1:08.5; Lyrics tab,
  hints.lrc)") and the vocal-start check leaves them alone. The old hints.lrc is kept in .studio\replaced\.
- **lyrics.txt editor**: label lines ([Chorus], "Verse 1:", "Chorus"), repeat marks ((x2)), credits
  ("Written by", ©) and the song title at the top (when it is not sung again) are flagged, with "Remove
  these lines". Saving keeps the old lyrics.txt in .studio\replaced\ and warns first when words change
  (the next video aligns again; hook markers and blank lines alone do not). Earlier versions: Restore.
- The song file itself is now served to the app (for ▶ only; .studio, the database and other files stay
  private).
- Tests: hand-times.test.ts (adding / replacing / removing hand-set lines leaves the taps byte for byte,
  also without a last newline or with CRLF; whole-line move and squeeze; ignored with a message when the
  text changed or the order is wrong; the aligner gets only the taps and the stored alignment is reused; a
  hints.lrc with only hand-set lines = no hints), lyrics-view.test.ts (the 1:10 hook: flagged, nudged
  +1.5 s, readable 1:09.77, reset; label lines; text edits with re-align flag, restore), browser test
  lyrics-tab.e2e.ts (part of pnpm test:e2e: the same case in the app, the song plays, the label removed
  with the warning first, restore).

### Step 5c.1d — Hook lines always checked, `--all`, previous line's voice ✅ (verified by the user on the Windows PC, 30 Oct 2026)
Test result on the PC: "almost perfect". One glitch: A Heart For Two ~1:10, hook "You had a heart for
two": the pink karaoke highlight starts on "You" 1-2 s before it is sung (an early stamp); that line was
not among the checked lines.
- **Every hook line is checked** by pnpm make (with the same three signals and rules), since an early
  karaoke highlight is very visible. `pnpm lyrics:check-start "<song folder>" --all` checks every line.
- **Bug found with this case**: when an early stamp sits right after the previous line's singing, the
  tail of that singing counted as this line's voice, so the voice "agreed" with the early stamp. The
  previous line's own singing (the stretch its last word is in) now never counts; a line sung on without
  any pause gets no voice signal (instead of the next phrase).
- Tests: the 1:10 hook (stamp 1.5 s early, right after the previous line: moved on voice + words), not
  a hook -> not checked by default but with --all, a line sung on without a pause.

### Step 5c.1c — Vocal-start check: no move on one signal, flags for review ✅ (verified by the user on the Windows PC, 30 Oct 2026)
From check-start on the PC. A Heart For Two: line 1 0:12.4 -> 0:21.0 (words + 9.9 s first word, right);
lines 14 and 28 "And a place" moved -2.0 s on the recognised words alone (wrong to move); line 40 moved
+3.0 s on a 3.4 s first word alone (wrong to move). Love Is A Good Thing: nothing moved, but line 39
"The old ones" (voice and words agree 1.3 s later) was kept because that point is inside line 38.
- **Rules now**: the aligner's stamp is a signal; word durations count only for a stretched first word.
  A move needs two signals within 0.3 s. Exception: a first word of 4 s or more and the recognised
  words within 1.0 s of the word-duration estimate -> moved to the recognised words (line 1).
  A single disagreeing signal keeps the stamp and **flags the line for review**: printed as
  "FLAGGED FOR REVIEW: line …", listed at the end ("2 line(s) flagged for review … line 14, 28"), a QA
  WARN "Line starts to review" on each video, and kept for the Lyrics tab. A stretched first word on a
  hook or the last line may be a held note: flagged, never moved on that alone.
- **Not flagged when invisible**: a disagreement smaller than the brand's lead-in (motion.gapLeadInS,
  1 s) cannot be seen (the line is on screen that long before it is sung): plain "in time" with the
  reason "less than the 1.0 s lead-in, not visible" (Love Is A Good Thing lines 15, 17, 22, 34 at 0.4-0.8 s).
- **Later start inside the previous line** (line 39): when two signals agree, line 38's end is shortened
  to the new start (its last note was held too long) and line 39 moves; earlier starts are flagged.
- **Why the voice was 23 s late on line 14**: the voice signal only counts singing louder than 15 dB under
  the song's typical singing level for 0.5 s. If "And a place" is sung softly (or is quieter on the vocal
  track), nothing there reaches that level, so the next voice found is the next loud phrase, 23 s
  later. The printout now shows the vocal track's level at the stamp next to the voice level ("vocal
  track at the stamp: up to -31.0 dB, under the voice level -29.0 dB"), so the next run confirms it; and
  since a move needs two signals, a wrong voice value can no longer move a line. Short pauses between
  sung words (up to 0.25 s, was 0.15 s) no longer split the voice.
- Tests: the user's results rebuilt as cases (line 1 moved to the words; "And a place" flagged with the
  voice 23 s late because the passage is under the voice level; line 40 a held note on a hook, flagged;
  only line 1 moves), Love Is A Good Thing (nothing moves; line 39 moves and line 38 is shortened; an
  earlier start inside the previous line is flagged), one signal alone never moves, the flagged printout
  and summary, QA "Line starts to review".

### Step 5c.1b — Vocal-start check: three signals, always printed ✅ (verified by the user on the Windows PC, 30 Oct 2026)
Reported: on A Heart For Two the check ran but printed nothing and line 1 stayed ~10 s early.
- **Why it did not fire**: "voice" was anything within 20 dB of the loudest 5% of the vocal track, for
  0.12 s. Instrument bleed in the Demucs vocal track (and breaths, a hum) passes that easily, so the voice
  seemed to be there from 0:00, line 1 looked in time, nothing was moved and nothing printed (and QA saw
  no early line either).
- **Acceptance rule** (in CLAUDE.md): the first sung word of every song, and the first word after every
  long instrumental, placed right by default (within ~0.3 s) with no manual fix.
- **Three signals** for line 1, lines after a long instrumental and lines with a stretched first word:
  (a) voice: sustained voice (>= 0.5 s) no more than 15 dB under the song's own singing level (measured
  on the aligned lines); (b) words: a short speech-recognition pass (faster-whisper "small", part of the
  AI packages) on the vocal track, only around those lines, matched against the line's first words;
  (c) word durations: WhisperX's own first word, when it lasts seconds (A Heart For Two: ~10 s to the
  second word), points to the singing-level energy just before the second word. The line starts where
  two agree within 0.3 s; when none agree the recognised words decide (then the stretched word, then a
  clearly early stamp moves to the voice). Moves of more than 0.3 s, never onto the next line.
- **Always printed** per checked line (and in the manifest, lyrics.vocal_check): stamp, voice, words,
  word durations, decision, which signals agreed and why; plus "guard: line N moved from … to …".
- `pnpm lyrics:check-start "<song folder>"`: the same check without making videos.
- The voice map is now the vocal track's level every 20 ms (voice-<hash>.v2.json, read again once from
  the cached stem, no Demucs); the recognised words are cached (words-<key>.json).
- Tests: built from this case (bleed, breaths and a hum in the intro; 10 s early with loud bleed; the
  whole line early with normal word lengths; the line after a solo), Love Is A Good Thing-like in-time
  case (nothing moves), word matching (punctuation, apostrophes, a missed "I"), never past the next line,
  windows for the speech recognition, the printout; Python: level map and the windows of the speech
  recognition (stand-in model). The real model runs only on the PC.

### Step 6.2c-2b — Videos settings, Post tab, Tasks "Clear finished" ✅ (verified by the user on the Windows PC, 30 Oct 2026)
- **Videos**: each run has a "settings" line: per platform what it was made with (verse / hook effect,
  fonts, accent, collections, section with its times and length, YouTube layout; read from its
  manifests, "not recorded" for what older runs did not store), with what differs from the recipe now
  marked ("now: glide"). New manifests also record the collections and the target length.
- **Use these settings** opens Generate with that run's platforms, videos per platform, effects,
  collections, YouTube layout and section. An auto section comes back as the exact times that run used,
  shown as "0:34–1:06 (from that run)", with **Switch to auto · 32 s** (its target length) one click
  away; a fixed section exactly as it was. Locked settings stay the recipe's; "Back to the recipe".
- **Post tab**: only approved videos (generated and discarded ones are left out), per platform, newest
  first; each with the video to play, caption + hashtags per artist and platform (YouTube: title,
  description, tags), downloads and Open folder. Nothing is posted automatically. Approving in Videos
  updates the Post tab at once.
- **Tasks → Clear finished**: done, failed and "cancelled before it started" go at once; a stopped or
  interrupted task that can still Resume stays unless confirmed ("1 stopped task can still resume —
  clear it too?"); running and queued are never cleared; only the list entry is hidden (database column
  make_run.cleared_at, migration 0006), never a video or a file. Auto-tidy stays at 24 hours.
- **Brand**: `pnpm brand:set youtube verseEffect cinematic-fade` sets a per-platform value in the
  artist's brand.json (checked; a bad value puts the old file back) and removes the identical, unlocked
  song-level overrides of that artist's songs (Love Is A Good Thing's own YouTube value); songs with a
  different value keep it.
- **"Failed to fetch" in Generate**: now "Lyric Studio's server isn't responding — restart it with
  Start Lyric Studio.cmd", everywhere in the app (the cause goes to the browser console). Why the
  server stopped: the launcher ran studio, worker and audio service with "kill the others when one
  exits", so when the worker or the audio service stopped (e.g. a crash or Ctrl+C in its window), the
  studio was shut down with it; and the next start overwrote the log, so the reason was lost. Now each
  process restarts on its own (up to 5 times, 3 s apart), every log line has its time and the process
  name, and the previous log is kept as logs\lyric-studio.previous.log. If it happens again, send both.
- Tests: run-settings.test.ts (new and old manifests, comparison, Use these settings with the exact
  section and target length, fixed section, approved list, Clear finished rules incl. files untouched
  and the 24-hour window, brand:set tidy / keep / bad value); browser test videos-post.e2e.ts (part of
  `pnpm test:e2e`): settings and differences, Use these settings, Switch to auto, Post empty then the
  approved video only with its caption, Clear finished with the question.

### Step 5c.1 — Lyric timing: vocal-start guard and the gap display rule ✅ (verified by the user on the Windows PC, 30 Oct 2026)
Reported on A Heart For Two (YouTube, whole song): line 1 appeared several seconds before it is sung; the
rest was in sync.
- **Cause: the aligner, not the display.** The composition never shows line 1 early by itself: the
  first line has no line before it, so it is never shown as the waiting "next line" during the intro;
  it comes in ~0.75 s before its stamp. So its stamp in the stored alignment was early: WhisperX
  stretched it (most likely its first word) back into the instrumental intro.
- Why the existing hints could not fix it reliably: --hint only moves lines below 0.7 confidence (line 1
  was not flagged), and a hints file with only line 1 cancels itself (each tap is corrected by the
  typical offset between taps and alignment, which then equals line 1's own error).
- **Vocal-start guard** in pnpm make, a post-process on the stored alignment (no re-alignment, no store
  version change; a full re-alignment stays opt-in with --realign): line 1, and every line after an
  instrumental gap (>= 4 s of silence on the vocal stem: bridge, solo), that starts more than 1 s before
  the voice moves to where the voice starts. Words already in the voice keep their times, the early
  ones are spread up to them; a line wholly before the voice moves as a whole; never onto the next line.
  - Where the voice is: services/audio voice_map from the cached Demucs vocal stem (Demucs only if it is
    not cached, never WhisperX), cached per song in .studio/lyrics/voice-<song hash>.json (one Python
    call per song, then none). No vocal track and no AI packages: skipped with a warning.
  - pnpm make still prints "lyrics: using the stored alignment …", then one line per change:
    "guard: line 1 moved from 0:03.2 to 0:11.8 (vocals start)". Recorded in
    .studio/lyrics/guard-<lrc hash>.json and in each manifest (lyrics.vocal_guard); the stored LRC is
    never changed. The .srt, the clean .lrc and the lyric lines in the database use the moved times.
- **QA "Lines start with the vocals"**: WARN "line N "…" starts long before the vocals (5.4 s early)"
  for any line still more than 1 s before its voice (also lines the guard does not move, e.g. inside a
  verse). Older videos: no value, no warning.
- **Display rule (2a)**: during an instrumental gap longer than brand.json motion.gapHideS (default 3 s;
  from the last sung word, or the section start, to the next first word) no lyric is shown at all, not
  even the waiting next line; the next line fades in motion.gapLeadInS (default 1 s) before its first
  sung word and is settled at its usual time (0.25 s before the stamp). Old manifests keep their timing.
- Tests: vocal-guard.test.ts (line 1 in the intro, a line after a solo, a verse line left alone, never
  past the next line, hand-placed lines skipped; pnpm make reuses the stored alignment, logs and records
  each move, runs the voice map once; skipped with a warning when there is no vocal track),
  test_voice_map.py (stretches from the cached stem, clicks ignored), effects.test.ts (nothing on screen
  in the intro and the solo for every effect, fade-in during the lead-in, settled on time; short gaps
  and old manifests unchanged), QA and brand.json checks.
- Line 40 "A heart for two" at 0.36 confidence: low confidence is a "listen to this" flag, not proof it is
  wrong; the lyrics view (5c.2) makes checking and nudging it easy.

## Verification pass, 30 Oct 2026 (done)

### Verification checklist (item 1)
Use two songs: one with vocals (e.g. A Heart For Two) and the instrumental (Tea with the Monk). Note per
point: OK, or what happened (screenshot welcome). Unverified steps covered: 5c.1–5c.1d, 5c.2, 5g.2b, 5g.3,
5g.3b, 6.2a, 6.2b, 6.2c-2b, B, C, D, E, F, G.
1. **Start:** Start Lyric Studio.cmd rebuilds and opens the app; the header shows Library, Collections, Tasks.
2. **Collections (F, G):** add clips, remove and restore one; rename a collection and back; delete and restore
   one; the "Same clips as" flag on Test.
3. **Lyrics (5c.1–5c.2):** first line and the line after the solo start with the voice; flagged lines are
   highlighted with a reason; ▶ plays, a nudge + Save works; "Checked by ear" clears the point.
4. **Generate (6.2b):** Reels + TikTok + Shorts + YouTube + Canvas in one run; Tasks shows progress; Stop
   after the current video, then Resume finishes the run.
5. **Pacing, transitions, endings (B, A):** the Storyboard header's Pacing / Transitions / Ending lines make
   sense; the Reels ending no longer stops dead; dissolves feel right on a calm song.
6. **Assessment and reactions (C):** each video has a verdict with at most 3 plain points; a reaction
   ("cuts too fast") shows "Next run: …" and the next run changes accordingly.
7. **Title opening (D):** on for Reels: title + tagline on the thirds, gone when the first lyric fades in;
   cover.jpg downloadable.
8. **Instrumental (E):** Tea with the Monk with a story.txt: sentences on bars, readable, the Reel starts at a
   strong stretch of music.
9. **YouTube and Canvas (5g.2b, 5g.3, 5g.3b):** YouTube cover layout, end-screen area clear in the last
   seconds, publish.txt; Canvas 3–8 s, loops seamlessly, no text or sound.
10. **Videos and Post (6.2a, 6.2c-2b):** compare 2 videos, approve one, "Use these settings" opens Generate
    with that run's settings; Post shows captions + downloads for approved videos only; "Clear finished" in Tasks.

### Earlier plan (29 Oct; A–D built, the rest superseded by the agreed order above — kept for reference)
Guiding principle (CLAUDE.md, decided 29 Oct 2026): the user provides, orders and trims the clips; the app
does every technical decision automatically and gives a plain-language pro assessment of each result.
Found in the 29 Oct test on The House My Heart Built (135 BPM, 13 own clips of ~5 s), each a technical
decision the app still hands to the user:
- Reels ending stops dead on a loud chorus (0.12 s fade, level jump 15.6 dB).
- A loop suggestion (84 s) that drops the title line ("This is the house that my heart built").
- Pacing left to the user: 51 shots of 1.8 s on an emotional song until Shot length "story" was set by hand.
- Slow-motion warnings (0.74x) the user must judge; a 3 s Canvas from short clips; technical WARN texts.

After the user's test pass, in this order (each its own step, plan first):
A. ✅ (built 29 Oct, to verify) **Automatic endings**: per section the app chooses tight loop / soft fade / ring-out (last chord one more
   bar, then fade) from the music at the end (level, harmony, what follows); whole bars kept; loop
   suggestions never drop a chorus / title line the plan has. Fixes the abrupt Reels ending.
B. ✅ (built 29 Oct, with transitions, to verify) **Automatic pacing**: shot length chosen from the song (tempo, energy, hooks vs verses) and the clips
   given (their usable lengths, slow-motion limit), e.g. "story" for slow emotional songs; asks for longer
   clips only when it cannot work otherwise.
C. ✅ (built 29 Oct, with reactions and the better Canvas, to verify) **Pro assessment** per video (Videos tab, Storyboard header): one verdict in plain words + at most a few
   creative actions; the QA / loop details one click away. Canvas: picks the best clip and the longest loop
   (slowed a little rather than 3 s), or says "a clip of at least N s".
D. ✅ (built 29 Oct, to verify) **Title opening** (items 1-8 below).

0. **Feature freeze** until the user has tested on their songs (Textboard, Storyboard stage 2, shot length,
   tempo, loop warning). Then A–D above; the **title opening** as built in Step D:
   1. Lead-in 2 bars before the first hook only when the title opening is on (setting 1-2 bars, default 2,
      at most ~5 s); without a title: hook-first <= 1 bar and the 2.5 s rule as now.
   2. Places: title + byline on the frame's upper third, tagline on the frame's lower third (inside the
      safe area); the Reels defaults when the title opening is on.
   3. Fade: title cards end as the first lyric line fades in, never overlapping it (no fixed hold).
   4. Font picker in the card editor; Life Lyrics title font = Special Elite (not Cinzel).
   5. Automatic Noto Sans JP (or Serif JP) for characters the title font lacks, same in preview and render.
   6. Tagline = its own song field (empty by default, never from the EP), editable in Assets next to title
      and artist.
   7. Reel cover.jpg per Reels / TikTok / Shorts video, with title / byline / tagline inside the 3:4 grid crop.
   8. QA for title cards: safe zone, 3:4 crop, no overlap with the first lyric, all characters present.
1. Verify Steps 6.2a and 6.2b on the PC (6.2c-1 verified); verify 5c.1 (A Heart For Two, YouTube) and 6.2c-2b.
2. Verify 5c.2 (the Lyrics tab) on the PC with A Heart For Two ~1:10.
3. Step 6.3 (content board with manually entered results).
4. Step 5g.4 (loop layout).
5. Step 5e (timing editor on /preview); corrections go into an automatically created "test" project
   (confirmed by the user) and plug into the same render-time layer as the lyrics offset.
