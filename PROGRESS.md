# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

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

### Characters, C1 fixes 4: neutral wording, the reference's hair, old pictures framing-checked ✅ (verified by Paul, 18 Nov 2026)
- The groom came out with a feminine look and hair pulled back: the prompts still said "her" / "the same woman".
  Now "this person" everywhere (views, shared style, description draft).
- Face views keep the reference's hairstyle (length, parting, volume, direction) unless the outfit text says otherwise.
- Old pictures (made before the framing check) are measured from the file when a card opens (once), so a
  full-length "close-up" turns red instead of staying green.
- Tests: characters-cards (17) and the Characters browser test pass.

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
- Characters, outfit split: hairstyle always to "Close-ups show" (and "Back shows" when visible from behind), earrings only to "Close-ups show" (seen on Bride No 1, 18 Nov 2026; Paul corrects by hand for now).
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
- **`next build` stops after compiling** with a "SecurityFatalError". The studio's Next.js version (16.4.3) has a
  known vulnerability, so the build stops to recommend an upgrade. The build files are complete, so the studio runs.
  Upgrading Next.js is its own step, to agree with Paul (found 18 Nov 2026, during C1).
- **Already there before C1** (to fix in a bug-fix pass):
  - `tsc` in apps/studio reports `Cannot find name 'LayoutProps'` (layout.tsx).
  - `pnpm --filter @lyric/studio lint` reports 7 errors in files C1 did not touch.
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

**Song creation workflow (Paul, 21 Nov 2026):** pictures, then clips, then play with the order (his real flow: no
preset storyboard, discovery against the music).
- ✅ (built 21 Nov, to verify) **G1 Story tools** (optional, folded away in Prepare → Pictures): cast from the shared
  library, story bible (song or EP), Song brief for Claude, paste the answer back.
- ✅ (built 21 Nov, to verify) **G2 Pictures + Animate:** picture board, WaveSpeed / Higgsfield image-to-video with
  his own key, cost first and a cap, 3 takes by default. G2b (21 Nov): renamed **Creation**, takes stay there and
  favourites are sent to the Storyboard; pictures and videos from anywhere (by hand, a link); your own defaults.
- ~~Shot scripts per slot~~ dropped by Paul on 21 Nov 2026 (not his way of working).
- Possible next (not agreed): the character's locked picture as a reference so faces stay the same; a quick
  "try it against the song" preview of the newest takes.

**Order from here (changed by Paul, 18 Nov 2026, after C2 worked):** his real workflow builds the storyboard from
Midjourney clips, so replacing the person in each clip with his main character comes first:
0. **Pack fixes + New version** (done 18 Nov 2026, above; to verify on the PC): make Bride No 2 v2, remake only the
   full-body views, lock v2.
1. **Recast spike** (BUILT 18 Nov 2026, above; to run on the PC once v2 is locked. Plan approved 18 Nov 2026; spikes/recast/, like spikes/lipsync: cost first, --max-cost (first run
   10), --yes, parallel jobs, report.md, comparison video, request IDs): song + locked character + clips (one, several
   or all Storyboard clips). References: close-up, 3/4 face and the reference picture only; v1's full-body views are
   NOT sent (wrong buttons, no veil), v2's once locked. Methods (endpoint IDs and schemas checked in current docs):
   (1) Wan 2.2 Animate Replace (fal), (2) MiniMax recast (fal), (3) Keyframe + Seedance: first frame → depth map → new
   first frame with the character (image edit, depth-guided) → Seedance 2.5 reference video-to-video, 480p draft,
   clip 7 only in the first run, (4) Runway Aleph 2.0 (skipped until Paul has a key); adapter ready for Higgsfield
   Genjutsu. Length, fps and aspect kept; originals never replaced. Judged per result: environment kept (background
   similarity outside the person, "repainted the scene" flag), face (raw SFace scores), motion kept, technical.
   Test: Wedding Day Storyboard cards 7 (close-up, looking up), 9 (medium, among flowers), 10 (wide, white dress on
   the road) as Bride No 2; the clip list is printed with card positions for Paul to confirm.
