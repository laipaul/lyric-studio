// Releases (Step "Releases + Make all"): a group of songs put out together (an EP, a batch). Each release is
// a small file workspace\releases\<name>.json { name, songs: [song ids], createdAt }; songs are only
// referenced, never moved or changed. Removing a release moves its file to releases\_removed\ (Restore).
// The release grid (songs x platforms, the Library's colours) and "Make all" (one video for every missing
// platform of every song, queued for the worker) are built here. No rendering code is imported.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, makeRun, project as projectTable, safeName, type Workspace } from "@lyric/db";

import { chipState, type ChipState } from "../library-status";
import { platformLabels, songCard, type SongCard } from "./library";
import { songEp } from "./project-settings";
import { enqueueRun, generateOptions } from "./runs";
import { RELEASE_PLATFORMS, songTodo } from "./song-stages";

export const RELEASES_DIR = "releases";
const REMOVED = "_removed";

export type Release = { name: string; songs: string[]; createdAt: string };
export type ReleaseCell = { platform: string; state: ChipState | "unused"; videos: number; approved: number };
export type ReleaseRow = { id: string; title: string; cover: string | null; cells: ReleaseCell[] };
export type ReleaseView = Release & {
  platforms: { name: string; label: string }[]; // the grid's columns: every platform a song of the release uses
  rows: ReleaseRow[];
  missingSongs: string[]; // ids no longer in the Library
  ready: number; // cells approved
  total: number; // cells the songs use
  cover: string | null; // the first song's cover
};

const dir = (ws: Workspace) => absPath(ws, RELEASES_DIR);
const fileOf = (ws: Workspace, name: string) => path.join(dir(ws), `${name}.json`);

function cleanName(name: string): string {
  const clean = safeName(name.trim());
  if (!name.trim() || !clean || clean.startsWith(".") || clean === REMOVED) throw new Error("Give the release a name (e.g. the EP's title).");
  return clean;
}

function read(file: string): Release | null {
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as Partial<Release>;
    return { name: String(r.name ?? path.basename(file, ".json")), songs: Array.isArray(r.songs) ? r.songs.map(String) : [], createdAt: String(r.createdAt ?? "") };
  } catch {
    return null;
  }
}
const write = (ws: Workspace, r: Release) => {
  mkdirSync(dir(ws), { recursive: true });
  writeFileSync(fileOf(ws, r.name), `${JSON.stringify(r, null, 2)}\n`);
};

export function listReleases(ws: Workspace): Release[] {
  if (!existsSync(dir(ws))) return [];
  return readdirSync(dir(ws))
    .filter((f) => f.endsWith(".json"))
    .map((f) => read(path.join(dir(ws), f)))
    .filter((r): r is Release => !!r)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRelease(ws: Workspace, name: string): Release {
  const r = existsSync(fileOf(ws, name)) ? read(fileOf(ws, name)) : null;
  if (!r) throw new Error(`No release "${name}".`);
  return r;
}

const knownIds = (ws: Workspace) => new Set(ws.db.select({ id: projectTable.id }).from(projectTable).all().map((p) => p.id));

export function createRelease(ws: Workspace, name: string, songs: string[], now = new Date()): Release {
  const clean = cleanName(name);
  if (listReleases(ws).some((r) => r.name.toLowerCase() === clean.toLowerCase())) throw new Error(`A release "${clean}" already exists.`);
  const ids = knownIds(ws);
  const r: Release = { name: clean, songs: [...new Set(songs)].filter((s) => ids.has(s)), createdAt: now.toISOString() };
  write(ws, r);
  return r;
}

// Rename and / or a new song list (in the order given).
export function updateRelease(ws: Workspace, name: string, change: { name?: string; songs?: string[] }): Release {
  const r = getRelease(ws, name);
  let next: Release = { ...r };
  if (change.songs) {
    const ids = knownIds(ws);
    next.songs = [...new Set(change.songs)].filter((s) => ids.has(s));
  }
  if (change.name !== undefined && change.name.trim() !== r.name) {
    const clean = cleanName(change.name);
    if (listReleases(ws).some((x) => x.name !== r.name && x.name.toLowerCase() === clean.toLowerCase())) throw new Error(`A release "${clean}" already exists.`);
    const from = fileOf(ws, r.name);
    const to = fileOf(ws, clean);
    if (from.toLowerCase() === to.toLowerCase()) {
      // A change of case only (the same file on Windows): rename through a temporary name.
      renameSync(from, `${from}.renaming`);
      renameSync(`${from}.renaming`, to);
    } else {
      // The old file is kept in _removed\ (nothing is ever deleted).
      mkdirSync(path.join(dir(ws), REMOVED), { recursive: true });
      renameSync(from, path.join(dir(ws), REMOVED, `${r.name} (renamed ${stamp()}).json`));
    }
    next = { ...next, name: clean };
  }
  write(ws, next);
  return next;
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// "Delete": the file moves to releases\_removed\ (the songs and their videos are not touched).
export function removeRelease(ws: Workspace, name: string): string {
  getRelease(ws, name);
  const to = path.join(dir(ws), REMOVED, `${name} (removed ${stamp()}).json`);
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(fileOf(ws, name), to);
  return path.relative(ws.dir, to).split(path.sep).join("/");
}

export function removedReleases(ws: Workspace): { file: string; name: string }[] {
  const d = path.join(dir(ws), REMOVED);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => / \(removed [^)]+\)\.json$/.test(f))
    .map((f) => ({ file: f, name: f.replace(/ \(removed [^)]+\)\.json$/, "") }));
}

