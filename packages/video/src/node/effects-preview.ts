// "pnpm effects:preview <project> [--effect name[:intensity]]": renders a short sample of the lyric
// effects on real lines of the song (2-3 lines around the first hook, with their word timings), with
// the clips, fonts and look of the project's latest "pnpm make" run.
//   Without --effect: all effects side by side in one labelled 1920x1080 video.
//   With --effect:    that effect full-size, 9:16 and 16:9.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, openWorkspace, project as projectTable, resolveWorkspaceDir, type Workspace } from "@lyric/db";

import { lyricFrames, rawLyric, type RawLyric, type RenderBase } from "../compose";
import { VIDEO } from "../config";
import { EFFECTS, parseEffectChoice, type EffectChoice } from "../effects";
import { EFFECT_HINTS } from "../effects/names";
import type { EffectsPreviewProps } from "../EffectsPreview";
import { EFFECTS_PREVIEW_ID } from "../EffectsPreview";
import { normalizeLyric, parseLrc, type TimedLine } from "../lrc";
import { lyricArea } from "../platform";
import type { LyricVideoProps, ShotProps } from "../props";
import { loadBrand } from "./brand";
import { cachedFileHash } from "./collection";
import { songPathsById } from "./song-folder";
import { loadFontCatalog } from "./font-catalog";
import { readManifest, type Manifest } from "./manifest";
import type { MediaRoots } from "./media";
import { loadPresets } from "./make";
import { renderLyricVideo, type RenderOptions } from "./render";
import { hookKeys } from "./song-project";

type Props = Omit<LyricVideoProps, "mediaBaseUrl">;

// A project by id, by title (ignoring case) or by its song file.
export async function findProject(ws: Workspace, ref: string) {
  const all = ws.db.select().from(projectTable).all();
  const byId = all.find((p) => p.id === ref);
  if (byId) return byId;
  const byTitle = all.filter((p) => p.title.toLowerCase() === ref.trim().toLowerCase());
  if (byTitle.length === 1) return byTitle[0];
  if (existsSync(ref) && statSync(ref).isFile()) {
    const hash = await cachedFileHash(ws, ref);
    const bySong = all.find((p) => p.audio_hash === hash);
    if (bySong) return bySong;
  }
  const known = all.map((p) => `"${p.title}"`).join(", ") || "none yet (run pnpm make first)";
  throw new Error(`No project "${ref}"${byTitle.length > 1 ? " (several have this title: use the id)" : ""}. Projects: ${known}`);
}

// The newest 9:16 and 16:9 manifests (with lyrics) of the project's "pnpm make" runs.
export function latestManifests(ws: Workspace, projectId: string): { vertical: { file: string; m: Manifest } | null; wide: { file: string; m: Manifest } | null } {
  const base = songPathsById(ws, projectId).exports;
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (!existsSync(dir) || depth > 2) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) walk(path.join(dir, d.name), depth + 1);
      else if (d.name.endsWith(".manifest.json")) files.push(path.join(dir, d.name));
    }
  };
  walk(base, 0);
  const manifests = files
    .map((file) => ({ file, m: readManifest(file) }))
    .filter((x) => x.m.props.lyrics.length > 0)
    .sort((a, b) => b.m.created_at.localeCompare(a.m.created_at));
  const size = (m: Manifest) => m.props.format ?? { width: 1080, height: 1920 };
  return {
    vertical: manifests.find((x) => size(x.m).height > size(x.m).width) ?? null,
    wide: manifests.find((x) => size(x.m).width > size(x.m).height) ?? null,
  };
}

// 2-3 consecutive lines around the first hook (the line before it, the hook, the next one), at most
// `maxSeconds` long, starting 1.5 s before the first of them.
export function previewExcerpt(lines: readonly TimedLine[], maxSeconds = 12): { startMs: number; endMs: number; first: number; last: number } {
  if (!lines.length) throw new Error("The project has no timed lyric lines.");
  const hook = lines.findIndex((l) => l.isHook);
  const first = Math.max(0, (hook >= 0 ? hook : Math.min(1, lines.length - 1)) - 1);
  const startMs = Math.max(0, lines[first].start_ms - 1500);
  let last = first;
  while (last + 1 < lines.length && last - first < 2 && lines[last + 1].start_ms - startMs < (maxSeconds - 1.5) * 1000) last++;
  const end = (l: TimedLine) => l.sung_end_ms ?? l.words?.at(-1)?.start_ms ?? l.end_ms;
  const endMs = Math.min(startMs + maxSeconds * 1000, Math.max(end(lines[last]) + 1800, startMs + 5000));
  return { startMs, endMs, first, last };
}

