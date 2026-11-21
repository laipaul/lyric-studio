// Turns a prepared render "base" (cuts, clips, lyrics, audio, fonts, pins) plus the choices that
// change often (seed, order, style, lyric timing) into LyricVideo props. Pure: the /preview page runs
// it in the browser and "pnpm render:test" runs it in Node, so the same choices give identical props.
import { dissolveFrames, planAnchors, type AnchorUse, type ResolvedAnchor } from "./anchors";
import type { Beat } from "./beats";
import { VIDEO } from "./config";
import type { CutPlan } from "./cuts";
import type { FontFileRef } from "./font-files";
import { kenBurns } from "./photo";
import { pinsToShots, type ResolvedPin } from "./pins";
import { DEFAULT_FORMAT, DEFAULT_SAFE_ZONE, lyricArea, type Format, type SafeZone } from "./platform";
import { areaForLayout, type TextLayout } from "./text-layout";
import { mulberry32 } from "./prng";
import type { LyricEffectsProps, LyricLineProps, LyricVideoProps, StyleProps } from "./props";
import type { PictureProps } from "./picture";
import { assignClips, BEST_WINDOW_MS, type ClipOrder } from "./shots";
import { applyCutMoves, slipFor, type TimelineEdits } from "./timeline-edits";
import { withCard, type CardStyle } from "./textboard";
import { planTransitions, type TransitionKind, type TransitionStyle } from "./transitions";
import type { Feel } from "./pace";

export type StyleChoice = "simple" | "bold";

export type PreparedClip = {
  id: string;
  name: string;
  duration_ms: number;
  path: string;
  durationFrames: number;
  kind?: "video" | "photo";
  fit?: "cover" | "fill"; // fill: shown whole over a blurred copy (a source that does not suit the format)
  // The clip editor (clips.json) and the analysis: story rank, usable part, speed, best moment (ms).
  rank?: number;
  in_ms?: number;
  out_ms?: number;
  speed?: number;
  best_ms?: number;
  best_from?: "clip editor" | "auto";
};

// Size and safe zones of the platform (default: 1080x1920 "standard").
export type PlatformLayout = {
  format: Format;
  safeZone: SafeZone;
  lyricsAt: number;
  textScale: number;
  loopEnding?: boolean;
  lyricSafeZone?: SafeZone; // where the lyrics may go, if narrower than the safe zone (YouTube cover layout)
  textLayout?: TextLayout; // the theme's text layout (src/text-layout.ts); not with lyricSafeZone (YouTube's own placement)
};
export type RawLyric = {
  text: string;
  start_ms: number;
  end_ms: number;
  isHook: boolean;
  words?: { text: string; start_ms: number; end_ms: number }[]; // aligned word times (song time)
  sung_end_ms?: number; // the last word ends here
};
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
  // Story anchors (song.json): `lyric` indexes `lyrics`; placed on `beats` (downbeat offset applied).
  anchors?: ResolvedAnchor[];
  beats?: Beat[];
  // The Shape timeline's roll and slip edits (clips.json "cuts" / "slips", song time; src/timeline-edits.ts).
  timeline?: TimelineEdits;
  // The textboard (src/textboard.ts): each lyric line's card (same order as `lyrics`), with the look it
  // sets (position, size, hold, effect) and its font resolved to a file the props load.
  cards?: ({ id: string; style: CardStyle; font?: { family: string; weight: number; italic?: boolean } } | null)[];
  // Automatic transitions (src/transitions.ts): the style, the song's feel, the hooks and sung stretches
  // (song time) and each clip's own choice (clips.json "transition", by clip id). Without it: hard cuts.
  // Loop platforms: blend the last frames into the first shot's opening (frames) when the last shot does
  // not continue into the first one.
  loopInto?: number;
  lyricBacking?: boolean; // readability "strong": a soft dark band behind the lyrics
  picture?: PictureProps; // the theme's grade, vignette, behind the words, background without a clip
  transitions?: {
    style: TransitionStyle;
    feel: Feel;
    hooks: { start_ms: number; end_ms: number }[];
    sung: { start_ms: number; end_ms: number }[];
    byClip?: Record<string, "cut" | "dissolve">;
  };
};

