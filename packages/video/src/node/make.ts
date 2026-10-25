// "pnpm make": one song + lyrics.txt + a collection of clips -> N finished variations, each with a
// manifest and a QA report. Steps: project (by song hash) -> beats (cached) -> lyric alignment
// (stored, never rewritten) -> section -> collection import -> cuts -> N variations rendered in
// parallel -> QA -> manifest.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REPO_ROOT,
  absPath,
  lyricLine as lyricLineTable,
  openWorkspace,
  project as projectTable,
  renderJob as renderJobTable,
  resolveWorkspaceDir,
  safeName,
  section as sectionTable,
  storedPath,
  stylePreset,
  variation as variationTable,
  type Workspace,
} from "@lyric/db";
import { eq } from "drizzle-orm";

import type { Beat } from "../beats";
import { composeProps, DEFAULT_LEAD_MS, lyricFrames, type PlatformLayout, type RenderBase, type StyleChoice } from "../compose";
import { cleanLrc } from "../lrc";
import { choosePlatforms, lyricArea, parsePresets, sectionWindow, STANDARD, type LyricArea, type PlatformPreset } from "../platform";
import { VIDEO } from "../config";
import { getCutPoints, type CutRate, type Energy } from "../cuts";
import { matchPinClips, parsePins } from "../pins";
import type { LyricVideoProps } from "../props";
import { formatQa, LOW_CONFIDENCE, qaReasons, runQa, type QaInput, type QaReport } from "../qa";
import { autoSection, clockText, finishedBeforeStart, sectionCuts, startsAfterEnd, type SectionCut, type SectionLine } from "../section";
import { RECENT_WINDOW, type ClipOrder } from "../shots";
import { analyzeSong } from "./analysis";
import { loadBrand, type Brand } from "./brand";
import { prepareForFormat, syncCollection, type CollectionSync, type PreparedForFormat } from "./collection";
import { fontFileRefs, loadFontCatalog, resolveFace, type FontCatalog } from "./font-catalog";
import { sha256File, toolInfo, writeManifest, type Manifest } from "./manifest";
import { resolveMediaPath, type MediaRoots } from "./media";
import { tooLongLines } from "./measure";
import { loadStyles, lyricLineNumbers, parseSection, snapToDownbeat, songMedia, type StyleFaces } from "./prepare";
import { detectBadFrames, measureLyrics } from "./qa-check";
import { getBundle, renderLyricVideo, renderThumbnail, type RenderOptions } from "./render";
import { ensureAlignment, findOrCreateSongProject, matchReport, type Alignment, type AlignRunner } from "./song-project";
import {
  blurredBackground,
  chooseLayout,
  lyricAreaFor,
  planStills,
  publishText,
  resolveCover,
  thumbnailBackground,
  writeSrt,
  youtubeExtras,
  youtubeLyricSafeZone,
  type YouTubeLayout,
} from "./youtube";

export type MakeOptions = {
  song: string;
  lyrics: string; // lyrics.txt
  collection: string;
  collectionPath?: string;
  variations?: number; // default: the platform preset's number (standard: 6)
  platforms?: string; // "reels,tiktok,shorts" or "all"; default: the "standard" preset
  allowFill?: boolean; // use sources of the other orientation, shown whole over a blurred copy
  title?: string; // song title (saved to the project; default: the song's file name)
  cover?: string; // YouTube cover layout: the square cover image (stored with the project)
  layout?: YouTubeLayout; // YouTube layout (default from the preset: cover)
  stills?: string; // YouTube stills layout: stills.txt (default: next to lyrics.txt, else in the collection folder)
  grain?: boolean; // YouTube stills: film grain (default from the preset)
  glow?: boolean; // YouTube stills: beat-pulsed glow (default from the preset)
  presetsFile?: string; // default: presets/platforms.json
  section?: string; // "auto" (default) | "full" | "0:11-1:10"
  hint?: string;
  noHint?: boolean; // align without the project's stored hints (warns)
  realign?: boolean;
  lrc?: string; // use this LRC instead of aligning
  lang?: string;
  rate?: CutRate;
  energy?: Energy;
  leadMs?: number;
  lyricsOffsetMs?: number; // saved to the project when given
  downbeatOffset?: number;
  font?: string;
  fontHook?: string;
  pins?: string;
  parallel?: number;
  frameCheck?: boolean; // default true
  resume?: boolean; // render only the missing or failed variations of the latest export folder
  workspaceDir?: string;
  command?: string;
  now?: Date;
  align?: AlignRunner;
  renderer?: (options: RenderOptions) => Promise<string>; // tests: a stand-in for renderLyricVideo
  thumbnailRenderer?: typeof renderThumbnail; // tests: a stand-in for renderThumbnail
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
  onRenderProgress?: (state: RenderState[]) => void;
  onReady?: (info: MakePlan) => void; // everything decided, rendering starts
  onRetry?: (name: string, error: string, concurrency: number) => void;
};

export type MakePlan = {
  platform: { name: string; label: string; index: number; count: number; folder: string };
  sources: { usable: number; needed: number; kind: string; filled: string[]; skipped: string[] } | null; // null: no clips used (YouTube cover / stills)
  layout: string | null; // YouTube layout used
  brand: { file: string; created: boolean };
  project: { title: string; created: boolean };
  bpm: number;
  downbeatConfidence: number;
  lyrics: { source: Alignment["source"]; file: string; lines: number; hooks: number; low: { number: number; text: string; confidence: number }[] };
  lyricsOffsetMs: number;
  section: { start_ms: number; end_ms: number; reason: string };
  collection: { name: string; folder: string; clips: number; added: number; changed: number; unchanged: number; removed: number };
  cuts: number;
  limit: RenderLimit;
  exportDir: string;
  resume: { done: number; toRender: string[] } | null;
  warnings: string[];
  notes: string[];
};

export type RenderState = { name: string; status: "queued" | "rendering" | "checking" | "done" | "failed"; progress: number };

export type VariationSpec = { index: number; name: string; order: ClipOrder; seed: number; style: StyleChoice; bars: boolean };

export type VariationResult = VariationSpec & {
  platform: string;
  file: string;
  srtFile: string;
  thumbnailFile?: string; // YouTube
  publishFile?: string; // YouTube
  manifestFile: string;
  qaFile: string;
  durationS: number;
  qa: QaReport | null;
  qaSummary: string; // "PASS", "WARN (reasons)" or "" when it failed
  error: string | null;
  kept: boolean; // --resume: already done in the export folder, not rendered again
  retried: boolean; // the first attempt failed and it was rendered again with less memory
};