// The excerpt's props from a manifest: same fonts, style, sizes, safe zones and clips (re-timed from
// the excerpt's start), the song from the excerpt, the lines with their word timings, `choice` as
// the effect for every line.
export function previewProps(m: Manifest, lines: readonly TimedLine[], ex: ReturnType<typeof previewExcerpt>, choice: EffectChoice | null, accent: string): Props {
  const fps = VIDEO.fps;
  const startFrame = Math.round((ex.startMs * fps) / 1000);
  const duration = Math.round(((ex.endMs - ex.startMs) * fps) / 1000);
  const raw: RawLyric[] = lines.map(rawLyric);
  const base = { plan: { start_frame: startFrame }, lyrics: raw, durationInFrames: duration } as unknown as RenderBase;
  const lyrics = lyricFrames(base, m.lyrics.lead_ms, m.lyrics.lyrics_offset_ms, true)
    .filter((_, i) => i >= ex.first && i <= ex.last)
    .map((l) => ({ ...l, startFrame: Math.max(0, l.startFrame), endFrame: Math.min(duration, l.endFrame) }))
    .filter((l) => l.endFrame > l.startFrame);
  // The run's shots, one after the other from frame 0, until the excerpt is filled.
  const shots: ShotProps[] = [];
  const source = m.props.shots;
  for (let t = 0, k = 0; source.length && t < duration; k++) {
    const s = source[k % source.length];
    const d = Math.min(s.duration, duration - t);
    shots.push({ ...s, start: t, duration: d, loopBlend: undefined });
    t += d;
  }
  const effects = choice ? { verse: choice, hook: choice, accent } : (m.props.lyricEffects ?? { verse: { name: "glide", intensity: "balanced" as const }, hook: { name: "karaoke-highlight", intensity: "balanced" as const }, accent });
  return {
    ...m.props,
    durationInFrames: duration,
    audio: m.props.audio ? { ...m.props.audio, startFrame, fadeInFrames: 9, fadeOutFrames: 15 } : null,
    shots: m.props.layout === "cover" || m.props.layout === "stills" ? [] : shots,
    cutFrames: shots.slice(1).map((s) => s.start),
    lyrics,
    lyricEffects: effects,
    nextLine: m.props.nextLine ?? true,
    // Things tied to the full video's timeline are left out of the sample.
    endScreen: null,
    mood: [],
    stills: undefined,
    glow: null,
    logo: null,
    titleOverlay: null,
    layout: m.props.layout === "stills" ? "clips" : m.props.layout,
  };
}

// 16:9 props from a 9:16 run when there is no YouTube run yet: the same clips (cover-cropped), the
// lyrics in YouTube's safe area.
function wideFromVertical(p: Props): Props {
  const yt = loadPresets().youtube;
  const format = { width: 1920, height: 1080 };
  const safe = yt?.safeZone ?? { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 };
  return { ...p, format, safeZone: safe, lyricArea: lyricArea(format, safe, yt?.lyricsAt ?? 0.5), layout: "clips", textSize: Math.round(p.textSize * (yt?.textScale ?? 1)) };
}

export type EffectsPreviewResult = { files: string[]; folder: string; lines: string[]; from: string; notes: string[] };

