// Builds LyricVideo props from a song, an LRC file and a folder of clips. Shared by
// "pnpm render:test" and the studio's /preview page, so preview and export get the same props.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir, stylePreset, type StylePreset, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { Beat } from "../beats";
import { composeProps, DEFAULT_LEAD_MS, rawLyric, type RenderBase, type StyleChoice, type StyleEntry } from "../compose";
import { DEFAULT_HOOK_EFFECT, DEFAULT_VERSE_EFFECT } from "../effects";
import type { LyricEffectsProps } from "../props";
import { DEFAULT_BRAND } from "./brand";
import { AUDIO_FADE, VIDEO } from "../config";
import { getCutPoints, type CutPlan, type CutRate, type Energy } from "../cuts";
import { parseLrc, type TimedLine } from "../lrc";
import { matchPinClips, parsePins } from "../pins";
import type { LyricVideoProps, StyleProps, TextCase } from "../props";
import type { ClipOrder } from "../shots";
import { analyzeSong } from "./analysis";
import { prepareClips } from "./clips";
import { fontFileRefs, forText, loadFontCatalog, resolveFont, type FontCatalog, type FontFaceInfo } from "./font-catalog";
import { tooLongLines } from "./measure";
import type { MediaRoots } from "./media";

export type { StyleChoice };

export type PrepareOptions = {
  song?: string;
  clips?: string;
  lrc?: string;
  pins?: string; // default: pins.txt next to the default test files, if it exists
  section?: string; // "0:11-0:59"; default: from the first to the last lyric line
  rate?: CutRate;
  energy?: Energy;
  seed?: number;
  order?: ClipOrder;
  style?: StyleChoice;
  bars?: boolean;
  downbeatOffset?: number;
  earlyCutFrames?: number;
  leadMs?: number;
  lyricsOffsetMs?: number;
  font?: string; // font family for the lyrics (instead of the style's)
  fontHook?: string; // font family for hook lines
  textSize?: number;
  colour?: string;
  collection?: string;
  workspaceDir?: string;
  log?: (message: string) => void;
  effects?: LyricEffectsProps | null; // default: glide verses, karaoke-highlight hooks; null: the old fade
};

export const DEFAULT_EFFECTS: LyricEffectsProps = { verse: DEFAULT_VERSE_EFFECT, hook: DEFAULT_HOOK_EFFECT, accent: DEFAULT_BRAND.accentColour };

export type PrepareResult = {
  base: RenderBase; // everything except the quick choices (used by the /preview page)
  effects: LyricEffectsProps | null; // lyric effects passed to composeProps (the /preview page uses the same)
  props: Omit<LyricVideoProps, "mediaBaseUrl">; // composeProps(base, choices)
  media: MediaRoots;
  warnings: string[]; // pins, too-long lines
  setupWarnings: string[]; // pins.txt problems found while preparing (shown on /preview too)
  report: {
    song: string;
    lrc: string;
    clipsFolder: string;
    pinsFile: string | null;
    bpm: number;
    downbeatConfidence: number;
    requestedSection: { start_ms: number; end_ms: number };
    section: { start_ms: number; end_ms: number }; // start snapped to the nearest bar start
    plan: CutPlan;
    seed: number;
    order: ClipOrder;
    style: StyleChoice;
    clipCount: number;
    lyricLines: number;
    hookLines: number;
    pins: number;
    fonts: { main: string; hook: string | null };
  };
};

export const DEFAULT_SEED = 1;

