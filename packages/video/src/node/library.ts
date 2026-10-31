// The studio's Library (Step 6.1): song cards from the database and the folders "pnpm make" writes,
// the artists used so far, and "+ New song". No rendering code is imported here, so the studio's
// server can use it directly.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, project as projectTable, safeName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { parsePresets } from "../platform";
import { EFFECT_NAMES, effectOptionLabel } from "../effects/names";
import { brandDir, DEFAULT_ARTIST, loadBrand } from "./brand";
import { loadFontCatalog } from "./font-catalog";
import { loadPairings } from "./pairings";
import { renderingPlatforms, SHORT_LABELS, songRuns, type PlatformRun } from "./exports";
import { keepReplaced, setSongEp, songCollections, songEp, storeCover, storeLyricsTxt } from "./project-settings";
import { projectLyricsTxt } from "./runs";
import { SOURCE_FILE } from "./collection";
import { readRecipe, resolveRecipe, writeRecipe } from "./recipe";
import { isRemovedSong, moveEntry, relocatePaths, removeEmptyDirs, REMOVED_SONGS, renameSongFolder, sharedCollections, songBusy, songFolderFor, songPathsById, SONGS_DIR } from "./song-folder";
import { presetLengthText, recipeInputFor } from "./style";
import { ensureAllThemes } from "./themes";
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
  approved: number; // approved videos of this platform, in any run (Step H: the chip is green)
};
export type SongCard = {
  id: string;
  title: string;
  artist: string;
  ep: string | null;
  theme: string | null; // the song's theme (song.json "theme")
  cover: string | null; // workspace-relative
  durationMs: number | null;
  createdAt: string;
  lastRun: string | null; // the newest export folder's time
  hasLyrics: boolean;
  platforms: PlatformCount[];
  sameCover: string[]; // other songs whose cover is the very same picture (by content)
  wanted: string[] | null; // the song's own platforms (song.json "platforms"); null: all of them
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
    const approved = withIt.reduce((n, x) => n + (x.pr?.videos.filter((v) => v.mark.status === "approved").length ?? 0), 0);
    if (rendering.has(name)) return { name, label, videos: latest?.pr?.videos.length ?? 0, status: "Rendering", runs: withIt.length, details: ["rendering now"], resumeCommand: null, resumeFolder: null, approved };
    if (!latest?.pr) return { name, label, videos: 0, status: "none", runs: 0, details: [], resumeCommand: null, resumeFolder: null, approved };
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
      approved,
    };
  });
  const last = runs[runs.length - 1];
  return {
    id: p.id,
    title: p.title,
    artist: p.artist,
    ep: songEp(ws, p.id) ?? null,
    theme: songTheme(ws, p.id),
    cover: p.cover_path && existsSync(absPath(ws, p.cover_path)) ? p.cover_path : null,
    durationMs: p.duration_ms ?? null,
    createdAt: p.created_at.toISOString(),
    lastRun: last?.time ?? null,
    hasLyrics: !!projectLyricsTxt(ws, p.id),
    platforms,
    sameCover: [],
    wanted: songPlatforms(ws, p.id),
  };
}

function songTheme(ws: Workspace, projectId: string): string | null {
  try {
    return readRecipe(songPathsById(ws, projectId).recipe).theme ?? null;
  } catch {
    return null;
  }
}

// The song's own platforms: song.json "platforms" (set in the Style tab), else null (= all of them).
export function songPlatforms(ws: Workspace, projectId: string): string[] | null {
  try {
    const list = readRecipe(songPathsById(ws, projectId).recipe).platforms;
    return list?.length ? list : null;
  } catch {
    return null;
  }
}

// A cover's content (covers are small pictures; read once per listing).
function coverKey(ws: Workspace, cover: string | null): string | null {
  if (!cover) return null;
  try {
    return createHash("sha1").update(readFileSync(absPath(ws, cover))).digest("hex");
  } catch {
    return null;
  }
}

