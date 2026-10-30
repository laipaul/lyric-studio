// "Breathe": an add-on to any lyric effect (recipe "breathe"): while a line is on screen it swells very
// slowly and settles, "gentle" every 4 s, "beat" once a bar, at its largest on each downbeat; a little
// deeper on hooks. At most +4%, so a line never blurs or jumps (QA's safe-zone box counts it).
export type BreatheMode = "off" | "gentle" | "beat";
export const BREATHE_MODES: readonly BreatheMode[] = ["off", "gentle", "beat"];
export type BreatheProps = { mode: Exclude<BreatheMode, "off">; downbeats?: number[] }; // downbeats: frames of the video
export const BREATHE_DEPTH = { verse: 0.02, hook: 0.035 };
export const BREATHE_MAX_SCALE = 1 + BREATHE_DEPTH.hook;
export const GENTLE_PERIOD_S = 4;

// The extra scale at a frame (1 = none). Smooth everywhere: (1 + cos) / 2 between downbeats.
export function breatheScale(b: BreatheProps | null | undefined, frame: number, fps: number, hook: boolean): number {
  if (!b) return 1;
  const depth = hook ? BREATHE_DEPTH.hook : BREATHE_DEPTH.verse;
  let phase: number;
  const beats = b.mode === "beat" ? (b.downbeats ?? []) : [];
  if (beats.length >= 2) {
    let k = 0;
    while (k + 1 < beats.length && beats[k + 1] <= frame) k++;
    const from = beats[k];
    const to = beats[k + 1] ?? beats[k] + (beats[k] - beats[Math.max(0, k - 1)] || fps * 2);
    phase = frame < from ? (frame - from) / Math.max(1, beats[1] - beats[0]) : (frame - from) / Math.max(1, to - from);
  } else phase = frame / (GENTLE_PERIOD_S * fps);
  return 1 + depth * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
}
