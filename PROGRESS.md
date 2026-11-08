# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Bug fix: trimming on the timeline needed several tries ✅ (confirmed on the Windows PC, 8 Nov 2026)
- **What the user found** (real song "Let My Love Carry You", Windows): "The trim of the clip doesn't work
  effortlessly. I have to try several times."
- **Causes (found in the code, fixed):**
  1. The grab zones were too small: the line between two shots was a 12 px zone, invisible until hovered, so a press
     a few px inside the shot started a slip instead of moving the cut. Now an 18 px zone centred on the cut
     (the outer trims 16 px: 10 px into the shot, 6 outside), a faint line always visible (stronger on hover),
     above the shots and the ⋯ menus (the menu moved 6 px left to give them room).
  2. After the release the edit jumped back to its old place until the new plan arrived (seconds on a real song), so
     it looked as if nothing happened and the user tried again. Now the cut / trim handle stays where it was dropped
     (data-pending, a "saving…" mark, data-edit-saving) until the plan is there; a failed save puts it back and the
     error shows as before. While it saves (or any other plan runs) no second drag, Undo or Redo starts.
  3. The mouse listeners were added in an effect after the render, so a quick move or release right after the press
     could be lost (a stuck drag). Now they start inside the pointerdown (components/pointer-track.ts), also end on
     pointercancel and when the window loses focus (nothing is saved then), and stop text selection while
     dragging. The same for the soundtrack window's drag.
  4. A roll snapped to the nearest beat, so a drag under half a beat went back to the start and did nothing. Now
     under a quarter beat the cut stays exactly (readout +0.00 s), past it goes to the next beat in the drag
     direction (snapRollMs in packages/video/src/timeline-edits.ts); Alt stays free; the minimum shot length is kept.
- **Rejected:** the shots' native drag-and-drop (ShotBlock is only a drop target, not draggable) and the click after
  a drag (already swallowed by onRowClickCapture).
- Tests: timeline-edits 16 (4 new, snapRollMs; with follow + storyboard 34 pass); storyboard e2e 137 checks pass (8 new:
  grab zone 18 px, a press 6 px beside the cut grabs it, the handle stays dropped and marked saving, no second drag
  meanwhile, it ends where dropped, a quick two-step drag is saved and Ctrl+Z takes it back).

### Shape: no Clip editor box; the song window on the timeline's song track; a ⋯ menu on each clip ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Asked by the user (8 Nov 2026): "remove this clip editor box and focus on a simple trim directly on the clip
  itself"; "I wanted the rectangle on the song track itself, not a new one"; the clip's other settings "in a small
  menu".
- **No Clip editor box:** the Shot panel and the Clips panel no longer open it (no clip player, no In / Out / Speed /
  Best moment fields, no "Save and plan again"). Trimming is done on the clips on the timeline: drag the line between
  two clips (the cut), drag inside a clip (another part of it), the first and last clip also by their outer edges (as
  before). The Shot panel says so in one line. A clip clicked in the Clips panel is selected on the timeline and shown
  in the viewer.
- **⋯ on each clip** (top right of the clip on the timeline, and "Clip settings" in the Shot panel): Speed (1x-0.5x),
  Comes in with (automatic / a cut / a dissolve), Best moment (here, at the playhead / automatic), Spotify Canvas (this
  clip from here / let the app choose), Whole clip, automatic, Omit this clip. Each choice is saved at once (clips.json,
  the Canvas in song.json) and the video is planned again; one choice keeps the clip's other settings.
- **The song window on the song track:** the separate "Soundtrack" strip above the timeline is gone. The timeline's
  waveform row is now the whole song at the timeline's zoom: the song before and after this video lies left of 0:00
  and after the end, dimmed, and the video is the pink window on it. Drag its edges to set where the video starts and
  ends (snaps as before: a bar, the bar after a sung line; Alt free; at least 3 s), drag the window to move it; a
  click in it still plays from there. The readout ("Song Reels: 0:36.1 – 1:54.7 · 78.7 s · line 5 · chosen by you")
  and **Automatic** are in the command bar. The timeline opens on the video's start (the song before it is a scroll to
  the left), and every playhead jump still scrolls to the playhead. The whole song's waveform is now as detailed as the
  video's (50 ms).
