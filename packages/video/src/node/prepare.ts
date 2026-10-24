// Builds LyricVideo props from a song, an LRC file and a folder of clips. Shared by
// "pnpm render:test" and the studio's /preview page, so preview and export get the same props.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, stylePreset, type StylePreset } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { Beat } from "../beats";
import { AUDIO_FADE, VIDEO } from "../config";
import { getCutPoints, type CutPlan, type CutRate, type Energy } from "../cuts";
import { parseLrc, type TimedLine } from "../lrc";
import { composeProps, type RenderBase, type StyleChoice } from "../compose";
import type { LyricVideoProps, StyleProps, TextCase } from "../props";
import { analyzeSong } from "./analysis";
import { prepareClips } from "./clips";
import { tooLongLines } from "./measure";
import { defaultFontDirs } from "./font-dirs";
import type { MediaRoots } from "./media";

export type { StyleChoice };

export type PrepareOptions = {
  song?: string;
  clips?: string;
  lrc?: string;
  section?: string; // "0:11-0:59"; default: from the first to the last lyric line
  rate?: CutRate;
  energy?: Energy;
  seed?: number;
  style?: StyleChoice;
  bars?: boolean;
  downbeatOffset?: number;
  earlyCutFrames?: number;
  textSize?: number;
  colour?: string;
  collection?: string;
  workspaceDir?: string;
  log?: (message: string) => void;
};

export type PrepareResult = {
  base: RenderBase; // everything except seed/style choices (used by the /preview page)
  props: Omit<LyricVideoProps, "mediaBaseUrl">; // composeProps(base, seed, style)
  media: MediaRoots;
  report: {
    song: string;
    lrc: string;
    clipsFolder: string;
    bpm: number;
    downbeatConfidence: number;
    requestedSection: { start_ms: number; end_ms: number };
    section: { start_ms: number; end_ms: number }; // start snapped to the nearest bar start
    plan: CutPlan;
    seed: number;
    style: StyleChoice;
    clipCount: number;
    lyricLines: number;
    // Lines that need the 3-line last resort, with their line number in the lyrics file.
    longLines: { lineNumber: number; file: string; text: string }[];
  };
};

// Finds each lyric line in the lyrics text file (lyrics.txt next to lyrics.lrc) so warnings can name
// the line number the user edits; falls back to the line number in the LRC file.
export function lyricLineNumbers(texts: readonly string[], lrcFile: string): { file: string; numbers: number[] } {
  const txt = lrcFile.replace(/\.lrc$/i, ".txt");
  const useTxt = txt !== lrcFile && existsSync(txt);
  const file = useTxt ? txt : lrcFile;
  const fileLines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => (useTxt ? l : l.replace(/\[[^\]]*\]/g, "")).trim());
  let from = 0;
  const numbers = texts.map((text) => {
    const index = fileLines.findIndex((l, i) => i >= from && l === text.trim());
    if (index < 0) return 0;
    from = index + 1;
    return index + 1;
  });
  return { file, numbers };
}

export const DEFAULT_SEED = 1;

