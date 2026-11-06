# HyperFrames spike (Theme Engine v2, step 1)

Can [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0, HTML + GSAP rendered to video) be
Videomaker's lyric animation renderer? This folder answers that **without touching the app**: nothing in
`apps/` or `packages/` changes, and the signed-off lyric sync is only read.

## What it does

`spike.ts` takes one song folder and:

1. Runs **our normal pipeline** as a dry run of the same planner Generate uses: the stored alignment
   (vocal stem, hand-set starts, vocal-start check) and the beat cuts. If the song was never aligned for its
   current lyrics.txt, it aligns once with our own lyric timing (needs `pnpm audio:setup --ai`).
2. Picks the **first chorus** (one bar before the first hook line, ~30 s, never ending inside a sung line).
3. Writes **timing.json**: the planner's word times for that section (our output; nothing hand-written).
4. Fills the **theme template** (`template/theme.html`, HTML + GSAP, style "Glow reveal": each word rises in
   from a soft blur and lands, fully visible with its glow at the peak, exactly on its sung start; then the glow
   settles) twice from that one file: **1920x1080 (16:9)** and **1080x1920 (9:16)**.
5. HyperFrames renders each as a **transparent WebM** (VP9 with alpha): the lyric layer only.
6. FFmpeg builds the beat-cut clips from the plan's shot list, cuts the song to the section (AAC 320 kbps, a
   fade only where the music is cut, nothing else), and lays the lyric layer on top: **clips + lyrics + song**.
7. For comparison, **our current renderer** (Remotion) renders the same 9:16 plan (skip with `--no-compare`).
8. A **sync check** on the rendered pixels: the frame where each word lands vs its sung start, plus a check
   in the template's own timeline that no word is visible before its reveal.
9. Logs the time of every step per format and writes `report.md` into
   `spikes\hyperframes\out\<song>\<time>\` next to the videos.

HyperFrames' usage telemetry is **always off** in this script (`HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`).

## Setup on Windows (once)

1. **Node.js 22 or newer** (HyperFrames needs it; the app itself runs on 20.9+ and is happy on 22).
   Check with `node -v`. If it says v20 or lower, install the **Node.js 22 LTS** Windows installer (.msi)
   from https://nodejs.org (it upgrades your current Node in place), or in PowerShell:
   `winget install OpenJS.NodeJS.LTS`. Close and reopen Cursor's terminal, then check again with `node -v`.
2. After a Node upgrade, rebuild the app's packages (the database module is compiled per Node version):
   ```powershell
   cd D:\videomaker
   pnpm -v
   pnpm install
   ```
   If `pnpm -v` says it is not found after the upgrade, tell Claude before installing anything.
3. **FFmpeg**: already installed for the app (nothing to do).
4. **Chrome for rendering**: nothing to install. On its first render HyperFrames downloads its own headless
   Chrome (~150 MB) into `%USERPROFILE%\.cache\hyperframes`.
5. Optional, to keep HyperFrames' telemetry off outside this script too:
   `cd D:\videomaker\spikes\hyperframes` then `npx hyperframes telemetry disable`.

The script installs its own packages (HyperFrames 0.9.19, GSAP, puppeteer-core) into
`spikes\hyperframes\node_modules` the first time it runs.

## Run it

```powershell
cd D:\videomaker
git pull
pnpm exec tsx spikes\hyperframes\spike.ts "workspace\songs\Life Lyrics\Here with Me"
```

Options: `--seconds 30` (section length), `--format mov` (ProRes 4444 instead of WebM), `--no-compare`
(skip our current renderer). It takes a few minutes; the last lines print the report and the folder.

## Files

- `template/theme.html`: the theme (HTML + GSAP). Placeholders `{{...}}` are filled per format by spike.ts.
- `spike.ts`: the whole run (above).
- `make-fixture.ts`: cloud only: makes a stand-in song with our pipeline (the real songs are on the PC).
- `out/` and `fixture-workspace/`: results, not in git.

## Results so far (cloud, synthetic song, 4-core Xeon, no GPU)

First chorus, 31.1 s, 12 shots, 44 words.

| Step | 16:9 | 9:16 |
| --- | --- | --- |
| HyperFrames: lyric layer (transparent WebM) | 83.6 s | 84.8 s |
| FFmpeg: beat-cut clips | 31.9 s | 9.8 s |
| FFmpeg: song section | 3.8 s | 3.8 s |
| FFmpeg: lyrics over clips + song | 20.3 s | 22.0 s |
| Total | 139.6 s | 120.4 s |
| Our current renderer (Remotion), the same 9:16 plan in one pass | | 132.9 s |

Sync: every measurable word (43 of 44: one was sung before the section starts) lands on exactly its own
frame in both formats (mean and worst 0 ms); none is visible before its reveal.
Transparent format: WebM 3.3 MB vs ProRes 4444 161 MB for the same 31 s, the same render time: WebM chosen.
`hyperframes check`: no errors.
