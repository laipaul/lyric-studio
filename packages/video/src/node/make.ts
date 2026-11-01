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
  probeMedia,
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

import { audioPlan, type AudioPlan } from "../audio";
import { CHECKED_BY_EAR_FILE, checkedByEar, type EarCheck } from "../checked-by-ear";
import { compareAudio, readLoopAudio } from "./audio-check";
import type { Beat } from "../beats";
import { composeProps, DEFAULT_LEAD_MS, lyricFrames, rawLyric, type PlatformLayout, type RenderBase, type StyleChoice } from "../compose";
import { choiceText, parseEffectChoice, type EffectChoice } from "../effects";
import { cleanLrc } from "../lrc";
import { areaForLayout, BIG_HOOK_SCALE, type TextLayout } from "../text-layout";
import { choosePlatforms, lyricArea, parsePresets, sectionWindow, STANDARD, type LyricArea, type PlatformPreset } from "../platform";
import { VIDEO } from "../config";
import { getCutPoints, type CutRate, type Energy, type ShotLength } from "../cuts";
import { bestMoments } from "./best-moment";
import { clipBandLuminances } from "./lyric-band";
import { isThinFace, lyricBackingFor, type BackingDecision, type Readability } from "../readability";
import { pictureOf } from "../picture";
import { editOf, rankOf, readClipEdits } from "./clip-edits";
import { boardForRun, cardFont, cardMeasure, overrideCount, TITLE_SIZE_VERTICAL, titleCards, type RunBoard } from "./textboard";
import { extraCards, fillCardText } from "../extra-cards";
import { matchPinClips, parsePins } from "../pins";
import type { LyricEffectsProps, LyricVideoProps } from "../props";
import { formatQa, LOW_CONFIDENCE, qaReasons, runQa, type QaInput, type QaReport } from "../qa";
import { autoSection, clockText, titleLeadMs, finishedBeforeStart, SECTION_TARGET, sectionCuts, startsAfterEnd, sungEnd, sungStart, type SectionCut, type SectionLine } from "../section";
import { loopFit, loopFlows, loopSuggestions, type LoopAudio, type LoopResult, type LoopSuggestion } from "../loop";
import { chooseEnding, type Ending, type EndingChoice } from "../ending";
import { choosePace, songFeel, type Pace } from "../pace";
import type { TransitionStyle } from "../transitions";
import { anchorsInside, type AnchorSpec, type GapOrder, type ResolvedAnchor } from "../anchors";
import type { AnchorReport, AnchorTransitions } from "../compose";
import { RECENT_WINDOW, type ClipOrder } from "../shots";
import { lyricCardStyle } from "../textboard";
import type { FontFileRef } from "../font-files";
import { analyzeSong } from "./analysis";
import { loadBrand, type Brand } from "./brand";
import { artistBrandFile } from "./captions";
import { readProjectSettings, rememberCollection, rememberedCollection, updateProjectSettings } from "./project-settings";
import { PLATFORM_FIELDS, type PlatformField } from "./per-platform";
import { pickedLinks, type SongLink } from "../song-links";
import { artistRecipe, LIBRARY_RECIPE, readRecipe, recipeSummary, recipeText, resolveRecipe, runRecipe, writeRecipe, type RecipeField, type RecipeInput, type RecipeValues, type ResolvedRecipe } from "./recipe";
import { renameSongFolder, songPathsById, STORY_FILE } from "./song-folder";
import { ensureSongTheme, loadTheme, themeLayer } from "./themes";
import { barStarts, rmsLevel, strongestStretch } from "../story";
import { mergeCollections, prepareForFormat, SOURCE_FILE, syncCollection, type CollectionSync, type PreparedForFormat } from "./collection";
import { fontFileRefs, forText, loadFontCatalog, missingCharacters, resolveFace, type FontCatalog } from "./font-catalog";
import { sha256File, toolInfo, writeManifest, type Manifest } from "./manifest";
import { findPairing, loadPairings } from "./pairings";
import { resolveMediaPath, type MediaRoots } from "./media";
import { tooLongLines } from "./measure";
import { cardBlocks, fitCardBlocks, gridCrop } from "../text-cards";
import { loadStyles, lyricLineNumbers, parseSection, snapToDownbeat, songMedia, type StyleFaces } from "./prepare";
import { detectBadFrames, measureLyrics } from "./qa-check";
import { getBundle, renderCover, renderLyricVideo, renderThumbnail, type RenderOptions } from "./render";
import { voiceRecord } from "./voice-source";
import { applyHandSet, applyVocalGuard, ensureAlignment, findOrCreateSongProject, matchReport, type Alignment, type AlignRunner, type VoiceMapRunner, type FirstWordsRunner } from "./song-project";
import { COVER_TEXT_SCALE } from "../youtube-layout";
import { endScreenText, lyricSections } from "../youtube";
import { loopCheck, planCanvas, type CanvasPlan } from "./canvas";
import {
  blurredBackground,
  placeLogo,
  type LogoImage,
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
  songFolder?: string; // "pnpm make <song folder>" (song and lyrics come from it)
  collection?: string; // shared collection(s), "wedding" or "wedding,beach"; default: song.json, else the one used last time
  collectionPath?: string;
  // Picture versions: one video per clip set with the same textboard, "song+wedding,city" (sets by
  // commas, parts by "+"; "song" = the song's own clips). Not saved to the song.
  pictures?: string;
  // One clip set for this run instead of the recipe's (the storyboard's picture swap), never saved.
  clipSet?: string;
  variations?: number; // default: the platform preset's number (standard: 6)
  take?: number; // "Try another take": only variation N of each platform (vN: its own seed and style), not v1..vN
  platforms?: string; // "reels,tiktok,shorts" or "all"; default: the "standard" preset
  allowFill?: boolean; // use sources of the other orientation, shown whole over a blurred copy
  title?: string; // song title (saved to the project; default: the song's file name)
  artist?: string; // saved to the project (default "Life Lyrics"); its brand folder brand\<artist>\ if there is one
  ep?: string; // publish.txt: 'From the EP "<name>"'
  cover?: string; // YouTube cover layout: the square cover image (stored with the project)
  layout?: YouTubeLayout; // YouTube layout (default from the preset: cover)
  stills?: string; // YouTube stills layout: stills.txt (default: next to lyrics.txt, else in the collection folder)
  grain?: boolean; // YouTube stills: film grain (default from the preset)
  glow?: boolean; // YouTube stills: beat-pulsed glow (default from the preset)
  presetsFile?: string; // default: presets/platforms.json
  section?: string; // "auto" | "full" | "0:11-1:10" (default: song.json, else auto)
  length?: number; // seconds an "auto" section aims for, on every platform (default: song.json / brand / the preset)
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
  weight?: number; // verse font weight (100-900; the exact file, the nearest with a warning)
  hookWeight?: number;
  italic?: boolean; // verse font italic (the family's italic file, never synthetic)
  hookItalic?: boolean;
  pairings?: string; // "elegant,dramatic": one video per pairing (presets/font-pairings.json), all else the same
  shotLength?: string; // "1" | "2" | "4" | "8" bars per shot, or "story" (2 bars on hooks, 4 on verses, >= 3 s); replaces --rate
  paceShift?: number; // bars added to the automatic pacing (recipe paceShift)
  readability?: Readability; // auto (default): a soft dark band behind the lyrics when the clips are bright there; strong: always; normal: never
  breathe?: "off" | "gentle" | "beat"; // the lyrics swell softly while on screen (beat: once a bar, on the downbeats)
  heldGlow?: "off" | "on"; // a held note's word brightens while it is held
  chorusLift?: "off" | "on"; // the first line of each chorus arrives a touch bigger and brighter
  shine?: "off" | "on"; // one soft light sweep across each chorus line, on a downbeat
  emphasis?: "off" | "on"; // the key word of each line in the hook font, bigger, in the accent
  textLayout?: TextLayout; // the theme's text layout: centre | lower (the lower third) | bighook (chorus lines larger)
  titleOpening?: "off" | "on"; // Reels / TikTok / Shorts: title, byline and tagline before the first hook
  // The theme's picture (src/picture.ts; recipe textColour, grade, vignette, textBacking, fallback,
  // fallbackColour, gradeCanvas). Absent (pnpm make without a song.json): the videos as before.
  picture?: Pick<RecipeValues, "textColour" | "grade" | "vignette" | "textBacking" | "fallback" | "fallbackColour" | "gradeCanvas" | "titleStyle" | "titleWarp" | "hookCard" | "hookCardStyle" | "endCard" | "endCardStyle" | "hookText" | "endText">;
  transitions?: TransitionStyle; // between shots: "auto" (default: from the music), "crisp" (cuts), "flowing" (dissolves)
  ending?: EndingChoice; // Reels / TikTok / Shorts: "auto" (default: the app chooses tight loop, soft fade or ring-out) or one of them
  tempo?: number; // the song's real BPM (song.json "tempo"): the beats are re-tracked around it
  // The storyboard: plan every video exactly as a make would (the same code), but render nothing and
  // make no output (no run folder, section / job rows, song.json changes or .lrc; never aligns: it needs
  // the stored alignment). Caches are filled as usual (clip import and preparation, analysis).
  dryRun?: boolean;
  // A lyric-timing run (the studio queues one when vocals.wav is added or replaced): the alignment, the
  // hand-set starts and the vocal-start check (src/node/lyric-timing.ts), no videos. Needs projectId.
  lyricsOnly?: boolean;
  projectId?: string;
  theme?: string; // this run's theme instead of the song's (pnpm make --theme "Night drive")
  lineEffect?: string; // lyric effect for verse lines, e.g. "glide" or "soft-blur:subtle" (default: platform / brand)
  hookEffect?: string; // lyric effect for hook lines (default: platform / brand)
  pins?: string;
  parallel?: number;
  frameCheck?: boolean; // default true
  resume?: boolean; // render only the missing or failed variations of the latest export folder
  resumeFolder?: string; // with resume: this run folder of the project instead of the latest one
  shouldStop?: () => boolean; // asked before each video starts: true = stop (the studio's Stop button)
  runId?: string; // the studio's make_run (stored with the jobs, links them to the Tasks menu)
  workspaceDir?: string;
  command?: string;
  now?: Date;
  align?: AlignRunner;
  voiceMap?: VoiceMapRunner; // tests: a stand-in for the voice map of the vocal track
  firstWords?: FirstWordsRunner; // tests: a stand-in for the recognised-words pass
  renderer?: (options: RenderOptions) => Promise<string>; // tests: a stand-in for renderLyricVideo
  thumbnailRenderer?: typeof renderThumbnail; // tests: a stand-in for renderThumbnail
  coverRenderer?: typeof renderCover; // tests: a stand-in for renderCover (with a stand-in video renderer and none: no cover)
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
  songMs: number; // the song's measured length
  downbeatConfidence: number;
  lyrics: { source: Alignment["source"]; file: string; lines: number; hooks: number; low: { number: number; text: string; confidence: number }[] };
  lyricsOffsetMs: number;
  effects: { verse: string; hook: string; from: { verse: string; hook: string }; showNextLine: boolean } | null; // null: no lyrics (Canvas)
  section: { start_ms: number; end_ms: number; reason: string };
  collection: { name: string; folder: string; clips: number; added: number; changed: number; unchanged: number; removed: number; remembered: boolean };
  cuts: number;
  limit: RenderLimit;
  exportDir: string;
  resume: { done: number; toRender: string[] } | null;
  warnings: string[];
  notes: string[];
};

export type RenderState = { platform: string; name: string; status: "queued" | "rendering" | "checking" | "done" | "failed" | "stopped"; progress: number };

// rate / transitions: story variations (gaps in story order) differ by cut rate and cut / dissolve.
// pairing: "compare pairings" (--pairings / Generate): this video's fonts; all else the same in every video.
export type PictureSet = { label: string; songClips: boolean; collections: string[] };

// "song+wedding,city" -> [{ song clips + wedding }, { city }].
export function parsePictures(text: string): PictureSet[] {
  const sets = text.split(",").map((t) => t.trim()).filter(Boolean).map((t): PictureSet => {
    const parts = t.split("+").map((x) => x.trim()).filter(Boolean);
    const songClips = parts.some((x) => x.toLowerCase() === "song");
    const collections = [...new Set(parts.filter((x) => x.toLowerCase() !== "song"))];
    if (!songClips && !collections.length) throw new Error(`--pictures: "${t}" has no clips (use song, a collection name, or song+name)`);
    return { label: [songClips ? "the song's clips" : null, ...collections].filter(Boolean).join(" + "), songClips, collections };
  });
  if (!sets.length) throw new Error('--pictures: give one or more clip sets, e.g. "song,wedding" or "song+wedding,city"');
  if (sets.length > 4) throw new Error("--pictures: at most 4 picture versions in one run");
  return sets;
}

export type VariationSpec = { index: number; name: string; order: ClipOrder; seed: number; style: StyleChoice; bars: boolean; rate?: CutRate; transitions?: AnchorTransitions; pairing?: { id: string; name: string }; picture?: { index: number; label: string; songClips: boolean; collections: string[] } };

