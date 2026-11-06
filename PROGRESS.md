# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Theme Engine v2 on HyperFrames, step 1: renderer seam, (b) checked, zero network ✅ (to verify on the Windows PC)
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
calls when rendering; LGPL FFmpeg with NVENC timed; now) → 2a (picture for Reels) →
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