export function restoreRelease(ws: Workspace, file: string): string {
  const from = path.join(dir(ws), REMOVED, path.basename(file));
  const r = existsSync(from) ? read(from) : null;
  if (!r) throw new Error(`No removed release "${file}".`);
  const taken = new Set(listReleases(ws).map((x) => x.name.toLowerCase()));
  let name = r.name;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${r.name} (${n})`;
  write(ws, { ...r, name });
  renameSync(from, `${from}.restored`);
  return name;
}

// The songs offered for a new release, with their EP (songs sharing an EP are pre-ticked together).
export function releaseCandidates(ws: Workspace): { id: string; title: string; artist: string; ep: string | null; cover: string | null }[] {
  return ws.db
    .select()
    .from(projectTable)
    .all()
    .map((p) => ({ id: p.id, title: p.title, artist: p.artist, ep: songEp(ws, p.id) ?? null, cover: p.cover_path }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// A song's platforms in a release: its own (song.json), else every platform you post to.
const usedBy = (card: SongCard) => card.wanted ?? RELEASE_PLATFORMS;

export function releaseView(ws: Workspace, name: string): ReleaseView {
  const r = getRelease(ws, name);
  const labels = platformLabels();
  const byId = new Map(ws.db.select().from(projectTable).all().map((p) => [p.id, p]));
  const cards = r.songs.flatMap((id) => (byId.has(id) ? [songCard(ws, byId.get(id)!, labels)] : []));
  const used = new Set(cards.flatMap((c) => usedBy(c)));
  const platforms = labels.filter((l) => used.has(l.name));
  let ready = 0;
  let total = 0;
  const rows: ReleaseRow[] = cards.map((c) => ({
    id: c.id,
    title: c.title,
    cover: c.cover,
    cells: platforms.map((pl) => {
      const p = c.platforms.find((x) => x.name === pl.name)!;
      if (!usedBy(c).includes(pl.name)) return { platform: pl.name, state: "unused", videos: 0, approved: 0 };
      const state = chipState(p);
      total += 1;
      if (state === "ready") ready += 1;
      return { platform: pl.name, state, videos: p.videos, approved: p.approved };
    }),
  }));
  return { ...r, platforms, rows, missingSongs: r.songs.filter((id) => !byId.has(id)), ready, total, cover: cards.find((c) => c.cover)?.cover ?? null };
}

// ---- Make all ---------------------------------------------------------------------------------------

export type MakeAllPlan = {
  songs: { id: string; title: string; platforms: { name: string; label: string }[] }[]; // what will be queued
  skipped: { id: string; title: string; why: string }[]; // songs that cannot be made yet
  videos: number;
  estimateS: number; // from the past renders on this PC (else a default)
  estimateFrom: "history" | "default";
};

// What is missing: a used platform with nothing kept yet, or whose last run failed / was stopped. Videos
// waiting for review, approved or rendering are never made again.
const MISSING: (ChipState | "unused")[] = ["none", "error", "stopped"];

// Seconds per "unit" of render: a YouTube video (the whole song) counts 3 units, every other video 1.
export const YOUTUBE_UNITS = 3;
export const DEFAULT_UNIT_S = 240;
const units = (platform: string) => (platform === "youtube" ? YOUTUBE_UNITS : 1);

export function renderSecondsPerUnit(ws: Workspace): { seconds: number; from: "history" | "default" } {
  let time = 0;
  let count = 0;
  for (const r of ws.db.select().from(makeRun).all()) {
    if (r.status !== "done" || !r.started_at || !r.finished_at || !r.states_json?.length) continue;
    const done = r.states_json.filter((s) => s.status === "done");
    if (!done.length) continue;
    time += (r.finished_at.getTime() - r.started_at.getTime()) / 1000;
    count += done.reduce((n, s) => n + units(s.platform), 0);
  }
  return count >= 2 && time > 0 ? { seconds: Math.round(time / count), from: "history" } : { seconds: DEFAULT_UNIT_S, from: "default" };
}

export async function makeAllPlan(ws: Workspace, name: string): Promise<MakeAllPlan> {
  const view = releaseView(ws, name);
  const plan: MakeAllPlan = { songs: [], skipped: [], videos: 0, estimateS: 0, estimateFrom: "default" };
  const labels = Object.fromEntries(view.platforms.map((p) => [p.name, p.label]));
  let u = 0;
  for (const row of view.rows) {
    const missing = row.cells.filter((c) => MISSING.includes(c.state)).map((c) => ({ name: c.platform, label: labels[c.platform] ?? c.platform }));
    if (!missing.length) continue;
    const blocking = (await songTodo(ws, row.id)).find((t) => t.blocking);
    if (blocking) {
      plan.skipped.push({ id: row.id, title: row.title, why: blocking.text });
      continue;
    }
    plan.songs.push({ id: row.id, title: row.title, platforms: missing });
    plan.videos += missing.length;
    u += missing.reduce((n, p) => n + units(p.name), 0);
  }
  const rate = renderSecondsPerUnit(ws);
  plan.estimateS = u * rate.seconds;
  plan.estimateFrom = rate.from;
  return plan;
}

// Queues the plan: one run per song (its missing platforms, one video each, its own recipe and clips).
export async function makeAll(ws: Workspace, name: string): Promise<{ queued: { id: string; title: string; label: string }[]; plan: MakeAllPlan }> {
  const plan = await makeAllPlan(ws, name);
  const queued: { id: string; title: string; label: string }[] = [];
  for (const s of plan.songs) {
    const run = enqueueRun(ws, s.id, generateOptions(ws, s.id, { platforms: s.platforms.map((p) => p.name), variations: 1 }));
    queued.push({ id: s.id, title: s.title, label: run.label });
  }
  return { queued, plan };
}