export function testDefaults(workspaceDir = resolveWorkspaceDir()) {
  const dir = path.join(workspaceDir, "test");
  const song = ["song.wav", "song.mp3", "song.flac"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  return {
    song: song ?? path.join(dir, "song.wav"),
    clips: path.join(dir, "clips"),
    lrc: path.join(dir, "lyrics.lrc"),
    out: path.join(dir, "renders"),
  };
}

// "1:05.5" -> 65500
export function parseClock(text: string): number {
  const parts = text.trim().split(":");
  const valid = parts.length <= 2 && parts.every((p) => p !== "" && !Number.isNaN(Number(p)));
  if (!valid) throw new Error(`Not a time: "${text}" (use m:ss)`);
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Math.round(seconds * 1000);
}

export function parseSection(text: string): { start_ms: number; end_ms: number } {
  const [from, to] = text.split("-");
  if (to === undefined) throw new Error('A section looks like 0:11-0:59');
  const section = { start_ms: parseClock(from), end_ms: parseClock(to) };
  if (section.end_ms <= section.start_ms) throw new Error("The section must end after it starts.");
  return section;
}

// The downbeat nearest to `ms` (beats already carry the downbeat offset).
export function snapToDownbeat(beats: readonly Beat[], ms: number): number {
  let best: number | null = null;
  for (const b of beats) {
    if (b.is_downbeat && (best === null || Math.abs(b.time_ms - ms) < Math.abs(best - ms))) best = b.time_ms;
  }
  return best ?? ms;
}

function styleProps(row: StylePreset | undefined, choice: StyleChoice): StyleProps {
  const fallback: Record<StyleChoice, StyleProps> = {
    simple: { name: "Simple", font: "Inter", weight: 600, textCase: "none", effect: "none", animation: "fade" },
    bold: { name: "Bold", font: "Montserrat", weight: 900, textCase: "upper", effect: "shadow", animation: "pop" },
  };
  if (!row) return fallback[choice];
  return {
    name: row.name,
    font: row.font,
    weight: row.weight,
    textCase: row.text_case as TextCase,
    effect: row.effect,
    animation: row.animation,
  };
}

export async function prepareRender(options: PrepareOptions = {}): Promise<PrepareResult> {
  const log = options.log ?? (() => {});
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  try {
    const defaults = testDefaults(ws.dir);
    const song = path.resolve(options.song ?? defaults.song);
    const clipsFolder = path.resolve(options.clips ?? defaults.clips);
    const lrcFile = path.resolve(options.lrc ?? defaults.lrc);
    const style = options.style ?? "simple";
    const seed = options.seed ?? DEFAULT_SEED;
    if (!existsSync(song)) throw new Error(`Song not found: ${song}`);

    log("analysing the song (cached after the first time)");
    const analysis = analyzeSong(song, { downbeatOffset: options.downbeatOffset });
    const beats = analysis.beats; // the downbeat offset is already applied by the analysis

    let lines: TimedLine[] = [];
    if (existsSync(lrcFile)) lines = parseLrc(readFileSync(lrcFile, "utf8"), analysis.duration_ms);
    else if (options.lrc) throw new Error(`Lyrics file not found: ${lrcFile}`);
    else log(`no lyrics file at ${lrcFile}; rendering without lyrics`);

    let requested: { start_ms: number; end_ms: number };
    if (options.section) requested = parseSection(options.section);
    else if (lines.length) requested = { start_ms: lines[0].start_ms, end_ms: lines[lines.length - 1].end_ms };
    else throw new Error("No --section given and no lyrics to take it from.");
    requested.end_ms = Math.min(requested.end_ms, analysis.duration_ms);

    // The video starts on a bar: snap the section start to the nearest downbeat.
    const section = { start_ms: snapToDownbeat(beats, requested.start_ms), end_ms: requested.end_ms };
    if (section.end_ms - section.start_ms < 1000) throw new Error("The section is shorter than 1 second.");

    const plan = getCutPoints(beats, { ...section, energy: options.energy ?? "medium" }, {
      cutRate: options.rate ?? "1x",
      earlyCutFrames: options.earlyCutFrames,
      lyricLines: lines,
    });

    const clips = await prepareClips(ws, clipsFolder, options.collection ?? "test", log);

    const durationInFrames = plan.end_frame - plan.start_frame;
    const toFrame = (ms: number) => Math.round((ms * VIDEO.fps) / 1000) - plan.start_frame;
    const lyrics = lines
      .map((l) => ({ text: l.text, startFrame: Math.max(0, toFrame(l.start_ms)), endFrame: Math.min(durationInFrames, toFrame(l.end_ms)) }))
      .filter((l) => l.endFrame > l.startFrame);

    const presetFor = (choice: StyleChoice) =>
      ws.db.select().from(stylePreset).where(eq(stylePreset.name, choice === "bold" ? "Bold" : "Simple")).get();
    const styleEntry = (choice: StyleChoice) => {
      const preset = presetFor(choice);
      return { style: styleProps(preset, choice), textSize: preset?.default_size ?? (choice === "bold" ? 84 : 64) };
    };

    // The song is served from the workspace if it lives there, otherwise as an extra file.
    const insideWorkspace = path.relative(ws.dir, song);
    const songInWorkspace = !insideWorkspace.startsWith("..") && !path.isAbsolute(insideWorkspace);
    const audioSrc = songInWorkspace ? insideWorkspace.split(path.sep).join("/") : `_ext/song${path.extname(song)}`;
    const media: MediaRoots = {
      workspaceDir: ws.dir,
      extraFiles: songInWorkspace ? {} : { [`song${path.extname(song)}`]: song },
      fontDirs: defaultFontDirs(),
    };

    const base: RenderBase = {
      plan,
      clips: clips.map((c) => ({ id: c.clip.id, duration_ms: c.durationMs, path: c.path, durationFrames: c.durationFrames })),
      audio: {
        src: audioSrc,
        startFrame: plan.start_frame,
        fadeInFrames: Math.round(AUDIO_FADE.inSeconds * VIDEO.fps),
        fadeOutFrames: Math.round(AUDIO_FADE.outSeconds * VIDEO.fps),
      },
      durationInFrames,
      lyrics,
      styles: { simple: styleEntry("simple"), bold: styleEntry("bold") },
      colour: options.colour ?? "#ffffff",
      cinematicBars: options.bars ?? false,
    };
    const props = composeProps(base, { seed, style, textSize: options.textSize });

    return {
      base,
      props,
      media,
      report: {
        song,
        lrc: lrcFile,
        clipsFolder,
        bpm: analysis.bpm,
        downbeatConfidence: analysis.downbeat_confidence,
        requestedSection: requested,
        section,
        plan,
        seed,
        style,
        clipCount: clips.length,
        lyricLines: lyrics.length,
        longLines: (() => {
          const tooLong = new Set(tooLongLines(lines.map((l) => l.text), props.style, props.textSize).map((l) => l.text));
          if (!tooLong.size) return [];
          const { file, numbers } = lyricLineNumbers(lines.map((l) => l.text), lrcFile);
          return lines
            .map((l, i) => ({ lineNumber: numbers[i] || i + 1, file: path.basename(file), text: l.text }))
            .filter((l) => tooLong.has(l.text));
        })(),
      },
    };
  } finally {
    ws.close();
  }
}
