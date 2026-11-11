# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

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
