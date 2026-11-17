# Lip Sync spike (step 1): three fal.ai models side by side

Which cloud model makes a Midjourney clip **sing** best? This folder answers that **without touching the app**.
Nothing in `apps/` or `packages/` changes. The spike only reads the workspace: it opens the database **read-only**,
so the app can stay open. It never writes into the song folder, and it only reads the song and the vocal stem.

## Run it

First time only, install the official fal client for this folder:

```
cd D:\videomaker\spikes\lipsync
npm install
cd D:\videomaker
```

Put your fal key in `D:\videomaker\.env` (`.env` is in `.gitignore` and the key is never printed or saved anywhere):

```
FAL_KEY=your-key-from-fal.ai
```

Then:

```
pnpm lipsync "Wedding Day" --list
pnpm lipsync "Wedding Day" --clip "D:\clips\bride.mp4" --lines chorus:2
pnpm lipsync "Wedding Day" --clip "D:\clips\bride.mp4" --lines chorus:2 --yes
```

- `--list` shows the song's lines with the Lyrics tab's numbers and times, and marks the chorus lines with ♪.
- Without `--yes` you get the estimate only. Nothing is uploaded.
- With `--yes` it uploads, runs the three models at the same time, and writes the results.

| Option | Meaning |
|---|---|
| `--lines 12,13` | Lines by number (Lyrics tab). **Each line is its own job and its own folder.** |
| `--lines chorus:2` | The first 2 lines marked as chorus. |
| `--from 61.2 --to 66.8` | Any part of the song, in seconds. |
| `--pad 0.2` | Seconds added before and after each line (default 0.2). |
| `--providers sync,kling,infinitetalk` | Which models (default all three). |
| `--max-cost 3` | Safety cap in dollars (default 3). Above it nothing is uploaded, even with `--yes`. |
| `--clip-start 2.5` | Where in the clip to start (default 0). |
| `--prompt "…"` | InfiniteTalk's text prompt (it requires one; a neutral "keep the scene, sing" prompt is the default). |
| `--timeout-min 20` | Per try. A model that fails or times out is tried once more. |

## What it does

1. **Times.** Takes the line's start and end from the song's lyric timing in the database, including the song's
   lyric offset, and adds the padding.
2. **Audio.** Cuts that part from the **vocal stem** into `audio_slice.wav`; this is what the models hear. The stem
   is the file in the Vocals slot, under your own file name. It also cuts the full song into `mix_slice.wav`,
   for listening only.
3. **Clip.** Trims the clip to exactly that length, keeping its own resolution and frame rate. A clip shorter than
   the line stops that line with a message (no looping in step 1). Kling only takes 720–1920 px per side, so a
   clip outside that is sent to Kling as a resized copy (`clip_for_kling.mp4`) and the report says so.
4. **Cost first.** Shows the estimated cost per model and the total, then stops at the cap or without `--yes`.
5. **Run.** Uploads to fal storage, then submits to each model, polls fal's queue and downloads the result.
   Each model gets one retry. Every fal request ID is kept in `report.json`.
6. **Results.** For each model it writes `<model>.mp4` (as the model returned it) and `<model>_review.mp4` (the same
   picture with the full song). `comparison.mp4` shows the original and every result side by side, labelled, with
   the full song.
7. **Checks.** Each result gets a verdict in plain words:
   - **Problem:** the length is off from the audio by more than 0.1 s, the shape (aspect ratio) differs, or the
     file does not play.
   - **Information only:** a lower resolution ("Model output 480p, clip was 1080p") or another frame rate.

Results go to `spikes\lipsync\out\<song>\<clip>_line<N>\`, which git ignores. A folder with a finished run is
never overwritten: the next run goes into `… (2)`.

## The models (checked on fal.ai, 17 Nov 2026)

| Name | Endpoint | Price as fal lists it | Limits |
|---|---|---|---|
| Sync lipsync 2 | `fal-ai/sync-lipsync/v2` (model `lipsync-2`, `sync_mode: cut_off`) | $3 per minute of video | – |
| Kling LipSync | `fal-ai/kling-video/lipsync/audio-to-video` | $0.014 per video second, rounded up to 5 s | video 2–10 s, 720–1920 px per side; audio ≤ 5 MB |
| InfiniteTalk | `fal-ai/infinitalk/video-to-video` (480p) | $0.30 per second, ×1.25 above 81 frames | 41–241 frames at 25 fps (≤ 9.64 s); prompt required |

**About the cost columns in the report:**
- fal does not return the charge for each request. "By fal's price" applies fal's own rule to what was sent.
- The real charge is on fal.ai → Dashboard → Usage.
- InfiniteTalk outputs 480p at 25 fps, so its report shows a resolution and frame-rate note. That note is
  information, not a problem.

## Tests

```
pnpm lipsync:test
```

The tests cover the line times, padding and the song's lyric offset; `chorus:N`; the clip-too-short stop; the
prices and model limits; the inputs against fal's schemas; the retry with both request IDs; and the checks
(information vs problem).

They also run the whole pipeline on a made-up song with a stand-in fal client, served locally. No network and no
key are used. That run covers the cap, the dry run, one folder per line, which audio goes where, the side-by-side
video and the reports.
