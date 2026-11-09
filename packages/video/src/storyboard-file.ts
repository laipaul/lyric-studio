// The storyboard file (Theme v2 step 2d, agreed 9 Nov 2026; PROGRESS.md "Storyboard architecture"): Shape's
// plan of one video saved as `<song folder>\storyboards\<platform>-<n>.json`, so the plan the user sees is a
// thing on disk. Step 2d only writes it (nothing reads it yet: Make reads it from step 2e-1).
// All times are integer SONG milliseconds (the song is the master clock; video time = song time - range.startMs).
// Frames come back with the planner's own rounding: frame = round(ms x fps / 1000) (storyboardTiming; tested to
// give every frame of the plan back exactly).
// Locks: a field listed in an item's `locked` is the user's choice; any other field is the app's. In 2d the
// user's existing edits are imported as locks: moved cuts (clips.json "cuts": the shots on both sides of the cut,
// startMs / endMs), slips (clips.json "slips": the shot's trim) and story anchors (song.json: the shot carries
// the line). An edit that no shot of this video matches is listed in `edits.unmatched`, never dropped silently.
// Pure, browser-safe.
import { MATCH_MS, type CutMove, type Slip } from "./timeline-edits";

export const STORYBOARD_SCHEMA = 1;
export const STORYBOARD_DIR = "storyboards";

export type SbSlot = { slot: "song" | "vocals" | "lyrics"; file: string; sha256: string | null };
export type SbTextItem = {
  id: string; // "line-14" (the Lyrics tab's number, as the Textboard), "card-title", "card-byline", ...
  kind: "lyric" | "story" | "card";
  line?: number; // lyric / story: the line's number
  role?: string; // card: title | byline | tagline | hook | end
  text: string;
  isHook?: boolean;
  startMs: number; // on screen (song time)
  endMs: number;
  stampMs?: number; // sung (no lead)
  sungEndMs?: number; // its last word ends
  enterMs?: number; // after a long gap: fades in from here
  timing?: "aligned" | "hand" | "story"; // where the time comes from (song level: the stored timing, a hand-set start, the story timing)
  locked: string[];
};
export type SbShot = {
  id: string; // "sh-07": stable while the same clip covers about the same moment
  clip: string; // the clip's file name (clips.json, anchors and Assets use it)
  kind: "video" | "photo";
  trim: { inS: number; outS: number }; // the part of the clip played (seconds into the clip, speed applied)
  speed: number;
  startMs: number; // song time
  endMs: number;
  transitionIn: { type: "cut" | "dissolve" | "dip" };
  motion: "theme";
  effects: string[];
  carries: string | null; // the text item the shot is meant to carry (a story anchor)
  locked: string[];
  assessment: { level: "warn" | "note"; text: string }[];
};
export type SbUnmatched = { kind: "cut" | "slip"; atMs: number; detail: string; nearestShot: string | null };
export type StoryboardFile = {
  schemaVersion: typeof STORYBOARD_SCHEMA;
  id: string; // "reels-1"
  song: { title: string; artist: string; instrumental: boolean };
  inputs: { song: SbSlot | null; vocals: SbSlot | null; lyrics: SbSlot | null; alignment: string | null; clips: { file: "clips.json"; sha256: string | null } };
  output: {
    platform: string;
    format: string; // "9:16" | "16:9" | ...
    size: [number, number];
    fps: number;
    range: { mode: string; startMs: number; endMs: number; reason: string; locked: string[] };
    theme: { name: string | null; version: number | null };
  };
  analysis: { bpm: number; beatsMs: number[]; downbeatsMs: number[]; sections: { id: string; kind: "verse" | "chorus"; n: number; startMs: number; endMs: number }[] };
  text: SbTextItem[];
  shots: SbShot[];
  assessment: { verdict: string; headline: string; points: string[] };
  edits: { unmatched: SbUnmatched[] };
  history: { generatedAt: string; app: string | null; nextShot: number };
};

