// The studio's run queue (Step 6.2b): "Generate" and "Resume" add a make_run; the worker takes the
// oldest one when nothing is running and does it with the same code as "pnpm make". Also the Tasks
// menu's list (studio runs + runs started in the terminal). No Remotion code here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, makeRun, project as projectTable, renderJob, variation, type MakeRun, type Workspace } from "@lyric/db";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { parseEffectChoice } from "../effects/names";
import { processAlive } from "./jobs";
import { commandArgs, parseMakeArgs } from "./make-args";
import type { MakeOptions } from "./make";
import { readProjectSettings } from "./project-settings";
import { runFolders } from "./exports";
import { songPaths, songPathsById } from "./song-folder";
import type { Manifest } from "./manifest";

// What the Generate panel sends.
export type RunRequest = {
  platforms: string[];
  collection?: string;
  variations?: number;
  lineEffect?: string;
  hookEffect?: string;
  title?: string;
  artist?: string;
  ep?: string;
  section?: string; // auto | full | 0:11-1:10
  length?: number; // seconds an auto section aims for (all chosen platforms)
  allowFill?: boolean;
  layout?: "cover" | "stills" | "clips";
  realign?: boolean;
  saveToSong?: boolean; // keep this run's choices in the song's recipe (song.json; locked settings stay)
};

// The options a run is made with (MakeOptions without callbacks), stored in make_run.options_json.
export type RunOptions = Omit<MakeOptions, "align" | "renderer" | "thumbnailRenderer" | "log" | "onRenderProgress" | "onReady" | "onRetry" | "shouldStop" | "now" | "platform">;

export function checkRunRequest(req: RunRequest, platformNames: readonly string[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(req.platforms) || !req.platforms.length) problems.push("Choose at least one platform.");
  else for (const p of req.platforms) if (!platformNames.includes(p)) problems.push(`Unknown platform "${p}".`);
  if (req.variations !== undefined && !(Number.isInteger(req.variations) && req.variations >= 1 && req.variations <= 24)) problems.push("Videos per platform must be 1-24.");
  for (const [field, value] of [["Verse effect", req.lineEffect], ["Hook effect", req.hookEffect]] as const) {
    if (value) {
      try {
        parseEffectChoice(value, field);
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
  }
  if (req.section && !/^(auto|full|\d+:\d{1,2}(\.\d+)?\s*-\s*\d+:\d{1,2}(\.\d+)?)$/.test(req.section.trim())) problems.push('Section must be "auto", "full" or like 0:11-1:10.');
  if (req.length !== undefined && !(typeof req.length === "number" && req.length >= 3 && req.length <= 600)) problems.push("Target length must be 3-600 seconds.");
  if (req.layout && !["cover", "stills", "clips"].includes(req.layout)) problems.push("YouTube layout must be cover, stills or clips.");
  if (req.collection !== undefined && !/^[^\\/:*?"<>|]+$/.test(req.collection)) problems.push("Choose a collection.");
  return problems;
}

// The project's lyrics.txt: the one stored by "+ New song", else the newest copy kept by an alignment.
export function projectLyricsTxt(ws: Workspace, projectId: string): string | null {
  const paths = songPathsById(ws, projectId);
  if (!paths.legacy && existsSync(paths.lyricsTxt)) return paths.lyricsTxt; // the song folder's lyrics.txt
  const stored = readProjectSettings(ws, projectId).lyricsTxt;
  if (stored && existsSync(absPath(ws, stored))) return absPath(ws, stored);
  const dir = paths.store;
  if (!existsSync(dir)) return null;
  const copies = readdirSync(dir)
    .filter((f) => /^lyrics(-[0-9a-f]{12})?\.txt$/.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return copies[0] ?? null;
}

const projectSong = (ws: Workspace, p: typeof projectTable.$inferSelect) => {
  if (!p.audio_path || !existsSync(absPath(ws, p.audio_path))) throw new Error(`The song file of "${p.title}" is missing from the workspace.`);
  return absPath(ws, p.audio_path);
};

// Generate: the panel's choices -> run options (the project's own song and lyrics).
export function generateOptions(ws: Workspace, projectId: string, req: RunRequest): RunOptions {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const lyrics = projectLyricsTxt(ws, projectId);
  if (!lyrics) throw new Error(`"${p.title}" has no lyrics.txt yet: add it with "+ New song" (choose the same song file; it updates this song).`);
  return {
    song: projectSong(ws, p),
    lyrics,
    platforms: req.platforms.join(","),
    ...(req.collection ? { collection: req.collection } : {}),
    ...(req.variations ? { variations: req.variations } : {}),
    ...(req.lineEffect ? { lineEffect: req.lineEffect } : {}),
    ...(req.hookEffect ? { hookEffect: req.hookEffect } : {}),
    ...(req.title?.trim() ? { title: req.title.trim() } : {}),
    ...(req.artist?.trim() ? { artist: req.artist.trim() } : {}),
    ...(req.ep?.trim() ? { ep: req.ep.trim() } : {}),
    ...(req.section?.trim() ? { section: req.section.trim() } : {}), // only sent when changed from the recipe
    ...(req.length ? { length: Math.round(req.length) } : {}),
    ...(req.allowFill ? { allowFill: true } : {}),
    ...(req.layout ? { layout: req.layout } : {}),
    ...(req.realign ? { realign: true } : {}),
    command: "Lyric Studio: Generate",
  };
}

// Resume: the run's own options (a studio run) or its command from the manifests (a terminal run),
// plus resume into that folder. Files that moved are replaced by the project's own copies.
export function resumeOptions(ws: Workspace, projectId: string, folder: string): RunOptions {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  if (!runFolders(ws, projectId).includes(folder)) throw new Error(`No run ${folder} for "${p.title}".`);
  const paths = songPaths(ws, p);
  const runDir = path.join(paths.exports, folder);
  const studioRun = ws.db.select().from(makeRun).where(and(eq(makeRun.project_id, projectId), eq(makeRun.export_dir, `${paths.exportsRel}/${folder}`))).orderBy(desc(makeRun.created_at)).get();
  let options: RunOptions;
  if (studioRun) {
    options = { ...(studioRun.options_json as RunOptions) };
  } else {
    const command = findCommand(runDir);
    if (!command) throw new Error(`The run ${folder} has no finished video to read its settings from; make it again with Generate.`);
    options = parseMakeArgs(commandArgs(command), REPO_ROOT).options;
  }
  if (!existsSync(options.song)) options.song = projectSong(ws, p);
  if (!existsSync(options.lyrics)) {
    const lyrics = projectLyricsTxt(ws, projectId);
    if (!lyrics) throw new Error(`The lyrics file ${options.lyrics} is missing and "${p.title}" has no stored copy.`);
    options.lyrics = lyrics;
  }
  return { ...options, resume: true, resumeFolder: runDir, command: `${options.command ?? "pnpm make"} (resumed in Lyric Studio)` };
}

function findCommand(runDir: string): string | null {
  const dirs = [runDir, ...readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(runDir, d.name))];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".manifest.json"))) {
      try {
        const m = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Manifest;
        if (m.command && !m.command.startsWith("Lyric Studio")) return m.command.replace(/ \(resumed in Lyric Studio\)$/, "");
      } catch {
        // not a readable manifest
      }
    }
  }
  return null;
}