export type VariationResult = VariationSpec & {
  platform: string;
  file: string;
  srtFile: string;
  thumbnailFile?: string; // YouTube
  coverFile?: string; // Reels / TikTok / Shorts: the cover with the title opening (inside the 3:4 grid crop)
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

// One planned video (dry run): the composition props a render would get, and what goes with them.
export type VideoPlan = {
  spec: VariationSpec;
  props: Omit<LyricVideoProps, "mediaBaseUrl">;
  anchors: (AnchorReport & { missing: string[] }) | null;
  loop: LoopResult | null; // loop platforms: does the wrap-around flow (as QA "Loop flows" checks it)
  decisions: string[]; // the app's technical choices in plain words (pacing, transitions)
};
export type PlatformPlan = {
  videos: VideoPlan[];
  slots: { line: number; text: string; clip: string }[]; // anchors whose clip is not in this clip set: the line needs a clip
  loopSuggestions: LoopSuggestion[] | null; // loop platforms: target lengths with an end that loops well
  media: MediaRoots; // where the props' files are (for a preview)
  // The prepared clips (props' shot src), with the clip editor's edits and the best moment the planner used.
  clips: {
    path: string; name: string; clipId: string; thumb: string | null; durationMs: number; kind: "video" | "photo";
    rank: number | null; inMs: number | null; outMs: number | null; speed: number | null; bestMs: number | null; bestFrom: "clip editor" | "auto" | null;
    transition: "cut" | "dissolve" | null; // how the clip comes in (clips.json), null: the app chooses
  }[];
  section: { mode: string; start_ms: number; end_ms: number; reason: string };
  analysis: { bpm: number; beats: Beat[]; duration_ms: number };
  lines: { number: number; text: string; isHook: boolean; start_ms: number; end_ms: number; sung_end_ms: number | null }[]; // every line, by the Lyrics tab's number
  anchorsOutside: { line: number; text: string; clip: string }[];
};

export type PlatformResult = {
  plan?: PlatformPlan; // dry run only
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

// The end of the summary when something failed: every failed video (platform + variation) and every
// platform that could not be made at all, with what to do. null when everything is finished.
export function failureSummary(result: Pick<MakeResult, "platforms" | "variations">): string[] | null {
  const videos = result.variations.filter((v) => v.error);
  const platforms = result.platforms.filter((p) => p.error);
  if (!videos.length && !platforms.length) return null;
  const out: string[] = [];
  if (videos.length) {
    out.push(`${videos.length} video(s) failed: ${videos.map((v) => `${v.platform} ${v.name}`).join(", ")}.`);
    out.push("Render only the missing ones with the same command plus --resume (add --parallel 1 if it was higher).");
  }
  for (const p of platforms) out.push(`${p.name} was not made: ${p.error!.split("\n")[0]}`);
  if (platforms.length) out.push(`Fix the cause above, then run the same command with --platforms ${platforms.map((p) => p.name).join(",")}.`);
  const finished = result.variations.filter((v) => !v.error).length;
  out.push(finished ? `The other ${finished} video(s) are finished.` : "No video was finished.");
  return out;
}

// v1: story order; v2..vN: shuffle with seed 2..N. Styles alternate Simple / Bold; cinematic bars on
// every other variation (v2, v4, ...).
// Without a story: v1 in story order, the others shuffled. A story (gap order "story": the default when
// the song has anchors): every video in story order; they differ by style, cut rate (the run's, then one
// coarser, one finer) and cut / dissolve (the anchors' own, all dissolve, all cut).
export function planVariations(count: number, story?: { rate: CutRate }): VariationSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    const spec: VariationSpec = {
      index,
      name: `v${index}`,
      order: story || index === 1 ? "story" : "shuffle",
      seed: index,
      style: index % 2 === 1 ? "simple" : "bold",
      bars: index % 2 === 0,
    };
    if (!story) return spec;
    const step = (index - 1) % 4; // 0, 1: the run's rate; 2: coarser; 3: finer
    return { ...spec, rate: step === 2 ? coarserRate(story.rate) : step === 3 ? finerRate(story.rate) : story.rate, transitions: index % 2 === 1 ? "as-set" : index % 4 === 2 ? "dissolve" : "cut" };
  });
}
// "Try another take": only take N (the same variation vN a run of N videos would make), so every take differs.
export function planTake(take: number, story?: { rate: CutRate }): VariationSpec[] {
  return planVariations(take, story).slice(take - 1);
}
const RATES: CutRate[] = ["0.5x", "1x", "2x"];
const coarserRate = (r: CutRate): CutRate => (r === "off" ? r : RATES[Math.max(0, RATES.indexOf(r) - 1)]);
const finerRate = (r: CutRate): CutRate => (r === "off" ? r : RATES[Math.min(RATES.length - 1, RATES.indexOf(r) + 1)]);

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
  const base = songPathsById(ws, projectId).exports;
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

// Lyric effects: the recipe's choice (--line-effect / --hook-effect, song.json, brand.json perPlatform),
// else brand.json motion (glide verses, karaoke-highlight hooks by default). platforms.json never sets them.
export function chooseEffects(
  brand: Pick<Brand, "motion">,
  options: Pick<MakeOptions, "lineEffect" | "hookEffect">,
  labels: { verse?: string; hook?: string } = {}, // where the options' effects come from (default: the flags)
): { verse: EffectChoice; hook: EffectChoice; from: { verse: string; hook: string } } {
  const pick = (cli: string | undefined, flag: string, own: EffectChoice) => (cli ? { choice: parseEffectChoice(cli, flag), from: flag } : { choice: own, from: "brand.json" });
  const verse = pick(options.lineEffect, labels.verse ?? "--line-effect", brand.motion.verseEffect);
  const hook = pick(options.hookEffect, labels.hook ?? "--hook-effect", brand.motion.hookEffect);
  return { verse: verse.choice, hook: hook.choice, from: { verse: verse.from, hook: hook.from } };
}

