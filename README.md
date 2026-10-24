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
- WAV, MP3 and FLAC work.

The service also offers `POST http://127.0.0.1:8001/analyze` with
`{"path": "<path inside the workspace>", "project_id": "<optional>", "bpm": <optional>}`.
With `project_id` it stores the BPM and duration on the project and replaces its beats.

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

```powershell
pnpm test        # automated tests
pnpm typecheck   # TypeScript checks
```

Next.js telemetry (anonymous usage data) is switched off for this project. To confirm:
`pnpm --filter @lyric/studio telemetry` prints "You have opted-out".

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
