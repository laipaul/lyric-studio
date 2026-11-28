# History — every step built so far

_Moved from PROGRESS.md on 30 Oct 2026 (tidy-up), word for word. PROGRESS.md keeps the agreed order, open issues, backlog and the latest steps; finished steps move here._

## Steps done

### A Mini film makes its two films: Film 9:16 (Instagram) and Film 16:9 (YouTube) ✅ (to verify on the PC)
- Paul (23 Nov 2026): "if I start with a mini film then there is no option to make reels, shorts etc because this is
  against the whole purpose … I plan to release the mini films both on IG and YT … Mini film is by default the song's
  length both planned for IG and YT". Chosen: both formats.
- **The song style decides the product.** A song in the style **Mini film** makes only its two films, each the whole
  song shot by shot: **Film 9:16** (1080x1920, Instagram's safe zones) and **Film 16:9** (1920x1080, YouTube's). Make
  offers only these two chips (both on until the song names one); Shape's dropdown the same; pnpm make turns any other
  platform asked for into the two films. Cut to the song and Add singing songs never offer them, and make Reels,
  TikTok, Shorts, YouTube and Canvas as before (presets/platforms.json "film", "film-wide"; platform.ts
  platformsForStyle; node/song-style.ts isWholeStory: Mini film only; a shot list alone no longer counts).
- **Two takes per shot.** Production: each shot shows "9:16" and "16:9" (green with a take, grey without), and has
  "Copy prompt 9:16" and "Copy prompt 16:9" (the same shot, --ar 16:9). "Use for shot N" sees the take's shape: a
  vertical take fills the 9:16 film (Storyboard, lyric line, as before), a landscape take is the shot's take in the
  16:9 film (shotlist.json "filledWide"; the one it replaces goes to Omit). Each film plays the same cards with the
  same timing, its own takes; a shot without a take of that shape shows its stand-in (a film is never refused for
  having no landscape takes yet).
- Code: film-plan.ts filmItems (a planned shot is one card, its take per shape), make.ts (filmStandIns), library.ts and
  storyboard.ts (the offered platforms), shot-production.ts (filledWide, promptWide, useForShot), pictures-board.tsx.
- Tests: film-plan.test.ts (the two films, the 16:9 film all stand-ins), shot-production.test.ts, song-style e2e (Make's
  chips).
- On the PC: Song Details → Mini film, then Make: two chips, Film 9:16 and Film 16:9. Production: Copy prompt 16:9 for a
  shot, make it in Midjourney, drop it, Use for shot N: the shot's 16:9 badge turns green.
- Backlog (Paul): a long film (about 10 min) with several songs as its soundtrack.

### Step B: a Mini film plays shot by shot ✅ (to verify on the PC)
- Paul (23 Nov 2026): "the shots no longer match the lyrics … maybe because we don't have the full 38 shots it goes in
  circle and fills in the gaps". For a music Reel the app cycles the clips over beat cuts; a Mini film is a story.