// <song folder>\exports\<YYYY-MM-DD_HHmm>\ (with -2, -3, ... if that minute exists); songs not
// migrated yet: WORKSPACE_DIR\projects\<id>\exports\.
export function exportFolder(ws: Workspace, projectId: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  const base = songPathsById(ws, projectId).exports;
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

function chooseSection(
  mode: string, lines: SectionLine[], beats: Beat[], durationMs: number, leadMs: number, preset?: PlatformPreset,
  fit?: (startMs: number, endMs: number) => { score: number; ok: boolean; text: string }, // loop platforms: the end that flows back best
  kept?: (startMs: number, endMs: number) => { kept: number; total: number; missing: number[] }, // story anchors: the end that keeps most
  titleLead = false, // the title opening: up to 2 bars before the hook
  musicStartMs?: number, // an instrumental: the strongest stretch of the music
): SectionChoiceOut {
  if (mode === "auto" && preset?.length.mode === "full") mode = "full";
  if (mode === "auto") {
    const window = preset ? sectionWindow(preset) : null;
    const s = autoSection(lines, beats, {
      durationMs,
      leadMs,
      ...(window ? { minMs: window.minMs, maxMs: window.maxMs, hardMaxMs: window.hardMaxMs, shortestMs: window.shortestMs } : {}),
      ...(window && preset!.length.mode === "target" ? { targetMs: window.targetMs } : {}),
      anchorMode: preset?.anchor ?? "lead-in",
      ...(titleLead ? { titleLead: true } : {}),
      ...(musicStartMs !== undefined ? { musicStartMs } : {}),
      endOn: preset?.endOn ?? "bar",
      ...(fit ? { loopFit: fit } : {}),
      ...(kept ? { anchorsKept: kept } : {}),
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
  // A wrong effect name should fail before the slow steps.
  if (options.lineEffect) parseEffectChoice(options.lineEffect, "--line-effect");
  if (options.hookEffect) parseEffectChoice(options.hookEffect, "--hook-effect");
  const leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
  const now = options.now ?? new Date();
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  try {
    // (an instrumental's story.txt may be missing: no words on screen)
    for (const f of [options.song, options.lyrics]) if (!existsSync(f) && !(f === options.lyrics && path.basename(f) === STORY_FILE)) throw new Error(`File not found: ${f}`);

    // Presets and fonts first: a mistake there should fail before the slow steps.
    const presets = loadPresets(options.presetsFile);
    // platforms.json is format only: its old "motion" (lyric effects) is not used any more.
    for (const p of Object.values(presets)) {
      if (p.motion) log(`platforms.json ${p.name}: "motion" is not used any more (platforms.json is format only); put it in brand.json "perPlatform": { "${p.name}": { "verseEffect": "..." } } or on the song's Shape page`);
    }
    if (options.platforms) choosePlatforms(options.platforms, presets);
    const catalog = loadFontCatalog(ws.dir);
    for (const problem of catalog.problems) log(`font file skipped: ${problem}`);

    const sp = await findOrCreateSongProject(ws, path.resolve(options.song), log);
    log(`project "${sp.project.title}" (${sp.created ? "new" : "found by the song's content"})`);
    const renamed: Partial<{ artist: string; title: string }> = {};
    if (options.artist?.trim() && options.artist.trim() !== sp.project.artist) renamed.artist = options.artist.trim();
    if (options.title?.trim() && options.title.trim() !== sp.project.title) renamed.title = options.title.trim();
    if (Object.keys(renamed).length && !options.dryRun) {
      const oldRoot = songPathsById(ws, sp.project.id).root;
      sp.project = ws.db.update(projectTable).set(renamed).where(eq(projectTable.id, sp.project.id)).returning().get();
      // A new title or artist renames the song folder (songs\<artist>\<title>\).
      const moved = renameSongFolder(ws, sp.project.id, { selfPid: process.pid });
      if (moved) {
        log(`song folder renamed: ${moved}`);
        sp.project = ws.db.select().from(projectTable).where(eq(projectTable.id, sp.project.id)).get()!;
        if (sp.project.audio_path) sp.songFile = absPath(ws, sp.project.audio_path);
        // Files given from the old folder (lyrics.txt, hints.lrc, ...) are in the new one now.
        const newRoot = songPathsById(ws, sp.project.id).root;
        const inside = (f?: string) => (f && path.resolve(f).startsWith(oldRoot + path.sep) ? path.join(newRoot, path.relative(oldRoot, path.resolve(f))) : f);
        options = { ...options, song: sp.songFile, lyrics: inside(options.lyrics)!, hint: inside(options.hint), cover: inside(options.cover), stills: inside(options.stills), pins: inside(options.pins), lrc: inside(options.lrc), songFolder: inside(options.songFolder) };
      }
    }
    const paths = songPathsById(ws, sp.project.id);
    // The artist's brand (brand\<artist>\brand.json if there is one, else brand\brand.json).
    let brand = loadBrand(ws.dir, catalog, sp.project.artist);
    if (brand.created) log(`brand settings created: ${brand.file} (edit fonts, colour and logo there)`);

    // The recipe: library -> artist brand -> song.json -> this run (locked song settings win).
    // The song's theme (its fonts, effects, colour, add-ons): song.json "theme", or --theme for this run.
    const songRecipe = paths.recipe ? ensureSongTheme(ws, sp.project.id, catalog) : readRecipe(paths.recipe);
    const themeName = options.theme?.trim() || songRecipe.theme;
    const theme = themeName ? loadTheme(ws.dir, themeName, catalog) : null;
    if (theme) log(`theme: ${theme.name}${options.theme?.trim() ? " (this run)" : ""}`);
    const recipeInput: RecipeInput = {
      library: LIBRARY_RECIPE,
      artist: artistRecipe(brand.brand),
      artistPlatforms: brand.brand.perPlatform,
      ...(theme ? { theme: themeLayer(theme) } : {}),
      song: songRecipe,
      run: runRecipe(options),
    };
    const recipe = resolveRecipe(recipeInput);
    for (const i of recipe.ignored) log(`song.json locks ${i.field}: keeping ${recipeText(i.kept)} (this run asked for ${recipeText(i.run)})`);
    const own = (k: RecipeField) => recipe.sources[k] === "song" || recipe.sources[k] === "run" || recipe.sources[k] === "theme"; // set by this song's theme, the song or the run
    const effective: MakeOptions = {
      ...options,
      ...(theme ? { theme: theme.name } : {}), // the theme this run uses (the manifest names it)
      lineEffect: own("verseEffect") ? recipe.values.verseEffect : undefined,
      hookEffect: own("hookEffect") ? recipe.values.hookEffect : undefined,
      font: own("verseFont") ? recipe.values.verseFont : undefined,
      fontHook: own("hookFont") ? recipe.values.hookFont : undefined,
      shotLength: recipe.values.shotLength ?? undefined,
      ending: recipe.values.ending,
      transitions: recipe.values.transitions,
      paceShift: recipe.values.paceShift,
      readability: recipe.values.readability,
      breathe: recipe.values.breathe,
      heldGlow: recipe.values.heldGlow,
      chorusLift: recipe.values.chorusLift,
      shine: recipe.values.shine,
      emphasis: recipe.values.emphasis,
      titleOpening: recipe.values.titleOpening,
      picture: pictureFields(recipe.values),
      tempo: recipe.values.tempo ?? undefined,
      // Weights and italic: the recipe's (brand, song or run) whenever the brand fonts are used for the
      // lyrics; otherwise only the song's or run's own (else the Simple / Bold style's weight).
      ...fontChoiceOf((k) => (own(k) || brand.brand.useForLyrics ? recipe.values[k] : undefined)),
      section: recipe.values.section,
      layout: own("youtubeLayout") ? recipe.values.youtubeLayout : undefined,
      platforms: recipe.values.platforms.length ? recipe.values.platforms.join(",") : undefined,
    };
    if (effective.lineEffect) parseEffectChoice(effective.lineEffect, "song.json verseEffect");
    if (effective.hookEffect) parseEffectChoice(effective.hookEffect, "song.json hookEffect");
    if (own("accentColour")) brand = { ...brand, brand: { ...brand.brand, accentColour: recipe.values.accentColour } };
    const chosenPlatforms = choosePlatforms(effective.platforms, presets);
    const variationsFor = (preset: PlatformPreset) => recipe.values.variations[preset.name] ?? recipe.values.variations["*"] ?? preset.variations;
    const fromLabel = (k: RecipeField, flag: string) => (recipe.sources[k] === "song" ? "song.json" : recipe.sources[k] === "theme" ? `theme "${theme?.name}"` : flag);
    const effectLabels = { verse: fromLabel("verseEffect", "--line-effect"), hook: fromLabel("hookEffect", "--hook-effect") };
    log(`recipe: ${recipeSummary(recipe)}`);

    const lyricsText = existsSync(options.lyrics) ? readFileSync(options.lyrics, "utf8") : ""; // a CJK font loads only the pieces these lines use
    const stylesFor = (font?: string, fontHook?: string, choice: Pick<MakeOptions, "weight" | "hookWeight" | "italic" | "hookItalic"> = effective) =>
      loadStyles(ws, catalog, {
        font, fontHook, text: lyricsText,
        brandFonts: brand.brand.useForLyrics ? { verse: brand.brand.verseFont.family, hook: brand.brand.hookFont.family } : undefined,
        verse: { weight: choice.weight, italic: choice.italic },
        hook: { weight: choice.hookWeight, italic: choice.hookItalic },
      });
    const styles = stylesFor(effective.font, effective.fontHook);
    for (const w of fontWarnings(styles)) log(`fonts: ${w}`);
    // The EP: song.json (--ep is saved there; songs not migrated yet: remembered with the project).
    if (options.ep?.trim() && !recipe.locked.includes("ep") && !options.dryRun) {
      if (paths.recipe) writeRecipe(paths.recipe, { ...songRecipe, ep: options.ep.trim() });
      else updateProjectSettings(ws, sp.project.id, { ep: options.ep.trim() });
    }
    const ep = (own("ep") ? recipe.values.ep : undefined) || readProjectSettings(ws, sp.project.id).ep || undefined;

    // The clips: the song's own clips\ plus the shared collections (--collection, else song.json,
    // else the one this song used last time).
    const remembered = recipe.sources.collections === "library" ? rememberedCollection(ws, sp.project.id) : null;
    const collectionNames = recipe.sources.collections === "library" ? (remembered ? [remembered.name] : []) : recipe.values.collections;
    const songClips = paths.clips && existsSync(paths.clips) && readdirSync(paths.clips).some((f) => SOURCE_FILE.test(f)) ? paths.clips : null;
    if (!collectionNames.length && !songClips) {
      throw new Error(
        `--collection <name> is needed the first time for "${sp.project.title}" (the folder WORKSPACE_DIR\\collections\\<name>)` +
          `${paths.clips ? `, or put clips in its own clips folder (${paths.clips})` : ""}; after that it is remembered.`,
      );
    }
    const collectionRemembered = !!remembered || recipe.sources.collections === "song";
    if (collectionRemembered) log(`using collection ${collectionNames.join(", ")} (remembered)`);
    // A collection kept elsewhere (--collection-path) is found again by its name, also after the migration.
    const lastUsed = rememberedCollection(ws, sp.project.id);
    const collectionFolder = (name: string, i: number) => (i === 0 && options.collectionPath) || (lastUsed?.name === name ? lastUsed.folder : undefined);

    log("analysing the song (cached after the first time)");
    const analysis = analyzeSong(sp.songFile, { downbeatOffset: options.downbeatOffset, ...(effective.tempo ? { bpm: effective.tempo } : {}) });
    // A tempo override (song.json "tempo"): the beats were re-tracked around it; the detected tempo is said too.
    const detectedBpm = effective.tempo ? analyzeSong(sp.songFile, { downbeatOffset: options.downbeatOffset }).bpm : analysis.bpm;
    if (effective.tempo) log(`tempo: ${analysis.bpm} BPM (song.json "tempo" ${effective.tempo}; detected ${detectedBpm})`);
    const analysed = {
      bpm: analysis.bpm,
      duration_ms: analysis.duration_ms,
      downbeat_offset: analysis.downbeat_offset,
      ...(options.lyricsOffsetMs !== undefined ? { lyrics_offset_ms: options.lyricsOffsetMs } : {}),
    };
    let project = options.dryRun ? { ...sp.project, ...analysed } : ws.db.update(projectTable).set(analysed).where(eq(projectTable.id, sp.project.id)).returning().get();
    const lyricsOffsetMs = project.lyrics_offset_ms;

    const stored = await ensureAlignment(ws, { ...sp, project }, {
      lyricsTxt: path.resolve(options.lyrics),
      hint: options.hint ? path.resolve(options.hint) : undefined,
      noHint: options.noHint,
      lrc: options.lrc ? path.resolve(options.lrc) : undefined,
      realign: options.dryRun ? false : options.realign,
      lang: options.lang,
      durationMs: analysis.duration_ms,
      log,
      beats: analysis.beats,
      leadMs,
      align: options.dryRun
        ? async () => {
            throw new Error("This song has no stored alignment for its current lyrics.txt yet: make a video first (Generate), then its storyboard shows here.");
          }
        : options.align,
    });
    // Hand-set starts (Lyrics tab), then the vocal-start guard: on the stored alignment (never re-aligning).
    const hand = applyHandSet(stored, paths.hints && existsSync(paths.hints) ? paths.hints : options.hint, log);
    const alignment = await applyVocalGuard(ws, { ...sp, project }, hand.alignment, {
      log,
      skip: hand.skip,
      voiceMap: options.voiceMap,
      firstWords: options.firstWords,
      reviewMs: Math.round(brand.brand.motion.gapLeadInS * 1000), // smaller differences are not visible: not flagged
    });
    const lines = alignment.lines;
    const instrumental = alignment.source === "story";
    if (!lines.length && !instrumental) throw new Error(`No timed lyric lines in ${alignment.lrcFile}`);
    // Lines the vocal-start check changed: the moved ones and a previous line it shortened.
    const guardMoved = new Set([
      ...(alignment.guard?.moves.flatMap((m) => (m.shortens_previous ? [m.number - 1, m.number - 2] : [m.number - 1])) ?? []),
      ...(alignment.handTimes?.flatMap((h) => [h.number - 1, h.number - 2]) ?? []),
    ]);
    // Lines checked by ear in the Lyrics tab (still the same alignment, words and start): QA leaves them be.
    const earFile = path.join(path.dirname(alignment.lrcFile), CHECKED_BY_EAR_FILE);
    const ear = checkedByEar(existsSync(earFile) ? (JSON.parse(readFileSync(earFile, "utf8")) as EarCheck[]) : [], alignment.lrcHash, lines);
    for (const i of ear) log(`lyrics: line ${i + 1} checked by ear (Lyrics tab): its timing warnings are cleared`);
    const reports = matchReport(lines, alignment.report).map((r, i) =>
      r
        ? {
            checked_by_ear: ear.has(i),
            ...r,
            ...(guardMoved.has(i) ? { start_ms: lines[i].start_ms, end_ms: lines[i].sung_end_ms ?? r.end_ms } : {}),
            early_ms: alignment.guard?.earlyMs[i] ?? null,
            review: alignment.guard?.check.lines.find((c) => c.number === i + 1 && c.result === "flagged for review")?.why ?? null,
          }
        : r,
    );
    if (!options.dryRun) saveLyricLines(ws, project.id, alignment);
    const numbers = lyricLineNumbers(lines.map((l) => l.text), alignment.lrcFile, alignment.lyricsTxt).numbers;
    const sectionLines: SectionLine[] = lines.map((l, i) => ({ ...l, sung_end_ms: reports[i]?.end_ms }));
    // The textboard: textboard.json synced to these lines (a card whose words are gone is said, not used).
    const textboard = boardForRun(paths.legacy ? null : songPathsById(ws, project.id).root, {
      title: project.title, artist: project.artist, ep: ep ?? null, tagline: songRecipe.tagline ?? null, lines: lines.map((l, i) => ({ number: i + 1, text: l.text, isHook: l.isHook })),
    });
    if (textboard.stored) log(`textboard: ${overrideCount(textboard.board)} change(s)${textboard.board.template ? `, template "${textboard.board.template}"` : ""}`);
    for (const o of textboard.orphans) log(`textboard: card ${o.id} "${o.text}" no longer matches a lyric line (its changes are not used; the words changed in lyrics.txt)`);

    // A clip set: the song's own clips (when it has them) and shared collections, merged.
    const clipsOf = async (set: { songClips: boolean; collections: string[] }) => {
      const syncs: CollectionSync[] = [];
      if (set.songClips && songClips) syncs.push(await syncCollection(ws, { name: `song:${project.id}`, folder: songClips, log, prepare: false }));
      for (const [i, name] of set.collections.entries()) syncs.push(await syncCollection(ws, { name, folder: collectionFolder(name, i), log, prepare: false }));
      if (!syncs.length) throw new Error("This clip set has no clips: the song has no clips of its own.");
      if (set.songClips && songClips) syncs[0] = { ...syncs[0], collection: { ...syncs[0].collection, name: "song clips" } };
      return mergeCollections(syncs);
    };
    const swap = options.clipSet ? parsePictures(options.clipSet)[0] : null;
    if (swap) log(`clips: ${swap.label} (this run only)`);
    const collection = await clipsOf(swap ?? { songClips: true, collections: collectionNames });
    const runCollections = swap ? swap.collections : collectionNames;
    if (options.pictures && (options.resume || options.pairings)) throw new Error("--pictures cannot be combined with --resume or --pairings.");
    const pictureSets = options.pictures ? parsePictures(options.pictures) : null;
    const pictures = pictureSets ? await Promise.all(pictureSets.map(async (p, k) => ({ ...p, index: k + 1, collection: await clipsOf(p) }))) : null;
    if (pictures) log(`picture versions: ${pictures.map((p) => `v${p.index} ${p.label}`).join(", ")}; the same textboard in each`);
    if (recipe.sources.collections === "run" && !options.dryRun && !swap) {
      const folder = options.collectionPath ?? collectionFolder(collectionNames[0], 0);
      rememberCollection(ws, project.id, { name: collectionNames[0], ...(folder ? { folder } : {}) });
      // Remembered in song.json (a locked song.json collection never gets here: the run's choice was ignored).
      if (paths.recipe) writeRecipe(paths.recipe, { ...readRecipe(paths.recipe), collections: collectionNames });
    }

    // The run's folder; --resume continues the latest one.
    let rootDir: string;
    if (options.resume) {
      const exportsBase = songPathsById(ws, project.id).exports;
      const chosenFolder = options.resumeFolder ? path.resolve(options.resumeFolder) : latestExportFolder(ws, project.id);
      if (!chosenFolder) throw new Error("--resume: this project has no earlier export folder; run without --resume.");
      if (path.dirname(chosenFolder) !== path.resolve(exportsBase) || !existsSync(chosenFolder)) throw new Error(`--resume: ${chosenFolder} is not a run folder of "${project.title}".`);
      rootDir = chosenFolder;
    } else {
      rootDir = options.dryRun ? path.join(songPathsById(ws, project.id).exports, "(dry run)") : exportFolder(ws, project.id, now);
    }
    const lrcFile = path.join(rootDir, `${safeName(project.title)}.lrc`);
    if (!existsSync(lrcFile) && !options.dryRun && !instrumental) {
      writeFileSync(lrcFile, cleanLrc(lines, { title: project.title, artist: project.artist, durationMs: analysis.duration_ms, offsetMs: lyricsOffsetMs }));
    }

    const tool = toolInfo();
    // The logo's own size (for its height on screen).
    let logo: LogoImage | null = null;
    if (brand.logoFile) {
      const info = await probeMedia(brand.logoFile);
      if (info.width && info.height) logo = { file: brand.logoFile, width: info.width, height: info.height };
    }
    let songAudio: Promise<LoopAudio | null> | undefined;
    const shared: Shared = {
      ws, options: effective, variationsFor, effectLabels, recipeFor: (platform: string) => resolveRecipe(recipeInput, platform), stylesFor, log, now, leadMs, lyricsOffsetMs, catalog, styles, brand, logo, sp, analysis, alignment, lines, reports, numbers,
      sectionLines, instrumental, collection, collectionNames: runCollections, collectionRemembered, ep, tool, rootDir, getProject: () => project,
      loopAudio: () => (songAudio ??= readLoopAudio(sp.songFile)),
      anchors: songRecipe.anchors ?? [],
      canvasChoice: songRecipe.canvas ?? null,
      youtubeLinks: pickedLinks(songRecipe.links ?? [], songRecipe.postLinks, "youtube"),
      gapOrder: songRecipe.gapOrder ?? null,
      textboard,
    };
    const results: PlatformResult[] = [];
    for (const [index, name] of chosenPlatforms.names.entries()) {
      const preset = presets[name];
      if (options.shouldStop?.()) {
        // Stopped before this platform started: nothing of it is made (Resume makes it later).
        results.push({
          name, label: preset.label, exportDir: platformDir(rootDir, name), section: { start_ms: 0, end_ms: 0, reason: "" },
          limit: renderLimit({ platform: options.platform, requested: options.parallel }), variations: [], warnings: [], error: "stopped before it started",
        });
        continue;
      }
      try {
        if (pictures && preset.lyrics && preset.layout !== "canvas") {
          // Picture versions: one video per clip set, the same textboard, section and style.
          const parts: PlatformResult[] = [];
          for (const p of pictures) {
            const { collection: pc, ...set } = p;
            parts.push(await makePlatform({ ...shared, collection: pc, collectionNames: set.collections, picture: set }, preset, { index, count: chosenPlatforms.names.length }));
          }
          results.push({ ...parts[0], variations: parts.flatMap((x) => x.variations), warnings: [...new Set(parts.flatMap((x) => x.warnings))], ...(parts[0].plan ? { plan: { ...parts[0].plan, videos: parts.flatMap((x) => x.plan?.videos ?? []) } } : {}) });
        } else {
          results.push(await makePlatform(shared, preset, { index, count: chosenPlatforms.names.length }));
        }
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
  options: MakeOptions; // with the recipe applied
  variationsFor: (preset: PlatformPreset) => number;
  effectLabels: { verse: string; hook: string };
  recipeFor: (platform: string) => ResolvedRecipe; // the recipe for one platform (perPlatform values)
  stylesFor: (font?: string, fontHook?: string, choice?: Pick<MakeOptions, "weight" | "hookWeight" | "italic" | "hookItalic">) => StyleFaces;
  log: (m: string) => void;
  now: Date;
  leadMs: number;
  lyricsOffsetMs: number;
  catalog: FontCatalog;
  styles: StyleFaces;
  brand: ReturnType<typeof loadBrand>;
  ep: string | undefined; // --ep or the project's remembered EP
  logo: LogoImage | null;
  sp: Awaited<ReturnType<typeof findOrCreateSongProject>>;
  analysis: Awaited<ReturnType<typeof analyzeSong>>;
  alignment: Alignment;
  lines: Alignment["lines"];
  reports: ReturnType<typeof matchReport>;
  numbers: number[];
  sectionLines: SectionLine[];
  instrumental: boolean; // no sung lyrics: the lines (if any) are the story, timed by the app
  collection: CollectionSync & { folders: string[] };
  collectionNames: string[]; // the shared collections of the run (the song's own clips come on top)
  collectionRemembered: boolean; // --collection not given: the one this project used last time
  tool: Manifest["tool"];
  rootDir: string;
  getProject: () => { id: string; title: string; artist: string };
  loopAudio: () => Promise<LoopAudio | null>; // the song decoded once per run, for the loop checks
  anchors: AnchorSpec[]; // song.json: story anchors
  canvasChoice: { clip: string; at?: number } | null; // song.json "canvas": the clip chosen for the Canvas
  youtubeLinks: SongLink[]; // song.json "links" picked for YouTube (publish.txt)
  gapOrder: GapOrder | null; // song.json (null: story with anchors, else v1 story and the others shuffled)
  textboard: RunBoard; // the song's text layer (textboard.json, else the brand's defaults)
  picture?: PictureSet & { index: number }; // picture versions: this video's clip set
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

// Recipe weight / italic fields -> make options.
const CHOICE_OPTION = { verseWeight: "weight", hookWeight: "hookWeight", verseItalic: "italic", hookItalic: "hookItalic" } as const;
type ChoiceField = keyof typeof CHOICE_OPTION;
function fontChoiceOf(value: (k: ChoiceField) => unknown): Pick<MakeOptions, "weight" | "hookWeight" | "italic" | "hookItalic"> {
  const out: Pick<MakeOptions, "weight" | "hookWeight" | "italic" | "hookItalic"> = {};
  for (const k of Object.keys(CHOICE_OPTION) as ChoiceField[]) {
    const v = value(k);
    if (v !== undefined) (out as Record<string, unknown>)[CHOICE_OPTION[k]] = v;
  }
  return out;
}

// Each font that could not be had exactly (weight or italic missing in the family), once.
export function fontWarnings(styles: StyleFaces): string[] {
  return [...new Set([...styles.simple.warnings, ...styles.bold.warnings])];
}

// The run's settings for one platform: per-platform recipe values (brand.json / song.json perPlatform)
// for the lyric effects, fonts, accent colour and section.
function forPlatform(sh: Shared, base: PlatformPreset): { sh: Shared; preset: PlatformPreset } {
  const r = sh.recipeFor(base.name);
  const below = (source: string) => source === "library" || source === "artist"; // handled by the brand itself
  const pick = (k: Exclude<PlatformField, "length">) => (below(r.sources[k]) ? undefined : (r.values[k] as string));
  const preset = base;
  const label = (k: PlatformField, flag: string) => {
    const source = r.sources[k];
    return source === "run" ? flag : source.startsWith("song") ? `song.json${source.includes(":") ? ` (${preset.name})` : ""}` : source.startsWith("theme") ? `theme${source.includes(":") ? ` (${preset.name})` : ""}` : `brand.json (${preset.name})`;
  };
  const font = pick("verseFont");
  const fontHook = pick("hookFont");
  const accent = pick("accentColour");
  // The platform's weights / italic when its recipe has its own (brand or song perPlatform).
  const choice = { ...sh.options, ...fontChoiceOf((k) => (r.sources[k].includes(":") ? r.values[k] : sh.options[CHOICE_OPTION[k]])) };
  const sameFonts = font === sh.options.font && fontHook === sh.options.fontHook && (["weight", "hookWeight", "italic", "hookItalic"] as const).every((k) => choice[k] === sh.options[k]);
  // The target length shapes an "auto" section only (a fixed section stays exactly as given).
  const length = lengthFor(base, r.values.length, sh.analysis.duration_ms);
  if (length.note) sh.log(`${base.name}: ${length.note}`);
  const section = r.values.section === "auto" && length.wholeSong ? "full" : r.values.section;
  const options: MakeOptions = { ...choice, lineEffect: pick("verseEffect"), hookEffect: pick("hookEffect"), font, fontHook, section, length: r.values.length ?? undefined, shotLength: r.values.shotLength ?? undefined, ending: r.values.ending, transitions: r.values.transitions, paceShift: r.values.paceShift, readability: r.values.readability, breathe: r.values.breathe, heldGlow: r.values.heldGlow, chorusLift: r.values.chorusLift, shine: r.values.shine, emphasis: r.values.emphasis, textLayout: r.values.textLayout, titleOpening: r.values.titleOpening, ...(sh.options.picture ? { picture: pictureFields(r.values) } : {}) };
  const own = PLATFORM_FIELDS.filter((k) => r.sources[k].includes(":"));
  if (own.length) sh.log(`${preset.name}: recipe ${own.map((k) => `${k} ${recipeText(r.values[k])} (${r.sources[k]})`).join(", ")}`);
  const out: Shared = {
    ...sh,
    options,
    effectLabels: { verse: label("verseEffect", "--line-effect"), hook: label("hookEffect", "--hook-effect") },
    styles: sameFonts ? sh.styles : sh.stylesFor(font, fontHook, choice),
    brand: accent ? { ...sh.brand, brand: { ...sh.brand.brand, accentColour: accent } } : sh.brand,
  };
  return { sh: out, preset: r.values.section === "auto" ? length.preset : base };
}

// The theme's picture fields of a recipe (MakeOptions.picture).
function pictureFields(v: RecipeValues): NonNullable<MakeOptions["picture"]> {
  return { textColour: v.textColour, grade: v.grade, vignette: v.vignette, textBacking: v.textBacking, fallback: v.fallback, fallbackColour: v.fallbackColour, gradeCanvas: v.gradeCanvas, titleStyle: v.titleStyle, titleWarp: v.titleWarp, hookCard: v.hookCard, hookCardStyle: v.hookCardStyle, endCard: v.endCard, endCardStyle: v.endCardStyle, hookText: v.hookText, endText: v.endText };
}

// The Reel cover's props: the video's frame with the title opening's cards (title, byline, tagline) on it
// for the whole video, no lyrics, no sound. Null when the song has no title to show.
export function coverProps(props: Omit<LyricVideoProps, "mediaBaseUrl">, sh: Pick<Shared, "textboard" | "brand" | "catalog">, preset: PlatformPreset, format: { width: number; height: number }): Omit<LyricVideoProps, "mediaBaseUrl"> | null {
  if (!props.lyricArea) return null;
  const tc = titleCards(sh.textboard.board, {
    format, area: props.lyricArea, fps: VIDEO.fps, durationInFrames: props.durationInFrames, youtube: null,
    titleFont: sh.brand.brand.titleFont, accent: sh.brand.brand.accentColour, textScale: preset.textScale,
    fontFor: (style, b, text, role) => cardFont(sh.catalog, style, b, text, role),
    opening: { untilFrame: props.durationInFrames + CARD_COVER_PAD },
    fallbackFor: (face, text) => titleFallback(sh.catalog, face, text),
    fit: { safeZone: preset.safeZone, catalog: sh.catalog },
  });
  if (!tc.cards.length) return null;
  const titleFace = tc.cards.some((c) => c.font === sh.brand.brand.titleFont.family) ? fontFileRefs(resolveFace(sh.catalog, sh.brand.brand.titleFont.family, sh.brand.brand.titleFont.weight)) : [];
  const fonts = [...props.fonts, ...tc.fonts, ...titleFace].filter((f, k, all) => all.findIndex((x) => x.src === f.src) === k);
  const { dips: _d, loopInto: _l, ...rest } = props;
  return { ...rest, lyrics: [], audio: null, textCards: tc.cards, fonts };
}
const CARD_COVER_PAD = 60; // the cover's cards never start fading out
const TITLE_ALONE_S = 4.5; // the title opening of an instrumental without a story: on screen this long

// Characters a title card's font lacks (e.g. Japanese in a latin title font): Noto Sans JP fills them in,
// the same files in the preview and the render. Null when the font has them all.
export function titleFallback(catalog: FontCatalog, face: { family: string; weight: number; italic?: boolean }, text: string): { family: string; refs: ReturnType<typeof fontFileRefs> } | null {
  const chars = [...new Set([...text].filter((c) => /\S/.test(c)))];
  let own;
  try {
    own = resolveFace(catalog, face.family, face.weight, face.italic ? "italic" : "normal");
  } catch {
    return null;
  }
  const missing = missingCharacters(own, chars);
  if (!missing.length) return null;
  for (const family of ["Noto Sans JP", "Noto Serif JP"]) {
    try {
      const fb = forText(resolveFace(catalog, family, face.weight), missing.join(""));
      return { family, refs: fontFileRefs(fb) };
    } catch {
      // not bundled: try the next
    }
  }
  return null;
}

// The typical bar of the song (median gap between detected downbeats), else four beats at the BPM.
export function medianBarMs(downbeats: readonly number[], bpm: number): number {
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).filter((g) => g > 0).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : (4 * 60_000) / bpm;
}

// A lyric line that carries the song's title ("This is the house that my heart built" in "The House My
// Heart Built"): the payoff line a loop suggestion must never drop.
export function isTitleLine(text: string, title: string): boolean {
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // The title's words in the same order (other words may sit between them: "the house THAT my heart built").
  const want = norm(title).split(" ").filter(Boolean);
  const have = norm(text).split(" ").filter(Boolean);
  if (want.length < 2) return want.length === 1 && have.includes(want[0]);
  let i = 0;
  for (const w of have) if (w === want[i]) i++;
  return i === want.length;
}

// A fixed section ("0:11-1:10") is used exactly as given; QA says when it is longer than the platform
// allows (target + 30%, or the range's hard maximum). Auto sections and whole songs are not checked here.
function platformLimit(chosen: SectionChoiceOut, preset: PlatformPreset): { seconds: number; limitS: number; platform: string } | null {
  const window = sectionWindow(preset);
  if (!window || !chosen.requested || chosen.mode === "full" || chosen.mode === "auto") return null;
  return { seconds: (chosen.end_ms - chosen.start_ms) / 1000, limitS: window.hardMaxMs / 1000, platform: preset.label };
}

// The preset with the recipe's target length (seconds) for an auto section: a target of that length
// with the preset's tolerance. Longer than the song: the whole song (said so). YouTube (whole song) and
// Canvas (loop) keep their own length.
export function lengthFor(preset: PlatformPreset, seconds: number | null, durationMs: number): { preset: PlatformPreset; wholeSong: boolean; note: string | null } {
  if (!seconds) return { preset, wholeSong: false, note: null };
  if (preset.length.mode === "full" || preset.length.mode === "loop") {
    return { preset, wholeSong: false, note: `target length ${seconds} s not used (${preset.length.mode === "full" ? "this platform shows the whole song" : "a Canvas is a short loop"})` };
  }
  if (seconds * 1000 >= durationMs) {
    return { preset, wholeSong: true, note: `target length ${seconds} s is longer than the song (${clockText(durationMs)}): the whole song` };
  }
  const tolerance = preset.length.mode === "target" ? preset.length.tolerance : 0.15;
  return { preset: { ...preset, length: { mode: "target", seconds, tolerance } }, wholeSong: false, note: `target length ${seconds} s (+-${Math.round(tolerance * 100)}%)` };
}

async function makePlatform(shared: Shared, basePreset: PlatformPreset, position: { index: number; count: number }): Promise<PlatformResult> {
  const { sh, preset } = forPlatform(shared, basePreset);
  const { ws, options, log, leadMs, lyricsOffsetMs, analysis, lines, reports, numbers, alignment, styles } = sh;
  const project = sh.getProject();
  const format = { width: preset.width, height: preset.height };
  const exportDir = platformDir(sh.rootDir, preset.name);
  if (!options.dryRun) mkdirSync(exportDir, { recursive: true });

  // Sources that suit this format.
  const prepared = await prepareForFormat(ws, sh.collection.sources, format, { allowFill: options.allowFill, log });
  const isCanvas = preset.layout === "canvas";
  const needed = isCanvas ? 1 : Math.min(RECENT_WINDOW + 1, Math.max(1, sh.collection.sources.length));

  // Spotify Canvas: no song section, but a loop of whole bars from the strongest clip moment.
  let canvas: CanvasPlan | null = null;
  if (isCanvas) {
    const l = preset.length.mode === "loop" ? preset.length : { min: 3, max: 8 };
    canvas = await planCanvas(ws, prepared.clips, { bpm: analysis.bpm, count: sh.variationsFor(preset), min: l.min, max: l.max, chosen: sh.canvasChoice });
  }

  // Section (lines appear `leadMs` early and move by the lyrics offset). Loop platforms (Reels, TikTok,
  // Shorts): the auto end that flows best back into the start.
  const loops = preset.loops && !canvas;
  // The title opening (recipe titleOpening "on"; Reels, TikTok, Shorts): title, byline and tagline before
  // the first hook; the section starts up to 2 bars before the hook to make room.
  const titleOpeningOn = !!loops && preset.lyrics && options.titleOpening === "on";
  // The song's detected bar starts (downbeat_offset already applied): the grid the section snaps to and the loop's beat check counts.
  const downbeatTimes = analysis.beats.filter((b) => b.is_downbeat).map((b) => b.time_ms).sort((a, b) => a - b);
  const loopSong = loops ? await sh.loopAudio() : null;
  // With the title opening the loop's phrase check accepts the section's lead-in (up to 2 bars before the hook).
  const titleLead = titleOpeningOn ? titleLeadMs(downbeatTimes) : 0;
  // Story anchors by line (the Lyrics tab's number: sung lines counted, as in check-start and hints.lrc):
  // on screen from (stamp - lead + offset) until the line is sung.
  const anchorLines = sh.anchors.flatMap((a) => {
    const i = a.line - 1;
    return !lines[i] ? [] : [{ line: a.line, shownMs: lines[i].start_ms - leadMs + lyricsOffsetMs, sungEndMs: sungEnd(sh.sectionLines[i]) }];
  });
  // An instrumental's short-form section: the strongest stretch of the music (no chorus line to start on).
  let musicStart: number | undefined;
  if (sh.instrumental && !canvas && (options.section ?? "auto") === "auto" && preset.length.mode !== "full") {
    const audio = loopSong ?? (await sh.loopAudio());
    const window = sectionWindow(preset);
    const lengthMs = window ? (preset.length.mode === "target" ? window.targetMs : window.maxMs) : SECTION_TARGET.maxMs;
    const bars = barStarts(analysis.beats, analysis.duration_ms);
    if (audio) {
      musicStart = strongestStretch(bars, lengthMs, analysis.duration_ms, (a, b) => rmsLevel(audio, a, b));
      log(`${preset.name}: an instrumental: the section starts at ${clockText(musicStart)}, the strongest ${Math.round(lengthMs / 1000)} s of the music`);
    } else musicStart = bars[0] ?? 0;
  }
  const chosen0: SectionChoiceOut = canvas
    ? { mode: "loop", start_ms: 0, end_ms: Math.round(canvas.seconds * 1000), requested: null, reason: canvas.reason, warnings: canvas.warnings, cuts: [] }
    : chooseSection(options.section ?? "auto", sh.sectionLines, analysis.beats, analysis.duration_ms, leadMs - lyricsOffsetMs, preset,
      loops ? (startMs, endMs) => loopFit(loopSong, analysis.bpm, startMs, endMs, downbeatTimes) : undefined,
      anchorLines.length && preset.lyrics ? (startMs, endMs) => anchorsInside(anchorLines, startMs, endMs) : undefined,
      titleOpeningOn, musicStart);
  // Automatic ending (Reels, TikTok, Shorts; src/ending.ts): a tight loop only when the end flows back into
  // the start, else a soft fade after the last sung word, or the last chord ringing out one more bar.
  const loopLines = sh.sectionLines.map((l, i) => ({ number: numbers[i] || i + 1, text: l.text, sungStartMs: sungStart(l), sungEndMs: sungEnd(l), ...(l.words?.length ? { lastWordStartMs: l.words.at(-1)!.start_ms } : {}) }));
  const lengthWindow = loops ? sectionWindow(preset) : null;
  const ending: Ending | null = loops
    ? chooseEnding({
        requested: options.ending ?? "auto",
        startMs: chosen0.start_ms,
        endMs: chosen0.end_ms,
        songMs: analysis.duration_ms,
        bpm: analysis.bpm,
        downbeats: downbeatTimes,
        lines: loopLines,
        audio: loopSong,
        loopFadeS: preset.fadeOutSeconds,
        // A ring-out may add one bar to an auto section within the platform's length; a fixed section stays exactly as given.
        maxEndMs: chosen0.mode === "auto" && lengthWindow ? chosen0.start_ms + lengthWindow.hardMaxMs : chosen0.end_ms,
      })
    : null;
  const chosen: SectionChoiceOut = ending
    ? { ...chosen0, end_ms: ending.endMs, reason: ending.kind === "ring-out" ? `${chosen0.reason}; + one ring-out bar to ${clockText(ending.endMs)}` : chosen0.reason, warnings: [...chosen0.warnings, ...(ending.note ? [ending.note] : [])] }
    : chosen0;
  if (ending) log(`${preset.name}: ${ending.text}${ending.note ? ` (${ending.note})` : ""}`);
  log(`${preset.name}: ${canvas ? "loop" : "section"} ${clockText(chosen.start_ms)} - ${clockText(chosen.end_ms)}`);
  const sectionValues = { project_id: project.id, name: `make ${preset.name} (${chosen.mode})`, start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" } as const;
  const sectionRow = options.dryRun ? { id: "" } : ws.db.insert(sectionTable).values(sectionValues).returning().get();
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
        options.stills ?? [path.join(path.dirname(alignment.lyricsTxt), "stills.txt"), ...sh.collection.folders.map((f) => path.join(f, "stills.txt"))].find((f) => existsSync(f));
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

  // The clip editor's story order and edits (clips.json).
  const edits = readClipEdits(songPathsById(ws, project.id).root);
  // Shot length (recipe "shotLength", per platform): "auto" (the default) = automatic pacing from the
  // song's feel and the clips' usable length (src/pace.ts); bars per shot; "story" (shorter on the hooks,
  // as the viewer sees them); "rate" = the cut rate (--rate). A --rate given on the command line with an
  // automatic shot length uses the cut rate.
  const shotMode = options.shotLength ?? "auto";
  const useRate = shotMode === "rate" || (shotMode === "auto" && options.rate !== undefined);
  const pace: Pace | null =
    shotMode === "auto" && !useRate && !canvas
      ? choosePace({
          // An instrumental is paced as a calm piece (its story sentences are read, not sung).
          instrumental: sh.instrumental,
          lines: sh.instrumental ? [] : sh.sectionLines.map((l) => ({ text: l.text, sungStartMs: sungStart(l), sungEndMs: sungEnd(l), ...(l.words?.length ? { words: l.words.length } : {}) })),
          barMs: medianBarMs(downbeatTimes, analysis.bpm),
          shift: options.paceShift ?? 0,
          clipMs: prepared.clips
            .filter((c) => c.kind !== "photo")
            .map((c) => {
              const e = editOf(edits, c.name);
              const from = (e.in ?? 0) * 1000;
              const to = Math.min(c.durationMs, (e.out ?? Infinity) * 1000);
              return Math.max(0, to - from) / (e.speed ?? 1);
            }),
        })
      : null;
  const shotLength = !useRate && shotMode !== "auto" ? (shotMode === "story" ? "story" : (Number(shotMode) as ShotLength)) : undefined;
  const hooks = sh.sectionLines.flatMap((l) => (l.isHook ? [{ start_ms: l.start_ms - leadMs + lyricsOffsetMs, end_ms: sungEnd(l) }] : []));
  const planFor = (cutRate: CutRate) =>
    getCutPoints(analysis.beats, { start_ms: chosen.start_ms, end_ms: chosen.end_ms, energy: options.energy ?? "medium" }, {
      cutRate,
      lyricLines: lines,
      ...(shotLength ? { shotLength, hooks } : {}),
      ...(pace ? { pace: { hookBars: pace.hookBars, verseBars: pace.verseBars, minShotMs: pace.minShotMs }, hooks } : {}),
      // An instrumental's story: each sentence starts with a new shot (on the bar it appears on).
      ...(sh.instrumental && preset.lyrics ? { cutAtMs: lines.map((l) => l.start_ms - leadMs + lyricsOffsetMs) } : {}),
    });
  const plan = planFor(options.rate ?? "1x");
  if (pace) log(`${preset.name}: ${pace.text} ${plan.cuts.length + 1} shots`);
  if (shotLength) log(`${preset.name}: shot length ${shotLength === "story" ? "story (2 bars on hooks, 4 on verses, never under 3 s)" : `${shotLength} bar${shotLength > 1 ? "s" : ""}`}: ${plan.cuts.length + 1} shots`);
  // Each clip's best moment (the editor's, else the strongest 2 s): a clip's first shot is centred on it.
  const best = await bestMoments(ws.dir, prepared.clips.filter((c) => c.kind !== "photo").map((c) => absPath(ws, c.path)), log);
  const preparedClips = prepared.clips.map((c) => {
    const e = editOf(edits, c.name);
    const auto = best.get(absPath(ws, c.path)) ?? null;
    const bestS = e.best ?? auto;
    const rank = rankOf(edits, c.name);
    return {
      id: c.clip.id, name: c.name, duration_ms: c.durationMs, path: c.path, durationFrames: c.durationFrames, kind: c.kind, fit: c.fit,
      ...(rank !== undefined ? { rank } : {}),
      ...(e.in !== undefined ? { in_ms: Math.round(e.in * 1000) } : {}),
      ...(e.out !== undefined ? { out_ms: Math.round(e.out * 1000) } : {}),
      ...(e.speed !== undefined ? { speed: e.speed } : {}),
      ...(bestS !== null && c.kind !== "photo" ? { best_ms: Math.round(bestS * 1000), best_from: e.best !== undefined ? ("clip editor" as const) : ("auto" as const) } : {}),
    };
  });

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

  // The music: the song itself, cut to the section; a fade only where the music is cut (see ../audio.ts).
  const songAudio = await probeMedia(sh.sp.songFile);
  const audioP = audioPlan({
    startMs: Math.round((plan.start_frame * 1000) / VIDEO.fps),
    endMs: chosen.end_ms,
    songMs: analysis.duration_ms,
    fadeInSeconds: preset.fadeInSeconds,
    fadeOutSeconds: ending ? ending.fadeOutS : preset.fadeOutSeconds,
    sourceRate: songAudio.sampleRate ?? null,
    sampleRate: preset.audioSampleRate,
  });
  if (preset.audio) sh.log(`${preset.name}: ${audioP.note}`);
  const { media, audio } = songMedia(ws.dir, sh.sp.songFile, plan, sh.catalog, audioP.fadeOutS, audioP.fadeInS);
  // With word times and the sung end (from the aligned LRC, else the alignment report) for the effects.
  const allLyrics = lines.map((l, i) => rawLyric({ ...l, sung_end_ms: sh.sectionLines[i].sung_end_ms ?? l.sung_end_ms }));
  const fx = chooseEffects(sh.brand.brand, options, sh.effectLabels);
  const motion = sh.brand.brand.motion;
  // Breathe (recipe): "beat" swells once a bar on the song's detected downbeats inside this video; Shine
  // sweeps a chorus line on a downbeat. The bars as frames of this video.
  const barFrames = downbeatTimes.filter((t) => t >= chosen.start_ms - 4000 && t <= chosen.end_ms + 4000).map((t) => Math.round(((t - chosen.start_ms) * VIDEO.fps) / 1000));
  const breathe: LyricEffectsProps["breathe"] = options.breathe === "gentle" ? { mode: "gentle" } : options.breathe === "beat" ? { mode: "beat", downbeats: barFrames } : undefined;
  const effects: LyricEffectsProps = {
    verse: fx.verse,
    hook: fx.hook,
    accent: sh.brand.brand.accentColour,
    gap: { hideMs: Math.round(motion.gapHideS * 1000), leadInMs: Math.round(motion.gapLeadInS * 1000) },
    ...(breathe ? { breathe } : {}),
    ...(options.heldGlow === "on" ? { heldGlow: true } : {}),
    ...(options.chorusLift === "on" ? { chorusLift: true } : {}),
    ...(options.shine === "on" ? { shine: true, downbeats: barFrames } : {}),
    ...(options.emphasis === "on" ? { emphasis: true } : {}),
    ...(options.textLayout === "bighook" ? { hookScale: BIG_HOOK_SCALE } : {}),
  };
  // A line whose singing is over but which is still on screen at the start (it lingers until the
  // next stamp) is not shown, so the video never opens on the tail of the previous line.
  // A line whose first word comes after the end would only flash up in the last 0.25 s: not shown either.
  const hidden = preset.lyrics
    ? [...finishedBeforeStart(sh.sectionLines, chosen.start_ms, leadMs, lyricsOffsetMs), ...startsAfterEnd(sh.sectionLines, chosen.end_ms, leadMs, lyricsOffsetMs)]
    : [];
  const shown = preset.lyrics ? lines.map((_, i) => i).filter((i) => !hidden.includes(i)) : [];
  // Story anchors (song.json): the line by the Lyrics tab's number, the clip from this run's clips (the
  // song's own and its collections). Never dropped silently: what is not found is said (QA too).
  const anchors: ResolvedAnchor[] = [];
  const anchorMissing: string[] = [];
  const anchorSlots: { line: number; text: string; clip: string }[] = [];
  if (usesClips && !canvas && preset.lyrics) {
    const stem = (n: string) => n.toLowerCase().replace(/\.[^.]+$/, "");
    for (const a of sh.anchors) {
      const i = lines[a.line - 1] ? a.line - 1 : -1;
      const clip = preparedClips.find((c) => c.name.toLowerCase() === a.clip.toLowerCase()) ?? preparedClips.find((c) => stem(c.name) === stem(a.clip));
      if (i < 0) anchorMissing.push(`the anchor on line ${a.line} (${a.clip}): the song has ${lines.length} sung lines`);
      else if (!clip) {
        // A slot: the line needs a clip (another clip set, or the clip was removed); refill it in the storyboard.
        anchorMissing.push(`slot: line ${a.line} "${lines[i].text}" needs a clip (${a.clip} is not among this video's clips: ${sh.picture?.label ?? "the song's clips and its collections"}, ${prepared.kind} for ${preset.label})`);
        anchorSlots.push({ line: a.line, text: lines[i].text, clip: a.clip });
      }
      else anchors.push({ line: a.line, text: lines[i].text, lyric: shown.indexOf(i), clipId: clip.id, clipName: clip.name, clipInMs: a.clipIn !== undefined ? Math.round(a.clipIn * 1000) : null, transition: a.transition ?? "cut" });
    }
  }
  // Lyric readability (src/readability.ts): "auto" (default) adds the soft dark band behind the lyrics
  // when at least a quarter of this video's clips are too bright behind them for the lyric colour or the
  // hook accent (thin strokes need more); "strong" / "normal" are the user's overrides. The clips are
  // measured at the moment their first shot is centred on (cached).
  const readabilityArea = ytLayout ? lyricAreaFor(ytLayout, preset) : areaForLayout(lyricArea(format, preset.safeZone, preset.lyricsAt), options.textLayout, preset.lyricsAt);
  // The theme's picture (src/picture.ts): the grade and vignette over the clips, what is behind the words,
  // the background where there is no clip (the cover blurred in advance for "cover"). The Canvas keeps the
  // clips' own colours when the theme says gradeCanvas "off".
  const textColour = options.picture?.textColour ?? "#ffffff";
  let pictureCover: string | null = null;
  if (options.picture?.fallback === "cover" && !options.dryRun) {
    const row = ws.db.select().from(projectTable).where(eq(projectTable.id, project.id)).get()!;
    const cover = resolveCover(ws, row, { cover: options.cover, songFile: path.resolve(options.song) });
    if (cover) pictureCover = await blurredBackground(ws, cover.stored, format).catch(() => null);
  }
  const picture = options.picture ? pictureOf({ ...options.picture, accentColour: sh.brand.brand.accentColour }, { canvas: !!canvas, coverSrc: pictureCover }) : null;
  const backing = lyricBackingFor(
    options.readability,
    preset.lyrics && usesClips && !canvas && options.readability !== "strong" && options.readability !== "normal"
      ? clipBandLuminances(
          ws.dir,
          preparedClips.map((c) => ({ file: absPath(ws, c.path), atS: c.kind === "photo" ? 0 : Math.max(0, Math.min((c.best_ms ?? c.in_ms ?? 1000) / 1000, c.duration_ms / 1000 - 0.1)) })),
          readabilityArea,
          format.height,
        )
      : [],
    {
      colour: textColour,
      accent: sh.brand.brand.accentColour,
      verseThin: isThinFace(styles.simple.main.family, styles.simple.main.weight),
      hookThin: isThinFace((styles.simple.hook ?? styles.simple.main).family, (styles.simple.hook ?? styles.simple.main).weight),
    },
  );
  if (preset.lyrics && !canvas) log(`${preset.name}: ${backing.text}`);
  const story = !canvas && (sh.gapOrder === "story" || (!sh.gapOrder && sh.anchors.length > 0));
  const layout: PlatformLayout = {
    format,
    safeZone: preset.safeZone,
    lyricsAt: preset.lyricsAt,
    textScale: preset.textScale,
    loopEnding: preset.loopEnding,
    ...(ytLayout ? { lyricSafeZone: youtubeLyricSafeZone(ytLayout, preset.safeZone) } : {}),
    ...(options.textLayout && options.textLayout !== "centre" ? { textLayout: options.textLayout } : {}),
  };
  const base: RenderBase = {
    plan,
    clips: usesClips ? preparedClips : [],
    audio: preset.audio ? audio : null,
    durationInFrames: plan.end_frame - plan.start_frame,
    lyrics: shown.map((i) => allLyrics[i]),
    styles: { simple: styles.simple.entry, bold: styles.bold.entry },
    colour: textColour,
    cinematicBars: false,
    pins,
    ...(picture ? { picture } : {}),
    platform: layout,
    beats: analysis.beats,
    ...(anchors.length ? { anchors } : {}),
    ...(backing.backing && preset.lyrics ? { lyricBacking: true } : {}),
    // Loop platforms: the last frames blend into the first shot's opening when the last shot cannot
    // continue into it (about the ending's fade, 0.4-1 s).
    ...(loops && usesClips ? { loopInto: Math.max(12, Math.min(30, Math.round((ending?.fadeOutS ?? 0.5) * VIDEO.fps))) } : {}),
    // Automatic transitions (src/transitions.ts): from the song's feel, its hooks and sung stretches; a
    // clip's own choice in the clip editor (clips.json "transition") wins.
    ...(usesClips && !canvas
      ? {
          transitions: {
            style: options.transitions ?? "auto",
            feel: pace?.feel ?? songFeel(sh.sectionLines.map((l) => ({ text: l.text, sungStartMs: sungStart(l), sungEndMs: sungEnd(l), ...(l.words?.length ? { words: l.words.length } : {}) }))).feel,
            hooks,
            sung: sh.sectionLines.map((l) => ({ start_ms: sungStart(l), end_ms: sungEnd(l) })),
            byClip: Object.fromEntries(preparedClips.flatMap((c) => { const t = editOf(edits, c.name).transition; return t ? [[c.id, t]] : []; })),
          },
        }
      : {}),
  };
  // The textboard's lyric cards (their own place, size, hold, effect and font) for the lines shown.
  const cardFonts: FontFileRef[] = [];
  if (preset.lyrics && !canvas) {
    const board = sh.textboard.board;
    base.cards = shown.map((i) => {
      const card = board.cards.find((c) => c.type === "lyric" && c.line === i + 1);
      if (!card) return null;
      const style = lyricCardStyle(board, card, lines[i].isHook);
      const main = lines[i].isHook && styles.simple.hook ? styles.simple.hook : styles.simple.main;
      const own = cardFont(sh.catalog, style, { family: main.family, weight: main.weight, italic: main.style === "italic" }, lines[i].text, `line ${i + 1} font`);
      if (own) {
        cardFonts.push(...own.refs);
        for (const w of own.warnings) if (!warnings.includes(`${preset.name}: textboard: ${w}`)) warnings.push(`${preset.name}: textboard: ${w}`);
      }
      return { id: card.id, style, ...(own ? { font: own.font } : {}) };
    });
  }

  // Which lines are on screen (same rule as composeProps).
  const frames = lyricFrames(base, leadMs, lyricsOffsetMs, true, effects.gap);
  const visible = frames
    .map((f, k) => ({ i: shown[k], start: Math.max(0, f.startFrame), end: Math.min(base.durationInFrames, f.endFrame) }))
    .filter((v) => v.end > v.start)
    .map((v) => v.i);
  const notes = hidden.map(
    (i) => `line ${numbers[i] || i + 1} "${lines[i].text}" is not shown: it is sung ${lines[i].start_ms < chosen.start_ms ? "before the section starts" : "after the section ends"}`,
  );
  for (const style of ["simple", "bold"] as const) {
    const s = styles[style];
    const area = ytLayout ? lyricAreaFor(ytLayout, preset) : areaForLayout(lyricArea(format, preset.safeZone, preset.lyricsAt), options.textLayout, preset.lyricsAt);
    const textSize = Math.round(s.entry.textSize * preset.textScale * (ytLayout === "cover" ? COVER_TEXT_SCALE : 1));
    for (const l of tooLongLines(visible.map((i) => lines[i]), { main: s.main, hook: s.hook, textCase: s.entry.style.textCase, textSize, area })) {
      const n = numbers[lines.indexOf(l)] || lines.indexOf(l) + 1;
      warnings.push(`Line ${n} is too long for phone screens (${s.entry.style.name}); split it in ${path.basename(alignment.lyricsTxt)}: "${l.text}"`);
    }
  }

  if (story && !canvas) log(`${preset.name}: gap order story (${sh.gapOrder ? "song.json gapOrder" : "the song has anchors"}): every video in file-name order; they differ by style, cut rate and cut / dissolve`);
  for (const m of anchorMissing) warnings.push(`${preset.name}: ${m}`);
  // Compare pairings: one video per pairing with the same section, clips, order, cut rate and style, so
  // only the fonts differ (presets/font-pairings.json, or "brand" for the artist's own).
  const pairingIds = options.pairings && !canvas && preset.lyrics ? options.pairings.split(/[\s,]+/).filter(Boolean) : [];
  const allPairings = pairingIds.length ? loadPairings(sh.catalog, sh.brand.brand) : null;
  if (allPairings?.problems.length) warnings.push(...allPairings.problems.map((p) => `font-pairings.json: ${p}`));
  const compared = allPairings ? pairingIds.map((id) => findPairing(allPairings.pairings, id)) : [];
  if (compared.length > 4) throw new Error("--pairings: at most 4 pairings in one run (2-3 compare best).");
  const pairStyles = new Map(compared.map((p) => [p.id, sh.stylesFor(p.verse.family, p.hook.family, { weight: p.verse.weight, hookWeight: p.hook.weight, italic: p.verse.italic, hookItalic: p.hook.italic })]));
  for (const [id, st] of pairStyles) for (const w of fontWarnings(st)) warnings.push(`${preset.name}: pairing ${id}: ${w}`);
  const stylesOf = (spec: VariationSpec) => (spec.pairing ? pairStyles.get(spec.pairing.id)! : styles);
  const baseFor = (spec: VariationSpec): RenderBase => (spec.pairing ? { ...base, styles: { simple: stylesOf(spec).simple.entry, bold: stylesOf(spec).bold.entry } } : base);
  if (compared.length) log(`${preset.name}: comparing font pairings: ${compared.map((p, i) => `v${i + 1} ${p.name} (${p.verse.family} ${p.verse.weight}${p.verse.italic ? " italic" : ""} + ${p.hook.family} ${p.hook.weight}${p.hook.italic ? " italic" : ""})`).join(", ")}; the same section, clips and order in each`);
  const allSpecs: VariationSpec[] = sh.picture
    ? [{ index: sh.picture.index, name: `v${sh.picture.index}`, order: "story", seed: 1, style: "simple", bars: false, picture: { index: sh.picture.index, label: sh.picture.label, songClips: sh.picture.songClips, collections: sh.picture.collections }, ...(story ? { rate: options.rate ?? "1x", transitions: "as-set" as const } : {}) }]
    : compared.length
    ? compared.map((p, i) => ({ index: i + 1, name: `v${i + 1}`, order: "story", seed: 1, style: "simple", bars: false, pairing: { id: p.id, name: p.name }, ...(story ? { rate: options.rate ?? "1x", transitions: "as-set" as const } : {}) }))
    : options.take && !canvas
    ? planTake(options.take, story ? { rate: options.rate ?? "1x" } : undefined)
    : planVariations(canvas ? Math.max(1, canvas.loops.length) : sh.variationsFor(preset), story ? { rate: options.rate ?? "1x" } : undefined);
  const plans = new Map<CutRate, typeof plan>([[options.rate ?? "1x", plan]]);
  const cardNotesBySpec = new Map<string, string[]>(); // the hook / end card's notes (no room for it in this video)
  const planOf = (spec: VariationSpec) => {
    const rate = spec.rate ?? options.rate ?? "1x";
    if (!plans.has(rate)) plans.set(rate, planFor(rate));
    return plans.get(rate)!;
  };
  const choicesFor = (spec: VariationSpec) => ({
    seed: spec.seed, style: spec.style, order: spec.order, leadMs, lyricsOffsetMs, cinematicBars: ytLayout ? false : spec.bars, effects,
    plan: planOf(spec), ...(spec.transitions ? { transitions: spec.transitions } : {}),
  });
  let specs = allSpecs;
  if (options.resume) {
    const changed = resumeMismatch(exportDir, allSpecs, {
      section: chosen,
      lrcHash: alignment.lrcHash,
      leadMs,
      lyricsOffsetMs,
      cutFrames: (spec) => (canvas || ytLayout ? plan.cuts.map((c) => c.frame - plan.start_frame) : composeProps(baseFor(spec), choicesFor(spec)).props.cutFrames),
      clipHashes: new Set(prepared.clips.map((c) => c.hash)),
      settings: (spec) => ({
        cut_rate: spec.rate ?? options.rate ?? "1x", energy: options.energy ?? "medium", font: options.font ?? null, font_hook: options.fontHook ?? null,
        line_effect: choiceText(fx.verse), hook_effect: choiceText(fx.hook),
      }),
    });
    if (changed) throw new Error(`--resume: ${changed} since the run in ${exportDir}; run without --resume to make a new set.`);
    specs = allSpecs.filter((s) => !variationDone(exportDir, s.name));
  }
  const limit = renderLimit({ platform: options.platform, requested: options.parallel });
  const sources = { usable: prepared.usable, needed, kind: prepared.kind, filled: prepared.filled, skipped: prepared.skipped };
  // Compose every variation now, so its warnings are part of the plan printed before rendering.
  const composedBySpec = new Map(
    specs.map((spec) => {
      const composed = composeProps(baseFor(spec), choicesFor(spec));
      const cardNotes: string[] = [];
      cardNotesBySpec.set(spec.name, cardNotes);
      if (composed.anchors && spec === specs[0]) {
        // One line per anchor (what the first video does with it), then the conflicts once.
        for (const u of composed.anchors.uses) {
          log(`${preset.name}: anchor line ${u.line} "${u.text}" -> ${u.clip}: ${u.used ? `at ${clockText(u.at_ms!)}${u.transition === "dissolve" ? " (dissolve)" : ""}${u.why ? `, ${u.why}` : ""}${u.playback_rate ? `, slowed to ${u.playback_rate.toFixed(2)}x` : ""}` : `not used (${u.why})`}`);
        }
        warnings.push(...composed.anchors.conflicts.map((c) => `${preset.name}: anchors: ${c}`));
      }
      composed.props = { ...composed.props, nextLine: preset.showNextLine };
      warnings.push(...composed.warnings.map((w) => `${spec.name}: ${w}`));
      if (ytLayout) {
        const title = sh.brand.brand.titleFont;
        composed.props = {
          ...composed.props,
          ...youtubeExtras({
            layout: ytLayout, preset, props: composed.props, brand: sh.brand.brand, logo: sh.logo, ws, title: project.title, artist: project.artist,
            cover: coverSrc, coverBackground, stills: stillsPlan?.stills ?? null, beats: analysis.beats, startMs: chosen.start_ms,
            grain: options.grain ?? preset.youtube!.grain, glow: options.glow ?? preset.youtube!.glow,
            sections: lyricSections(lines, analysis.duration_ms), seed: spec.seed,
          }),
          fonts: [...composed.props.fonts, ...fontFileRefs(resolveFace(sh.catalog, title.family, title.weight))],
        };
      } else if (canvas) {
        // The loop itself: one clip window (or a looping photo), nothing else on screen, no sound.
        const loop = canvas.loops[spec.index - 1];
        composed.props = { ...composed.props, shots: [loop.shot], cutFrames: [], lyrics: [], audio: null, durationInFrames: canvas.lengthFrames };
      } else if (sh.logo && preset.lyrics && sh.brand.brand.logo.platforms.includes(preset.name)) {
        // 9:16 (only if brand.json logo.platforms lists it): the configured frame corner.
        composed.props = {
          ...composed.props,
          logo: { ...placeLogo(ws, sh.logo, format, sh.brand.brand.logo.vertical, sh.brand.brand.logo.size), goneAt: null },
        };
      }
      if (preset.lyrics && !canvas) {
        // The textboard: title / byline / tagline cards (YouTube's title as before unless the board
        // changes it), and the fonts of the cards with their own font.
        const { titleOverlay, ...rest } = composed.props;
        const tc = titleCards(sh.textboard.board, {
          format, area: rest.lyricArea!, fps: VIDEO.fps, durationInFrames: rest.durationInFrames, youtube: titleOverlay ?? null,
          titleFont: sh.brand.brand.titleFont, accent: sh.brand.brand.accentColour, textScale: preset.textScale,
          fontFor: (style, b, text, role) => cardFont(sh.catalog, style, b, text, role),
          // The title opening: gone as the first lyric line fades in.
          opening: titleOpeningOn ? { untilFrame: rest.lyrics[0] ? (rest.lyrics[0].enterFrame ?? rest.lyrics[0].startFrame) : Math.min(rest.durationInFrames, Math.round(TITLE_ALONE_S * VIDEO.fps)) } : null,
          fallbackFor: (face, text) => titleFallback(sh.catalog, face, text),
          fit: { safeZone: preset.safeZone, catalog: sh.catalog },
        });
        for (const w of tc.warnings) if (!warnings.includes(`${preset.name}: textboard: ${w}`)) warnings.push(`${preset.name}: textboard: ${w}`);
        // The theme's hook and end cards (Reels, TikTok, Shorts): always planned, drawn only when on.
        if (loops && options.picture) {
          const pic = options.picture;
          const song = sh.getProject();
          const titleCard = sh.textboard.board.cards.find((c) => c.type === "title");
          const title = (titleCard?.overrides.text ?? titleCard?.text ?? song.title).trim() || song.title;
          const firstHook = rest.lyrics.find((l) => l.isHook)?.text ?? "";
          const hookFace = rest.hookFont ? { family: rest.hookFont.font, weight: rest.hookFont.weight, italic: rest.hookFont.italic === true } : { family: rest.style.font, weight: rest.style.weight ?? 400, italic: rest.style.italic === true };
          const titleEnd = Math.max(0, ...tc.cards.map((c) => (c.endFrame === Infinity ? 0 : c.endFrame)));
          const ex = extraCards({
            lyrics: rest.lyrics, fps: VIDEO.fps, durationInFrames: rest.durationInFrames, area: rest.lyricArea!, titleEndFrame: Math.min(titleEnd, rest.durationInFrames),
            hook: { text: (pic.hookText || firstHook).trim(), font: hookFace, size: Math.round(TITLE_SIZE_VERTICAL * preset.textScale * 1.1), colour: sh.brand.brand.accentColour, style: pic.hookCardStyle ?? "plain", off: pic.hookCard !== "on" },
            end: { text: fillCardText(pic.endText ?? "", { title, artist: song.artist }), font: { family: sh.brand.brand.titleFont.family, weight: sh.brand.brand.titleFont.weight }, size: Math.round(TITLE_SIZE_VERTICAL * preset.textScale * 0.6), colour: textColour, style: pic.endCardStyle ?? "label", off: pic.endCard !== "on" },
          });
          if (ex.cards.length) {
            const measure = cardMeasure(sh.catalog, ex.cards);
            tc.cards.push(...fitCardBlocks(ex.cards, { format, safeZone: preset.safeZone, measure }));
          }
          for (const n of ex.notes) if ((n.startsWith("Hook") ? pic.hookCard : pic.endCard) === "on") cardNotes.push(n);
        }
        const titleFace = tc.cards.some((c) => c.font === sh.brand.brand.titleFont.family) && !ytLayout ? fontFileRefs(resolveFace(sh.catalog, sh.brand.brand.titleFont.family, sh.brand.brand.titleFont.weight)) : [];
        const fonts = [...rest.fonts, ...cardFonts, ...tc.fonts, ...titleFace].filter((f, k, all) => all.findIndex((x) => x.src === f.src) === k);
        composed.props = { ...rest, ...(tc.cards.length ? { textCards: tc.cards } : {}), fonts };
      }
      if (preset.loopEnding && !loopsSeamlessly(composed.props.shots) && !composed.props.loopInto) {
        warnings.push(`${preset.name} ${spec.name}: no seamless loop ending (the first clip is too short to also fill the last shot)`);
      }
      return [spec.name, composed] as const;
    }),
  );
  if (options.dryRun) {
    // The storyboard: the plan, exactly as the render would get it.
    return {
      name: preset.name, label: preset.label, exportDir, section: { start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason }, limit, variations: [], warnings, error: null,
      plan: {
        videos: specs.map((spec) => {
          const composed = composedBySpec.get(spec.name)!;
          return {
            spec, props: composed.props, anchors: anchors.length || anchorMissing.length ? { ...(composed.anchors ?? { uses: [], conflicts: [], notes: [] }), missing: anchorMissing } : null,
            loop: loops ? loopResult(composed.props, prepared.clips, { bpm: analysis.bpm, downbeats: downbeatTimes, startMs: chosen.start_ms, audio: loopSong, lines: sh.sectionLines, numbers, ending, titleLeadMs: titleLead }) : null,
            decisions: [pace?.text, composed.transitions?.text, ...(cardNotesBySpec.get(spec.name) ?? [])].filter((x): x is string => !!x),
          };
        }),
        // Loop platforms: target lengths whose end loops well from this start (beat, level, harmony).
        loopSuggestions: loops
          ? loopSuggestions({
              audio: loopSong, bpm: analysis.bpm, startMs: chosen.start_ms, durationMs: analysis.duration_ms,
              downbeats: downbeatTimes,
              lines: loopLines,
              currentEndMs: chosen.end_ms,
              // Never suggest dropping a chorus line or the title line the plan has.
              keep: loopLines.filter((l, i) => (sh.sectionLines[i].isHook || isTitleLine(l.text, project.title)) && l.sungStartMs >= chosen.start_ms && l.sungEndMs <= chosen.end_ms),
              targetMs: preset.length.mode === "target" ? preset.length.seconds * 1000 : preset.length.mode === "range" ? ((preset.length.min + preset.length.max) / 2) * 1000 : chosen.end_ms - chosen.start_ms,
            })
          : null,
        media,
        clips: prepared.clips.map((c, i) => {
          const e = preparedClips[i];
          return {
            path: c.path, name: c.name, clipId: c.clip.id, thumb: c.clip.thumb_path, durationMs: c.durationMs, kind: c.kind,
            rank: e.rank ?? null, inMs: e.in_ms ?? null, outMs: e.out_ms ?? null, speed: e.speed ?? null, bestMs: e.best_ms ?? null, bestFrom: e.best_from ?? null,
            transition: editOf(edits, c.name).transition ?? null,
          };
        }),
        section: { mode: chosen.mode, start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason },
        analysis: { bpm: analysis.bpm, beats: analysis.beats, duration_ms: analysis.duration_ms },
        lines: lines.map((l, i) => ({ number: i + 1, text: l.text, isHook: l.isHook, start_ms: l.start_ms, end_ms: l.end_ms, sung_end_ms: sh.sectionLines[i].sung_end_ms ?? l.sung_end_ms ?? null })),
        slots: anchorSlots,
        // As the planner reports them (the same for every video of the platform).
        anchorsOutside: (composedBySpec.get(specs[0]?.name ?? "")?.anchors?.uses ?? []).filter((u) => !u.used && u.why === "outside this section").map((u) => ({ line: u.line, text: u.text, clip: u.clip })),
      },
    };
  }
  options.onReady?.({
    platform: { name: preset.name, label: preset.label, index: position.index, count: position.count, folder: exportDir },
    sources: usesClips ? sources : null,
    layout: ytLayout,
    brand: { file: sh.brand.file, created: sh.brand.created },
    project: { title: project.title, created: sh.sp.created },
    bpm: analysis.bpm,
    songMs: analysis.duration_ms,
    downbeatConfidence: analysis.downbeat_confidence,
    lyrics: {
      source: alignment.source,
      file: alignment.lrcFile,
      lines: lines.length,
      hooks: lines.filter((l) => l.isHook).length,
      low: reports.flatMap((r, i) => (r && r.confidence < LOW_CONFIDENCE ? [{ number: numbers[i] || i + 1, text: lines[i].text, confidence: r.confidence }] : [])),
    },
    lyricsOffsetMs,
    effects: preset.lyrics ? { verse: choiceText(fx.verse), hook: choiceText(fx.hook), from: fx.from, showNextLine: preset.showNextLine } : null,
    section: { start_ms: chosen.start_ms, end_ms: chosen.end_ms, reason: chosen.reason },
    collection: {
      name: sh.collection.collection.name,
      folder: sh.collection.folder,
      clips: sh.collection.sources.length,
      added: sh.collection.added.length,
      changed: sh.collection.changed.length,
      unchanged: sh.collection.unchanged.length,
      removed: sh.collection.removed.length,
      remembered: sh.collectionRemembered,
    },
    cuts: plan.cuts.length,
    limit,
    exportDir,
    resume: options.resume ? { done: allSpecs.length - specs.length, toRender: specs.map((s) => s.name) } : null,
    warnings: [...warnings],
    notes,
  });
  const states: RenderState[] = specs.map((s) => ({ platform: preset.name, name: s.name, status: "queued", progress: 0 }));
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
        cut_rate: spec.rate ?? options.rate ?? "1x",
        style_id: ws.db.select().from(stylePreset).where(eq(stylePreset.name, stylesOf(spec)[spec.style].entry.style.name)).get()?.id ?? null,
        text_size: composed.props.textSize,
        colour: composed.props.colour,
        cinematic_bars: spec.bars,
        overrides_json: {
          platform: preset.name, order: spec.order, lead_ms: leadMs, lyrics_offset_ms: lyricsOffsetMs,
          font: options.font ?? null, font_hook: options.fontHook ?? null, lrc: alignment.lrcStored,
          line_effect: choiceText(fx.verse), hook_effect: choiceText(fx.hook),
          run: storedPath(ws, sh.rootDir), // the run folder (the studio links jobs to their videos)
          ...(options.runId ? { make_run: options.runId } : {}),
        },
      })
      .returning()
      .get();
    // pid: this process owns the job; if it disappears, the job counts as interrupted (see jobs.ts).
    const job = ws.db.insert(renderJobTable).values({ variation_id: variationRow.id, pid: process.pid }).returning().get();
    return { spec, props: composed.props, jobId: job.id, anchorReport: composed.anchors };
  });
  report();

  const updateJob = (id: string, values: Partial<typeof renderJobTable.$inferInsert>) =>
    ws.db.update(renderJobTable).set(values).where(eq(renderJobTable.id, id)).run();

  await runPool(jobs, limit.parallel, async ({ spec, props, jobId, anchorReport }) => {
    const state = states.find((st) => st.name === spec.name)!;
    const file = path.join(exportDir, `${spec.name}.mp4`);
    if (options.shouldStop?.()) {
      // Stopped: this video is not started; its job is "interrupted" so Resume makes it later.
      state.status = "stopped";
      report();
      updateJob(jobId, { status: "interrupted", error: "stopped before it started (Resume makes it)", finished_at: new Date() });
      return;
    }
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
        sampleRate: audioP.sampleRate,
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
      // The wrap-around from the last frame to the first (the section as rendered, to the frame).
      const loop = loops ? loopResult(props, prepared.clips, { bpm: analysis.bpm, downbeats: downbeatTimes, startMs: chosen.start_ms, audio: loopSong, lines: sh.sectionLines, numbers, ending, titleLeadMs: titleLead }) : null;
      const anchorsOut = anchors.length || anchorMissing.length ? { ...(anchorReport ?? { uses: [], conflicts: [], notes: [] }), missing: anchorMissing } : null;
      const qa = await checkVariation(spec, props, file, {
        loop,
        anchors: anchorsOut,
        lines, visible, numbers, reports, styles: stylesOf(spec), clips: prepared.clips, catalog: sh.catalog,
        sources: usesClips ? { ...sources, platform: preset.label } : null,
        frameCheck: options.frameCheck ?? true,
        stillPictures: ytLayout === "cover" || ytLayout === "stills" || (!!canvas && props.shots[0]?.kind === "photo"),
        songS: chosen.mode === "full" ? analysis.duration_ms / 1000 : null, // whole-song videos only (not --section)
        sectionCuts: chosen.cuts.map((c) => ({ ...c, line: numbers[c.line - 1] || c.line })),
        platformLimit: platformLimit(chosen, preset),
        canvas: canvas ? { min: preset.length.mode === "loop" ? preset.length.min : 3, max: preset.length.mode === "loop" ? preset.length.max : 8 } : null,
        audio: props.audio ? { song: sh.sp.songFile, fadeInS: audioP.fadeInS, fadeOutS: audioP.fadeOutS } : null,
      });
      result.qa = qa;
      result.qaSummary = qa.status === "PASS" ? "PASS" : `WARN (${qaReasons(qa)})`;
      writeFileSync(result.qaFile, formatQa(qa, qaTitle(spec, project.title, chosen, preset)));
      writeManifest(
        result.manifestFile,
        buildManifest({
          ws, tool: sh.tool, spec, props, media, project, songHash: sh.sp.songHash, songFile: sh.sp.songFile, analysis, chosen, alignment, reports, numbers, audioPlan: audioP, pace, transitionPlan: composedBySpec.get(spec.name)?.transitions ?? null, canvasPlan: canvas, readability: preset.lyrics && !canvas ? backing : null,
          visible, lines, leadMs, lyricsOffsetMs, options, collection: sh.collection, collectionNames: sh.collectionNames, clips: prepared.clips, file, qa, now: sh.now, warnings, preset,
          brand: sh.brand.brand, anchors: anchorsOut, gapOrder: story ? "story" : null,
          textboard: preset.lyrics && !canvas
            ? {
                file: sh.textboard.stored ? "textboard.json" : null, hash: sh.textboard.hash, template: sh.textboard.board.template,
                changes: overrideCount(sh.textboard.board), cards: sh.textboard.board.cards.length,
              }
            : null, loop: loops ? (loop ? { checked: true, ...loop } : null) : { checked: false, why: canvas ? "a Spotify Canvas has its own loop checks" : `${preset.label} does not loop` },
        }),
      );
      // Captions for every video; YouTube also gets a thumbnail and a publishing pack.
      if (preset.lyrics && props.lyrics.length) writeSrt(result.srtFile, props); // (a Canvas, an instrumental without a story: no captions)
      // Reels / TikTok / Shorts: a cover with the title, byline and tagline (the title opening's cards, also
      // when the video itself starts on the hook), on the hook's frame.
      const coverRender = options.coverRenderer ?? (options.renderer ? null : renderCover);
      if (loops && preset.lyrics && props.shots.length && coverRender) {
        const cover = coverProps(props, sh, preset, format);
        if (cover) {
          const one = allSpecs.length === 1;
          result.coverFile = path.join(exportDir, one ? "cover.jpg" : `${spec.name}.cover.jpg`);
          const hookIndex = lines.findIndex((l) => l.isHook);
          const hookFrame = hookIndex >= 0 ? Math.round(((lines[hookIndex].start_ms - chosen.start_ms) * VIDEO.fps) / 1000) : 0;
          try {
            await coverRender({ props: cover, media, outFile: result.coverFile, frame: Math.max(15, hookFrame + 15), log });
          } catch (error) {
            warnings.push(`${preset.name} ${spec.name}: the cover could not be made (${(error as Error).message.split("\n")[0]})`);
            result.coverFile = undefined;
          }
        }
      }
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
            logo: props.logo ? { src: props.logo.src, position: sh.brand.brand.logo.youtube, width: Math.round(sh.brand.brand.logo.size * 1280) } : null,
          },
          media,
          outFile: result.thumbnailFile,
          log,
        });
        const pack = publishText(ws.dir, { song: project.title, artist: project.artist, lyricsTxt: readFileSync(alignment.lyricsTxt, "utf8"), year: sh.now.getFullYear(), ep: sh.ep, links: sh.youtubeLinks, ...(props.endScreen?.seconds ? { endScreen: endScreenText({ fromFrame: props.endScreen.fromFrame, seconds: props.endScreen.seconds }, VIDEO.fps) } : {}) }, path.dirname(artistBrandFile(ws.dir, project.artist, "publish-template.txt").file));
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
    `${spec.order === "shuffle" ? ` (seed ${spec.seed})` : ""}${spec.bars ? ", cinematic bars" : ""}${spec.pairing ? `, fonts: ${spec.pairing.name}` : ""}\n` +
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
    platformLimit: { seconds: number; limitS: number; platform: string } | null;
    songS: number | null; // a full-song video: the song's length
    canvas?: { min: number; max: number } | null; // Spotify Canvas: loop, silence and length checks
    audio?: { song: string; fadeInS: number; fadeOutS: number } | null; // compared with the song (QA "Audio matches the song")
    loop?: LoopResult | null; // Reels, TikTok, Shorts: QA "Loop flows"
    anchors?: (AnchorReport & { missing: string[] }) | null; // story anchors: QA "Story anchors"
    catalog?: FontCatalog; // textboard cards with their own font are measured in it
  },
): Promise<QaReport> {
  const style = ctx.styles[spec.style];
  const nameBySrc = new Map(ctx.clips.map((c) => [c.path, c.name]));
  const lyrics = ctx.visible.map((i, k) => ({
    ...props.lyrics[k],
    number: ctx.numbers[i] || i + 1,
    confidence: ctx.reports[i]?.confidence ?? null,
    earlyMs: ctx.reports[i]?.early_ms ?? null,
    review: ctx.reports[i]?.review ?? null,
    checkedByEar: ctx.reports[i]?.checked_by_ear ?? false,
  }));
  // Lines reaching into the end-screen time are drawn (and measured) in the end-screen area.
  const end = props.endScreen;
  const inEnd = (l: (typeof lyrics)[number]) => !!end && l.endFrame > end.fromFrame;
  const measure = (ls: typeof lyrics, area: LyricArea | undefined) =>
    measureLyrics(ls, {
      main: style.main, hook: style.hook, textCase: style.entry.style.textCase, textSize: props.textSize, animation: style.entry.style.animation, area,
      effects: props.lyricEffects ?? null, nextLine: props.nextLine ?? false, nextScale: props.nextLineScale ?? 0.55,
      ...(ctx.catalog ? { cardFace: (f: { family: string; weight: number; italic?: boolean }) => resolveFace(ctx.catalog!, f.family, f.weight, f.italic ? "italic" : "normal") } : {}),
    });
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
    platformLimit: ctx.platformLimit,
    endScreen: end ? { clear: end.clear, lines: lyrics.filter(inEnd).map((l) => l.number) } : null,
    frozenCheckSkipped: ctx.stillPictures,
    length: ctx.frameCheck ? { actualS: (await probeMedia(file)).durationMs / 1000, songS: ctx.songS } : null,
    audioMatch:
      ctx.frameCheck && ctx.audio && props.audio
        ? await compareAudio(
            file,
            ctx.audio.song,
            { startMs: (props.audio.startFrame * 1000) / VIDEO.fps, endMs: ((props.audio.startFrame + props.durationInFrames) * 1000) / VIDEO.fps },
            ctx.audio,
          )
        : null,
    canvas: ctx.frameCheck && ctx.canvas ? { ...(await loopCheck(file)), ...ctx.canvas } : null,
    loop: ctx.loop ?? null,
    anchors: ctx.anchors ?? null,
    titleCards: ctx.catalog && props.textCards?.some((c) => !c.off) && (props.format?.height ?? 1920) > (props.format?.width ?? 1080) ? titleCardsQa(props, ctx.catalog) : null,
  });
}

