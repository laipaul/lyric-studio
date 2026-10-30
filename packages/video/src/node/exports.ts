// The videos "pnpm make" wrote for a song, read from its export folders (also the runs made from the
// command line): per run and platform, every video with its files, settings, QA result (with the
// reasons) and the user's marks; interrupted runs with the command that resumes them.
// No Remotion code here: the studio's server uses it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { absPath, renderJob, storedPath, variation, videoMark, type VideoMarkStatus, type Workspace } from "@lyric/db";
import { and, eq } from "drizzle-orm";

import { markInterruptedJobs, processAlive } from "./jobs";
import { songPathsById } from "./song-folder";
import type { Manifest } from "./manifest";
import { assessVideo, strongest, type Assessment } from "../assess";
import { reactionsFor, type Reaction } from "../reactions-list";

export const RUN_FOLDER = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(-\d+)?$/;
export const SHORT_LABELS: Record<string, string> = { standard: "Standard", reels: "Reels", tiktok: "TikTok", shorts: "Shorts", youtube: "YouTube", canvas: "Canvas" };

export type QaProblem = { check: string; details: string[] };
export type QaResult = { status: "PASS" | "WARN" | null; problems: QaProblem[] };

// A vN.qa.txt: "[WARN] Check name" lines with indented details, and "Summary: PASS | WARN - ...".
export function parseQaReport(text: string): QaResult {
  const problems: QaProblem[] = [];
  let current: QaProblem | null = null;
  let status: QaResult["status"] = null;
  for (const line of text.split(/\r?\n/)) {
    const check = /^\[(ok {2}|WARN)\] (.+)$/.exec(line);
    if (check) {
      current = check[1] === "WARN" ? { check: check[2].trim(), details: [] } : null;
      if (current) problems.push(current);
      continue;
    }
    if (current && /^\s{2,}\S/.test(line)) current.details.push(line.trim());
    const summary = /^Summary: (PASS|WARN)/.exec(line);
    if (summary) status = summary[1] as "PASS" | "WARN";
  }
  return { status, problems };
}

export type VideoInfo = {
  id: string; // workspace-relative manifest path (also the key of its marks)
  run: string; // run folder name
  platform: string;
  label: string;
  name: string; // "v1"
  index: number;
  mp4: string; // workspace-relative
  srt: string | null;
  thumbnail: string | null; // YouTube
  cover: string | null; // Reels / TikTok / Shorts: the cover with the title (workspace-relative)
  publish: string | null; // YouTube publish.txt
  durationS: number | null;
  style: string;
  order: string;
  seed: number;
  bars: boolean;
  effects: { verse: string; hook: string } | null;
  layout: string | null;
  createdAt: string;
  qa: QaResult;
  reactions: { id: Reaction; label: string }[]; // the reaction keywords this video offers
  assessment: Assessment; // the pro assessment (src/assess.ts): verdict, points with actions, what the app handled
  mark: { favourite: boolean; status: VideoMarkStatus };
};

export type PlatformRun = {
  name: string;
  label: string;
  videos: VideoInfo[];
  strongest: { name: string; why: string } | null; // the clearly strongest video of several
  missing: string[]; // vN started but not finished
  interrupted: boolean;
  failed: string[]; // errors of failed videos
};

export type RunInfo = {
  folder: string;
  time: string | null;
  command: string | null; // as typed (from the manifests)
  resumeCommand: string | null;
  platforms: PlatformRun[];
};