2. **Recast in the app** (a button on Storyboard clips).
3. **C4 face check.**
4. **Lip Sync step 2.**
5. **C3** (generate stills for slots).
Then Instagram Growth. C1 (done, verified 18 Nov) and C2 (done, verified 18 Nov) are finished. The Theme v2 order below
(2e-2 → O1 → 2c → …) waits until then.

**Characters roadmap (C1–C4: approved 17 Nov 2026 with the face models YuNet + SFace + MediaPipe (local, CPU, in the Python service), a Characters page in the header next to Collections (characters, scene cards, EP story bibles), a picker in Prepare → Storyboard to assign them to slots; the C1 spike is built, the rest is not).** Vision: Paul drops
ONE picture of a character; the app builds a locked character pack, turns an imported shot list into planned Storyboard
slots, generates consistent stills for every slot, checks them against the character's face and regenerates misses.
Paul only picks. Rendering stays local with zero network calls: generation is a separate, priced, opt-in step, and
its results are saved as ordinary photos in the song folder. Order:
- **C1 spike first** (BUILT 17 Nov 2026, to run on the PC; `spikes/characters/`, like spikes/lipsync): Paul's East Asian bride image → the C1.0 reference
  check → a 4-view pack (front portrait, 3/4, profile, full body on grey) from several fal image-edit models side by
  side → the face check of every view against the original, plus a contact sheet. It settles the look, the default
  model and the face stack before any app work.
- **C1.0 Reference check** (automatic on upload, local, free; the same face stack as C4). It measures:
  - exactly one face, with its confidence, and its size in px (target ≥ 512 tall);
  - blur on the face area and head pose (yaw / pitch);
  - which landmarks are visible (eyes / nose / mouth; a hidden mouth is flagged for lip sync);
  - expression (mouth / eye openness) and lighting (exposure, left / right balance on the face);
  - body visibility (pose keypoints).

  Verdict: Ready / Usable with fix / Not suitable, with reasons in plain words. One-click fixes: upscale, crop to the
  face, or add a second reference image of the same character. An AI vision opinion (paid) is off by default and
  shows its cost first.