// The title opening for QA: the cards' blocks (measured in their own fonts), when the first lyric line
// appears, characters no font draws, and the profile grid's 3:4 crop (vertical videos).
export function titleCardsQa(props: Omit<LyricVideoProps, "mediaBaseUrl">, catalog: FontCatalog): NonNullable<QaInput["titleCards"]> {
  const cards = (props.textCards ?? []).filter((c) => !c.off); // a card the theme has off is not drawn
  const faces = new Map<string, ReturnType<typeof resolveFace> | null>();
  const faceOf = (c: (typeof cards)[number]) => {
    const key = `${c.font}|${c.weight}|${c.italic ? 1 : 0}`;
    if (!faces.has(key)) {
      try {
        faces.set(key, resolveFace(catalog, c.font, c.weight, c.italic ? "italic" : "normal"));
      } catch {
        faces.set(key, null);
      }
    }
    return faces.get(key)!;
  };
  const blocks = cardBlocks(cards, props.format ?? { width: 1080, height: 1920 }, cardMeasure(catalog, cards));
  const missing = new Set<string>();
  for (const c of cards) {
    const face = faceOf(c);
    if (!face) continue;
    const chars = [...new Set([...c.text].filter((x) => /\S/.test(x)))];
    let lacks = missingCharacters(face, chars);
    if (lacks.length && c.fallbackFont) {
      try {
        lacks = missingCharacters(forText(resolveFace(catalog, c.fallbackFont, c.weight), lacks.join("")), lacks);
      } catch {
        // the fallback is not bundled
      }
    }
    for (const x of lacks) missing.add(x);
  }
  const first = props.lyrics[0];
  const format = props.format ?? { width: 1080, height: 1920 };
  return { blocks, firstLyricFrame: first ? (first.enterFrame ?? first.startFrame) : null, missing: [...missing], grid: format.height > format.width ? gridCrop(format) : null };
}