export async function effectsPreview(options: {
  project: string;
  effect?: string;
  maxSeconds?: number;
  workspaceDir?: string;
  now?: Date;
  log?: (m: string) => void;
  renderer?: (o: RenderOptions) => Promise<string>; // tests: a stand-in
}): Promise<EffectsPreviewResult> {
  const log = options.log ?? (() => {});
  const single = options.effect ? parseEffectChoice(options.effect, "--effect") : null;
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  try {
    const project = await findProject(ws, options.project);
    const { vertical, wide } = latestManifests(ws, project.id);
    if (!vertical) throw new Error(`"${project.title}" has no 9:16 video with lyrics yet: run pnpm make for it first (the preview uses its clips, fonts and lyric timing).`);
    const m = vertical.m;
    const lrcFile = absPath(ws, m.lyrics.lrc);
    if (!existsSync(lrcFile)) throw new Error(`The run's lyric timing is missing: ${lrcFile}`);
    const hooks = new Set(m.lyric_timings.filter((t) => t.is_hook).map((t) => normalizeLyric(t.text)));
    const txt = absPath(ws, m.lyrics.txt);
    if (existsSync(txt)) for (const k of hookKeys(readFileSync(txt, "utf8"))) hooks.add(k);
    const lines = parseLrc(readFileSync(lrcFile, "utf8"), m.song.duration_ms).map((l) => ({ ...l, isHook: hooks.has(normalizeLyric(l.text)) }));
    const ex = previewExcerpt(lines, options.maxSeconds ?? 12);
    const notes: string[] = [];
    if (!lines.slice(ex.first, ex.last + 1).some((l) => l.words?.length)) notes.push("these lines have no word timings (align with pnpm make / pnpm align): word effects are spread over each line");
    const catalog = loadFontCatalog(ws.dir);
    const brand = loadBrand(ws.dir, catalog, project.artist).brand; // the effects you chose (marked in the grid) and the accent colour
    const accent = brand.accentColour;

    const now = options.now ?? new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const folder = path.join(songPathsById(ws, project.id).exports, `effects-${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`);
    mkdirSync(folder, { recursive: true });
    const media: MediaRoots = { workspaceDir: ws.dir, extraFiles: {}, fontDirs: catalog.fontDirs };
    const render = options.renderer ?? renderLyricVideo;
    const files: string[] = [];

    if (single) {
      const tall = previewProps(m, lines, ex, single, accent);
      const broad = wide ? previewProps(wide.m, lines, ex, single, accent) : wideFromVertical(tall);
      if (!wide) notes.push("no YouTube run yet: the 16:9 sample uses the 9:16 clips (run pnpm make --platforms youtube for the cover layout)");
      for (const [props, name] of [[tall, "9x16"], [broad, "16x9"]] as const) {
        const out = path.join(folder, `${single.name}${single.intensity !== "balanced" ? `-${single.intensity}` : ""}-${name}.mp4`);
        log(`rendering ${path.basename(out)}`);
        files.push(await render({ props, media, outFile: out, log }));
      }
    } else {
      const brandFx = { verse: brand.motion.verseEffect, hook: brand.motion.hookEffect };
      const preview: Omit<EffectsPreviewProps, "mediaBaseUrl"> = {
        format: { width: 1920, height: 1080 },
        columns: 4,
        durationInFrames: Math.round(((ex.endMs - ex.startMs) * VIDEO.fps) / 1000),
        audio: m.props.audio ? { ...m.props.audio, startFrame: Math.round((ex.startMs * VIDEO.fps) / 1000), fadeInFrames: 9, fadeOutFrames: 15 } : null,
        labelFont: "Inter",
        panels: EFFECTS.map((e) => {
          const choice: EffectChoice = { name: e.name, intensity: "balanced" };
          const used = [brandFx.verse.name === e.name ? "your verses" : null, brandFx.hook.name === e.name ? "your hooks" : null].filter(Boolean).join(", ");
          const { audio: _audio, ...props } = previewProps(m, lines, ex, choice, accent);
          return { label: e.label, note: `${EFFECT_HINTS[e.name as keyof typeof EFFECT_HINTS] ?? ""}${used ? ` · ${used}` : ""}`, props };
        }),
      };
      const out = path.join(folder, "effects-preview.mp4");
      log(`rendering ${path.basename(out)} (${EFFECTS.length} effects side by side)`);
      files.push(await render({ props: preview as unknown as Props, compositionId: EFFECTS_PREVIEW_ID, media, outFile: out, log }));
    }
    return {
      files,
      folder,
      lines: lines.slice(ex.first, ex.last + 1).map((l) => `${l.isHook ? "* " : ""}${l.text}`),
      from: vertical.file,
      notes,
    };
  } finally {
    ws.close();
  }
}