- Tests: storyboard.e2e.ts (no Clip editor; ⋯ → Speed 0.8x, Best moment here, Comes in with a dissolve keep each
  other; Whole clip, automatic drops them; the window on the song track with the song before it dimmed; dragging its end
  saves this platform's part in song.json; Automatic): run in the cloud session, all 129 checks pass. Found on the way:
  the old Clip editor check used 03_c, which has no shot in that test Reel, so "its shots slowed" was never really
  checked; the new checks use 01_a (shot 3).

### Bug fix: a jump while paused leaves the playhead off-screen ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Found by the user on "Let My Love Carry You" (Reel 1:18, Follow on, preview paused, timeline scrolled by hand to
  1:10-1:18): ⏮ "Go to the start" moved the preview to 0:00.0 (the counter showed it) but the timeline stayed where
  it was, so the playhead was off-screen and the button looked broken. It only worked when the first clip was selected.
- **Fixed for every jump**, not just ⏮: ⏭, Stop, Home / End, back / forward one bar or frame, a click on the ruler, a
  lyric line or a clip, Undo / Redo, and play from the end now scroll the timeline to the playhead, paused or
  playing. One place does it: the page listens to the Player's "seeked" event (fired by every seek and by nothing
  in ordinary playback), so no jump can be missed.
- **Follow on:** the playhead goes to the middle (as before for playing). A jump is an explicit request, so it also
  ends a hand-scroll hold: if the preview is playing, Follow carries on from the new place. **Follow off:** the
  playhead is only brought into view with a small margin (40 px); if it is already visible the timeline does not move.
  Ordinary playback is unchanged (Follow off still never scrolls by itself while playing).
- Tests: follow.test.ts (new revealScrollLeft: visible = no scroll, left / right of the view, margin, clamped, fits);
  storyboard.e2e.ts (scrolled away + paused: ⏮, ⏭ and Home bring the playhead into view with Follow off, a small jump
  does not scroll; Follow on: ⏮ and ⏭ put it in the middle within 4 px): run in the cloud session, all 121 checks
  pass; follow.test.ts 10 pass.

### Shape: the whole song as the soundtrack, the video as a window on it ✅ (to verify on the Windows PC)
- Asked by the user (7 Nov 2026): keep the whole song untouched in the background and pick which part the video
  uses, like trimming the music in Canva, without resizing the song for every Reel or YouTube video.
- **Soundtrack track** above the timeline: the WHOLE song's waveform with its sung lines (choruses in the brand
  colour) and the video as a window; outside it dimmed; a white line where the preview is in the song.
- **Drag the window** to move it (same length), **its edges** to set where the video starts and ends. The start
  snaps to a bar, the end to the first bar after a sung line (a clean end) within 1.5 s, else to a bar; Alt: exactly
  there; never under 3 s. While dragging: "0:02.2 – 0:08.2 · 6.0 s · line 2 · ends after a sung line", and a warning
  when the window would cut a line while it is sung.
- **Saved per platform** in song.json perPlatform "section" (the same as Make → "Part of the song", and what the
  Lyrics tab band shows), so the Reel, TikTok, Shorts and YouTube each keep their own part; **Automatic** gives it
  back to the app. The song file is never changed: each video takes its part of it, with fades only where the music
  is cut. Your cut moves and slips live on the song's timeline, so they stay at the same musical moments when the
  window moves.
- Kept compact (one 28 px row) so the viewer keeps its size (543 px on 1440×1000, 311 px on 1366×768).
- Tests: section-window.test.ts (clean ends, snapping, minimum, song.json text, lines cut); storyboard.e2e.ts (the
  window is shown, dragging its end saves this platform's part in song.json, "chosen by you", Automatic): run in
  the cloud session, all 113 checks pass.
- Next (asked with it): drag a clip onto another shot to swap them on the timeline.

### Shape timeline: trim the first and last clip, the clip in the viewer while editing ✅ (to verify on the Windows PC)
- Asked by the user (7 Nov 2026): "I can't trim the first clip from the left-hand side and the last clip from the
  right-hand side", and "when I select the clip I expect to see it in the viewer".
- **Outer edges:** the first clip's left edge and the last clip's right edge have a handle (data-trim-handle).
  Drag the left edge right: the first clip starts later in its footage; drag the right edge left: the last clip
  ends sooner. The video keeps its music and length (the shot keeps its place; saved as a slip). When the clip
  has no more footage that way the readout says so ("no more footage after this in the clip").
- **The clip in the viewer:** clicking a clip on the timeline puts the playhead on its first frame; while a cut,
  slip or trim is dragged the big viewer shows that exact frame of the clip ("1.40 s of the clip"); after the
  edit the viewer stands on the edit point (Space plays from there).
- **Fixed on the way (older bug):** after some re-plans the viewer was mounted again but the playhead kept
  listening to the old one, so the playhead, the time and Follow froze while the video itself moved. The
  timeline now follows the viewer that is on screen. A click that ends a drag no longer swallows the next
  real click.
- Tests: storyboard.e2e.ts (trim readout and the viewer frame while dragging, the last clip's handle, clicking a
  clip moves the playhead to it): run in the cloud session, all 108 checks pass.

### Shape timeline: pro edits with the mouse, part 1 (roll, slip, snapping, Undo) ✅ (to verify on the Windows PC)
- Fixed (7 Nov 2026, reported by the user): a slip on a Reel's first clip was undone by the loop ending (it moved the first clip's start to make room for the seamless loop); a first shot with a start set by hand (slip or anchor) now keeps it, and the loop uses the frames before it when there are enough, else an ordinary last shot. A slip on the last clip likewise plays from the slip as an ordinary last shot (it is not turned into the loop shot).
- Asked by the user (7 Nov 2026): edit like the pros (Premiere, Resolve, Final Cut), directly on the timeline,
  not by typing seconds in the Clip editor.
