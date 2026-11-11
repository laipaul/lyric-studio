// "Would this make a video the song already has?" Before a run or a take is queued, plan it (a dry plan, no render) and
// compare it with the videos the song already has for that platform: the same shots, cuts, clips, parts of the clips,
// look and lyric timing (the props a render would get, against the props in the made videos' manifests). A video that
// would be identical is reported, saying which creative change would help, instead of rendering a duplicate.
//   takeProblem: "Make another" (one take of a platform).   duplicateProblem: a normal Make run ("Make N videos").
// A check that cannot run (no plan could be made) says nothing: the run itself tells what is wrong.
import { existsSync, readFileSync } from "node:fs";

import { absPath, type Workspace } from "@lyric/db";

import { videoTitle } from "../video-names";
import { SHORT_LABELS, songRuns, type VideoInfo } from "./exports";
import { makeVideos, type PlatformResult } from "./make";
import type { Manifest } from "./manifest";
import { generateOptions, type RunRequest } from "./runs";
import { songPathsById } from "./song-folder";
import { propsMakeWouldRender } from "./storyboard";
import { readVersions } from "./versions";

// The takes (variations v2, v3, ... = the numbers in the files' names, not the song-wide version names) of a platform
// that are made already and not discarded; "Try other looks" videos are not takes.
export function existingTakes(ws: Workspace, projectId: string, platform: string): number[] {
  const found = new Set<number>();
  for (const run of songRuns(ws, projectId)) {
    for (const p of run.platforms.filter((x) => x.name === platform)) {
      for (const v of p.videos) {
        if (!v.try && v.mark.status !== "discarded") found.add(v.index);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

// Key order and the cover's slow sideways drift (a seeded few percent) are not visible differences between two videos.
function canon(value: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, walk(v)]));
    return x;
  };
  const props = JSON.parse(JSON.stringify(value)) as { cover?: { drift?: unknown } | null };
  if (props.cover) props.cover = { ...props.cover, drift: undefined };
  return JSON.stringify(walk(props));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : ` (made ${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")})`;
};

// The videos of a platform that are not discarded, by what they look like (their manifests' props).
function madeLooks(ws: Workspace, projectId: string, platform: string): Map<string, VideoInfo> {
  const out = new Map<string, VideoInfo>();
  for (const run of songRuns(ws, projectId))
    for (const p of run.platforms.filter((x) => x.name === platform))
      for (const v of p.videos) {
        if (v.mark.status === "discarded") continue;
        try {
          const m = JSON.parse(readFileSync(absPath(ws, v.id), "utf8")) as Manifest;
          if (m.props && !out.has(canon(m.props))) out.set(canon(m.props), v);
        } catch {
          /* a manifest that cannot be read is not compared */
        }
      }
  return out;
}

// The number the next video of a platform gets as its version name (versions.ts): "v4" is 4.
const nextVersion = (ws: Workspace, projectId: string, platform: string) => Math.max(0, ...Object.values(readVersions(songPathsById(ws, projectId).root)[platform] ?? {})) + 1;

async function plan(ws: Workspace, projectId: string, extra: Record<string, unknown>) {
  const paths = songPathsById(ws, projectId);
  if (!paths.audio || !existsSync(paths.audio) || !existsSync(paths.lyricsTxt)) return null;
  return makeVideos({ workspaceDir: ws.dir, song: paths.audio, lyrics: paths.lyricsTxt, ...(paths.hints && existsSync(paths.hints) ? { hint: paths.hints } : {}), dryRun: true, frameCheck: false, log: () => {}, ...extra });
}

// The planned videos of a platform that would be the same as a video already made.
async function repeats(ws: Workspace, projectId: string, p: PlatformResult): Promise<{ position: number; of: VideoInfo; cover: boolean }[]> {
  if (!p.plan || p.error) return [];
  const made = madeLooks(ws, projectId, p.name);
  if (!made.size) return [];
  const out: { position: number; of: VideoInfo; cover: boolean }[] = [];
  for (const [position, v] of p.plan.videos.entries()) {
    const props = await propsMakeWouldRender(ws, projectId, p, p.plan, v);
    const same = made.get(canon(props));
    if (same) out.push({ position, of: same, cover: (props as { layout?: string }).layout === "cover" });
  }
  return out;
}

const labelOf = (name: string, label: string) => SHORT_LABELS[name] ?? label;

// null: the take is fine (or cannot be compared: then Make says what is wrong itself). Else the message for the user.
export async function takeProblem(ws: Workspace, projectId: string, platform: string, take: number): Promise<string | null> {
  if (take < 2) return null;
  if (!existingTakes(ws, projectId, platform).length) return null;
  try {
    const result = await plan(ws, projectId, { platforms: platform, takes: [take] });
    const p = result?.platforms[0];
    if (!p) return null;
    const [same] = await repeats(ws, projectId, p);
    if (!same) return null;
    const hint = same.cover
      ? "choose another look (Shape → Look bar → Change) or another cover picture"
      : "choose another look (Shape → Look bar → Change), add another clip or photo, or set a clip's best moment or length in Shape";
    const label = labelOf(p.name, p.label);
    return `${label} v${nextVersion(ws, projectId, p.name)} would be identical to ${videoTitle({ ...same.of, label }, true).title}${when(same.of.createdAt)}: change a setting in Shape first (e.g. ${hint}).`;
  } catch {
    return null; // the plan could not be made: the run itself says why
  }
}

// A normal Make run ("Make N videos", "One of each", the play button of a platform): null, or the message when a video
// of it would be identical to one the song already has. Compare looks, takes, pictures, fonts and "Make anyway" are not checked.
export async function duplicateProblem(ws: Workspace, projectId: string, req: RunRequest): Promise<string | null> {
  if (req.force || req.take || req.compare || req.themes?.length || req.pictures?.length || req.pairings?.length || req.theme) return null;
  try {
    const platforms = req.platforms.filter((n) => n !== "canvas" && madeLooks(ws, projectId, n).size > 0);
    if (!platforms.length) return null;
    const options = generateOptions(ws, projectId, { ...req, platforms });
    const result = await plan(ws, projectId, { ...options, platforms: platforms.join(",") });
    const found: string[] = [];
    for (const p of result?.platforms ?? []) {
      const first = nextVersion(ws, projectId, p.name);
      const [same] = await repeats(ws, projectId, p);
      if (!same) continue;
      const label = labelOf(p.name, p.label);
      found.push(`${label} v${first + same.position} would be identical to ${videoTitle({ ...same.of, label }, true).title}${when(same.of.createdAt)}`);
    }
    return found.length ? `${found.join("; ")}: change a setting in Shape first, or press Make anyway.` : null;
  } catch {
    return null; // a check that cannot run lets the run through
  }
}
