// "pnpm make": one song + lyrics.txt + a collection of clips -> N finished variations, each with a
// manifest and a QA report. Steps: project (by song hash) -> beats (cached) -> lyric alignment
// (stored, never rewritten) -> section -> collection import -> cuts -> N variations rendered in
// parallel -> QA -> manifest.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  absPath,
  lyricLine as lyricLineTable,
  openWorkspace,
  project as projectTable,
  renderJob as renderJobTable,
  resolveWorkspaceDir,
  section as sectionTable,
  storedPath,
  stylePreset,
  variation as variationTable,
  type Workspace,
} from "@lyric/db";
import { eq } from "drizzle-orm";

import type { Beat } from "../beats";
import { composeProps, DEFAULT_LEAD_MS, lyricFrames, type RenderBase, type StyleChoice } from "../compose";
import { VIDEO } from "../config";
import { getCutPoints, type CutRate, type Energy } from "../cuts";
import { matchPinClips, parsePins } from "../pins";
import type { LyricVideoProps } from "../props";
import { formatQa, LOW_CONFIDENCE, runQa, type QaReport } from "../qa";
import { autoSection, clockText, finishedBeforeStart, type SectionLine } from "../section";
import type { ClipOrder } from "../shots";
import { analyzeSong } from "./analysis";
import { syncCollection, type CollectionSync } from "./collection";
import { loadFontCatalog } from "./font-catalog";
import { sha256File, toolInfo, writeManifest, type Manifest } from "./manifest";
import { resolveMediaPath, type MediaRoots } from "./media";
import { tooLongLines } from "./measure";
import { loadStyles, lyricLineNumbers, parseSection, snapToDownbeat, songMedia, type StyleFaces } from "./prepare";
import { detectBadFrames, measureLyrics } from "./qa-check";
import { getBundle, renderLyricVideo } from "./render";
import { ensureAlignment, findOrCreateSongProject, matchReport, type Alignment, type AlignRunner } from "./song-project";

export type MakeOptions = {
  song: string;
  lyrics: string; // lyrics.txt
  collection: string;
  collectionPath?: string;
  variations?: number; // default 6
  section?: string; // "auto" (default) | "full" | "0:11-1:10"
  hint?: string;
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
  workspaceDir?: string;
  command?: string;
  now?: Date;
  align?: AlignRunner;
  log?: (message: string) => void;
  onRenderProgress?: (state: RenderState[]) => void;
  onReady?: (info: MakePlan) => void; // everything decided, rendering starts
};

export type MakePlan = {
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
  warnings: string[];
  notes: string[];
};

export type RenderState = { name: string; status: "queued" | "rendering" | "checking" | "done" | "failed"; progress: number };

export type VariationSpec = { index: number; name: string; order: ClipOrder; seed: number; style: StyleChoice; bars: boolean };

export type VariationResult = VariationSpec & {
  file: string;
  manifestFile: string;
  qaFile: string;
  durationS: number;
  qa: QaReport | null;
  error: string | null;
};

