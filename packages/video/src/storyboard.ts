// The storyboard (stage 1, read-only): a video's cut plan as rows: the waveform with bars and hook
// sections, the lyric lines at their on-screen times, and the shots as blocks with their length, cut,
// in / out, speed and badges (anchored line, best moment, dissolve), each with its warnings. Built from
// the same composition props a render gets (a dry run of the planner, or a past run's manifest). Pure.
import { VIDEO } from "./config";
import type { AnchorUse } from "./anchors";
import type { LyricVideoProps } from "./props";
import { RECENT_WINDOW } from "./shots";

export const CHOPPY_RATE = 0.75; // slower than this, a 30 fps clip repeats frames visibly
export const BEST_WINDOW_S = 2; // the best moment: the strongest 2 s of a clip

export type StoryClip = { name: string; thumb: string | null; durationMs: number; kind: "video" | "photo"; bestAtS: number | null; bestFrom: "clip editor" | "auto" | null };
export type StoryShot = {
  index: number;
  startMs: number; // in the video
  endMs: number;
  songMs: number; // where its cut is in the song
  clip: string;
  thumb: string | null;
  kind: "video" | "photo";
  inS: number; // where it starts in the clip
  outS: number; // where it ends in the clip (as played: speed applied)
  speed: number;
  hold: boolean; // the clip runs out: its last frame is held
  anchor: { line: number; text: string } | null;
  dissolve: boolean;
  dip: boolean; // a dip to black into this shot (automatic transitions)
  loop: boolean; // the Reels loop ending: the frames just before shot 1, so the video loops seamlessly
  best: boolean; // shows the clip's best moment
  warnings: string[];
};
export type StoryLine = {
  number: number | null;
  text: string;
  isHook: boolean;
  startMs: number;
  endMs: number;
  anchor: string | null;
  card: string | null; // its textboard card ("line-9")
  changed: boolean; // the card changes its look (place, size, hold, effect or font)
  slot: string | null; // an anchor whose clip is not in this clip set: the line needs a clip (the clip it had)
};

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const frameMs = (f: number) => Math.round((f * 1000) / VIDEO.fps);

// Shots with their badges and warnings: choppy slow motion, a clip too short (last frame held), anchor
// conflicts (on the anchored shot), the same clip again within 3 shots.
export function storyShots(
  props: Pick<LyricVideoProps, "shots" | "audio" | "dips" | "loopInto">,
  clips: ReadonlyMap<string, StoryClip>, // by the shot's src
  sectionStartMs: number,
  anchors: { uses: AnchorUse[]; conflicts: string[] } | null,
): StoryShot[] {
  const shots = props.shots;
  const usedAnchors = (anchors?.uses ?? []).filter((u) => u.used && u.shot !== null);
  return shots.map((s, i) => {
    const clip = clips.get(s.src);
    const name = clip?.name ?? s.src.split("/").pop() ?? s.src;
    const playable = s.kind === "photo" ? s.duration : Math.max(0, Math.floor((s.clipDurationFrames - 1 - s.clipStartFrame) / s.playbackRate) + 1);
    const shown = Math.min(s.duration, playable);
    const inS = s.clipStartFrame / VIDEO.fps;
    const outS = s.kind === "photo" ? 0 : (s.clipStartFrame + shown * s.playbackRate) / VIDEO.fps;
    const a = usedAnchors.find((u) => u.shot === i) ?? null;
    // The Reels loop ending: the last shot plays the first clip's frames right before shot 1 (intended).
    const loop = i > 0 && i === shots.length - 1 && ((s.src === shots[0].src && Math.round(s.clipStartFrame + s.duration * s.playbackRate) === shots[0].clipStartFrame) || !!props.loopInto);
    const warnings: string[] = [];
    if (s.kind !== "photo" && s.playbackRate < CHOPPY_RATE) warnings.push(`slowed to ${s.playbackRate.toFixed(2)}x: the motion may look choppy (frames repeat)`);
    if (shown < s.duration) warnings.push(`the clip is too short: its last frame is held for ${s1(frameMs(s.duration - shown))}`);
    for (let back = 1; back <= RECENT_WINDOW && i - back >= 0; back++) {
      if (shots[i - back].src === s.src && !loop) {
        warnings.push(`the same clip as shot ${i - back + 1}, ${s1(frameMs(s.start - shots[i - back].start))} earlier`);
        break;
      }
    }
    if (a) for (const c of anchors!.conflicts) if (new RegExp(`\\bline ${a.line}\\b`).test(c)) warnings.push(c);
    const best = clip?.bestAtS ?? null;
    // The shot shows the best moment when it covers most of its window.
    const overlap = best === null || s.kind === "photo" ? 0 : Math.max(0, Math.min(outS, best + BEST_WINDOW_S) - Math.max(inS, best));
    return {
      index: i,
      startMs: frameMs(s.start),
      endMs: frameMs(s.start + s.duration),
      songMs: sectionStartMs + frameMs(s.start),
      clip: name,
      thumb: clip?.thumb ?? null,
      kind: s.kind === "photo" ? "photo" : "video",
      inS: Math.round(inS * 100) / 100,
      outS: Math.round(outS * 100) / 100,
      speed: s.playbackRate,
      hold: s.holdLastFrame,
      anchor: a ? { line: a.line, text: a.text } : null,
      dissolve: !!s.dissolve,
      dip: (props.dips ?? []).some((d) => d.frame === s.start),
      loop,
      best: overlap >= BEST_WINDOW_S / 2,
      warnings,
    };
  });
}