const runTime = (name: string) => {
  const m = RUN_FOLDER.exec(name);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

export function runFolders(ws: Workspace, projectId: string): string[] {
  const dir = songPathsById(ws, projectId).exports;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && RUN_FOLDER.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// The resume command: the run's own command plus --resume.
export function resumeCommandFor(command: string | null): string | null {
  if (!command) return null;
  return /\s--resume(\s|$)/.test(command) ? command : `${command} --resume`;
}

type JobRow = { status: string; error: string | null; started: Date | null; pid: number | null; seed: number; overrides: Record<string, unknown> | null };

// Jobs still in trouble: interrupted / failed ones whose video (same seed = same vN) has not been made
// by a later job of the run (a Resume).
export function unresolvedJobs<T extends { status: string; seed: number }>(jobs: readonly T[]): T[] {
  const madeLater = new Set(jobs.filter((j) => j.status === "done").map((j) => j.seed));
  return jobs.filter((j) => (j.status === "interrupted" || j.status === "failed") && !madeLater.has(j.seed));
}

// Every run of a song (oldest first) with its platforms and videos.
export function songRuns(ws: Workspace, projectId: string, labels: Record<string, string> = SHORT_LABELS): RunInfo[] {
  markInterruptedJobs(ws);
  const marks = new Map(ws.db.select().from(videoMark).where(eq(videoMark.project_id, projectId)).all().map((m) => [m.video, m]));
  const jobs: JobRow[] = ws.db
    .select({ status: renderJob.status, error: renderJob.error, started: renderJob.started_at, pid: renderJob.pid, seed: variation.seed, overrides: variation.overrides_json })
    .from(renderJob)
    .innerJoin(variation, eq(renderJob.variation_id, variation.id))
    .where(eq(variation.project_id, projectId))
    .all();
  const exportsDir = songPathsById(ws, projectId).exports;
  const folders = runFolders(ws, projectId);

  const inputs = new Map<string, Omit<Parameters<typeof assessVideo>[0], "problems">>();
  const runs = folders.map((folder, k) => {
    const runDir = path.join(exportsDir, folder);
    const runRel = storedPath(ws, runDir);
    const since = runTime(folder);
    const until = folders[k + 1] ? runTime(folders[k + 1]) : null;
    // Jobs of this run: linked by folder (since 6.2a), older ones by time.
    const runJobs = (platform: string) =>
      jobs.filter((j) => (j.overrides?.platform ?? "standard") === platform && (j.overrides?.run ? j.overrides.run === runRel : !!j.started && (!since || j.started >= since) && (!until || j.started < until)));
    let command: string | null = null;
    const platformDirs = readdirSync(runDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, dir: path.join(runDir, d.name) }));
    const candidates = [{ name: "standard", dir: runDir }, ...platformDirs];
    const platforms: PlatformRun[] = [];
    for (const { name, dir } of candidates) {
      const files = readdirSync(dir);
      const names = [...new Set(files.filter((f) => /^v\d+\.(mp4|manifest\.json|qa\.txt|srt)$/.test(f)).map((f) => f.split(".")[0]))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      if (!names.length && !runJobs(name).length) continue;
      const videos: VideoInfo[] = [];
      const missing: string[] = [];
      for (const n of names) {
        const done = ["mp4", "manifest.json", "qa.txt"].every((ext) => files.includes(`${n}.${ext}`));
        const m = done ? readJson<Manifest>(path.join(dir, `${n}.manifest.json`)) : null;
        if (!m) {
          missing.push(n);
          continue;
        }
        command ??= m.command ?? null;
        const id = storedPath(ws, path.join(dir, `${n}.manifest.json`));
        const mark = marks.get(id);
        const settings = (m.settings ?? {}) as Record<string, unknown>;
        const rel = (f: string) => (files.includes(f) ? storedPath(ws, path.join(dir, f)) : null);
        videos.push({
          id,
          run: folder,
          platform: name,
          label: labels[name] ?? name,
          name: n,
          index: Number(n.slice(1)),
          mp4: rel(`${n}.mp4`)!,
          srt: rel(`${n}.srt`),
          thumbnail: name === "youtube" ? rel("thumbnail.jpg") : null,
          cover: rel(`${n}.cover.jpg`) ?? (names.length === 1 ? rel("cover.jpg") : null),
          publish: name === "youtube" ? rel("publish.txt") : null,
          durationS: m.output?.duration_s ?? null,
          style: m.variation?.style ?? "",
          order: m.variation?.order ?? "story",
          seed: m.variation?.seed ?? 0,
          bars: m.variation?.cinematic_bars ?? false,
          effects: typeof settings.line_effect === "string" ? { verse: settings.line_effect, hook: String(settings.hook_effect ?? "") } : null,
          layout: m.props?.layout ?? null,
          createdAt: m.created_at,
          qa: parseQaReport(readFileSync(path.join(dir, `${n}.qa.txt`), "utf8")),
          reactions: reactionsFor(name),
          assessment: assessVideo({ problems: [] }), // set below, once every video of the song is read (learning)
          mark: { favourite: mark?.favourite ?? false, status: mark?.status ?? "generated" },
        });
        inputs.set(id, assessInput(m));
      }
      const open = unresolvedJobs(runJobs(name));
      platforms.push({
        name,
        label: labels[name] ?? name,
        videos,
        strongest: null,
        missing,
        interrupted: open.some((j) => j.status === "interrupted"),
        failed: open.filter((j) => j.status === "failed").map((j) => j.error ?? "failed"),
      });
    }
    return { folder, time: since?.toISOString() ?? null, command, resumeCommand: resumeCommandFor(command), platforms };
  });
  // The pro assessment, learning from the approved videos: a minor point approved twice no longer counts.
  const all = runs.flatMap((r) => r.platforms.flatMap((p) => p.videos));
  const assess = (v: VideoInfo, acceptedCodes?: Record<string, number>) => assessVideo({ problems: v.qa.problems, ...inputs.get(v.id), ...(acceptedCodes ? { acceptedCodes } : {}) });
  const acceptedCodes: Record<string, number> = {};
  for (const v of all.filter((x) => x.mark.status === "approved")) for (const p of assess(v).points) if (!p.major) acceptedCodes[p.code] = (acceptedCodes[p.code] ?? 0) + 1;
  for (const v of all) v.assessment = assess(v, acceptedCodes);
  for (const r of runs) for (const p of r.platforms) p.strongest = strongest(p.videos.filter((v) => v.mark.status !== "discarded"));
  return runs;
}

// The verdict of one video just made (its qa.txt + manifest, as the Videos tab reads them); null when they cannot be read.
export function assessMade(qaFile: string, manifestFile: string): Assessment | null {
  try {
    const m = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
    return assessVideo({ problems: parseQaReport(readFileSync(qaFile, "utf8")).problems, ...assessInput(m) });
  } catch {
    return null;
  }
}

// What the assessment needs from a manifest: the shots (slow motion), the app's decisions, the Canvas.
export function assessInput(m: Manifest): Omit<Parameters<typeof assessVideo>[0], "problems"> {
  const settings = (m.settings ?? {}) as Record<string, { text?: string } | unknown>;
  const text = (k: string) => (settings[k] as { text?: string } | null | undefined)?.text;
  const canvas = settings.canvas as { seconds?: number; possible_s?: number; need_clip_s?: number | null } | undefined;
  return {
    shots: (m.props?.shots ?? []).map((s) => ({ start_s: s.start / 30, speed: s.playbackRate, hold: s.holdLastFrame, photo: s.kind === "photo" })),
    decisions: [text("pace"), text("transition_plan"), text("ending")].filter((x): x is string => !!x),
    canvas: canvas?.seconds !== undefined && canvas.possible_s !== undefined ? { seconds: canvas.seconds, possibleS: canvas.possible_s, needClipS: canvas.need_clip_s ?? null } : null,
  };
}

// Jobs still rendering (their process is alive), per platform.
export function renderingPlatforms(ws: Workspace, projectId: string): Set<string> {
  const rows = ws.db
    .select({ status: renderJob.status, pid: renderJob.pid, overrides: variation.overrides_json })
    .from(renderJob)
    .innerJoin(variation, eq(renderJob.variation_id, variation.id))
    .where(and(eq(variation.project_id, projectId)))
    .all();
  return new Set(rows.filter((r) => (r.status === "queued" || r.status === "rendering") && r.pid !== null && processAlive(r.pid)).map((r) => String(r.overrides?.platform ?? "standard")));
}

// Sets the user's marks on a video (favourite, and generated / approved / discarded).
export function setVideoMark(ws: Workspace, projectId: string, video: string, change: { favourite?: boolean; status?: VideoMarkStatus }): { favourite: boolean; status: VideoMarkStatus } {
  const exportsRel = (() => {
    try {
      return songPathsById(ws, projectId).exportsRel;
    } catch {
      return null;
    }
  })();
  if (!exportsRel || video.includes("..") || !video.startsWith(`${exportsRel}/`) || !/\/v\d+\.manifest\.json$/.test(video)) throw new Error(`Not a video of this song: ${video}`);
  if (!existsSync(absPath(ws, video))) throw new Error(`Video not found: ${video}`);
  const current = ws.db.select().from(videoMark).where(eq(videoMark.video, video)).get();
  const next = { favourite: change.favourite ?? current?.favourite ?? false, status: change.status ?? current?.status ?? "generated" };
  if (current) ws.db.update(videoMark).set({ ...next, updated_at: new Date() }).where(eq(videoMark.id, current.id)).run();
  else ws.db.insert(videoMark).values({ project_id: projectId, video, ...next }).run();
  return next;
}

// The Post tab: the approved videos only (discarded / just generated left out), per platform in the
// order of the Videos tab, newest run first.
// "Ready to post — approve?": videos the app judged ✅ Ready to post with no point left, not yet approved or
// discarded by the user (newest first). They are only offered: approving stays the user's click.
export function readyToApprove(runs: readonly RunInfo[]): VideoInfo[] {
  const out: VideoInfo[] = [];
  for (const run of [...runs].reverse())
    for (const p of run.platforms) for (const v of p.videos) if (v.mark.status === "generated" && v.assessment.verdict === "ready" && !v.assessment.points.length) out.push(v);
  return out;
}

export function approvedVideos(runs: readonly RunInfo[]): { platform: string; label: string; videos: VideoInfo[] }[] {
  const groups = new Map<string, { platform: string; label: string; videos: VideoInfo[] }>();
  for (const run of [...runs].reverse()) {
    for (const p of run.platforms) {
      for (const v of p.videos) {
        if (v.mark.status !== "approved") continue;
        if (!groups.has(p.name)) groups.set(p.name, { platform: p.name, label: p.label, videos: [] });
        groups.get(p.name)!.videos.push(v);
      }
    }
  }
  return [...groups.values()];
}