- **C1 Character from one picture** (BUILT 18 Nov 2026, to verify; the groom's card and EP story bibles still to come):
  a Characters screen. The upload is the identity AND style reference for a pack
  made with a fal image-edit model. The app drafts a fixed description that Paul can edit. Each generated view is
  checked against the original and drifted views are regenerated automatically before approval. Approve → Lock
  (read-only, versioned). Stored in workspace\characters\<name>\ and the database; scope song / EP / artist.
- **Scene cards (with C1, same flow):** a pack for a location. From one picture, 3–4 angles of the same place,
  the same checks in spirit (sharpness, size, the place still recognisable), Approve → Lock. A planned slot names
  a character card AND a scene card; both packs go as references on every generation (C3).
- **Story bible (series scope):** the cast (character cards) and the places (scene cards) of an EP, with the songs
  as its episodes, so the cards carry across the songs. A song uses its EP's bible, plus cards of its own.
- **C2 Shot list import:** a JSON shot list (schema: slot id, order, characters, scene card, outfit, shot type,
  anchor lyric line, tag, animate with) becomes planned slots in Prepare → Storyboard. The story notes stay separate and are never read
  as instructions. ("Shot list" is Paul's input; the app's planned video stays the "shot plan".)
- **C3 Auto-generate stills:** 2–4 variants per slot, with the pack images as references; prompt = the fixed
  description + outfit + scene + shot type + style. A cost estimate and a --max-cost style cap come before any call.
  Same adapter pattern as spikes/lipsync, with a provider switch: Nano Banana, Seedream, GPT Image. Endpoints
  verified on fal's docs; FAL_KEY from .env only. The picked still becomes a photo of the slot.
- **C4 Consistency check:** a local face-embedding model scores each variant against the pack (green / amber /
  red, with a verdict in plain words). Red slots are regenerated automatically, at most 2 more times.
- **Model routing:** each slot has an "animate with" field. Its default comes from the shot type (emotion
  close-up / motion / wide → a model per kind); Paul can change it on the slot. It is used by C5.
- **Upscale pass before export:** Paul's Midjourney clips are 544×720. A pass makes upscaled copies of the clips
  and stills, cached and never replacing the originals, before Make uses them. Provider switch fal or local
  (RTX 5060), one setting per song, cost shown first for fal. It sits before rendering, so the render paths and
  the zero-network render rule do not change.
- **Recast: put a locked character into an existing clip** (designed 18 Nov 2026; nothing built; first as a spike
  `spikes/recast/`, later part of C5).
  - **What it does:** an existing clip (Midjourney, or a trend reference) keeps its motion, camera and timing; the
    person in it becomes the locked character. This is not C3 (stills) or C5 (animating a still).
  - **One adapter, two layers,** like `LipSyncProvider`:
    - `RecastProvider` describes a model: id, name, mode ("swap": replace the person, keep the scene; or "motion":
      the character performs the clip's motion), limits (min/max seconds, the part of the clip used, resolutions,
      fps), `estimateCost(seconds, resolution)`, and `input(job)`.
    - A `Transport` carries the requests: upload, submit, poll, download, cancel, request ID. The **fal**
      transport already exists. A **Higgsfield** transport (its own REST API and key) is added once.
    - Adding Genjutsu Light is then one transport plus one config entry. The pipeline, checks and report don't
      change.
  - **Job:** the clip (trimmed to the part used), the character's references from the locked pack (the close-up
    first, then the 3/4 face and the body views), the resolution, and an optional scene card.
  - **Providers to start with:**
    - **Baseline on fal:** Wan 2.2 Animate Replace (`fal-ai/wan/v2.2-14b/animate/replace`, inputs `video_url` +
      `image_url`, billed per frame at 16 frames per video second; also `/animate/move` for the "motion" mode).
    - **Higgsfield Genjutsu Light, as seen 18 Nov 2026 (to verify when built; open.higgsfield.ai is not reachable
      from the cloud session):** `higgsfield/genjutsu-light/object-swap/v1.0` ("swap") and
      `higgsfield/genjutsu-light/motion-transfer/v1.0` ("motion"). Inputs: a video URL, image URLs and a
      resolution. Listed price $0.0739/s at 480p, $0.1471/s at 720p, $0.2936/s at 1080p. It uses the first 15 s of
      the source and keeps the source audio, which is never used: a video's audio is always the song.
    - Check Higgsfield's API terms for commercial use of the outputs before it becomes a default.
  - **Hand benchmark first** (Paul may try Genjutsu Lite in Higgsfield's app before any API work).
    - `--import "<file made by hand>" --as genjutsu-lite [--cost 0.75]` runs a hand-made result through the same
      checks, the same comparison video and the same report as the API providers. Hand tests and API runs are
      therefore compared the same way.
  - **Checks, in plain words:**
    - The face is sampled across the clip (about 2 frames per second) and scored against the pack's close-up: the
      median and the lowest score, and a dip mid-clip means the identity flickers.
    - The length matches the source (±0.1 s); aspect and fps match, or differences are reported as information;
      the file plays.
  - **Rules:** a cost estimate and `--max-cost` before any call; keys from .env only (the Higgsfield key names are
    checked when built); nothing is sent without `--yes`.
  - **Reference rule (decided 18 Nov 2026):** motion references must be Paul's own (his Midjourney clips, footage
    he films himself), licensed, or public domain. Never a movie scene, another artist's music video or anyone
    else's footage, even when a tool accepts it: Higgsfield's own terms (s.4.2) make infringement the user's
    responsibility. Each reference keeps its source link and a mark: "made by me", "licensed" or "public domain".
    A trend's structure (hook, pacing, the move) is recreated, never its footage.
  - **Match-cut sequence (decided 18 Nov 2026):** one motion reference × several scene cards or outfits → one Recast
    clip each, with the same motion in another place or weather (stage, rain, snow, sun). Make assembles them as a
    match cut on the beat: the subject stays anchored while the world changes behind them. The per-scene prompts
    come from the scene cards (C2 fields), never typed by hand. It builds on the scene cards, the C2 slots and the
    cut planner (part of C5 / Recast).
