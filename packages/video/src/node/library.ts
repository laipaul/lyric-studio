// The studio's Library (Step 6.1): song cards from the database and the folders "pnpm make" writes,
// the artists used so far, and "+ New song". No rendering code is imported here, so the studio's
// server can use it directly.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, project as projectTable, renderJob, variation, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { parsePresets } from "../platform";
import { brandDir, DEFAULT_ARTIST } from "./brand";
import { readProjectSettings, storeCover, storeLyricsTxt, updateProjectSettings } from "./project-settings";
import { findOrCreateSongProject, storeProjectHint } from "./song-project";

export type PlatformStatus = "PASS" | "WARN" | "FAILED" | "Rendering" | "none";
export type PlatformCount = { name: string; label: string; videos: number; status: PlatformStatus; runs: number };
export type SongCard = {
  id: string;
  title: string;
  artist: string;
  ep: string | null;
  cover: string | null; // workspace-relative
  durationMs: number | null;
  createdAt: string;
  lastRun: string | null; // the newest export folder's time
  hasLyrics: boolean;
  platforms: PlatformCount[];
};

const SHORT_LABELS: Record<string, string> = { standard: "Standard", reels: "Reels", tiktok: "TikTok", shorts: "Shorts", youtube: "YouTube", canvas: "Canvas" };
const RUN_FOLDER = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(-\d+)?$/;

// Platform names and labels in the presets file's order.
export function platformLabels(file = path.join(REPO_ROOT, "presets", "platforms.json")): { name: string; label: string }[] {
  try {
    return Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).map((p) => ({ name: p.name, label: SHORT_LABELS[p.name] ?? p.label }));
  } catch {
    return Object.entries(SHORT_LABELS).map(([name, label]) => ({ name, label }));
  }
}

const runTime = (name: string) => {
  const m = RUN_FOLDER.exec(name);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
};

// "Summary: PASS" / "Summary: WARN - ..." in a vN.qa.txt.
function qaStatus(file: string): "PASS" | "WARN" | null {
  try {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("Summary: ")) ?? "";
    return line.includes("PASS") ? "PASS" : line.includes("WARN") ? "WARN" : null;
  } catch {
    return null;
  }
}

// The videos of one platform in one run folder: vN.mp4 with its manifest and QA report.
function platformVideos(dir: string): { done: number; warn: boolean; incomplete: boolean } | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const names = new Set(files.filter((f) => /^v\d+\.(mp4|manifest\.json|qa\.txt)$/.test(f)).map((f) => f.split(".")[0]));
  if (!names.size) return null;
  let done = 0;
  let warn = false;
  let incomplete = false;
  for (const n of names) {
    const ok = ["mp4", "manifest.json", "qa.txt"].every((ext) => files.includes(`${n}.${ext}`));
    if (!ok) {
      incomplete = true;
      continue;
    }
    done++;
    if (qaStatus(path.join(dir, `${n}.qa.txt`)) === "WARN") warn = true;
  }
  return { done, warn, incomplete };
}