export type PlatformResult = {
  name: string;
  label: string;
  exportDir: string;
  section: { start_ms: number; end_ms: number; reason: string };
  limit: RenderLimit;
  variations: VariationResult[];
  warnings: string[];
  error: string | null; // the platform could not be made at all (e.g. no suitable sources)
};

export type MakeResult = {
  projectTitle: string;
  exportDir: string; // the run's folder (platforms in subfolders; "standard" directly in it)
  lrcFile: string; // clean synced lyrics for Musixmatch / LyricFind
  section: { start_ms: number; end_ms: number; reason: string }; // of the first platform
  limit: RenderLimit;
  platforms: PlatformResult[];
  variations: VariationResult[]; // all platforms
  warnings: string[];
};

// v1: story order; v2..vN: shuffle with seed 2..N. Styles alternate Simple / Bold; cinematic bars on
// every other variation (v2, v4, ...).
export function planVariations(count: number): VariationSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    return {
      index,
      name: `v${index}`,
      order: index === 1 ? "story" : "shuffle",
      seed: index,
      style: index % 2 === 1 ? "simple" : "bold",
      bars: index % 2 === 0,
    };
  });
}

export type RenderLimit = { parallel: number; concurrency: number; videoCacheBytes: number; estimateGB: number; explanation: string };

// Memory model for one render: each browser tab drawing frames at 1080x1920 takes about 0.75 GB, the
// rest (FFmpeg encoding, the clip decoder, Node) about 1.5 GB, plus the cache of decoded clip frames,
// which is capped (Remotion's default is half of the free memory per render, which is what ran a
// 32 GB Windows PC out of memory with two renders at once). Everything together stays under 40% of
// the PC's memory.
export const RENDER_MEMORY = { perTabGB: 0.75, perRenderGB: 1.5, shareOfMemory: 0.4, maxCacheGB: 2, minCacheGB: 0.25 } as const;

// How many videos to render at the same time. One Remotion render already uses several CPU threads
// (one browser tab per thread, "concurrency"). On Windows one video at a time (renders in parallel
// ran out of memory there); elsewhere two on 8+ threads and 16+ GB.
export function renderLimit(
  options: { cpus?: number; memoryGB?: number; platform?: NodeJS.Platform; requested?: number } = {},
): RenderLimit {
  const cpus = options.cpus ?? os.cpus().length;
  const memoryGB = options.memoryGB ?? os.totalmem() / 2 ** 30;
  const platform = options.platform ?? process.platform;
  const m = RENDER_MEMORY;
  const recommended = platform === "win32" ? 1 : cpus >= 8 && memoryGB >= 16 ? 2 : 1;
  const parallel = Math.max(1, options.requested ?? recommended);
  const budget = memoryGB * m.shareOfMemory;
  let cacheGB = Math.min(m.maxCacheGB, Math.max(m.minCacheGB, (budget / parallel) * 0.25));
  let concurrency = Math.max(1, Math.min(8, Math.floor(cpus / parallel)));
  const estimate = () => parallel * (concurrency * m.perTabGB + m.perRenderGB + cacheGB);
  while (concurrency > 1 && estimate() > budget) concurrency -= 1;
  while (cacheGB > m.minCacheGB && estimate() > budget) cacheGB = Math.max(m.minCacheGB, cacheGB / 2);
  const why = platform === "win32" && !options.requested ? "; one at a time on Windows" : "";
  const explanation =
    `${parallel} video${parallel > 1 ? "s" : ""} at a time, ${concurrency} frame${concurrency > 1 ? "s" : ""} in parallel each, ` +
    `clip cache ${cacheGB.toFixed(1)} GB (${cpus} CPU threads, ${Math.round(memoryGB)} GB memory; about ${estimate().toFixed(1)} GB used at most${why})` +
    (options.requested && options.requested > recommended ? `; --parallel ${options.requested} is above the recommended ${recommended}` : "") +
    (estimate() > budget ? "; WARNING: this may not fit in memory" : "");
  return { parallel, concurrency, videoCacheBytes: Math.round(cacheGB * 2 ** 30), estimateGB: estimate(), explanation };
}

// A retry after a failed render uses half the browser tabs and half the clip cache.
export function retryLimit(limit: RenderLimit): Pick<RenderLimit, "concurrency" | "videoCacheBytes"> {
  return {
    concurrency: Math.max(1, Math.floor(limit.concurrency / 2)),
    videoCacheBytes: Math.max(Math.round(RENDER_MEMORY.minCacheGB * 2 ** 30), Math.round(limit.videoCacheBytes / 2)),
  };
}

// The newest export folder of a project (folder names sort by date and time), or null.
export function latestExportFolder(ws: Workspace, projectId: string): string | null {
  const base = absPath(ws, `projects/${projectId}/exports`);
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}

// A variation is finished when its video, manifest and QA report are all there.
export function variationDone(dir: string, name: string): boolean {
  return ["mp4", "manifest.json", "qa.txt"].every((ext) => existsSync(path.join(dir, `${name}.${ext}`)));
}

// "Summary: WARN - A; B" in a QA report -> "WARN (a, b)".
export function qaSummaryFromFile(file: string): string {
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("Summary: ")) ?? "";
  const m = /^Summary: (PASS|WARN)(?: - (.*))?$/.exec(line.trim());
  if (!m) return "?";
  return m[1] === "PASS" ? "PASS" : `WARN (${(m[2] ?? "").split("; ").map((r) => r.toLowerCase()).join(", ")})`;
}