// What the anchors did in one video (QA "Story anchors", the manifest, the Videos tab).
export type AnchorReport = { uses: AnchorUse[]; conflicts: string[]; notes: string[] };
// Variations of a story: the anchors' own transitions, or all cut / all dissolve.
export type AnchorTransitions = "as-set" | "cut" | "dissolve";

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
  // Lyric effects (Step 5j). With them, lines also carry their word times, and a line followed by a
  // pause leaves the screen 1 s after its last word (instead of staying until the next line).
  effects?: LyricEffectsProps;
  plan?: CutPlan; // this variation's own cut plan (another cut rate); default base.plan
  transitions?: AnchorTransitions; // default "as-set"
  moment?: number; // "Make another": this take plays other parts of the clips (see AssignOptions.moment)
};

// Before a pause the last line fades out this long after its last word ends (then 0.4 s fade).
export const GAP_CLEAR_MS = 1000;
export const GAP_FADE_MS = 400;
const NEXT_ENTER_MS = 900; // room for the next line to come in after the screen is clear

// Every lyric line with its on-screen frames relative to the section start (not clipped). With `gap`
// (brand motion.gapHideS / gapLeadInS): during an instrumental gap longer than hideMs (from the last
// sung word, or the section start, to the next first word) nothing is on screen, not even the waiting
// next line; the line after it fades in leadInMs before its first sung word.
export function lyricFrames(base: RenderBase, leadMs = DEFAULT_LEAD_MS, offsetMs = 0, withEffects = false, gap?: LyricEffectsProps["gap"]): LyricLineProps[] {
  const toFrame = (ms: number) => Math.round(((ms - leadMs + offsetMs) * VIDEO.fps) / 1000) - base.plan.start_frame;
  if (!withEffects) return base.lyrics.map((l) => ({ text: l.text, startFrame: toFrame(l.start_ms), endFrame: toFrame(l.end_ms), isHook: l.isHook }));
  const sung = (ms: number) => toFrame(ms + leadMs); // when it is heard (no lead)
  const sungEndOf = (l: RawLyric) => l.sung_end_ms ?? l.words?.at(-1)?.end_ms;
  const firstWord = (l: RawLyric) => l.words?.[0]?.start_ms ?? l.start_ms;
  const sectionStartMs = (base.plan.start_frame * 1000) / VIDEO.fps - offsetMs;
  // A long instrumental gap before line k (only with sung end times).
  const longGapBefore = (k: number) => {
    if (!gap) return false;
    const prevEnd = k > 0 ? sungEndOf(base.lyrics[k - 1]) : sectionStartMs;
    if (prevEnd === undefined) return false;
    return firstWord(base.lyrics[k]) - Math.max(prevEnd, sectionStartMs) > gap.hideMs;
  };
  return base.lyrics.map((l, k) => {
    const sungEnd = sungEndOf(l);
    // A pause follows: clear the screen 1 s after the last word (if the next line is far enough away).
    const clearMs = sungEnd !== undefined ? sungEnd + GAP_CLEAR_MS + GAP_FADE_MS + leadMs : null;
    let endMs = clearMs !== null && clearMs + NEXT_ENTER_MS <= l.end_ms ? clearMs : l.end_ms;
    const next = base.lyrics[k + 1];
    if (gap && clearMs !== null && next && longGapBefore(k + 1)) {
      // A long gap follows: always cleared, and gone before the next line starts to fade in.
      endMs = Math.min(clearMs, firstWord(next) - gap.leadInMs + leadMs, l.end_ms);
    }
    const enter = gap && longGapBefore(k) ? sung(firstWord(l) - gap.leadInMs) : undefined;
    return {
      text: l.text,
      startFrame: toFrame(l.start_ms),
      endFrame: toFrame(endMs),
      isHook: l.isHook,
      stampFrame: sung(l.start_ms),
      ...(sungEnd !== undefined ? { sungEndFrame: sung(sungEnd) } : {}),
      ...(l.words?.length ? { words: l.words.map((w) => ({ text: w.text, startFrame: sung(w.start_ms), endFrame: sung(w.end_ms) })) } : {}),
      ...(enter !== undefined && enter < toFrame(l.start_ms) ? { enterFrame: enter } : {}),
    };
  });
}

// Song lines (from the LRC) -> RawLyric with word end times (a word lasts until the next one starts;
// the last one until the line's sung end).
export function rawLyric(l: { text: string; start_ms: number; end_ms: number; isHook: boolean; words?: { text: string; start_ms: number }[]; sung_end_ms?: number }): RawLyric {
  const sungEnd = l.sung_end_ms;
  return {
    text: l.text,
    start_ms: l.start_ms,
    end_ms: l.end_ms,
    isHook: l.isHook,
    ...(l.words?.length ? { words: l.words.map((w, k) => ({ text: w.text, start_ms: w.start_ms, end_ms: l.words![k + 1]?.start_ms ?? sungEnd ?? l.end_ms })) } : {}),
    ...(sungEnd !== undefined ? { sung_end_ms: sungEnd } : {}),
  };
}