export function testDefaults(workspaceDir = resolveWorkspaceDir()) {
  const dir = path.join(workspaceDir, "test");
  const song = ["song.wav", "song.mp3", "song.flac"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  return {
    song: song ?? path.join(dir, "song.wav"),
    clips: path.join(dir, "clips"),
    lrc: path.join(dir, "lyrics.lrc"),
    pins: path.join(dir, "pins.txt"),
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
  if (to === undefined) throw new Error("A section looks like 0:11-0:59");
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

const FALLBACK_STYLES: Record<StyleChoice, StylePresetLike> = {
  simple: { name: "Simple", font: "Inter", weight: 600, text_case: "none", effect: "none", animation: "fade", default_size: 64 },
  bold: { name: "Bold", font: "Montserrat", weight: 900, text_case: "upper", effect: "shadow", animation: "pop", default_size: 72 },
};
type StylePresetLike = Pick<StylePreset, "name" | "font" | "weight" | "text_case" | "effect" | "animation" | "default_size">;

export type StyleFaces = Record<StyleChoice, { entry: StyleEntry; main: FontFaceInfo; hook: FontFaceInfo | null; warnings: string[] }>;
// The recipe's weight and italic for the verse and hook fonts (absent: the style's own weight, upright).
export type FontChoice = { weight?: number; italic?: boolean };

// Simple and Bold from the database (or built-in defaults), with --font / --font-hook applied.
export function loadStyles(
  ws: Workspace,
  catalog: FontCatalog,
  options: { font?: string; fontHook?: string; textSize?: number; brandFonts?: { verse: string; hook: string }; verse?: FontChoice; hook?: FontChoice; text?: string },
): StyleFaces {
  // Brand fonts (brand.json) replace the styles' own fonts; --font / --font-hook win over both.
  if (options.brandFonts) {
    options = { ...options, font: options.font ?? options.brandFonts.verse, fontHook: options.fontHook ?? options.brandFonts.hook };
  }
  const presetFor = (choice: StyleChoice): StylePresetLike =>
    ws.db.select().from(stylePreset).where(eq(stylePreset.name, FALLBACK_STYLES[choice].name)).get() ?? FALLBACK_STYLES[choice];
  return {
    simple: styleEntry(catalog, presetFor("simple"), options),
    bold: styleEntry(catalog, presetFor("bold"), options),
  };
}

// Style + fonts for one preset: the lyric font (preset font, or --font) and an optional hook font.
// The exact weight / italic file (never synthetic); the nearest the family has otherwise, with a warning.
// `text`: the song's lyrics, so a CJK family loads only the pieces they use.
function styleEntry(
  catalog: FontCatalog,
  preset: StylePresetLike,
  options: { font?: string; fontHook?: string; textSize?: number; verse?: FontChoice; hook?: FontChoice; text?: string },
): { entry: StyleEntry; main: FontFaceInfo; hook: FontFaceInfo | null; warnings: string[] } {
  const verse = resolveFont(catalog, options.font ?? preset.font, options.verse?.weight ?? preset.weight, options.verse?.italic === true, "verse font");
  const hookResolved = options.fontHook ? resolveFont(catalog, options.fontHook, options.hook?.weight ?? preset.weight, options.hook?.italic === true, "hook font") : null;
  // A weight from the style itself (no recipe weight) falls back silently, as before.
  const warnings = [...(options.verse?.weight !== undefined || options.verse?.italic ? verse.warnings : []), ...(hookResolved && (options.hook?.weight !== undefined || options.hook?.italic) ? hookResolved.warnings : [])];
  const main = forText(verse.face, options.text);
  const hook = hookResolved ? forText(hookResolved.face, options.text) : null;
  const style: StyleProps = {
    name: preset.name,
    font: main.family,
    weight: main.weight,
    ...(main.style === "italic" ? { italic: true } : {}),
    textCase: preset.text_case as TextCase,
    effect: preset.effect,
    animation: preset.animation,
  };
  return {
    entry: {
      style,
      textSize: options.textSize ?? preset.default_size,
      hookFont: hook ? { font: hook.family, weight: hook.weight, ...(hook.style === "italic" ? { italic: true } : {}) } : null,
      fonts: [...fontFileRefs(main), ...(hook ? fontFileRefs(hook) : [])],
    },
    main,
    hook,
    warnings,
  };
}

// Finds each lyric line in the lyrics text file (lyrics.txt next to lyrics.lrc) so warnings can name
// the line number the user edits; falls back to the line number in the LRC file.
export function lyricLineNumbers(texts: readonly string[], lrcFile: string, txtFile?: string): { file: string; numbers: number[] } {
  const txt = txtFile ?? lrcFile.replace(/\.lrc$/i, ".txt");
  const useTxt = txt !== lrcFile && existsSync(txt);
  const file = useTxt ? txt : lrcFile;
  const fileLines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => (useTxt ? l : l.replace(/\[[^\]]*\]/g, "")).trim().replace(/^\*\s+/, ""));
  let from = 0;
  const numbers = texts.map((text) => {
    const index = fileLines.findIndex((l, i) => i >= from && l === text.trim());
    if (index < 0) return 0;
    from = index + 1;
    return index + 1;
  });
  return { file, numbers };
}

// The song is served from the workspace if it lives there, otherwise as an extra file.
export function songMedia(
  workspaceDir: string,
  song: string,
  plan: CutPlan,
  catalog: Pick<FontCatalog, "fontDirs">,
  fadeOutSeconds: number = AUDIO_FADE.outSeconds,
  fadeInSeconds: number = AUDIO_FADE.inSeconds,
): { media: MediaRoots; audio: NonNullable<RenderBase["audio"]> } {
  const insideWorkspace = path.relative(workspaceDir, song);
  const songInWorkspace = !insideWorkspace.startsWith("..") && !path.isAbsolute(insideWorkspace);
  const audioSrc = songInWorkspace ? insideWorkspace.split(path.sep).join("/") : `_ext/song${path.extname(song)}`;
  return {
    media: {
      workspaceDir,
      extraFiles: songInWorkspace ? {} : { [`song${path.extname(song)}`]: song },
      fontDirs: catalog.fontDirs,
    },
    audio: {
      src: audioSrc,
      startFrame: plan.start_frame,
      fadeInFrames: Math.round(fadeInSeconds * VIDEO.fps),
      fadeOutFrames: Math.round(fadeOutSeconds * VIDEO.fps),
    },
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
    const pinsFile = options.pins ? path.resolve(options.pins) : existsSync(defaults.pins) ? defaults.pins : null;
    const style = options.style ?? "simple";
    const order = options.order ?? "story";
    const seed = options.seed ?? DEFAULT_SEED;
    if (!existsSync(song)) throw new Error(`Song not found: ${song}`);
    if (pinsFile && !existsSync(pinsFile)) throw new Error(`Pins file not found: ${pinsFile}`);

    // Fonts first: a wrong --font name should fail before the slow steps.
    const catalog = loadFontCatalog(ws.dir);
    for (const problem of catalog.problems) log(`font file skipped: ${problem}`);
    const styles = loadStyles(ws, catalog, options);

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
    const preparedClips = clips.map((c) => ({
      id: c.clip.id,
      name: c.name,
      duration_ms: c.durationMs,
      path: c.path,
      durationFrames: c.durationFrames,
    }));

    const setupWarnings: string[] = [];
    let pins: RenderBase["pins"] = [];
    if (pinsFile) {
      const parsed = parsePins(readFileSync(pinsFile, "utf8"));
      const matched = matchPinClips(parsed.rules, preparedClips);
      pins = matched.pins;
      setupWarnings.push(...parsed.warnings, ...matched.warnings);
    }
    const warnings = [...setupWarnings];

    const { media, audio } = songMedia(ws.dir, song, plan, catalog);
    const effects = options.effects === undefined ? DEFAULT_EFFECTS : options.effects;
    const base: RenderBase = {
      plan,
      clips: preparedClips,
      audio,
      durationInFrames: plan.end_frame - plan.start_frame,
      lyrics: lines.map(rawLyric),
      styles: { simple: styles.simple.entry, bold: styles.bold.entry },
      colour: options.colour ?? "#ffffff",
      cinematicBars: options.bars ?? false,
      pins,
    };
    const composed = composeProps(base, {
      seed,
      style,
      order,
      leadMs: options.leadMs ?? DEFAULT_LEAD_MS,
      lyricsOffsetMs: options.lyricsOffsetMs ?? 0,
      textSize: options.textSize,
      ...(effects ? { effects } : {}),
    });
    warnings.push(...composed.warnings);

    // Lines too long for phone screens with the chosen fonts (in the section).
    const chosen = styles[style];
    const visible = new Set(composed.props.lyrics.map((l) => l.text));
    const tooLong = tooLongLines(
      lines.filter((l) => visible.has(l.text)),
      { main: chosen.main, hook: chosen.hook, textCase: chosen.entry.style.textCase, textSize: composed.props.textSize },
    );
    if (tooLong.length) {
      const { file, numbers } = lyricLineNumbers(lines.map((l) => l.text), lrcFile);
      const tooLongSet = new Set(tooLong);
      lines.forEach((l, i) => {
        if (tooLongSet.has(l)) {
          warnings.push(
            `Line ${numbers[i] || i + 1} is too long for phone screens; split it in ${path.basename(file)}: "${l.text}"`,
          );
        }
      });
    }

    return {
      base,
      effects,
      props: composed.props,
      media,
      warnings,
      setupWarnings,
      report: {
        song,
        lrc: lrcFile,
        clipsFolder,
        pinsFile,
        bpm: analysis.bpm,
        downbeatConfidence: analysis.downbeat_confidence,
        requestedSection: requested,
        section,
        plan,
        seed,
        order,
        style,
        clipCount: clips.length,
        lyricLines: composed.props.lyrics.length,
        hookLines: composed.props.lyrics.filter((l) => l.isHook).length,
        pins: pins.length,
        fonts: { main: `${chosen.main.family} ${chosen.main.weight}`, hook: chosen.hook ? `${chosen.hook.family} ${chosen.hook.weight}` : null },
      },
    };
  } finally {
    ws.close();
  }
}