// The lyric lines at their on-screen times (video time), each with the clip anchored on it.
export function storyLines(
  lyrics: LyricVideoProps["lyrics"],
  numbered: readonly { number: number | null; text: string; isHook: boolean }[], // the same lines, in order, with their numbers when known
  anchors: readonly AnchorUse[],
  slots: readonly { line: number; clip: string }[] = [],
): StoryLine[] {
  return lyrics.map((l, k) => {
    const n = numbered[k];
    const anchor = anchors.find((a) => a.used && n?.number != null && a.line === n.number) ?? null;
    const slot = slots.find((x) => n?.number != null && x.line === n.number) ?? null;
    return {
      number: n?.number ?? null, text: l.text, isHook: !!l.isHook, startMs: frameMs(l.startFrame), endMs: frameMs(l.endFrame), anchor: anchor?.clip ?? null,
      card: l.card?.id ?? null, changed: !!l.card && Object.keys(l.card).some((key) => key !== "id"), slot: slot?.clip ?? null,
    };
  });
}

// The title, byline and tagline cards on the timeline (video time).
export function storyTitleCards(props: Pick<LyricVideoProps, "textCards" | "durationInFrames">): { id: string; type: string; text: string; startMs: number; endMs: number }[] {
  return (props.textCards ?? []).map((c) => ({ id: c.id, type: c.type, text: c.text, startMs: frameMs(c.startFrame), endMs: frameMs(Math.min(c.endFrame, props.durationInFrames)) }));
}

// Hook (chorus) sections: runs of hook lines, from the first one's start to the last one's end.
export function hookSections(lines: readonly StoryLine[]): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (const l of lines) {
    if (!l.isHook) continue;
    const last = out.at(-1);
    if (last && l.startMs - last.endMs < 1500) last.endMs = Math.max(last.endMs, l.endMs);
    else out.push({ startMs: l.startMs, endMs: l.endMs });
  }
  return out;
}

// The waveform of a stretch: the loudest sample per bucket (0-1), from 16 kHz mono samples.
export function peaks(samples: Float32Array, rate: number, fromMs: number, toMs: number, buckets: number): number[] {
  const a = Math.max(0, Math.floor((fromMs / 1000) * rate));
  const b = Math.min(samples.length, Math.floor((toMs / 1000) * rate));
  const size = Math.max(1, Math.floor((b - a) / buckets));
  return Array.from({ length: buckets }, (_, k) => {
    let m = 0;
    for (let i = a + k * size; i < Math.min(b, a + (k + 1) * size); i++) m = Math.max(m, Math.abs(samples[i]));
    return Math.round(Math.min(1, m) * 1000) / 1000;
  });
}