- **Roll:** drag the line between two shots: the cut moves, one shot gets longer and the other shorter,
  nothing else moves (the music is fixed, so a ripple would push every later cut off its place). It snaps to
  the beat; hold **Alt** for exactly where you let go. The left shot keeps its first frame, the right shot keeps
  its last frame (it starts earlier or later in its clip), as a roll edit does.
- **Slip:** drag inside a shot sideways: it keeps its place and length, another part of its clip plays in it
  (right = earlier frames, as in Premiere), never past the clip's usable part. A plain click still selects.
- **While dragging:** a readout ("+0.50 s · shot 1: 2.5 s · shot 2: 3.4 s · on the beat" / "slip · clip: from
  0.60 s (was 1.10 s)") and the clip's frame at the edge in a small preview. Moved cuts are drawn in the brand
  colour, slipped shots carry ⇆.
- **Undo / Redo:** Ctrl+Z, Ctrl+Shift+Z (or Ctrl+Y), and two buttons in the bar under the timeline. A shot's panel
  has **Automatic cuts and clip start** to drop the moves at its edges and its slip.
- **Kept with the song, on the song's timeline:** clips.json "cuts" ([{ from, to, free? }], song seconds) and
  "slips" ([{ at, clip, in }]), so every video covering that moment (Reels, TikTok, Shorts, YouTube) gets them.
  The planner applies them after the story anchors: a cut moved by hand is final, also an anchor's; a slip on an
  anchored shot counts when it is the anchor's clip. An edit whose cut is not in a plan (another section) is
  left aside. (src/timeline-edits.ts, compose.ts; components/timeline-editing.tsx.)
- **Fixed on the way:** Shape's "Omit this clip" and "Use for Canvas" were refused by the storyboard route
  ("Bad request": it only accepted 4 of its 6 edits); it now takes every storyboard edit.
- Tests: timeline-edits.test.ts (snapping, roll, slip, merge, reset, the planner moving only that cut and
  playing the slipped clip from its moment, clips.json); storyboard.e2e.ts (drag a cut one beat: readout,
  clips.json, shot 1 longer and shot 3 unmoved, marked; slip shot 3: readout, ⇆, same place and length, no
  selection; Ctrl+Z / Ctrl+Shift+Z; reset): run in the cloud session, all 102 checks pass.
- Part 2 (next): keyboard trims ([ / ] to the playhead, , / . one frame, Shift one beat) and the two-up preview.

### Bug fix: lines whose voice starts late are always checked; a stamp in silence moves to the voice onset ✅ (to verify on the Windows PC)
- Found on Let My Love Carry You, checked by ear in the Reel (starts at song 0:36.1). Line 9: stamp 1:03.4, voice 1:05.8,
  words 1:04.8, first word 0.1 s: in pnpm make / the plan it was not checked (mid-verse, not a hook; only
  `lyrics:check-start --all` moved it) and showed at 1:03.1; the user hears it at song ~1:06.1. Line 5: stamp 0:34.8,
  voice 0:38.1, words 0:37.2, durations 0:37.7; the user hears ~0:39.1. The voice onset (measured on the vocal stem)
  is closest to the ear; the recognised words were 1-2 s early.
- **Always checked**: a line whose own voice starts at least 1 s (EARLY_MS) after its stamp is checked in pnpm make,
  the plan, the Lyrics tab's record and the speech-recognition windows (signalsFor), not only with `--all`. A line
  with no voice onset (sung on without a pause) stays unchecked.
- **Stamp in silence moves to the voice onset** when there is one (else the recognised words when within 1 s of the
  word-duration estimate, else the earliest). Line 5 -> 0:38.1 (was 0:37.2), line 9 -> 1:05.8 (was 1:03.1 unchecked),
  the last line (no voice) still 3:22.1.
- Tests: vocal-guard.test.ts (38 pass): line 5 38 100, line 9 65 800 without `all`, asrWindows includes line 9, a line
  with voice at its stamp still unchecked, hand-set untouched. Changed old expectations: the Heart For Two 'plain'
  case now checks line 2 (voice 1.5 s late) by default; a short-first-word case now moves to the voice 73 900 (was
  the words 73 500).


### Shape timeline: Follow keeps the playhead in the middle ✅ (to verify on the Windows PC)
- Asked by the user (7 Nov 2026): for checking lyric sync, the playhead should stay in one place while the
  timeline slides under it, as in Pro Tools ("continuous scroll"), Logic and Final Cut (not a page jump as in
  Premiere / Resolve / Ableton). Follow now keeps it in the middle (was a third from the left). Scrolling by hand still
  stops it until the next play.
- Then (asked by the user: "we miss the beginning while the playhead goes to the middle"): with Follow on, the
  timeline gets half a view of empty space before 0:00 and after the end (as Pro Tools / Logic), so the
  playhead is in the middle from the first frame to the last, also when Follow is ticked while paused.
- Tests: follow.test.ts (the middle; with the half-view space: in the middle at 0:00 and at the end);
  storyboard.e2e.ts unchanged in substance.

### Lyrics tab: where the Reel starts and each line's time in it ✅ (to verify on the Windows PC)
- Asked by the user (7 Nov 2026), with the timeline clock: the Lyrics tab shows song times, the Reel counts
  from its own start, and nothing linked the two.
- **A band above the lines:** "Part of the song in [Reels] [TikTok] [Shorts]: 0:34.2 – 1:52.0 of the song
  (78 s, from line 5). Time in the video = time in the song − 0:34.2." The planner's reason is its tooltip.
  Only the song's short-form platforms are offered (YouTube is the whole song, Canvas has no lyrics).
- **Per line:** "in the Reels 0:03.0" under "On screen" (when it is readable in the video, the same clock as
  the Shape page's timeline), "not in the Reels" for the others, which are dimmed; the first line in the
  Reel says "The Reels video starts here: at 0:34.2 in the song; this line is readable 0:03.0 into the video".
- **Always the next video:** it is the same plan the Shape page shows (the planner's dry run for v1), asked
  when the tab opens and again after Save / Reset all (a start set by hand can move the Reel's start).
- Tests: timeline-time.test.ts (linesInVideo: which lines a planned video shows and when); lyrics-tab.e2e.ts
  (the band is offered; run in the cloud session: 33 checks pass; the thumbnail check now waits for the image,
  which raced with the planning).

### Shape timeline: a clock on the playhead and the song's time ✅ (to verify on the Windows PC)
- Asked by the user (7 Nov 2026): follow where the song is while the preview plays, and compare it with the
  Lyrics tab and `pnpm lyrics:check-start`, which use song times (the Reel counts from its own start).
- **Time ruler** above the bars: minutes:seconds in the video (a label every 2 s at 1x, every second at 2x,
  every half second at 4x, a small tick in between). The bar row keeps its numbers (they are bars, not seconds;
  its tooltip now says so, each bar with its time).
- **Playhead bubble:** the playhead carries its time, e.g. `0:28.4 · song 1:02.6`, moving while it plays and
  when it is dragged or clicked. **Hover** anywhere on the timeline shows that moment's time the same way.
- **Counter** under the viewer: tenths (`0:28.4 / 1:18`) and `· song 1:02.6` next to it.
- **Lyric blocks:** the tooltip gives the line's time on screen in the video and in the song.
- Song time = where the video's audio starts in the song (the storyboard's new `songStartMs`) + the time in
  the video; a whole-song video shows one clock.
- Tests: timeline-time.test.ts (labels, tenths, song time with the Let My Love Carry You numbers: Reel 0:30 =
  line 9 at 1:04.8); storyboard.e2e.ts extended (ruler, bubble, hover, bubble = counter) but not run in the
  cloud session (the audio analysis's Python crashes there); studio typecheck and production build pass.

### Bug fix: a held note from the line before no longer hides a stamp in silence ✅ (to verify on the Windows PC)
- Reported on "Let My Love Carry You", line 9: stamp 1:03.4, voice 1:05.8, recognised words 1:04.8 "Let my love",
  first word 0.1 s: only "flagged for review" (no second signal within 0.3 s). Line 8 (0:58.6, "Till the break of day")
  holds its last note past the stamp, so the vocal track read up to -25.5 dB there, over the voice level -30.5 dB,
  and the stamp-in-silence rule did not fire. Ear check: Reel 0:03 / 0:30 are 27 s apart, which matches the
  words at 0:37.2 / 1:04.8 (line 5 / line 9), so the line starts at about 1:04.8.
- Fix (vocal-guard.ts): the silence test now means "no voice of this line at the stamp": the level is measured
  only from the stamp to the earliest later signal (not a fixed 2 s), and frames of the previous line's own singing
  (the voice stretch its last word starts in, the same definition `signalsFor` uses) are left out; nothing left
  counts as silent. New `LineCheck.ownLevelDb`; `stampLevelDb` (the printout) is unchanged. Everything else of the
  rule is unchanged (two or more signals, each >= 1 s later, target choice, hand-set lines, safety checks).
- Line 9 -> 1:04.8. Log: `guard: line 9 moved from 1:03.4 to 1:04.8 (stamp in silence; voice, words all later)`.
- Tests: vocal-guard.test.ts (line 9 with these numbers; the line's own voice already sounding at the stamp is
  never moved; line 5 -> 0:37.2, last line -> 3:22.1 and hand-set unchanged). Docs: docs/lyrics.md.

### Bug fix: Generate kept a collection unticked in Shape ✅ (to verify on the Windows PC)
- Reported: "wedding" unticked in Shape → To make (song.json "collections": []), yet Make still showed
  "6 clips + wedding" and the run added the wedding clips again.
- Cause: the Generate panel stays mounted while hidden and read the song's collections once
  (`useState(runCollections ?? data.chosen)`, never updated), so on submit it differed from the song's
  choice and sent `collection: "wedding"`. The same pattern held for the section: it started from the
  recipe's section and kept it, so a section changed in Shape → Automatic was sent back as an override.
- Fix (generate-panel.tsx): the collections are derived (`runCollections ?? data.chosen`), so they follow
  the song's current choice; a run opened with "Use these settings" keeps the run's. The section keeps only
  the user's edit as state (`sectionEdit`), otherwise it follows the recipe (or the run's). The theme for
  the run was already fine (starts empty = the song's own). Platforms, videos, length etc. are the user's
  edits in the panel and are unchanged.
- Test: e2e/song-stages.e2e.ts unticks "wedding" in Shape → To make, goes to Make without reloading and
  checks the clips line no longer names it (browser test, runs in the cloud check / on a machine with Playwright).

### Bug fix: vocal-start check moves a line whose stamp is in silence when every signal is later ✅ (to verify on the Windows PC)
- Reported on "Let My Love Carry You": line 5 (stamp 0:34.8, vocal track -35 dB there, under the voice level
  -30.5 dB; voice 0:38.1, recognised words 0:37.2, word durations 0:37.7) and line 31, the last line (stamp
  3:19.4, words 3:25.1, durations 3:22.1) were only "flagged for review": no two signals were within 0.3 s.
- New rule (vocal-guard.ts, after the existing move rules): the stamp is in silence (`stampLevelDb` under
  `thresholdDb`), every other signal is at least the lead-in (1 s) later, and there are at least two of them
  -> the line moves, to the recognised words when they are within 1.0 s of the voice or the word-duration
  estimate, else to the earliest signal. The held-note protection (hook / last line) applies only when the
  stamp is not in silence; a stamp with voice at it, and hand-set starts, are never moved by it; the safety
  checks (next line, previous line) still apply.
- Line 5 -> 0:37.2; line 31 -> 3:22.1. Log: `guard: line 5 moved from 0:34.8 to 0:37.2 (stamp in silence; voice,
  words, word durations all later)` (`GuardMove.reason`).
- Tests: vocal-guard.test.ts (line 5 with the exact numbers, last line, voice at the stamp, one signal alone,
  hand-set). Two older tests now follow the new rule, as intended: "A Heart For Two" line 40 (last line, stamp in
  silence, words + durations later) moves to the words instead of being flagged, and a short first word with voice
  and words both > 1 s after a silent stamp moves to the words. Docs: docs/lyrics.md.

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
- **A shot ends where your trimmed clip ends** (2 Nov 2026): when a clip you trimmed in Edit clip is shorter than its shot, move the cut earlier to the last bar (else beat) the clip covers, the next shot starting earlier; needs the cut plan to know the clips (today cuts are fixed first).
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

**Theme Engine v2 on HyperFrames (adopted 6 Nov 2026; plan approved the same day).** The order is the plan
docs/theme-engine-v2-hyperframes-plan.md, section 6: step 0 ("break." fix, done) → 1 (renderer seam; D1 decided = (b), everything
in one pass; its speed and frame accuracy checked on the PC, causes fixed, (a) only a temporary fallback; zero network
calls when rendering; LGPL FFmpeg with NVENC timed; done: B 92% of Remotion's time on the PC) → 2a (picture for Reels, done, confirmed on the PC) → 2b (part 1 done: the lyrics and cards with the same code; part 2 next: stacked lines, bigger final hook, theme-rules.md) →
2b (the Reel word-by-word theme's text) → **M1: the Reel word-by-word theme ("Here with Me") usable for real
releases** → the spec's T1-T4 → 3-8, the ballad and Pômé themes. GSAP / FFmpeg licences non-blocking: a short
note (docs/licences.md) before step 8. It replaces the T-list below as the order.


**Theme v2 (agreed 1 Nov 2026; lyric sync accepted by the user).** Comes first now; each item is its own step, plan
first, stop after each. Spec (agreed with the user, kept up to date in chat): "Videomaker — Theme Engine v2
Specification", https://claude.ai/artifact/Y3MPZSg6dpiocMWKGAVQG5. Principles: a Theme is only look and behaviour,
declarative (data, never code), deterministic, additive (v1 themes render identically), Craft Rules always win and
every adjustment is reported. Golden reference: the user's Reel "Here With Me".
- ✅ **T0. Reels length 90 s** (see Latest steps).
- **T1. Section tags kept:** Suno's [Verse] / [Chorus] / [Bridge] ... are stored with each line as its section
  (no longer flagged and removed from lyrics.txt); "* " hooks still work and count as chorus where no tag exists;
  the Lyrics tab shows the section map and lets the user correct a section.
- **T2. Theme v2 format, no visible change:** versioned schema (typography, composition, motion, pacing, finish,
  cards, rules) + an adapter that reads every v1 theme.json; regression frames prove the user's themes render
  identically.
- **T3. Rule engine:** Theme defaults -> platform -> section -> repeat (first / nth / last) -> moments (held note,
  emphasis word, peak) -> song overrides, as property patches; peaks capped per platform (Reels 1-2, Long story 2,
  YouTube 3).
- **T4. Craft Rules in one place:** presets/craft-rules.json + one checker; new rules (minimum time on screen,
  <= 17 characters/s, measured fit + 40-character ceiling, breath-aware line breaks without orphans, no text change
  on a cut frame, peak limits); the assessment lists "Done for you" adjustments in plain words.
- **T5. The user's Reel look:** stacked line shape (2-4 short lines chosen per phrase, never padded), line build-up
  (accumulation) independent of the letter animation, lyric colour "auto" per clip from the Theme palette.
- **T6. Pacing and story length:** Theme pacing (shot length range, dissolve / double exposure, cut on phrases),
  the "story" start (verse 1 through at least one full chorus) for Reels, the per-song "Long story" (up to 2 min).
- **T7. Cards:** Brand Kit slots ({song} {artist} {tagline} {ep}) and the song's {credits} line on title cards.
- **T8. Theme designer screen:** Themes -> a Theme -> Design (test song + preview, section timeline, the seven
  groups, Save as new theme); the song page keeps the quick Edit theme.
- **T9. Golden test:** "Here With Me" as a v2 Theme, regenerated next to the original Reel, plus a Life Lyrics
  ballad Theme and a Pômé Theme; the acceptance gate before any Reverse Engineer work.
Publishing (decided 1 Nov 2026): one 9:16 Reel file for Instagram + Facebook + YouTube Shorts (safe zones: the
strictest of the three); YouTube 16:9 = the whole song; TikTok stays available, not a default.
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