// What the builder needs from a plan (the planner's props for one video, and the song around it).
export type PlanForStoryboard = {
  id: string;
  platform: string;
  song: StoryboardFile["song"];
  inputs: StoryboardFile["inputs"];
  theme: StoryboardFile["output"]["theme"];
  fps: number;
  size: { width: number; height: number };
  section: { mode: string; startMs: number; endMs: number; reason: string; locked: boolean };
  songStartFrame: number; // where the video's audio starts in the song (frames)
  durationInFrames: number;
  bpm: number;
  beats: readonly { time_ms: number; is_downbeat: boolean }[]; // song time
  shots: readonly { start: number; duration: number; kind?: "video" | "photo"; playbackRate: number; dissolve?: unknown }[]; // props.shots
  shotInfo: readonly { clip: string; inS: number; outS: number; dip: boolean; anchorLine: number | null; warnings: string[] }[]; // storyShots, same order
  lyrics: readonly { text: string; startFrame: number; endFrame: number; isHook?: boolean; stampFrame?: number; sungEndFrame?: number; enterFrame?: number }[]; // props.lyrics
  lineNumbers: readonly (number | null)[]; // the Lyrics tab's number per props line
  handSet: readonly number[]; // lines with a hand-set start
  instrumental: boolean;
  cards: readonly { id: string; type: string; text: string; startFrame: number; endFrame: number }[]; // props.textCards on screen
  timeline: { cuts: readonly CutMove[]; slips: readonly Slip[] };
  assessment: StoryboardFile["assessment"];
  previous: StoryboardFile | null; // the file written before: its shot ids are kept
  now: string;
  app: string | null;
};

const msOf = (frame: number, fps: number) => Math.round((frame * 1000) / fps);
export const frameOf = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

function ratio(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const k = g(w, h) || 1;
  return `${w / k}:${h / k}`;
}

// Chorus / verse sections from the lines: runs of hook lines are choruses, the rest verses (until T1 brings
// Suno's own section tags); each from its first line's start to the next section's start.
export function sectionsFromLines(lines: readonly { isHook?: boolean; startMs: number; endMs: number }[], endMs: number): StoryboardFile["analysis"]["sections"] {
  const runs: { kind: "verse" | "chorus"; startMs: number }[] = [];
  for (const l of lines) {
    const kind = l.isHook ? "chorus" : "verse";
    if (runs.at(-1)?.kind !== kind) runs.push({ kind, startMs: l.startMs });
  }
  const count = { verse: 0, chorus: 0 };
  return runs.map((r, i) => {
    count[r.kind] += 1;
    return { id: `sec-${r.kind}-${count[r.kind]}`, kind: r.kind, n: count[r.kind], startMs: r.startMs, endMs: runs[i + 1]?.startMs ?? endMs };
  });
}

// Shot ids: a new shot keeps the id of the earlier file's shot with the same clip that overlaps it most (each
// id used once); the others get the next free number.
export function keepShotIds(shots: readonly { clip: string; startMs: number; endMs: number }[], previous: StoryboardFile | null): { ids: string[]; nextShot: number } {
  const used = new Set<string>();
  let next = previous?.history.nextShot ?? 1;
  const out: (string | null)[] = shots.map(() => null);
  if (previous) {
    // Best overlaps first, so a shot that clearly is the same one wins over a neighbour.
    const pairs: { i: number; id: string; overlap: number }[] = [];
    shots.forEach((s, i) => {
      for (const p of previous.shots) {
        if (p.clip.toLowerCase() !== s.clip.toLowerCase()) continue;
        const overlap = Math.min(s.endMs, p.endMs) - Math.max(s.startMs, p.startMs);
        if (overlap > 0) pairs.push({ i, id: p.id, overlap });
      }
    });
    pairs.sort((a, b) => b.overlap - a.overlap || a.i - b.i);
    for (const p of pairs) {
      if (out[p.i] || used.has(p.id)) continue;
      out[p.i] = p.id;
      used.add(p.id);
    }
  }
  const ids = out.map((id) => {
    if (id) return id;
    let fresh = `sh-${String(next).padStart(2, "0")}`;
    while (used.has(fresh)) fresh = `sh-${String(++next).padStart(2, "0")}`;
    used.add(fresh);
    next += 1;
    return fresh;
  });
  return { ids, nextShot: next };
}

const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