// Every song, the most recently worked on first.
export function listSongs(ws: Workspace): SongCard[] {
  const labels = platformLabels();
  try {
    ensureAllThemes(ws, loadFontCatalog(ws.dir)); // every song on a theme, so each card can name it
  } catch {
    // a theme problem is named on the song's page
  }
  const cards = ws.db
    .select()
    .from(projectTable)
    .all()
    .filter((p) => !isRemovedSong(p.folder))
    .map((p) => songCard(ws, p, labels))
    .sort((a, b) => (b.lastRun ?? b.createdAt).localeCompare(a.lastRun ?? a.createdAt));
  // Two songs with the very same cover look alike in the Library: each card names the others.
  const byCover = new Map<string, SongCard[]>();
  for (const c of cards) {
    const key = coverKey(ws, c.cover);
    if (key) byCover.set(key, [...(byCover.get(key) ?? []), c]);
  }
  for (const group of byCover.values()) for (const c of group) c.sameCover = group.filter((o) => o !== c).map((o) => o.title);
  return cards;
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
  lyrics: string; // lyrics.txt; an instrumental: its story.txt (optional: "" = no words on screen)
  instrumental?: boolean; // no sung lyrics (song.json "instrumental": true)
  cover?: string;
  hints?: string;
  hintsName?: string; // the hints file's own name (the upload is saved under a temporary path)
  lyricsName?: string; // the lyrics file's own name: it keeps it in the song folder (linked as the lyrics)
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
  if (input.instrumental) {
    if (input.lyrics && ext(input.lyrics) !== ".txt") problems.push(`The story must be a .txt file (got ${path.basename(input.lyrics)}).`);
  } else if (!input.lyrics) problems.push("Choose the lyrics (lyrics.txt), or tick Instrumental.");
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
    renameSongFolder(ws, id); // songs\<artist>\<title>\ follows the new names
  }
  // Instrumental or not: song.json first, so the text goes to story.txt or lyrics.txt.
  const recipeFile = songPathsById(ws, id).recipe;
  if (recipeFile) {
    const recipe = readRecipe(recipeFile);
    if (!!input.instrumental !== !!recipe.instrumental) {
      const next = { ...recipe };
      if (input.instrumental) next.instrumental = true;
      else delete next.instrumental;
      writeRecipe(recipeFile, next);
      updated.push("instrumental");
    }
  }
  const paths = songPathsById(ws, id);
  if (input.lyrics) {
    storeLyricsTxt(ws, id, input.lyrics, input.lyricsName);
    updated.push(paths.instrumental ? "story" : "lyrics");
  } else if (paths.instrumental && !existsSync(paths.lyricsTxt)) {
    writeFileSync(paths.lyricsTxt, ""); // an empty story.txt: music only (add sentences any time)
  }
  if (input.cover) {
    storeCover(ws, id, input.cover);
    updated.push("cover");
  }
  if (input.hints) {
    const paths = songPathsById(ws, id);
    if (paths.hints && path.resolve(input.hints) !== path.resolve(paths.hints)) {
      // The song folder's hints.lrc (a different earlier one is kept in .studio\replaced\).
      if (existsSync(paths.hints) && readFileSync(paths.hints, "utf8") !== readFileSync(input.hints, "utf8")) keepReplaced(paths.root, paths.hints);
      copyFileSync(input.hints, paths.hints);
    }
    storeProjectHint(ws, id, input.hints, input.hintsName ? `${input.hintsName} (from "+ New song")` : undefined);
    updated.push("hints");
  }
  if (input.ep !== undefined && input.ep.trim() !== (songEp(ws, id) ?? "")) {
    setSongEp(ws, id, input.ep.trim() || undefined);
    updated.push("ep");
  }
  return { id, created: sp.created, updated };
}

export type GeneratePanelData = {
  platforms: { name: string; label: string; variations: number; lyrics: boolean }[];
  collections: string[]; // shared collections: folders in WORKSPACE_DIR\collections (and the old clips\)
  chosen: string[]; // the ones this song uses (song.json, else the one it used last)
  songClips: number; // videos and photos in the song folder's own clips\
  effects: { name: string; label: string }[]; // label: "glide · verses"
  verseEffect: string; // the recipe's default (song.json, else the artist's brand)
  hookEffect: string;
  // Where Generate starts (Step 6.2c-2a): the song's recipe with each value's source, the per-platform
  // effects, and the locked settings (a run cannot change them).
  recipe: {
    platforms: string[];
    variations: Record<string, number>;
    section: string;
    youtubeLayout: string;
    shotLength: string | null; // bars per shot or "story" (null: the cut rate)
    shotLengths: Record<string, string | null>; // per platform
    locked: string[];
    sources: Record<string, string>;
    effects: Record<string, { verse: string; hook: string }>; // per platform, when it differs from the default
    lengths: Record<string, number | null>; // target length of an auto section per platform (null: the preset's)
    presetLengths: Record<string, string>; // "30 s", "whole song", ...
    brandDefaults: { verseEffect: string; hookEffect: string };
  };
  lyricsReady: boolean;
  pairings: { id: string; name: string; note: string }[]; // "Compare pairings": one video per pairing
  title: string;
  artist: string;
  ep: string;
  artists: string[];
};

