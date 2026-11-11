# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

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

**Navigation and the order from here (agreed with the user, 9 Nov 2026).** Rule: every setting lives in the stage
where the user looks for it, in ONE place. Order: **N1** (navigation, done, to verify; N1 polish: the four stages behave the same way, done, to verify) → story notes on clip cards
(done, to verify) → **2e-1** (done, to verify) → **2e-2 → O1 → 2c → M1 gate → 2f → 2g → 2h → 2i**; the theme editor moves to the Themes page
with or after 2i (§3.2). Decisions on the N1 proposal:
- **O1 (song-level look overrides, §3.1):** a small song.json layer between the theme and the storyboard for a fixed
  list (line shape, lines appear, bigger final chorus to start), edited in Shape → Look; the theme editor keeps the
  defaults; "Customized for this song" = the song has overrides. O1 also PROPOSES how to clean up the existing
  "<song> look" theme copies (fold them back into their base theme + song overrides, or keep them): proposal first,
  nothing deleted without the user's OK. Until O1, "Save as new theme" stays as it is.
- **Swaps (§3.4):** from 2f a swap in Shape changes this video only and says "this video only; song order unchanged";
  Prepare → Clips owns the song's order (then also for the collections' clips, which only Shape's strip orders today).
  Until 2f a swap changes the song's order and says so.
- **Word fixes in Shape (§3.5):** say whether the lyric timing is now stale and offer "Time the lyrics again"; never
  re-time silently. Done in N1 for Shape and Prepare; left for 2c: Make still times changed words again before it
  renders (announced in Tasks), the 2c gate decides whether stale timing blocks Make instead.
- **Locked values (§3.7):** keep their value and show "Set by me" (done in N1); they become storyboard locks in 2f.
- §3.3 (Shape's video list offers every platform, Make chooses what is rendered), §3.6 (readability = when, the
  theme's backing = what it looks like), §3.8 (brand settings later, a small Brand page under Themes): as proposed.
- **Try other looks and storyboards (plan for 2e-1).** Today a try (another theme for one run, compare themes,
  picture versions) is planned by Make at render time, without a storyboard the user has seen. In 2e-1 each try gets
  its own storyboard, made from the video's storyboard with only the theme or the picture set changed (same lyric
  timing, range, locks): `storyboards\<platform>-<n>~<try>.json` (e.g. `reels-1~theme-night-drive.json`,
  `reels-1~pictures-2.json`). Make renders from it, the run's manifest keeps a copy, and Shape's video list shows it
  ("Reels v1 · try: Night Drive") to open, check and compare. A try never replaces the video's own storyboard:
  "Use this look" goes through the Look bar's Apply (theme) and the clips through Prepare. Picture versions change
  the clips, so their shots differ; a locked shot whose clip is not in the set is marked "needs a clip" (as today).

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