// The storyboard of one planned video.
export function buildStoryboard(p: PlanForStoryboard): StoryboardFile {
  const fps = p.fps;
  const song = (frame: number) => msOf(p.songStartFrame + frame, fps); // a video frame as song ms
  const startMs = msOf(p.songStartFrame, fps);
  const endMs = song(p.durationInFrames);
  const inRange = (ms: number) => ms >= startMs && ms <= endMs;

  // Text: the cards on screen, then the lines.
  const text: SbTextItem[] = [];
  for (const c of p.cards) {
    text.push({ id: `card-${c.id}`, kind: "card", role: c.type, text: c.text, startMs: song(c.startFrame), endMs: song(Math.min(c.endFrame, p.durationInFrames)), locked: [] });
  }
  const handSet = new Set(p.handSet);
  p.lyrics.forEach((l, k) => {
    const n = p.lineNumbers[k] ?? null;
    text.push({
      id: n !== null ? `line-${n}` : `line-x${k + 1}`,
      kind: p.instrumental ? "story" : "lyric",
      ...(n !== null ? { line: n } : {}),
      text: l.text,
      ...(l.isHook ? { isHook: true } : {}),
      startMs: song(l.startFrame),
      endMs: song(l.endFrame),
      ...(l.stampFrame !== undefined ? { stampMs: song(l.stampFrame) } : {}),
      ...(l.sungEndFrame !== undefined ? { sungEndMs: song(l.sungEndFrame) } : {}),
      ...(l.enterFrame !== undefined ? { enterMs: song(l.enterFrame) } : {}),
      timing: p.instrumental ? "story" : n !== null && handSet.has(n) ? "hand" : "aligned",
      locked: [],
    });
  });

  // Shots.
  const base = p.shots.map((s, i) => ({ clip: p.shotInfo[i].clip, startMs: song(s.start), endMs: song(s.start + s.duration) }));
  const { ids, nextShot } = keepShotIds(base, p.previous);
  const shots: SbShot[] = p.shots.map((s, i) => {
    const info = p.shotInfo[i];
    return {
      id: ids[i],
      clip: info.clip,
      kind: s.kind === "photo" ? "photo" : "video",
      trim: { inS: info.inS, outS: info.outS },
      speed: s.playbackRate,
      startMs: base[i].startMs,
      endMs: base[i].endMs,
      transitionIn: { type: info.dip ? "dip" : s.dissolve ? "dissolve" : "cut" },
      motion: "theme",
      effects: [],
      carries: info.anchorLine !== null ? `line-${info.anchorLine}` : null,
      locked: info.anchorLine !== null ? ["carries"] : [],
      assessment: info.warnings.map((w) => ({ level: "warn" as const, text: `shot ${i + 1}: ${w}` })),
    };
  });

  // The user's timeline edits (clips.json, song seconds) as locks; the ones no shot matches are listed.
  const near = (a: number, b: number) => Math.abs(a - b) <= MATCH_MS;
  const nearestShot = (ms: number) => shots.reduce<SbShot | null>((best, s) => (!best || Math.abs(s.startMs - ms) < Math.abs(best.startMs - ms) ? s : best), null);
  const lock = (s: SbShot, field: string) => {
    if (!s.locked.includes(field)) s.locked.push(field);
  };
  const unmatched: SbUnmatched[] = [];
  for (const c of p.timeline.cuts) {
    const to = Math.round(c.to * 1000);
    if (!inRange(to)) continue; // another part of the song: another video's edit
    const k = shots.findIndex((s, i) => i > 0 && near(s.startMs, to));
    if (k > 0) {
      lock(shots[k - 1], "endMs");
      lock(shots[k], "startMs");
    } else {
      const n = nearestShot(to);
      unmatched.push({ kind: "cut", atMs: to, detail: `the cut you moved from ${clock(c.from * 1000)} to ${clock(to)} is not at any cut of this video now`, nearestShot: n?.id ?? null });
    }
  }
  for (const sl of p.timeline.slips) {
    const at = Math.round(sl.at * 1000);
    if (!inRange(at)) continue;
    const s = shots.find((x) => near(x.startMs, at));
    if (s && s.clip.toLowerCase() === sl.clip.toLowerCase()) lock(s, "trim");
    else {
      const n = s ?? nearestShot(at);
      unmatched.push({ kind: "slip", atMs: at, detail: `your slip of ${sl.clip} (from ${sl.in.toFixed(2)} s into the clip) for the shot at ${clock(at)} matches no shot of that clip now${s ? ` (${s.clip} plays there)` : ""}`, nearestShot: n?.id ?? null });
    }
  }

  const lines = text.filter((t) => t.kind !== "card");
  return {
    schemaVersion: STORYBOARD_SCHEMA,
    id: p.id,
    song: p.song,
    inputs: p.inputs,
    output: {
      platform: p.platform,
      format: ratio(p.size.width, p.size.height),
      size: [p.size.width, p.size.height],
      fps,
      range: { mode: p.section.mode, startMs, endMs, reason: p.section.reason, locked: p.section.locked ? ["startMs", "endMs"] : [] },
      theme: p.theme,
    },
    analysis: {
      bpm: p.bpm,
      beatsMs: p.beats.filter((b) => inRange(b.time_ms)).map((b) => Math.round(b.time_ms)),
      downbeatsMs: p.beats.filter((b) => b.is_downbeat && inRange(b.time_ms)).map((b) => Math.round(b.time_ms)),
      sections: sectionsFromLines(lines, endMs),
    },
    text,
    shots,
    assessment: p.assessment,
    edits: { unmatched },
    history: { generatedAt: p.now, app: p.app, nextShot },
  };
}

