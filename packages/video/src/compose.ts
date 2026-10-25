// Turns a prepared render "base" (cuts, clips, lyrics, audio, fonts, pins) plus the choices that
// change often (seed, order, style, lyric timing) into LyricVideo props. Pure: the /preview page runs
// it in the browser and "pnpm render:test" runs it in Node, so the same choices give identical props.
import { VIDEO } from "./config";
import type { CutPlan } from "./cuts";
import type { FontFileRef } from "./font-files";
import { kenBurns } from "./photo";
import { pinsToShots, type ResolvedPin } from "./pins";
import { DEFAULT_FORMAT, DEFAULT_SAFE_ZONE, lyricArea, type Format, type SafeZone } from "./platform";
import { mulberry32 } from "./prng";
import type { LyricLineProps, LyricVideoProps, StyleProps } from "./props";
import { assignClips, type ClipOrder } from "./shots";

export type StyleChoice = "simple" | "bold";

export type PreparedClip = {
  id: string;
  name: string;
  duration_ms: number;
  path: string;
  durationFrames: number;
  kind?: "video" | "photo";
  fit?: "cover" | "fill"; // fill: shown whole over a blurred copy (a source that does not suit the format)
};

// Size and safe zones of the platform (default: 1080x1920 "standard").
export type PlatformLayout = {
  format: Format;
  safeZone: SafeZone;
  lyricsAt: number;
  textScale: number;
  loopEnding?: boolean;
  lyricSafeZone?: SafeZone; // where the lyrics may go, if narrower than the safe zone (YouTube cover layout)
};
export type RawLyric = { text: string; start_ms: number; end_ms: number; isHook: boolean };
export type StyleEntry = {
  style: StyleProps;
  textSize: number;
  hookFont: { font: string; weight: number } | null;
  fonts: FontFileRef[];
};

export type RenderBase = {
  plan: CutPlan;
  clips: PreparedClip[];
  audio: LyricVideoProps["audio"];
  durationInFrames: number;
  lyrics: RawLyric[]; // as tapped (song time)
  styles: Record<StyleChoice, StyleEntry>;
  colour: string;
  cinematicBars: boolean;
  pins: ResolvedPin[];
  platform?: PlatformLayout;
};

// Lines appear this much before their stamp (pro lyric-video convention).
export const DEFAULT_LEAD_MS = 250;

export type ComposeChoices = {
  seed: number;
  style: StyleChoice;
  order?: ClipOrder; // default "story"
  leadMs?: number; // default DEFAULT_LEAD_MS
  lyricsOffsetMs?: number; // default 0; positive = later
  textSize?: number;
  colour?: string;
  cinematicBars?: boolean;
};

// Every lyric line with its on-screen frames relative to the section start (not clipped).
export function lyricFrames(base: RenderBase, leadMs = DEFAULT_LEAD_MS, offsetMs = 0): LyricLineProps[] {
  const toFrame = (ms: number) => Math.round(((ms - leadMs + offsetMs) * VIDEO.fps) / 1000) - base.plan.start_frame;
  return base.lyrics.map((l) => ({ text: l.text, startFrame: toFrame(l.start_ms), endFrame: toFrame(l.end_ms), isHook: l.isHook }));
}

export function composeProps(
  base: RenderBase,
  choices: ComposeChoices,
): { props: Omit<LyricVideoProps, "mediaBaseUrl">; warnings: string[] } {
  const { plan } = base;
  const allLines = lyricFrames(base, choices.leadMs ?? DEFAULT_LEAD_MS, choices.lyricsOffsetMs ?? 0);
  const lyrics = allLines
    .map((l) => ({ ...l, startFrame: Math.max(0, l.startFrame), endFrame: Math.min(base.durationInFrames, l.endFrame) }))
    .filter((l) => l.endFrame > l.startFrame);

  const bounds = [0, ...plan.cuts.map((c) => c.frame - plan.start_frame), base.durationInFrames];
  const { byShot, warnings } = pinsToShots(base.pins, allLines, bounds);

  const platform = base.platform ?? { format: DEFAULT_FORMAT, safeZone: DEFAULT_SAFE_ZONE, lyricsAt: 0.45, textScale: 1 };
  const byId = new Map(base.clips.map((c) => [c.id, c]));
  // No clips (YouTube cover / stills layouts): no shots; the background comes from other props.
  const assigned = !base.clips.length ? [] : assignClips(
    plan,
    base.clips.map((c) => ({ id: c.id, name: c.name, duration_ms: c.duration_ms, still: c.kind === "photo" })),
    choices.seed,
    { order: choices.order ?? "story", pins: byShot, loopEnding: platform.loopEnding },
  );
  // Photo moves are seeded per shot, so they do not depend on the other clips.
  const motionFor = (index: number) => kenBurns(mulberry32((choices.seed * 7919 + index * 104_729 + 17) >>> 0));
  const shots = assigned.map((s, index) => {
    const clip = byId.get(s.clip_id)!;
    const photo = clip.kind === "photo";
    let motion = photo ? motionFor(index) : undefined;
    if (photo && s.loop) {
      // The last photo shot ends exactly where the first one's move starts (seamless loop).
      const first = motionFor(0);
      motion = { ...motion!, toZoom: first.fromZoom, toX: first.fromX, toY: first.fromY };
    }
    return {
      start: s.start_frame - plan.start_frame,
      duration: s.duration_frames,
      src: clip.path,
      clipStartFrame: s.clip_start_frame,
      clipDurationFrames: photo ? s.duration_frames : clip.durationFrames,
      playbackRate: s.playback_rate,
      holdLastFrame: s.hold_last_frame,
      ...(photo ? { kind: "photo" as const, motion } : {}),
      ...(clip.fit === "fill" ? { fit: "fill" as const } : {}),
    };
  });

  const entry = base.styles[choices.style];
  const bars = choices.cinematicBars ?? base.cinematicBars;
  return {
    props: {
      audio: base.audio,
      durationInFrames: base.durationInFrames,
      cutFrames: plan.cuts.map((c) => c.frame - plan.start_frame),
      shots,
      lyrics,
      style: entry.style,
      hookFont: entry.hookFont,
      fonts: entry.fonts,
      textSize: Math.round((choices.textSize ?? entry.textSize) * platform.textScale),
      colour: choices.colour ?? base.colour,
      cinematicBars: bars,
      format: platform.format,
      safeZone: platform.safeZone,
      lyricArea: lyricArea(platform.format, platform.lyricSafeZone ?? platform.safeZone, platform.lyricsAt, bars),
    },
    warnings,
  };
}
