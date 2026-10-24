# Lyric Studio

A personal, local studio for making 9:16 beat-synced lyric videos for **Life Lyrics**.
Everything runs on your own PC. See `CLAUDE.md` for the full brief and `PROGRESS.md` for status.

## What is in this repo

| Folder | What it is | Address |
| --- | --- | --- |
| `apps/studio` | The web app (Next.js): Home, Studio, Library | http://localhost:3000 |
| `apps/worker` | Background render worker (Node) | (no web page; prints `worker ready`) |
| `services/audio` | Audio analysis service (Python FastAPI + librosa): BPM, beats, downbeats | http://127.0.0.1:8001/health |
| `packages/video` | The Remotion video composition `LyricVideo` | |
| `packages/db` | Database (SQLite + Drizzle) and the workspace file service | `workspace/studio.db` |
| `workspace/` | Your songs, clips, thumbnails, renders and database (not saved to git) | |

## One-time setup on Windows

You need these installed once (normal Windows installers):

| Tool | Version | Check in Cursor's terminal |
| --- | --- | --- |
| Git | any recent | `git --version` |
| Node.js | 22 or 24 (LTS) — https://nodejs.org | `node --version` |
| pnpm | 10, 11 or 12 | `pnpm --version` |
| Python | **3.12** (other versions may also be installed) | `py -0` must list `-V:3.12` |
| FFmpeg | any recent (needed from the render steps on) | `ffmpeg -version` |

Notes:
- **Python 3.12 is required.** The audio service always uses `py -3.12`, never the default `python`,
  so it is fine if Python 3.14 (or another version) is your default. If `py -0` does not show
  `-V:3.12`, install Python 3.12 from https://www.python.org/downloads/windows/.
- **pnpm**: if `pnpm --version` does not work, open PowerShell **as Administrator** once and run
  `corepack enable` (Corepack ships with Node.js), then reopen Cursor.

## Get the code (first time)

```powershell
cd D:\
git clone https://github.com/laipaul/videomaker.git
cd D:\videomaker
pnpm install
pnpm audio:setup
```

`pnpm audio:setup` creates a private Python 3.12 environment in `services\audio\.venv`
(using `py -3.12`) and installs librosa and friends from ready-made packages (about 300 MB, no compiler).
It reinstalls automatically when the package list changes, also from `pnpm dev`, `pnpm analyze` and `pnpm test`. Nothing is installed globally. If an old `.venv` was made with another
Python version, it is removed and rebuilt automatically.

## Get the latest changes

```powershell
cd D:\videomaker
git pull
pnpm install
pnpm audio:setup
```

## Run it

```powershell
pnpm dev
```

This first prepares the database (`[db] ready: ...`), then starts all three parts in one terminal. Each line is tagged `[studio]`, `[worker]` or `[audio]`.
You should see:

- `[worker] worker ready`
- `[studio] ... Ready`  → open http://localhost:3000
- `[audio] Uvicorn running on http://127.0.0.1:8001`  → open http://127.0.0.1:8001/health
  and you should see `{"status":"ok","service":"audio"}`

Stop everything with **Ctrl+C**.

## Audio analysis

```powershell
pnpm analyze "D:\Music\my song.mp3"
pnpm analyze "D:\Music\my song.mp3" --bpm 140
pnpm analyze "D:\Music\my song.mp3" --json
pnpm analyze "D:\Music\my song.mp3" --click
pnpm analyze "D:\Music\my song.mp3" --downbeat-offset 1
```

Prints the BPM, the half/double alternatives, the duration, the downbeat confidence and the first
16 beats with the downbeats (start of each bar) marked. `pnpm dev` does not need to be running.

- **Half / double tempo**: songs are often detected at half or double speed (70 instead of 140).
  If the beats feel too slow or too fast, run it again with `--bpm` set to the half or double value
  shown. Any other BPM you give re-tracks the beats around that tempo (and is fine-tuned by at most 3%).
- **Downbeat confidence** (0–1): how clearly one beat of the bar stands out in the bass/kick.
  0.4 or more = high, 0.15–0.4 = medium, below 0.15 = low (the bar start is a guess; this is
  common when the kick is equally strong on beats 1 and 3). The method assumes 4/4.