const LABELS: Record<string, string> = { standard: "Standard", reels: "Reels", tiktok: "TikTok", shorts: "Shorts", youtube: "YouTube", canvas: "Canvas" };
export const platformListLabel = (platforms: string | undefined) => (platforms ?? "standard").split(",").map((p) => LABELS[p] ?? p).join(", ");

export function enqueueRun(ws: Workspace, projectId: string, options: RunOptions, label?: string): MakeRun {
  return ws.db
    .insert(makeRun)
    .values({ project_id: projectId, options_json: options as Record<string, unknown>, label: label ?? (options.resume ? `Resume ${platformListLabel(options.platforms)}` : platformListLabel(options.platforms)) })
    .returning()
    .get();
}

// Runs whose worker is gone (closed, PC restarted) become "interrupted".
export function markInterruptedRuns(ws: Workspace, isAlive: (pid: number) => boolean = processAlive): number {
  const running = ws.db.select().from(makeRun).where(eq(makeRun.status, "running")).all();
  const gone = running.filter((r) => r.pid === null || !isAlive(r.pid)).map((r) => r.id);
  if (gone.length) ws.db.update(makeRun).set({ status: "interrupted", message: "interrupted: Lyric Studio was closed while it was making these videos", finished_at: new Date() }).where(inArray(makeRun.id, gone)).run();
  return gone.length;
}

// The worker takes the oldest queued run, if no run is going on.
export function claimNextRun(ws: Workspace, pid: number = process.pid, isAlive: (pid: number) => boolean = processAlive): MakeRun | null {
  markInterruptedRuns(ws, isAlive);
  if (ws.db.select().from(makeRun).where(eq(makeRun.status, "running")).get()) return null;
  const next = ws.db.select().from(makeRun).where(eq(makeRun.status, "queued")).orderBy(makeRun.created_at).get();
  if (!next) return null;
  return ws.db.update(makeRun).set({ status: "running", pid, started_at: new Date() }).where(and(eq(makeRun.id, next.id), eq(makeRun.status, "queued"))).returning().get() ?? null;
}