export type MakeResult = {
  projectTitle: string;
  exportDir: string;
  section: { start_ms: number; end_ms: number; reason: string };
  limit: RenderLimit;
  variations: VariationResult[];
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

export type RenderLimit = { parallel: number; concurrency: number; explanation: string };

// How many videos to render at the same time. One Remotion render already uses several CPU threads
// (one browser tab per thread, "concurrency"), so a second render in parallel helps keep the CPU busy
// between frames and while FFmpeg encodes; more than two only adds memory. Each tab at 1080x1920
// needs about 0.5 GB, plus about 1 GB per render for FFmpeg and the video decoder; the total is kept
// under half of the PC's memory.
export function renderLimit(cpus = os.cpus().length, memoryGB = os.totalmem() / 2 ** 30, requested?: number): RenderLimit {
  const recommended = cpus >= 8 && memoryGB >= 16 ? 2 : 1;
  const parallel = Math.max(1, requested ?? recommended);
  let concurrency = Math.max(1, Math.min(8, Math.floor(cpus / parallel)));
  const estimate = () => parallel * (concurrency * 0.5 + 1);
  while (concurrency > 1 && estimate() > memoryGB / 2) concurrency -= 1;
  const explanation =
    `${parallel} video${parallel > 1 ? "s" : ""} at a time, ${concurrency} frame${concurrency > 1 ? "s" : ""} in parallel each ` +
    `(${cpus} CPU threads, ${Math.round(memoryGB)} GB memory; about ${Math.round(estimate())} GB used at most)` +
    (requested ? (requested > recommended ? `; --parallel ${requested} is above the recommended ${recommended}` : "") : "");
  return { parallel, concurrency, explanation };
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

type SectionChoiceOut = { mode: string; start_ms: number; end_ms: number; requested: { start_ms: number; end_ms: number } | null; reason: string; warnings: string[] };

function chooseSection(mode: string, lines: SectionLine[], beats: Beat[], durationMs: number, leadMs: number): SectionChoiceOut {
  if (mode === "auto") {
    const s = autoSection(lines, beats, { durationMs, leadMs });
    return { mode, start_ms: s.start_ms, end_ms: s.end_ms, requested: null, reason: s.reason, warnings: s.warnings };
  }
  const requested = mode === "full" ? { start_ms: 0, end_ms: durationMs } : parseSection(mode);
  requested.end_ms = Math.min(requested.end_ms, durationMs);
  const start = snapToDownbeat(beats, requested.start_ms);
  const snapped = start !== requested.start_ms ? ` (start snapped from ${clockText(requested.start_ms)} to the nearest bar start)` : "";
  const reason = `${mode === "full" ? "whole song" : "as given"}: ${clockText(start)} - ${clockText(requested.end_ms)}${snapped}; ${((requested.end_ms - start) / 1000).toFixed(1)} s`;
  if (requested.end_ms - start < 1000) throw new Error("The section is shorter than 1 second.");
  return { mode, start_ms: start, end_ms: requested.end_ms, requested, reason, warnings: [] };
}

export async function makeVideos(options: MakeOptions): Promise<MakeResult> {
  const log = options.log ?? (() => {});
  const count = options.variations ?? 6;
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--variations must be a whole number from 1 to 24");
  const leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
  const now = options.now ?? new Date();
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  try {
    for (const f of [options.song, options.lyrics]) if (!existsSync(f)) throw new Error(`File not found: ${f}`);

    // Fonts first: a wrong --font name should fail before the slow steps.
    const catalog = loadFontCatalog(ws.dir);
    for (const problem of catalog.problems) log(`font file skipped: ${problem}`);
    const styles = loadStyles(ws, catalog, { font: options.font, fontHook: options.fontHook });

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
    const lyricsOffsetMs = project.lyrics_offset_ms;

    const alignment = await ensureAlignment(ws, { ...sp, project }, {
      lyricsTxt: path.resolve(options.lyrics),
      hint: options.hint ? path.resolve(options.hint) : undefined,
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

    // Section (lines appear `leadMs` early and move by the lyrics offset).
    const sectionLines: SectionLine[] = lines.map((l, i) => ({ ...l, sung_end_ms: reports[i]?.end_ms }));
    const chosen = chooseSection(options.section ?? "auto", sectionLines, analysis.beats, analysis.duration_ms, leadMs - lyricsOffsetMs);
    log(`section ${clockText(chosen.start_ms)} - ${clockText(chosen.end_ms)}`);
    const sectionRow = ws.db
      .insert(sectionTable)
      .values({ project_id: project.id, name: `make (${chosen.mode})`, start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" })
      .returning()
      .get();

    const collection = await syncCollection(ws, { name: options.collection, folder: options.collectionPath, log });

    const plan = getCutPoints(analysis.beats, { start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" }, {
      cutRate: options.rate ?? "1x",
      lyricLines: lines,
    });
    const preparedClips = collection.clips.map((c) => ({ id: c.clip.id, name: c.name, duration_ms: c.durationMs, path: c.path, durationFrames: c.durationFrames }));

    const warnings = [...chosen.warnings];
    let pins: RenderBase["pins"] = [];
    if (options.pins) {
      const parsed = parsePins(readFileSync(options.pins, "utf8"));
      const matched = matchPinClips(parsed.rules, preparedClips);
      pins = matched.pins;
      warnings.push(...parsed.warnings, ...matched.warnings);
    }

    const { media, audio } = songMedia(ws.dir, sp.songFile, plan, catalog);
    const allLyrics = lines.map((l) => ({ text: l.text, start_ms: l.start_ms, end_ms: l.end_ms, isHook: l.isHook }));
    // A line whose singing is over but which is still on screen at the start (it lingers until the
    // next stamp) is not shown, so the video never opens on the tail of the previous line.
    const hidden = finishedBeforeStart(sectionLines, chosen.start_ms, leadMs, lyricsOffsetMs);
    const shown = lines.map((_, i) => i).filter((i) => !hidden.includes(i));
    const base: RenderBase = {
      plan,
      clips: preparedClips,
      audio,
      durationInFrames: plan.end_frame - plan.start_frame,
      lyrics: shown.map((i) => allLyrics[i]),
      styles: { simple: styles.simple.entry, bold: styles.bold.entry },
      colour: "#ffffff",
      cinematicBars: false,
      pins,
    };

    // Which lines are on screen (same rule as composeProps) and their numbers in lyrics.txt.
    const frames = lyricFrames(base, leadMs, lyricsOffsetMs);
    const visible = frames
      .map((f, k) => ({ i: shown[k], start: Math.max(0, f.startFrame), end: Math.min(base.durationInFrames, f.endFrame) }))
      .filter((v) => v.end > v.start)
      .map((v) => v.i);
    const numbers = lyricLineNumbers(lines.map((l) => l.text), alignment.lrcFile, alignment.lyricsTxt).numbers;
    const notes = hidden.map((i) => `line ${numbers[i] || i + 1} "${lines[i].text}" is not shown: it was sung before the section starts`);
    for (const style of ["simple", "bold"] as const) {
      const s = styles[style];
      for (const l of tooLongLines(visible.map((i) => lines[i]), { main: s.main, hook: s.hook, textCase: s.entry.style.textCase, textSize: s.entry.textSize })) {
        const n = numbers[lines.indexOf(l)] || lines.indexOf(l) + 1;
        warnings.push(`Line ${n} is too long for phone screens (${s.entry.style.name}); split it in ${path.basename(alignment.lyricsTxt)}: "${l.text}"`);
      }
    }

    const exportDir = exportFolder(ws, project.id, now);
    const limit = renderLimit(undefined, undefined, options.parallel);
    const specs = planVariations(count);
    const tool = toolInfo();
    options.onReady?.({
      project: { title: project.title, created: sp.created },
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
        name: collection.collection.name,
        folder: collection.folder,
        clips: collection.clips.length,
        added: collection.added.length,
        changed: collection.changed.length,
        unchanged: collection.unchanged.length,
        removed: collection.removed.length,
      },
      cuts: plan.cuts.length,
      limit,
      exportDir,
      warnings: [...warnings],
      notes,
    });
    const states: RenderState[] = specs.map((s) => ({ name: s.name, status: "queued", progress: 0 }));
    const report = () => options.onRenderProgress?.(states.map((s) => ({ ...s })));
    const results: VariationResult[] = [];

    const jobs = specs.map((spec) => {
      const composed = composeProps(base, { seed: spec.seed, style: spec.style, order: spec.order, leadMs, lyricsOffsetMs, cinematicBars: spec.bars });
      warnings.push(...composed.warnings.map((w) => `${spec.name}: ${w}`));
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
          overrides_json: { order: spec.order, lead_ms: leadMs, lyrics_offset_ms: lyricsOffsetMs, font: options.font ?? null, font_hook: options.fontHook ?? null, lrc: alignment.lrcStored },
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
      const state = states[spec.index - 1];
      const file = path.join(exportDir, `${spec.name}.mp4`);
      const result: VariationResult = {
        ...spec,
        file,
        manifestFile: path.join(exportDir, `${spec.name}.manifest.json`),
        qaFile: path.join(exportDir, `${spec.name}.qa.txt`),
        durationS: props.durationInFrames / VIDEO.fps,
        qa: null,
        error: null,
      };
      results.push(result);
      state.status = "rendering";
      report();
      updateJob(jobId, { status: "rendering", started_at: new Date(), progress: 0 });
      let lastSaved = 0;
      try {
        await getBundle(log); // built once, shared by the parallel renders
        await renderLyricVideo({
          props,
          media,
          outFile: file,
          concurrency: limit.concurrency,
          onProgress: (p) => {
            state.progress = p;
            report();
            if (p - lastSaved >= 0.05) {
              lastSaved = p;
              updateJob(jobId, { progress: Math.min(1, p) });
            }
          },
        });
        state.status = "checking";
        report();
        const qa = await checkVariation(spec, props, file, { lines, visible, numbers, reports, styles, collection, frameCheck: options.frameCheck ?? true });
        result.qa = qa;
        writeFileSync(result.qaFile, formatQa(qa, qaTitle(spec, project.title, chosen)));
        writeManifest(
          result.manifestFile,
          buildManifest({
            ws, tool, spec, props, media, project, songHash: sp.songHash, songFile: sp.songFile, analysis, chosen, alignment, reports, numbers, visible, lines,
            leadMs, lyricsOffsetMs, options, collection, file, qa, now, warnings,
          }),
        );
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

    project = ws.db.select().from(projectTable).where(eq(projectTable.id, project.id)).get()!;
    return {
      projectTitle: project.title,
      exportDir,
      section: { start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason },
      limit,
      variations: results.sort((a, b) => a.index - b.index),
      warnings,
    };
  } finally {
    ws.close();
  }
}

function qaTitle(spec: VariationSpec, title: string, section: SectionChoiceOut): string {
  return (
    `${title} - ${spec.name}: ${spec.style === "simple" ? "Simple" : "Bold"}, ${spec.order}` +
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
    collection: CollectionSync;
    frameCheck: boolean;
  },
): Promise<QaReport> {
  const style = ctx.styles[spec.style];
  const nameBySrc = new Map(ctx.collection.clips.map((c) => [c.path, c.name]));
  const lyrics = ctx.visible.map((i, k) => ({
    ...props.lyrics[k],
    number: ctx.numbers[i] || i + 1,
    confidence: ctx.reports[i]?.confidence ?? null,
  }));
  return runQa({
    props,
    shotClips: props.shots.map((s) => nameBySrc.get(s.src) ?? s.src),
    poolSize: ctx.collection.clips.length,
    lyrics: measureLyrics(lyrics, {
      main: style.main,
      hook: style.hook,
      textCase: style.entry.style.textCase,
      textSize: props.textSize,
      animation: style.entry.style.animation,
    }),
    frames: ctx.frameCheck ? await detectBadFrames(file, props.durationInFrames / VIDEO.fps) : null,
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
  file: string;
  qa: QaReport;
  now: Date;
  warnings: string[];
}): Manifest {
  const { props, spec, ws } = c;
  const startFrame = props.audio?.startFrame ?? 0;
  const used = new Set(props.shots.map((s) => s.src));
  const clips = c.collection.clips.filter((k) => used.has(k.path));
  const nameBySrc = new Map(clips.map((k) => [k.path, k.name]));
  return {
    manifest_version: 1,
    tool: c.tool,
    created_at: c.now.toISOString(),
    command: c.options.command ?? "pnpm make",
    variation: { index: spec.index, name: spec.name, order: spec.order, seed: spec.seed, style: props.style.name, cinematic_bars: spec.bars },
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
      hint: c.alignment.hint ? { file: c.alignment.hint.file, sha256: c.alignment.hint.hash } : null,
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
      collection: { name: c.collection.collection.name, folder: c.collection.folder, clips: c.collection.clips.length },
      fps: VIDEO.fps,
      size: `${VIDEO.width}x${VIDEO.height}`,
      video: "H.264, AAC 192 kbps, yuv420p, faststart",
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