// What the song page's Generate panel offers, with this song's defaults.
export function generatePanelData(ws: Workspace, p: typeof projectTable.$inferSelect): GeneratePanelData {
  const file = path.join(REPO_ROOT, "presets", "platforms.json");
  const presets = Object.values(parsePresets(JSON.parse(readFileSync(file, "utf8")), file)).filter((x) => x.available);
  const collections = sharedCollections(ws);
  const chosen = songCollections(ws, p.id);
  for (const c of [...chosen].reverse()) if (!collections.includes(c)) collections.unshift(c);
  const paths = songPathsById(ws, p.id);
  const { input } = recipeInputFor(ws, p.id);
  const resolved = resolveRecipe(input);
  const effects: Record<string, { verse: string; hook: string }> = {};
  const lengths: Record<string, number | null> = {};
  const shotLengths: Record<string, string | null> = {};
  for (const x of presets) {
    const r = resolveRecipe(input, x.name);
    shotLengths[x.name] = r.values.shotLength;
    // A target length never applies to YouTube (whole song) or Canvas (loop): their chips keep that.
    lengths[x.name] = x.length.mode === "full" || x.length.mode === "loop" ? null : r.values.length;
    if (r.values.verseEffect !== resolved.values.verseEffect || r.values.hookEffect !== resolved.values.hookEffect) effects[x.name] = { verse: r.values.verseEffect, hook: r.values.hookEffect };
  }
  const catalog = loadFontCatalog(ws.dir);
  const pairings = loadPairings(catalog, loadBrand(ws.dir, catalog, p.artist).brand).pairings.map((x) => ({ id: x.id, name: x.name, note: x.note }));
  return {
    pairings,
    platforms: presets.map((x) => ({ name: x.name, label: SHORT_LABELS[x.name] ?? x.label, variations: x.variations, lyrics: x.lyrics })),
    collections,
    chosen,
    songClips: paths.clips && existsSync(paths.clips) ? readdirSync(paths.clips).filter((f) => SOURCE_FILE.test(f)).length : 0,
    effects: EFFECT_NAMES.map((name) => ({ name, label: effectOptionLabel(name) })),
    verseEffect: resolved.values.verseEffect,
    hookEffect: resolved.values.hookEffect,
    recipe: {
      platforms: resolved.values.platforms,
      variations: resolved.values.variations,
      section: resolved.values.section,
      youtubeLayout: resolved.values.youtubeLayout,
      shotLength: resolved.values.shotLength,
      shotLengths,
      locked: resolved.locked,
      sources: resolved.sources,
      effects,
      lengths,
      presetLengths: Object.fromEntries(presets.map((x) => [x.name, presetLengthText(x)])),
      brandDefaults: { verseEffect: String(input.artist.verseEffect), hookEffect: String(input.artist.hookEffect) },
    },
    lyricsReady: !!projectLyricsTxt(ws, p.id),
    title: p.title,
    artist: p.artist,
    ep: songEp(ws, p.id) ?? "",
    artists: knownArtists(ws),
  };
}

export { sharedCollections } from "./song-folder";


// ---- Song title and Delete song (31 Oct 2026) ----

// A new title (the song's page header): the folder songs\<artist>\<title>\ follows. Not while it renders.
export function renameSong(ws: Workspace, projectId: string, title: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("A song needs a title.");
  if (clean.length > 200) throw new Error("The title is too long.");
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  if (isRemovedSong(p.folder)) throw new Error("This song is deleted: restore it first.");
  if (clean === p.title) return clean;
  if (songBusy(ws, projectId)) throw new Error(`"${p.title}" is being rendered right now; rename it when the run has finished.`);
  ws.db.update(projectTable).set({ title: clean }).where(eq(projectTable.id, projectId)).run();
  try {
    renameSongFolder(ws, projectId);
  } catch (error) {
    ws.db.update(projectTable).set({ title: p.title }).where(eq(projectTable.id, projectId)).run();
    throw error;
  }
  return clean;
}

export type RemovedSong = { id: string; title: string; artist: string; folder: string; removedAt: string };
const pad = (n: number) => String(n).padStart(2, "0");
const REMOVED_AT = / \(removed (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\)$/;

// "Delete song": the whole song folder (song, lyrics, clips, videos) moves to songs\_removed\ — nothing is
// deleted — and the song leaves the Library. Not while it renders.
export function removeSong(ws: Workspace, projectId: string): string {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  if (!p.folder) throw new Error("This song still uses the old folders: migrate it first (Library → Migrate).");
  if (isRemovedSong(p.folder)) return p.folder;
  if (songBusy(ws, projectId)) throw new Error(`"${p.title}" is being rendered right now; delete it when the run has finished.`);
  const at = new Date();
  const label = `${safeName(p.artist || "Life Lyrics")} - ${path.posix.basename(p.folder)} (removed ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())})`;
  const to = `${REMOVED_SONGS}/${label}`;
  moveEntry(absPath(ws, p.folder), absPath(ws, to));
  relocatePaths(ws, p.folder, to);
  removeEmptyDirs(path.dirname(absPath(ws, p.folder)), absPath(ws, SONGS_DIR));
  return to;
}

export function removedSongs(ws: Workspace): RemovedSong[] {
  return ws.db
    .select()
    .from(projectTable)
    .all()
    .filter((p) => isRemovedSong(p.folder))
    .map((p) => {
      const m = REMOVED_AT.exec(p.folder!);
      return { id: p.id, title: p.title, artist: p.artist, folder: p.folder!, removedAt: m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : "" };
    })
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
}

// "Restore": back to songs\<artist>\<title>\ (" (2)" when that folder was taken since), back in the Library.
export function restoreSong(ws: Workspace, projectId: string): string {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p || !isRemovedSong(p.folder)) throw new Error("This song is not deleted.");
  const to = songFolderFor(ws, p.artist, p.title, p.id);
  moveEntry(absPath(ws, p.folder!), absPath(ws, to));
  relocatePaths(ws, p.folder!, to);
  return to;
}