// Stop: a queued run is cancelled at once; a running one stops after the video it is making.
export function requestStop(ws: Workspace, id: string): MakeRun {
  const run = ws.db.select().from(makeRun).where(eq(makeRun.id, id)).get();
  if (!run) throw new Error("Task not found.");
  if (run.status === "queued") return ws.db.update(makeRun).set({ status: "stopped", message: "cancelled before it started", finished_at: new Date() }).where(eq(makeRun.id, id)).returning().get()!;
  if (run.status === "running") return ws.db.update(makeRun).set({ stop_requested: true, current: "stopping after the current video…" }).where(eq(makeRun.id, id)).returning().get()!;
  return run;
}

export function stopRequested(ws: Workspace, id: string): boolean {
  return ws.db.select({ s: makeRun.stop_requested }).from(makeRun).where(eq(makeRun.id, id)).get()?.s ?? false;
}

export type TerminalRun = { projectId: string; title: string; run: string | null; platforms: string[]; videos: { platform: string; status: string; progress: number }[] };
export type Tasks = { runs: (MakeRun & { title: string })[]; terminal: TerminalRun[] };

// The Tasks menu: studio runs (queued, running, and those finished in the last 24 hours) and runs
// started in the terminal that are rendering right now.
// A stopped or interrupted run that can still Resume (it has a run folder; "cancelled before it started" has none).
export const canResume = (run: Pick<MakeRun, "status" | "export_dir">) => (run.status === "stopped" || run.status === "interrupted") && !!run.export_dir;

// "Clear finished" in the Tasks menu: hides done, failed and never-started entries; stopped / interrupted
// runs that can still Resume only with includeStopped (the menu asks first). Running and queued runs are
// never cleared, and nothing but the list entry changes (videos and files stay).
export function clearFinished(ws: Workspace, { includeStopped = false, now = new Date() }: { includeStopped?: boolean; now?: Date } = {}): { cleared: number; resumable: number } {
  markInterruptedRuns(ws);
  const finished = ws.db
    .select()
    .from(makeRun)
    .where(and(inArray(makeRun.status, ["done", "failed", "stopped", "interrupted"]), isNull(makeRun.cleared_at)))
    .all();
  const clear = finished.filter((r) => includeStopped || !canResume(r));
  if (clear.length) ws.db.update(makeRun).set({ cleared_at: now }).where(inArray(makeRun.id, clear.map((r) => r.id))).run();
  // Counted for the question only when the menu still shows them (the last 24 hours).
  const since = now.getTime() - 24 * 3600_000;
  return { cleared: clear.length, resumable: finished.filter((r) => canResume(r) && !clear.includes(r) && r.created_at.getTime() >= since).length };
}

// The Tasks menu: running and queued runs, plus the finished ones of the last 24 hours not cleared.
export function listTasks(ws: Workspace, now = new Date()): Tasks {
  markInterruptedRuns(ws);
  const titles = new Map(ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all().map((p) => [p.id, p.title]));
  const since = new Date(now.getTime() - 24 * 3600_000);
  const runs = [
    ...ws.db.select().from(makeRun).where(inArray(makeRun.status, ["queued", "running"])).all(),
    ...ws.db
      .select()
      .from(makeRun)
      .where(and(inArray(makeRun.status, ["done", "failed", "stopped", "interrupted"]), gte(makeRun.created_at, since), isNull(makeRun.cleared_at)))
      .all(),
  ]
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, 12)
    .map((r) => ({ ...r, title: titles.get(r.project_id) ?? "?" }));
  const open = ws.db
    .select({ status: renderJob.status, progress: renderJob.progress, pid: renderJob.pid, projectId: variation.project_id, overrides: variation.overrides_json })
    .from(renderJob)
    .innerJoin(variation, eq(renderJob.variation_id, variation.id))
    .where(inArray(renderJob.status, ["queued", "rendering"]))
    .all()
    .filter((j) => !j.overrides?.make_run && j.pid !== null && processAlive(j.pid));
  const groups = new Map<string, TerminalRun>();
  for (const j of open) {
    const key = `${j.projectId}|${j.overrides?.run ?? ""}`;
    const g = groups.get(key) ?? { projectId: j.projectId, title: titles.get(j.projectId) ?? "?", run: (j.overrides?.run as string | undefined)?.split("/").pop() ?? null, platforms: [], videos: [] };
    const platform = String(j.overrides?.platform ?? "standard");
    if (!g.platforms.includes(platform)) g.platforms.push(platform);
    g.videos.push({ platform, status: j.status, progress: j.progress });
    groups.set(key, g);
  }
  return { runs, terminal: [...groups.values()] };
}