// WORKSPACE_DIR\projects\<id>\exports\<YYYY-MM-DD_HHmm>\ (with -2, -3, ... if that minute exists).
export function exportFolder(ws: Workspace, projectId: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  const base = absPath(ws, `projects/${projectId}/exports`);
  let dir = path.join(base, name);
  for (let n = 2; existsSync(dir); n++) dir = path.join(base, `${name}-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Runs `tasks` with at most `limit` at the same time.
export async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function openFolder(dir: string): void {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : null;
  if (!command) return;
  try {
    spawn(command, [dir], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  } catch {
    // Opening the folder is a convenience only.
  }
}

type SectionChoiceOut = {
  mode: string;
  start_ms: number;
  end_ms: number;
  requested: { start_ms: number; end_ms: number } | null;
  reason: string;
  warnings: string[];
  cuts: SectionCut[]; // sung lines cut at the start or end (QA: WARN)
};

function chooseSection(mode: string, lines: SectionLine[], beats: Beat[], durationMs: number, leadMs: number, preset?: PlatformPreset): SectionChoiceOut {
  if (mode === "auto" && preset?.length.mode === "full") mode = "full";
  if (mode === "auto") {
    const window = preset ? sectionWindow(preset) : null;
    const s = autoSection(lines, beats, {
      durationMs,
      leadMs,
      ...(window ? { minMs: window.minMs, maxMs: window.maxMs, hardMaxMs: window.hardMaxMs, shortestMs: window.shortestMs } : {}),
      ...(window && preset!.length.mode === "target" ? { targetMs: window.targetMs } : {}),
      anchorMode: preset?.anchor ?? "lead-in",
      endOn: preset?.endOn ?? "bar",
    });
    return { mode, start_ms: s.start_ms, end_ms: s.end_ms, requested: null, reason: s.reason, warnings: s.warnings, cuts: s.cuts };
  }
  const requested = mode === "full" ? { start_ms: 0, end_ms: durationMs } : parseSection(mode);
  requested.end_ms = Math.min(requested.end_ms, durationMs);
  if (mode === "full" && preset?.length.mode === "full") {
    // A full-song video (YouTube) starts at 0:00: snapping to the first bar would cut the intro.
    return { mode, start_ms: 0, end_ms: requested.end_ms, requested, reason: `whole song: 0:00 - ${clockText(requested.end_ms)} (from the very start, so the intro is kept)`, warnings: [], cuts: [] };
  }
  const start = snapToDownbeat(beats, requested.start_ms);
  const snapped = start !== requested.start_ms ? ` (start snapped from ${clockText(requested.start_ms)} to the nearest bar start)` : "";
  const reason = `${mode === "full" ? "whole song" : "as given"}: ${clockText(start)} - ${clockText(requested.end_ms)}${snapped}; ${((requested.end_ms - start) / 1000).toFixed(1)} s`;
  if (requested.end_ms - start < 1000) throw new Error("The section is shorter than 1 second.");
  const cuts = sectionCuts(lines, start, requested.end_ms).filter((c) => !(mode === "full" && c.at === "end" && requested.end_ms >= durationMs));
  return { mode, start_ms: start, end_ms: requested.end_ms, requested, reason, warnings: cuts.map((c) => `The section ${c.at} (${clockText(c.time_ms)}) cuts line ${c.line} "${c.text}" while it is sung.`), cuts };
}

export async function makeVideos(options: MakeOptions): Promise<MakeResult> {
  const log = options.log ?? (() => {});
  if (options.variations !== undefined && (!Number.isInteger(options.variations) || options.variations < 1 || options.variations > 24)) {
    throw new Error("--variations must be a whole number from 1 to 24");
  }
  const leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
  const now = options.now ?? new Date();
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  try {
    for (const f of [options.song, options.lyrics]) if (!existsSync(f)) throw new Error(`File not found: ${f}`);

    // Presets, brand and fonts first: a mistake there should fail before the slow steps.
    const presets = loadPresets(options.presetsFile);
    const chosenPlatforms = choosePlatforms(options.platforms, presets);
    const catalog = loadFontCatalog(ws.dir);
    for (const problem of catalog.problems) log(`font file skipped: ${problem}`);
    const brand = loadBrand(ws.dir, catalog);
    if (brand.created) log(`brand settings created: ${brand.file} (edit fonts, colour and logo there)`);
    const styles = loadStyles(ws, catalog, {
      font: options.font,
      fontHook: options.fontHook,
      brandFonts: brand.brand.useForLyrics ? { verse: brand.brand.verseFont.family, hook: brand.brand.hookFont.family } : undefined,
    });

    const sp = await findOrCreateSongProject(ws, path.resolve(options.song), log);
    log(`project "${sp.project.title}" (${sp.created ? "new" : "found by the song's content"})`);

    log("analysing the song (cached after the first time)");
    const analysis = analyzeSong(sp.songFile, { downbeatOffset: options.downbeatOffset });
    let project = ws.db
      .update(projectTable)
      .set({
        bpm: analysis.bpm,
        duration_ms: analysis.duration_ms,
        downbeat_offset: analysis.downbeat_offset,
        ...(options.lyricsOffsetMs !== undefined ? { lyrics_offset_ms: options.lyricsOffsetMs } : {}),
      })
      .where(eq(projectTable.id, sp.project.id))
      .returning()
      .get();
    if (options.title && options.title !== project.title) {
      project = ws.db.update(projectTable).set({ title: options.title }).where(eq(projectTable.id, project.id)).returning().get();
    }
    const lyricsOffsetMs = project.lyrics_offset_ms;

    const alignment = await ensureAlignment(ws, { ...sp, project }, {
      lyricsTxt: path.resolve(options.lyrics),
      hint: options.hint ? path.resolve(options.hint) : undefined,
      noHint: options.noHint,
      lrc: options.lrc ? path.resolve(options.lrc) : undefined,
      realign: options.realign,
      lang: options.lang,
      durationMs: analysis.duration_ms,
      log,
      align: options.align,
    });
    const lines = alignment.lines;
    if (!lines.length) throw new Error(`No timed lyric lines in ${alignment.lrcFile}`);
    const reports = matchReport(lines, alignment.report);
    saveLyricLines(ws, project.id, alignment);
    const numbers = lyricLineNumbers(lines.map((l) => l.text), alignment.lrcFile, alignment.lyricsTxt).numbers;
    const sectionLines: SectionLine[] = lines.map((l, i) => ({ ...l, sung_end_ms: reports[i]?.end_ms }));

    const collection = await syncCollection(ws, { name: options.collection, folder: options.collectionPath, log, prepare: false });

    // The run's folder; --resume continues the latest one.
    let rootDir: string;
    if (options.resume) {
      const latest = latestExportFolder(ws, project.id);
      if (!latest) throw new Error("--resume: this project has no earlier export folder; run without --resume.");
      rootDir = latest;
    } else {
      rootDir = exportFolder(ws, project.id, now);
    }
    const lrcFile = path.join(rootDir, `${safeName(project.title)}.lrc`);
    if (!existsSync(lrcFile)) {
      writeFileSync(lrcFile, cleanLrc(lines, { title: project.title, artist: project.artist, durationMs: analysis.duration_ms, offsetMs: lyricsOffsetMs }));
    }

    const tool = toolInfo();
    const shared: Shared = {
      ws, options, log, now, leadMs, lyricsOffsetMs, catalog, styles, brand, sp, analysis, alignment, lines, reports, numbers,
      sectionLines, collection, tool, rootDir, getProject: () => project,
    };
    const results: PlatformResult[] = [];
    for (const [index, name] of chosenPlatforms.names.entries()) {
      const preset = presets[name];
      try {
        results.push(await makePlatform(shared, preset, { index, count: chosenPlatforms.names.length }));
      } catch (error) {
        if (chosenPlatforms.names.length === 1) throw error;
        // One platform failing (e.g. no suitable clips) never stops the others.
        results.push({
          name, label: preset.label, exportDir: platformDir(rootDir, name), section: { start_ms: 0, end_ms: 0, reason: "" },
          limit: renderLimit({ platform: options.platform, requested: options.parallel }), variations: [], warnings: [], error: (error as Error).message,
        });
      }
    }

    project = ws.db.select().from(projectTable).where(eq(projectTable.id, project.id)).get()!;
    const first = results.find((r) => !r.error) ?? results[0];
    return {
      projectTitle: project.title,
      exportDir: rootDir,
      lrcFile,
      section: first.section,
      limit: first.limit,
      platforms: results,
      variations: results.flatMap((r) => r.variations),
      warnings: [...results.flatMap((r) => r.warnings), ...chosenPlatforms.skipped.map((n) => `${n} skipped: ${presets[n].note ?? "not available yet"}`)],
    };
  } finally {
    ws.close();
  }
}

type Shared = {
  ws: Workspace;
  options: MakeOptions;
  log: (m: string) => void;
  now: Date;
  leadMs: number;
  lyricsOffsetMs: number;
  catalog: FontCatalog;
  styles: StyleFaces;
  brand: ReturnType<typeof loadBrand>;
  sp: Awaited<ReturnType<typeof findOrCreateSongProject>>;
  analysis: Awaited<ReturnType<typeof analyzeSong>>;
  alignment: Alignment;
  lines: Alignment["lines"];
  reports: ReturnType<typeof matchReport>;
  numbers: number[];
  sectionLines: SectionLine[];
  collection: CollectionSync;
  tool: Manifest["tool"];
  rootDir: string;
  getProject: () => { id: string; title: string; artist: string };
};

// The last shot shows the frames right before the first one (or the same photo, ending where its move starts).
export function loopsSeamlessly(shots: readonly LyricVideoProps["shots"][number][]): boolean {
  const first = shots[0];
  const last = shots[shots.length - 1];
  if (!first || shots.length < 2 || last.src !== first.src) return false;
  if (first.kind === "photo") return last.motion?.toZoom === first.motion?.fromZoom;
  return last.clipStartFrame + last.duration === first.clipStartFrame && last.playbackRate === 1;
}

// "standard" goes straight into the run's folder, every platform into its own subfolder.
export function platformDir(rootDir: string, name: string): string {
  return name === STANDARD ? rootDir : path.join(rootDir, name);
}

export function loadPresets(file = path.join(REPO_ROOT, "presets", "platforms.json")): Record<string, PlatformPreset> {
  if (!existsSync(file)) throw new Error(`Platform presets not found: ${file}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message})`);
  }
  return parsePresets(json, file);
}

async function makePlatform(sh: Shared, preset: PlatformPreset, position: { index: number; count: number }): Promise<PlatformResult> {
  const { ws, options, log, leadMs, lyricsOffsetMs, analysis, lines, reports, numbers, alignment, styles } = sh;
  const project = sh.getProject();
  const format = { width: preset.width, height: preset.height };
  const exportDir = platformDir(sh.rootDir, preset.name);
  mkdirSync(exportDir, { recursive: true });

  // Section (lines appear `leadMs` early and move by the lyrics offset).
  const chosen = chooseSection(options.section ?? "auto", sh.sectionLines, analysis.beats, analysis.duration_ms, leadMs - lyricsOffsetMs, preset);
  log(`${preset.name}: section ${clockText(chosen.start_ms)} - ${clockText(chosen.end_ms)}`);
  const sectionRow = ws.db
    .insert(sectionTable)
    .values({ project_id: project.id, name: `make ${preset.name} (${chosen.mode})`, start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" })
    .returning()
    .get();

  // Sources that suit this format.
  const prepared = await prepareForFormat(ws, sh.collection.sources, format, { allowFill: options.allowFill, log });
  const needed = Math.min(RECENT_WINDOW + 1, Math.max(1, sh.collection.sources.length));
  const ytWarnings: string[] = [];
  let ytLayout: YouTubeLayout | null = null;
  let coverSrc: string | null = null;
  let coverBackground: string | null = null;
  let stillsPlan: ReturnType<typeof planStills> | null = null;
  if (preset.layout === "youtube") {
    const row = ws.db.select().from(projectTable).where(eq(projectTable.id, project.id)).get()!;
    const cover = resolveCover(ws, row, { cover: options.cover, songFile: path.resolve(options.song) });
    const photos = prepared.clips.filter((c) => c.kind === "photo" && c.fit === "cover");
    const choice = chooseLayout(options.layout ?? preset.youtube!.defaultLayout, { cover: !!cover, photos: photos.length, sources: prepared.clips.length });
    if (!choice.layout) throw new Error(`${preset.name}: ${choice.message}`);
    if (choice.message) ytWarnings.push(`${preset.name}: ${choice.message}`);
    ytLayout = choice.layout;
    coverSrc = ytLayout === "cover" && cover ? cover.stored : null;
    if (coverSrc) {
      log(`${preset.name}: cover from ${cover!.from}`);
      coverBackground = await blurredBackground(ws, coverSrc, format);
    }
    if (ytLayout === "stills") {
      const stillsFile =
        options.stills ?? [path.join(path.dirname(alignment.lyricsTxt), "stills.txt"), path.join(sh.collection.folder, "stills.txt")].find((f) => existsSync(f));
      if (options.stills && !existsSync(options.stills)) throw new Error(`stills.txt not found: ${options.stills}`);
      stillsPlan = planStills({
        lines, beats: analysis.beats, photos, stillsText: stillsFile ? readFileSync(stillsFile, "utf8") : null, durationMs: analysis.duration_ms,
        startMs: chosen.start_ms, durationInFrames: Math.round(((chosen.end_ms - chosen.start_ms) * VIDEO.fps) / 1000), seed: 1,
      });
      ytWarnings.push(...stillsPlan.warnings);
      log(`${preset.name}: stills ${stillsPlan.sections.join(", ")}${stillsFile ? ` (from ${stillsFile})` : " (file-name order)"}`);
    }
  }
  const usesClips = ytLayout === null || ytLayout === "clips";
  if (usesClips && !prepared.clips.length) {
    throw new Error(
      `${preset.name}: none of the ${sh.collection.sources.length} source(s) in "${sh.collection.collection.name}" is ${prepared.kind} ` +
        `(${format.width}x${format.height}); add ${prepared.kind} clips or photos, or use --allow-fill`,
    );
  }

  const plan = getCutPoints(analysis.beats, { start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" }, {
    cutRate: options.rate ?? "1x",
    lyricLines: lines,
  });
  const preparedClips = prepared.clips.map((c) => ({
    id: c.clip.id, name: c.name, duration_ms: c.durationMs, path: c.path, durationFrames: c.durationFrames, kind: c.kind, fit: c.fit,
  }));

  const warnings = [
    ...(position.index === 0 ? sh.alignment.warnings : []),
    ...(position.index === 0 ? sh.collection.duplicates.map((d) => `these files have identical content (the same clip twice): ${d.join(", ")}`) : []),
    ...chosen.warnings.map((w) => `${preset.name}: ${w}`),
    ...ytWarnings,
  ];
  let pins: RenderBase["pins"] = [];
  if (options.pins) {
    const parsed = parsePins(readFileSync(options.pins, "utf8"));
    const matched = matchPinClips(parsed.rules, preparedClips);
    pins = matched.pins;
    warnings.push(...parsed.warnings, ...matched.warnings);
  }

  const { media, audio } = songMedia(ws.dir, sh.sp.songFile, plan, sh.catalog, preset.fadeOutSeconds);
  const allLyrics = lines.map((l) => ({ text: l.text, start_ms: l.start_ms, end_ms: l.end_ms, isHook: l.isHook }));
  // A line whose singing is over but which is still on screen at the start (it lingers until the
  // next stamp) is not shown, so the video never opens on the tail of the previous line.
  // A line whose first word comes after the end would only flash up in the last 0.25 s: not shown either.
  const hidden = preset.lyrics
    ? [...finishedBeforeStart(sh.sectionLines, chosen.start_ms, leadMs, lyricsOffsetMs), ...startsAfterEnd(sh.sectionLines, chosen.end_ms, leadMs, lyricsOffsetMs)]
    : [];
  const shown = preset.lyrics ? lines.map((_, i) => i).filter((i) => !hidden.includes(i)) : [];
  const layout: PlatformLayout = {
    format,
    safeZone: preset.safeZone,
    lyricsAt: preset.lyricsAt,
    textScale: preset.textScale,
    loopEnding: preset.loopEnding,
    ...(ytLayout ? { lyricSafeZone: youtubeLyricSafeZone(ytLayout, preset.safeZone) } : {}),
  };
  const base: RenderBase = {
    plan,
    clips: usesClips ? preparedClips : [],
    audio: preset.audio ? audio : null,
    durationInFrames: plan.end_frame - plan.start_frame,
    lyrics: shown.map((i) => allLyrics[i]),
    styles: { simple: styles.simple.entry, bold: styles.bold.entry },
    colour: "#ffffff",
    cinematicBars: false,
    pins,
    platform: layout,
  };

  // Which lines are on screen (same rule as composeProps).
  const frames = lyricFrames(base, leadMs, lyricsOffsetMs);
  const visible = frames
    .map((f, k) => ({ i: shown[k], start: Math.max(0, f.startFrame), end: Math.min(base.durationInFrames, f.endFrame) }))
    .filter((v) => v.end > v.start)
    .map((v) => v.i);
  const notes = hidden.map(
    (i) => `line ${numbers[i] || i + 1} "${lines[i].text}" is not shown: it is sung ${lines[i].start_ms < chosen.start_ms ? "before the section starts" : "after the section ends"}`,
  );
  for (const style of ["simple", "bold"] as const) {
    const s = styles[style];
    const area = ytLayout ? lyricAreaFor(ytLayout, preset) : lyricArea(format, preset.safeZone, preset.lyricsAt);
    const textSize = Math.round(s.entry.textSize * preset.textScale);
    for (const l of tooLongLines(visible.map((i) => lines[i]), { main: s.main, hook: s.hook, textCase: s.entry.style.textCase, textSize, area })) {
      const n = numbers[lines.indexOf(l)] || lines.indexOf(l) + 1;
      warnings.push(`Line ${n} is too long for phone screens (${s.entry.style.name}); split it in ${path.basename(alignment.lyricsTxt)}: "${l.text}"`);
    }
  }

  const allSpecs = planVariations(options.variations ?? preset.variations);
  let specs = allSpecs;
  if (options.resume) {
    const changed = resumeMismatch(exportDir, allSpecs, {
      section: chosen,
      lrcHash: alignment.lrcHash,
      leadMs,
      lyricsOffsetMs,
      cutFrames: plan.cuts.map((c) => c.frame - plan.start_frame),
      clipHashes: new Set(prepared.clips.map((c) => c.hash)),
      settings: { cut_rate: options.rate ?? "1x", energy: options.energy ?? "medium", font: options.font ?? null, font_hook: options.fontHook ?? null },
    });
    if (changed) throw new Error(`--resume: ${changed} since the run in ${exportDir}; run without --resume to make a new set.`);
    specs = allSpecs.filter((s) => !variationDone(exportDir, s.name));
  }
  const limit = renderLimit({ platform: options.platform, requested: options.parallel });
  const sources = { usable: prepared.usable, needed, kind: prepared.kind, filled: prepared.filled, skipped: prepared.skipped };
  // Compose every variation now, so its warnings are part of the plan printed before rendering.
  const composedBySpec = new Map(
    specs.map((spec) => {
      const composed = composeProps(base, { seed: spec.seed, style: spec.style, order: spec.order, leadMs, lyricsOffsetMs, cinematicBars: ytLayout ? false : spec.bars });
      warnings.push(...composed.warnings.map((w) => `${spec.name}: ${w}`));
      if (ytLayout) {
        const title = sh.brand.brand.titleFont;
        composed.props = {
          ...composed.props,
          ...youtubeExtras({
            layout: ytLayout, preset, props: composed.props, brand: sh.brand.brand, logoFile: sh.brand.logoFile, ws, title: project.title, artist: project.artist,
            cover: coverSrc, coverBackground, stills: stillsPlan?.stills ?? null, beats: analysis.beats, startMs: chosen.start_ms,
            grain: options.grain ?? preset.youtube!.grain, glow: options.glow ?? preset.youtube!.glow,
          }),
          fonts: [...composed.props.fonts, ...fontFileRefs(resolveFace(sh.catalog, title.family, title.weight))],
        };
      }
      if (preset.loopEnding && !loopsSeamlessly(composed.props.shots)) {
        warnings.push(`${preset.name} ${spec.name}: no seamless loop ending (the first clip is too short to also fill the last shot)`);
      }
      return [spec.name, composed] as const;
    }),
  );
  options.onReady?.({
    platform: { name: preset.name, label: preset.label, index: position.index, count: position.count, folder: exportDir },
    sources: usesClips ? sources : null,
    layout: ytLayout,
    brand: { file: sh.brand.file, created: sh.brand.created },
    project: { title: project.title, created: sh.sp.created },
    bpm: analysis.bpm,
    downbeatConfidence: analysis.downbeat_confidence,
    lyrics: {
      source: alignment.source,
      file: alignment.lrcFile,
      lines: lines.length,
      hooks: lines.filter((l) => l.isHook).length,
      low: reports.flatMap((r, i) => (r && r.confidence < LOW_CONFIDENCE ? [{ number: numbers[i] || i + 1, text: lines[i].text, confidence: r.confidence }] : [])),
    },
    lyricsOffsetMs,
    section: { start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason },
    collection: {
      name: sh.collection.collection.name,
      folder: sh.collection.folder,
      clips: sh.collection.sources.length,
      added: sh.collection.added.length,
      changed: sh.collection.changed.length,
      unchanged: sh.collection.unchanged.length,
      removed: sh.collection.removed.length,
    },
    cuts: plan.cuts.length,
    limit,
    exportDir,
    resume: options.resume ? { done: allSpecs.length - specs.length, toRender: specs.map((s) => s.name) } : null,
    warnings: [...warnings],
    notes,
  });
  const states: RenderState[] = specs.map((s) => ({ name: s.name, status: "queued", progress: 0 }));
  const report = () => options.onRenderProgress?.(states.map((s) => ({ ...s })));
  const results: VariationResult[] = allSpecs
    .filter((spec) => !specs.includes(spec))
    .map((spec) => {
      const manifestFile = path.join(exportDir, `${spec.name}.manifest.json`);
      const durationS = (JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest).output.duration_s;
      const qaFile = path.join(exportDir, `${spec.name}.qa.txt`);
      return {
        ...spec, platform: preset.name, file: path.join(exportDir, `${spec.name}.mp4`), manifestFile, qaFile, srtFile: path.join(exportDir, `${spec.name}.srt`), durationS,
        qa: null, qaSummary: qaSummaryFromFile(qaFile), error: null, kept: true, retried: false,
      };
    });

  const jobs = specs.map((spec) => {
    const composed = composedBySpec.get(spec.name)!;
    const variationRow = ws.db
      .insert(variationTable)
      .values({
        project_id: project.id,
        section_id: sectionRow.id,
        seed: spec.seed,
        cut_rate: options.rate ?? "1x",
        style_id: ws.db.select().from(stylePreset).where(eq(stylePreset.name, styles[spec.style].entry.style.name)).get()?.id ?? null,
        text_size: composed.props.textSize,
        colour: composed.props.colour,
        cinematic_bars: spec.bars,
        overrides_json: {
          platform: preset.name, order: spec.order, lead_ms: leadMs, lyrics_offset_ms: lyricsOffsetMs,
          font: options.font ?? null, font_hook: options.fontHook ?? null, lrc: alignment.lrcStored,
        },
      })
      .returning()
      .get();
    const job = ws.db.insert(renderJobTable).values({ variation_id: variationRow.id }).returning().get();
    return { spec, props: composed.props, jobId: job.id };
  });
  report();

  const updateJob = (id: string, values: Partial<typeof renderJobTable.$inferInsert>) =>
    ws.db.update(renderJobTable).set(values).where(eq(renderJobTable.id, id)).run();

  await runPool(jobs, limit.parallel, async ({ spec, props, jobId }) => {
    const state = states.find((st) => st.name === spec.name)!;
    const file = path.join(exportDir, `${spec.name}.mp4`);
    const result: VariationResult = {
      ...spec,
      platform: preset.name,
      file,
      manifestFile: path.join(exportDir, `${spec.name}.manifest.json`),
      qaFile: path.join(exportDir, `${spec.name}.qa.txt`),
      srtFile: path.join(exportDir, `${spec.name}.srt`),
      durationS: props.durationInFrames / VIDEO.fps,
      qa: null,
      qaSummary: "",
      error: null,
      kept: false,
      retried: false,
    };
    results.push(result);
    state.status = "rendering";
    report();
    updateJob(jobId, { status: "rendering", started_at: new Date(), progress: 0 });
    let lastSaved = 0;
    const render = options.renderer ?? renderLyricVideo;
    const attempt = (settings: Pick<RenderLimit, "concurrency" | "videoCacheBytes">) =>
      render({
        props,
        media,
        outFile: file,
        concurrency: settings.concurrency,
        videoCacheBytes: settings.videoCacheBytes,
        videoBitrate: preset.videoBitrate,
        onProgress: (p) => {
          state.progress = p;
          report();
          if (p - lastSaved >= 0.05) {
            lastSaved = p;
            updateJob(jobId, { progress: Math.min(1, p) });
          }
        },
      });
    try {
      if (!options.renderer) await getBundle(log); // built once, shared by the parallel renders
      try {
        await attempt(limit);
      } catch (first) {
        // One retry with less memory; a second failure is reported and the others carry on.
        const lower = retryLimit(limit);
        result.retried = true;
        options.onRetry?.(spec.name, (first as Error).message, lower.concurrency);
        state.progress = 0;
        lastSaved = 0;
        try {
          await attempt(lower);
        } catch (second) {
          throw new Error(`${(second as Error).message} (also after a retry with ${lower.concurrency} frame${lower.concurrency > 1 ? "s" : ""} in parallel)`);
        }
      }
      state.status = "checking";
      report();
      const qa = await checkVariation(spec, props, file, {
        lines, visible, numbers, reports, styles, clips: prepared.clips,
        sources: usesClips ? { ...sources, platform: preset.label } : null,
        frameCheck: options.frameCheck ?? true,
        stillPictures: ytLayout === "cover" || ytLayout === "stills",
        sectionCuts: chosen.cuts.map((c) => ({ ...c, line: numbers[c.line - 1] || c.line })),
      });
      result.qa = qa;
      result.qaSummary = qa.status === "PASS" ? "PASS" : `WARN (${qaReasons(qa)})`;
      writeFileSync(result.qaFile, formatQa(qa, qaTitle(spec, project.title, chosen, preset)));
      writeManifest(
        result.manifestFile,
        buildManifest({
          ws, tool: sh.tool, spec, props, media, project, songHash: sh.sp.songHash, songFile: sh.sp.songFile, analysis, chosen, alignment, reports, numbers,
          visible, lines, leadMs, lyricsOffsetMs, options, collection: sh.collection, clips: prepared.clips, file, qa, now: sh.now, warnings, preset,
          brand: sh.brand.brand,
        }),
      );
      // Captions for every video; YouTube also gets a thumbnail and a publishing pack.
      writeSrt(result.srtFile, props);
      if (ytLayout) {
        const one = allSpecs.length === 1;
        const hookIndex = lines.findIndex((l) => l.isHook);
        const hookFrame = hookIndex >= 0 ? Math.round(((lines[hookIndex].start_ms - chosen.start_ms) * VIDEO.fps) / 1000) : 0;
        const background = await thumbnailBackground(ws, props, hookFrame, `${sh.sp.songHash.slice(0, 16)}-${preset.name}-${spec.name}`);
        const titleFont = sh.brand.brand.titleFont;
        result.thumbnailFile = path.join(exportDir, one ? "thumbnail.jpg" : `${spec.name}.thumbnail.jpg`);
        await (options.thumbnailRenderer ?? renderThumbnail)({
          props: {
            background: background ?? "",
            title: project.title,
            artist: project.artist,
            font: { family: titleFont.family, weight: titleFont.weight, letterSpacing: titleFont.letterSpacing ?? 0.18 },
            colour: sh.brand.brand.accentColour,
            fonts: fontFileRefs(resolveFace(sh.catalog, titleFont.family, titleFont.weight)),
            logo: props.logo ? { ...props.logo, width: Math.round(sh.brand.brand.logo.size * 1280) } : null,
          },
          media,
          outFile: result.thumbnailFile,
          log,
        });
        const pack = publishText(ws.dir, { song: project.title, artist: project.artist, lyricsTxt: readFileSync(alignment.lyricsTxt, "utf8"), year: sh.now.getFullYear() });
        if (pack.created) log(`publishing template created: ${pack.template} (edit it to change publish.txt)`);
        result.publishFile = path.join(exportDir, one ? "publish.txt" : `${spec.name}.publish.txt`);
        writeFileSync(result.publishFile, pack.text);
      }
      state.status = "done";
      state.progress = 1;
      updateJob(jobId, { status: "done", progress: 1, output_path: storedPath(ws, file), finished_at: new Date() });
    } catch (error) {
      result.error = (error as Error).message;
      state.status = "failed";
      updateJob(jobId, { status: "failed", error: result.error, finished_at: new Date() });
    }
    report();
  });

  return {
    name: preset.name,
    label: preset.label,
    exportDir,
    section: { start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason },
    limit,
    variations: results.sort((a, b) => a.index - b.index),
    warnings,
    error: null,
  };
}

function qaTitle(spec: VariationSpec, title: string, section: SectionChoiceOut, preset: PlatformPreset): string {
  return (
    `${title} - ${preset.name === STANDARD ? "" : `${preset.label} `}${spec.name}: ${spec.style === "simple" ? "Simple" : "Bold"}, ${spec.order}` +
    `${spec.order === "shuffle" ? ` (seed ${spec.seed})` : ""}${spec.bars ? ", cinematic bars" : ""}\n` +
    `Section ${clockText(section.start_ms)} - ${clockText(section.end_ms)}`
  );
}

// Stores the project's lyric lines (a copy of the stored LRC, for the studio screens).
function saveLyricLines(ws: Workspace, projectId: string, alignment: Alignment): void {
  ws.db.transaction((tx) => {
    tx.delete(lyricLineTable).where(eq(lyricLineTable.project_id, projectId)).run();
    alignment.lines.forEach((l, index) => {
      const words = l.words?.map((w, k) => ({ text: w.text, start_ms: w.start_ms, end_ms: l.words![k + 1]?.start_ms ?? l.end_ms }));
      tx.insert(lyricLineTable).values({ project_id: projectId, index, text: l.text, start_ms: l.start_ms, end_ms: l.end_ms, is_hook: l.isHook, words_json: words ?? null }).run();
    });
  });
}

async function checkVariation(
  spec: VariationSpec,
  props: Omit<LyricVideoProps, "mediaBaseUrl">,
  file: string,
  ctx: {
    lines: Alignment["lines"];
    visible: number[];
    numbers: number[];
    reports: ReturnType<typeof matchReport>;
    styles: StyleFaces;
    clips: PreparedForFormat["clips"];
    sources: QaInput["sources"];
    frameCheck: boolean;
    stillPictures?: boolean; // cover / stills layouts: still by design, so no frozen-frame check
    sectionCuts: SectionCut[];
  },
): Promise<QaReport> {
  const style = ctx.styles[spec.style];
  const nameBySrc = new Map(ctx.clips.map((c) => [c.path, c.name]));
  const lyrics = ctx.visible.map((i, k) => ({
    ...props.lyrics[k],
    number: ctx.numbers[i] || i + 1,
    confidence: ctx.reports[i]?.confidence ?? null,
  }));
  // Lines reaching into the end-screen time are drawn (and measured) in the end-screen area.
  const end = props.endScreen;
  const inEnd = (l: (typeof lyrics)[number]) => !!end && l.endFrame > end.fromFrame;
  const measure = (ls: typeof lyrics, area: LyricArea | undefined) =>
    measureLyrics(ls, { main: style.main, hook: style.hook, textCase: style.entry.style.textCase, textSize: props.textSize, animation: style.entry.style.animation, area });
  const measured = [...measure(lyrics.filter((l) => !inEnd(l)), props.lyricArea), ...(end ? measure(lyrics.filter(inEnd), end.lyricArea) : [])];
  let frames = ctx.frameCheck ? await detectBadFrames(file, props.durationInFrames / VIDEO.fps) : null;
  if (frames && ctx.stillPictures) frames = { black: frames.black, frozen: [] };
  return runQa({
    props,
    shotClips: props.shots.map((s) => nameBySrc.get(s.src) ?? s.src),
    poolSize: ctx.clips.length,
    lyrics: measured.sort((a, b) => a.number - b.number),
    frames,
    sources: ctx.sources,
    sectionCuts: ctx.sectionCuts,
    endScreen: end ? { clear: end.clear, lines: lyrics.filter(inEnd).map((l) => l.number) } : null,
    frozenCheckSkipped: ctx.stillPictures,
  });
}

function buildManifest(c: {
  ws: Workspace;
  tool: Manifest["tool"];
  spec: VariationSpec;
  props: Omit<LyricVideoProps, "mediaBaseUrl">;
  media: MediaRoots;
  project: { id: string; title: string };
  songHash: string;
  songFile: string;
  analysis: { bpm: number; downbeat_offset: number; downbeat_confidence: number; duration_ms: number };
  chosen: SectionChoiceOut;
  alignment: Alignment;
  reports: ReturnType<typeof matchReport>;
  numbers: number[];
  visible: number[];
  lines: Alignment["lines"];
  leadMs: number;
  lyricsOffsetMs: number;
  options: MakeOptions;
  collection: CollectionSync;
  clips: PreparedForFormat["clips"];
  file: string;
  qa: QaReport;
  now: Date;
  warnings: string[];
  preset: PlatformPreset;
  brand: Brand;
}): Manifest {
  const { props, spec, ws } = c;
  const startFrame = props.audio?.startFrame ?? Math.round((c.chosen.start_ms * VIDEO.fps) / 1000);
  const used = new Set(props.shots.map((s) => s.src));
  const clips = c.clips.filter((k) => used.has(k.path));
  const nameBySrc = new Map(clips.map((k) => [k.path, k.name]));
  return {
    manifest_version: 1,
    tool: c.tool,
    created_at: c.now.toISOString(),
    command: c.options.command ?? "pnpm make",
    variation: { index: spec.index, name: spec.name, order: spec.order, seed: spec.seed, style: props.style.name, cinematic_bars: spec.bars },
    platform: { name: c.preset.name, preset: c.preset },
    brand: c.brand,
    project: { id: c.project.id, title: c.project.title },
    song: { file: storedPath(ws, c.songFile), sha256: c.songHash, duration_ms: c.analysis.duration_ms },
    analysis: { bpm: c.analysis.bpm, downbeat_offset: c.analysis.downbeat_offset, downbeat_confidence: c.analysis.downbeat_confidence },
    section: { mode: c.chosen.mode, start_ms: c.chosen.start_ms, end_ms: c.chosen.end_ms, requested: c.chosen.requested, reason: c.chosen.reason },
    lyrics: {
      txt: c.alignment.lyricsTxt,
      txt_sha256: c.alignment.lyricsHash,
      lrc: c.alignment.lrcStored,
      lrc_sha256: c.alignment.lrcHash,
      source: c.alignment.source,
      hint: c.alignment.hint
        ? { file: c.alignment.hint.file, sha256: c.alignment.hint.hash, source: c.alignment.hint.source, stored: c.alignment.hint.stored }
        : null,
      lang: c.options.lang ?? "en",
      lead_ms: c.leadMs,
      lyrics_offset_ms: c.lyricsOffsetMs,
    },
    settings: {
      cut_rate: c.options.rate ?? "1x",
      energy: c.options.energy ?? "medium",
      early_cut_frames: 2,
      order: spec.order,
      seed: spec.seed,
      style: props.style,
      text_size: props.textSize,
      colour: props.colour,
      cinematic_bars: props.cinematicBars,
      font: c.options.font ?? null,
      font_hook: c.options.fontHook ?? null,
      hook_font: props.hookFont ?? null,
      pins: c.options.pins ? { file: path.resolve(c.options.pins), sha256: sha256File(c.options.pins) } : null,
      collection: { name: c.collection.collection.name, folder: c.collection.folder, clips: c.collection.sources.length, usable: c.clips.length },
      fps: VIDEO.fps,
      size: `${c.preset.width}x${c.preset.height}`,
      video: `H.264${c.preset.videoBitrate ? ` ${c.preset.videoBitrate}` : ""}, ${props.audio ? "AAC 192 kbps" : "no audio"}, yuv420p, faststart`,
      safe_zone: c.preset.safeZone,
      lyric_area: props.lyricArea,
    },
    clips: clips.map((k) => ({
      name: k.name,
      file: storedPath(ws, k.file),
      sha256: k.hash,
      normalised: k.path,
      normalised_sha256: sha256File(absPath(ws, k.path)),
    })),
    cuts: { frames: props.cutFrames, song_ms: props.cutFrames.map((f) => Math.round(((f + startFrame) * 1000) / VIDEO.fps)) },
    shots: props.shots.map((s, index) => ({
      index: index + 1,
      clip: nameBySrc.get(s.src) ?? s.src,
      start_frame: s.start,
      duration_frames: s.duration,
      clip_in_frame: s.clipStartFrame,
      clip_out_frame: Math.min(s.clipDurationFrames, s.clipStartFrame + Math.ceil(s.duration * s.playbackRate)),
      playback_rate: s.playbackRate,
      hold_last_frame: s.holdLastFrame,
    })),
    lyric_timings: c.visible.map((i, k) => ({
      number: c.numbers[i] || i + 1,
      text: c.lines[i].text,
      is_hook: c.lines[i].isHook,
      stamp_ms: c.lines[i].start_ms,
      end_ms: c.lines[i].end_ms,
      shown_from_ms: c.lines[i].start_ms - c.leadMs + c.lyricsOffsetMs,
      shown_until_ms: c.lines[i].end_ms - c.leadMs + c.lyricsOffsetMs,
      start_frame: props.lyrics[k].startFrame,
      end_frame: props.lyrics[k].endFrame,
      confidence: c.reports[i]?.confidence ?? null,
    })),
    fonts: props.fonts.map((f) => {
      const file = resolveMediaPath(f.src, c.media);
      return { family: f.family, weight: f.weight, style: f.style, src: f.src, sha256: file ? sha256File(file) : "" };
    }),
    props,
    output: { file: path.basename(c.file), duration_s: props.durationInFrames / VIDEO.fps, qa: c.qa.status },
    warnings: c.warnings,
  };
}

// --resume: what changed since the earlier run in `dir` (compared with one of its manifests), or null.
export function resumeMismatch(
  dir: string,
  specs: readonly VariationSpec[],
  now: {
    section: { start_ms: number; end_ms: number };
    lrcHash: string;
    leadMs: number;
    lyricsOffsetMs: number;
    cutFrames: number[];
    clipHashes: Set<string>;
    settings: Record<string, unknown>;
  },
): string | null {
  const existing = specs.map((s) => path.join(dir, `${s.name}.manifest.json`)).find((f) => existsSync(f));
  if (!existing) return null; // nothing finished yet: nothing to compare with
  const m = JSON.parse(readFileSync(existing, "utf8")) as Manifest;
  if (m.section.start_ms !== now.section.start_ms || m.section.end_ms !== now.section.end_ms) {
    return `the section changed (${clockText(m.section.start_ms)}-${clockText(m.section.end_ms)} then, ${clockText(now.section.start_ms)}-${clockText(now.section.end_ms)} now)`;
  }
  if (m.lyrics.lrc_sha256 !== now.lrcHash) return "the lyric timings changed";
  if (m.lyrics.lead_ms !== now.leadMs || m.lyrics.lyrics_offset_ms !== now.lyricsOffsetMs) return "the lyric lead or offset changed";
  if (JSON.stringify(m.cuts.frames) !== JSON.stringify(now.cutFrames)) return "the cuts changed";
  for (const key of Object.keys(now.settings)) {
    if (JSON.stringify(m.settings[key] ?? null) !== JSON.stringify(now.settings[key])) return `the setting ${key} changed`;
  }
  const gone = m.clips.filter((c) => !now.clipHashes.has(c.sha256)).map((c) => c.name);
  if (gone.length) return `clip(s) changed or removed: ${gone.join(", ")}`;
  return null;
}
