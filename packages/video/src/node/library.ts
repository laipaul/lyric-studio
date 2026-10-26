// The studio's Library (Step 6.1): song cards from the database and the folders "pnpm make" writes,
// the artists used so far, and "+ New song". No rendering code is imported here, so the studio's
// server can use it directly.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { parsePresets } from "../platform";
import { checkEffectChoice, choiceText, DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT, EFFECT_NAMES, type EffectChoice } from "../effects/names";
import { brandDir, brandDirFor, DEFAULT_ARTIST } from "./brand";
import { renderingPlatforms, SHORT_LABELS, songRuns, type PlatformRun } from "./exports";
import { readProjectSettings, rememberedCollection, storeCover, storeLyricsTxt, updateProjectSettings } from "./project-settings";
import { projectLyricsTxt } from "./runs";
import { findOrCreateSongProject, storeProjectHint } from "./song-project";

export type PlatformStatus = "PASS" | "WARN" | "FAILED" | "interrupted" | "Rendering" | "none";
export type PlatformCount = {
  name: string;
  label: string;
  videos: number; // finished, not discarded, in its latest run
  status: PlatformStatus;
  runs: number;
  details: string[]; // why WARN / FAILED / interrupted (per video, from its QA report)
  resumeCommand: string | null; // interrupted: the command that finishes the run
  resumeFolder: string | null; // interrupted: the run folder to resume (one click in the studio)
};
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

// Platform names and labels in the presets file's order.
export function platformLabels(file = path.join(REPO_ROOT, "presets", "platforms.json")): { name: string; label: string }[] {
  try {
    return Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).map((p) => ({ name: p.name, label: SHORT_LABELS[p.name] ?? p.label }));
  } catch {
    return Object.entries(SHORT_LABELS).map(([name, label]) => ({ name, label }));
  }
}

// One platform's state in a run: interrupted > FAILED > WARN > PASS, with the reasons.
export function platformState(pr: PlatformRun): { status: Exclude<PlatformStatus, "Rendering" | "none">; details: string[] } {
  const details: string[] = [];
  if (pr.interrupted) {
    details.push(pr.missing.length ? `${pr.missing.join(", ")} not finished: the run was stopped` : "the run was stopped before all videos were made");
    return { status: "interrupted", details };
  }
  if (pr.failed.length || pr.missing.length) {
    for (const e of pr.failed) details.push(`failed: ${e.split("\n")[0]}`);
    if (pr.missing.length) details.push(`${pr.missing.join(", ")} not finished`);
    return { status: "FAILED", details };
  }
  for (const v of pr.videos) for (const p of v.qa.problems) details.push(`${v.name}: ${p.check}${p.details.length ? ` (${p.details.join("; ")})` : ""}`);
  return { status: pr.videos.some((v) => v.qa.status === "WARN") ? "WARN" : "PASS", details };
}

export function songCard(ws: Workspace, p: typeof projectTable.$inferSelect, labels = platformLabels()): SongCard {
  const runs = songRuns(ws, p.id, Object.fromEntries(labels.map((l) => [l.name, l.label])));
  const rendering = renderingPlatforms(ws, p.id);
  const platforms = labels.map(({ name, label }): PlatformCount => {
    const withIt = runs.map((r) => ({ run: r, pr: r.platforms.find((x) => x.name === name) })).filter((x) => x.pr);
    const latest = withIt[withIt.length - 1];
    if (rendering.has(name)) return { name, label, videos: latest?.pr?.videos.length ?? 0, status: "Rendering", runs: withIt.length, details: ["rendering now"], resumeCommand: null, resumeFolder: null };
    if (!latest?.pr) return { name, label, videos: 0, status: "none", runs: 0, details: [], resumeCommand: null, resumeFolder: null };
    const state = platformState(latest.pr);
    return {
      name,
      label,
      videos: latest.pr.videos.filter((v) => v.mark.status !== "discarded").length,
      status: state.status,
      runs: withIt.length,
      details: state.details,
      resumeCommand: state.status === "interrupted" ? latest.run.resumeCommand : null,
      resumeFolder: state.status === "interrupted" ? latest.run.folder : null,
    };
  });
  const settings = readProjectSettings(ws, p.id);
  const last = runs[runs.length - 1];
  return {
    id: p.id,
    title: p.title,
    artist: p.artist,
    ep: settings.ep ?? null,
    cover: p.cover_path && existsSync(absPath(ws, p.cover_path)) ? p.cover_path : null,
    durationMs: p.duration_ms ?? null,
    createdAt: p.created_at.toISOString(),
    lastRun: last?.time ?? null,
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
  hintsName?: string; // the hints file's own name (the upload is saved under a temporary path)
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
    storeProjectHint(ws, id, input.hints, input.hintsName ? `${input.hintsName} (from "+ New song")` : undefined);
    updated.push("hints");
  }
  if (input.ep !== undefined && input.ep.trim() !== (readProjectSettings(ws, id).ep ?? "")) {
    updateProjectSettings(ws, id, { ep: input.ep.trim() || undefined });
    updated.push("ep");
  }
  return { id, created: sp.created, updated };
}

export type GeneratePanelData = {
  platforms: { name: string; label: string; variations: number; lyrics: boolean }[];
  collections: string[]; // folders in WORKSPACE_DIR\clips
  collection: string | null; // the one this song used last
  effects: string[];
  verseEffect: string; // the artist's brand defaults
  hookEffect: string;
  lyricsReady: boolean;
  title: string;
  artist: string;
  ep: string;
  artists: string[];
};

// What the song page's Generate panel offers, with this song's defaults.
export function generatePanelData(ws: Workspace, p: typeof projectTable.$inferSelect): GeneratePanelData {
  const file = path.join(REPO_ROOT, "presets", "platforms.json");
  const presets = Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).filter((x) => x.available);
  const clipsDir = absPath(ws, "clips");
  const collections = existsSync(clipsDir) ? readdirSync(clipsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => a.localeCompare(b)) : [];
  const remembered = rememberedCollection(ws, p.id);
  if (remembered && !collections.includes(remembered.name)) collections.unshift(remembered.name);
  const motion = brandMotion(ws.dir, p.artist);
  return {
    platforms: presets.map((x) => ({ name: x.name, label: SHORT_LABELS[x.name] ?? x.label, variations: x.variations, lyrics: x.lyrics })),
    collections,
    collection: remembered?.name ?? null,
    effects: [...EFFECT_NAMES],
    verseEffect: choiceText(motion.verseEffect),
    hookEffect: choiceText(motion.hookEffect),
    lyricsReady: !!projectLyricsTxt(ws, p.id),
    title: p.title,
    artist: p.artist,
    ep: readProjectSettings(ws, p.id).ep ?? "",
    artists: knownArtists(ws),
  };
}

// The artist's motion defaults from brand.json (read directly; a broken file falls back to the defaults).
function brandMotion(workspaceDir: string, artist: string): { verseEffect: EffectChoice; hookEffect: EffectChoice } {
  const fallback = { verseEffect: DEFAULT_VERSE_EFFECT, hookEffect: DEFAULT_HOOK_EFFECT };
  try {
    const raw = JSON.parse(readFileSync(path.join(brandDirFor(workspaceDir, artist), "brand.json"), "utf8")) as { motion?: Record<string, unknown> };
    return {
      verseEffect: raw.motion?.verseEffect ? checkEffectChoice(raw.motion.verseEffect, "verse") : fallback.verseEffect,
      hookEffect: raw.motion?.hookEffect ? checkEffectChoice(raw.motion.hookEffect, "hook") : fallback.hookEffect,
    };
  } catch {
    return fallback;
  }
}