- Now, for a story song (Mini film, or a shot list on lyric lines not set to "Cut to the song"), on every platform
  except Canvas, **every card of the story line (Prepare → Storyboard) is ONE shot**, in that order:
  - a card on a lyric line (its shot's line, else the line its clip is anchored on) starts when the line appears, cut
    on the beat at or just before it (at most 0.2 s after it); cards without a line share the time of the card before
    them (before the first line: the intro): the shot grid's rule;
  - **each take plays once, on its own card**: no cycling, no repeats, no take filling another card's moment; the
    variations (v2, v3) keep the same cuts (they differ in look and transitions);
  - a planned shot **with no take yet shows a stand-in**: its first person's reference picture, dimmed and softened
    (else a dark frame), named "Shot N · no take yet" on the Shape timeline; the plan says "Mini film: 39 of 45 shots
    have no take yet (shots 7-45): they show a stand-in until you use a take for them in Creation → Production";
  - a card with no room of its own (too close to the one before, or to the end) is left out and said; a card on a line
    wins over a card without one just before it.
  - a **part of the song chosen by hand** (the pink window, e.g. a 60 s chorus Reel) plays only the cards inside it, in
    order; the card already playing when the part starts opens it (Paul: "I still can use my mini film and create a
    normal reel right").
- Code: node/film-plan.ts (filmItems, filmCuts, standInPicture), make.ts (the film block: the plan's cuts, stand-in
  clips, no anchors / gap filling / loop blend), compose.ts (RenderBase.filmShots), storyboard.ts (stand-in names).
  The plan cache key includes the shot list. Singing takes (lip sync) in a Mini film are placed as ordinary shots for
  now (not frame-locked to the song): to look at when a Mini film uses one.
- Tests: film-plan.test.ts (pure rules, a real plan and Make with 2 variations, Shape's shot names).
- On the PC: Shape on "Something About You And Me": shots 1-6 play your six takes, each once, on its line; from shot 7
  the stand-ins (Jennifer / the Bridegroom dimmed) follow the 45 cards; the Analysis lists the shots without a take.

### Step A: the shot grid: the song decides the timing, the story fills it ✅ (to verify on the PC)
- Paul (23 Nov 2026): "suppose we had to start again. You need to analyse the full song and plan each shot list
  according to the length of the song". The Mini film showed takes repeating and drifting off their lines because the
  shot list did not fit the song's timing (a 14 s intro with one shot, long lines with one 5 s take).
- **Shot grid** (src/shot-grid.ts shotGrid, pure): the whole song, 0:00 to its end, cut into shot moments: the intro,
  every lyric line (until the next line starts), instrumental breaks of 4 s or more, the ending. A moment under 2 s
  joins its neighbour; one over 8 s (one take) is split into parts of about 5 s on whole bars. Each moment has its id
  (s01…), time, length, section (Intro, Verse 1, Chorus, Instrumental, Ending) and lyric line(s).
- **Song brief for Claude** (Creation → Story room) now has a "Shot grid" section and asks for one shot per moment,
  same id, order and line (the second part of a long line has no line: it follows the shot before). The take line
  says Midjourney video (5 s, extendable) or Seedance (4-10 s), no longer only Seedance.
- **Checking or importing a shot list** (Story room paste, Storyboard → Import shot list) adds warnings in plain words:
  "s01: lasts 14.0 s (the intro): one take is about 5 s. Extend its take to 14.0 s, or add 2 shots after it (without a
  line)", or "only 1.2 s: a flash, join it with a neighbour". Never blocking (node/shot-timing.ts withTiming).
- **Production**: every shot says how long its take must be on the song, "0:14.0 · needs a 4.8 s take", in amber when
  it is longer than one take ("needs 10.4 s: extend the take, or add a shot after it") or a flash (slotSpans: a shot
  on a line lasts until the next shot on a line; shots without a line share the time of the one before them).
- Tests: shot-grid.test.ts (8), production.test.ts (the brief's grid), creation-production e2e (the length), shotlist
  and production e2e still pass.
- On the PC: Creation → Production on "Something About You And Me": each shot shows its length; the amber ones are the
  shots to extend or split. Story room → Copy Song brief: the "Shot grid" section lists the moments for Claude.
- Next (Step B, agreed): Shape and Make play a Mini film shot by shot: each take once, on its own shot, no cycling;
  an empty shot shows a stand-in.

### A Mini film is the whole song on every platform ✅ (to verify on the PC)
- **Where am I** (same day, Paul: "then how do I know where I am?"): every stage's header now names the song style
  next to the stage, e.g. **"Shape · Mini film · whole song · Reels v1 planned"** (or "Cut to the song", "Add singing");
  a click opens Prepare → Song Details, where it is set. song-style.tsx SongStyleChip; song-style.e2e.ts checks it.
  Note: storyboard.e2e.ts "the last shot is marked as the Reels loop ending" fails in the cloud; its song has no shot
  list and no Mini film, so this change does not touch it (to look at separately).
- Paul (23 Nov 2026): "the shots are not in order in Shape now". The Reel opened on shot 7: a Reel's automatic part of
  the song starts just before the first chorus, so shots 1-6 were before it. Then, decided by Paul: "the mini film is the
  equivalent of me wanting to create a video for the whole song … I pick the format Reel, YT, etc and I want the whole
  song, don't limit me, I decide".
- Now a story song (song style **Mini film**, or a song with a shot list on lyric lines that is not set to "Cut to the
  song") plays the **whole song, 0:00 to its own end, on every platform picked** (Reels, TikTok, Shorts, YouTube), with
  no platform length: no fade at either end (the song's own start and end). The plan's reason says "whole song … (a
  Mini film: the whole story on every platform)". A part chosen by hand (the pink window) still wins; "Automatic" gives
  it back. Spotify Canvas keeps its short loop. Cut to the song and Add singing songs without a shot list keep the
  hook-first part.
- Code: make.ts isWholeStory, chooseSection (wholeStory). Tests: whole-story.test.ts, shot-production.test.ts.
- On the PC: Shape on "Something About You And Me" (Reels): the readout says "Song Reels: 0:00.0 – <song length>"; if
  it says "chosen by you", press Automatic. Note: Instagram and YouTube Shorts accept up to 3 min per video; a longer
  song is yours to decide (post it, or drag the pink window to a part).

### Get Latest Lyric Studio: one double-click to update ✅ (to verify on the PC)
- Paul (22 Nov 2026): "can u create a shortcut I can double click instead of doing manually" (git pull lyric main,
  git push, restart). **Get Latest Lyric Studio.cmd** in D:\videomaker: gets the newest code from the lyric-studio copy
  on GitHub, copies it to videomaker so both match, protects keys typed into .env.example, runs pnpm install and
  restarts the app (it rebuilds first). Songs and clips (workspace) are never touched. Run **Create Desktop
  Shortcut.cmd** once to get a "Lyric Studio - Get Latest" shortcut on the desktop as well.
- Code: scripts/update.mjs (--from, --copy-to, updateArgs), Get Latest Lyric Studio.cmd, Create Desktop Shortcut.cmd.
- Tests: vitest update-script (+1); checked with local test repos: pull, copy, and a failed copy that still updates.

### Creation: Story room | Production, each Storyboard item made in its place (C3 Part 1) ✅ (to verify on the PC)
- Paul (22 Nov 2026), Something About You And Me: "Creation should be creating the pictures and video takes for each
  Storyboard item", with the story tools as the guiding line and "another folder for the actual production engine room".
- A Mini film song, or any song with a shot list: Prepare → Creation has two folders. **Story room**: Film look, your
  defaults, cast, story bible, Song brief, shot list. **Production**: the shot list's items in story order, grouped by
  the song's sections (Intro, Verse 1, Chorus...), each with its number, line and words, people, what happens, and
  "To make" / "Filled". Drop a picture on a shot (or pick one already in Creation): it belongs to that shot. Animate
  there as usual; **Use for shot N** fills the Storyboard item: the take takes the slot's place in the story line and
  goes on its lyric line (a line a singing take covers keeps its singer). Another take for the same shot replaces it
  there (the earlier one set to Omit, kept). "N of M shots filled" at the top; loose pictures below. Opens on Production
  when the song has a shot list; the last folder is remembered per song. Other songs: Creation exactly as before.
- A re-import of the shot list keeps filled shots filled (shotlist.json "filled"); Remove all planned slots takes out
  the empty ones only.
- **Copy prompt** (Part 2a, same day; Paul: "that doesn't give me the prompt for MJ"): every shot has its Midjourney
  first-frame prompt, written by the app (src/shot-prompt.ts): framing + what happens (names replaced by "the woman" /
  "the man"), each person's locked description and the outfit of the look they wear (or the shot's own outfit), the
  scene card, a memory's softer feel (#memory), the Film look's Midjourney words, --ar from the song's platforms,
  --style raw; "Never …" sentences become --no; reference-model instructions ("Preserve…", "Match … reference
  image") and behaviour sentences ("resting expression…") are left out; two people are labelled. Copy prompt +
  Show prompt on each shot. Tests: vitest shot-prompt (5), browser creation-production (+2 checks).
  Fix the same day: a Film look's own Midjourney settings (--ar 9:16 --style raw --stylize 100) were added twice; now
  merged, each once (the song's --ar wins, its others kept, its --no items joined). vitest shot-prompt (6).
  Fix the same evening (Paul: "all your prompts are being rejected by MJ"): the person descriptions (age, ethnicity,
  build, lips, skin) made Midjourney's moderator refuse the prompts. Now the prompt has NO face or body words, only
  what happens, each person's outfit (the look they wear, or the shot's own), the place, the memory feel and the Film
  look; the face comes from the person's locked picture as Midjourney's Omni Reference: each shot shows it next to
  Copy prompt (the look's close-up, else its front view, else the card's picture; click copies the picture to paste
  into Midjourney). Paul's test prompt without descriptions passed. Tests: shot-prompt (6), creation-production (+2).
  23 Nov 2026: still refused on the navy cocktail look ("nude pointed heels", "thin straps", "cowl neckline"):
  outfit and action words now go through a Midjourney-safe pass (shot-prompt.ts mjSafe: nude -> soft beige, sheer ->
  delicate, thin straps -> delicate straps, slip dress -> satin dress, corset -> structured, off one shoulder ->
  off-shoulder, open to the waist -> open; sentences about makeup, lips, skin, body, and "Barefoot." left out).
  vitest shot-prompt (7).
- 23 Nov 2026 (Paul: "once I move the shot it loses the story line"; "we have to be careful when sending a shot to the
  storyboard"): a filled Storyboard card keeps its shot's story (what happens, Shot N, type, people, line, #tag;
  story-line.ts StoryItem.shot, assets-tab data-clip-shot). On a shot in Production there is no Send any more: a
  still picture has **Use picture for shot N** (it fills the shot as a photo), a video or take **Use for shot N**, both
  in the shot's place; Send to Storyboard stays on the loose pictures only. Tests: shot-production (7),
  creation-production (+2 checks).
- 23 Nov 2026 (Paul: "how can I remove a picture here"): **✕ on every Creation picture**. On a shot: "not for this
  shot", the picture goes back to the loose pictures. On a loose picture: **Put aside** (confirm): its file moves to
  pictures\_removed\, its record (takes, mood, shot) stays; **Put-aside pictures → Restore** brings it back on its
  shot. Clips already in the Storyboard stay. Nothing is deleted. animate.ts removePicture / restorePicture, API
  remove-picture / restore-picture. Tests: shot-production (8), creation-production (+3 checks); pictures.e2e passes.
- 23 Nov 2026 (Paul: "a viewer that automatically plays all shot 1 takes at once", "like in MJ, clicking one video
  plays all 4"): **Compare a shot**. A shot with 2+ candidates has "Compare N", and clicking any of its videos or takes
  opens the same viewer: every candidate side by side (videos and finished takes playing, pictures as stills),
  started together and looped in sync when the longest ends; on a timed lyric line the song plays from half a second
  before the line (switchable); Play / Pause all, From the start, Space; "Use for shot N" under each tile, ✓ on the
  one in use. pictures-board.tsx ShotCompare; shot-production.ts withLineStarts (API adds lineStartMs). Tests:
  shot-production (+1), creation-production (+4 checks).
- 23 Nov 2026 (Paul: "on the storyboard I should see the right wardrobe of each character"): **a look per shot**.
  One helper (node/shot-looks.ts) decides which look each person wears in a shot: shotlist.json slot "looks"
  ({ "Jennifer": "Wedding Dress" }, from the shot list or chosen in Production), else the song's cast look, else the
  main look. The Storyboard's planned cards show each person's picture in that look with its name on the tile, the
  people line reads "Jennifer · Wedding Dress", 5+ people show 3 and "+N"; Production has a look dropdown per person
  per shot; the Midjourney prompt's outfit and the Omni Reference picture follow (a look chosen for the shot wins over
  the shot's "outfit" text, which then applies to people without one). Problems said on the shot and the card (no
  such look, look not locked). The shot list check accepts "looks" (names as the card spells them; unknown looks
  warned), a re-import keeps looks chosen in Production, the Song brief lists each character's wardrobe and the field.
  Tests: shot-production (11), shotlist / production / story-line / shot-prompt pass; browser creation-production
  (+4 checks), shotlist and production pass.
- 23 Nov 2026 (Paul: "the father's hand shot is not very good": Midjourney drew the back of the gown and an embrace):
  the prompt keeps only the part of an outfit the framing shows (shot-prompt.ts outfitFor): detail = sleeves, cuffs,
  gloves, rings, bracelets, watch, bouquet; close-up = no skirt, train, trousers or shoes; medium / wide / motion =
  all of it. The action stays first. vitest shot-prompt (+2).
- 23 Nov 2026 (Paul: "the pictures and videos from MJ are still the best"; both asked for): **Open in Midjourney ↗**
  on every picture or video whose name holds a Midjourney job id (animate.ts midjourneyLink:
  midjourney.com/jobs/<id>?index=<n>). **Bulk drop by shot**: files dropped anywhere in Creation whose name starts with
  their shot ("s05 …", "S05_", "s5", "shot 5 …", "Shot1Chapel…") land on that shot (shot-production.ts
  shotForFileName / placeByName); others stay loose; dropping on a shot still wins; the notice says where each went.
  Tests: shot-production (14), creation-production (+2 checks), pictures.e2e passes.
- Part 2 (next): cost so far / to go.
- Code: node/shot-production.ts (productionView, setPictureShot, useForShot, sectionsOfShots), shotlist.ts (filled),
  animate.ts (pictures.json "slot"), API /api/songs/<id>/pictures (production, slot, shot, use-shot),
  pictures-board.tsx (part: all | settings | production; ShotItems, ShotRow, Use for shot), production-tab.tsx (folders).
- Tests: vitest shot-production (6); shotlist, animate, line-only, story-line, production, no-remotion pass. Browser
  creation-production (14 checks, in test:e2e); pictures, production, shotlist, singer, song-style, song-stages pass.
  Studio build passes.

### Fix: "Lower third" really sits low ✅ (to verify on the PC)
- Paul (22 Nov 2026), The House My Heart Built and Wedding Day: with the theme's Text layout on Lower third the lyrics
  still sat in the middle, across the faces. Cause: "lower" put the block's centre at 0.68 of the area left by the
  platform's safe zone; Reels keeps its bottom 35% clear (Instagram's guidance), so that was 49% of the screen
  (TikTok 51%, Shorts 55%, YouTube 63%).
- Now "lower" puts the block's bottom edge (its last row, the waiting next line, a text box's padding) 1.75% of the
  frame above the safe-zone line; lines of 1-3 rows grow upward. Block bottom: Reels ~63%, TikTok ~68%, Shorts ~73%,
  YouTube ~88% of the screen. Centred and Big hook unchanged. Preview and render share the same code (LyricScene).
- Code: platform.ts (LyricArea anchor, lyricCenterY), text-layout.ts (LOWER_MARGIN), LyricScene.tsx, effects/scene.ts
  (a glide's waiting line keeps its place), qa.ts / node/qa-check.ts (the safe-zone check measures the real block).
- Tests: vitest text-layout (7: every platform, 1-3 rows, Big hook, next-line preview), 280 related tests pass; browser
  title-opening and textboard pass. Full suite: only the 7 known failures (network / real rendering). Build passes.
- Known: hook and end cards that share the lyrics' place use a typical block height, so they can sit a few px off.

### Shape shows every platform with a saved shot plan ✅ (to verify on the PC)
- Paul (22 Nov 2026): after choosing only YouTube in Make, Shape's platform list had YouTube only, so the Reel
  could not be opened in Shape. Shape's list followed Make's chips.
- Now Shape lists Make's platforms first, then every other platform that has a saved shot plan for the song
  (storyboards\<platform>-<n>.json; not Try other looks or .previous plans, never the Canvas), marked
  "Reels · not selected in Make" (Make does not make it until its chip is on). It opens and edits as usual, with as
  many videos as it has saved plans. Make is unchanged.
- Code: node/storyboard.ts (savedPlanCounts, storyboardChoices notInMake, storyboardPlan's count), shape-board.tsx.
- Tests: vitest video-counts (+1); browser shape-platforms (4 checks, in test:e2e). make.test's 2 failures are the
  same as before this change (they need network / real rendering). Studio build passes.

### Fix: theme names cut off on the Themes page ✅ (to verify on the PC)
- Paul (22 Nov 2026): tiles showed "Midnight Hi...", "Mou...", "Paper ..." because the badge ("Shared by 2 songs",
  "Only Tea with the monk test") shared the name's line and never shrank.
- Now the full name is shown (up to 2 lines, the full name on hover), the badge on its own line below it; a badge
  wider than the tile ends in "..." (full text on hover). Tiles and grid unchanged. Code: themes-view.tsx ThemeTile,
  theme-reach-badge.tsx (also used in Shape -> Theme: looks the same for normal badges).
- Checked in a browser at 1850 and 1280 px. Studio build passes. Known: apps/studio/e2e/themes.e2e.ts "the top menu"
  check is out of date (expects Library · Themes · Collections · Releases; the menu also has Film looks and Characters).

### Hide a moment of a singing take ✅ (to verify on the PC)
- Paul (22 Nov 2026): "the first 5 s are perfect, then 6 to 8 the lips are not in sync, then they get perfect".
- Lyrics Sync → Shows clip, under a singing clip: **Hide a moment** opens the clip panel with *Hide from __ to __ s of
  the take* (the seconds the take's own player shows), then the clip that shows meanwhile (Creation takes first; one
  not in the Storyboard yet is sent there). The line lists "6–8 s hidden by TheEnding · Take 3" with ✕; **Preview**
  plays the take with the song, the cover clip over the hidden moment.
- Make and Shape (the same planner): away to the cover clip on the beat at or before the moment, back to the singer
  on the beat at or after it; the singer's frame is the song's, so the lips are in time again. The song plays on
  untouched. Several moments per take; overlaps refused; a moment that does not fit is named (QA conflicts / notes).
  A cover clip set to Omit or removed: the moment is not hidden, said plainly. Choosing another take (Use this take)
  starts without hidden moments (they belong to a take).
- Code: anchors.ts HideSpec / ResolvedHide, checkAnchors "hide", planAnchors hide cuts; make.ts resolves the cover
  clips; lyrics-tab.tsx saveHide / AnchorPicker hide mode; components/hide-preview.tsx.
- Tests: vitest anchors (+2: cuts on the beats and the singer's frame back in time; song.json checks); browser singer
  (+3: saved and shown, preview, ✕), lyrics-tab pass.

### Long singing takes in parts of about 8 s ✅ (to verify on the PC)
- Paul (22 Nov 2026), from Joey's pipeline ("cut vocals into exact clips between 4 and 10 seconds"): the line 32 take
  (23 s) drifted at 6-8 s. A group's piece of voice longer than 10 s is now made in **parts of about 8 s** (4-10 s),
  cut on a downbeat, a pause between sung lines first. Each part is its own InfiniteTalk request with its own short
  vocal; part 2 starts from **the last frame of part 1** (no jump where they meet), and so on; each part is cut to its
  exact song length and they are joined into **one take**, locked to the song as before (Retake, compare, Use this
  take, ▶ with the song unchanged).
- The cost says it before sending: "23 s · 720p · about $1.44 · in 3 parts of about 8 s" (each part billed at least
  3 s, whole seconds); a take says "3 parts". A video source in Who sings stays one request (its motion cannot be
  chained). A part already sent is fetched again for free if the studio stops.
- Code: singer.ts singingParts / singInParts / fitLength / joinParts; take "parts" (each with its request id).
- Tests: vitest animate (+2: the cuts, the chain from the last frame and the exact joined length); browser singer
  (+2: "in 2 parts" with the cost, the take made in 2 parts at its exact length), lyrics-tab pass.

### Clean up takes: put aside, never deleted, with Restore ✅ (to verify on the PC)
- Paul (21 Nov 2026): "I need a cleanup button for the takes".
- Creation card: **Clean up N takes** puts aside, after asking, the failed takes and the takes not chosen: a singing
  take not in use (never sent, or its Storyboard clip on Omit: it never plays), an Animate take never sent. A small ✕
  on such a take does it for one take. **Never touched:** the take in use, takes on a line, takes playing in the
  Storyboard, takes being made, a take still to collect (Get result).
- Put-aside takes leave the card and Lyrics Sync; their files move to pictures\takes\_removed\ (a Storyboard clip on
  Omit stays as it is). **Removed takes (N) → Restore** brings any back with its file. Take numbers keep counting past
  them. Nothing is deleted.
- Code: animate.ts takeUse / removeTakes / restoreTake / nextTakeN, pictures.json "removedTakes"; POST
  /api/songs/[id]/pictures { action: "cleanup", file, n? } / { action: "restore", file, n }.
- Tests: vitest animate (+1: the rules, files moved, numbers, Restore); browser singer (+2: Clean up after asking,
  Restore), pictures pass.

### Creation's player plays a take with the song ✅ (to verify on the PC)
- Paul (21 Nov 2026): "why can't I hear in Animate both the song and video, it'd be easier to check" / "else I need to
  juggle back to Shape". Takes stay silent files (the music is never changed, the vocal never kept); the player now
  plays the song file with them: a singing take from its own first frame (where its vocal starts), an Animate take
  shown on a line from the downbeat that line cuts to it. Play, pause, seeking and the end keep them together (a drift
  above 80 ms is set right). "With the song" switch (on by default); a take on no line plays alone with a note.
- Code: singer.ts withSongStarts (songFromMs / clipInS / songWhy per take, added by GET /api/songs/[id]/pictures);
  components/with-song.tsx.
- Tests: browser singer (+2: a singing take plays with the song from its first frame, an Animate take on a line from
  its cut), pictures pass.

### Fix: Who sings showed a take "In use" after a plain clip replaced it ✅ (to verify on the PC)
- Paul (21 Nov 2026, line 32): Who sings said "Take 1 · In use" while Shows clip had TheEnding · Take 3. Saving a
  clip on a line reloaded only the Shows clip column; the singing column kept its old view. A line holds one thing:
  the plain clip had replaced the singer. Now Who sings reads again after every clip saved or removed on a line, so
  it shows "Use this take" at once.
- Tests: browser singer (+3: accept the question, the singer column follows without a reload, Use this take brings
  the singer back), lyrics-tab pass.

### Show a take, not a clip: Creation's takes in the line's clip panel; the Creation card says where each take shows ✅ (to verify on the PC)
- Paul (21 Nov 2026): "that's confusing, I want to show the take, not the clip" / "the app is confused now". The
  "Show a clip" panel listed anonymous clip files (studio-swea… 12.6 s, 11.2 s, 5.0 s); singing takes looked like
  Take 6; a take had to be sent from Creation first.
- **From Creation, first in the panel:** every finished Animate take as a take ("Take 6" over "studio-sweater-v2-2k"),
  sent or not (an unsent one plays on hover). Choosing one not in the Storyboard yet sends it and puts it on the line
  in one step (after the singer question, if any: Cancel sends nothing). **Singing takes are not offered** (they go on
  their own lines through Who sings → Use this take). The rest is "Your other clips", then the collections.
- **On the line** the "Shows clip" column names it as a take ("studio-sweater-v2-2k · Take 6").
- **Creation card:** each take says where it shows: "On line 15" (Animate take on a line), "In use · lines 15-16"
  (singing take), "In Storyboard, on no line", or Send to Storyboard.
- Tests: browser singer (+5: takes first and named, no singing take offered, unsent take sent and placed in one step,
  dismissing sends nothing, the card says On line 1), lyrics-tab, pictures pass; vitest animate, ending pass.

### Fixes: the line's clip picker always in view; a plain clip on a singing line asks first ✅ (to verify on the PC)
- Paul (21 Nov 2026): "from here I don't see all my takes" / "I can't see take 6". The Lyrics Sync "Show a clip" picker
  opened as a row inside the lines table, which scrolls on its own: near the bottom, the clip rows (Take 6 was the last
  one) were hidden below. It now opens as a panel over the page, always fully in view; its clips scroll inside it.
- Saving a plain clip on a line of a singing group took the singer off the whole group without a word (Take 4, lines
  25-27). It now asks first: "Line 25 is sung by a singing clip on lines 25-27. Showing this clip removes the singer
  from lines 25-27 (… set to Omit; it stays in Creation, and "Use this take" in Who sings brings it back). Continue?"
  A clip on a later line of a group (e.g. 26) no longer leaves two clips on one line.
- Tests: browser singer (+2: picker inside the window, asks first and No keeps the singer), lyrics-tab pass.

### Lip-sync takes panel; Jump to Creation; lights-dim ending ✅ (to verify on the PC)
- Paul (21 Nov 2026): "a pop up window when we press Make lipsync like what we see in Creation" and "end the reel
  [with] her whispering and fading with the studio light going to dim".
- Lyrics Sync: Make singing clips, Retake and a line's new **Takes** button open a takes panel (top right): the
  picture, "being made" while a take runs, every take with ▶ (with the song) and Use this take, and **Jump to
  Creation** (opens Creation on the picture card). Esc / ✕ close it. Under a line's takes the same link as a note.
- Lights-dim ending: a Reel / TikTok / Short that ends on a fade or ring-out now also takes the picture to black
  over the same frames as the music fade; the lyrics stay on top, so the last word is the last thing seen. Loops are
  unchanged. QA does not count that black as a fault.
- Wedding Day: Reel section end 2:27.7 → 2:30.0 (her whispered "too" fades out by 2:29.7); line 37 "I've spent so
  long wondering" hand-set to 2:30.85 (the aligner had put it on the whisper at 2:29.0, so the old end cut it).
  The plan now ends on "And today is yours too" with a 1.9 s fade of music and picture.
- Tests: packages/video test/end-dim.test.ts (new, 4); apps/studio e2e/singer.e2e.ts extended (panel, Esc, Takes,
  Jump to Creation; not run here: it needs a fresh studio build). Note: test/make-reference.test.ts fails on this PC
  with and without this change (normalised clip names differ): not caused by it.

### Softer Reel endings: a ring-out bar on a hand-chosen part, longer soft fades, QA for an abrupt stop ✅ (to verify on the PC)
- Paul (21 Nov 2026): "the sound at the end of the reel ends too brutally". The part was chosen by hand (0:48.9 –
  2:27.7) and ends on loud music. The app never changes the music's volume; it only fades where it cuts the song. A
  hand-chosen end could not move, so with a word sung up to the end the fade fell to 0.3 s (or 0.12 s for a loop).
- **Ring-out on a hand-chosen part:** when there is little room after the last word, the last chord now rings out one
  more bar and fades over it, as for an automatic part (only a bar with no sung words, within the platform's length:
  Reels up to 120 s). Shape's plan says "+ one ring-out bar to …".
- **Longer soft fades:** a soft fade is now at least half a bar (at most 1 s). With no room after the words it takes the
  tail of the last word, never an earlier word, rather than a 0.3 s drop.
- **QA "Loop flows":** a loud-to-quiet jump with a fade under 0.5 s stays a WARN, with the creative fix in plain words
  ("end the part a bar after the last sung word, or let the app choose it (Automatic)").
- A tight loop (the end flows straight back into the start) keeps the short 0.12 s fade: there the music does not stop.
- Tests: vitest ending (+3: fade from the last word's tail, hand-chosen part may ring out within the length, abrupt
  fade stays a WARN), loop pass. pnpm make could not run in the cloud: Python crashes in this container (audio
  analysis), the same before this step; the full make path is checked on the PC.

### Singing takes: Retake, compare, choose; resolution; mood hint; two fixes; running badge ✅ (to verify on the PC)
- Paul (21 Nov 2026): "InfiniteTalk takes vary a lot in articulation. I make several takes per sung group and pick the
  best. Today a new take of the same lines can land on its line by itself and replace the one in use."
- **Retake** (Lyrics Sync → Who sings, next to "singing clip on lines X–Y"): the same group again as a new take (same
  picture or video, same piece of the vocal, the mood text and resolution of now; cost against the cap). Earlier
  takes are never deleted or replaced.
- **No silent replacement:** the first take of a group still goes into the Storyboard and onto its lines by itself. A
  later take of the same lines arrives as **"New — compare"** and stays out of the Storyboard until chosen. **"Use this
  take"** switches the lines at once (nothing is made or rendered again; the take it replaces goes to Omit, the chosen
  one comes out of Omit). A take of other lines (e.g. line 9 alone before the block 9–11) still gives way to the block's
  first take, as before. A new mood text or resolution no longer marks a group "to make": Retake is how they are tried.
- **Compare in place:** under each group, every take (Take N, or its short name) with ▶, date, cost, resolution and
  In use / New — compare. ▶ plays the take with the song from the take's first frame (the group's start), kept in step,
  in a small player at the bottom right; watching a "New — compare" take takes the mark off. The Creation picture card
  shows the same labels; for a singing take "Use this take" replaces "Send to Storyboard" (out of its line its lips
  would be out of time).
- **Resolution:** Singer bar → Resolution 480p ($0.03/s) / 720p ($0.06/s), default 720p, saved per video in
  pictures\singer.json; the cost estimate says "… s of voice at 720p"; every take records and shows its resolution.
  Checked in code: **until now every singing clip was sent to WaveSpeed InfiniteTalk at 720p** (a fixed
  `resolution: "720p"` in node/singer.ts, both the picture and the video model; seed −1, so every take differs).
- **Mood box:** the hint under it: "Describe the face and mouth, not the voice — e.g. singing clearly, precise lip
  shapes, gentle head sway." (it is InfiniteTalk's prompt, after the singing cue).
- **Fix: "N lines to check by ear" did not update** when a line was marked Checked by ear. The banner is built by the
  page on the server and was never read again; the page now refreshes it after Checked by ear and after Save.
- **Fix: "to make: N take(s)" did not update after sending.** Typing a mood and pressing Make right away sent the take
  with the old words while the new words were saved, so the group looked unmade. Make and Retake now wait for the mood
  to be saved, and the count no longer depends on the mood text.
- **Running badge:** a spinner and a count on the Creation and Lyrics Sync tabs while singing clips are being made
  (from the Tasks menu's own list, no extra polling); a click opens Tasks. The Singer bar says "N being made".
- Tests: vitest animate (+8: resolution price and request, first take placed, later take New — compare and not
  placed, seen, Use this take and back, unfinished take refused, facts). Browser: singer (+12: banner refresh, mood
  hint, resolution, Retake with the mood from the box, take in use kept, New — compare, all made, facts, ▶ with the
  song, Use this take, Creation labels), lyrics-tab, pictures, production, song-stages pass. The other vitest failures
  in the cloud (renders reaching remotion.media, audio analysis) are the same without this step.

### Wardrobe: one face, many looks ✅ (to verify on the PC)
- Paul (21 Nov 2026): "other apps added the full wardrobe with different looks", "go". On a character card, the
  pack is the main look; "Add look" (e.g. Travel coat) with its own outfit, full body front and back and an optional
  close-up in it, made by the app (Seedream or Gemini, cost first) or from his own pictures (free), locked on its
  own. Existing cards are "face + main look" with nothing moved. A song picks the look each cast character wears
  (Production → Cast; used in the Song brief). Creation → "From a character" adds a look's picture to animate or
  to sing with. Recast will use the chosen look when it is built.
- Tests: vitest characters-looks (2), production (+1), browser characters (+5), production and pictures pass.

### Gemini (Nano Banana Pro) on your own key as a pack model ✅ (to verify on the PC, needs GEMINI_API_KEY in .env)
- Paul (21 Nov 2026): yes to "Gemini in the app, on your own Gemini bill". Characters → Pack → model
  "Gemini · Nano Banana Pro (your key)": the 4 views come from Google on GEMINI_API_KEY (.env only), about $0.14 a
  picture shown first, same face checks, retries and cap. Without the key: a plain note, no Make pack.
- Tests: vitest characters-gemini (3, fetch replaced: nothing sent to Google), browser characters (+1).
- Not tried against Google itself from the cloud (no key here): Paul's first pack is the real test.

### Your own character pack: Add my pack, Use my own picture, Move to, draft the description ✅ (to verify on the PC)
- Paul (21 Nov 2026): "if I have my character pack then I don't need to create it in my app?", "yes, that will save me
  money since I am happy with Gemini". A card's pack places now take his own pictures: "Add my pack" (4 at once,
  sorted by file name or, for Gemini's nameless files, by the face check) or "Use my own picture" on one place.
  Free, nothing sent online, his files only read. Same face checks, neck crop for the body views, "Move to…" to fix
  a wrong place, and "Draft it from the pictures (about $0.01)" for the description. Then Lock as usual.
- Tests: vitest characters-own (4), browser characters (+5), characters-cards, extra-cards, frames pass.

### Pick a frame from a video for a character's picture ✅ (to verify on the PC)
- Paul (21 Nov 2026): "can you add that to my app". Characters → New character → "Or pick a frame from a video", and
  on a card "Second picture from a video"; also in Prepare → Creation ("Pick a frame from a video"). Drop a video:
  24 frames are taken, the local face check (free) puts the best faces first (big, sharp, facing the camera, eyes
  open), Paul clicks one and uses it. His video is only read; the app's copy is deleted at once, frames kept a day.
- Tests: pytest face (+1 frame score), vitest characters-frames (3), browser characters (+5) and pictures pass.

### Remove planned slots from the Storyboard ✅ (to verify on the PC)
- Paul (21 Nov 2026): "why can't I remove 2 and 6 from my Storyboard". The "No picture yet" cards are planned slots
  from his 18 Nov shot list; their ⋯ menu only showed details. Now ⋯ → "Remove this planned slot", and "Remove all
  planned slots" next to Import shot list. shotlist.json is kept under Replaced files first (Restore brings the slots
  back); the clips and their order stay.
- Tests: vitest shotlist (+1), browser shotlist (+2), storyboard pass.
- Also: Shape plans again after any saved change to the song's Storyboard, clips, slots, singing lines or anchors
  (lib/api.ts storyChanged), also when that change is made in another browser tab, and whenever the Shape page is
  shown again (window focus / tab visible). Browser storyboard (+1: Storyboard in one tab, Shape in another) passes.

### Online takes in the Tasks menu; length, cost and time on every take ✅ (to verify on the PC)
- Paul (21 Nov 2026): "when the video is being made, add it to the task in the queue" and "does it give the time,
  costs and model used?". The header's Tasks menu lists every singing take and Animate take of every song while it is
  being made and for a day after: the song (a link to Lyrics Sync or Creation), "Singing · lines 9-14 · <picture>" or
  "Animate · <picture> · take N", the model, its length, its cost ("nothing spent" when it never reached the service)
  and when; being made / done / failed / interrupted. It is read from each song's pictures.json, so it survives a
  restart (a take cut off by a restart shows interrupted: Get result, free, in Creation). Make singing clips and
  Animate open the menu. Clear finished hides finished takes (the takes stay). Every take row in Creation shows the
  same facts ("9 s · about $1.94 · 21 Nov, 13:42").
- Tests: vitest animate (+2), browser singer (+1), pictures (+1) pass.
- Then: Paul's first block came back "talking" (a calm portrait). Every singing take now opens InfiniteTalk's prompt with a
  singing cue (open mouth on held notes, lips following the melody, breathing between phrases, eyes closing on long
  notes, moving with the rhythm), then his script. Blocks made before show "make again to sing" (only on Make, cost first).

### Singer script per block; B-roll takes as long as a phrase of the song ✅ (to verify on the PC)
- Paul (21 Nov 2026, "Build both"). **Script:** under the first line of a singing block, "What the singer does
  (optional)": a few words ("turns to the sea, soft smile") sent with the voice as InfiniteTalk's prompt (expression
  and pose; same price). A block already made is made again only when you press Make singing clips (cost first).
- **Take length follows the song:** Creation → Your defaults → Length: "Fit the song" (default) = one musical phrase
  of this song, 4 bars at its tempo rounded up to whole seconds (4 to 30 s; e.g. 9 s at 116 BPM), or "Short (5 s)".
  The cost per take follows the length and shows before anything is sent (Seedance 2.5 Flash 720p: $0.216/s).
- Checked on WaveSpeed's pages: Seedance Talking Avatar ($0.27/s; "the generated audio can differ from the original
  recording") and Reference To Video (audio as style only, 30 s) are not used for singing; InfiniteTalk stays.
- Tests: vitest animate (+2), browser singer (+2), pictures (+1) pass.
- Then (Paul's block 9-14): a block take replaces an earlier one-line take on its first line by itself (the old clip
  set to Omit, placed once; checked in the browser test). The ✕ in "Shows clip" now only takes the singing clip off
  the line; Who sings stays as it is (it used to also remove the line from its block).

### Singing blocks: lines in a row with the same picture are one continuous take ✅ (to verify on the PC)
- Paul (21 Nov 2026): "select a scene where the singer will perform the whole lines I pick, then move on to the B-roll".
  Pick the same picture in "Who sings" on lines in a row (e.g. 9 to 12): they become ONE singing take, from just before
  the first line to two bars after the last (one WaveSpeed request, one cost shown on the first line; the others say
  "sung with line 9 take"). It lands on the first line with "through" (song.json) and stays on screen, lips in time,
  until the last line is sung; then the B-roll takes over on the beat. A skipped line, another picture or more than
  8 s of music between two lines starts a new take. A line picked alone works as before.
- Tests: vitest anchors (+1) and animate (+1, the runs); browser singer, lyrics-tab, pictures pass.

### Shape follows a new Storyboard order without a reload ✅ (to verify on the PC)
- Paul (21 Nov 2026): "when I update the Storyboard sequence it doesn't show in Shape". The Storyboard shows a new
  order at once but saves it a moment later; a Shape opened before the save finished planned with the old order and
  kept it. Now a saved order tells an open Shape to plan again (selection and playhead kept). A singing clip still
  opens its own line wherever it sits in the order (it plays in time with the words); "No picture yet" slots are skipped.
- Tests: browser storyboard (+4, incl. a slow save), song-stages, pictures pass.

### Lyrics Sync clip picker: double-click saves; clearer column names ✅ (to verify on the PC)
- Paul (21 Nov 2026): "I can't select the clip, I double click and nothing happens". The click did select it, but
  Save sat below all the clips, off screen. Now Save ("Save: <name>"), start-in-clip and transition sit at the top of
  the picker and stay in view; a double-click on a clip saves it at once.
- The two side-by-side columns are easier to tell apart: "Who sings (lip-sync)" (was Singer; its picker is titled
  "Who sings this line?") and "Shows clip (no singing)" (was Lands on; button "Show a clip").
- Tests: browser lyrics-tab (+1 double-click check) and singer pass.

### Short names for clips; Singer fixes ✅ (to verify on the PC)
- Paul (21 Nov 2026): the long Midjourney file names are hard to recognise. **Rename** (click the name, pencil) on
  every picture, video and take in Creation and on every Storyboard card: a short name ("Bride smile") shown instead
  of the file name; the file keeps its own name (clips.json "label", pictures.json "label"). It goes with a clip sent
  to the Storyboard (a take without its own name: "<picture name> take N" / "sings line N"), and shows in the Singer
  picker (now with thumbnails, searchable past 6) and Lyrics Sync → Choose a clip.
- Singer fixes (Paul's first singing line): the Singer column sits before "Lands on" and a long clip name is cut short,
  so it is always in view; "— no singer on this line" (or ✕ in Lands on) takes the singing clip off its line and sets it
  to Omit (kept in Creation and the Storyboard): out of its line its lips would be out of time. A singing clip
  replaced by a new one on its line is set to Omit the same way.
- Tests: browser pictures (+6), singer (+5), lyrics-tab and storyboard pass.

### G3 Singing lines: tick lines in Lyrics Sync, WaveSpeed lip sync, placed in time on their line ✅ (to verify on the PC)
- Paul (21 Nov 2026): "I decide the singing lines and the clips attached to them, I place them in my Storyboard order,
  and the app does the hard part: assembling them to the beat and the cuts."
- **Lyrics Sync → Singer column:** on each line where the singer shows, choose a picture or video from Creation. The
  Singer bar shows what is left to make, its seconds of voice and cost (InfiniteTalk 720p, $0.06/s, at least 3 s),
  refused above the Creation cap; **Make singing clips**.
- **What the app does:** cuts the line's vocal (the vocal stem lined up on the song; else the song itself) from just
  before the downbeat before the line to two bars after it is sung, sends it with the picture (InfiniteTalk) or video
  (InfiniteTalk video-to-video) to WaveSpeed, removes the voice from the result, and puts the clip into Creation
  ("lip sync, line N"), the end of the Storyboard and onto its line (song.json anchor with "sync"). A line already
  made is never paid for twice; a lost one: Get result (free) in Creation.
- **In every video:** a singing clip cuts in on the beat, plays at normal speed from the frame that matches the song
  (always in time), with a hard cut, and never fills other shots; the other clips keep the story order. QA "Singer in
  time" names the lines.
- Not tested against WaveSpeed itself (no key in the cloud): requests follow its InfiniteTalk docs as read on 21 Nov
  2026 (the video-to-video fields from its model page).
- Tests: anchors (+4 singing clips), animate (+3: the piece, a clip back without sound onto its line, a refusal).
  Browser: singer (new, 13 checks), pictures, lyrics-tab, storyboard pass.

### G2b Prepare → Creation: a messy creation space for pictures and videos from anywhere, your own defaults ✅ (to verify on the PC)
- Paul (21 Nov 2026): keep it apart from the Storyboard, "a creation messy space from which I can pick my favourites";
  call it **Creation**; "I can add Midjourney videos manually, use the API of WaveSpeed, or import them from outside
  sources: I need flexibility".
- **Creation** (the tab first called Pictures) takes three sources, side by side: pictures and videos added by hand
  (drop or choose; .jpg .png .webp .mp4 .mov .webm; own names), takes made here with Animate, and **a pasted link** to a
  picture or video anywhere (downloaded once, up to 1 GB). Each item has a small label of where it came from: "Added
  by you", "Midjourney" (a "midjourney" name or Midjourney's download name with the job id, or a midjourney link),
  "From <site>", and each take its service and model. Only pictures can be animated.
- **Takes stay in Creation** (`pictures\takes\<picture> take N.mp4`); nothing goes to the Storyboard by itself.
  **Send to Storyboard** on a take, a picture or a video copies it to the END of the story line (his order rule) and
  marks it "✓ In Storyboard"; sending again does nothing.
- **Your defaults (every song):** Model (WaveSpeed · Seedance 2.5 Flash / WaveSpeed · Seedance 2.5 / Higgsfield ·
  Seedance 2.5), Takes (1–6) and the spending cap, saved in `workspace\creation.json`; each picture can choose another
  model or number of takes for itself.
- Tests: animate (17: sources, a Midjourney video, a link, defaults). Browser: pictures (19 checks), song-stages,
  production pass.

### G2 Prepare → Pictures: picture board and Animate (WaveSpeed / Higgsfield), takes at the end of the clips ✅ (to verify on the PC)
- Paul's real flow (21 Nov 2026): Midjourney pictures → clips at random → play with the order against the song until it
  feels right; no preset storyboard. So the path is **pictures, then clips, then play with the order**; the G1 story
  tools stay, folded under "Story tools (optional)". G2 shot scripts are dropped.
- **Prepare → Pictures** (the tab G1 called Production): drop pictures (own names, `pictures\`); per picture a few
  optional mood words, 1–6 takes (default 3), Standard / Best, **Animate**.
- **The app decides the technical part:** Seedance 2.5 image-to-video, 5 s, 720p, the picture's own shape, no sound,
  a gentle-motion prompt that keeps the picture as it is ("Mood: …" added when given). Requests are never retried on
  submit (a retry could be billed twice).
- **Money:** your own key in .env (WAVESPEED_API_KEY; HIGGSFIELD_API_KEY as "id:secret"); the cost shows before
  sending ("3 × 5 s · about $3.24": WaveSpeed Flash $0.216/s, Seedance 2.5 $0.324/s at 720p); a press above the
  spending cap (default $10) is refused; "Sent for this song so far". Higgsfield's price is not in its docs: WaveSpeed's
  is shown, marked "(estimate)". Higgsfield needs the picture online: it goes up through WaveSpeed's upload (or fal's
  storage with FAL_KEY).
- **Takes:** made at the same time; each finished take joins the END of the song's clips as "<picture> take N.mp4", in
  take order, never placed anywhere else (Paul's order rule). A take the studio lost mid-way: "Get result" (free).
- Not tested against the real services from the cloud (no keys here): the requests follow WaveSpeed's and
  Higgsfield's docs as read on 21 Nov 2026; the first real run on the PC confirms them.
- Fix (21 Nov 2026, Paul's update stopped on a changed .env.example): **Update Lyric Studio.cmd** in the project folder
  (scripts/update.mjs) moves a key typed into .env.example into .env, keeps the edited file aside, puts .env.example
  back, then pulls, installs and starts. The Pictures tab says plainly that the key goes in D:\videomaker\.env, not
  .env.example; without a key Animate stays off. Tests: update-script (5).
- Tests: animate (12, with stand-ins for both services). Browser: pictures (11 checks, LYRIC_GENERATE_STUB),
  production (story tools folded), song-stages, shotlist pass.

### Characters, C1 in the app: the Characters page, cards from one picture, packs, lock and versions ✅ (verified by Paul, 18 Nov 2026: "all good", with fixes 1–4 below)
- **Characters page** in the header, after Collections, with two sections: Characters and Scene cards. "New …" tiles
  take a name and one picture; the reference check (or location check) runs at once, locally and for free.
- **Card page:**
  - the picture and its check, with Check again, Crop to face and Add a second picture;
  - the face-check lines, calibrated on a song's clips with "clips of her", or SFace's defaults;
  - the outfit in Paul's words (characters) or the key props (scenes);
  - **Make pack**: the cost first, a confirm, then a background job shown in the Tasks menu. The views show their
    face lights, with a Remake per view, "Get missing pictures (free)" and the contact sheet;
  - the description, drafted by the vision model and edited by Paul;
  - **Approve and lock** (it needs every view and a description; read-only afterwards), and **New version** (the
    next draft from the latest).
- **Pack and angles:**
  - Seedream 4.5 by default (others selectable).
  - Characters: close-up, 3/4 face, and full body front and back, cropped at the neck by the app.
  - Scenes: wide from the left, the opposite side (a more explicit prompt after the test), and a closer detail, with
    the key props named in every angle.
  - Drifted face views are made again (max 2, within the cap), and paid pictures are never made twice.
- **Storage and code:**
  - `workspace\characters\<name>\` and `workspace\scenes\<name>\` (card.json, v1/, v2/ …), plus the database
    tables `card` and `card_job` (migration 0007).
  - The code is in packages/video/src/node/characters (moved from the spike), with the face checks in the Python
    service. The jobs run in the studio's process.
  - The fal client is now an app dependency (@fal-ai/client 1.10.1); FAL_KEY comes from .env.
  - Rendering is unchanged and still makes no network calls.
- **Docs:** docs/screens.md (Characters) and docs/data-model.md (cards).
- **Tests:**
  - Unit: characters-cards (8: folders, drafts, Make pack with the stand-ins, neck crop, lock, new version, cost cap,
    jobs, no FAL_KEY, Get missing pictures, calibration).
  - Browser: e2e/characters.e2e.ts (18 checks, with LYRIC_CARDS_STUB stand-ins), added to `pnpm test:e2e`.
  - Checked with the real face models through the running studio: the check, Crop to face, and Make pack without a
    key (a plain message).
  - The 22 unit test files that already failed in the cloud test machine fail the same before and after this step.
- **To check on the PC:**
  1. Start the app and open **Characters**, then New character: `bride` with `refs\bride.png`. The check shows
     "Ready".
  2. Face-check lines → Calibrate on Wedding Day, with clips of her `Korean_bri_1e58e52b`.
  3. Type the outfit, then Make pack (about $0.17), and look at the views.
  4. Edit the description, then Approve and lock.
  5. A scene card: `bridal room`, with its key props.

### Characters, C1 spike: reference check, character pack, location angles, local face check ✅ (reviewed by Paul, 18 Nov 2026: done)
- **Isolated spike** in `spikes/characters/` (README there). Nothing in apps/ or packages/ changed (no HyperFrames,
  Remotion, Prepare/Storyboard or Shape code). The database is opened read-only, only for `--song`.
- **Local face checks** (new, in the Python service: `services/audio/app/face.py`).
  - Installed with `pnpm audio:setup --face` (mediapipe 1.2.0, opencv-contrib-python 5.0.0.93, nothing newer than
    3 Nov), and run with `pnpm face check|scene-check|compare|calibrate|crop`.
  - The models download once with pinned SHA-256 sums. Each file's own licence: YuNet MIT, SFace Apache 2.0,
    MediaPipe Face Landmarker and Pose Landmarker Apache 2.0 (model cards).
- **C1.0 reference check**, with a verdict Ready / Usable with fix / Not suitable and reasons in plain words. It
  measures:
  - one face and its confidence, its size (target 512 px tall), blur;
  - head pose, eyes / nose / mouth visibility, a confident hand over the mouth (flagged for lip sync), mouth and eye
    openness;
  - exposure and left/right balance, and how much of the body is visible.

  A veil over the mouth is not detectable: the report says to check by eye. Fixes: `--crop` and
  `--image2` (a second reference). The upscale fix is the later upscale pass. `--ai-opinion` is paid ($0.01) and
  off by default.
- **`pnpm characters calibrate`** (free) sets the "same person" line on Paul's own pictures: the bride against the
  faces in the song's clips. Every clip counts as another person unless marked with `--her "<clip name>"`; an unmarked clip
  scoring 0.6+ is left out as a copy of the reference. It also
  scores changed copies of her picture. Saved per character.
- **`pnpm characters pack`**:
  - 4 views and 3 location angles (`--scene`), per model: Nano Banana Pro,
    Nano Banana 2, Seedream 4.5 and GPT Image 1.5 (endpoints, inputs and prices checked on fal.ai). The picture is
    both the identity and the style reference.
  - Each view is face-checked: green / amber / red. A red view is made again at most twice and the best try is
    kept. Profiles and tiny faces are judged by eye.
  - Draft descriptions, contact sheets, and report.md / report.json with every request ID.
  - The cost estimate and `--max-cost` (default $3) come first, and the cap also stops the retries.
  - The actual cost comes from fal's Billing Events API (needs a key with billing permission;
    `pnpm characters cost <folder>` asks again later).
- Tests: `pnpm characters:test` (12; a stand-in fal client, face check and billing) and
  `pnpm test:audio tests/test_face.py` (12). The whole audio suite passes (115).
- Checked here with the real face models on public test photos. A drifted view (another person's face, 0.21) was
  red and made again (0.91, green); a 40 px face was not judged; the contact sheets were drawn.
- **Update 18 Nov 2026 (decided by the user, same spike):**
  - The pack views sit in a **neutral, empty outdoor setting in soft natural daylight**, not a grey studio backdrop
    (studio backdrops gave plastic skin).
  - **New layout:** a close-up face (the identity source), a 3/4 face, and the full body from the front and from
    the back, both cropped at the neck, so faces only come from the close-up.
  - Face checks run on the two face views only. A body view that shows a face anyway is red and made again.
  - The best try is now chosen by result first (green, then amber or a body view without a face, then red), then by
    score.
  - Also fixed for Windows since: dynamic imports of a path (file:// URLs); faces filling a close-up portrait (the
    face finder now checks 3 sizes); calibration (`--her`, no auto-exclusion at 0.363, an overlap warning); UTF-8
    output from Python.
  - Tests: characters 17, face checks 18.
- **Update after Paul's first pack review (18 Nov 2026):**
  - Face scores: Nano Banana Pro 0.65 / 0.68, Nano Banana 2 0.60 / 0.60, Seedream 4.5 0.74 / 0.58, GPT Image 1.5
    0.57 / 0.52, all well above the other Midjourney women (at most 0.43). Paul picked **Seedream 4.5**: the best
    likeness, keeps the reference's look, the cheapest.
  - Seedream changed the outfit into a trouser suit and ignored the neck crop. Fixes:
    - `--outfit "<text>"`: Paul's words go into every view's prompt.
    - The app now crops the body views at the neck itself (face.py `crop-body`: chin and shoulders from YuNet and
      the pose; the model's own picture is kept as `_full.png`).
    - `--views all|face|body`.
    - Seedream is the default model.
    - The live log names model and view on every score line.
  - Earlier fixes from the same run: downloads retry 6 times, and `pnpm characters fetch "<run folder>"` recovers
    paid images without regenerating.
  - Tests: characters 22, face checks 21.
- **Conclusion (Paul's review, 18 Nov 2026):**
  - **Seedream 4.5 is the default** for faces, bodies and location angles. It has the best likeness (0.74) and keeps
    the reference's warm look, its location angles keep the room's light and its props, and it is the cheapest.
  - The outfit comes from Paul's words (`--outfit`): the body test gave the same floor-length A-line gown and veil
    in front and back.
  - The app's own neck crop is clean: no face in body views.
  - Watch: small prop details drift (the mirror's crest), so scene cards name their key props. "Wide, from the
    right" stays close to the original framing and needs a more explicit prompt.
- **To run on the PC:** see the step's message (calibrate on the bride vs the Wedding Day clips, then the estimate,
  then `--yes`).

### Lip Sync, step 1 (spike): three fal.ai models side by side ✅ (to verify on the Windows PC)
- **Isolated spike** in `spikes/lipsync/` (README there). Nothing in apps/ or packages/ changed (no HyperFrames,
  Remotion, Prepare/Storyboard, Shape or Theme v2 code). It only reads the workspace, with the database opened
  read-only so the app can stay open.
- **`pnpm lipsync "<song>" --clip "<path>" --lines 12,13 | chorus:2 | --from/--to`**, with `--pad` (0.2 s),
  `--providers`, `--max-cost` (default $3: above it nothing is uploaded, even with `--yes`) and `--yes`.
  `--list` shows the lines (Lyrics tab numbers, ♪ = chorus).
- **One job and one folder per line.** The vocal stem (the Vocals slot, your own file name) is cut for the models;
  the full song is cut for review only. The clip is trimmed to the same length, keeping its resolution and fps.
  A clip shorter than the line stops that line with a message.
- **Models** (endpoint IDs, inputs and prices checked on fal.ai): Sync lipsync 2 (`fal-ai/sync-lipsync/v2`),
  Kling LipSync (`fal-ai/kling-video/lipsync/audio-to-video`; a clip outside 720–1920 px is sent as a resized copy)
  and InfiniteTalk (`fal-ai/infinitalk/video-to-video`, 480p). All sit behind one `LipSyncProvider` interface.
  They run in parallel; each has a timeout and one retry.
- **Output** in `spikes\lipsync\out\<song>\<clip>_line<N>\`: clip_trimmed.mp4, audio_slice.wav,
  mix_slice.wav, `<model>.mp4`, `<model>_review.mp4` (with the full song), comparison.mp4 (side by side,
  labelled, with the full song), report.json (endpoint, seconds, est. and fal-priced cost, every fal request ID,
  checks) and report.md (a verdict per model in plain words).
- **Checks:** a length more than 0.1 s off the audio, a different aspect ratio or a file that does not play is a
  problem. A lower resolution or another fps is information only ("Model output 480p, clip was 1080p").
- Tests: `pnpm lipsync:test` (16). They cover timing and padding, chorus:N, the clip-too-short stop, prices and
  limits, the inputs against fal's schemas, the retry with request IDs, and the checks. They also run the whole
  pipeline with a stand-in fal client (no network, no key): cap, dry run, one folder per line, stem vs mix,
  comparison and reports.
- **Update after the first test (17 Nov 2026, decided by the user):** mouth-only models (Kling LipSync, Sync) look
  unnatural for singing: the rest of the face stays still. So the default is now **InfiniteTalk** (whole face, audio
  driven).
  - **Sync** is only the automatic fallback. It runs when InfiniteTalk fails, is too long for one request, or comes
    back with a problem; it stays within the cap, and `--no-fallback` turns it off. The report marks it
    "(automatic fallback: …)".
  - **Kling LipSync** is out of the default list and runs only with `--providers kling`.
  - Tests: 20 (+ the default, the fallback, `--no-fallback`, the cap holding the fallback back).
- **To check on the PC:** see the Windows commands in the step's message: `npm install` in spikes\lipsync once,
  FAL_KEY in .env, `pnpm lipsync "Wedding Day" --list`, then the estimate, then `--yes`.

### Title cards, Canva-like: size as a number, instant viewer, a toolbar above the video ✅ (to verify on the Windows PC)
- **Size in px with − / +** (and typing; ↑ / ↓ by 1): from half the card's usual size up to **twice the title's**
  usual size, so the credits can be as big as the title (a Reel: credits usually 29 px, now up to 168 px). Under 28 px
  a warning says it is hard to read on a phone; nothing is blocked. Lyric lines keep their slider.
- **The viewer shows each change at once** (size, colour, transparency, capitals, place); it is saved as you change
  it and the plan after it fits the card into the safe area exactly as the render will. A new font shows once saved.
- **Toolbar above the video** when you click a title card (or its T bar, or Edit ›): font, size − N +, colour,
  transparency, Aa capitals, Done. The card is outlined in the viewer; Esc or a click elsewhere in the video closes it.
- Next (each its own step, when you decide): C move / resize in the viewer with "Set by me" / ↺ auto; D drag a card's
  bar on the timeline.
- Tests: unit (title-card-size: range, px ↔ multiplier, readable warning, live preview), browser (textboard: toolbar,
  outline, + five times shown at once and saved, typed size capped, colour at once, capitals, Esc), song-stages,
  storyboard, title-opening.
- Known (not from this step, they fail the same before it): unit tests song-stages "Prepare to-do list" (2),
  make "youtube --cover and --title" (expects the old #LifeLyrics tags line), render / migrate (need remotion.media,
  not reachable in the cloud test machine). To fix in a bug-fix pass.
- **To check on the PC:** Shape → click the title in the video: the toolbar appears above it; press + a few times:
  the title grows at once; open Edit › on Credits and type 84: as big as the title.

### Look simplified: Theme, On-screen text (Title · Artist · Credits), Advanced ✅ (to verify on the Windows PC)
- **The rule:** the theme decides how everything looks; the song decides what appears.
- **Theme:** the song's theme with Change, and Edit theme.
- **On-screen text:** Title, Artist and Credits, each with its words and an on / off switch (every platform). The words
  are the same as in Song Details (type in either place); the Artist is read-only (changed in the Library). Saved at
  once, the viewer follows; no Save button. Switching any on gives the Reel its title opening; all off, none.
- **Advanced** (folded): readability, the YouTube layout and the title cards' own look (font, colour, place…). It
  opens by itself when you click a title card in the viewer or on the timeline, or Song Details → "Credits look…".
- **Gone from the default view:** Title opening, Title cards, Lyric readability. "Tagline" reads **Credits** and
  "Byline" reads **Artist** on screen. Changing the theme keeps the words and the switches.
- Tests (browser): textboard (switches save the card and the title opening, Credits edited in Look reach song.json,
  Artist read-only, Advanced opens for Credits look…), song-stages, storyboard.
- **To check on the PC:** Shape → Settings → Look: the theme, then three rows; switch Credits off: it leaves the viewer;
  type new credits: Song Details shows the same; open ▸ Advanced for the fonts and colours.

### Look → Title cards made obvious: a row per card, click the card in the viewer ✅ (to verify on the Windows PC)
- **One row per card** (Title, Byline, Tagline): its text, its look in one line (font · colour and transparency ·
  place · capitals, as the video draws it) and **Edit ›**. The editor opens under the row; the row is highlighted.
- **In the viewer:** a title card under the pointer is outlined; a click opens its row in Look (it does not play /
  pause). A title card's **T bar on the timeline** does the same.
- **The viewer jumps** to the middle of the card's time on screen when you pick it, so it is fully visible.
- **The text is read-only here**, with "change in Song Details" (the words live in Prepare → Song Details only).
- Tests (browser): textboard (rows with their look, the editor under the highlighted row, read-only text with the
  link, the viewer fully showing the card, hover outline, click in the viewer, the T bar), song-stages, storyboard.
- **To check on the PC:** Shape → Settings → Look → Title cards: three rows; Edit › on Tagline opens under it and the
  viewer shows the tagline; hover the title in the viewer: outlined; click it: its row opens.

### Title cards: edited in Shape → Settings → Look, saved as changed; a quieter tagline; no crowding ✅ (to verify on the Windows PC)
- **Look → Title cards:** Title · Byline · Tagline chips under Title opening; the chosen card's editor opens right
  there (Shown, Place, Size, Hold, Font, Effect, and new **Colour, Transparency, Capitals**). The same editor as a
  title card clicked on the timeline. With Title opening off, Look says so with "Turn it on".
- **Song Details → Tagline → "Tagline look…"** opens Shape → Settings → Look with the tagline's editor.
- **Saved as you change it:** title cards are saved a moment after the last change and the viewer shows it after
  the plan (no "Save and plan again" for title cards; lyric lines keep it).
- **A quieter default tagline:** under the title and byline, smaller (0.35 of the title), in the lyric font, as
  written, 80% opaque (was: the lower third, in the title font).
- **No crowding:** the title, byline and tagline are gone as the first sung line fades in (before: they stayed 4 s
  next to it when they did not overlap). A lead-in under 1.5 s gets a note: start the part about 2 bars earlier, or
  let the app choose it (Automatic). A song whose part starts on a sung line therefore shows its title only briefly.
- **The fit hint** in Song Details measures the tagline in its own font, size and capitals.
- Tests: title-opening (rewritten for the new rule: gone as the line fades in, the note, the stacked tagline in the
  lyric font, colour / transparency / capitals), title-opening-make, card-fit, make-reference (only the title cards'
  fields changed: cuts, lyric timing and shots identical), textboard, extra-cards, qa, youtube. Browser: textboard
  (no Save button on a title card; Tagline look… opens Look with the tagline's editor; colour, transparency and
  capitals saved as changed), title-opening, song-stages, storyboard.
- **To check on the PC:** Let My Love Carry You → Prepare → Song Details → Tagline look…: Shape opens on Look with the
  tagline; pick a font, colour and transparency: the viewer follows after a moment. The tagline sits under "Life
  Lyrics" in the lyric font; the title cards are gone when the first line starts.

### Song Details: card texts full width, growing to two lines, with a fit hint ✅ (to verify on the Windows PC)
- Tagline, Hook card text, End card text and EP are as wide as Title and grow to a second line for a longer text.
- Under each card text (not EP: it is not drawn on the video), a fit hint measured as the card is drawn in a Reel
  (its font, size, letter spacing and case, inside the Reel's safe width) with the render's own rule (one line, else
  2 balanced lines, else up to 25% smaller), naming the theme: "fits on one line in Reels · Golden Hour", "will wrap
  to 2 lines in Reels · Golden Hour", or (amber) "too long: … shorten it".
- Tests: card-fit (3: one line, 2 lines, smaller, too long). Browser: song-stages (widths, growth to 2 lines, the
  hints with the theme, none on EP).

### Bug fix: song-wide version numbers per platform; a Make run that would duplicate a video warns first ✅ (to verify on the Windows PC)
- **The bug:** every new Reels video was called "v1". The name was the file's number inside its run folder
  (exports\<run>\reels\v1.mp4), and every Make run starts again at v1.mp4.
- **Now** (src/node/versions.ts): a video is called v1, v2, v3... per platform for the whole song, in the order the videos
  were made, never reused (a discarded or deleted video keeps its number). Review, Shape's video picker for past runs,
  Post, the player, Compare, the Library and the file names all show this name. The files on disk are not renamed
  (the number in the file name is only the take's variation). The numbers are kept in `<song folder>\.studio\versions.json`,
  written the first time a song's videos are read (existing videos: creation order). Approved / posted / favourite marks
  stay on the file, so nothing changed state. A try (Compare looks) is not a version: "Try · Midnight Highway", "based on
  v3" (the newest own video made before it).
- **`pnpm versions "<song title>"`** prints what each existing video is called now:
  `exports\2025-11-10_1505\reels\v1.mp4 -> v1 (approved, ★)`.
- **"Make another"** sends the next variation number not used by any file of that platform (so takes keep varying);
  the video that comes out is simply the next version. Its refusal message uses the new names too.
- **A Make run that would duplicate a video asks first:** before queuing, POST /api/runs plans the run in the planner
  process (`--dup-check`, take-check.ts `duplicateProblem`) and compares it with the platform's videos that are not
  discarded (their manifests' props). If one would be identical: 409 "Reels v4 would be identical to Reels v3 (made 11 Nov
  15:05): change a setting in Shape first, or press Make anyway." and nothing is queued; Make shows it with a **Make anyway**
  button (data-make-anyway; the request is sent again with force). A check that cannot run lets the run through.
- Tests: new versions (8), take-variation (+3, messages use the new names), exports, library (names), video-names; browser:
  videos-post, song-stages, storyboard pass.

### Review: the app's quality verdict on every card; "Ready to post" only once approved ✅ (to verify on the Windows PC)
- Before approval a card's badge says the app's verdict in words: Excellent / Good / Could be better (its details:
  "Excellent: nothing a viewer would notice", "Good — 2 to improve", "Could be better — fix 1 first"). "Ready to
  post" shows only on a video you approved. The player and Compare use the same words.
- Each platform's summary matches the stage line: "All 3 good · 0 approved", "1 of 3 could be better · 2 approved".
- Shape's predicted verdict uses the same words ("Excellent: nothing a viewer would notice (prediction before rendering)").
- Tests (browser): videos-post (Excellent before approval, Ready to post after, the summary with "approved", the
  player's verdict), storyboard (Shape's prediction), song-stages.

### Bug fix: Make another — every take varies something; a take that would be identical is refused, saying why ✅ (to verify on the Windows PC)
- **What changed between takes before:** only the style (Simple / Bold), the cinematic bars (Reels etc.), and, from take 3
  on, the cut rate and cut / dissolve. Your clip order is yours (never shuffled), the cuts are the song's, effects and
  fonts are your settings. On a short song, or with a look that makes Simple and Bold alike, or on YouTube's cover
  layout (no clips on screen), almost nothing was left: three near-identical videos.
- **Now (take 2 onward, from the take number, always the same for the same take):** each clip's first shot plays another
  part of the clip (inside your trim; never a clip whose best moment you set, an anchor, a pin or a slip); on YouTube's
  cover layout the cover's camera move changes (pull out, hold, push in). Cuts, lyric timing, the music and the ending
  stay. Take 1 is exactly v1.
- **Refused before queuing:** Make another plans the take (no render) next to the song's other takes of that platform;
  if it would look the same: "Take 7 would be identical to v1: change a setting in Shape first (e.g. choose another
  look (Shape → Look bar → Change) or another cover picture)." (shown in the Make another note).
- Code: `moment` in `planTake` / `assignClips` / `composeProps`, `coverZoomFor`, `takeProblem` (take-check.ts), checked in
  POST /api/runs (checked in the planner process, packages/video/scripts/storyboard.ts --take-check). Docs: pacing-and-cuts.md "Takes". Tests: take-variation (7), take.
- **To check on the PC:** Review → a platform → Make another twice: the new videos differ (clip moments); on YouTube
  (cover) take 2 zooms out; after enough takes the app says which earlier take it would repeat.

### Review: the command in the card's ⋯ menu; platform tabs in a fixed order ✅ (to verify on the Windows PC)
- Each card's "command" moved into a ⋯ menu on its run line (the command and Copy command); "settings" stays visible.
- The platform tabs are always Reels · TikTok · Shorts · YouTube · Canvas, then Post, whatever the counts or the
  song's own platform order (only platforms with videos, or being made, show).
- Tests (browser): song-stages (settings visible, no "command" on the card, ⋯: the command and Copy), videos-post
  (a song whose platforms are YouTube, TikTok, Reels still shows Reels · TikTok · YouTube · Post).

### Tries have their own name: "Try · Midnight Highway" (based on v1) ✅ (to verify on the Windows PC)
- Your videos stay "Reels v1"; a try (Compare looks) is "Try · Midnight Highway" (a picture set: "Try · pictures
  city") with a small "based on v1" line, never a version number of its own.
- The same everywhere: Review cards, the player, Compare, Shape's video picker ("Try · Midnight Highway (based on
  v1)"), Post (its list and title), and the Post file names ("Here With Me - Reels - Try Midnight Highway.mp4").
- Tests: video-names (2). Browser: videos-post (a YouTube try named "Try · Midnight Highway" with "based on v1"
  next to "YouTube v1"), storyboard (Shape's picker).
- **To check on the PC:** Review → Reels: a Compare looks video reads "Try · <theme>" with "based on v1"; Shape's
  video picker lists it the same way; its Post files are named "… - Reels - Try <theme>.mp4".

### Storyboard reads as a story: notes as card titles, a Story idea line, details in ⋯ ✅ (to verify on the Windows PC)
- **Card title = your note** (larger, up to two lines); a card without one shows "+ Add a note" there. The file name
  is the card's tooltip and the first line of its ⋯ menu.
- **⋯ menu per card:** file name, duration, size and orientation (and the collection), then Remove (or "Remove from
  this song" for collection clips and the "app picks" cards).
- **Visible:** number, thumbnail, note, Use / Omit (and the collection badge); a small warning only when something
  is wrong: "low resolution (544×720)" (short side under 720 px) or "same content as …".
- **Story idea** above the clips: one sentence for the whole video, saved per song next to the notes.
- **Every card the same shape** (your second test): one 9:16 frame, filled by the picture (about what a Reel shows of
  the clip); a 9:16 clip no longer makes its card taller; the cards of a row share one height, Use / Omit on one line.
- **For you only:** the app never reads the notes or the story idea to plan (test: clip-notes checks which files
  read them).
- Tests: clip-notes (+1: the story idea kept with the notes, cleared, cut at 300 characters). Browser: clip-notes
  (the title in two lines, no file name / duration / Remove on the card, the tooltip, the low-resolution warning, the
  ⋯ menu's details and Remove, the story idea kept after a reload), song-stages (Remove from this song in ⋯).
- **To check on the PC:** Here With Me → Prepare → Storyboard: type a Story idea; give two clips a note: the notes are
  the cards' titles; ⋯ shows the file name and size; a small clip shows "low resolution".

### Post downloads: "Save as" in your folder, "Save all to…", folders remembered ✅ (to verify on the Windows PC)
- **Each file button** in the Post panel (Video, Captions (.srt), Thumbnail, Cover, publish.txt) opens a "Save as"
  window (Chrome / Edge) in the last folder you used for this song and platform; other browsers download as before.
- **Save all to…** writes every file of the post into one folder you pick. With "in a folder named “<song>”" (on by
  default) you pick the parent (e.g. D:\Posts) and the song gets its own folder in it; the next song opens there.
- **Clear names:** "Here With Me - YouTube.mp4", "Here With Me - YouTube.srt", "Here With Me - YouTube - thumbnail.jpg",
  "… - publish.txt" (" v2" for a second version).
- **Item 4 (other download buttons):** these are the app's only download buttons (Make has none, the release pack
  is gone); all five changed: Video, Captions (.srt), Thumbnail, Cover, publish.txt; plus the new Save all to….
- The folders are remembered in this browser (its folder handles, never paths): per song and platform, per song,
  and the parent folder for the next song.
- Tests (browser, videos-post, with stand-in pickers): clear names; Video's "Save as" opens in Downloads the first
  time and writes the whole file; the next one opens where the last went; Save all writes every file into the
  song's folder; the next Save all opens in the parent, kept for every song.
- **To check on the PC (Chrome or Edge):** Review → Post → a video → Video: a Save as window; save to D:\Posts.
  Save all to… → pick D:\Posts: a "Here With Me" folder with every file. Another song's Save all opens in D:\Posts.

### Song Details → Tags: ranked hashtags, brand tags, suggestions, the top ones per platform ✅ (to verify on the Windows PC)
- **Before:** the Post panel's hashtags came from fixed templates (title and artist filled in, plus #reels / #fyp /
  #shorts); YouTube's Tags box from publish-template.txt, frozen in publish.txt. Nothing per song, no limits.
- **Tags** (Prepare → Song Details, between EP and Links): your hashtags as ranked chips; drag to reorder; keep as
  many as you like (song.json "tags"). Clean: lowercase, no spaces or accents, no duplicates.
- **Brand tags** on every song, marked "from your brand": brand.json "tags" (Life Lyrics: brand\brand.json; Pômé:
  brand\Pômé\brand.json); without them the artist's name (#lifelyrics). The Brand page comes later.
- **Suggestions** (grey chips; one click adds, they turn pink): the artist, title (#herewithme), EP
  (#quietheartbreaks), the lyrics' language (e.g. French → #chansonfrancaise #musiquefrancaise) and the brand's
  starter set (brand.json "tagStarters"; default #lyricvideo #emotionalpop #cinematicpop #lovesong #sadsongs).
  Local rules only; never #reels #explore #fyp #viral and other generic tags.
- **The Post panel uses the top ones per platform**, with a preview line each in Song Details: Instagram / Facebook
  5, TikTok 8, Shorts 8, YouTube 3 in the description (above the title) and the Tags box up to 500 characters (also
  for YouTube videos made before). publish.txt gets them with each new YouTube video.
- Tests: song-tags (8: clean format, rank with the brand's, the limits, suggestions and language, brand.json, the
  Post panel, publish.txt, song.json); exports, library, song-links, style still pass. Browser: song-links (the brand
  chip, suggestions without generic tags, add / clean / drag / reload, Instagram's top 5, YouTube's 3), videos-post,
  song-stages.
- **Edit brand tags** (a link next to the brand chip): the brand tags and the starter set as chips, saved for every
  song of the artist (Life Lyrics: brand\brand.json, the rest of it kept; Pômé: her own brand.json if she has one,
  else brand\Pômé\tags.json, so her videos' look never changes). Test: song-tags (+1), song-links (browser).
- **To check on the PC:** Here With Me → Prepare → Song Details → Tags: #lifelyrics "from your brand"; click
  #herewithme and #quietheartbreaks; add "emotional pop"; drag one first; Review → Post: Reels shows those top 5.
  Edit brand tags → add "lifelyricsstudio": it shows on every Life Lyrics song; a Pômé song shows her own set.

### Shape: two tabs, Settings | Shots ✅ (to verify on the Windows PC)
- **Settings** is one scrolling panel. It starts with a **"Set by me"** line: what you changed (e.g. `Target length
  90 s · Shot length "story"`), everything else is the app's ("Nothing set by me…" when you changed nothing).
- Then three folding sections, each saying what it holds and how many you set:
  - **▸ Look**: theme + Change · title opening · lyric readability (open at the start)
  - **▸ Part & ending**: section · target length · ending
  - **▸ Pace**: shot length · transitions · pace adjustment
- **One section open at a time** (your first test: Look's rows looked like Part & ending's): opening one folds the
  others; the open one has a tinted header and a pink edge down its settings.
- **Shots** is unchanged. Old links (?panel=look / part / pace) and "Look: …" in Make open Settings with that
  section unfolded and scrolled to; a tab remembered from before opens Settings.
- Nothing about how a video is made changed (layout and labels only).
- Tests (browser): song-stages (the two tabs and icons; Settings' sections and their contents lines; the "Set by
  me" line names Ending and the section says "1 set by me"; ↺ auto empties it; collapse / expand keeps Settings),
  storyboard (collapsed: Settings stays selected; a YouTube video's Look link opens the layout row), style-lock,
  themes, title-opening, pairings (its 428 px check failed before this step too).
- **To check on the PC:** a song → Shape: tabs Settings | Shots. Settings shows "Set by me" and Look open; open
  Part & ending and set a target length of 90 s: the line says "Set by me: Target length 90 s"; ↺ auto removes it.

### Bug fix: adding a song link never replaces another; service from the URL; edit and Undo ✅ (to verify on the Windows PC)
- Bug: Prepare → Song Details → Links: adding an Apple Music link to a song that had a Spotify link left only Apple Music. Cause: the page held its own copy of the list and saved the WHOLE list with every action (add, change a service, edit an address, remove), and a row's service and address were always-open fields that saved on their own. A save made from a stale or half-updated copy (two quick actions, or editing the Spotify row's picker / address instead of adding) wrote that copy over the file. The server and song.json were fine (tested).
- Fix: the page now sends ONE change at a time (add / update / remove / restore) to PATCH /api/songs/[id]/links; the server applies it to the list in song.json as it is now (`changeSongLinks`), so no change can drop a link it is not about. The service is recognised from the pasted address; rows show service + address with ✎ (editor of that row only, Save / Cancel); removing offers Undo (back at the old place, with its Post picks). Every change of the links first keeps the previous song.json in `.studio\replaced\<date>-song.json`.
- Tests: packages/video/test/song-links-server.test.ts (4), apps/studio/e2e/song-links.e2e.ts (in `pnpm test:e2e`). Docs: docs/screens.md (Song links).
- **To check on the PC:** `cd D:\videomaker` · `git pull` · `pnpm dev`. Song → Prepare → Song Details → Links: paste a Spotify link, then an Apple Music link: two rows, each named by its service. ✎ on a row opens only that row; Remove shows "Removed … Undo".
- **Lost link:** look in `D:\videomaker\workspace\songs\<Here With Me folder>\.studio\replaced\` for `*-song.json` copies (made from now on only; older changes kept none).

### Storyboard: shared-collection clips in your story line ✅ (to verify on the Windows PC)
- **How it worked before:** a ticked collection mixed in ALL its clips. They joined one pool with your own clips;
  v1 (story order) played them after your story line, by file name (unless you had moved one in Shape → Shots);
  v2+ shuffled the whole pool (seeded). None of them showed in the story line.
- **Now:** "Add clips & photos" is a menu: **From my computer** / **From a collection…**. The picker shows each
  collection's thumbnails; choose single clips (several at once). They become cards in your story line with a small
  collection badge: drag, Use / Omit, notes, like your own clips. **Remove from this song** never touches the collection.
- **"Let the app pick from the whole collection"** (in the picker): one card "Flowers · app picks · N clips",
  placeable like a clip; that collection's other clips play at its place.
- **The checkboxes are gone.** Shape → Shots no longer orders clips (one place: Prepare → Storyboard); dropping a
  clip on a lyric line or shot still places it.
- **Existing songs migrate without changing their videos:** a ticked collection becomes one "app picks" card at the
  end of the story line (exactly where its clips played before); clips you had placed in Shape become picked clips
  at their place. Saved the first time the Storyboard opens. Test: the planned video before and after is identical.
- Make, Shape and the shot plans use only what the story line holds: picked clips, or a whole collection for a card.
  Compare looks → Other pictures still compares whole collections. Renaming a collection follows into the story line.
- Tests: story-line (6: cards and picks, the migration with an identical plan, remove / add / reorder, a card in the
  middle, the collection keeps its clips, rename follows); clip-order, clip-order-prepare, collections,
  storyboard-edit, storyboard, make-reference, shot-plan-make still pass. Browser: song-stages (no checkboxes; the
  ticked collection is a card at the end; Remove from this song; the menu; the picker's thumbnails; one clip added
  with its badge, Omit / Use; clips already in the line disabled; the app's pick card; the card dragged to the
  front), storyboard (Shape: no arrows, plans the story line's order), clip-notes, collections, style-lock, textboard.
- **To check on the PC:** open "Here With Me" → Prepare → Storyboard: your old collection (if any) is one card at
  the end. Add clips & photos → From a collection… → Flowers: pick two clips → they appear at the end with a
  "Flowers" badge; drag one between your own clips; Shape shows the same order.

### Prepare fixes: Song Details, hints in Assets, one Replaced files list, "Set by me" ✅ (to verify on the Windows PC)
- **Song Details** (was Texts): the tab and every pointer ("Prepare → Song Details"). Old links ?tab=texts and
  ?tab=details keep opening it.
- **Hints (tapped times, hints.lrc) moved to Assets**, right after Lyrics: Song, Vocal stem, Lyrics, Hints, Backing
  vocals, Cover.
- **One Replaced files list, in Assets only**, for every file (hints and earlier lyrics too, each with Restore).
  Lyrics Sync's own "Earlier versions" list is gone; it keeps tempo, Time the lyrics again, the summary line and the
  lyric lines table (and the lyrics editor; after a Save it says the old file is in Assets → Replaced files).
- **The "This song" badge** (EP and the other song settings) meant "saved on this song, changed from the default":
  it now says **Set by me**, like the auto settings (the tooltip still says where it is saved).
- Tests: browser song-stages (the tab names; Assets' order with hints; Lyrics Sync has no files and no Replaced
  files), lyrics-tab (no list of its own; Restore of the earlier lyrics from Assets → Replaced files), style-lock,
  song-title, videos-post.
- **To check on the PC:** Prepare shows Assets · Lyrics Sync · Song Details · Storyboard. Assets lists Hints after
  Lyrics and has the only Replaced files list. In Song Details, EP shows "Set by me" once you set it.

### Prepare regrouped: Assets · Lyrics Sync · Texts · Storyboard ✅ (to verify on the Windows PC)
- Layout and labels only (nothing about how a video is made changed).
- **Assets** (was Audio): the files you provide, in one list: Song, Vocal stem, Lyrics (.txt), then Backing vocals
  and the Cover. Song / Vocals / Lyrics sit together, ready for the 2c slots. "What is this file?" for any file the
  app cannot place (text files too) is here, with the song folder line and the replaced files.
- **Lyrics Sync** (was Lyrics & timing): tempo (BPM, tap test), "Time the lyrics again", hints (tapped times), and the
  lyric lines table. The lyrics file moved to Assets.
- **Texts** (was Details): title and card texts, EP, links. The cover moved to Assets.
- **Every on-screen pointer uses the new names** (Prepare → Texts, Prepare → Lyrics Sync, the lyrics file and cover
  "Prepare → Assets", the clip order "(Prepare → Storyboard)" instead of "Assets or Shape"); the to-do buttons for
  the lyrics file and the cover open Assets. Old links keep working (?tab=audio / files → Assets, ?tab=sync →
  Lyrics Sync, ?tab=texts → Texts; the tab ids stay assets / lyrics / details / clips).
- **Closed banners stay closed:** the only one-time notice is the 31 Oct "starts you set by hand were reset" one; its
  × was already saved (.studio\hand-times.json) and now has a test (hand-reset). Every other banner has no × on
  purpose: it shows something live and goes once solved (Prepare's to-do list, stale timing in Shape, the Library's
  migration offer, "Editing theme …", the warning while you edit lyrics words, Make's "From the run of …"), or it is
  a result that goes on reload (Make's "Queued…", "Saved" notices).
- Tests: hand-reset (new); stability and runs (the new wording). Browser: song-stages (the tab names, Assets' order
  song, vocals, lyrics, backing vocals, cover; the cover to-do opens Assets; Lyrics Sync has tempo, Time the lyrics
  again and hints; Texts has no files; a text file to place is asked about in Assets), lyrics-tab, song-title,
  clip-notes, style-lock, videos-post; new-song-every-platform follows (not run here: a real render worker).
- **To check on the PC:** Prepare shows Assets · Lyrics Sync · Texts · Storyboard. Assets lists Song, Vocal stem,
  Lyrics, Backing vocals, Cover. Lyrics Sync starts with the tempo and Time the lyrics again. Texts has the title and
  links. An old bookmark ?tab=audio still opens Assets.

### Make stage simplified: Make and Compare looks, one counts rule everywhere ✅ (to verify on the Windows PC)
- **Two tabs, each with its own button and count:**
  - **Make:** one row of platform chips, each with its versions (Canvas: loops), pre-filled from the song and saved to
    it at once (0 = not made; a song with nothing chosen yet: every platform once). **One of each (N)** replaces the
    release pack (one video for every platform that is on); **Make N videos** makes them all; ▶ on a chip makes only
    that platform. "Allow clips of the other orientation" is folded under Advanced. The Options tab is gone.
  - **Compare looks:** its own platform chips (Reels by default), 1-3 other themes OR 2-4 picture sets; one video per
    platform per look, each with its own shot plan; the song's own v1 is the baseline, made too where a platform has
    none yet. **Make comparison (N videos)**. No separate "Theme for this run" (one other theme = a comparison).
- **One counts rule everywhere (the bug found):** before, "Videos per platform" showed the presets' numbers (Reels 3,
  TikTok 3, Shorts 2) that the studio never used: with nothing set Generate made 1 per platform; with one platform set
  the others silently took the preset's number while the chips and the total said 1; the release pack always made 1;
  Shape listed v1-v3 of videos never made. Now (recipe.ts videoCount / studioCounts): the song's own count, else 1 in
  the studio (the chips, the button totals, One of each, Shape's video list); the presets' numbers only for pnpm make
  without a count. The studio sends each platform's count with every run.
- **Platforms and counts live in one place only:** Make's chips (the ticks in "What to make", Generate's run chips and
  the release pack are gone).
- **Review labels a try** on its card ("try: theme Night Drive", "try: pictures city"): Compare looks videos are
  never mistaken for versions; older runs made with another theme or picture set are labelled too.
- **"Use these settings"** (a past run) pre-fills the chips from that run (not saved) under a "From the run of …"
  banner, with its part of the song and "Also keep that run's settings for this song".
- **Both buttons wait with the reason** while something blocks ("First: add your clips…", no lyrics, no platform on).
- Every video still comes from its shot plan; tries keep their own (2e-1). Font pairings stay command-line only.
- Tests: video-counts (5: the rule, the studio's platforms, run counts, and a real song where Make, Shape's video
  list and pnpm make agree, with and without the song's counts); shot-plan-make (+ the try label); runs, exports,
  library, run-settings, style, storyboard-save, make-reference still pass. Browser: song-stages (Make: the tabs, the
  chips at 1 each with Canvas loops, the totals, both buttons blocked with the reason, the song's platforms, + saved
  to song.json, One of each / Make 3 videos / ▶ queue the right counts, the chips survive a trip, Compare looks: Reels
  only, blocked until a theme, the baseline note), themes (Compare looks: the song's theme not offered, one other
  theme = 2 videos with the baseline, the two runs), videos-post (the run's chips and banner), style-lock (no preset
  numbers, Advanced folded), storyboard; new-song-every-platform follows (not run here: a real render worker).
- **To check on the PC:** Make: the chips show your platforms at 1 each (Canvas "1 loop"); press + on Reels: "Make N
  videos" grows; reload: still there (Shape lists v1-v2 of Reels). One of each makes one per platform. Compare looks:
  add one theme: "Make comparison (2 videos)" when no Reel exists yet; in Review the try has its "try: theme …" label.

### Review: platform tabs, the same layout as the other stages ✅ (to verify on the Windows PC)
- **Tabs:** one per platform that has videos (or one being made), with its count (Reels 2 · TikTok 6 · YouTube 1), then
  **Post**; the same pink-underline tabs as Prepare, Shape and Make, and "Review · <status>" in the same place. The
  platform summary boxes and "Showing Reels only · show all" are gone.
- **Inside a platform tab:** a header with the platform's verdict, **Make another** and the filters (Favourites only,
  Show discarded); then the approved video(s) first, then every other version newest first. The run's date and time
  is a small line under each card (no more run headings); "command" and "settings" (with Use these settings) stay
  on the card, folded; an interrupted or failed run shows its state (with Resume) there.
- **A video being made** (or waiting in Tasks) is a placeholder card in its platform's tab: "Waiting… take 3, see
  Tasks" / "Making… 1 new video, see Tasks"; the page looks again every 10 s until it is there.
- **Empty runs** stay hidden behind "Show N empty runs" inside the tab (remembered). A platform with nothing finished
  and nothing being made has no tab (an interrupted one keeps its Resume in the song header's chips and in Tasks).
- Layout only: approve, discard, restore, favourites, compare, the player, Post and React work as before.
- **Proposal (not built): Post inside each platform tab?** Recommendation: keep one Post tab. Posting is per platform
  already where it matters: every card's Post button opens that video's own caption, hashtags (YouTube: title,
  description, tags) and files, and the Post tab groups the approved videos by platform with each one's caption. The
  Post tab's value is the release moment across platforms: everything approved for this song, ready to copy and
  download together, the same day. Moving it into each platform tab would split that list into four places and
  repeat the song's links in each. If a per-platform view is wanted, the small step would be a link in each tab's
  header ("2 approved: Post →") that opens the Post tab at that platform.
- Tests: song-stages.e2e.ts (+5: the tabs with counts and a platform being made, no summary boxes, approved first then
  newest, the date line on the card, the placeholder cards for a queued take and the release pack), videos-post.e2e.ts
  (moved to the tabs: the verdict in each tab's header, the tabs Reels / TikTok / YouTube / Post with no Shorts tab,
  "Show 1 empty run" per tab, the marks compared by name since approved cards come first); style-lock, themes, releases,
  library, collections, song-title, clip-notes still pass; tsc clean; pnpm build ok; eslint: only the old findings.
- **To check on the PC:** open a song with videos: Review shows a tab per platform with counts and Post. In a tab: the
  approved video first, the date under each card, Make another at the top; press it: a "Waiting… take N, see Tasks" card
  appears and becomes the video when it is made.

### Theme v2 storyboard, step 2e-1: Make, the release pack and Shape's viewer make every video from its shot plan ✅ (to verify on the Windows PC)
- **Reference first (asked by the user, in place of the golden manifest):** before any change, three songs were made with
  the old code and a renderer that only records what it is given: Ref One (Reels v1 + v2 and a YouTube clips video, title
  opening, hook and end cards), Ref Two (Reels, TikTok, YouTube cover layout, a photo, a moved cut and a slip), Ref Three
  (Shorts and YouTube, story shot length, flowing transitions, stacked lines, big hook): 8 videos, saved in
  `packages\video\test\reference\2e1\` (captured twice: identical; its own commit, 078d8d0). **After 2e-1 the same
  songs give identical props, frame for frame: the same cuts (shot starts, lengths, clips, where each clip starts,
  speeds, dissolves), the same lyric timing and every other prop** (test/make-reference.test.ts).
- **The shot plan is now complete for rendering:** each shot also holds what the renderer draws (where playback
  starts in the clip, its length there, a photo's move, the dissolve, a loop blend) and the plan holds the audio fades,
  the clip files it could use and a fingerprint of everything it is made from (the song, its lyric timing, the clips and
  clips.json, the song's settings for that platform, the variation).
- **One compile (shot plan -> props)** for Make, the release pack and Shape's viewer: the shots, cuts, part of the song,
  fades and lyric timing come from the file; the look (theme, fonts, cards, effects) from the song as it is now.
- **Make settles each video's shot plan before making it:** none yet: saved first; the same plan: made as saved; the
  song, lyrics, clips or settings changed: planned and saved again first, the old plan kept as `<id>.previous.json`,
  and what changed is said in the run's message in Tasks (e.g. "Instagram Reels v1: shot plan saved again before
  making it: the part of the song: 0:02.3-0:16.0 -> 0:02.3-0:18.0; 4 shots -> 5 …"). **Nothing it is made from changed
  but the app would now plan it differently: the SAVED plan is made** (the file wins; said in Tasks and in Shape). Each
  run keeps a copy next to the video (`v1.shotplan.json`) and the manifest says which plan and what happened.
- **Try other looks:** each try has its own shot plan, never the video's own: another theme for a run or Compare
  themes `reels-1~theme-night-drive.json`, picture versions `reels-1~pictures-city.json` / `~pictures-song`, font
  pairings `reels-1~fonts-elegant.json`. Shape's video picker lists them ("v1 · try: theme Night Drive") and opens one
  with its theme, fonts or clips.
- **What 2e-1 does not do yet:** the file wins only as a whole plan; Shape's edits still go to clips.json (2f writes them
  into the plan and locks them); a changed input re-plans the whole video, the old plan kept one step back (2g merges and
  keeps locked shots, with "Back to previous version"). The look always follows the song now (a try keeps its own theme).
- Tests: make-reference (3 songs, 8 videos: identical); shot-plan-make (7: no plan -> saved first, Shape and Make agree,
  the saved plan wins, settings changed -> saved again + .previous + said in Tasks, theme / picture / font tries, Shape
  opens a try, the compile refuses a plan that no longer fits, older plans completed quietly); storyboard.e2e.ts (+3: the
  try in Shape's list, opened with its theme, the own plan untouched). Updated for the new files: make (YouTube, Canvas
  and the real-render list now include v1.shotplan.json; the real-render one runs on the PC only), song-folders
  (storyboards\). Run here: the whole unit suite 1008 pass (only make / migrate / render's real renders fail: Remotion
  cannot reach remotion.media from the cloud, as before); browser: storyboard, song-stages, style-lock, videos-post,
  themes, textboard, title-opening all pass; tsc clean; pnpm build ok.
- **To check on the PC:** open a song in Shape (its shot plans are completed quietly), Make → Make release pack: the
  videos look exactly as before; each run folder has `v1.shotplan.json` next to `v1.mp4`. Change the part of the song in
  Shape → Part & ending for a platform you did not open, Make it: Tasks says the shot plan was saved again and what
  changed. Make → Try other looks → another theme: Shape's video picker lists "v1 · try: theme …".

### Prepare reorganised: Audio · Lyrics & timing · Details · Storyboard; the planned video is the "shot plan" ✅ (to verify on the Windows PC)
- **One kind of input per tab** (Files vs Clips was unclear):
  - **Audio** (was Files): the song folder, the song, the vocal stem, backing vocals (and audio files to place).
  - **Lyrics & timing**: the tempo and Time the lyrics again, then **the lyrics file and hints (tapped times)** (moved
    here from Files, with "What is this file?" for text files), then the lyrics.
  - **Details**: title, tagline, card texts, EP, **the cover** (moved here from Files), the song's links.
  - **Storyboard** (was Clips): "Your story line: drag to set the order.", your clips and photos in story order with their
    notes, Use / Omit, **Add clips & photos** (photos were already accepted: .jpg, .png, .webp; now the button says so),
    removed clips, shared collections.
  - Each tab lists only its own replaced files. Prepare's to-do buttons go to the new places (cover → Details, lyrics →
    Lyrics & timing, clips → Storyboard, vocal stem → Audio).
- **Old links still work:** ?tab=assets / files / audio → Audio, ?tab=clips → Storyboard, ?panel=song → Details;
  ?tab=storyboard (from before 31 Oct) still opens Shape.
- **Naming rule (added to CLAUDE.md):** on screen "Storyboard" means only your story line (Prepare → Storyboard). The
  app's planned video is the **shot plan** everywhere you read it: Shape's hints ("Shape → Analysis says which"), "The
  shot plan could not be made", "…then its shot plan shows here", pnpm storyboards' report ("shot plans: reels-1"), the
  README ("Shot plan (Shape)"). File and code names stay (storyboards\*.json, pnpm storyboards). Messages that pointed to
  old tab names now say Prepare → Audio / Lyrics & timing / Details / Storyboard (no clips yet, no lyrics file, title
  too long, more clips needed, the help text in clips.json and textboard.json, Collections).
- Layout and labels: no setting changed, nothing new besides the moved rows.
- Tests: song-stages.e2e.ts (+13: the tab names, Audio shows only song / stem / backing vocals, Lyrics & timing the
  lyrics file and hints and the text file to place, the cover to-do opens Details, Storyboard's line and Add clips &
  photos with photos accepted, five old links, ?tab=storyboard still Shape, Shape never says "storyboard"); stage-tabs.ts
  opens Prepare's tabs by id; style-lock, clip-notes and new-song-every-platform follow the moves; unit: song-stages
  (to-do targets), stability and make (messages), storyboard-save ("shot plans:").
  Run in the cloud session: song-stages 171, storyboard 156, style-lock 29, videos-post 64, lyrics-tab 33,
  title-opening 40, textboard 19, collections 16, library 22, releases 16, themes 35, song-title 7, clip-notes 14: all
  pass; pairings: only its old 428 px check, as before. Unit (packages/video): 1001 pass; only make / migrate / render
  fail here (real renders: Remotion cannot reach remotion.media from the cloud), as before; the "No clips yet" message
  check sits in make's real-render test, so it runs on the PC only. new-song-every-platform not run here (a real render
  worker). tsc clean; pnpm build ok.

### Song page: the selected stage and tab are unmistakable (pink) ✅ (to verify on the Windows PC)
- **The app's pink accent** (as on the play button) marks what is selected, in all four stages; never green or yellow
  (those keep meaning ready / needs attention, as the stage dots do).
- **Rail:** the selected stage has a pink bar on its left edge, a pink icon, a bold pink label and a light pink tint;
  the other stages are slightly dimmer.
- **Tabs:** the selected tab has a pink underline and bold text; the others stay grey (no more grey "pill").
- **The stage line** ("Prepare · Ready") is a size up, as the page title.
- **Contrast on the dark theme** (WCAG AA needs 4.5:1): pink on the page 9.7:1, pink on the rail's tint 7.3:1, the
  dimmed stage labels 4.9:1.
- Layout and colours only: nothing moved, nothing new.
- Tests: song-stages.e2e.ts (+12: in each stage the rail's selected stage is pink and bold with a 4 px pink bar and the
  others are not; exactly one tab with a pink underline and bold text, the others grey; the stage name 16 px).
  Run in the cloud session: song-stages 158, storyboard 156 (the viewer 532 px: the bigger stage name keeps a 20 px
  line so the header stays as tall as the tabs), style-lock 29, videos-post 64, lyrics-tab 33, title-opening 40,
  textboard 19, collections 16, library 22, releases 16, themes 35, song-title 7, clip-notes 14: all pass. pairings:
  only its old check (428 px), as before. tsc clean; pnpm build ok.

### Navigation N1 polish: the four stages behave the same way ✅ (to verify on the Windows PC)
- **One header on every stage:** the stage's tabs on the left and, on the same row at the right, "<Stage> · <status>"
  (Shape and Review had no such line; on one row so Shape's viewer keeps its height). Shape says which video it shows ("Shape · Reels v1 planned", "… planning…", or the past run shown).
  The rail and the line say "Review" (was "Review & Post"). A banner only when something needs attention: Prepare's
  to-do list and the "Editing theme" banner; the green "Nothing to prepare" box is gone (the line says "Ready").
- **One tab always selected; each stage opens on its last tab** (remembered in this browser, per stage); the first tab
  the first time.
- **Shape's panel always shows its tab's content** beside the viewer. It can only be **collapsed**, with the button on
  its right edge (‹); a thin strip (›) brings it back. The tab stays highlighted while collapsed, and also while Text,
  Theme or Analysis is shown in the panel (their × goes back to the tab). A second click on a tab no longer closes it.
- **No repeated titles:** a Shape tab's panel has no heading (the tab is the title); the Look bar lost its "LOOK" label
  above the theme name; Prepare → Clips lost its "CLIPS" heading; Make → Try other looks lost its "Try other looks
  (optional)" heading (its one-line explanation stays).
- **One distinct icon per tab:** Files (folder), Lyrics & timing (T), Details (i), Clips (film); Look (palette), Part &
  ending (scissors), Pace (gauge), Shots (film); Make: Videos (clapperboard), Try other looks (swatches), Options
  (sliders); Review: Videos (eye), Post (send).
- **"Every change is saved for this song at once." once per stage**, at the right of the stage line (Prepare, Shape,
  Make); the panels only show "Saving…" / "✓ Saved" while a change saves. (The lyrics editor and the theme editor keep
  their own Save buttons, as before.)
- **Wording:** Prepare → Clips → Shared collections: the badge says "Mixed into this song" (was "This song").
- Layout and labels only: no setting moved, nothing new.
- Tests: song-stages.e2e.ts (new checks: Look selected and shown at once, no tab title, no "Look" label, second click
  keeps the panel, no × on a tab's panel, collapse / show again with the tab still selected, the saved-at-once line once,
  "Mixed into this song", distinct icons in every stage, each stage's line, Prepare opens on its last tab); the panel
  helpers in stage-tabs.ts (collapsePanel); storyboard.e2e.ts collapses the panel where it used to close it.
  Run in the cloud session: song-stages 146 (twice), storyboard 156, style-lock 29, videos-post 64, lyrics-tab 33,
  title-opening 40, textboard 19, collections 16, library 22, releases 16, themes 35, song-title 7, clip-notes 14: all
  pass. pairings: only its old check fails (the stand-in viewer 428 px, expects 300-380), as before N1.
  new-song-every-platform not run here (a real render worker). tsc clean; pnpm build ok; eslint: only the old findings.
  storyboard.e2e.ts: with the panel shown, viewer, timeline and command bar fit on one 1440×1000 screen (viewer 501 px);
  collapsed, the viewer has its full 533 px. song-stages: the theme picker's Cancel check now waits for the viewer.

### Prepare → Clips: story notes on the clip cards ✅ (to verify on the Windows PC)
- **Each clip card has a short note at the bottom** for the clip's role in the story line. An empty card shows a faint
  "+ Add a note"; a click opens a small box on the card that **saves as you type** (no Save button); Esc or clicking
  outside closes it to **one line ending in "…"**; a click shows the whole note again; clearing the text deletes it.
  The card does not drag while its box is open, and dragging a card (also by its note line) never opens the box.
- **Kept per clip for this song, keyed by the clip's content** (`.studio\clip-notes.json`): the note follows the clip
  when it is reordered, renamed (the file itself), omitted / used again, removed and restored, and survives every
  regeneration (notes are not in clips.json or the storyboards). A clip replaced by another file under the same name
  finds its note by the name. Two clips with exactly the same content share one note.
- **For you only:** shown in Prepare → Clips only, never in Shape (shot panel, timeline, the future shot list); the app
  never reads them for planning, Make, storyboards, the assessment or anything else (a test checks that only the
  clips list reads the file).
- Tests: clip-notes.test.ts (5: save / delete, rename and reorder, replaced file, long notes, nothing else reads them);
  clip-notes.e2e.ts (14 checks: + Add a note, no drag while writing, saved as you type, no Save, Esc to one line with
  "…", click to expand, click outside, drag without editing and reorder, Omit, renamed file + reload, not in Shape,
  clear = deleted), added to `pnpm test:e2e`; tsc clean; pnpm build ok.
- **To check on the PC:** Prepare → Clips: "+ Add a note" on a card, type, click elsewhere: one line with "…"; drag the
  card to another place, Omit and Use it, reload: the note is still there; open Shape: no note anywhere.

### Navigation N1: four numbered stages, tabs inside them, every setting in one place ✅ (to verify on the Windows PC)
- **The rail holds the four stages only, numbered 1-4** (Prepare, Shape, Make, Review); Shape's menus and the Look
  group are gone from it. Each stage's sections are tabs at the top of its work area:
  - **1 Prepare:** Files (the song's files; was Assets) · Lyrics & timing (the tempo with the tap test and the tempo
    check, **Time the lyrics again**, then the lyrics) · Details (title, tagline, hook and end card texts, EP, the
    song's links) · Clips (the song's own clips, their order, Use / Omit, removed clips, **clips from collections**).
  - **2 Shape:** Look (the Look bar, then this song's title opening, lyric readability, YouTube layout; "Edit theme",
    "All themes ↗") · Part & ending (section, target length, ending) · Pace (shot length, transitions, pace) · Shots
    (the clip strip and the shot clicked on the timeline). A second click on a tab closes its panel.
  - **3 Make:** Videos (release pack, What to make = the song's platforms and videos per platform, Generate) · Try
    other looks · Options (rarely needed). One form: what is chosen stays across the tabs.
  - **4 Review:** Videos · Post (unchanged).
- **Removed duplicates (one place each):** Make's per-run part of the song, length, shot length, YouTube layout and
  videos per platform (a run makes what Shape planned; "Use these settings" from a past run still re-makes that
  run's part and layout, shown read-only, and "Also keep that run's settings for this song" stays for that case);
  "Keep these choices for this song"; "Time the lyrics again first" (now its own action in Prepare); the tagline
  field in Assets (Details); the header's title editor (the pencil opens Details); Shape's theme library (tiles, New
  theme, rename, duplicate, delete, restore: the Themes page has them all); the theme's Line shape / Lines appear /
  Bigger final chorus rows that leaked into "This song" (they did nothing there).
- **"Automatic" is no longer a section:** every setting the app chooses shows **auto** or **Set by me** in place, with
  **↺ auto** to give it back to the app; a locked value keeps its value and shows "Set by me" (no ↺ while locked).
- **Only what applies to the video shown:** a Reel shows the title opening and ending, a YouTube video the YouTube
  layout; the others are folded under "Only for other videos: …" (still one click away). No video planned yet: all.
- **Word fixes in Shape:** the note says whether the lyric timing is still valid; when it is stale, "Time the lyrics
  again" queues it (never silently). **Swaps** say "changes the song's clip order: every video of this song" (2f
  makes them this video's only). Analysis "theme X" opens Look.
- **Old links keep working:** ?tab=assets (Files), ?panel=clips / shot (Shots), auto (Part & ending), song (Details),
  make (Make), theme (the theme editor, ?edit= from the Themes page); the Prepare to-do "Add clips" opens Clips.
- **Reachability check:** every control reachable before N1 is reachable after it (listed in the summary to the user);
  only the per-run overrides in Make were removed on purpose (decided).
- Tests (browser tests updated to the new places through stage-tabs.ts): song-stages, style-lock, storyboard,
  textboard, themes, lyrics-tab, song-title, collections, library, releases, videos-post, title-opening all pass.
  pairings: one old check fails before and after N1 (the stand-in viewer is 428 px wide, the check expects 300-380;
  it fills the free height since 2 Nov). new-song-every-platform not run here (a real render worker). Unit: runs
  (new: Time the lyrics again), lyrics-view, song-stages pass; the whole suite 994 pass, only make / migrate / render
  fail here because Remotion cannot reach remotion.media from the cloud session (real renders; unrelated). tsc
  clean; pnpm build ok; eslint: only the old findings.

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

### Bug fix: the Reel's title did not show when the part of the song starts on a sung line ✅ (confirmed on the Windows PC in Shape, 8 Nov 2026)
- Seen (Let My Love Carry You, Reel; Shape → Reels 0:36.1-1:41.3 chosen on the song track, Title opening on): "the title is not showing", "the tagline is not showing". Line 5 ("Let my love carry you through the night") is sung at the very start of that part.
- Cause: the title opening showed title, byline and tagline only until the first lyric line fades in (make.ts passed `untilFrame` = that line's enter frame). The automatic section leaves up to 2 bars (titleLead); a part chosen by hand on a sung line leaves none, so the cards got a few frames or none, silently. Shape's plan uses the same make.ts dry run, so it showed the same.
- Fix (automatic, no new setting; src/node/textboard.ts titleCards, make.ts): with a lead-in shorter than TITLE_MIN_S (2.5 s) every card block (title + byline; the tagline) is checked against the first lyric line's box (measured as QA does). A block that does not touch the line stays on screen for 2.5 s, also while the line is shown. A block that would touch it is shown alone until the line fades in (the music and the lyric timing are never touched) and a plain note in the plan's decisions and the warnings says: "No room for the title (tagline) before the first line: start the Reel's part of the song about 2 bars earlier (drag the pink window's start on the song track) or let the app choose it (Automatic)." QA "Title cards clear of the first lyric" now only fails for a block that touches the line. The automatic section is unchanged.
- Tests: test/title-opening.test.ts 4 new (16 in the file), with test/storyboard.test.ts 24 pass; tsc clean (packages/video, apps/studio).
- To check: `cd D:\videomaker`, `git pull`, Shape → Reels, window at 0:36.1, Title opening on: the title and byline stay about 2.5 s, or the plan says "No room for the title before the first line..." and the part starts about 2 bars earlier (or Automatic).

### Review: no line across the video in the browser's player ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Found by the user (8 Nov 2026): a thin horizontal line across the Reel in Review (not in Shape). The MP4 itself is
  clean (checked by the user in Media Player): it is the top edge of the dark band Chrome / Edge draw behind their own
  video controls (▶ / time / volume).
- The app's pages now draw a soft fade there instead (no edge): a small style in app/layout.tsx (the CSS build drops
  these browser-specific rules from globals.css, so it is a plain <style> tag). Review, Post and Compare players.

### Shape timeline: a taller clip strip, thinner rows above it ✅ (confirmed on the Windows PC, 8 Nov 2026)
- Asked by the user (8 Nov 2026): "the video strip is too squashed and I can barely see the video; maybe make the
  timeline thinner to save space".
- **The clips row is 96 px** (was 68): each clip shows its picture as a film strip in its own shape (repeated along
  the shot, as editors do), no longer cropped and darkened; the name and times sit on a thin dark band at the bottom,
  the badges at the top.
- **Thinner rows above it**, so the timeline keeps its height and the viewer grows a little: the time ruler and the
  bars on ONE 20 px line (asked by the user: "times and bars together"; were 20 + 24 px): the times at the top, each
  bar a small pink number on its own tick at the bottom, the choruses shaded behind; the song track 24 px (28), title
  cards 20 px (24), lyric lines 32 px (40).
- Tests: storyboard.e2e.ts unchanged (the viewer 353 px on 1366×768, was 341; 18 px under the command bar): run in the
  cloud session, all 147 checks pass.

### Shape timeline: lift a clip onto another to swap them ✅ (confirmed on the Windows PC, 8 Nov 2026: works, "a bit slow")
- Asked by the user (7 Nov 2026, with the soundtrack window): "drag a clip onto another shot to swap them on the
  timeline"; the gesture chosen by the user (8 Nov 2026): **lift it up** (a sideways drag stays a slip).
- **Lift:** drag a clip upwards first (about half a centimetre): it lifts (dimmed on the row, a small card of it follows
  the pointer). Move it over another clip (pink ring, "swap 1 · a.mp4 ↔ 2 · b.mp4") and let go: the two clips swap
  places; the cuts stay where they are (the music is fixed); the viewer stands on the moved clip. Esc, or letting go
  anywhere else, puts it back.
- **Saved in the story order** (clips.json "order", the same order as Assets and the Clips panel), so every video gets
  it; a lyric line anchored on one of the two clips is anchored on the other afterwards (song.json anchors follow their
  clips). Ctrl+Z / Undo swaps them back (the anchor too), Redo again.
- **The Reel's loop ending** (the last shot, ↻, replays the first clip so the Reel loops seamlessly) cannot be lifted or
  swapped; over it the readout says so. Swapping the first clip changes it too.
- Tests: timeline-edits.test.ts (swapInStory: the order, anchors follow, twice = back); storyboard-edit.test.ts (the
  swap re-plans with the same cuts, Generate renders the same shots, swapping again gives it back); storyboard.e2e.ts
  (lift shot 1, no drop on the loop ending, swap with shot 2, cuts unmoved, clips.json order, the anchor followed, Esc,
  Ctrl+Z): run in the cloud session, all 147 browser checks and 31 unit tests pass.

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

### Shape: the whole song as the soundtrack, the video as a window on it ✅ (confirmed on the Windows PC, 8 Nov 2026, in its new place on the song track)
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
- Next (asked with it): drag a clip onto another shot to swap them on the timeline (done 8 Nov 2026: lift and swap).

### Shape timeline: trim the first and last clip, the clip in the viewer while editing ✅ (confirmed on the Windows PC, 8 Nov 2026)
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

### Shape timeline: pro edits with the mouse, part 1 (roll, slip, snapping, Undo) ✅ (confirmed on the Windows PC, 8 Nov 2026)
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

### Theme Engine v2 on HyperFrames, step 2b part 1: the lyrics and cards on HyperFrames, the same code ✅ (to verify on the Windows PC)
- **HyperFrames now draws the words with the same code as the current renderer:** the lyric scene (LyricScene.tsx)
  and the title / byline / tagline / hook / end cards (TextCards.tsx, moved out of LyricVideo.tsx) run inside the
  HyperFrames page as a text layer, React and our text code bundled locally (esbuild) at render time, a page clock
  in place of Remotion's, driven frame by frame by the GSAP timeline (seekable, deterministic). So every lyric
  effect (typewriter, karaoke highlight, glide, ...), the text backings, emphasis, big hook, the waiting next line
  and the title cards with the Japanese fallback font look exactly as before. The timeline is registered once
  every font face is loaded (HyperFrames waits for it).
- **Off Remotion for the effects:** our own easing curves (src/easing.ts, test: the same as Remotion's to 1e-5)
  and text measuring done the same way (a span's width), so lines wrap at the same word.
- **Check:** `pnpm hf:parity` now compares the whole video, words and cards included, plus the lyric area alone.
  Cloud test song (glide / karaoke-highlight): whole 0.9929 (lowest 0.9908), words the same. New test (typewriter
  verses, karaoke hook, typed title with byline, Japanese tagline): whole 0.9915, lyric area 0.9921, cards 0.9916
  (lowest 0.990): the same words, frame by frame. Zero network still (the test now includes the text layer and a
  Japanese card). A Reel with lyric effects and title cards now has nothing HyperFrames cannot draw.
- Tests: easing, hf-parity (picture + Reel text), hf-network (text layer), hf-compile, textboard-make.
- **Licence check (asked by the user, 6 Nov 2026):**
  1. The text layer's bundle contains **no Remotion package**: our own 34 files + `react`, `react-dom`, `scheduler`
     (MIT), checked with esbuild's input list. The bundler itself, `esbuild` (MIT, not Remotion), only builds the
     file on the PC. Still named, for step 8 (in the plan's removal list with the replacement): LyricScene.tsx /
     TextCards.tsx import `remotion` (frame, settings) and `@remotion/layout-utils` (measureText) by name for the
     current renderer, mapped to our own clock.ts / measure.ts in the text layer (step 8: import ours directly);
     youtube.ts's `interpolate` (step 6); test/easing.test.ts compares with Remotion (removed with it).
  2. **The easing curves are our own implementation** (src/easing.ts): the standard cubic-bezier maths (the curve's
     polynomial, solved for x with Newton-Raphson steps, bisection as a fallback), written for this project, not
     copied from Remotion's source; the test only checks the results match Remotion's to 0.00001.
- Next (part 2, new on HyperFrames only): the stacked line shape with build-up, the bigger final hook,
  docs/theme-rules.md.

### Theme Engine v2 on HyperFrames, step 2a: the Reel picture ✅ (confirmed on the Windows PC, 6 Nov 2026)
- **HyperFrames now draws the whole Reel picture as the current renderer does:** clips (offset, speed, held last
  frame), photos with their Ken Burns move (also the looping move), cuts, dissolves, dips, the loop ending (the first
  shot's opening fading in over the last frames; when it cannot play from there, its first frame as a picture made
  once by our FFmpeg), the theme's grade and veil, vignette, the readability band, the background where there is no
  clip (gradient, colour, blurred cover). Lyric lines already follow the textboard (each line's place, size, font),
  the hook font, the text case and the lead-in after a gap; their look stays the stand-in until 2b.
- **Picture check:** the same plan drawn by both renderers without the words, compared frame by frame (SSIM). Test
  hf-parity (clips, a photo with a dissolve, a dip, a held frame, the loop ending, warm grade, vignette, band):
  mean 0.993, lowest 0.988 = the two encodes' own difference. The cloud song plan: mean 0.9955, lowest 0.9946.
  `pnpm hf:parity "<song folder>"` does the same for a real song (report.md + the least similar frame side by side).
- **Bug found and fixed by the check:** HyperFrames reads times to 0.1 ms, so a start written a hair after its frame
  showed some cuts one frame late (3 of 12 cuts). Starts are now written rounded down, clip offsets rounded up;
  a test checks every frame of a minute.
- **On the user's PC ("Here with Me", 30.4 s, 5 shots, loop ending): the same picture**, mean 0.9904, lowest 0.9876
  over 912 frames; current renderer 51.6 s, HyperFrames 44.6 s. Still to move over for it: the lyric effects
  (typewriter / karaoke-highlight): step 2b.
- **A removed** (the lyric layer over an FFmpeg picture): HyperFrames draws everything in one pass.
- Still made by the current renderer: anything with lyrics (their look moves over in 2b), the text backings shadow /
  glow / box, title cards, mood, grain, glow, logo, YouTube layouts and the Canvas loop blend; the log says which.
- Tests: hf-compile (Reel picture, the loop ending, every frame of a minute), hf-parity, hf-network (one pass).

### Theme Engine v2 on HyperFrames, step 1: renderer seam, (b) checked, zero network ✅ (confirmed on the Windows PC: B 26.8 s vs Remotion 29.3 s, 6 Nov 2026)
- **D1 decided by the user (6 Nov 2026): (b), HyperFrames draws everything in one pass** (clips, cuts, dissolves,
  dips, lyrics, effects). It is the target architecture; step 1 measures its speed and the clips' frame accuracy as
  a check, not a choice: if it is slow or a clip drifts, the cause is fixed. (a) (lyrics layer over an FFmpeg
  picture) stays only as a temporary fallback until (b) passes on the PC.
- **Zero network calls when rendering (the user, 6 Nov 2026):** fonts only from our own font files (`@font-face`
  under a private name `vm <family>`, no generic fallback, so no Google Fonts fetch even as a fallback); GSAP and
  the clips copied into the render folder; telemetry, update checks and auto-installs off. Chrome for HyperFrames
  is downloaded once by `pnpm hf:setup` into `.cache\hyperframes` (the only online moment). Test:
  hf-network.test.ts renders under a connection trace and fails on any connection off this machine.
- **Built (packages/video):** the converter `src/hf/compile.ts` (the same props as Remotion → HTML + GSAP: shots as
  video elements with trim, speed and held last frame, dissolves, dips, the stand-in "Glow reveal" lyrics, fonts),
  which also lists what it cannot draw yet; `src/node/hf-render.ts` (render, the song section with its fades by our
  FFmpeg, nothing else done to the music); `pnpm make ... --engine hyperframes` uses it when a video has nothing
  HyperFrames cannot draw yet, otherwise Remotion makes it and the log says why in plain words; the manifest records
  the renderer. Remotion stays the default.
- **Frame accuracy:** a test clip with its frame number in every frame, played trimmed, slowed (0.5x, 0.75x),
  jumping back and running out (last frame held): every rendered frame must show exactly the planned source frame.
- **Cloud results** (synthetic song, 31.3 s, 12 shots, 4 cores, no GPU): Remotion 147.3 s, **(b) 93.2 s (63% of
  Remotion's time)**, (a) 134.8 s; frame accuracy 240 of 240 for (b), (a)'s picture and Remotion; zero outside
  connections. The LGPL FFmpeg with NVENC could not be fetched in the cloud: it is timed on the PC.
- **On the user's PC (6 Nov 2026, "Here with Me", Reel section 30.4 s, Core Ultra 9 275HX, RTX 5060): B passes.**
  Remotion 81.4 s, **B 34.6 s (42% of Remotion's time)**, A 60.2 s; frame accuracy 240 of 240 for B, A's picture
  and Remotion. The LGPL FFmpeg (BtbN master) is LGPL with libvpx-vp9 and no libx264, but its NVENC needs NVIDIA
  driver 610+ (API 13.1; the PC has 591.86, API 13.0).
- **Second run on the PC (release build n8.1 LGPL):** Remotion 33.3 s (the first run's 81.4 s included a cold
  start: Remotion's first bundle), B 38.0 s (114% of Remotion), B with LGPL + NVENC 37.7 s, A 58.4 s; 240 of 240
  frames for all four. NVENC works with n8.1 (driver 591.86); same quality as x264 at 10 Mbit/s (SSIM 0.99425 vs
  0.99427), encodes in half the time, but encoding is not B's bottleneck: HyperFrames' frame capture is (~34 s).
  Open: find why the capture takes ~34 s for 30 s of video and fix it (not a reason to fall back to A).
- **Cause found (cloud): HyperFrames chooses too few workers** (Chromes drawing side by side): on 4 cores it chose
  1 after an 11 s calibration (a "contention" rule: about 2.5 cores per worker); on the PC its rules allow at most 6
  of 24 cores. **Fix:** our renderer chooses (hfWorkers: one per core, at most half the memory at ~1.5 GB each, at
  least 30 frames each, at most 16; on the PC 10) and passes `--workers`, which also skips the calibration. Cloud:
  HyperFrames' choice 87.7 s, ours 58.5 s, the same 240 of 240 frames. `pnpm hf:measure` now also times B at
  several worker counts and with / without Chrome on the GPU, and the report says how HyperFrames drew (workers,
  capture mode, GPU); the PC's numbers set the final default. Remotion is warmed up first (its first render
  builds its bundle). Tests: hf-workers.
- **Third run on the PC (6 Nov 2026): B passes. Remotion 29.3 s, B 26.8 s (92% of Remotion)**, B + LGPL + NVENC
  32.0 s, A 46.2 s; 240 of 240 frames for all four. Workers: HyperFrames' own choice 6 (34.7 s), 2: 52.4 s,
  4: 43.2 s, 8: 34.1 s, **10 (our choice): 31.7 s**, 12: 32.0 s, 16: 32.7 s: our choice stays the default. Chrome
  uses the GPU by itself (off: +1.5 s); Windows captures by screenshot. NVENC gives no gain here (the drawing is
  the bottleneck, not the encode): libx264 stays the default; the LGPL build with NVENC works, for the installer.
  Step 1 done; (a) is no longer needed and goes when step 2a is in. The report now prints the
  card's own reason and the FFmpeg version (it was hidden by Windows line endings).
- `pnpm hf:measure "<song folder>" [--lgpl "<ffmpeg folder>"]` writes a report (times, frame accuracy, NVENC vs
  x264 quality at the same bitrate, the LGPL build's licence line) to `workspace\cache\hf-measure\<song>\<time>\`.
- Tests: hf-compile, hf-network, textboard-make (fallback with its reason); video package 934 pass.

### Theme Engine v2 on HyperFrames, step 0: "break." fixed in the spike ✅ (confirmed on the Windows PC, 6 Nov 2026)
- **Confirmed by the user on "Here with Me"** (the planner's own section, both formats): 35 of 35 words land on
  exactly their sung frame (timeline mean and worst 0 ms), the pixels confirm all 35; "break." (sung at 19.700 s,
  frame 591) lands on frame 591 in the timeline and is brightest on frame 591 in the pixels, 16:9 and 9:16.
- Plan approved (6 Nov 2026) with four changes, all in docs/theme-engine-v2-hyperframes-plan.md: the first release
  milestone M1 (the Reel word-by-word theme for real releases right after steps 0-2, step 2 split into 2a picture
  and 2b the theme's text), D1 = everything in one only if within ~20% of lyrics-only speed AND clips frame-accurate
  in the browser, an LGPL FFmpeg with NVENC timed in step 1, GSAP / FFmpeg licences non-blocking (a note before
  step 8).
- **Cause found:** the spike chose its own section start (one bar before the hook, as a fixed section), so a line
  could already be sung when the segment starts; the sync check then found the word's spot already lit when its
  ±200 ms window opened and reported exactly -200 ms. Reproduced on the cloud fixture (a section starting inside
  "Whisper my name in the dark": the old spike gives "dark" -200 ms, flagged early).
- **Fixed (spikes/hyperframes only):** the section is now the planner's own Reel section aimed at ~30 s (never
  starting inside a sung line; `--section` forces a fixed one); a line already on screen at frame 0 is drawn
  settled (words sung before the start shown, no fade-in); the sync check takes each word's landing frame from
  the theme's own timeline (exact) and uses the pixels to confirm it (a spot lit by something else = "not
  measurable", never early or late); `--trace "word"` prints a word frame by frame.
- Cloud fixture after the fix: the same mid-line section: "dark" 0 ms, 27 of 27 words confirmed by the pixels;
  the planner's section (0:07.8-0:39.1): 42 words, every one on its own frame, pixels agree, in both formats.

### Theme Engine v2, step 1: HyperFrames spike — ADOPTED ✅ (6 Nov 2026; code in spikes/hyperframes only)
- **Decision (the user, 6 Nov 2026): HyperFrames is adopted as the lyric renderer.** Results on the user's PC
  (Windows, RTX 5060, 32 GB), "Here with Me", first chorus: **9:16 72.3 s vs 81.3 s with Remotion** (the same
  plan), **16:9 89.7 s**, sync mean ~25 ms (under one frame). The user's verdict: "lyrics spot on." One word,
  "break." at 0.77 s, measured 200 ms early: almost certainly an artefact of the spike's section start (a line
  carried in at frame 0, measured at the edge of the check's ±200 ms window); confirmed and fixed in step 0 of
  the plan.
- **Next: the plan** docs/theme-engine-v2-hyperframes-plan.md (for the user's review): the "break." fix,
  HyperFrames behind the same plan with Remotion as fallback until parity (feature by feature), Remotion removed
  before any commercial version (licence), three starter themes driven by docs/theme-rules.md with the user's
  timestamped notes becoming rules, phases (~20 sessions), effort and risks.
- **What the spike is:** `spikes/hyperframes/spike.ts "<song folder>"` runs our normal pipeline as a dry run
  (the stored alignment, read only; beat cuts), takes the first chorus, writes timing.json (the planner's word
  times), fills one theme template (template/theme.html, "Glow reveal") for 1920x1080 and 1080x1920, renders each
  with HyperFrames as a transparent layer, lays it over the beat-cut clips + the song with FFmpeg, logs render
  times per format, renders the same 9:16 plan with Remotion for comparison and checks sync on the pixels.
  Nothing in apps/ or packages/ changed.
- **Node >= 22 required** by HyperFrames (the app needs 20.9+); Windows setup in spikes/hyperframes/README.md.
  HyperFrames' telemetry is always off (HYPERFRAMES_NO_TELEMETRY=1, DO_NOT_TRACK=1).
- **Alpha format: transparent WebM (VP9 with alpha)**: the same render time as ProRes 4444 (.mov), 3.3 MB instead
  of 161 MB for 31 s, and it plays in a browser; `--format mov` stays available.
- Cloud fixture (synthetic song, 4-core Xeon, no GPU): 120 s (9:16) / 140 s (16:9) vs 133 s Remotion; all words
  landing inside the segment on their own frame.

### Theme page: "✓ Saved" next to each change ✅ (to verify on the Windows PC)
- Asked by the user on 2 Nov 2026 ("where's the save button" on Themes → a theme). The page saves as you go (Designer
  and About when you leave the box or press Enter, a Mood on click, the Theme cover when picked or removed, the name on
  rename); now each shows "✓ Saved" next to it, and a failed save says "Not saved: …" inside the theme's view (it was
  shown behind it, on the page). Edit theme keeps its Save / Save as new theme / Cancel (it can change several songs).
- Tests: themes.e2e.ts (✓ Saved after Designer and Mood).

### Shots: normal speed first, your clip edits kept, no false "held" warning, Omit from the Shot panel ✅ (to verify on the Windows PC)
- Reported by the user on 2 Nov 2026 (Familiar Strangers Reels: shots 1-4 and 6-9 all "speed 0.82x" and "the clip is
  too short: its last frame is held for 0.0 s"). Decided: "by default the app should do what it thinks is best; then I
  cut down parts of each clip and slow down when a scene needs to cover a whole sentence; the creative part should
  remain once I manipulate the clips"; "I need both options (Omit and Remove) because sometimes I try sequences".
- Cause: the automatic pacing chose 4-bar shots (6.3 s) for ~5.2 s clips because it allowed clips down to 0.8x, so
  every clip was stretched to 0.82x and came out one frame short.
- **Pacing prefers normal speed** (pace.ts SLOW_WEIGHT): a shot longer than the typical clip costs a slow-motion
  penalty. Familiar Strangers: 3 bars (4.7 s) at full speed instead of 4 bars at 0.82x. A clip you slowed in Edit
  clip counts as longer, so your slow motion keeps its long shot.
- **Your edits are kept**: a clip's in / out and speed from Edit clip are played exactly. When a clip you trimmed is
  shorter than its shot, the Shot panel says so in plain words ("your trimmed clip (2.5 s) is shorter than this
  4.7 s shot: lengthen it in Edit clip or slow it down there"). Moving the cut to where your clip ends was not done:
  cuts are fixed before clips are placed (lyric holds, anchors, the loop and dissolves read them); on the backlog.
- **"held for 0.0 s" gone**: a held last frame is only reported from 0.2 s (HOLD_NOTICE_MS), when it can be seen.
- **Shot panel: "Omit this clip"** (data-shot-omit) replaces "this clip doesn't fit here" (which moved the clip to the
  end of your order without asking); the same as the Use / Omit switch: greyed out, keeps its place, Use brings it
  back. Remove in Assets stays for a clip you have decided against. The clip-misfit reaction is removed.
- Tests: pace-transitions, shots, storyboard, reactions (video package: 886 pass; make / migrate / render need the
  network and fail in the cloud before and after); browser tests storyboard, textboard, song-stages pass.

### Shape: one Analysis chip in the song header, nothing else above the viewer ✅ (to verify on the Windows PC)
- Asked by the user on 2 Nov 2026 ("still too scattered information, group all these infos into a single tag called
  Analysis where you explain by section"; "I don't need the buttons Ready to post and Make on the top right, they are
  redundant"; "that should free the space to make the viewer bigger").
- The song header has an **Analysis** chip (a dot in the verdict's colour). It opens the Analysis panel on the left:
  Verdict · This video · Look & content · Length & ending · Clips & warnings (only when there are any) · How to edit.
- Gone from the page: the stage line, Look · Content line, the video's line, the hint, the verdict badge, Next: Make
  (Make is in the rail) and the Plan details fold. The viewer starts right under the song header and takes that room:
  537 px on 1600×950 (424 px this morning).
- Same evening: the bottom block (timeline + transport) about 1 cm lower: the free room under the command bar 56 → 18 px
  ("better try to move the whole bottom block a bit lower about 1 cm"); the viewer grows with it (625 px on 1440×1000,
  393 px on 1366×768).
- Tests: storyboard.e2e.ts (the chip, nothing else above the viewer, the panel by section, a second click closes it),
  song-stages.e2e.ts and textboard.e2e.ts updated (Look · Content and the summary read from the panel; the rail's Make).

### Shape: a bigger viewer, everything else at the top ✅ (to verify on the Windows PC)
- Asked by the user on 2 Nov 2026 ("how come the video viewer has become smaller … move the titles to the top and make the
  sound wave flatter"; "all these messages at the bottom should be moved to the top, including this Make button. Still leave
  some space at the bottom").
- Cause: the viewer's height was the screen minus a fixed 36rem; rows added since (Look · Content line, title cards, a
  command bar on two lines, two lines under it) left it at its 260 px minimum on a laptop screen.
- Now the viewer fills the height that is left (measured, between 260 and 760 px), with 56 px kept free under the command bar.
  At the top: the stage line with Look · Content on one line, then the video's line (Reels v1 · length · section · BPM ·
  shots), the hint, the verdict and **Next: Make**. The command bar holds only which video, the transport, Follow and Zoom.
  Waveform 64 → 28 px, lyric row 48 → 40 px, shots row 96 → 68 px (badges stay at the top of each shot).
- Measured in the cloud browser: 1440×1000 viewer 424 → 513 px; 1366×768 from 260 px (command bar off the bottom) to 281 px
  with 57 px free under the command bar.
- Tests: storyboard.e2e.ts (viewer fills the free height, room under the command bar, the top line holds summary, hint and
  Next: Make, 1366×768). Its later playback checks run on a 1440×760 window, since the cloud browser has no graphics card.

### Automatic length for Reels, TikTok, Shorts + a clean Reel start ✅ (to verify on the Windows PC)
- Asked by the user on 2 Nov 2026: a Reel with the 90 s preset came with a remark that 90 s was too
  short, and there was no way to let the app decide. Also: Familiar Strangers' Reel was "Not ready".
- **Length: Automatic** (the new default; Shape → Automatic → Length: "Automatic" or "Seconds I choose"):
  the app ends on the finished phrase nearest the platform's length anywhere in its range (platforms.json
  length.auto: Reels 0:45-2:00 near 1:30, TikTok 15-45 s near 25 s, Shorts 30-75 s near 50 s; a chorus line
  first inside +-15%, else the nearer of a shorter or longer finished phrase). The plan and the video say
  it in plain words ("Length: automatic, 1:48: ends after the chorus line ..."; manifest settings.length),
  never as a missed target.
- A typed length is still followed (+-15%, then 25% shorter / 30% longer); when no phrase finishes near
  it, one plain line says so, with **Use automatic** next to it on the Shape page.
- **Reel start fix** (Familiar Strangers: "i was never meant to keep." runs straight into the hook, so the
  start 0.3 s before the hook clipped it): when no bar within one bar of the hook is clean, the start moves
  back to the bar before that line (at most 2 lines back); the hook comes a little later.
- Tests: timing-fixes.test.ts (start, Automatic, typed length), platform.test.ts, style.test.ts;
  e2e style-lock (the Length choice).

### Song clip order: drag clips into order in Assets ✅ (to verify on the Windows PC)
- Asked by the user on 2 Nov 2026: upload a batch of clips with any names, then just drag them into order;
  no renaming one by one.
- Assets shows the song's clips numbered in the song's clip order (clips.json "order", the same sequence
  Shape's Clips strip shows and Make uses); drag one onto another to reorder, saved at once.
- New clips go at the end, sorted by file name among themselves (clips named 01_, 02_ keep that order);
  "Sort by file name" puts the whole song in file-name order; Remove takes a clip out of the order,
  Restore puts it back at the end. Collection clips keep their places in the order.
- Then (user's decision, same day): **no more shuffle**: every video of a run follows the order (they differ
  by style, pace and cut / dissolve; the Lyrics tab's gap-order choice is gone). **Use / Omit** on each clip,
  in Assets and Shape → Clips (clips.json "omit"): an omitted clip keeps its place and Make leaves it out;
  an anchor on it becomes "needs a clip"; every clip omitted says so. Shape's reorder keeps the clips it
  cannot show (other orientation) in their places, so Assets and Shape stay one sequence.
- Tests: clip-order.test.ts, song-folders.test.ts (Assets order, Use / Omit, no shuffle).

### Stability pass: no quiet choices, nothing replaced without a way back ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 after the evening's bugs (a song taken over, a collection never ticked, a
  Reel cut on a comma): the app must not "help" without saying so.
- Two more takeover guards: "+ New song" with a deleted song's file says so (Restore it in Deleted songs)
  instead of quietly bringing it back under the new title; Replace song refuses another song's file.
- Nothing deleted: the spare copy of a song file adopted into a hand-made song folder now goes to
  .studio\replaced\ (was deleted).
- No quiet picks: a run from Lyric Studio never changes the song's collections (only "Keep these choices
  for this song" does); a collection only remembered from an old terminal run is written into song.json by
  the Library's Tidy, so Shape shows it; a missing lyrics file is said in plain words (no older copy used).
- Assets: every Replace asks first (which file is in use, that it is kept); **Replaced files** lists every
  kept file with what it was, and Restore makes it that again; removed clips have Restore too.
- Tests: stability.test.ts; new browser test e2e/new-song-every-platform.e2e.ts (New song through the
  Library, same file refused, clips, Replace lyrics + Restore, Make Reels/TikTok/Shorts/YouTube/Canvas by
  the real worker; each video's size, audio and song checked). Its one stand-in is the lyric aligner.

### Fix: a new song's run failed on an empty collection it never chose ✅ (to verify on the Windows PC)
- Reported by the user on 1 Nov 2026 (Familiar Strangers, 11 own clips: "No videos or photos in
  collections\Flowers").
- Cause: Make's panel, for a song with no collection and (at page load) no clips yet, silently picked the
  first shared collection (an empty "Flowers") and kept it after the clips were added.
- Now Make never picks a collection for the user (generate-panel.tsx); an empty or missing collection in a
  run is skipped with a note and the run goes on with the other clips (make.ts; readability-make.test.ts);
  with no clips at all it says "No clips yet …: add clips in Prepare → Assets, or choose a collection".

### Fix: lines a few px past the safe margin ("Not ready") ✅ (to verify on the Windows PC)
- Reported by the user on 1 Nov 2026 (Here With Me YouTube: hook lines 33 px, line 15 7 px past the right 4%).
- Cause: a line was fitted to the lyric area at rest; its effect (chorus lift, breathe, word scale, drift)
  then grew it past the margin. Now the render (LyricScene) and QA (qa-check) fit each line to the area
  minus its effect's growth (effects/scene.ts restWidth; test rest-width.test.ts), so it stays inside.

### Fix: Reels ended mid-chorus ✅ (to verify on the Windows PC)
- Reported by the user on 1 Nov 2026 (Here With Me, 90 s Reel "cut hard"). With Reels at 90 s the window fell
  inside the second chorus and the section ended after "I feel your warmth, though I can't see," at full level.
- The automatic end now waits for a finished phrase: never after a line ending in a comma, dash, colon or
  "and/but/or", and inside a chorus only after its last line (the whole repeated block holding a hook line
  counts as the chorus). No such end in the window: up to 25% shorter, else up to 30% longer (Here With Me:
  about 105 s, ending on "you're here with me."). Only when no finished phrase is in reach does any line end
  count (section.ts; tests in section.test.ts and platform.test.ts).

### Fix: "+ New song" took over an existing song ✅ (to verify on the Windows PC)
- Found on 1 Nov 2026: "Here With Me" was made with "+ New song", but the song file picked was The House My
  Heart Built's own WAV. New song found The House by the music's content and UPDATED it: new title (the
  folder was renamed), lyrics and cover; then the song and vocal were replaced on Assets. The House was gone
  as a song.
- Now "+ New song" only ever makes a new song: music already in the library says "This song file is already
  in your library as …. Nothing was changed." (createSong; library.test.ts).

### Fix: Review showed another song's videos ✅ (to verify on the Windows PC)
- Reported by the user on 1 Nov 2026 ("I'm reviewing Here with me, why am I seeing the other song's reels?").
- Cause: Review lists every video in the song folder's exports\ folder. A song folder made by copying another
  song's folder brings that song's exports along. Now a video shows only when its manifest names this song,
  or was made from the same music (songRuns; test in exports.test.ts). The other files are not touched.

### Reels length: 90 s instead of 30 s ✅ (to verify on the Windows PC)
- Decided by the user on 1 Nov 2026 ("90 s gives time to hear the core chorus and tell a story without becoming
  a mini series"; exceptionally up to 2 min when the story is compelling: the "Long story" choice, Theme v2 step 6).
- presets/platforms.json: Reels length target 90 s (tolerance unchanged, +-15%: 76.5-103.5 s; up to 25% shorter
  = 67.5 s when no clean end exists in the window). Still hook-first: the "story" start from verse 1 is Theme v2 step 6.
- A song shorter than the window from its hook simply runs to its end (the musical-ending rule, unchanged).
- Tests: platform.test.ts (preset and window), style.test.ts (preset length "90 s"), make.test.ts (a song that ends
  inside the window runs to its end); timing-fixes.test.ts keeps its length-rule cases on a 30 s Reel fixture.

### Song links: streaming, smart links and social pages per song, picked per post ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 ("when we post per song and platform, we need the link to each platform for
  the song like Spotify, Apple, YT; on the song assets we add these links"; also marketing platforms such as
  Feature.fm, the artist's own website, Facebook, SoundCloud; "the artist picks the ones they need, or a copy
  icon when creating the reel").
- **Assets → Links**: paste a link and the app names its service (Spotify, Apple Music, YouTube Music,
  Feature.fm, Linkfire, HyperFollow, Instagram, Facebook, …); change it with a searchable picker (Stores ·
  Smart links & marketing · Artist & social; "Other" with its own name). Copy and remove on each row. Saved
  at once in song.json "links".
- **Post panel → Links for this post**: the song's links picked for this post, each with Copy; "Add a link"
  (picker) and × change the pick, kept per platform (song.json "postLinks"; "Back to the usual ones").
  The usual ones: YouTube all the links; Reels / TikTok / Shorts the one best link (a smart link, else the
  website, else Spotify), since their captions are not clickable (bio, link sticker, pinned comment).
- **Texts**: the YouTube description gets "Listen:" (stores and smart links) and "Follow:" (social pages);
  the old "Listen on Spotify: … (add the link to the song)" line of existing templates becomes the real links.
  Caption templates can use {{bestLink}} {{links}} {{listen}} {{follow}} {{spotify}} {{apple}} {{website}}
  {{facebook}} … (a line whose link is empty disappears). Templates on disk are never changed.
- Tests: packages/video test/song-links.test.ts; browser: videos-post.e2e.ts (Assets → Post, pick kept).

### Review: one card per platform at the top ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 ("the top titles are confusing; the goal is to see, for a song, what has
  been built per platform"; the versions below stay as they are: dates, Approve, Post, …).
- The top of Review → Videos is now one card per platform (the song's own platforms first, then any made):
  "N versions · M approved · K to check", the latest date, and **Make another** (the former "Try another
  take"; not for the Canvas). A platform with nothing made yet says so, with **Make**. Clicking a card shows
  only that platform; clicking again (or "show all") shows every platform.
- Gone: the All / Reels / … filter chips, the "Try another take" row and the "Review & Post · N to review"
  line. Favourites only and Show discarded stay, small, on the right.

### Make: pickers instead of tick boxes, the Generate panel in clear groups, theme on every video ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 ("only make tick boxes when the choices are limited and clear"; "rearrange
  this screen, feels messy").
- **Pickers** (components/search-picker.tsx): the run's Theme ("Change…"), Compare themes ("+ Add a theme to
  compare", up to 3) and the collections of a picture version ("+ Collection") open a searchable
  list; themes as small cover tiles with mood filters, the song's own and the ones in use first. Chosen ones
  show as chips with ×.
- **Make is production** (the user: "all must be geared towards the platform choices, length, layouts"):
  1 What to make (platforms) · 2 Output, up front (videos per platform, length, part of the song, shot length,
  YouTube layout; all "automatic") · one line for the song (title · artist · clips · Look: theme; clips and
  look link to Shape, they are changed there; title, artist, EP and cover are no longer in Make) · **Try other
  looks** (folded: theme for this run, Compare themes, Pictures) · **Rarely needed** (folded: clips of the
  other orientation, time the lyrics again) · a footer that stays in view: "Keep these choices for this
  song", the number of videos and Generate. Plain words (no song.json, recipe, QA, textboard).
- **Colours from the Theme cover** (Themes → a theme, under Theme cover; and Edit theme → Colours): 3–5 colours
  from the cover and a suggestion (lyrics in a light colour that reads, the chorus and accent in the liveliest
  one); **Use these colours** sets them, nothing changes before (@lyric/video cover-palette.ts, tested; API
  /api/themes colours). In the editor a swatch click still sets just the accent; a theme without a cover uses
  the song's cover there.
- **Releases and the Library too**: "New release" and "New song" are the first tile of their grid (the buttons at
  the top right are gone).
- **Collections like Themes**: "New collection" is the first tile of the grid (the button at the top right is
  gone); the page says collections are added to a song in Shape → To make (no more "tick them in Generate").
- **Each video shows its theme** (palette icon and name) on its tile in Videos and in Post (manifest
  settings.theme; VideoInfo.theme).

### Clarity: feature icons, "Shared by N songs" badges, song or theme at a glance ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 ("allocate icons to each core feature so users get to know instantly").
- One map (apps/studio/src/lib/feature-icons.tsx): **Song** music note, white · **Theme** palette, pink ·
  **Clips** film, teal (a **Collection** a stack) · **Lyrics / card text** "T", amber · steps **Prepare** ✓,
  **Shape** ◇, **Make** clapperboard, **Review** eye, **Post** paper plane · **Automatic** wand.
- Used in the top menu (Library, Themes, Collections, Releases), the song page's rail and its tabs, the Shape
  menus, page titles (Library, Themes, Collections, Assets → Clips, This song → Card text) and the Library
  card's theme line.
- **Platform marks**: a small plain shape in each platform's colour before its name on the Library cards
  (Reels pink rounded square, TikTok cyan dot, Shorts red bar, YouTube red play triangle, Canvas green ring,
  Standard grey square), never the platforms' own logos.
- **Badges** on every theme (Themes tiles and detail, Shape → Theme): "Shared by N songs" (amber), "This song
  only" / "Only <song>" (pink), "Not used yet"; hover lists the songs (@lyric/video theme-reach.ts, tested).
- **Song or theme** (asked by the user on 1 Nov 2026, "we don't know whether we are working on the song or the
  theme"): the rail has the song's things on top and a separate **Look** group at the bottom with only
  **Theme**, in pink (reachable from every stage). The Theme panel opens on the choice: "This song uses: X"
  with its badge, Edit theme, New theme and "Change theme ↓" (the tiles). **Edit theme** puts a pink frame
  round the work area and a banner "Editing theme X · Changes here reach: …" with **Done** ("Save and done"
  when something changed; Cancel in the panel still drops the changes). Clicking Theme in the rail while an
  untouched editor is open goes back to the choice.
- **Plain names**: a theme made from a song's own look is called "<song> look" (About: "Made from <song>'s
  look on <date>"); older ones named exactly like their song are renamed once, the songs follow (themes.ts
  plainSongThemeNames, tested). A theme you named yourself is never touched.
- **Look · Content** line at the top of Shape: "Look: theme X [badge] · Content: this song (words, clips, card
  text)"; the theme name opens Theme. The theme's page says a theme is only the look, with links to its songs.

### Themes like Canva: text layouts, moods, livelier tiles ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 ("build all except the Crown").
- **Text layout** per theme (Edit theme → Text, three small frames): **Centred** (as before), **Lower third**
  (the lyrics low, the picture open above them), **Big hook** (chorus lines 30 % larger). It goes into the
  video itself (render, viewer, theme previews alike) and always stays inside each platform's safe zones:
  Lower third sits at 68 % of the usable area, so even three big lines and the next line clear the TikTok /
  Reels buttons (tested on every platform). YouTube's cover / stills layouts keep their own placement.
- **Moods**: tick Romantic, Night, Warm, Minimal, Bright or Moody on a theme's page (kept in theme.json); the
  mood chips at the top of Themes filter the gallery. No format filter: every theme fits every format.
- **Tiles**: bigger words, placed like the theme's layout; pointing at a tile plays a tight ~3 s loop of one
  line (the chorus line with Big hook), starting at once.
- Tests: text-layout.test.ts (safe zones on every platform, Big hook, the viewer patch, recipe check),
  readability-make.test.ts (the layout in the planned video), themes.test.ts (moods); browser: themes
  (mood tick + filter, hover loop), song-stages (Text layout saved in the theme).

### Bug fix: a new render starts unapproved ✅ (to verify on the Windows PC)
- Reported by the user on 1 Nov 2026: a newly made YouTube video already showed "Approved".
- Cause: marks (favourite / approved / discarded) are stored by the video's file path only, so a new render
  landing on a path that had a mark (resume, rerender, a re-used run folder) inherited it.
- Fix: a mark older than the video's manifest (created_at) is ignored (`markApplies` in node/exports.ts) by the
  Videos tab and when marking again; the video starts as "generated".
- Chips: a platform is green only when its latest run has an approved video (or, when that run kept none,
  an older run does); a fresh unreviewed render shows "to review" again. The number stays "approved in any run".
- Tests: library-status.test.ts (new run after an approved one, approve, all discarded), exports.test.ts
  (stale mark ignored, not carried over).

### Theme cover: each theme has its own picture ✅ (to verify on the Windows PC)
- Asked by the user on 1 Nov 2026 (themes looked like songs: their previews showed a song's clip or cover and
  that song's lyric lines).
- **Themes → a theme → Theme cover**: "Set theme cover…" (JPG, PNG or WebP), "Change…", "Remove". The
  picture is copied into the theme folder (themes\<name>\cover.jpg), so it travels with the theme; the one
  it replaces (or Remove) goes to the theme folder's _replaced\. Duplicate keeps it.
- **New theme** is the first tile of the Themes grid (a big +, like Canva's "Create blank"); the old "+ New theme"
  button at the top right was removed (asked by the user on 1 Nov 2026), the page intro now points at the tile.
- **A video as Theme cover** (like Canva): kept as cover-video.mp4 in the theme folder, its first frame becomes
  the still cover; it loops behind the words on hover and in the theme's big preview. A picture stays a picture.
- The Theme cover is set only in **Themes** (a short-lived Prepare → Assets row was taken out again the same
  day: Assets are the song's own files).
- Without a cover, theme previews show a neutral backdrop in the theme's own colours, never a song's picture.
- Every theme preview on the Themes page uses the same neutral words: "Your lyric line here / Your chorus
  here". (Inside a song, Shape → Theme still previews on that song's own clip and lines.)
- Tests: themes.test.ts (cover set / replace / duplicate / remove, no borrowed pictures, neutral words);
  browser: themes.e2e.ts (set, shown, Remove).

### Theme editor fixes: colour codes, save bar on top, a clear Box, no typewriter cursor ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026.
- **Text colour / Accent colour** (Edit theme → Colours): next to the picker, a box to type or paste the colour
  code: #FF2D95, FF2D95, #F29, rgb(255, 45, 149) or 255, 45, 149 (Enter or click away saves it; anything else
  says what to type). src/colour-ref.ts parseColourRef.
- **Renaming the default theme** ("Life Lyrics", the one new songs start on) now works: brand.json follows the
  new name, so it stays the default and no new "Life Lyrics" theme comes back.
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

### Themes, step 4: Make compares themes; the font and effect dropdowns are gone ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026 ("redesign the app around themes"). Make → More options no longer has the
  Verse effect / Hook effect dropdowns or "Compare font pairings": the look comes from the song's theme.
- **Theme** (for this run only): make the videos with another theme without changing the song's theme.
- **Compare themes**: tick 2 or 3 themes; one run per theme with the same section, clips and order (only the
  look differs), labelled "Compare themes: A, B". Not together with Picture versions.
- Every video records the theme it was made with (manifest settings.theme); the Videos tab shows a "Theme"
  row next to the song's theme now, with "Use these settings" bringing it back.
- Tests: run-settings / library / themes unit tests; browser: themes.e2e.ts (Compare themes queues one run per
  theme), style-lock, videos-post, pairings. themes.e2e.ts and song-title.e2e.ts are now part of pnpm test:e2e.

### Song title and Delete song ✅ (to verify on the Windows PC)
- Asked by the user on 31 Oct 2026. On a song's page, **click the title** (or the pencil) to change it: Enter
  saves, Escape cancels; the song folder is renamed to match (not while it renders).
- The ⋯ next to the title: **Delete song…** asks first, then moves the whole song folder (song, lyrics, clips,
  videos) to `songs\_removed\` and goes back to the Library. Nothing is deleted: **Deleted songs** at the bottom
  of the Library has **Restore** (the song comes back with its videos, marks and settings).
- Tests: song-delete.test.ts (rename and its folder, delete hides it from the Library and Themes, restore);
  browser: song-title.e2e.ts (title in place, folder follows, delete asks, Library without it, restore).

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

### Characters, C1 fixes after Paul's first test ("Bride No 1") ✅ (verified by Paul, 18 Nov 2026)
- The **back view** gets the chosen front view as an extra reference: the same outfit seen from behind (in the
  test, the front was a jumper and trousers and the back a knitted dress).
- **Make pack warns when the outfit is empty** ("the model will invent it… Add it above first?" → Make it anyway / Cancel).
- **Face views** ask for eyebrows exactly as in the reference (soft, individual hairs, not drawn or sharpened) and
  natural hair with no net / mesh pattern (the test's close-up had both problems).
- **Calibrating judges the views already made again** (every try, the best one chosen again), free, on a draft.
- Plain words: "Not made yet: Close-up face, 3/4 face, Full body, front, Full body, back"; no double brackets in
  the face-check line.
- Tests: characters-cards (9) and the Characters browser test (23 checks) pass. The other unit-test failures are the
  known ones below. Note: in the cloud check, librosa crashed until numba's stale cache files (*.nbi / *.nbc in the
  .venv) were cleared; this only affects the cloud machine.

### Characters, C1 fixes 2: face views are real close-ups, the latest Make wins ✅ (verified by Paul, 18 Nov 2026)
- Seen on the groom and Bride No 1 / No 2: the close-up and 3/4 came out as full-length shots from a high wide
  angle (the whole outfit, shoes included, went into the face prompts), and "Make the pack again" still showed the
  old pictures (the best try of all runs was kept; body views tied, so the oldest won).
- Face views get only the part of the outfit inside a head-and-shoulders frame, plus firm framing (eye level,
  portrait lens, no full-length, no high or wide angle).
- New check: a face view whose face is under 20% of the picture's height is red ("Not a close-up: …") and is made
  again automatically within the cap.
- The back view leaves out what is pinned on the front only (boutonnière, brooch, corsage).
- The latest Make or Remake wins: the best try of the newest run; older tries only if every new one is red. Cards
  made before this are picked again once, free, when their page opens (newest try), with the contact sheet rebuilt.
- Tests: characters-cards (12) and the Characters browser test pass.

### Characters, C1 fixes 3: eye-level framing, a real 3/4, the outfit split per view ✅ (verified by Paul, 18 Nov 2026)
- Paul's review of Bride No 2: close-up from above showing the whole body, 3/4 mostly from behind, the front view
  with the back's V-neck and buttons.
- All four views: camera at eye level, no high angle, no top-down view. Close-up straight on, face about half the
  frame; 3/4 turned about 45° toward the camera, both eyes visible.
- Checks (red, made again within the cap): close-up face < 35% of the picture's height, 3/4 < 30%; a face turned
  more than 70° ("Turned away").
- The outfit is split by the cheap text model (about $0.01, only when the outfit text changes) into "Close-ups
  show", "Front shows" and "Back shows", shown on the card and correctable. Each view gets only its part, and front
  and back are told what belongs only to the other side. Without a key or on failure: the outfit text as before.
- Tests: characters-cards (15) and the Characters browser test pass.

### Characters, C1 fixes 4: neutral wording, the reference's hair, old pictures framing-checked ✅ (verified by Paul, 18 Nov 2026)
- The groom came out with a feminine look and hair pulled back: the prompts still said "her" / "the same woman".
  Now "this person" everywhere (views, shared style, description draft).
- Face views keep the reference's hairstyle (length, parting, volume, direction) unless the outfit text says otherwise.
- Old pictures (made before the framing check) are measured from the file when a card opens (once), so a
  full-length "close-up" turns red instead of staying green.
- Tests: characters-cards (17) and the Characters browser test pass.

### Characters C2: Shot list import — planned slots in the story line ✅ (verified by Paul, 18 Nov 2026: "C2 works")
- **Prepare → Storyboard → Import shot list** (next to "Add clips & photos"): drop or choose your shot list (.json).
  The app checks it first, in plain words, slot by slot: an unknown character or scene ("did you mean Bride No 2?"),
  a wrong shot type, a lyric line that does not exist, a missing "shows" sentence, an id used twice → errors (Import
  stays off); a card not locked yet, an unknown field, two slots on one line → warnings. Then "N slots ready · 2 new ·
  1 changed · 1 taken out" and Import. Nothing is spent (no fal.ai calls). "Show an example shot list" in the dialog.
- **Fields per slot:** id, order (its place in the story line, 1 = first), shows (one sentence: what happens; C3 makes
  the picture from it), characters and scene (card names from the Characters page), shot (close-up / medium / wide /
  detail / motion), line (as numbered in the Lyrics tab), and optional outfit (for this slot only), tag and animate
  (else the default for the shot type: close-up → omnihuman, the others → kling; used in C5).
- **Slot cards in the story line** (dashed): the cards' pictures, "No picture yet", what it shows, shot type,
  characters, scene, the line's words, #tag; a card not locked yet is flagged; ⋯ shows the details. Drag like a clip.
- **Videos are unchanged:** Make and Shape skip slots until they have a picture (C3). A slot's line becomes a story
  anchor only then.
- **Re-import** updates slots by id, adds new ones and takes out the ones no longer in the file; your "order" places
  them again. The previous shot list is kept in Prepare → Assets → Replaced files, with a Restore.
- Terminal: `pnpm shotlist "<song>" <file.json>` (add `--check` to only check).
- Stored: `<song folder>\shotlist.json`; in clips.json "order" each slot is "slot:<id>". Code: src/node/shotlist.ts,
  story-line.ts; studio: components/shotlist-import.tsx, assets-tab.tsx, api/songs/[id]/shotlist.
- Tests: shotlist (8). Browser: shotlist (16 checks). Unchanged and passing: story-line, collections, storyboard-edit,
  clip-notes and collections browser tests.

### Characters: pack fixes (buttons, neckline, veil), New version keeps v1 in use, Remake the full-body views ✅ (to verify on the Windows PC)
- Seen on Bride No 2 v1 (locked; faces good: close-up 0.67, 3/4 0.58): the front full-body view had a row of buttons
  down the front bodice and a sweetheart-like neckline; the veil was missing in both full-body views and the 3/4.
- **Per-view rules from the outfit split:** a detail only in "Back shows" (buttons, bow, lacing, zipper, cut-out,
  keyhole, open back, V-back, train) becomes a negative on the front ("No buttons on the front."). The neckline in
  "Close-ups show" is required on the front ("Neckline: bateau neckline, exactly as in the close-ups; not sweetheart,
  V-neck, …"). A veil named in the outfit gets its own sentence in every view ("Sheer ivory tulle veil falling behind
  their shoulders, visible …", back: "… falling down their back, clearly visible."). The front view also gets the
  chosen close-up as an extra reference (neckline, shoulders, veil).
- Two contradictions removed: the front no longer lists the veil as a back-only detail, and the back is no longer
  told that "the gown (front text) is not visible from behind".
- **New version** on a locked card: a v2 draft with the same picture, outfit, outfit split, description and pictures.
  v1 stays read-only **and in use** (Storyboard slots, later recasts) until v2 is locked; the list shows
  "Locked v1 · v2 draft"; the version chips open v1 read-only.
- **"Remake the full-body views (front, then back)"** on a draft: only those two, the face views are kept.
- Tests: characters-cards (17) and characters-prompts (9, new) pass; the Characters browser test (32 checks) and the
  shot list browser test pass.

### Recast spike: the main character in place of the person in Storyboard clips ✅ (to run on the Windows PC)
- `spikes/recast/` (like spikes/lipsync; nothing in the app changes), `pnpm recast …`:
  - `check` reads fal's own description of each endpoint (fields, price) before anything is sent; every request is built
    from those fields (fal.ai was out of reach from the cloud session, so the IDs and fields are verified on the PC).
  - `"<song>" --list` shows the Storyboard cards with their numbers.
  - `--character "Bride No 2" --clips 7,9,10 --keyframe-clips 7 --max-cost 10`: the estimate per clip and method,
    then `--yes` sends it; 3 jobs at a time; request IDs saved as they come; `fetch "<run folder>"` gets a result that
    did not download (free).
- Methods: **A** Wan 2.2 Animate Replace (720p), **B** MiniMax H3 Max Recast (768P), **C** Keyframe + Seedance (first
  frame → depth map → Seedream 4.5 depth-guided first frame with the character in the same layout → Seedance reference
  video-to-video with the original clip as motion reference; 480p draft; card 7 only in the first run). **D** Runway
  Aleph and **E** Higgsfield Genjutsu are stubs (D: no key yet).
- Pictures sent: the card's close-up, 3/4 face and reference picture (latest locked version); never the full-body views.
- Each result is fitted back to the clip's exact size, fps and length; outputs go to
  `workspace\recast\<song>\<date-time>\` (never into the clips folder): comparison.mp4 (Original | A | B | C per clip),
  report.md / report.json (verdict in plain words, checks, cost, request IDs).
- Local judge (services/audio/app/recast_judge.py, MediaPipe + SFace, free): **face** (share of frames matching the
  character, weakest moment, the original person's face still visible), **scene kept** (people masked out; background
  SSIM + colour histogram → "Repainted scene"), **motion kept** (pose normalised to the body, optical-flow agreement).
  Thresholds are first guesses, every number is in report.json.
- Prices: fal's price list is read with your key; until then the estimate uses prices seen on other sites (marked
  "not confirmed"): Wan ~$0.08/s at 720p, H3 ~$0.30/s at 768P, Seedream $0.04, Seedance ~$0.12/s at 480p.
- Tests: recast spike (11, stand-ins for fal and the judge), recast judge (6, Python). Found and fixed while testing:
  the first motion measure called identical movement "not following" (0.14); it now compares flow fields over 0.1 s
  (identical 1.00, same movement in other colours 0.77).
- Fix (18 Nov 2026, Paul's first run): PowerShell hands an unquoted `--clips 7,9,10` over as "7 9 10" ("No clip
  \"7 9 10\""); card numbers now split on commas and spaces (file names still on commas only), `--methods` too.
- **First paid run (18 Nov 2026, cards 7, 9, 10): nothing usable.** Causes found in fal's current docs:
  - MiniMax H3 takes ONE photo per new person; the spike sent 3, so the original woman mostly stayed (0–82%).
  - Wan takes one picture and works in 9:16: it got only the close-up (invented clothes, a different-looking woman),
    and 26% was cropped back off.
  - Seedance refuses "likenesses of real people" (its safety rule): removed.
  - The Seedream "new first frame" came back almost unchanged (depth map as a 5th picture, long prompt).
  - Prices: H3 is ~$1.13–1.57 per 5 s clip, not $0.05; Seedance tokens were counted once. The first run cost about
    $5.50 against an estimate of $2.08.
- **Round 2 (18 Nov 2026):**
  - Methods:
    - A Wan: the clip padded to 9:16, the padding removed after; nothing lost.
    - B H3: one photo, enhance_realism, 1080P; clips under 5 s are skipped.
    - C Keyframe + Kling O1 edit: the clip scaled to ≥720 px; the character as an element, the keyframe as an image.
    - F Keyframe + Wan (new): the keyframe as Wan's picture, padded like the clip.
  - The keyframe: 3 pictures (frame, close-up, 3/4), a short "replace this person" prompt, Nano Banana Pro by default
    (`--keyframe-model`), made once when C and F both run.
  - A free face gate before any video is paid for: a keyframe that still looks like the original person (or shows no
    face) is tried once more, then its video step is not sent.
  - `--keyframe-only`: the keyframes alone, for a few cents each.
  - Prices from fal's docs per endpoint (formulas); an unknown unit stops the run before anything is uploaded.
  - report.md is saved with a BOM, so PowerShell shows it correctly.
  - Tests: recast spike (29). The gate's Python side was not run in the cloud (no face models there).
- Before the run (Paul, in the app): Bride No 2 v2 (New version → Remake front, then back → lock). The spike uses the
  latest locked version's close-up, 3/4 face and reference (v1 until v2 is locked).

### G1 Prepare → Production: cast from the shared library, story bible, Song brief for Claude ✅ (to verify on the PC)
- Paul's workflow (21 Nov 2026): build the song's assets in the app → generate the clips on WaveSpeed (or Higgsfield) →
  assemble in the app. G1 is the first part; G2 shot scripts per slot and G3 sending + takes in slots follow.
- **Prepare → Production** (a fifth Prepare tab after Storyboard), four sections; cast and bible are optional:
  1. **Cast:** character and scene cards picked from the ONE shared library (Characters page) with a searchable picker;
     linked by id (production\production.json), never copied: a newly locked version reaches every song.
  2. **Story bible:** this song's own, or the EP's (shared by the EP's songs; workspace\eps\<EP>\bible.md). An earlier
     text goes to Assets → Replaced files ("the story bible", Restore).
  3. **Ask Claude:** **Copy Song brief** (one click) or Save as file: lyrics with times and instrumental parts, length,
     tempo, picture sizes from the song's platforms, "no sound", the cast's locked descriptions and outfits, the bible,
     and the exact shot list format. **Paste Claude's answer:** a shot list (also inside a ```json block) → the C2
     check and import; other text → "Use as the story bible".
  4. **Shot list:** how many slots are in the Storyboard; Import shot list file; Open Storyboard. The shot list's
     characters missing from the cast: "Add to the cast".
- The Storyboard's story idea and story notes stay the user's own and are never read. Nothing is spent (no AI calls).
- Checked for G3 (21 Nov 2026): WaveSpeed and Higgsfield both offer Seedance 2.5 through their own API keys
  (Higgsfield now has a self-serve API).
- Tests: production (10). Browser: production (17 checks); shotlist and song-stages (now five Prepare tabs) pass.

### Shape says why a clip is not in the video ✅ (to verify on the PC)
- Paul (21 Nov 2026): "the storyboard still doesn't match the Shape … the boat doesn't appear". The Reel (101 s) runs
  out of time before the boat's turn (21st in the story order; the line-32 singing take holds the last 17 s).
- Shape → Shots, clip list: a clip that is not omitted but gets no shot now says why in amber: "Not in this video:
  this part of the song ends before its turn in the story order. Move it earlier in Storyboard, or put it on a line
  (Lyrics Sync → Show a clip)", or "…it is on line N, outside this video's part of the song".
- Correction: a clip in the Storyboard on no line does play as a shot in story order (I had said otherwise); Omit is
  the way to keep it out.
- Code: storyboard.ts notInReason, StoryboardClip.notIn (data-story-notin). Tests: vitest story-not-in (2). The Shape
  browser test cannot plan in the cloud container (the audio analysis crashes there, the same before this step).

### Film grain (Look) ✅ (to verify on the PC)
- Paul (22 Nov 2026), from Joey's finishing step: "overlay real film grain to unify AI textures". Shape → Settings →
  Look → **Film grain**: Off (default: videos as before) / Light / Medium; per song or in a theme.
- A fine noise tile drawn in the page (an SVG noise filter as a data URI: no file, no network), in soft-light over
  the clips, grade and vignette, under the words (the lyrics stay sharp); it moves to another place on every frame
  (picture.ts grainOffset, deterministic). The same layer in the preview, the Remotion render (Grain.tsx) and the
  HyperFrames composition (hf/compile.ts, moved per frame by the same function). Manifest settings.picture.grain.
- Tests: vitest picture (+2), hf-compile (+1), hf-network, look-preview, look-patch pass; browser song-stages pass.

### Film look: one camera, grain and grade for every clip of a song ✅ (to verify on the PC)
- Paul (22 Nov 2026), from Rourke's ShotDeck "global look" tip: "the global look is correct like the Theme". Clips feel
  like one film only when every generation shares the same camera, lens, grain and grade.
- **Film looks** in the top menu (next to Themes; called "Film look" because "Looks" are Wardrobe outfits): **New film
  look** (name first), drop a **still** (a ShotDeck screenshot with its data block, a Midjourney frame or a photo),
  **Write it from the still**: the app writes the look line ("35mm film grain, ARRI Alexa 35 look, warm tungsten …")
  and the **Midjourney words** (Copy), on Paul's GEMINI_API_KEY (less than a cent; FAL_KEY if there is no Gemini key).
  The words can be changed. Saving a look several songs use says "Update all N songs", with **Save as new** next to it;
  a rename takes the songs along; Delete only when no song uses it (to film-looks\_removed\, with Restore).
- A song picks its look in **Prepare → Creation** (the Film look dropdown at the top); the Library card shows it next
  to the theme.
- The line goes into **every Animate take** (after the app's own words, before the mood) and **every singing take**
  (after the singing cue and the script). Each take keeps the look it was sent with (take "filmLook" and "look"), so
  changing the look later remakes nothing and spends nothing. The picture still decides colour and light (Animate is
  image-to-video); the line keeps grain, depth of field and camera feel the same from clip to clip.
- Data: workspace\film-looks\<name>\look.json + still.<ext>; song.json "filmLook". Code: film-looks.ts (filmLookFor is
  the one place that picks a take's look, ready for Scenes), film-look-writer.ts; API /api/film-looks,
  /api/film-looks/still, /api/songs/<id>/film-look.
- Part 2 (the character sheet sent as a Seedance reference) waits until Scenes exist and a test clip proves it.
- Tests: vitest film-looks (10), animate, themes, library pass; browser film-looks (11 checks), pictures, singer,
  library pass.

### Song style: Cut to the song, Add singing, Mini film ✅ (to verify on the PC)
- Paul (22 Nov 2026): his three ways of making a song, named in the app. Step 1 of the Scenes plan (song-first
  "Mini film": Sections, Scenes in the Storyboard, Reel / YouTube view, scene brief for Claude, still then clip).
- Prepare → Song Details → **Song style**, three choices: **Cut to the song** (clips cut to the beat and the lyrics),
  **Add singing** (plus the singer on picked lines), **Mini film** (the song planned as scenes; Creation's story tools
  open). It only decides which tools show; change it any time, nothing is lost. song.json "songStyle"
  ("cut" | "singing" | "film"); not chosen yet: Add singing when the song has singing lines, else Cut to the song.
- Cut to the song hides Lyrics Sync's Who sings column and Singer bar (a line says why), except on a song that still
  has singing lines (they play in its videos, so they stay visible). Every Library card names the song's style.
- Code: song-style.ts (pure), node/song-style.ts, GET/PUT /api/songs/[id]/style, components/song-style.tsx
  (SongStyleField, SongStyleBadge, useSongStyle); recipe.ts songStyle; library.ts SongCard.songStyle.
- Tests: vitest song-style (2); browser song-style (7 checks); singer.e2e now sets Add singing; lyrics-tab, singer,
  production, library, song-links pass. Unchanged on main and still failing in the cloud: make, make-reference,
  render, migrate, song-stages, textboard-make (audio / render setup).

### Sections in Lyrics Sync (Mini film) ✅ (to verify on the PC)
- Step 2 of the Scenes plan (Paul, 22 Nov 2026). On a **Mini film** song, Lyrics Sync shows the song's sections:
  a **Sections** bar above the lines (Verse 1 · Chorus · Verse 2 · ... with start time and lines) and a row above
  each section's first line with its kind (dropdown: Intro, Verse, Pre-chorus, Chorus, Bridge, Outro) and ✕ (join it
  to the section before). **+** next to a line number starts a section there. Other song styles: nothing changes.
- Suggested by the app until changed: stanzas = blocks of lyrics.txt between blank lines; a stanza with a hook line
  ("* ") is a chorus (no hooks marked: a stanza whose words come back); a returning stanza that leads into a chorus is
  a pre-chorus; the first other stanza after the 2nd chorus with a chorus still to come is the bridge; after the last
  chorus, the outro; the rest verses. **Keep these** saves the suggestion; any change saves the whole list in
  song.json "sections" [{ line, kind }]; **Back to the suggestion** forgets it. lyrics.txt is never changed.
- Code: sections.ts (pure: suggestSections, cleanSections, nameSections, sectionOfLine), node/song-sections.ts,
  GET/PUT /api/songs/[id]/sections, components/sections-ui.tsx; recipe.ts "sections".
- Tests: vitest sections (3); browser sections (8 checks); lyrics-tab, singer, song-style pass.

### Storyboard shows only story moments ✅ (to verify on the PC)
- Paul (22 Nov 2026): "the storyboard is confusing, why has the app duplicated the singing part in so many pages".
  Singing takes and Creation takes picked in Lyrics Sync were listed as loose Storyboard cards and filled gaps.
- Rule: a Creation take stays in Creation until "Send to Storyboard" is pressed there. A singing take belongs to its
  Lyrics Sync line and plays only there. Neither is a Storyboard card.
- clips.json `lineOnly` (a take copied only for a line or a hidden-moment cover): Lyrics Sync's pick sends it with
  `forLine` (not in the order); a later Send from Creation makes it a story moment at the END of the order. A sent clip
  you removed counts as not sent (Send restores it from _removed, no duplicate). The planner never uses it as gap fill.
- Storyboard and Shape's clip strip list only story clips; one line says "Singing on lines 15-16, 25-27, 32: set in
  Lyrics Sync". Saving the order keeps the hidden clips' entries in clips.json.
- Code: node/clip-roles.ts, animate.ts sendToStoryboard, assets.ts (role, singing, importSongClips inOrder),
  story-line.ts, storyboard.ts, compose.ts anchorOnly, make.ts, lyrics-view.ts, pictures route, assets-tab, lyrics-tab.
- Shape's "not in this video" names the real reason when a singing clip plays to the end (e.g. "the singing on line 32
  plays from 2:12.9 to the end ... Lyrics Sync → line 32 → Hide a moment"), not "the part ends before its turn".
- Tests: vitest line-only (7), plus animate, clip-order, story-line, compose, shots, lyrics-view, song-files pass.

### Dissolves never freeze a frame; dissolves of about 1.5 s ✅ (to verify on the PC)
- Paul (22 Nov 2026): "a little pause at scene transitions (frozen frame)", Wedding Day Storyboard clip 2 (mirror, 0.9 s
  to the end of the file) into clip 3. Cause: a dissolve starts the incoming clip early (it fades in over the outgoing
  one). The app moved the clip's start back only if ALL the frames were there before its in point; else it started
  early from the same frame and so ran past its last frame: the last frame held up to 1.1 s. In Wedding Day's Reel
  13 of 19 shots ended on a held frame (0.2-1.1 s); Familiar Strangers 19 of 24. The out point was not the problem
  (5.2 s is the file's real end; the planner already clamps out points to the file).
- Now (src/handles.ts fitHandles, called by compose.ts for anchored and automatic dissolves): the app (1) slides a
  clip inside the part the user kept (their in / out: handles never show trimmed-off frames), (2) slows it a little,
  at most 10% (Paul's Canva trick; never a singing clip, a loop shot or a clip already held), (3) else shortens that
  dissolve, down to a hard cut. The cut stays on the beat and every shot keeps its length on screen. No clip plays
  past its last frame.
- Automatic dissolves are now about 1.5 s (Paul's length in Canva) in whole beats (compose.ts autoDissolveFrames: 3
  beats = 1.55 s at 116 BPM; was half a bar, 1.07 s). Dissolves into an anchored line keep one bar.
- Prepare → Storyboard: a small grey line on the clip card says what was changed, per video, e.g. "Reel, 0:53:
  slowed to 90%, starts 0.1 s earlier in the clip to fit the dissolve" or "dissolve into this clip shortened to 1.3 s
  (the clips have no more spare frames)" (ShotProps.fitNotes in the shot plan; node/transition-notes.ts).
- Preview and export draw the same saved shot plan. The plan fingerprint changed (make.ts keyBase v 2), so each saved
  plan is planned again once (the old one kept as .previous.json, the change named in Tasks).
- Supersedes the first fix pushed earlier the same day (2c2c863, src/blend.ts: no slow-down, half-bar dissolves, saved
  plans kept as they were); its line in Shape's clip list stays and now shows these notes.
- Tests: vitest handles (8: Wedding Day 1-2-3, trims, singing, photos, 116 BPM and 80 BPM songs end to end) and
  transition-notes (1), blend (2: composed 5.04 s clips used to the end; an out point past the file); anchors, compose, pace-transitions, storyboard, storyboard-file, timeline-edits pass. Checked
  against Paul's saved Reel plans: Wedding Day and Familiar Strangers go from 13 and 19 frozen ends to none.

### Fix: Studio build failed ("Failed to collect page data for /api/songs/[id]/assets") ✅ (to verify on the PC)
- Paul (22 Nov 2026): `pnpm --filter @lyric/studio build` failed after d81d436 (on Linux too, not only Windows).
- Cause: d81d436 made story-line.ts (used by the Assets tab's API route) import node/transition-notes.ts, which imported
  readStoryboard from node/storyboard-file.ts. That file imports manifest.ts, which loads Remotion. In a Next.js API
  route React has no createContext, so loading Remotion there makes the build stop ("Remotion requires
  React.createContext"). The route itself did nothing at import time.
- Fix: readStoryboard moved to node/storyboard-read.ts (only reads the JSON; storyboard-file.ts re-exports it, so other
  code is unchanged); transition-notes.ts imports it from there. No other API route reaches Remotion (all 55 traced;
  the pages that do only through their "use client" player components, as intended).
- `export const dynamic` / `runtime` were tried on the route and NOT added: with `cacheComponents: true` (next.config)
  Next 16 refuses both ("Route segment config ... is not compatible with nextConfig.cacheComponents"). The route is
  already dynamic (GET awaits connection(); POST/PUT/DELETE are never cached) and Node is the default runtime.
- song-folder.ts: the "whole project traced" warning is silenced (/*turbopackIgnore: true*/). 16 similar warnings
  remain in 9 other files (open-folder route, db workspace.ts, animate, captions, file-links, library, migrate,
  pairings): only warnings; the paths come from the workspace folder at run time, so they cannot be scoped.
- Next.js 16.4.3 -> 16.4.6 (security patch; next and eslint-config-next in apps/studio/package.json). Build passes.
- Tests: vitest no-remotion-in-routes (5: follows the runtime imports of story-line, transition-notes, assets and
  fails on any path to Remotion); transition-notes, story-line, storyboard-file pass. `pnpm --filter @lyric/studio build` passes.

### Soft fade into singing takes ✅ (to verify on the PC)
- Paul (22 Nov 2026): in Wedding Day's Reel the transitions into clips 4 and 16 felt "a bit hard", only at the
  start of the lip sync, not at its end. Both are singing takes ("sings lines 15-16", "sings lines 25-27"): the app
  always hard-cut INTO a singing take (rule from G3, to protect lip sync); every other transition dissolved.
- Now a singing take fades in (about 1.5 s, the automatic dissolve length) over its own lead-in: the frames the take
  has before its shot starts (a take is made from 0.5 s before the downbeat before its line). The take is never moved
  or slowed, so the lips stay in sync to the frame, and the whole fade lies before the cut: the singer is fully there
  when the cut comes. Less than 0.2 s of lead-in: still a hard cut, with the note "a hard cut into this singing take
  (the take starts right on the line)". Still a cut when the clip's own "comes in with: cut", the crisp style or an
  all-cuts variation says so. A take returning after a hidden moment does not fade (its lead-in is out of sync).
  Out of a singing take: unchanged.
- Code: src/handles.ts (HandleShot.fadeInBeforeCut, MIN_FADE_IN_FRAMES 6), compose.ts; plan fingerprint v 3 (make.ts):
  saved shot plans are planned again once (the old one kept as .previous.json).
- Tests: vitest handles (+4), anchors (lip sync exact on every frame of the fade, no frame past the clip's end, cut
  choices win, short lead-in); handles, anchors, compose, transition-notes, storyboard-file pass. Full suite: the same
  7 tests fail with and without this change (they need network / tools the cloud session lacks). Studio build passes.

### Same look on every platform (themes) ✅ (to verify on the PC)
- Paul (22 Nov 2026): the YouTube video looked different from the Reel. Cause: the theme Midnight Highway gave
  YouTube its own verse effect (cinematic-fade; typewriter:15 everywhere else), set through a hidden "Per platform..."
  menu; changing it back took four screens. Decided: themes look the same on every platform unless asked otherwise.
- Shape -> Look -> Edit theme: a switch **Same look on every platform** under the save bar. On (every theme without
  platform differences): the Per platform... options are hidden. A theme that differs shows it off with the
  difference in words ("Different on YouTube: verse effect cinematic-fade (typewriter:15 everywhere else)");
  switching on asks once ("YouTube: verse effect becomes typewriter:15" · Make them the same / Keep the differences);
  Save then makes every platform follow the theme. Switching off brings Per platform... back.
- Nothing is lost: a Save that takes platform values away keeps theme.json as it was in the theme's
  `_replaced\theme-<date>.json` (node/themes.ts keepThemeAsItWas). Themes page: a tile says "Differs on YouTube".
- Code: src/theme-platforms.ts (pure: platformDifferences, differenceLines, platformsThatDiffer), node/themes.ts
  saveTheme, node/style.ts (ThemeCard differsOn), shape-tools.tsx SamePlatformsSwitch, set-effect.tsx, themes-view.tsx.
- Tests: vitest theme-platforms (3), themes (+1: the backup, differsOn); browser same-platforms (14 checks, in
  test:e2e); song-stages (207) pass; themes.e2e passes except its out-of-date top-menu check. Studio build passes.