// QA "Loop flows" for one video: its length against whole bars, the lines at both ends, the music's
// level and harmony at the loop point (the song's own section, to the frame), and the clips at both ends.
export function loopResult(
  props: Pick<LyricVideoProps, "shots" | "durationInFrames" | "audio" | "loopInto">,
  clips: readonly { path: string; name: string }[],
  c: { bpm: number; downbeats?: readonly number[]; startMs: number; audio: LoopAudio | null; lines: readonly SectionLine[]; numbers: readonly number[]; ending?: Ending | null; titleLeadMs?: number },
): LoopResult {
  const lengthMs = (props.durationInFrames * 1000) / VIDEO.fps;
  const startMs = props.audio ? (props.audio.startFrame * 1000) / VIDEO.fps : c.startMs;
  const nameBySrc = new Map(clips.map((k) => [k.path, k.name]));
  const name = (s: LyricVideoProps["shots"][number] | undefined) => (s ? (nameBySrc.get(s.src) ?? s.src) : null);
  return loopFlows({
    lengthMs,
    bpm: c.bpm,
    downbeats: c.downbeats,
    ending: c.ending ?? null,
    ...(c.titleLeadMs ? { titleLeadMs: c.titleLeadMs } : {}),
    startMs,
    endMs: startMs + lengthMs,
    lines: c.lines.map((l, i) => ({ number: c.numbers[i] || i + 1, text: l.text, sungStartMs: sungStart(l), sungEndMs: sungEnd(l) })),
    audio: c.audio,
    firstClip: name(props.shots[0]),
    lastClip: name(props.shots[props.shots.length - 1]),
    shots: props.shots.length,
    continues: loopsSeamlessly(props.shots) || !!props.loopInto,
  });
}

