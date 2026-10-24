# Lyric Studio

A personal, local studio for making 9:16 beat-synced lyric videos for **Life Lyrics**.
Everything runs on your own PC. See `CLAUDE.md` for the full brief and `PROGRESS.md` for status.

## What is in this repo

| Folder | What it is | Address |
| --- | --- | --- |
| `apps/studio` | The web app (Next.js): Home, Studio, Library | http://localhost:3000 |
| `apps/worker` | Background render worker (Node) | (no web page; prints `worker ready`) |
| `services/audio` | Audio analysis service (Python FastAPI) | http://127.0.0.1:8001/health |
| `packages/video` | The Remotion video composition `LyricVideo` | |
| `packages/db` | Database code (SQLite, empty for now) | |
| `workspace/` | Your songs, clips, renders and database (not saved to git) | |

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
cd $HOME\Documents
git clone https://github.com/laipaul/videomaker.git
cd videomaker
pnpm install
pnpm audio:setup
```

`pnpm audio:setup` creates a private Python 3.12 environment in `services\audio\.venv`
(using `py -3.12`). Nothing is installed globally. If an old `.venv` was made with another
Python version, it is removed and rebuilt automatically.

## Get the latest changes

```powershell
cd $HOME\Documents\videomaker
git pull
pnpm install
pnpm audio:setup
```

## Run it

```powershell
pnpm dev
```

This starts all three parts in one terminal. Each line is tagged `[studio]`, `[worker]` or `[audio]`.
You should see:

- `[worker] worker ready`
- `[studio] ... Ready`  → open http://localhost:3000
- `[audio] Uvicorn running on http://127.0.0.1:8001`  → open http://127.0.0.1:8001/health
  and you should see `{"status":"ok","service":"audio"}`

Stop everything with **Ctrl+C**.

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
- **"Port 3000 (or 8001) is already in use"**: an earlier `pnpm dev` is still running.
  Close other terminals that run it, or restart Cursor.
- **Windows Firewall pop-up for Node.js or Python**: choose "Allow" for private networks. Everything stays on your PC.
