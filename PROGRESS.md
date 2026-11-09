# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Shape: change a video's theme from the Look bar (preview, then Apply) ✅ (to verify on the Windows PC)
- **Principle (in CLAUDE.md):** "Shape = work on this video. Theme = manage reusable looks."
- **Look bar** at the top of Shape's panel (every panel except Theme): the song's theme name, ONE mark
  "Customized for this song" (only for a look made for this song: "<song> look" or "Made from X for <song>",
  used by no other song) and **Change**. No Edit / New theme, no second badge there.
- **Change** opens a searchable theme picker (name, fonts, effects): the Themes page's tall tiles, the whole card
  clickable, the song's own first lines, the song's theme marked "✓ Selected". A click only **previews** the theme
  in the viewer (the planned video, or the stand-in preview); nothing is saved, the storyboard is untouched.
  **Apply** uses it for the song and closes the picker; **Cancel** (or Esc, or another panel) puts the look back.
- **Storyboard safety (what was built: the simple note + Cancel, not 2g's summary):** a theme holds no pacing
  field (shot length, transitions, pace shift, ending, section and length are the song's own), so applying one
  re-paces nothing. Tested on a real song folder (test/theme-apply.test.ts): a moved cut and a slip, then a theme
  with every text and card choice changed (stacked lines, build up, big hook, bigger final chorus, hook and end
  cards, other effects, colours, grade): every shot (id, clip, start, end, trim, speed, transition, locks, anchor),
  every lyric time, the range, beats and sections come back identical; only the storyboard's theme name changes.
  The note above Apply says so. Leaving a look customized for this song asks first ("Use X" / "Keep Y"); that look
  stays a theme, nothing is deleted.
- **The Theme panel (rail → Look → Theme) manages themes only:** "Use for this song" on its tiles and "Change
  theme ↓" are removed (they switched the theme at once, without preview or Cancel); Edit theme, New theme,
  Rename, Duplicate, Delete, Restore stay. The Themes page (header) keeps "Use this theme for the song".
- **Panel width:** 320-400 px (28% of the window: ~358 px at 1280, ~382 px at 1366, 400 px from 1430), was 340.
- **Note:** the theme belongs to the song, so Apply changes the look of every video of the song (all platforms).
- Tests: theme-apply (2); song-stages.e2e.ts new checks (Look bar place and contents, picker, Selected, search,
  preview without saving, Cancel, Apply; the Theme panel has no Use for this song) all pass; storyboard.e2e.ts and
  themes.e2e.ts all pass; storyboard-save, storyboard-file, storyboard, storyboard-edit, themes, style pass; tsc
  clean; pnpm build ok. **Older, not from this step:** song-stages.e2e.ts "This song: Card text first …" fails
  before and after it (the This song panel also lists Line shape, Lines appear, Bigger final chorus since 2b part 2).
- **To check on the PC:** Shape → open This song (or Clips, Automatic …): the Look bar on top; Change → click a
  theme: the viewer shows it, the song.json still has the old one; Cancel: back; Change → a theme → Apply: the
  Look bar shows the new name and the video is planned again with the same shots and cuts.

### Theme v2 storyboard, step 2d: the plan of every video saved as its storyboard file ✅ (to verify on the Windows PC)
- **The plan you see in Shape is now a file:** `<song folder>\storyboards\<platform>-<n>.json` (e.g.
  `storyboards\reels-1.json`), written whenever Shape plans that video with the song's own clips. The agreed
  format, version 1: the inputs (song, vocal stem and lyrics files with their fingerprints, the lyric timing
  used, clips.json), the output (platform, 9:16 / 16:9, the part of the song and why, the theme), the beats
  and sections, the text items (line-N, card-title ...), the shots (sh-01 ...: clip, trim, speed, start / end,
  transition in, the line it carries, its warnings), the predicted verdict. All times in song milliseconds;
  they give back every frame of the plan exactly (tested on every frame of an hour).
- **Your edits are imported as locks** (the field is your choice): a moved cut locks the shots on both sides,
  a slip the shot's trim, a story anchor the line the shot carries. **Never dropped:** a moved cut or slip that
  no shot of the video matches is listed in the file and in Shape's Analysis notes ("Moved cut not used: the
  cut you moved from 0:50.0 to 0:50.4 is not at any cut of this video now (nearest: shot 3 at 0:48.8). It is
  kept in clips.json."). Shot ids stay when the plan is made again (same clip, most overlap).
- **`pnpm storyboards`**: plans every video of every song (each platform of its recipe), writes their
  storyboards and lists, by song and shot, every moved cut or slip that no video uses any more. Changes none of
  the song's own files.
- **Nothing else changes:** Make still plans as before (it reads the storyboard from step 2e-1); videos are
  the same.
- **Golden test ready:** test/storyboard-file.test.ts compares the storyboard of the approved "Here with Me"
  Reel with that video's frames; it runs as soon as its manifest is at
  `packages\video\test\golden\here-with-me-reels.manifest.json` (skipped until then).
- Tests: storyboard-file (format, frames back, locks, unmatched edits, ids, the report), storyboard-save (a real
  song folder: Shape's plan writes the file, locks, notes, ids, pnpm storyboards); the whole video suite passes.

### Theme Engine v2 on HyperFrames, step 2b part 2: stacked lines, build up, bigger final chorus, theme-rules.md ✅ (to verify on the Windows PC)
- **Three new theme choices** in Shape → Theme → Text, under Text layout (theme.json `lineShape`, `lineBuild`,
  `finalHook`; src/line-shape.ts; the viewer shows each click at once, Save keeps it):
  - **Line shape: Stacked** (Subtitle = as before): each lyric line in short rows of 1-3 words, 2-4 rows,
    never padded (a one- or two-word line stays on one row). Breaks where the singer breathes (a pause of
    0.15 s between aligned words), never one word alone on the last row, never right after a small word
    ("the", "my", "to", "le", "la", "mon", "l'" ...): e.g. "Hold me close / until the light",
    "Je t'attends / sous la pluie / ce soir". Rows fit the width; only a row that cannot fit shrinks the size.
  - **Lines appear: Build up** (Whole line = as before): the first row comes with the line, each next row
    appears as its first word comes on screen (0.2 s fade, a slight rise into its place) and stays until the
    whole line leaves. Independent of the letter animation (the typewriter still types as sung).
  - **Bigger final chorus: On**: the video's last chorus 1.3x, its last line 1.5x (a card's own size still
    wins; the usual fitting keeps it inside the safe area).
- **Same drawing everywhere:** the rows and build-up are in the shared text code, so the Shape preview, the
  current renderer and HyperFrames draw exactly the same. Checked by a new `hf-parity` case with all three on
  (typewriter verses, karaoke hook): whole 0.9915 (lowest 0.9910), words 0.9921, cards 0.9916 = the same
  picture, frame by frame. QA allows up to 4 rows for the stacked shape (subtitles: still 2).
- **docs/theme-rules.md** started: LIN-01 .. LIN-06 (the rules above), each with its value, why, the test and
  where it came from.
- Tests: line-shape (rows, breaths, orphans, small words, fitting, build-up timing, final chorus, the viewer
  patch, QA), hf-parity (stacked case); the whole video suite passes (1025 tests).
- **To check on the PC:** Shape → Theme → Edit theme → Text: Line shape Stacked, Lines appear Build up,
  Bigger final chorus On; the viewer shows short stacked rows building up and the last chorus larger. Then
  make the Reel with `--engine hyperframes` (below) and compare.

### Bug fix: the Reel's title still touched the first lyric — now checked on the drawn preview ✅ (confirmed on the Windows PC in Shape, 8 Nov 2026)
- Seen again after the last fix (Let My Love Carry You, Shape → Reels 1080x1920, Title opening on, tagline set, first line on screen from 0:00.6, at 0:02.7): title "LET MY LOVE / CARRY YOU" at ~y 430-560 (not moved), byline at ~625-645 and the first lyric (hook font, two rows) at ~640-770: byline and lyric collided.
- Ground truth first: new browser test `apps/studio/e2e/title-opening.e2e.ts` (Playwright; a song whose Reels part starts exactly on a sung line, titleOpening on, tagline, script hook font Kaushan Script). It seeks Shape's player to 1.5 / 2.1 / 2.7 / 3.3 / 3.9 s and reads the boxes of the drawn `[data-text-card]` rows and `[data-lyric]` text inside the player's frame, in composition pixels (player scale read from the 1080x1920 frame). It failed on the old code (hook effect "ascend": title top 345 size 84 planned; drawn title 345-597, byline 618-675, lyric 626-792 = byline 49 px into the lyric, at every sample 1.5-3.9 s; "floating": byline 585-633 vs lyric 633-799, touching). After the fix: ascend title 345-547, byline 568-613, lyric 626-792 (13 px clear); floating title 354-524, byline 542-581, lyric 633-799 (52 px clear); default effect 272-464 / 484-527 vs 626 (99 px); Big hook 271-453 / 472-513 vs 602. Cards still on screen at 3.9 s in every case.
- Real cause: NOT the lyric box (the planner's box top, ~635, matched the drawn 626-636 within 10 px) and not a stale prop in the preview (Shape and render use the plan's props; patchLook only touches hook / end cards and the look, and a saved theme re-plans). The title BLOCK was drawn taller than planned: the planner (card-layout.ts cardBlocks, fitCardBlocks, relocate in titleCards) counts every card row as 1.2 x size (CARD_LINE_HEIGHT), but the composition (TextCards.tsx) left `line-height: normal`, which is the font's own: ~1.42 for the title font Cinzel. A two-row title at 84 px was drawn 252 px tall (planned 202), the byline row 1.42 instead of 1.2: the block's bottom was ~60 px lower than planned, so a block placed to end 23 px above the line ended inside it (and a block judged "clear" was not).
- Fix: TextCards.tsx draws every card block with `lineHeight: CARD_LINE_HEIGHT` (imported from card-layout.ts: one number for the planner, QA, the cover and the drawing; preview, render and the HyperFrames text layer share TextCards, so the manifest props and the preview props are the same and need no other change). YouTube's title now has the same 1.2 rows (one row: a few px less height).
- Tests: title-opening.e2e.ts (4 scenarios x 5 moments = 20 checks, added to `pnpm test:e2e`); packages/video: the 9 files (title-opening, title-opening-make, textboard, qa, readability, text-layout, storyboard, extra-cards, textboard-make) 71 pass; tsc clean (packages/video, apps/studio typecheck); pnpm build ok; storyboard.e2e.ts all checks pass.
- To check: `cd D:\videomaker`, `git pull`, restart, Shape → Reels, Title opening on, play from 0:00: title and byline sit clear above the first lyric line (a visible gap), the tagline below; the rows of a two-line title are a little tighter than before.

### Bug fix: the Reel's moved title collided with the first lyric; title cards overlapped on the timeline ✅ (confirmed on the Windows PC in Shape, 8 Nov 2026)
- Seen (Let My Love Carry You, Shape → Reels 1080x1920, Title opening on, first line on screen from 0:00.6): after the last fix the title moved up (y ~470-630) and the byline "Life Lyrics" sat at ~636, but the first lyric ("Let my love carry yo...", hook font, word by word) was drawn at ~650-700: byline and lyric touched. On the timeline the title, byline and tagline cards (same start) were drawn on top of each other: an unreadable jumble.
- Causes: (1) the title was moved clear of a box that was smaller than what the composition draws: only line 1, measured with `nextLine: false` and without the glyphs' reach beyond the CSS row (script fonts), and only until 2.5 s, although later lines come in while the title is still on screen. The box is now the union of every line drawn in the title window (the first line, and any line entering before the cards end), with the waiting next line under it, and the glyphs' ink. It comes from `measureLyrics` (qa-check.ts), the very function QA uses, via the new `titleWindowBox`, which reads the plan's own lyric area (text layout: Centred / Lower third / Big hook), the line's card place and size, the effect reach and the hook scale; Remotion's LyricScene uses the same inputs. Evidence: Reels area centre 710 (not the 758 of the old tests); with the effect reach the box for that line starts at ~590 (Big hook ~528), not ~673 (the bare row). (I could not reproduce the exact pixels of the screenshot without the user's song: the missing reach, next line and ink are what the code was ignoring.) (2) The title-cards row gave every card `top: 2` in one 20 px lane.
- Fix: make.ts `firstLyricBox` (exported) = `titleWindowBox` (qa-check.ts) over the cards' window; measure.ts `inkOverflow` (glyph reach beyond the line box) is now in every measured lyric box (QA too). The title opening now stays on screen at least 4 s (TITLE_MIN_S 4, was 2.5; asked by the user): clear blocks keep their place that long, also with the auto section's 2-bar lead-in (~3.8 s at 125 BPM); touching blocks are moved (title + byline up, tagline down, shrinking up to 25%), else the lead-in + the note. Shape timeline: cards that overlap in time go in thin lanes (14 px each, titleCardLanes in shape-board.tsx; data-lanes / data-lane; one lane = the row as before, 20 px; three lanes ~47 px); data-text-card and the clicks are unchanged.
- Tests: title-opening.test.ts 22 (the 2.5 s tests are now 4 s = 120 frames; new: Centred / Lower third / Big hook: the title block and tagline are clear of the real box; script-font ink; the old bare box let the byline reach into the drawn line, the real one does not); the 6 files (title-opening, textboard, qa, storyboard, extra-cards, textboard-make) 60 pass; tsc clean (packages/video, apps/studio); eslint on shape-board.tsx: the same 4 old errors; pnpm build ok; storyboard.e2e.ts 149 checks pass (new: no two cards on the title-cards row overlap on screen; the e2e song has only the End card there, so the lane logic itself is checked by the build/typecheck and by eye).
- To check: `cd D:\videomaker`, `git pull`, Shape → Reels, Title opening on, play from 0:00: title, byline and tagline stay at least 4 s, clear of the first lyric line (above it, or the tagline below); on the timeline the three cards sit in separate thin lanes.

### Bug fix: the Reel's title moves up instead of flashing when the first line starts at once ✅ (confirmed on the Windows PC in Shape, 8 Nov 2026)
- Seen (Let My Love Carry You, Reel 1080x1920, Title opening on, part of the song starting on the first sung line, on screen from ~0:00.6): the tagline stayed 2.5 s, but the title and byline "Life Lyrics" (upper third, centred ~y 640) touch the first lyric line's box (two lines, centred ~y 758), so they showed only the 0.6 s lead-in and a note asked to move the song part: "too short".
- Cause: the last fix only chose between "stay 2.5 s" and "shorten to the lead-in" for the block on its default place. Where the block sits is the app's job, not the user's: other places in the safe area were never tried.
- Fix (automatic, no setting; src/node/textboard.ts titleCards): a block that touches the first line's box (same measuring as the last fix) is first moved inside the platform's safe area (and the profile grid's 3:4 crop when it fits): the title + byline UP above the line, the tagline DOWN below it, with a margin and clear of the other block; if that does not fit it shrinks step by step by up to 25% (CARD_MIN_SCALE, as fitCardBlocks). A clear place = the block stays its full 2.5 s, no note, QA "Title cards clear of the first lyric" passes. Only with no clear place: the lead-in only + the plain-words note, as before. Same props for Shape and render. YouTube and the auto section with a full lead-in are unchanged.
- Tests: test/title-opening.test.ts 18 (2 new: title moves above the line and lasts 2.5 s with QA ok, tagline moves below the line; the "line on the title" test now has the line from the top of the safe area = no room = lead-in + note); the 6 files (title-opening, textboard, qa, storyboard, extra-cards, textboard-make) 55 pass; tsc clean (packages/video, apps/studio).
- To check: `cd D:\videomaker`, `git pull`, Shape → Reels, play from 0:00: the title and byline stay about 2.5 s near the top, the first lyric line below them.

### Review: no line across the video in the browser's player ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Found by the user (8 Nov 2026): a thin horizontal line across the Reel in Review (not in Shape). The MP4 itself is
  clean (checked by the user in Media Player): it is the top edge of the dark band Chrome / Edge draw behind their own
  video controls (▶ / time / volume).
- The app's pages now draw a soft fade there instead (no edge): a small style in app/layout.tsx (the CSS build drops
  these browser-specific rules from globals.css, so it is a plain <style> tag). Review, Post and Compare players.

### Bug fix: the Reel's title did not show when the part of the song starts on a sung line ✅ (confirmed on the Windows PC in Shape, 8 Nov 2026)
- Seen (Let My Love Carry You, Reel; Shape → Reels 0:36.1-1:41.3 chosen on the song track, Title opening on): "the title is not showing", "the tagline is not showing". Line 5 ("Let my love carry you through the night") is sung at the very start of that part.
- Cause: the title opening showed title, byline and tagline only until the first lyric line fades in (make.ts passed `untilFrame` = that line's enter frame). The automatic section leaves up to 2 bars (titleLead); a part chosen by hand on a sung line leaves none, so the cards got a few frames or none, silently. Shape's plan uses the same make.ts dry run, so it showed the same.
- Fix (automatic, no new setting; src/node/textboard.ts titleCards, make.ts): with a lead-in shorter than TITLE_MIN_S (2.5 s) every card block (title + byline; the tagline) is checked against the first lyric line's box (measured as QA does). A block that does not touch the line stays on screen for 2.5 s, also while the line is shown. A block that would touch it is shown alone until the line fades in (the music and the lyric timing are never touched) and a plain note in the plan's decisions and the warnings says: "No room for the title (tagline) before the first line: start the Reel's part of the song about 2 bars earlier (drag the pink window's start on the song track) or let the app choose it (Automatic)." QA "Title cards clear of the first lyric" now only fails for a block that touches the line. The automatic section is unchanged.
- Tests: test/title-opening.test.ts 4 new (16 in the file), with test/storyboard.test.ts 24 pass; tsc clean (packages/video, apps/studio).
- To check: `cd D:\videomaker`, `git pull`, Shape → Reels, window at 0:36.1, Title opening on: the title and byline stay about 2.5 s, or the plan says "No room for the title before the first line..." and the part starts about 2 bars earlier (or Automatic).

### Bug fix: a line set by hand later disappeared from the video ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Seen (Let My Love Carry You, YouTube): "Hold on..." set by hand to 3:22.36 (stamp 3:14.76) was gone from Shape and the video; the Lyrics tab showed readable 3:22.10 and leaves 3:22.10 (zero time on screen).
- Cause: applying a hand-set start moved the start, the word tags and the sung end, but not the line's own end (end_ms, the next line's old stamp 3:18.26) when a next line existed. A start set later than that end left the end before the start, so the line was shown for no time.
- Fix: src/hand-times.ts shiftLine moves the end with the start, caps it before the next line's final start and never puts it before the line's sung end (squeezed before the next line, as before). Words and sung end were already moved as a whole.
- Tests: hand-times.test.ts (9 pass; new one failed before): a line set 7 s later than its old end keeps its length and ends before the next line, also when the next line is set by hand or pushed. Run with lyrics-view, vocal-guard, storyboard and lrc tests: 80 pass; tsc ok in packages/video and apps/studio.

### Bug fix: a hand-set lyric start was not saved after a line was removed ✅ (confirmed on the Windows PC, 8 Nov 2026)
- The user found (song "Let My Love Carry You"): they removed the line "Mmmm..." from the lyrics. The Lyrics tab then showed
  28 "You'll find your way to me" 3:12.98; 29 "Hold on..." stamp 3:14.76 (about the old "Mmmm" stamp), conf 0.52;
  30 "Floating through the night" stamp 3:18.26 (the old "Hold on" stamp), set by hand 3:25.06. Nudging "Hold on..." to
  3:22 and Save said "Saved to hints.lrc (4 line(s) set by hand)", but "Hold on..." went back to 3:14.76 (also when
  "Floating" was first set back to automatic). The user hears Hold on at about 3:22 and Floating at about 3:25.
- Causes (three, as in the brief): (A) applyHandTimes skipped a hand-set start that was after the NEXT line's stored stamp
  (Floating 3:18.26), with a message only in the log; the neighbours were compared by their stored stamps, not their
  final ones. (B) hints.lrc "!" lines are keyed by line number + text: after a removal the old numbers pointed at other
  lines ("4 line(s)" counted stale entries); an entry whose text no longer sat at its number was ignored, never followed
  its line, never cleaned, and the count included them. (C) Nothing reconciled the stored alignment with a lyrics change by
  line: any change of words = a new key = aligned again (several minutes; the stamps the user saw were the new
  alignment's guesses, which on a hummed or low-confidence line sat at the neighbours' old places). A removal now keeps the
  other lines' own timing without aligning (the cause of the exact old stamps could not be reproduced here: the aligner is not run).
- Fixed (automatic, no setting): hand-set starts are resolved by text (src/hand-times.ts resolveHandTimes: the number
  when the text still matches, else the same text on exactly one line; entries of lines that are gone go; an older entry never
  overrides the current one) and checked as a set against the neighbours' FINAL starts. The user's start wins: a following
  line not set by hand that would start before (or within 0.3 s after) a hand-set line is pushed behind its sung end
  (+0.1 s), and so on down the song; the Lyrics tab says "Moved after line N, which you set by hand". Two hand-set
  starts out of order: Save refuses, naming both lines. A start that is still not used is said so on the line and in the
  Save message. Save cleans stale entries (the old hints.lrc is kept in .studio\replaced\). Removing lines from the
  lyrics (src/node/song-project.ts carryOverRemovedLines, src/lrc.ts dropLrcLines): when the current lines fit into the
  earlier aligned lyrics in exactly one way, the new alignment is the old one without those rows (timing, confidence,
  vocal-start check records renumbered); several ways (a repeated line), added or changed words = aligned again.
  Docs: docs/lyrics.md (hand-set starts, removed lines).
- Tests: hand-times.test.ts +3 (5 -> 8 tests; the order case Hold on 3:22 with Floating at 3:18.26, both hand-set, out of
  order, by text and stale entries); lyrics-view.test.ts +3 (12 tests: removal keeps each line's own timing, adding or an
  ambiguous removal aligns again, hand-set follow-by-text + push + refusal); all 6 related files 82 passed; video typecheck,
  studio typecheck + build clean; lyrics-tab.e2e.ts all browser checks passed.
- To check on the PC: `cd D:\videomaker`, `git pull`, restart. Open the Lyrics tab: "Hold on..." and "Floating through the night" show their own
  times. Set "Hold on..." to 3:22 and Save: it stays (set by hand), "Floating..." (automatic) moves behind it with the note
  "Moved after line N"; set "Floating..." to 3:25 and Save: both kept.

### Bug fix: hummed lines ("Mmmm...") at the end of the YouTube video came too early ✅ (confirmed on the Windows PC, 8 Nov 2026)
- The user found (song "Let My Love Carry You", YouTube = whole song): the last lines are early. Lyrics tab (line, stored stamp, now, confidence): 28 "You'll find your way to me" 3:12.98, conf 0.66; 29 "Mmmm..." 3:15.00 -> 3:15.00, conf 0.74, leaves 3:18.00, but the hum is heard from about 3:18, about 3 s early; 30 "Hold on..." 3:18.26, conf 0.23 (flagged, "Checked by ear"), probably early too; 31 "Floating through the night" 3:19.44, set by hand to 3:22.04.
- Cause: a line of only a hum has no words for the forced aligner (and speech recognition cannot hear it), so the aligner puts it at a guess in the gap after the previous line (the round 3:15.00). The vocal-start check only looked at line 1, gaps, stretched first words, hooks and lines with a late voice: a hum in the middle was never chosen (`signalsFor`, src/vocal-guard.ts), and when chosen, a move needs two signals while a hum has only the voice. The line after it kept its low-confidence stamp in front of the hum.
- Fixed (automatic, no setting): `isNonLexical` (Mmmm, mm-hmm, Hmm, Ooh, Oh oh oh, Ah, La la, Na na, Woah, Yeah yeah; any punctuation / repeats / case; one other word makes it a normal line) -> such a line is always checked and starts at the voice onset on the vocal stem after the previous line's sung end (never earlier, never the recognised words, no recognition window for it). No voice found = the stamp stays and the record says so. A low-confidence line (< 0.5) directly after a moved hum, whose stamp is before or within 0.5 s after the hum's new start, is checked too and moves behind the hum (voice onset after it, else the recognised words); if nothing is found for it, the hum goes back to its stamp rather than pass it. Hand-set starts ("!" in hints.lrc) are never moved. The guard's record marks the lines (kind "hum" / "after hum"); applyGuard applies the moves last line first so the hum is not squeezed by the line that is about to move. Docs: docs/lyrics.md "Hummed lines".
- Tests: vocal-guard.test.ts +7 (recognition list; hum moves to the onset and the next line goes behind it, an ordinary line unchanged; never before the previous sung end; no voice = kept with the reason; hand-set hum / hand-set next line untouched; good-confidence next line and no recognition window; hum heard after the next line's stamp, and the hum goes back when the next line cannot be placed): 45 passed; vocal-start / lyrics group 98 passed; studio typecheck clean. No studio code changed.
- To check on the PC: `cd D:\videomaker`, `git pull`, `pnpm lyrics:check-start "workspace\songs\Life Lyrics\Let My Love Carry You" --all` (lines 29 and 30 should say "a hum ... moved to the voice onset" / "after a hum"), then `pnpm make` or Shape, and the Lyrics tab: the hum should start where you hear it (about 3:18); your hand-set start for line 31 (3:22.04) stays.

### Bug fix: the clip order in Shape after adding clips in Prepare ✅ (confirmed on the Windows PC, 8 Nov 2026)
- The user found: "The order of the clips is not respected in Shape once I add new clips during Prepare." Song "Let My Love Carry You" (Reel): after reordering in Prepare, Shape's shots 1-2 were the clips that sat there before the reorder (order #2 and #9, the second with a slip badge); from shot 3 the order was followed.
- Cause: the Shape timeline's slips (and the outer trims, saved as slips) are stored by song time + clip name, and the planner (compose.ts) forced that clip into the shot, over the story order. After a reorder in Assets or Shape (also lift and swap), the old slip kept pulling its old clip into its old shot. clips.json "order" itself was saved correctly (checked: upload, drag and drop, Shape order / swap, Remove / Restore all keep the order).
- Fixed: the story order decides which clip plays in a shot; a slip applies only when the order still puts the slip's clip there (anchored shots as before), otherwise it is left aside. compose.ts plans once without slips, keeps those that still match, plans again.
- Tests: new test/clip-order-prepare.test.ts (2: order after an upload and a Prepare reorder, Shape's own re-save; a slip then a Prepare reorder, which failed before the fix); test/timeline-edits.test.ts (2 tests adjusted to the rule, +1 check); video package 944 passed (3 files need the network: migrate / make / one more, remotion.media is not reachable here); studio typecheck clean. No studio code changed.

### Shape: faster swaps (and every edit): the planner stays running ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Asked by the user (8 Nov 2026): "make it swap faster" (after "worked, a bit slow but ok").
- **Why it was slow:** every edit started a new planner process: Node and tsx starting up (about 1.5 s in the cloud,
  usually more on Windows) and the whole song decoded again for the waveform, before any planning.
- **Now one planner stays running** while the studio runs and answers every request (the decoded song stays in
  memory, the last 3 songs). It is started again when it stopped or when its code changed (a git pull while the
  studio runs); a request it cannot answer falls back to the old one-off process.
- **The swap shows at once:** right after the drop the two shots already show each other's clip on the timeline;
  the viewer follows when the new plan is there.
- **Fixed on the way (older bug):** clicking the clip that was already selected did not show it in the viewer again.
- Measured in the browser test: the swap's new plan 0.9-1.4 s after the drop (was 2.9 s with the one-off planner).
- Tests: storyboard.e2e.ts (+1: the two shots show each other's clip right after the drop): run in the cloud
  session, all 148 checks pass (also with LYRIC_PLANNER=oneoff, the fallback).

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

**Storyboard architecture (agreed with the user, 9 Nov 2026; part of Theme v2, not a new phase).** Order inside
Theme v2: 2b part 2 (as planned) → **2d → 2e-1 → 2e-2 → 2c** → **M1 gate** (rendered from the storyboard) →
**2f → 2g → 2h → 2i** → T1-T4 and steps 3-8 as planned. Each step: plan first, the user tests on the PC, stop.
- **What it is.** The storyboard = Prepare (the user's inputs, song level) + Shape's plan (what the app decides,
  per video). Nothing is built next to them: Shape's plan (StoryboardView / StoryShot, a dry run of makeVideos)
  is saved as one versioned file per video, `<song folder>\storyboards\<platform>-<n>.json` (schemaVersion 1),
  plus `<platform>-<n>.previous.json` (one step back). Each run's manifest keeps a copy of the storyboard it
  rendered. Relative names only, no absolute paths (keeps a future one-off installer possible).
- **Contents (v1).** inputs (fingerprints of the Song / Vocals / Lyrics slots, the alignment used, clips.json);
  output (platform, 9:16 / 16:9, range full or startMs-endMs with its reason, theme name + version); analysis
  (bpm, beats, downbeats, sections: hook / verse from "* " until T1, then the Suno tags); text items with stable
  ids (kind lyric | story | card; lyric ids = textboard's `line-<n>` matched by words; cards e.g. card-cover);
  shots with stable ids (sh-NN: clip + clip fingerprint, trim in/out, startMs/endMs, transitionIn, motion
  ("theme" | "freeze"), effects, carries = a text item id, locked, assessment notes); the predicted assessment;
  history (generatedAt, app commit, previous, last change summary). All times are integer song milliseconds
  (audio = master clock; video time = song time - range.startMs); frames use the planner's own rounding
  (round trip tested frame-exact). Later, without changing v1: kind "ep" with segments (EP film + note cards),
  `<platform>-<n>.suggest.json` for AI Suggest (refers to shot ids, accepted shot by shot as locked edits).
  Not in v1: history beyond `.previous`, field-level provenance (an "Explain" view can compute it later).
- **Song level stays song level:** slots (`.studio\files.json`, v2), lyric timing (alignment + hints.lrc
  nudges, signed off; a storyboard shows it but never holds its own copy, `timing: "stem" | "hand" | "story"`),
  clip order + clip trims (clips.json, mechanism unchanged), card looks (textboard.json), theme and song.json
  settings with their locks.
- **Per video (D3):** moved cuts, slips, freeze, swaps, carries: this video only. The existing clips.json cuts /
  slips are imported once into each storyboard as locked fields; anchors become a locked `carries`.
- **One render path:** storyboard → LyricVideoProps (the contract, one pure compile) → HyperFrames for preview
  (Shape viewer, low res / fps, same composition) and export. Make never plans again at render time (today it
  does: the bypass this removes). **Remotion is frozen as is** (no adapter: it reads the same props), used only
  for what hyperframesGaps() lists (YouTube layouts, Canvas, logo…) until step 6, the reason said on the video;
  plus a one-click "Render with Remotion" escape hatch on studio Reels until the M1 gate passes.
- **Three layers:** global quality rules (platforms.json safe zones incl. Instagram's UI areas, Craft Rules,
  export specs) adjust and report ("Done for you") only app-generated values and only WARN on locked ones (D7);
  Theme (look and behaviour, referenced by name only); storyboard (per-video decisions; locked values always
  beat the Theme). The Reverse Engineer writes only themes\<name>\theme.json + analysis.json, never storyboards.
- **Locks and regeneration.** A change made in Shape locks that field automatically; ↺ Automatic unlocks.
  Regeneration rewrites only unlocked fields (locked ones are fixed points, like anchors today); shot ids kept
  by same clip + most overlap (the 200 ms matching of timeline-edits.ts), line ids by the textboard matcher;
  the old file becomes .previous (atomic write), "Back to previous version" swaps them; input fingerprint
  changes are reported, never regenerated silently; every regeneration shows a plain change summary ("12
  lyric timings moved, 2 locked shots kept, clip 07 missing"). Conflicts (locked wins, flagged in the
  assessment): (A) a new Theme's shot lengths: locked shots keep start / end / clip, only the gaps re-cut, a
  note when a gap can't meet the theme's range; (B) re-sync moves a line a locked shot carries: the text follows
  the sync (hand-set lines never move), a locked shot stays and gets "no longer carries line N" (a locked
  `carries` alone: the shot follows the line); (C) clip deleted: its shots marked missing, render blocked with
  Restore / re-plan; replaced (same name, new fingerprint): fitting trims kept with a note, a locked trim past
  the new end blocks that shot; new clip: end of the order as today, "not used until you regenerate".
- **Slots and input gate (Prepare).** Three slots (Song, Vocals, Lyrics) pre-filled by a simple guess (file
  type, "vocal" in the name, most recent file), confirmed or replaced by dragging / picking, saved in
  `.studio\files.json` v2 (confirmed, fingerprints, measured offset). Lyric sync waits for all three (Vocals
  optional for instrumentals; Lyrics holds the story, no longer the fixed name story.txt). The existing stem
  line-up (cross-correlation, mix-time copy, ±1% speed) stays the offset mechanism; the offset is shown in plain
  words ("the vocal file starts 1.2 s later than your trimmed song, aligned automatically"). Blocking: an empty
  slot; a stem that does not line up (no more silent Demucs fallback, D2) or that has no voice in it (a Suno
  instrumental stem lines up with the mix too); missing / unreadable media; invalid timing; lyrics that don't
  match the vocal = more than half of the sung lines below the aligner's existing "check this line" confidence
  (0.5), checked against the user's four timed songs in 2c (D9). Explicit opt-in on a blocked Vocals slot:
  "Use the app's own vocal separation for this song" (Demucs; never automatic, never silent; recorded in
  files.json and shown on the slot). Advisory only (notes on the shot): low resolution, aspect mismatch, heavy
  crop, softness, clip too short for its section. Old songs keep their stored timings and the fixed-name fallback.
- **Approval view (Shape).** A numbered shot list as the default view: per shot a HyperFrames thumbnail with
  its lyric / card, the time, the text it carries, 🔒 per locked choice, the notes; actions reorder, trim,
  freeze, swap, lock / unlock, Regenerate, Back to previous version. The timeline stays under "Advanced timeline".
- **Tests.** Golden: the manifest of the user's approved "Here with Me" Reel (copied by the user to
  packages/video/test/golden/here-with-me-reels.manifest.json) → storyboard → props gives identical lyric and
  cut frames. Slots: pre-fill, manual replacement, trimmed mix vs untrimmed stem offset, a stem from another
  song, an instrumental stem (synthetic Suno-named files in the cloud; the user's two full Suno stem sets in
  workspace\test-suno\ on the PC, names to be sent by the user). Regeneration keeps locked fields and ids; the
  change summary matches a computed diff; ms ↔ frames round trip.
- **Steps:**
  - **2d Save the plan:** storyboards written for every planned video, today's edits imported; any moved cut or
    slip that cannot be matched to a shot is listed for the user by song and shot (never dropped silently); no
    visible change otherwise; golden timing test.
  - **2e-1 Make reads the storyboard, still on Remotion:** Make, release pack and preview compile from the
    file; output identical to today (checked against the golden manifest and a re-render).
  - **2e-2 Studio Reels on HyperFrames:** fallback with the reason for what it can't draw; one-click "Render
    with Remotion" until M1.
  - **2c Slots and the blocking gate** (above), incl. the opt-in separation button and the D9 threshold.
  - **M1 gate** as in the plan, now rendered from the storyboard.
  - **2f Locks:** Shape's roll / slip / trim / freeze / swap / carries write into the storyboard and lock.
  - **2g Safe regeneration:** merge, conflict notes, change summary, Back to previous version.
  - **2h Per-shot assessment:** the advisory checks on each shot; blocking items in Prepare's to-do list.
  - **2i Approval view:** the numbered shot list; the Shape viewer on the HyperFrames composition (the Shape
    part of plan step 7).

**Theme Engine v2 on HyperFrames (adopted 6 Nov 2026; plan approved the same day).** The order is the plan
docs/theme-engine-v2-hyperframes-plan.md, section 6: step 0 ("break." fix, done) → 1 (renderer seam; D1 decided = (b), everything
in one pass; its speed and frame accuracy checked on the PC, causes fixed, (a) only a temporary fallback; zero network
calls when rendering; LGPL FFmpeg with NVENC timed; done: B 92% of Remotion's time on the PC) → 2a (picture for Reels, done, confirmed on the PC) → 2b (part 1 done: the lyrics and cards with the same code; part 2 done 9 Nov 2026, to verify: stacked lines, build up, bigger final hook, theme-rules.md) →
2b (the Reel word-by-word theme's text) → the storyboard steps 2d (done 9 Nov 2026, to verify) → 2e-1 → 2e-2 → 2c (above) → **M1: the Reel word-by-word theme ("Here with Me") usable for real
releases** → the storyboard steps 2f → 2g → 2h → 2i → the spec's T1-T4 → 3-8, the ballad and Pômé themes. GSAP / FFmpeg licences non-blocking: a short
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
