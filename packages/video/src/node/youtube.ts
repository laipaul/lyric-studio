// YouTube (16:9) parts of "pnpm make": the cover (from --cover, the project, or cover.jpg/.png next
// to the song), the layout with its fallbacks (cover -> stills -> clips), the stills plan, the extra
// composition props (title, logo, end screen, grain, glow), the thumbnail background, the publishing
// pack (publish.txt from WORKSPACE_DIR\brand\publish-template.txt) and .srt captions.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, ffmpegBin, project as projectTable, storedPath, type Project, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import type { Beat } from "../beats";
import { VIDEO } from "../config";
import type { TimedLine } from "../lrc";
import { kenBurns } from "../photo";
import { lyricArea, type Format, type LyricArea, type PlatformPreset, type SafeZone } from "../platform";
import { mulberry32 } from "../prng";
import type { LyricVideoProps, StillProps } from "../props";
import { COVER_DRIFT, COVER_LYRICS_LEFT, COVER_NEXT_LINE_SCALE, COVER_TEXT_SCALE, coverSide, PARALLAX } from "../youtube-layout";
import {
  assignStills,
  coverDrift,
  endScreenLayout,
  logoPlacement,
  lyricSections,
  moodSegments,
  parseStills,
  stillTimings,
  toSrt,
  visibleStills,
  type Corner,
  type LyricSection,
} from "../youtube";
import type { Brand } from "./brand";
import { brandDir } from "./brand";
import type { PreparedForFormat } from "./collection";

export type YouTubeLayout = "cover" | "stills" | "clips";

const COVER_NAMES = ["cover.jpg", "cover.jpeg", "cover.png", "cover.webp"];

// The cover for the cover layout: --cover (stored with the project), else the project's stored
// cover, else cover.jpg/.png next to the song file (stored too). null when there is none.
export function resolveCover(ws: Workspace, project: Project, options: { cover?: string; songFile: string }): { stored: string; from: string } | null {
  const store = (file: string) => {
    const relative = `projects/${project.id}/audio/cover${path.extname(file).toLowerCase()}`;
    mkdirSync(path.dirname(absPath(ws, relative)), { recursive: true });
    if (path.resolve(file) !== path.resolve(absPath(ws, relative))) copyFileSync(file, absPath(ws, relative));
    ws.db.update(projectTable).set({ cover_path: relative }).where(eq(projectTable.id, project.id)).run();
    return relative;
  };
  if (options.cover) {
    if (!existsSync(options.cover)) throw new Error(`Cover not found: ${options.cover}`);
    return { stored: store(options.cover), from: options.cover };
  }
  if (project.cover_path && existsSync(absPath(ws, project.cover_path))) return { stored: project.cover_path, from: "the project's stored cover" };
  const next = COVER_NAMES.map((n) => path.join(path.dirname(options.songFile), n)).find((f) => existsSync(f));
  if (next) return { stored: store(next), from: next };
  return null;
}