- **Cache**: results are saved in `workspace\cache\analysis\` by the file's content, so the same
  song is analysed only once (even if renamed). Delete that folder to force a fresh analysis.
- **Check the beat grid by ear**: `--click` writes `<song>_click.wav` next to the song: the song
  with a low click on every beat and a louder, higher click on every bar start (downbeat).
- **Bar 1 in the wrong place?** `--downbeat-offset 1`, `2` or `3` makes bar 1 start that many beats
  later. If the file is a project's song, the offset is saved to that project and used from then on.
- WAV, MP3 and FLAC work.

The service also offers `POST http://127.0.0.1:8001/analyze` with
`{"path": "<path inside the workspace>", "project_id": "<optional>", "bpm": <optional>}`.
With `project_id` it stores the BPM and duration on the project and replaces its beats.

## Cut points

```powershell
pnpm cuts "D:\Music\my song.mp3" --section 0:11-0:59
pnpm cuts "D:\Music\my song.mp3" --section 0:11-0:59 --rate 2x --energy high --early 2 --downbeat-offset 1
```

Prints where the video would cut inside that part of the song: the time and video frame of each
cut, the beat number, the bar and beat in the bar (`7.1` = bar 7, beat 1), and each shot's length.

| Option | Values | Meaning |
| --- | --- | --- |
| `--rate` | `0.5x`, `1x` (default), `2x` | cut every 2 bars / every bar / every half bar |
| `--energy` | `low`, `medium` (default), `high` | low = half as many cuts, high = twice as many |
| `--early` | `0`–`4` (default `2`) | cut this many frames (1/30 s) before the beat; slightly early feels on time |
| `--downbeat-offset` | `0`–`3` | move bar 1 (as for `pnpm analyze`) |

No shot is shorter than 0.8 s: if the cuts would be too fast, the whole section switches to the next
slower even rhythm (every beat → every 2 beats → every bar) and the command says so.

## Lyric timing (`pnpm tap`)

Write the lyrics in a text file, one lyric line per line. A blank line means a pause (the previous
line disappears there, e.g. for an instrumental part). Then:

```powershell
cd D:\videomaker
pnpm tap "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --section 0:11-0:59
```

The section plays. Press **Enter** exactly when each line starts (the next line is always shown).
After the last line, press **Enter** once more where it ends. **Backspace** redoes the last stamp,
**r** restarts the section, **q** quits without saving. Each stamp is printed as you go, and at the
end `lyrics.lrc` is written next to `lyrics.txt` (the previous one is kept as `lyrics.lrc.bak`).
Stamps are moved 0.15 s earlier by default to make up for reaction time (`--shift 0` turns
that off, `--shift -0.25` moves them more).

A line starting with `* ` in `lyrics.txt` is a **hook** (it can get its own font). Every line with
the same words is then a hook too, so marking one chorus is enough.

### Fixing timing and hooks in an existing .lrc

```powershell
cd D:\videomaker
pnpm lrc:shift workspace\test\lyrics.lrc -0.3
pnpm lrc:hook workspace\test\lyrics.lrc "Hope is a good thing"
```

- `lrc:shift` moves every stamp (negative = earlier) and keeps the old file as `lyrics.lrc.bak`.
- `lrc:hook` marks that line and all its repeats as hook (`[00:14.00]* Hope is a good thing`).
  Matching ignores upper/lower case, punctuation and extra spaces. You can also type the `* `
  yourself in the .lrc, right after the time stamp.

Before playing, every line is checked for phone screens. A line that would need 3 lines on screen
prints e.g. `WARNING: Line 3 is too long for phone screens (Bold style); split it in lyrics.txt`.

## Automatic lyric timing (`pnpm align`)

Instead of tapping, the computer can place the lyrics itself: Demucs separates the vocals, then
WhisperX lines up every word of your `lyrics.txt` with the voice.

**One-time install** of the AI packages (large: PyTorch with CUDA is about 3 GB):

```powershell
cd D:\videomaker
pnpm audio:setup --ai
```