export function composeProps(
  base: RenderBase,
  choices: ComposeChoices,
): { props: Omit<LyricVideoProps, "mediaBaseUrl">; warnings: string[]; anchors: AnchorReport | null; transitions: { text: string; kinds: TransitionKind[] } | null } {
  let plan = choices.plan ?? base.plan;
  const platform = base.platform ?? { format: DEFAULT_FORMAT, safeZone: DEFAULT_SAFE_ZONE, lyricsAt: 0.45, textScale: 1 };
  const bars = choices.cinematicBars ?? base.cinematicBars;
  const layoutOf = platform.lyricSafeZone ? undefined : platform.textLayout;
  const area = areaForLayout(lyricArea(platform.format, platform.lyricSafeZone ?? platform.safeZone, platform.lyricsAt, bars), layoutOf, platform.lyricsAt);
  const timed = lyricFrames(base, choices.leadMs ?? DEFAULT_LEAD_MS, choices.lyricsOffsetMs ?? 0, !!choices.effects, choices.effects?.gap);
  // Each line with its textboard card (the card's look; without a textboard: unchanged).
  const allLines = base.cards
    ? timed.map((l, k) => (base.cards![k] ? withCard(l, base.cards![k]!, { area, nextStartFrame: timed[k + 1]?.startFrame ?? null, durationInFrames: base.durationInFrames }) : l))
    : timed;
  const lyrics = allLines
    .map((l) => ({ ...l, startFrame: Math.max(0, l.startFrame), endFrame: Math.min(base.durationInFrames, l.endFrame) }))
    .filter((l) => l.endFrame > l.startFrame);

  // Story anchors: their cuts go into the plan (they win over the regular cut rate).
  // (With the lines' sung ends: an anchor holds until its line is sung, also without lyric effects.)
  const anchorPlan =
    base.anchors?.length && base.beats && base.clips.length
      ? planAnchors(plan, base.beats, base.anchors, lyricFrames(base, choices.leadMs ?? DEFAULT_LEAD_MS, choices.lyricsOffsetMs ?? 0, true, choices.effects?.gap))
      : null;
  if (anchorPlan) plan = anchorPlan.plan;
  // The user's rolls last: a cut moved by hand is final, also an anchor's (the cuts the user saw are matched).
  if (base.timeline?.cuts.length && base.beats?.length) plan = applyCutMoves(plan, base.beats, base.timeline.cuts).plan;
  const bounds = [0, ...plan.cuts.map((c) => c.frame - plan.start_frame), base.durationInFrames];
  const { byShot, warnings } = pinsToShots(base.pins, allLines, bounds);
  const notes: string[] = [];
  const clipStarts = new Map<number, number>();
  const exact = new Set<number>(); // singing clips' shots (lip sync): normal speed from the frame that matches the song
  const anchorOnly = new Set((base.anchors ?? []).filter((a) => a.syncMs != null).map((a) => a.clipId));
  for (const [shot, a] of anchorPlan?.shots ?? []) {
    // The anchor wins over a pin on the same shot.
    const pinned = byShot.get(shot);
    const pin = pinned && pinned !== a.clipId ? base.pins.find((p) => p.clipId === pinned) : undefined;
    if (pin) notes.push(`pins.txt line ${pin.lineNumber} "${pin.text}" (${pin.clipName}) gives way to the anchor on line ${a.line} (${a.clipName})`);
    byShot.set(shot, a.clipId);
    // Its clipIn, else the window around the clip's best moment (the clip editor's, else the strongest 2 s).
    const clip = base.clips.find((c) => c.id === a.clipId);
    const length = bounds[shot + 1] - bounds[shot];
    let inMs = a.clipInMs ?? clip?.in_ms ?? 0;
    if (a.clipInMs === null && clip?.best_ms !== undefined) {
      const needMs = (length * 1000 * (clip.speed ?? 1)) / VIDEO.fps;
      const from = clip.in_ms ?? 0;
      inMs = Math.max(from, Math.min(clip.best_ms + BEST_WINDOW_MS / 2 - needMs / 2, (clip.out_ms ?? clip.duration_ms) - needMs));
    }
    clipStarts.set(shot, Math.round((inMs * VIDEO.fps) / 1000));
    if (a.syncMs != null) {
      // Lip sync: the clip frame that belongs to this moment of the song (song frames: the plan's own).
      clipStarts.set(shot, Math.max(0, plan.start_frame + bounds[shot] - Math.round((a.syncMs * VIDEO.fps) / 1000)));
      exact.add(shot);
    }
  }

  // The user's slips: that shot plays another part of its clip. The story order decides which clip plays
  // in a shot, so a slip counts only while the order still puts the slip's clip there (the order changed in
  // Prepare or Shape: the slip is left aside). On an anchored shot only with the anchor's own clip.
  const slips: { shot: number; clipId: string; inMs: number }[] = [];
  if (base.timeline?.slips.length) {
    for (const [i, start] of bounds.slice(0, -1).entries()) {
      const slip = slipFor(base.timeline.slips, ((plan.start_frame + start) * 1000) / VIDEO.fps);
      const clip = slip && base.clips.find((c) => c.name.toLowerCase() === slip.clip.toLowerCase() && c.kind !== "photo");
      if (!slip || !clip) continue;
      if (anchorPlan?.shots.has(i) && (anchorPlan.shots.get(i)!.clipId !== clip.id || exact.has(i))) continue; // a singing clip stays in time
      slips.push({ shot: i, clipId: clip.id, inMs: slip.in * 1000 });
    }
  }

  const byId = new Map(base.clips.map((c) => [c.id, c]));
  // No clips (YouTube cover / stills layouts): no shots; the background comes from other props.
  const assignWith = (pins: typeof byShot, starts: typeof clipStarts) => assignClips(
    plan,
    base.clips.map((c) => ({
      id: c.id, name: c.name, duration_ms: c.duration_ms, still: c.kind === "photo",
      ...(c.rank !== undefined ? { rank: c.rank } : {}), ...(c.in_ms !== undefined ? { in_ms: c.in_ms } : {}), ...(c.out_ms !== undefined ? { out_ms: c.out_ms } : {}),
      ...(c.speed !== undefined ? { speed: c.speed } : {}), ...(c.best_ms !== undefined ? { best_ms: c.best_ms } : {}), ...(c.best_from === "clip editor" ? { best_user: true } : {}),
    })),
    choices.seed,
    { order: choices.order ?? "story", pins, loopEnding: platform.loopEnding, clipStarts: starts, ...(choices.moment ? { moment: choices.moment } : {}), anchored: new Set(anchorPlan?.shots.keys() ?? []), exact, anchorOnly },
  );
  let assigned = !base.clips.length ? [] : assignWith(byShot, clipStarts);
  if (slips.length && assigned.length) {
    const kept = slips.filter((x) => assigned[x.shot]?.clip_id === x.clipId);
    if (kept.length) {
      const pins = new Map(byShot);
      const starts = new Map(clipStarts);
      for (const x of kept) {
        pins.set(x.shot, x.clipId);
        starts.set(x.shot, Math.round((x.inMs * VIDEO.fps) / 1000));
      }
      assigned = assignWith(pins, starts);
    }
  }
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
    } as LyricVideoProps["shots"][number];
  });

  // Dissolves into anchored shots (~1 bar centred on the cut): the shot starts `before` frames early
  // over the previous one, which keeps playing `after` frames into it.
  const bar = barFrames(base.beats ?? []);
  for (const [index, a] of anchorPlan?.shots ?? []) {
    const transition = a.syncMs != null ? "cut" : choices.transitions === "cut" || choices.transitions === "dissolve" ? choices.transitions : a.transition;
    if (transition !== "dissolve" || index === 0 || !shots[index] || !shots[index - 1]) continue;
    const prev = shots[index - 1];
    const prevLeft = prev.kind === "photo" ? Infinity : Math.floor((prev.clipDurationFrames - 1 - prev.clipStartFrame) / prev.playbackRate) - prev.duration;
    const d = dissolveFrames(bar, prev.duration, shots[index].duration, prev.holdLastFrame ? 0 : prevLeft);
    if (!d.before && !d.after) continue;
    const shot = shots[index];
    const back = Math.round(d.before * shot.playbackRate);
    shots[index] = { ...shot, dissolve: d, ...(shot.kind !== "photo" && shot.clipStartFrame >= back ? { clipStartFrame: shot.clipStartFrame - back } : {}) };
    shots[index - 1] = { ...prev, tail: d.after };
  }

  // Automatic transitions between the other shots: dissolves of about half a bar, dips to black into a
  // chorus, cuts (anchored shots keep their own).
  let transitionPlan: { text: string; kinds: TransitionKind[] } | null = null;
  const dips: { frame: number; frames: number }[] = [];
  if (base.transitions && shots.length > 1) {
    const t = base.transitions;
    const anchored = new Set(anchorPlan?.shots.keys() ?? []);
    const cuts = shots.flatMap((sh, index) =>
      index === 0 || anchored.has(index)
        ? []
        : [{ shot: index, songMs: Math.round(((plan.start_frame + sh.start) * 1000) / VIDEO.fps), ...(t.byClip?.[assigned[index].clip_id] ? { fixed: t.byClip[assigned[index].clip_id] } : {}) }],
    );
    const planned = planTransitions({ style: t.style, feel: t.feel, cuts, hooks: t.hooks, sung: t.sung, barMs: (bar * 1000) / VIDEO.fps });
    for (const [index, kind] of planned.kinds) {
      if (kind === "dip") dips.push({ frame: shots[index].start, frames: Math.min(18, Math.max(8, Math.round(bar / 2))) });
      if (kind !== "dissolve") continue;
      const prev = shots[index - 1];
      const prevLeft = prev.kind === "photo" ? Infinity : Math.floor((prev.clipDurationFrames - 1 - prev.clipStartFrame) / prev.playbackRate) - prev.duration;
      const d = dissolveFrames(Math.round(bar / 2), prev.duration, shots[index].duration, prev.holdLastFrame ? 0 : prevLeft);
      if (!d.before && !d.after) continue;
      const shot = shots[index];
      const back = Math.round(d.before * shot.playbackRate);
      // The shot starts `back` clip frames earlier when the clip has them before its in point (clips.json).
      const inFrame = Math.round(((byId.get(assigned[index].clip_id)?.in_ms ?? 0) * VIDEO.fps) / 1000);
      shots[index] = { ...shot, dissolve: d, ...(shot.kind !== "photo" && shot.clipStartFrame - back >= inFrame ? { clipStartFrame: shot.clipStartFrame - back } : {}) };
      shots[index - 1] = { ...prev, tail: d.after };
    }
    transitionPlan = { text: planned.text, kinds: shots.map((_, i) => (i === 0 ? "cut" : (planned.kinds.get(i) ?? (shots[i].dissolve ? "dissolve" : "cut")))) };
  }
  const anchors: AnchorReport | null = anchorPlan
    ? {
        uses: anchorPlan.uses.map((u) => {
          const s = u.shot !== null ? assigned[u.shot] : undefined;
          const transition = u.lipsync ? "cut" : choices.transitions === "cut" || choices.transitions === "dissolve" ? choices.transitions : u.transition;
          return { ...u, transition, ...(s && s.playback_rate < 1 ? { playback_rate: s.playback_rate } : {}) };
        }),
        conflicts: anchorPlan.conflicts,
        notes: [...anchorPlan.notes, ...notes],
      }
    : null;

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
      textSize: Math.round((choices.textSize ?? entry.textSize) * platform.textScale),
      colour: choices.colour ?? base.colour,
      cinematicBars: bars,
      format: platform.format,
      safeZone: platform.safeZone,
      lyricArea: area,
      lyricsAt: platform.lyricsAt,
      ...(layoutOf ? { textLayout: layoutOf } : {}),
      ...(choices.effects ? { lyricEffects: choices.effects } : {}),
      ...(dips.length ? { dips } : {}),
      ...(base.lyricBacking ? { lyricBacking: true } : {}),
      ...(base.picture ? { picture: base.picture } : {}),
      ...(base.loopInto && shots.length > 1 && !assigned.at(-1)?.loop ? { loopInto: { frames: Math.max(4, Math.min(base.loopInto, Math.floor(shots.at(-1)!.duration / 2))) } } : {}),
    },
    warnings,
    anchors,
    transitions: transitionPlan,
  };
}

// One bar in frames: the median gap between downbeats (2 s at 120 BPM without beats).
function barFrames(beats: readonly Beat[]): number {
  const downs = beats.filter((b) => b.is_downbeat).map((b) => b.time_ms);
  const gaps = downs.slice(1).map((t, i) => t - downs[i]).sort((a, b) => a - b);
  return Math.round(((gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000) * VIDEO.fps) / 1000);
}
