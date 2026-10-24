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

Install these once. They are normal Windows installers.

1. **Git**: https://git-scm.com/download/win (default options).
2. **Node.js 22 LTS**: https://nodejs.org (the "LTS" Windows installer, default options).
3. **Python 3.12**: https://www.python.org/downloads/windows/ — in the installer, tick
   **"Add python.exe to PATH"** and leave the **"py launcher"** option ticked.
4. **pnpm** (the package manager this project uses). Open PowerShell **as Administrator** once and run:
   ```powershell
   corepack enable
   ```
   (Corepack ships with Node.js. This only switches on the `pnpm` command.)

Close and reopen Cursor afterwards so it picks up the new commands. Check them in Cursor's terminal:

```powershell
git --version
node --version     # v22.x or newer
pnpm --version     # 10.x
py -3 --version    # Python 3.10 or newer (3.12 recommended)
```

## Get the code (first time)

```powershell
cd $HOME\Documents
git clone https://github.com/laipaul/videomaker.git
cd videomaker
git checkout claude/zen-cray-bhmrvm
pnpm install
pnpm audio:setup
```

`pnpm audio:setup` creates a private Python environment in `services\audio\.venv`.
Nothing is installed globally.

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

## Troubleshooting

- **"running scripts is disabled on this system"** when typing `pnpm`: PowerShell is blocking scripts.
  Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then reopen the terminal.
- **"Python 3.10 or newer was not found"**: install Python 3.12 (step 3 above), reopen Cursor,
  then run `pnpm audio:setup`.
- **"Port 3000 (or 8001) is already in use"**: an earlier `pnpm dev` is still running.
  Close other terminals that run it, or restart Cursor.
- **Windows Firewall pop-up for Node.js or Python**: choose "Allow" for private networks. Everything stays on your PC.
