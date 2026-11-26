# Progress

## Latest steps

_The most recent steps (keep about 5). Everything earlier, in full: docs/history.md._

### Characters tidy-up ✅ (to verify on the PC)
Small urgent step before LatentSync (26 Nov 2026, Paul: "I'm cleaning up all my characters and I'm blocked because
locked cards can't be edited").
- **Edit → new version**: on a locked card, next to its name, and on the Locked badge (click it). It starts a v2 draft
  copied from v1 (texts and pictures; the existing New version, now visible at the top). v1 stays locked and unchanged.
  While v2 is a draft, **every song keeps v1's pictures** (before, a song's shots and Make with references already took
  the draft's close-up). Locking v2 keeps every song that uses the card on v1 and asks: "v2 is locked. These songs use
  v1: … Switch them to v2?" **Switch to v2** / **Keep on v1**. Later, "Songs using <card>" on the card lists each song
  with its version and a "Use v2" button. Stored per song in production\production.json ("versions": card → version;
  node/card-versions.ts). A song uses a card when its Cast lists it or its shot list names it.
- **Rename** (built earlier today): click the name or its pencil; only the display name changes, a duplicate name is
  refused in plain words.
- **Outfit texts**: an outfit that names no clothes shows "Outfit describes a face, not clothes" (on the pack's outfit
  and on each Wardrobe look). **Tidy texts** (draft only, free, local: src\card-text.ts) moves the face, hair, skin,
  makeup and age words from the Outfit and its "Close-ups show / Front shows / Back shows" to Notes; only clothes stay.
  The outfit split now never describes the face (its prompt says so, and face words it keeps anyway are dropped); an
  outfit with no clothes is not split at all. A locked version is left as it was: Edit → new version, then Tidy texts.
  Copy character for Claude also warns about a look whose outfit describes a face.
- **Card thumbnail**: your own reference picture until a version is locked (a half-made pack never stands for the
  card), or a cover you choose ("Use as cover" under any made view; "Use this picture again" to go back); once locked,
  the locked close-up. The picture refreshes as soon as its file changes (remade pack).
- **View tiles**: each face view (close-up, 3/4, side profile, teeth) shows its face score on the tile ("face 0.62";
  "face –" when no face was measured). Long file names: shortened in the middle, whole on hover (earlier today).
- **One pack grid** (same day, Paul: "why is the teeth close-up so small and not next to its peers"): the side profile,
  teeth close-up and full body with face are now tiles in the pack grid, next to the four views, the same size, with
  their light, face score, file name, ✕, "Make …" / "Make it again" and "Use my own picture". Order: Close-up · 3/4 ·
  Side profile · Teeth close-up · Full body front · Full body back · Full body with face. A not-made extra is a dashed
  tile saying what it is for. Still made only when asked (also on a locked card); Lock still needs only the four.
- **Copy character for Claude** (earlier today): description first, then the wardrobe; warnings for empty Notes or
  outfits; only existing reference pictures, then one "Missing: …" line; the closing "Attach …" line.
- **Reel singing target**: the exact part the Reel plays, from its saved shot plan (storyboards\reels-1.json; else
  TikTok's, else Shorts'). Until a Reel's shot plan exists, the old estimate stays and the note says "exact once the
  Reel's shot plan is made".
- Tests: test\characters-tidy.test.ts (7); characters.e2e.ts (Locked badge, Edit → new version, outfit warning, Tidy
  texts, thumbnail of a card with a v2 draft).

### Nextgen sprint, step 2: Lip-sync readiness ✅ (to verify on the PC; thresholds to calibrate on your clips)
- Sprint order: 1 Cast Library ✅ → **2 Lip-sync readiness ✅** → next: **LatentSync spike**, then **Take history**, then
  **Consistency Score** (1b sheet generation stays planned).
- **Lip-sync check** (Prepare → Storyboard; local, free): "Check lip sync (all clips)" and "Check lip sync" on each video
  card. The face engine samples about 3 frames a second (face.py `lipsync`: face share of the frame, head turn, a hand
  over the mouth, the mouth region's light, face sharpness, face position); src\lipsync-check.ts judges them with every
  limit in LIPSYNC_LIMITS: ✅ Good / ⚠️ Risky / ❌ Not suitable, plain reasons with the time they start ("side profile
  from 2.1 s", "face too small (4 % of the frame height)") and the **best window** ("best 0.8–4.6 s"). Cached per clip
  by its SHA-256 (.studio\lipsync.json), checked again when the file changes. CPU, about 1-2 s a clip.
- **Singing slots + meter** (src\singing-slots.ts): from the Lyrics Sync sections (else the repetition / `*` hooks):
  chorus entries first, then peaks (long held lines); each slot starts on a sung line's start and ends on a sung line's
  end, about 8 s at most (a longer single line stays whole). Targets are **minimums**: 1/6 of a Reel (from just before
  the first chorus, about 90 s; TikTok / Shorts the same share), 1/3 of the whole song (YouTube, Mini film); never
  padded: "Singing: 9 s / 15 s · 2 slots need a clip". Each slot gets the best ✅ clip whose best window covers it,
  else a ⚠️ one, else the **best partial match** ("covers 4.2 of 6.1 s") with **Split after line N** (a sung-line
  boundary), else "needs a front or 3/4 medium close-up". **Accept** marks the clip in clips.json ("lipsync": slot,
  lines, times; display only), **Ignore** and **Split** go to .studio\singing.json; all read again after a reload.
  The Shape timeline shows the slots as bands on the song track (sky: suggested / accepted, amber: needs a clip).
- **Export performance excerpt** on an accepted slot: performance\<song> · <slot> · line N <first words>\ in the song
  folder (Windows-illegal characters stripped, parts shortened: paths stay well under 260): **vocal.wav** (the song's
  vocal stem as the singing clips use it, its offset applied; else the app's Demucs vocals from cache\stems; else none)
  and **mix.wav** (the song itself), both from 1 s before the first sung word to 1 s after the last, never processed (a
  WAV is copied sample for sample); **slot.txt** and **slot.json** (lyric lines, sung times, excerpt times and
  handles, duration, the clip, **which vocal source**, alignTo = the excerpt's start: a returned clip lines up with
  the song there). **Open folder** next to it.
- Nothing changes cutting, timing or rendering, nothing is generated: the plan cache key ignores the marks, and the
  video's props are identical with checks, an accepted slot and decisions (tested).
- **Calibration on your clips:** `pnpm lipsync:check "D:\path\to\clips"` (8-10 clips, --max 10; --frames prints every
  measured frame) prints the table (clip, verdict, head turn, face size, reasons, best window) and the current limits:
  paste it in the chat, the limits are set by eye before they are locked.
- Tests: lipsync-ready.test.ts (13: front ✅, profile ❌, turning ⚠️ with its window, tiny face ❌, cover / shadow / blur
  / movement; Reel slots on chorus lines and sung-line boundaries, 15 s target, split, shortfall, matching, partial
  match, accept / ignore), lipsync-song.test.ts (5: checks cached, slots, accept / ignore / split saved, the excerpt's
  files and lengths, the same props), lipsync e2e (the whole flow, the Shape bands). The real face engine was run in
  the cloud on test clips made from a sample portrait (a close-up ✅, a wide shot ❌ face too small, a fast pan ❌).
- After pulling: nothing to install (the face checks are already set up). Restart the app.

### Nextgen sprint, step 1: Cast Library ✅ (to verify on the PC)
- Sprint order (Paul, 26 Nov 2026): **1 Cast Library ✅ → 1b sheet generation (WaveSpeed) → 2 Lip-sync readiness →
  Take history → Consistency Score.** Decisions: no rename ("Characters" = the library, "Cast" = a song's list); face
  engine stays YuNet + SFace (commercial-friendly licences; InsightFace's models are non-commercial); SFace scores are
  calibrated on real takes in step 3 before they are relied on.
- The library is the existing **Characters** area (workspace\characters\<name>\card.json + pictures, every song). Remove
  card / Restore are the Card clean-up's (just below: characters\_removed\, the id kept in card.json). New here:
  - **Notes** on each card (look, outfit, vibe, age range: your words; kept on locked cards too).
  - **Copy character for Claude**: a clean character-lock block (name, notes, appearance, each look with its outfit,
    props, which reference pictures exist, locked or draft) on the clipboard. No API call.
    Reordered the same day (Paul): **Look** first (the Notes: face, hair, age range, vibe; then the card's own
    description), then the wardrobe; only the reference pictures that exist, then one "Missing: …" line; it ends
    "Attach the reference picture(s) listed above with this block." Empty Notes or a look without an outfit: copied all
    the same, with a warning on the page ("No description yet; add Notes for better prompts").
- **Rename** (same day, Paul): click a card's name (or its pencil), type, Enter (Esc cancels). Only the display name
  changes: id and folder stay, so cast chips, songs' Cast lists, face prints, pictures' "Who is this" and the Wardrobe
  choice keep working; **every song's shot list** (who is in each shot, its place, the look per person: stored by
  name) is updated with the new name, and the page says how many shots. Another card of the same kind with that name:
  refused, in plain words. The copy block and every screen use the new name at once (library.ts renameCard).
- **Long file names on the view tiles** (same day, Paul): an own picture's long name (e.g. Midjourney's
  "lifelyrics_cinematic_…_5813efa3_1.png") is shortened in the middle, keeping its start and end, so it no longer runs
  over the next tile's label and score; hover it to see the whole name. Same on the look tiles and the teeth row.
- **Reference check:** a character's reference picture with a second face at least a quarter the main one's size is
  now "Not suitable: More than one face …" (actions.ts strictFaces; reference pictures only, never clips or shots).
- **Face prints** (characters\face-prints.ts, face.json in the card folder): one SFace embedding (128 numbers) per face
  reference (reference picture, close-up, 3/4 face of the version in use) with the engine (YuNet 2023mar + SFace
  2021dec, version 1) and each picture's SHA-256: redone when a picture changes (after a check, a pack / remake, own
  pictures). New face-engine command "embed" (services\audio\app\face.py), tested on a real portrait in the cloud.
- **Cast chips on the Storyboard** (Prepare → Storyboard, the song's own clips): "+ cast" tags a character of the
  library; saved by **card id** in the song's clips.json ("cast": [ids]); a renamed character keeps its tags; a
  removed one shows greyed "(removed)" until restored (its id is read from characters\_removed\). **Display only**: the
  plan cache key ignores them, the video's props are identical with or without tags (tested).
- Tests: cast-library.test.ts (prints, rule, notes, block, tags across two songs, removed greyed and restored, same
  props), characters e2e (notes, copy), clip-notes e2e (3 tags, reload, removed greyed, restored, another song).
  Known: clip-notes e2e "the card shows no file name" is stale (the name field shows the file name until a short name
  is given), not from this step.
- Merged on top of 18 commits another session pushed meanwhile (Card clean-up's Remove card replaced this step's own).
- After pulling: nothing new to install (the face checks were set up with pnpm audio:setup --face). Restart the app.

### Card clean-up: ✕ on a picture, Replace picture, Remove card; own pictures for the extra views ✅ (to verify on the PC)
- Paul: "why can't I delete an old picture" / "I need a delete option". Nothing is ever deleted: each one is kept with
  a Restore (node/characters/cleanup.ts).
- ✕ on a pack picture (and Remove on an extra view): out of the card, kept in `v<n>\_aside\`; "Put aside (N)" under
  the pack with Restore (a picture now in that place is put aside in its turn). A locked version keeps its pack; its
  extra views can still change.
- Replace picture (draft): a new picture for the card, checked at once; the old one kept in `<card>\_replaced\<time>\`,
  "Earlier pictures" with Restore.
- Remove card (top right of a card): the folder moves to `characters\_removed\<name> <time>\` (or scenes); "Removed
  cards" on the Characters page with Restore (same id; refused while the name is taken).
- Side profile, full body with face and teeth close-up take "Use my own picture"; Add my pack takes up to 7 and puts
  "side profile", "full body with face", "teeth" pictures there by name (Paul's five Aiko views now go in one go).
  A picture with no place left gets a clear message, shown next to Add my pack (it was at the top, out of sight).
- Pack pictures are shown whole (full body no longer loses its feet in the 3:4 tile).
- Tests: characters-cleanup.test.ts (5), characters-own; characters e2e (+6 checks).

### Fix: pictures stay on their shot cards ✅ (to verify on the PC)
- Paul: "my pictures have stopped being saved at each card". From his song's files: (1) a picture dropped on a shot that
  was already in Creation (same bytes) was skipped as "already on the board" and never tied to the shot; (2) shots 4 and
  6-11 were filled, but their pictures had no "slot", so the cards looked empty.
- Now: a dropped picture already in Creation goes on that shot ("<name> was already in Creation: it is now on shot N";
  shot-production.ts placeDropped). A picture with no shot of its own sits on the shot its clip (or one of its takes)
  fills (animate.ts effectiveSlot; nothing written). ✕ on a shot stores slot "" so it stays loose.
- Tests: shot-production.test.ts "pictures and shots (25 Nov 2026)"; creation-production and pictures e2e.

### ♥ Favourites in Creation and Compare ✅ (to verify on the PC)
- Paul: "a little Favourite icon on top of any clip in the Creation so that when I'm comparing or reviewing I can easily
  spot my favs on/off". A ♡ on every picture (top right, beside ✕) and every finished take in Creation, and on every
  Compare tile; click = pink ♥, click again = off. Saved in pictures.json ("fav" on the picture or the take).
- "Favourites only (N)" switches: in Compare (just the favourites play side by side; Show all) and above the Creation
  shots (only pictures with a favourite, and only their favourite takes). Clean up never puts a favourite take aside.
- Code: animate.ts setFavourite, Take.fav / PictureRecord.fav / PictureView.fav; pictures route action "fav";
  pictures-board.tsx FavButton. Tests: animate.test.ts (favourites), creation-production e2e (Compare + Creation).

### Fix: a song opens where you left it, not on an empty Review ✅ (to verify on the PC)
- Before: any finished run opened the song on 4 Review, even when all its videos were discarded ("Something About You":
  Reels 0, "No video to show with these filters"), and Review remembered one platform for every song.
- Now: without ?tab= in the link, the song opens on the tab last used for THAT song (cookie ls-tab-<song id>, read on the
  server, so no flash). A first visit opens Review only when the song has a kept video; otherwise the Prepare to-do, else
  Make. Review opens on a platform that has videos (remembered per song); a platform you click still shows, even empty.
- Code: apps/studio/src/lib/opening-tab.ts (chooseOpeningTab, chooseReviewPlatform); test packages/video/test/opening-tab.test.ts;
  e2e song-stages (opens again on Make) and videos-post updated.

### Breathing room in singing clips; Copy the Gemini prompt; tags on every Compare tile ✅ (to verify on the PC)
- Breathing room (realism plan): the voice SENT to the lip-sync model is quiet outside the take's own sung lines (lead-in,
  gaps of 0.5 s or more between its lines, the tail), with 120 ms fades; the song and the video's sound are never touched.
  The singing prompt adds "Between sung lines the mouth closes and the singer takes a natural breath". Each new take
  records its rests (Take.rests); older takes are sent as before. singer.ts singingRests / restGain / cutVoice.
- Copy the Gemini prompt (Characters: next to Add my pack, and on each Wardrobe look): the app's own words per view
  (outdoors in soft daylight, natural skin, neck-cropped body views), numbered, for the packs Paul makes in Gemini.
- Compare: a video dropped on the shot that is a copy of a take (the draft test's "BridetestUpscale draft upscaled
  pro.mp4" …) shows that take's tag; any other video or picture says "Your video · <source>" / "Picture · <source>".
- Tests: test/breathing.test.ts; creation-production, singer, characters e2e.

### Readable take tags in Compare and Creation ✅ (to verify on the PC)
- Paul (25 Nov 2026): "how do I distinguish which take and run was it?" … "add timestamp".
- Every take gets one short tag, written by the app (take-facts.ts takeTag): its name (Paul's own name or the draft
  test's label first), what made it, its feeling, its cost and when: "Take 3 · Draft 480p · joy · $0.54 · 25 Nov, 11:06",
  "Take 4 · final of 3 · 1080p · $0.20 · …", "Take 5 · Jennifer's face · $1.62 · …", "singing, lines 9-11 · 480p".
- Compare shows it in full under each video (data-compare-tag), the picture's name smaller below; Creation's take row
  shows what made it (data-take-source) above its facts. Hover: service and model, facts, Film look, Feel, pictures sent.
- Tests: test/take-tag.test.ts; creation-production, pictures and singer e2e.

### Character sheet: side profile, full body with face, one picture of the views ✅ (to verify on the PC)
- Paul (25 Nov 2026, from the tutorial's worksheet: "several shots in one character picture"; "characters only").
- Characters → a character card gets two more extra views next to the teeth close-up, each one picture made from the
  card on its model (Gemini on Paul's key), outdoors in soft daylight like every view, also on a locked card:
  **Side profile** (a true side view) and **Full body with face** (head to toe, not cropped at the neck). Their face
  check only informs ("judge by eye"); they are never made again for it.
- **Character sheet**: the card's views side by side in one clean picture (close-up, side profile, 3/4, full body;
  the neck-cropped front until the full body with face is made), made on the PC with FFmpeg (free), v<n>\character_sheet.png,
  with **Save** (for Midjourney or Higgsfield). The contact sheet with scores stays as it was.
- Make with references: the face sheet now includes the side profile when it is made.
- Tests: characters-cards.test.ts (views, check, sheet), characters.e2e.ts (make both, the sheet, Save).
- Creation: **Who is this** on each picture (Who: nobody / one of the characters with a close-up). With a character,
  Animate sends the picture AND that character's face sheet (close-up, side profile, 3/4, teeth) to Seedance 2.5
  reference-to-video: "@Image 1 is the picture to bring to life … @Image 2 is Jennifer's face reference sheet … never
  change the clothes", then the usual prompt (realism rules, Feeling, Film look, mood). The model line shows "Seedance 2.5 ·
  with Jennifer's face" and the cost uses its price (about $1.62 for 5 s; no Draft for this route yet). Nobody: as before.
  picture-character.ts; pictures.json "who" (the card id); test/picture-character.test.ts.

### Feeling per section (realism plan step 3) ✅ (to verify on the PC)
- Lyrics Sync (Mini film songs): each section row gets **Feeling**: none, tender, longing, hope, joy, pride, defiance,
  grief, calm, or your own word. Saved with the sections in song.json; the chips show it.
- Prepare → Creation: each picture gets the same **Feeling** choice above its mood words (Paul, 25 Nov 2026: "what about
  my workflow"): loose Midjourney pictures get a feeling too. On a shot it shows its section's until you choose another.
- The app turns the word into small true-to-life face changes (eyes, brows, breath, chin), sent after the realism rules
  with every Animate take (the picture's own feeling, else its shot's section) and singing clip (its lines' section). A
  singing run that crosses into a section with another feeling turns halfway ("starts longing, then turns to hope").
- Each take records `feeling` / `feelingTo` and shows it in its facts ("5 s · longing → hope · about $0.54"); a later
  change remakes nothing; "none" sends exactly what was sent before.
- Tests: packages/video/test/feelings.test.ts (10), sections.e2e.ts and pictures.e2e.ts (feeling checks).
- Next (when Paul says): step 4, Scenes with automatic continuity references.

### Draft takes and Make final ✅ (to verify on the PC)
- Paul's draft test (25 Nov 2026, BridetestUpscale.png): the draft upscaled with Video Upscaler Pro was "very close" to a
  full-quality take, and sharper in the face and lace, at $0.74 instead of $1.62 for 5 s. Paul picked it.
- Creation's model list gets "WaveSpeed · Draft (cheap preview)": Seedance 2.5 Flash at 480p, $0.108 a second (about
  $0.54 for 5 s), with the same prompt as every take (realism rules, Film look, mood). Paul's saved default is unchanged.
- A finished Draft take shows **Make final · about $0.20**: the take's own file goes to Video Upscaler Pro at 1080p
  ($0.04 a second, at least 3 s). WaveSpeed's Seedance has no seed, so a re-run would move differently; the upscale
  keeps exactly the take Paul chose. The final is its own take ("Take N final", finalOf = the draft's number; the draft
  gets final = its number). The draft stays. One final per draft; a failed one can be made again; an interrupted one
  has Get result (free).
- Code: src/node/final.ts (new; startFinal, runFinal, finalUsd), animate.ts (Quality "draft", Model.resolution,
  waveSpeedTransport resolution, Take.finalOf / final), /api/songs/<id>/pictures action "final" (resume → runFinal),
  pictures-board.tsx (Make final button, data-take-final). In the stand-in mode the draft itself stands in for the final.
- Tests: vitest final (4: draft price and 480p, final filed once per draft, refused upscale, price). Studio build passes.

### Draft test: is an upscaled cheap draft good enough? ✅ (Paul to run on the PC, about $2.40)
- Paul (25 Nov 2026) approved spending about $3 to decide how "Draft, then Make final" should work. WaveSpeed's
  Seedance pages (read 25 Nov) have no seed, so a full-quality re-run never matches a draft: Make final can only be an
  upscale of the draft. Video Upscaler costs $0.005/s at 1080p, Video Upscaler Pro $0.04/s.
- `pnpm draft-test "<song>" "<picture>" [--yes]` (scripts/draft-test.ts, src/node/draft-test.ts): without --yes it only
  lists the four takes and their cost. With --yes, one picture becomes four takes in Creation, each with the normal
  Animate prompt (realism rules, Film look, mood): "Draft" (Seedance 2.5 Flash 480p, 5 s, $0.54), "Draft upscaled"
  (Video Upscaler 1080p, $0.03), "Draft upscaled Pro" (Video Upscaler Pro 1080p, $0.20), "Full quality" (Seedance 2.5
  720p, $1.62). Each request is sent once; a refused draft sends no upscale.
- Tests: vitest draft-test (3, a stand-in WaveSpeed, no network).
- Next: Paul compares the four; then build Draft, then Make final with the winning upscaler.

### Realism rules in every clip request; Feel on the Film look ✅ (to verify on the PC)
- Paul (25 Nov 2026) chose step 1 of the realism plan (doc "AI realism workflow vs Lyric Studio", from two AI-realism
  tutorials): the app, not Paul, adds what makes a clip look filmed instead of generated.
- Every Animate take now also asks for real skin texture, natural light, subtle believable expressions (eyes, brow,
  breath) and a camera with real weight, and avoids exaggerated or cartoonish expressions, plastic or CGI skin,
  morphing faces or hands, extra people appearing, fast or shaky camera moves and sudden zooms. Every singing take gets
  the same look rules plus "no text, captions, subtitles, logos" (frame stays clean for the lyrics), but never
  "subtle expressions": the singing cue keeps its big singing mouths.
- Film looks page: a **Feel** choice per look, Natural (true to life, default) or Dreamy (soft, poetic, true to the
  picture's own style, for Midjourney art). A song without a Film look uses Natural. Each take keeps the feel it was
  sent with; takes made before this change keep their old prompt.
- Code: src/node/realism.ts (new), film-looks.ts (feel, feelFor), animate.ts (motionPrompt, Take.feel), singer.ts
  (singingPrompt), studio film-looks-view.tsx + /api/film-looks. Cost: none (words only).
- Tests: vitest film-looks (+1, takes test checks feel kept as sent), animate pass. render / textboard-make fail the same
  way without this change (they need the audio service and network the cloud session lacks). Studio build passes.
- Next: Draft, then Make final (step 2), after a two-take test on Wedding Day (about $3) that Paul approves first.

### Reference sheets per person, and the teeth close-up ✅ (to verify on the PC)
- Paul (25 Nov 2026), after comparing two character-consistency tutorials and their comments ("headless outfit + face
  beats complex character sheets", "the model invents what a reference does not show", "the teeth rule"):
- **Make with references now sends two sheets per person**, made from the card's own views (never from words), each
  one picture (workspace\cache\refsheets): a **face sheet** (the look's close-up, the card's 3/4 face, and the teeth
  close-up when there is one) and an **outfit sheet** (the look's front and back, cropped at the neck: no second,
  smaller face). The prompt names each panel ("@Image 1 is Jennifer's face reference sheet (left to right: close-up,
  3/4, smiling, teeth visible) … @Image 2 is Jennifer's outfit reference sheet ("Wedding Dress") (left to right: front,
  back), cropped at the neck: wear exactly this …"). Three people or more in one shot: the notice says the likeness may
  be weaker and that a framing with one or two clear faces keeps them best.
- **Teeth close-up** (Characters → a character card): "Make the teeth close-up": the card's close-up with a gentle smile,
  lips slightly parted, the upper teeth visible; an extra view (plan.ts EXTRA_VIEWS), made only when asked, **also on a
  locked card** (v<n>\closeup_teeth.png next to the locked views, which do not change; the face check judges it like
  the close-up). It joins the face sheet automatically.
- Code: shot-references.ts (sheets, prompt), characters/plan.ts (EXTRA_VIEWS, ALL_VIEWS), generate.ts and jobs.ts
  (extras on a locked version), characters-view.tsx. Tests: shot-production.test.ts (the sheets' panels and size),
  characters-cards.test.ts (teeth on a locked card), characters e2e, creation-production e2e.
- On the PC: Characters → Jennifer → Make the teeth close-up (one picture, a few cents); then shot 5 → Make with
  references 9:16, camera guide None, 1 take: compare with the earlier takes (face and dress).

### Shot list → "Save as script (.md)" ✅ (to verify on the PC)
- Paul (24 Nov 2026), for Higgsfield's Short Drama ("Upload your script: PDF, DOCX, FDX, TXT or MD"): Story room → 4 Shot
  list → **Save as script (.md)** writes the shot list as a readable script, never the app's JSON: the cast (each person's
  description and every look they wear in this film, with its outfit; also people a shot names who are not in the
  cast), the places, the story bible, then every shot by section with its time on the song, framing, place, what
  happens, people (and looks) and lyric. Read-only. node/shot-script.ts; production route action "script";
  shot-production.test.ts.

### Make with references: the character sheets go to the video platform ✅ (to verify on the PC, needs WAVESPEED_API_KEY)
- Paul (24 Nov 2026): "I need to provide to the video platform my character sheets in order to create the video with
  constant characters. Currently I can't do that in Midjourney" (Midjourney's Omni Reference is one picture, images only).
- Creation → Production: every shot with people or a place has **Make with references** (a Mini film: "9:16" and
  "16:9"). It sends the shot to **Seedance 2.5 reference-to-video on WaveSpeed** with the pictures of the people in the
  look they wear in this shot (wardrobe close-up, else front view, else the card's picture) and the scene card, named in
  the prompt "@Image 1 is Jennifer, wearing their "Wedding Dress" look. … Keep each person's face, hair and outfit exactly
  as in their picture." followed by the shot's own prompt (without Midjourney's --parameters). Length: the shot's time on
  the song (4-30 s); takes and cap: Creation's defaults; a confirm shows the estimate.
- The takes come back on the shot like every take (Tasks menu, Get result, Compare, Use for shot N), on the shot's
  **reference item** "s05 references 9x16.png" (the pictures sent, side by side); each take records its pictures
  (refFiles, refNames), prompt and shape. Request (WaveSpeed v3): { prompt, reference_images, aspect_ratio, resolution
  720p, duration, generate_audio: false } at bytedance/seedance-2.5/reference-to-video, as public integrations call it
  (WaveSpeed's own pages cannot be read from the cloud). Price: the 720p Seedance 2.5 price ($0.324/s) as the estimate.
- Code: node/shot-references.ts, animate.ts (REFERENCE_MODEL, Transport.submitRefs, runTakes), pictures route action
  "references", pictures-board.tsx. Also fixed: a take whose picture could not be put online stayed "running".
- Tests: shot-production.test.ts (refs, prompt, cap, a stand-in run end to end), animate.test.ts (the exact request),
  creation-production e2e (the button, the reference item on the shot).
- First real run (Paul, 24 Nov 2026, shot 5): the face was Jennifer's, but "the dress is not the same anymore". Fixed the
  same day: each person now goes as **two pictures**, the look's close-up (face, hair, makeup) and its full-length front
  view (body_front: "complete outfit, head to toe: wear exactly this … never change or invent clothing").
- **Camera guide** (same day; Paul: "MJ as a reference video will certainly help Seedance quality"): each shot has a
  "Camera guide" choice (its videos and finished takes, the first one by default, or None); it goes as @Video 1
  (reference_videos; over 15 s: its first 15 s): "Follow the camera movement, framing, lighting and atmosphere of
  @Video 1, but the people and their clothes must look exactly like their pictures". The take records it (guideFile).
- Second real run (Paul, shot 5): with the Midjourney take as camera guide, Seedance copied Midjourney's woman, not
  Jennifer. Fixed: the guide is sent **blurred** (boxblur 24 at 720p, "<name> (camera guide v1).mp4" in pictures\takes):
  camera movement, framing, light and colour survive, no face does; the prompt says it shows no one to copy.
- The reference item ("pictures sent") has no Use / Animate of its own and is not a Compare candidate; its takes are.
- **Place per shot** (same day; Paul: "we have scene cards already simply not used yet"): Production shows "Place" on
  every shot (the cast's scene cards, or None) and "all of <section>" to give the whole section that place. The scene
  card's picture then goes with the shot: the prompt's place, the Omni Reference, Make with references ("@Image N is
  the place …"). A re-import that names no place keeps the one chosen (shotlist.ts setShotScene; route "shot-scene").
- On the PC (first real run): one shot, 1 take (Creation → Defaults), check the face against the card. If WaveSpeed
  refuses the request, send me its message: the route's exact fields could not be read from WaveSpeed's own docs here.

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

### Fix: theme names cut off on the Themes page ✅ (to verify on the PC)
- Paul (22 Nov 2026): tiles showed "Midnight Hi...", "Mou...", "Paper ..." because the badge ("Shared by 2 songs",
  "Only Tea with the monk test") shared the name's line and never shrank.
- Now the full name is shown (up to 2 lines, the full name on hover), the badge on its own line below it; a badge
  wider than the tile ends in "..." (full text on hover). Tiles and grid unchanged. Code: themes-view.tsx ThemeTile,
  theme-reach-badge.tsx (also used in Shape -> Theme: looks the same for normal badges).
- Checked in a browser at 1850 and 1280 px. Studio build passes. Known: apps/studio/e2e/themes.e2e.ts "the top menu"
  check is out of date (expects Library · Themes · Collections · Releases; the menu also has Film looks and Characters).

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
- **Two stale browser tests (found 22 Nov 2026, not caused by the latest steps):** themes.e2e expects the top menu
  "Library · Themes · Collections · Releases" (Characters was added since); style-lock.e2e looks for
  [data-edit='titleOpening-default'], a row the Look panel no longer shows. Update both tests in a bug-fix pass.
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
- ✅ (built 21 Nov, to verify) **G3 Singing lines:** tick lines in Lyrics Sync, WaveSpeed InfiniteTalk lip sync per
  line, each clip placed on its line and always in time with the song.
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