On Windows this installs the CUDA 12.8 build of PyTorch, which runs on NVIDIA RTX 50-series GPUs
(and also on the CPU). `pnpm audio:setup --ai --torch cpu` installs the smaller CPU-only build.
The AI models (Demucs ~80 MB, English alignment ~360 MB, French alignment ~1.2 GB) download on
first use into `services\audio\models\` with a progress bar.

```powershell
cd D:\videomaker
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt"
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --lang fr
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --compare "D:\videomaker\workspace\test\Lyrics.lrc"
```

- It first prints the device: `GPU: NVIDIA GeForce RTX 5060 Laptop GPU (CUDA 12.8, …)` or
  `CPU (reason)`. If the GPU fails, it retries on the CPU and says so. `--device cpu` forces the CPU.
- Writes `lyrics.lrc` next to `lyrics.txt` (old one kept as `lyrics.lrc.bak`), with word timings
  (`[00:14.00]* <00:14.00>Hope <00:14.42>is …`). `* ` hooks and blank-line pauses are kept.
- Lists every line with its confidence; lines below 0.5 are shown in orange. Check them by ear and
  re-tap or edit their stamp.
- `--compare <tapped.lrc>`: per-line differences in ms, the median, the worst 5, the typical
  offset with the matching `pnpm lrc:shift` command, and your tapped time next to low-confidence
  lines. If the output would overwrite the comparison file (on Windows `lyrics.lrc` = `Lyrics.lrc`),
  it writes `lyrics.aligned.lrc` instead.
- `--diagnose "2,9"` (quote the list in PowerShell; `"2 9"` also works): for those lines, what the aligner heard: words with scores, a loudness chart of
  the vocal track (A = aligned, T = tapped), the bursts of voice nearby, a best guess (reverb tail,
  breath, quieter backing vocal, …) and two WAV snippets of the vocals only (at the aligned and at
  the tapped time) in `workspace\cache\diagnose\` — listen to them.
- `--hint <taps.lrc>`: for lines below 0.7 confidence only, uses your tapped time (corrected by the
  typical offset) and moves the line to the nearest start of the voice, re-aligning that line on its
  own. The adjusted lines are listed. The hint file is never overwritten.
- `--trim off` turns off the correction for words stretched over a silent gap.
- The vocal track and the alignment are cached (`workspace\cache\stems`, `workspace\cache\align`),
  so running it again is quick.

## Test render (`pnpm render:test`)

Put the test material in `workspace\test\`: `song.wav` (or `song.mp3`), a `clips\` folder with video
clips, and `lyrics.lrc` (from `pnpm tap`). Then:

```powershell
cd D:\videomaker
pnpm render:test
pnpm render:test --seed 7 --style bold --bars --rate 2x --energy high
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--song`, `--clips`, `--lrc` | files in `workspace\test\` | other files |
| `--section 0:11-0:59` | first to last lyric line | part of the song (the start snaps to the nearest bar) |
| `--rate`, `--energy` | `1x`, `medium` | as for `pnpm cuts`; `--rate off` = one shot per lyric line |
| `--order` | `story` | `story` = clips in file-name order (01_, 02_, …), `shuffle` = random by seed |
| `--seed` | `1` | shuffle only: which clips go where (same seed = same video) |
| `--pins` | `workspace\test\pins.txt` if present | force clips onto lyric lines (see below) |
| `--lead` | `0.25` | lines appear this many seconds before their stamp |
| `--lyrics-offset` | `0` | move all lines (seconds; negative = earlier), e.g. `-0.3` |
| `--font`, `--font-hook` | the style's font | font family for the lyrics / for hook lines (see `pnpm fonts`) |
| `--style` | `simple` | `simple` or `bold` |
| `--bars` | off | cinematic black bars top and bottom |
| `--downbeat-offset` | from analysis | move bar 1 |
| `--out` | `workspace\test\renders\<style>-seed<seed>.mp4` | output file |

**Story order**: name your clips `01_intro.mp4`, `02_walk.mp4`, … and they play in that order,
cycling when the section has more shots than clips (a clip shown again continues where it stopped).

**Pins** (`workspace\test\pins.txt`), one per line:

```
Love is a good thing = 07_hero.mp4
Another line = 03_city
```

The clip goes onto the shot where that lyric line appears on screen, every time the line occurs.
Pins beat the order mode. Lines starting with `#` are comments. Warnings are printed when a line or
clip is not found, a line is outside the section, or two pins hit the same shot.

