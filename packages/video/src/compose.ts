// Turns a prepared render "base" (cuts, clips, lyrics, audio) plus the choices that change often
// (seed, style) into LyricVideo props. Pure: the /preview page runs it in the browser and
// "pnpm render:test" runs it in Node, so the same seed + style always give identical props.
import type { CutPlan } from "./cuts";
import type { LyricLineProps, LyricVideoProps, StyleProps } from "./props";
import { assignClips } from "./shots";

export type StyleChoice = "simple" | "bold";

export type PreparedClip = { id: string; duration_ms: number; path: string; durationFrames: number };

export type RenderBase = {
  plan: CutPlan;
  clips: PreparedClip[];
  audio: LyricVideoProps["audio"];
  durationInFrames: number;
  lyrics: LyricLineProps[];
  styles: Record<StyleChoice, { style: StyleProps; textSize: number }>;
  colour: string;
  cinematicBars: boolean;
};

export type ComposeChoices = { seed: number; style: StyleChoice; textSize?: number; colour?: string; cinematicBars?: boolean };

export function composeProps(base: RenderBase, choices: ComposeChoices): Omit<LyricVideoProps, "mediaBaseUrl"> {
  const { plan } = base;
  const byId = new Map(base.clips.map((c) => [c.id, c]));
  const shots = assignClips(
    plan,
    base.clips.map((c) => ({ id: c.id, duration_ms: c.duration_ms })),
    choices.seed,
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
  const style = base.styles[choices.style];
  return {
    audio: base.audio,
    durationInFrames: base.durationInFrames,
    cutFrames: plan.cuts.map((c) => c.frame - plan.start_frame),
    shots,
    lyrics: base.lyrics,
    style: style.style,
    textSize: choices.textSize ?? style.textSize,
    colour: choices.colour ?? base.colour,
    cinematicBars: choices.cinematicBars ?? base.cinematicBars,
  };
}