function buildManifest(c: {
  ws: Workspace;
  audioPlan?: AudioPlan;
  pace?: Pace | null; // automatic pacing (src/pace.ts)
  canvasPlan?: CanvasPlan | null; // Spotify Canvas: the loop's length, the longest possible, the clip that would make it
  transitionPlan?: { text: string; kinds: string[] } | null; // automatic transitions (src/transitions.ts)
  readability?: BackingDecision | null; // lyric readability: the soft backing and why (src/readability.ts)
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
  collectionNames: string[];
  clips: PreparedForFormat["clips"];
  file: string;
  qa: QaReport;
  now: Date;
  warnings: string[];
  preset: PlatformPreset;
  brand: Brand;
  loop?: Manifest["loop"];
  anchors?: (AnchorReport & { missing: string[] }) | null;
  gapOrder?: GapOrder | null;
  textboard?: Manifest["textboard"];
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
      vocal_guard: c.alignment.guard?.moves ?? null, // lines moved to where the voice starts (not in the stored LRC)
      hand_times: c.alignment.handTimes ?? null, // lines set by hand in the Lyrics tab (hints.lrc "!" lines)
      vocal_check: c.alignment.guard?.check ?? null, // what the vocal-start check measured (singing level, per checked line)
      // The vocal track the timing listened to (analysis only; never in the video): "vocal stem, offset 1.8 s" / "separated by the app".
      voice_source: c.alignment.source === "given" || c.alignment.source === "story" ? null : voiceRecord(c.alignment.voice),
      source: c.alignment.source,
      hint: c.alignment.hint
        ? { file: c.alignment.hint.file, sha256: c.alignment.hint.hash, source: c.alignment.hint.source, stored: c.alignment.hint.stored }
        : null,
      lang: c.options.lang ?? "en",
      lead_ms: c.leadMs,
      lyrics_offset_ms: c.lyricsOffsetMs,
    },
    settings: {
      cut_rate: spec.rate ?? c.options.rate ?? "1x",
      theme: c.options.theme ?? null, // the song's theme (or --theme / Compare themes for this run)
      picture: c.props.picture ? { grade: c.props.picture.grade, vignette: c.props.picture.vignette, text_backing: c.props.picture.backing, fallback: c.props.picture.fallback, text_colour: c.props.colour } : null, // the theme's picture (src/picture.ts)
      // The theme's hook / end card as drawn (src/extra-cards.ts): only the ones switched on.
      extra_cards: (c.props.textCards ?? []).filter((t) => (t.type === "hook" || t.type === "end") && !t.off).map((t) => ({ type: t.type, text: t.text, start_s: Math.round((t.startFrame / VIDEO.fps) * 100) / 100, style: t.cardStyle ?? "plain" })),
      gap_order: c.gapOrder ?? null, // "story": every video in story order (story anchors)
      transitions: spec.transitions ?? null, // story variations: the anchors' own ("as-set"), all "dissolve" or all "cut"
      energy: c.options.energy ?? "medium",
      early_cut_frames: 2,
      shot_length: c.options.shotLength ?? null, // "auto", bars per shot, "story" or "rate"
      pace: c.pace ? { feel: c.pace.feel, words_per_s: c.pace.wordsPerS, verse_bars: c.pace.verseBars, hook_bars: c.pace.hookBars, text: c.pace.text } : null, // automatic pacing
      transition_style: c.options.transitions ?? "auto",
      canvas: c.canvasPlan ? { seconds: c.canvasPlan.seconds, possible_s: c.canvasPlan.possibleS, need_clip_s: c.canvasPlan.needClipS, fallback: c.canvasPlan.fallback, chosen: c.canvasPlan.chosen } : null,
      transition_plan: c.transitionPlan ?? null, // the transition into each shot (cut / dissolve / dip) and why
      readability: c.readability ? { mode: c.readability.mode, backing: c.readability.backing, clips_measured: c.readability.measured, clips_bright: c.readability.bright, text: c.readability.text } : null, // the soft backing behind the lyrics and why
      ending: c.loop && c.loop.checked ? (c.loop.ending ?? null) : null, // Reels / TikTok / Shorts: the ending chosen (tight loop, soft fade, ring-out) and why
      tempo: c.options.tempo ? { bpm: c.analysis.bpm, set: c.options.tempo } : null, // song.json "tempo" (null: as detected)
      order: spec.order,
      seed: spec.seed,
      style: props.style,
      text_size: props.textSize,
      colour: props.colour,
      cinematic_bars: props.cinematicBars,
      // The fonts as rendered (the exact files): family, weight, italic; the pairing, when compared.
      fonts: {
        verse: { family: props.style.font, weight: props.style.weight, italic: props.style.italic === true },
        hook: props.hookFont ? { family: props.hookFont.font, weight: props.hookFont.weight, italic: props.hookFont.italic === true } : null,
        pairing: spec.pairing?.id ?? null,
      },
      font: c.options.font ?? null,
      font_hook: c.options.fontHook ?? null,
      hook_font: props.hookFont ?? null,
      line_effect: props.lyricEffects ? choiceText(props.lyricEffects.verse) : null,
      hook_effect: props.lyricEffects ? choiceText(props.lyricEffects.hook) : null,
      show_next_line: props.nextLine ?? false,
      pins: c.options.pins ? { file: path.resolve(c.options.pins), sha256: sha256File(c.options.pins) } : null,
      collection: { name: c.collection.collection.name, folder: c.collection.folder, clips: c.collection.sources.length, usable: c.clips.length },
      collections: c.collectionNames,
      target_length: c.options.length ?? null, // seconds; shapes an auto section only (the Videos tab shows it)
      fps: VIDEO.fps,
      size: `${c.preset.width}x${c.preset.height}`,
      video: `H.264${c.preset.videoBitrate ? ` ${c.preset.videoBitrate}` : ""}, ${props.audio ? `AAC ${(c.audioPlan?.bitrate ?? "320k").replace("k", " kbps")}${c.audioPlan ? ` ${c.audioPlan.sampleRate / 1000} kHz` : ""}` : "no audio"}, yuv420p, faststart`,
      // The music: the song itself, cut to the section; fades only where it is cut; nothing else applied.
      audio: props.audio && c.audioPlan
        ? { fade_in_s: c.audioPlan.fadeInS, fade_out_s: c.audioPlan.fadeOutS, sample_rate: c.audioPlan.sampleRate, resampled: c.audioPlan.resampled, bitrate: c.audioPlan.bitrate, processing: "none (no volume, loudness normalisation, EQ, compression or limiting)" }
        : null,
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
      checked_by_ear: c.reports[i]?.checked_by_ear ?? false,
      early_ms: c.reports[i]?.early_ms ?? null, // the voice begins this long after the stamp
    })),
    fonts: props.fonts.map((f) => {
      const file = resolveMediaPath(f.src, c.media);
      return { family: f.family, weight: f.weight, style: f.style, src: f.src, sha256: file ? sha256File(file) : "" };
    }),
    props,
    output: { file: path.basename(c.file), duration_s: props.durationInFrames / VIDEO.fps, qa: c.qa.status },
    loop: c.loop ?? null,
    anchors: c.anchors ? { used: c.anchors.uses, conflicts: c.anchors.conflicts, notes: c.anchors.notes, missing: c.anchors.missing } : null,
    textboard: c.textboard ?? null,
    picture: c.spec.picture ?? null,
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
    cutFrames: number[] | ((spec: VariationSpec) => number[]); // per video when videos differ (story anchors, cut rates)
    clipHashes: Set<string>;
    settings: Record<string, unknown> | ((spec: VariationSpec) => Record<string, unknown>);
  },
): string | null {
  const spec = specs.find((s) => existsSync(path.join(dir, `${s.name}.manifest.json`)));
  if (!spec) return null; // nothing finished yet: nothing to compare with
  const existing = path.join(dir, `${spec.name}.manifest.json`);
  const cutFrames = typeof now.cutFrames === "function" ? now.cutFrames(spec) : now.cutFrames;
  const settings = typeof now.settings === "function" ? now.settings(spec) : now.settings;
  const m = JSON.parse(readFileSync(existing, "utf8")) as Manifest;
  if (m.section.start_ms !== now.section.start_ms || m.section.end_ms !== now.section.end_ms) {
    return `the section changed (${clockText(m.section.start_ms)}-${clockText(m.section.end_ms)} then, ${clockText(now.section.start_ms)}-${clockText(now.section.end_ms)} now)`;
  }
  if (m.lyrics.lrc_sha256 !== now.lrcHash) return "the lyric timings changed";
  if (m.lyrics.lead_ms !== now.leadMs || m.lyrics.lyrics_offset_ms !== now.lyricsOffsetMs) return "the lyric lead or offset changed";
  if (JSON.stringify(m.cuts.frames) !== JSON.stringify(cutFrames)) return "the cuts changed";
  for (const key of Object.keys(settings)) {
    if (JSON.stringify(m.settings[key] ?? null) !== JSON.stringify(settings[key])) return `the setting ${key} changed`;
  }
  const gone = m.clips.filter((c) => !now.clipHashes.has(c.sha256)).map((c) => c.name);
  if (gone.length) return `clip(s) changed or removed: ${gone.join(", ")}`;
  return null;
}
