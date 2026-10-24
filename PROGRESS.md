# Progress

## Steps done

### Step 1 — Monorepo skeleton ✅
- pnpm workspaces: `apps/studio`, `apps/worker`, `packages/video`, `packages/db`, `services/audio`.
- `apps/studio`: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui, dark theme.
  Placeholder pages: Home (`/`), Studio (`/studio`), Library (`/library`).
  Studio has the three-panel layout (project panel, phone-shaped 9:16 preview with a disabled
  "Render video" button, media panel).
- `apps/worker`: Node + TypeScript, prints `worker ready` and stays running.
- `packages/video`: Remotion 4 with a placeholder `LyricVideo` composition (1080x1920, 30 fps).
- `packages/db`: empty package, ready for Drizzle + SQLite.
- `services/audio`: FastAPI on port 8001 with `GET /health`, in a project-local `.venv`
  (Python 3.12, created automatically by `pnpm audio:setup` or the first `pnpm dev`).
- One root `pnpm dev` starts studio + worker + audio together.
- Test: `packages/video/src/config.test.ts` checks the video format (1080x1920, 9:16, 30 fps).

### Setup fixes (after Step 1)
- Work happens directly on `main`.
- Accept Node 22/24 and pnpm 10/11/12: removed the pnpm version pin, added the pnpm 11+
  `allowBuilds` setting, and rebuilt the lockfile with pnpm 12 (pnpm 12 rejects packages published
  in the last 24 hours, and the old lockfile contained some).
- Audio service always uses Python 3.12 (`py -3.12` on Windows, `python3.12` elsewhere). An
  existing `.venv` built with another version is rebuilt; a clear error is shown if 3.12 is missing.
- Next.js telemetry is disabled for this project (`NEXT_TELEMETRY_DISABLED=1` via `cross-env`
  in the studio scripts). Check with `pnpm --filter @lyric/studio telemetry`.

## What works
- `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm --filter @lyric/studio build`.
- http://localhost:3000 (Home / Studio / Library) and http://127.0.0.1:8001/health.

## Known issues
- shadcn/ui components (button, card, input, tabs) were added by hand in the same format the
  shadcn CLI produces, because the build environment could not reach the shadcn website.
  `pnpm dlx shadcn@latest add <name>` works normally on your PC for future components.
- FFmpeg is not needed yet. It will be needed from the render steps onwards.

## Next
- Step 2 (database and workspace) — plan sent, waiting for approval.