export function songCard(ws: Workspace, p: typeof projectTable.$inferSelect, labels = platformLabels()): SongCard {
  const exportsDir = absPath(ws, `projects/${p.id}/exports`);
  const runs = existsSync(exportsDir)
    ? readdirSync(exportsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && RUN_FOLDER.test(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  // Render jobs still queued or rendering, and failed ones, per platform.
  const jobs = ws.db
    .select({ status: renderJob.status, started: renderJob.started_at, overrides: variation.overrides_json })
    .from(renderJob)
    .innerJoin(variation, eq(renderJob.variation_id, variation.id))
    .where(eq(variation.project_id, p.id))
    .all();
  const jobsFor = (name: string) => jobs.filter((j) => (j.overrides?.platform ?? "standard") === name);

  const platforms = labels.map(({ name, label }): PlatformCount => {
    // The latest run that made this platform ("standard" lives directly in the run folder).
    let latest: { run: string; videos: NonNullable<ReturnType<typeof platformVideos>> } | null = null;
    let count = 0;
    for (const run of runs) {
      const v = platformVideos(name === "standard" ? path.join(exportsDir, run) : path.join(exportsDir, run, name));
      if (v) {
        count++;
        latest = { run, videos: v };
      }
    }
    const pending = jobsFor(name).some((j) => j.status === "queued" || j.status === "rendering");
    let status: PlatformStatus = "none";
    if (latest) {
      const since = runTime(latest.run);
      const failed = latest.videos.incomplete || jobsFor(name).some((j) => j.status === "failed" && (!since || !j.started || j.started >= since));
      status = failed ? "FAILED" : latest.videos.warn ? "WARN" : "PASS";
    }
    if (pending) status = "Rendering";
    return { name, label, videos: latest?.videos.done ?? 0, status, runs: count };
  });

  const settings = readProjectSettings(ws, p.id);
  const lastRun = runs.length ? runTime(runs[runs.length - 1]) : null;
  return {
    id: p.id,
    title: p.title,
    artist: p.artist,
    ep: settings.ep ?? null,
    cover: p.cover_path && existsSync(absPath(ws, p.cover_path)) ? p.cover_path : null,
    durationMs: p.duration_ms ?? null,
    createdAt: p.created_at.toISOString(),
    lastRun: lastRun?.toISOString() ?? null,
    hasLyrics: !!settings.lyricsTxt || existsSync(absPath(ws, `projects/${p.id}/lyrics`)),
    platforms,
  };
}

// Every song, the most recently worked on first.
export function listSongs(ws: Workspace): SongCard[] {
  const labels = platformLabels();
  return ws.db
    .select()
    .from(projectTable)
    .all()
    .map((p) => songCard(ws, p, labels))
    .sort((a, b) => (b.lastRun ?? b.createdAt).localeCompare(a.lastRun ?? a.createdAt));
}

// Artists for the dropdown: Life Lyrics first, then the ones used on songs and the ones with their
// own brand folder (brand\<artist>\brand.json), alphabetically.
export function knownArtists(ws: Workspace): string[] {
  const names = new Set(ws.db.select({ artist: projectTable.artist }).from(projectTable).all().map((r) => r.artist.trim()).filter(Boolean));
  const brands = brandDir(ws.dir);
  if (existsSync(brands)) {
    for (const d of readdirSync(brands, { withFileTypes: true })) if (d.isDirectory() && existsSync(path.join(brands, d.name, "brand.json"))) names.add(d.name);
  }
  names.delete(DEFAULT_ARTIST);
  return [DEFAULT_ARTIST, ...[...names].sort((a, b) => a.localeCompare(b))];
}

export type NewSongInput = {
  song: string; // files on disk, with their original names (the title defaults to the song's name)
  lyrics: string;
  cover?: string;
  hints?: string;
  title?: string;
  artist?: string;
  ep?: string;
};

// Checks the files before anything is stored; every problem is named.
export function checkNewSong(input: NewSongInput): string[] {
  const problems: string[] = [];
  const ext = (f: string) => path.extname(f).toLowerCase();
  if (!input.song) problems.push("Choose the song (WAV or MP3).");
  else if (![".wav", ".mp3"].includes(ext(input.song))) problems.push(`The song must be a WAV or MP3 file (got ${path.basename(input.song)}).`);
  if (!input.lyrics) problems.push("Choose the lyrics (lyrics.txt).");
  else if (ext(input.lyrics) !== ".txt") problems.push(`The lyrics must be a .txt file (got ${path.basename(input.lyrics)}).`);
  else if (!readFileSync(input.lyrics, "utf8").split(/\r?\n/).some((l) => l.replace(/^\*\s+/, "").trim())) problems.push("The lyrics file is empty.");
  if (input.cover && ![".jpg", ".jpeg", ".png", ".webp"].includes(ext(input.cover))) problems.push(`The cover must be a JPG, PNG or WEBP picture (got ${path.basename(input.cover)}).`);
  if (input.hints) {
    if (ext(input.hints) !== ".lrc") problems.push(`The hints must be an .lrc file of tapped times (got ${path.basename(input.hints)}).`);
    else if (!/\[\d+:\d{1,2}(\.\d+)?\]/.test(readFileSync(input.hints, "utf8"))) problems.push("The hints file has no time stamps like [00:12.34].");
  }
  if (input.title !== undefined && input.title.length > 200) problems.push("The title is too long.");
  return problems;
}

// "+ New song": creates the project (or finds it by the song's content: no duplicates) and stores
// the lyrics, cover, hints, title, artist and EP with it.
export async function createSong(ws: Workspace, input: NewSongInput): Promise<{ id: string; created: boolean; updated: string[] }> {
  const problems = checkNewSong(input);
  if (problems.length) throw new Error(problems.join("\n"));
  const sp = await findOrCreateSongProject(ws, input.song);
  const id = sp.project.id;
  const updated: string[] = [];
  const title = input.title?.trim();
  const artist = input.artist?.trim() || (sp.created ? DEFAULT_ARTIST : undefined);
  const changes: Partial<typeof projectTable.$inferInsert> = {};
  if (title && title !== sp.project.title) changes.title = title;
  if (artist && artist !== sp.project.artist) changes.artist = artist;
  if (Object.keys(changes).length) {
    ws.db.update(projectTable).set(changes).where(eq(projectTable.id, id)).run();
    updated.push(...Object.keys(changes));
  }
  storeLyricsTxt(ws, id, input.lyrics);
  updated.push("lyrics");
  if (input.cover) {
    storeCover(ws, id, input.cover);
    updated.push("cover");
  }
  if (input.hints) {
    storeProjectHint(ws, id, input.hints);
    updated.push("hints");
  }
  if (input.ep !== undefined && input.ep.trim() !== (readProjectSettings(ws, id).ep ?? "")) {
    updateProjectSettings(ws, id, { ep: input.ep.trim() || undefined });
    updated.push("ep");
  }
  return { id, created: sp.created, updated };
}