// The plan's timing back in frames of the video, as the planner's props have it (the golden test compares
// these with the props, frame for frame; step 2e-1 builds the props from them).
export function storyboardTiming(sb: StoryboardFile) {
  const fps = sb.output.fps;
  const startFrame = frameOf(sb.output.range.startMs, fps);
  const v = (ms: number) => frameOf(ms, fps) - startFrame;
  return {
    songStartFrame: startFrame,
    durationInFrames: v(sb.output.range.endMs),
    shots: sb.shots.map((s) => ({ id: s.id, start: v(s.startMs), duration: v(s.endMs) - v(s.startMs) })),
    lyrics: sb.text
      .filter((t) => t.kind !== "card")
      .map((t) => ({
        id: t.id,
        startFrame: v(t.startMs),
        endFrame: v(t.endMs),
        ...(t.stampMs !== undefined ? { stampFrame: v(t.stampMs) } : {}),
        ...(t.sungEndMs !== undefined ? { sungEndFrame: v(t.sungEndMs) } : {}),
        ...(t.enterMs !== undefined ? { enterFrame: v(t.enterMs) } : {}),
      })),
    cards: sb.text.filter((t) => t.kind === "card").map((t) => ({ id: t.id.replace(/^card-/, ""), startFrame: v(t.startMs), endFrame: v(t.endMs) })),
  };
}

// The unmatched edits in plain words, one line each (Shape's notes, the pnpm storyboards report).
export function unmatchedText(sb: StoryboardFile): string[] {
  return sb.edits.unmatched.map((u) => {
    const shot = u.nearestShot ? sb.shots.findIndex((s) => s.id === u.nearestShot) : -1;
    return `${u.kind === "cut" ? "Moved cut" : "Slip"} not used: ${u.detail}${shot >= 0 ? ` (nearest: shot ${shot + 1} at ${clock(sb.shots[shot].startMs)})` : ""}. It is kept in clips.json.`;
  });
}

// The migration report (pnpm storyboards): the song's moved cuts and slips (clips.json) that NO video of the song
// uses now, each with what every video says about it (not at any cut / matches no shot, and the nearest shot), or
// that it lies outside every video's part of the song. Edits some video uses are fine and not listed.
export function unusedSongEdits(timeline: { cuts: readonly CutMove[]; slips: readonly Slip[] }, storyboards: readonly StoryboardFile[]): string[] {
  const out: string[] = [];
  const label = (sb: StoryboardFile) => `${sb.output.platform} ${sb.id.split("-").pop()}`;
  const check = (kind: "cut" | "slip", atMs: number, what: string) => {
    const covering = storyboards.filter((sb) => atMs >= sb.output.range.startMs && atMs <= sb.output.range.endMs);
    const missed = covering.map((sb) => ({ sb, u: sb.edits.unmatched.find((u) => u.kind === kind && u.atMs === atMs) }));
    if (covering.length && missed.some((m) => !m.u)) return; // some video uses it
    if (!covering.length) {
      out.push(`${what}: outside every planned video's part of the song (${storyboards.map((sb) => `${label(sb)} ${clock(sb.output.range.startMs)}-${clock(sb.output.range.endMs)}`).join(", ") || "no video planned"}); kept in clips.json`);
      return;
    }
    const where = missed.map(({ sb, u }) => {
      const k = u!.nearestShot ? sb.shots.findIndex((s) => s.id === u!.nearestShot) : -1;
      return `${label(sb)}: not used${k >= 0 ? ` (nearest: shot ${k + 1} at ${clock(sb.shots[k].startMs)})` : ""}`;
    });
    out.push(`${what}: ${where.join("; ")}; kept in clips.json`);
  };
  for (const c of timeline.cuts) check("cut", Math.round(c.to * 1000), `moved cut ${clock(c.from * 1000)} -> ${clock(c.to * 1000)}`);
  for (const s of timeline.slips) check("slip", Math.round(s.at * 1000), `slip of ${s.clip} at ${clock(s.at * 1000)} (from ${s.in.toFixed(2)} s into the clip)`);
  return out;
}