**Fonts**: `pnpm fonts` lists every font with its weights, italics and whether it has é è à ç œ.
Put your own `.ttf`, `.otf` or `.woff2` files in `workspace\fonts\`; they appear in that list under
their real family name. Example: `pnpm render:test --font "Playfair Display" --font-hook "Caveat Brush"`.

The output is 1080x1920, 30 fps, H.264, AAC 192 kbps, yuv420p, faststart. The first render
downloads Remotion's headless Chrome once (~100 MB, inside the project) and prepares the clips
(converted copies are kept in `workspace\cache\normalised\`), so later renders are faster.

## Preview page

With `pnpm dev` running, open http://localhost:3000/preview. It plays the same video as
`pnpm render:test` (same files, same composition, same props). **Story / Shuffle** switches the clip
order (**Shuffle** button = new seed), **Simple / Bold** switches the text style, the **Lyrics offset**
slider moves the lines (it shows the `pnpm lrc:shift` command to make it permanent), pin warnings
are listed, and the page shows the exact `pnpm render:test` command to export what
you see. Tick **Show safe-zone guides** (or open http://localhost:3000/preview?safe-guides) to see the
areas covered by TikTok / Reels / Shorts buttons (red) and the lyric area (blue); guides are never
rendered into the export. **Reload files** picks up changed songs, clips or lyrics.

## Database

| Command | What it does |
| --- | --- |
| `pnpm db:show` | Shows the database location, the number of rows in each table, and the 10 style presets |
| `pnpm db:setup` | Creates or updates the database and adds the style presets (also done by `pnpm dev`) |
| `pnpm db:migrate` | Only applies database updates (migrations) |
| `pnpm db:seed` | Only adds missing style presets |

Running these again is always safe; nothing is duplicated or deleted.

## Settings (.env)

Optional. Copy `.env.example` to `.env` and edit it:

```powershell
Copy-Item .env.example .env
notepad .env
```

- `WORKSPACE_DIR` — where songs, clips, thumbnails, renders and the database live.
  Default `./workspace`. To use another drive: `WORKSPACE_DIR=D:\LyricStudio\workspace`.
  To move existing media, stop `pnpm dev`, move the whole folder, then update this line.
  (The database stores paths relative to this folder, so nothing else needs changing.)
- `FFMPEG_PATH` / `FFPROBE_PATH` — only if `ffmpeg -version` does not work in the terminal.

## Tests and checks

Tests also run automatically on GitHub (Actions → "Tests") after every push to `main`. The real AI
model tests for `pnpm align` run in a separate workflow (Actions → "AI alignment"), on demand and
when the audio service changes. Locally: `pnpm test:audio -m ai` (needs `pnpm audio:setup --ai`).

```powershell
pnpm test        # automated tests
pnpm typecheck   # TypeScript checks
```

Next.js telemetry (anonymous usage data) is switched off for this project. To confirm:
`pnpm --filter @lyric/studio telemetry` prints "You have opted-out".

### Updating the AI packages

`services/audio/requirements-ai.in` lists them; the exact versions are in
`requirements-ai-windows.txt` / `requirements-ai-linux.txt`, generated with
`uv pip compile --python-platform <x86_64-pc-windows-msvc | x86_64-manylinux_2_28> --python-version 3.12
requirements-ai.in -c requirements.txt --no-emit-package torch --no-emit-package torchaudio
--no-emit-package torchvision` (plus `--no-emit-package nvidia-…` for Linux).

## Troubleshooting

- **"running scripts is disabled on this system"** when typing `pnpm`: PowerShell is blocking scripts.
  Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then reopen the terminal.
- **"Python 3.12 was not found"**: run `py -0`. If `-V:3.12` is missing, install Python 3.12
  (see the table above), reopen Cursor, then run `pnpm audio:setup`.
- **`pnpm audio:setup` says "No matching distribution" or "Could not find a version"**: a Python
  package has no ready-made version for this PC. Nothing is compiled on purpose; report the
  message so the pinned versions can be adjusted.
- **"FFmpeg was not found"**: check that `ffmpeg -version` and `ffprobe -version` work in Cursor's
  terminal (reopen Cursor after installing FFmpeg), or set `FFMPEG_PATH` / `FFPROBE_PATH` in `.env`.
- **"Port 3000 (or 8001) is already in use"**: an earlier `pnpm dev` is still running.
  Close other terminals that run it, or restart Cursor.
- **Windows Firewall pop-up for Node.js or Python**: choose "Allow" for private networks. Everything stays on your PC.