// The cover blurred and darkened for the background (made once, cached by content and size).
export async function blurredBackground(ws: Workspace, coverRelative: string, format: Format): Promise<string> {
  const src = absPath(ws, coverRelative);
  const key = createHash("sha256").update(readFileSync(src)).digest("hex").slice(0, 16);
  const relative = `cache/coverblur/${key}-${format.width}x${format.height}.jpg`;
  const out = absPath(ws, relative);
  if (!existsSync(out)) {
    mkdirSync(path.dirname(out), { recursive: true });
    const w = Math.round(format.width / 2);
    const h = Math.round(format.height / 2);
    const filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.22:saturation=1.1,scale=${format.width}:${format.height}`;
    await new Promise<void>((resolve, reject) =>
      execFile(ffmpegBin(), ["-y", "-v", "error", "-i", src, "-frames:v", "1", "-vf", filter, "-q:v", "3", out], { windowsHide: true }, (e, _o, err) =>
        e ? reject(new Error(`ffmpeg could not blur the cover: ${err || e.message}`)) : resolve(),
      ),
    );
  }
  return relative;
}

// The layout actually used: the requested one if possible, else cover -> stills -> clips.
export function chooseLayout(
  requested: YouTubeLayout,
  available: { cover: boolean; photos: number; sources: number },
): { layout: YouTubeLayout | null; message: string | null } {
  const order: YouTubeLayout[] = requested === "cover" ? ["cover", "stills", "clips"] : requested === "stills" ? ["stills", "clips"] : ["clips"];
  const why: Record<YouTubeLayout, string> = {
    cover: "no cover (give --cover <image>, or put cover.jpg / cover.png next to the song)",
    stills: "no horizontal photos in the collection",
    clips: "no horizontal clips or photos in the collection",
  };
  const ok = (l: YouTubeLayout) => (l === "cover" ? available.cover : l === "stills" ? available.photos > 0 : available.sources > 0);
  const skipped: string[] = [];
  for (const l of order) {
    if (ok(l)) return { layout: l, message: skipped.length ? `${skipped.join("; ")}: using the ${l} layout instead` : null };
    skipped.push(`${l} layout: ${why[l]}`);
  }
  return { layout: null, message: skipped.join("; ") };
}

// Where the lyrics go: right of the cover in the cover layout, else the whole safe area.
export function youtubeLyricSafeZone(layout: YouTubeLayout, safe: SafeZone): SafeZone {
  return layout === "cover" ? { ...safe, left: COVER_LYRICS_LEFT } : safe;
}

export function planStills(o: {
  lines: readonly TimedLine[];
  beats: readonly Beat[];
  photos: PreparedForFormat["clips"];
  stillsText: string | null;
  durationMs: number;
  startMs: number;
  durationInFrames: number;
  seed: number;
}): { stills: StillProps[]; warnings: string[]; sections: string[] } {
  const sections = lyricSections(o.lines, o.durationMs);
  const parsed = o.stillsText ? parseStills(o.stillsText) : { rules: new Map<string, string>(), warnings: [] };
  const names = o.photos.map((p) => p.name);
  const assigned = assignStills(sections, names, parsed.rules);
  const timings = stillTimings(sections, o.beats, VIDEO.fps, o.startMs, o.durationInFrames);
  const all = sections.map((s, i) => {
    const photo = o.photos.find((p) => p.name === assigned.files[i])!;
    return { src: photo.path, ...timings[i], motion: kenBurns(mulberry32((o.seed * 7919 + i * 104_729 + 31) >>> 0)), section: s.name };
  });
  const stills = visibleStills(all, o.durationInFrames);
  return { stills, warnings: [...parsed.warnings, ...assigned.warnings], sections: sections.map((s, i) => `${s.name} = ${assigned.files[i]}`) };
}

// Extra props for a YouTube video (the base props come from composeProps).
export function youtubeExtras(o: {
  layout: YouTubeLayout;
  preset: PlatformPreset;
  props: Omit<LyricVideoProps, "mediaBaseUrl">;
  brand: Brand;
  logo: LogoImage | null;
  ws: Workspace;
  title: string;
  artist: string;
  cover: string | null;
  coverBackground: string | null;
  stills: StillProps[] | null;
  beats: readonly Beat[];
  startMs: number;
  grain: boolean;
  glow: boolean;
  sections: readonly LyricSection[];
  seed: number;
}): Partial<LyricVideoProps> {
  const y = o.preset.youtube!;
  const format: Format = { width: o.preset.width, height: o.preset.height };
  const area: LyricArea = o.props.lyricArea!;
  const fps = VIDEO.fps;
  const titleFont = o.brand.titleFont;
  // The end-screen lyric band starts below the title at the top (14% of the height).
  const safe = { ...o.preset.safeZone, top: Math.max(o.preset.safeZone.top, 0.14) };
  const endScreen = y.endScreen.seconds > 0 ? endScreenLayout(format, safe, area, fps, o.props.durationInFrames, y.endScreen) : null;
  const beatFrames = o.beats.map((b) => Math.round(((b.time_ms - o.startMs) * fps) / 1000)).filter((f) => f >= 0 && f < o.props.durationInFrames);
  return {
    layout: o.layout,
    cover:
      o.layout === "cover" && o.cover
        ? {
            src: o.cover,
            zoomFrom: y.coverZoom[0],
            zoomTo: y.coverZoom[1],
            ...(o.coverBackground ? { backgroundSrc: o.coverBackground } : {}),
            drift: coverDrift(mulberry32((o.seed * 7919 + 977) >>> 0), coverSide(format), COVER_DRIFT),
            parallax: PARALLAX,
          }
        : null,
    // Cover layout: active line +18%, next line +10% (compared with Step 5g.2).
    ...(o.layout === "cover" ? { textSize: Math.round(o.props.textSize * COVER_TEXT_SCALE), nextLineScale: COVER_NEXT_LINE_SCALE } : {}),
    mood: moodSegments(o.sections, o.beats, fps, o.startMs),
    stills: o.layout === "stills" ? o.stills ?? [] : undefined,
    shots: o.layout === "clips" ? o.props.shots : [],
    cutFrames: o.layout === "clips" ? o.props.cutFrames : [],
    // Cover layout: title and artist small at the top all the time; other layouts: over the opening
    // seconds only, fading out by titleSeconds.
    titleOverlay: {
      title: o.title,
      artist: o.artist,
      font: titleFont.family,
      weight: titleFont.weight,
      letterSpacing: titleFont.letterSpacing ?? 0.18,
      colour: o.brand.accentColour,
      untilFrame: o.layout === "cover" ? o.props.durationInFrames + 1 : Math.round(y.titleSeconds * fps),
      size: o.layout === "cover" ? 40 : 64,
      position: "top",
      // Cover layout: centred over the lyrics column.
      ...(o.layout === "cover" ? { left: area.left, right: area.right } : {}),
    },
    // Logo in its YouTube corner (inside the safe zone), faded out before the end-screen window.
    logo: o.logo ? { ...placeLogo(o.ws, o.logo, format, o.preset.safeZone, o.brand.logo.youtube, o.brand.logo.size), goneAt: endScreen?.fromFrame ?? null } : null,
    endScreen,
    nextLine: o.preset.showNextLine,
    grain: o.layout === "stills" && o.grain,
    glow: o.layout === "stills" && o.glow ? { colour: o.brand.accentColour, beatFrames } : null,
  };
}

export type LogoImage = { file: string; width: number; height: number }; // the PNG's own size

// The logo's position and size on a frame: `share` of the width wide, in `corner` of the area inside
// the safe zones.
export function placeLogo(ws: Workspace, logo: LogoImage, format: Format, safe: SafeZone, corner: Corner | "auto", share: number) {
  const width = Math.round(share * format.width);
  const height = Math.round((width * logo.height) / logo.width);
  return { src: storedPath(ws, logo.file), width, height, ...logoPlacement(format, safe, corner, { width, height }) };
}

// The thumbnail's picture: the cover; the chorus still; or a frame from the clip on screen when the
// first hook line starts (extracted with FFmpeg into the cache). Workspace-relative.
export async function thumbnailBackground(
  ws: Workspace,
  props: Omit<LyricVideoProps, "mediaBaseUrl">,
  hookFrame: number,
  key: string,
): Promise<string | null> {
  if (props.layout === "cover" && props.cover) return props.cover.src;
  if (props.layout === "stills" && props.stills?.length) {
    return (props.stills.find((s) => s.section.startsWith("chorus")) ?? props.stills[0]).src;
  }
  const shot = props.shots.find((s) => hookFrame >= s.start && hookFrame < s.start + s.duration) ?? props.shots[0];
  if (!shot) return null;
  if (shot.kind === "photo") return shot.src;
  const relative = `cache/thumbsrc/${key}.jpg`;
  const out = absPath(ws, relative);
  mkdirSync(path.dirname(out), { recursive: true });
  const at = (shot.clipStartFrame + Math.min(shot.duration - 1, Math.max(0, hookFrame - shot.start)) * shot.playbackRate) / VIDEO.fps;
  await new Promise<void>((resolve, reject) =>
    execFile(ffmpegBin(), ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", absPath(ws, shot.src), "-frames:v", "1", "-q:v", "2", out], { windowsHide: true }, (e, _o, err) =>
      e ? reject(new Error(`ffmpeg could not take the thumbnail frame: ${err || e.message}`)) : resolve(),
    ),
  );
  return relative;
}

export const DEFAULT_PUBLISH_TEMPLATE = `== Title ==
{{song}} (Lyrics) - {{artist}}

== Description ==
{{song}} by {{artist}} - the official lyric video.
{{epLine}}

{{lyrics}}

Credits
Music and lyrics: {{artist}}
Lyric video: {{artist}}

Listen on Spotify: https://open.spotify.com/ (add the link to the song)

#{{artistTag}} #{{songTag}} #lyrics #lyricvideo

== Tags ==
{{song}}, {{song}} lyrics, {{artist}}, {{artist}} lyrics, lyrics, lyric video
`;

// WORKSPACE_DIR\brand\publish-template.txt (created the first time) filled in for one song.
// Placeholders: {{song}} {{artist}} {{lyrics}} {{songTag}} {{artistTag}} {{year}} {{ep}} {{epLine}}.
// {{epLine}} is 'From the EP "<name>"' with --ep, otherwise its line is left out. A template from
// before --ep existed gets that line right after the first line of the description.
export function publishText(
  workspaceDir: string,
  values: { song: string; artist: string; lyricsTxt: string; year: number; ep?: string },
): { text: string; template: string; created: boolean } {
  const template = path.join(brandDir(workspaceDir), "publish-template.txt");
  let created = false;
  if (!existsSync(template)) {
    mkdirSync(path.dirname(template), { recursive: true });
    writeFileSync(template, DEFAULT_PUBLISH_TEMPLATE);
    created = true;
  }
  const lyrics = values.lyricsTxt
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^\*\s+/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const tag = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "");
  const map: Record<string, string> = {
    song: values.song,
    artist: values.artist,
    lyrics,
    songTag: tag(values.song),
    artistTag: tag(values.artist),
    year: String(values.year),
    ep: values.ep ?? "",
    epLine: values.ep ? `From the EP "${values.ep}"` : "",
  };
  let content = readFileSync(template, "utf8").replace(/\r\n/g, "\n");
  if (!content.includes("{{epLine}}") && values.ep) {
    const m = /== Description ==\n+[^\n]*\n/.exec(content);
    if (m) content = `${content.slice(0, m.index + m[0].length)}{{epLine}}\n${content.slice(m.index + m[0].length)}`;
  }
  // Without --ep the {{epLine}} line disappears completely (no empty line left behind).
  if (!values.ep) content = content.replace(/^[ \t]*\{\{epLine\}\}[ \t]*\n/gm, "");
  const text = content.replace(/\{\{(\w+)\}\}/g, (m, k: string) => map[k] ?? m);
  return { text, template, created };
}

// .srt captions next to a video: the lines exactly as the video shows them.
export function writeSrt(file: string, props: Pick<LyricVideoProps, "lyrics">): void {
  writeFileSync(file, toSrt(props.lyrics, VIDEO.fps));
}

export function lyricAreaFor(layout: YouTubeLayout, preset: PlatformPreset): LyricArea {
  return lyricArea(preset, youtubeLyricSafeZone(layout, preset.safeZone), preset.lyricsAt);
}