- **Cast for Wedding Day:** a second character card is needed, the **groom** (same C1 flow: one picture → pack).
- **Animation prompt default (prompt builder, C5):** light breeze, hair and fabric movement, unless the slot says
  otherwise.
- List only, later: C5 pick & animate (export for Midjourney video; optional fal image-to-video), C6 a lip-sync
  button using the locked face portrait (builds on Lip Sync step 2: a whole-face model, InfiniteTalk or what the
  OmniHuman 1.5 / Kling Avatar evaluation picks), and a Midjourney prompt builder as a fallback.

**Lip Sync roadmap (agreed 17 Nov 2026; separate from the Theme v2 order below, which continues unaffected).**
Step 1 (the spike, three fal.ai models compared) is done, to verify. Next, each its own step, when the user decides:
- **Step 2:** a "Lip sync" button on Prepare → Storyboard clip cards. Singing defaults to InfiniteTalk (whole face),
  with Sync only as the automatic fallback; a provider switch stays as an override. The result becomes a variant of
  the clip on its card, or replaces it. **`--join`:** consecutive lines become one sung phrase of up to about 10 s
  (one clip, one request), with the prompt "single continuous shot, no cuts".
- **Evaluate for still-image characters** (one picture + the song → a singing shot, no clip needed). Endpoints seen
  on fal.ai, 17 Nov 2026; to verify when the step starts:
  - OmniHuman 1.5: `fal-ai/bytedance/omnihuman/v1.5`, $0.16/s.
  - Kling Avatar v2: `fal-ai/kling-video/ai-avatar/v2/standard` $0.0562/s and `/pro` $0.115/s.
  - For comparison, InfiniteTalk image-to-video: `fal-ai/infinitalk`, $0.20/s.
- **Step 3 (optional):** a local, free provider (MuseTalk or LatentSync) on the RTX 5060 8 GB, behind the same
  `LipSyncProvider` interface.

**Instagram Growth module (recorded 18 Nov 2026; nothing built).** It extends the planned Reverse Engineer (Theme v2)
and the planned Trend Scout.
- **Priority:** after Characters C1–C4 and Lip Sync step 2.
- **The current order stays:** Windows import fix → C1 spike → Paul's review.

The module's parts:
1. **Trend Scout, outlier rule.** Only propose Reels with **500K+ views**, from any genre (travel, weddings,
   K-drama, cinematic edits), not just music. Output: the link, the views, and why it is an outlier (hook, pacing,
   structure).
2. **Reverse Engineer, own outliers first.**
   - Import Paul's own top Reel, "Hujan in Jakarta" (about 1M views, against his usual 13K–90K).
   - Turn its pattern into a reusable template: the first-2-seconds hook, the story beats, the clip / lyric
     matches, the caption and the length.
   - Templates store **structure only**, never copyrighted characters or footage, and keep the source link for
     credit.
3. **Trial variants.** One click on a finished Reel gives 2–3 variants for Instagram Trial Reels.
   - What changes: the first clip / hook, the title or caption wording, a subtle zoom, a mirrored frame, or the
     length (90 s vs 60 s).
   - Clearly named files, same export preset.
4. **Export pack per Reel.** The 9:16 1080×1920 video, the chosen cover frame, the caption text, and an
   "AI-generated" reminder for the platform's label.
5. **Results tracking.**
   - Per Reel and per variant: views, shares, saves and profile visits, plus the song's Spotify streams and saves
     in the following 7 days.
   - **Shares + saves are the main score**, not likes or views.
   - Start with manual entry or a CSV import.
   - Verify what the Instagram Graph API allows (insights, publishing, Trial Reels) before designing any
     automation. (The Out of scope list in CLAUDE.md excludes social posting and analytics, so any API use needs
     Paul's explicit OK at that step.)
6. **Pattern report.** What the winning Reels have in common (hook type, length, first clip, caption style). It
   feeds back into the Theme rules and the templates.

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
