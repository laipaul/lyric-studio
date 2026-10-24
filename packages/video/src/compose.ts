// Turns a prepared render "base" (cuts, clips, lyrics, audio, fonts, pins) plus the choices that
// change often (seed, order, style, lyric timing) into LyricVideo props. Pure: the /preview page runs
// it in the browser and "pnpm render:test" runs it in Node, so the same choices give identical props.
import { VIDEO } from "./config";
import type { CutPlan } from "./cuts";
import type { FontFileRef } from "./font-files";
import { pinsToShots, type ResolvedPin } from "./pins";
import type { LyricLineProps, LyricVideoProps, StyleProps } from "./props";
import { assignClips, type ClipOrder } from "./shots";

export type StyleChoice = "simple" | "bold";

export type PreparedClip = { id: string; name: string; duration_ms: number; path: string; durationFrames: number };
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

  const byId = new Map(base.clips.map((c) => [c.id, c]));
  const shots = assignClips(
    plan,
    base.clips.map((c) => ({ id: c.id, name: c.name, duration_ms: c.duration_ms })),
    choices.seed,
    { order: choices.order ?? "story", pins: byShot },
  ).map((s) => {
    const clip = byId.get(s.clip_id)!;
    return {
      start: s.start_frame - plan.start_frame,
      duration: s.duration_frames,
      src: clip.path,
      clipStartFrame: s.clip_start_frame,
      clipDurationFrames: clip.durationFrames,
      playbackRate: s.playback_rate,
      holdLastFrame: s.hold_last_frame,
    };
  });

  const entry = base.styles[choices.style];
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
      textSize: choices.textSize ?? entry.textSize,
      colour: choices.colour ?? base.colour,
      cinematicBars: choices.cinematicBars ?? base.cinematicBars,
    },
    warnings,
  };
}
