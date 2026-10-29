// Quality checks for a finished variation ("pnpm make"), written to v<N>.qa.txt. Pure: the frame
// analysis (FFmpeg) and text measuring happen in Node and are passed in.
import { AUDIO_ENVELOPE_TOLERANCE_DB, AUDIO_LENGTH_TOLERANCE_S, AUDIO_LEVEL_TOLERANCE_DB, type AudioMatch } from "./audio";
import { VIDEO } from "./config";
import { cinematicBarHeight, DEFAULT_FORMAT, DEFAULT_LYRIC_AREA, DEFAULT_SAFE_ZONE, type Format, type LyricArea, type SafeZone } from "./platform";
import type { AnchorReport } from "./compose";
import type { LoopResult } from "./loop";
import { MAX_LINES } from "./lyrics";
import type { LyricVideoProps } from "./props";
import { RECENT_WINDOW } from "./shots";
import { logoCornerProblem } from "./youtube";

export const MIN_SHOT_FRAMES = Math.round(0.8 * VIDEO.fps);
export const LOW_CONFIDENCE = 0.5;
export const EARLY_VOICE_MS = 1000; // a line starting this long before its voice is early

export type Box = { left: number; top: number; right: number; bottom: number };
export type TimeRange = { start_s: number; end_s: number };

export type QaLyric = {
  number: number; // line number in lyrics.txt (1-based)
  text: string;
  confidence: number | null; // null: not known (LRC given by hand)
  earlyMs?: number | null; // how long after its stamp the voice begins (vocal track); null: not known
  review?: string | null; // the vocal-start check flagged its start for review (why)
  checkedByEar?: boolean; // the user listened and its timing is right (Lyrics tab): its timing WARNs are cleared
  lines: number; // text lines on screen
  box: Box; // largest extent on the 1080x1920 frame
};

export type QaInput = {
  props: Pick<LyricVideoProps, "shots" | "lyrics" | "cinematicBars" | "durationInFrames" | "format" | "safeZone" | "logo">;
  shotClips: string[]; // clip file name of each shot
  poolSize: number; // clips in the collection
  lyrics: QaLyric[]; // lines visible in this variation
  frames: { black: TimeRange[]; frozen: TimeRange[] } | null; // null: frame check not run
  sources?: { usable: number; needed: number; kind: string; platform: string } | null; // clips that suit this format
  sectionCuts?: { at: "start" | "end"; line: number; text: string; time_ms: number }[]; // sung lines cut by the section
  endScreen?: { clear: Box; lines: number[] } | null; // YouTube: the area kept free for end-screen elements
  frozenCheckSkipped?: boolean; // still pictures by design (YouTube cover / stills)
  length?: { actualS: number; songS: number | null } | null; // the finished file's length (songS: a full-song video)
  platformLimit?: { seconds: number; limitS: number; platform: string } | null; // a fixed section (0:11-1:10) against the platform's longest
  audioMatch?: AudioMatch | null; // the video's audio against the same section of the song (null: not checked)
  anchors?: (AnchorReport & { missing: string[] }) | null; // story anchors (song.json)
  loop?: LoopResult | null; // Reels, TikTok, Shorts: the wrap-around from the last frame to the first (null: not a loop platform)
  canvas?: { lastToFirst: number; typicalStep: number; hasAudio: boolean; seconds: number; min: number; max: number } | null; // Spotify Canvas
  // The title opening's cards (Reels, TikTok, Shorts): their blocks on the frame, when the first lyric line
  // appears, the characters no font has, and whether the profile grid's 3:4 crop applies.
  titleCards?: { blocks: { ids: string[]; text: string; box: Box; endFrame: number }[]; firstLyricFrame: number | null; missing: string[]; grid: { top: number; bottom: number } | null } | null;
};

export type QaCheck = { name: string; ok: boolean; details: string[] };
export type QaReport = { status: "PASS" | "WARN"; checks: QaCheck[] };

const t = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
const frameTime = (frame: number) => t(frame / VIDEO.fps);

// The area the text block covers: centred in the lyric area at area.centerY, scaled by the
// animation's largest scale (the pop animation overshoots slightly).
export function lyricBox(lineCount: number, fontSize: number, widestPx: number, maxScale = 1, area: LyricArea = DEFAULT_LYRIC_AREA): Box {
  const cx = area.left + (area.right - area.left) / 2;
  const height = lineCount * fontSize * area.lineHeight * maxScale;
  const width = widestPx * maxScale;
  return { left: cx - width / 2, right: cx + width / 2, top: area.centerY - height / 2, bottom: area.centerY + height / 2 };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function safeZoneProblem(box: Box, cinematicBars: boolean, format: Format = DEFAULT_FORMAT, safe: SafeZone = DEFAULT_SAFE_ZONE): string | null {
  const bar = cinematicBars ? cinematicBarHeight(format) : 0;
  const right = format.width * (1 - safe.right);
  const bottom = Math.min(format.height * (1 - safe.bottom), format.height - bar);
  const left = format.width * safe.left;
  const top = Math.max(format.height * safe.top, bar);
  if (box.right > right) return `reaches ${Math.ceil(box.right)} px from the left (limit ${Math.floor(right)} px, right ${pct(safe.right)})`;
  if (box.bottom > bottom) {
    return `reaches ${Math.ceil(box.bottom)} px from the top (limit ${Math.floor(bottom)} px, ${bar && bottom === format.height - bar ? "bottom cinematic bar" : `bottom ${pct(safe.bottom)}`})`;
  }
  if (box.left < left) return safe.left ? `starts left of ${Math.floor(left)} px (left ${pct(safe.left)})` : "starts outside the left edge";
  if (box.top < top) {
    if (bar && top === bar) return "reaches into the top cinematic bar";
    return safe.top ? `starts above ${Math.floor(top)} px (top ${pct(safe.top)})` : "starts above the top edge";
  }
  return null;
}

// FFmpeg blackdetect / freezedetect messages -> time ranges (seconds).
export function parseFrameDetect(stderr: string, durationSeconds: number): { black: TimeRange[]; frozen: TimeRange[] } {
  const black = [...stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({
    start_s: Number(m[1]),
    end_s: Number(m[2]),
  }));
  const frozen: TimeRange[] = [];
  let open: number | null = null;
  for (const m of stderr.matchAll(/freezedetect\.freeze_(start|end):\s*([\d.]+)/g)) {
    if (m[1] === "start") open = Number(m[2]);
    else if (open !== null) {
      frozen.push({ start_s: open, end_s: Number(m[2]) });
      open = null;
    }
  }
  if (open !== null) frozen.push({ start_s: open, end_s: durationSeconds });
  return { black, frozen };
}

export function runQa(input: QaInput): QaReport {
  const { props } = input;
  const checks: QaCheck[] = [];

  // 1. Lyric lines the aligner was not sure about.
  const unknown = input.lyrics.filter((l) => l.confidence === null).length;
  const lowAll = input.lyrics.filter((l) => l.confidence !== null && l.confidence < LOW_CONFIDENCE);
  const low = lowAll.filter((l) => !l.checkedByEar);
  const byEar = (ls: QaLyric[]) => ls.filter((l) => l.checkedByEar).map((l) => `line ${l.number} "${l.text}": checked by ear`);
  checks.push({
    name: "Lyric timing confidence",
    ok: low.length === 0,
    details: [
      ...low.map((l) => `line ${l.number} "${l.text}": confidence ${l.confidence!.toFixed(2)} (below ${LOW_CONFIDENCE}); check its timing`),
      ...byEar(lowAll),
      ...(unknown ? [`${unknown} line(s) without a confidence value (lyrics not aligned by pnpm align)`] : []),
    ],
  });

  // 1b. Lines that start long before they are sung (aligned into an intro, a bridge or a solo).
  const earlyAll = input.lyrics.filter((l) => (l.earlyMs ?? 0) > EARLY_VOICE_MS);
  const early = earlyAll.filter((l) => !l.checkedByEar);
  checks.push({
    name: "Lines start with the vocals",
    ok: early.length === 0,
    details: [...early.map((l) => `line ${l.number} "${l.text}" starts long before the vocals (${(l.earlyMs! / 1000).toFixed(1)} s early); check its timing`), ...byEar(earlyAll)],
  });

  // 1c. Line starts the vocal-start check could not settle (kept where the alignment has them).
  const reviewAll = input.lyrics.filter((l) => l.review);
  const review = reviewAll.filter((l) => !l.checkedByEar);
  checks.push({
    name: "Line starts to review",
    ok: review.length === 0,
    details: [...review.map((l) => `line ${l.number} "${l.text}": flagged for review (${l.review}); kept where the alignment has it`), ...byEar(reviewAll)],
  });

  // 1d. The music is the song itself: same length, same level (outside the fades), same loudness curve.
  if (input.audioMatch) {
    const a = input.audioMatch;
    const details: string[] = [];
    if (Math.abs(a.actualS - a.expectedS) > AUDIO_LENGTH_TOLERANCE_S) details.push(`the audio lasts ${a.actualS.toFixed(2)} s, the section ${a.expectedS.toFixed(2)} s`);
    if (Math.abs(a.levelDiffDb) > AUDIO_LEVEL_TOLERANCE_DB) details.push(`the level differs from the song by ${a.levelDiffDb > 0 ? "+" : ""}${a.levelDiffDb.toFixed(2)} dB (allowed ${AUDIO_LEVEL_TOLERANCE_DB} dB)`);
    if (a.envelopeDiffDb > AUDIO_ENVELOPE_TOLERANCE_DB) details.push(`the loudness curve differs from the song's by ${a.envelopeDiffDb.toFixed(2)} dB on average (a different part of the song, or shifted?)`);
    checks.push({ name: "Audio matches the song", ok: details.length === 0, details });
  }

  // 2. The same clip again within 3 shots.
  const repeats: string[] = [];
  input.shotClips.forEach((clip, i) => {
    for (let back = 1; back <= RECENT_WINDOW && i - back >= 0; back++) {
      if (input.shotClips[i - back] === clip) {
        repeats.push(`shot ${i + 1} (${frameTime(props.shots[i].start)}) repeats ${clip} from shot ${i - back + 1}`);
        break;
      }
    }
  });
  const smallPool = input.poolSize <= RECENT_WINDOW;
  checks.push({
    name: "Clips repeated within 3 shots",
    ok: repeats.length === 0,
    details: [...repeats, ...(repeats.length && smallPool ? [`only ${input.poolSize} clip(s) in the collection: add more to avoid repeats`] : [])],
  });

  // 3. Black or frozen frames in the rendered video.
  if (input.frames) {
    const details: string[] = [];
    for (const b of input.frames.black) details.push(`black ${t(b.start_s)}-${t(b.end_s)} (${(b.end_s - b.start_s).toFixed(1)} s)`);
    for (const f of input.frames.frozen) {
      const held = props.shots.findIndex(
        (s) => s.holdLastFrame && s.start / VIDEO.fps < f.end_s && (s.start + s.duration) / VIDEO.fps > f.start_s,
      );
      details.push(
        `frozen ${t(f.start_s)}-${t(f.end_s)} (${(f.end_s - f.start_s).toFixed(1)} s)` +
          (held >= 0 ? ` - shot ${held + 1} holds the last frame of ${input.shotClips[held]} (clip too short)` : ""),
      );
    }
    if (input.frozenCheckSkipped) details.push("frozen-frame check skipped: still pictures by design (cover / stills layout)");
    checks.push({ name: "Black or frozen frames", ok: details.filter((d) => !d.startsWith("frozen-frame check skipped")).length === 0, details });
  } else {
    checks.push({ name: "Black or frozen frames", ok: true, details: ["not checked"] });
  }

  // 4. Lyric lines shown on more than 2 lines.
  const tall = input.lyrics.filter((l) => l.lines > MAX_LINES);
  checks.push({
    name: "Lyric lines over 2 lines",
    ok: tall.length === 0,
    details: tall.map((l) => `line ${l.number} "${l.text}" needs ${l.lines} lines; split it in lyrics.txt`),
  });

  // 5. Shots shorter than 0.8 s.
  const short = props.shots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.duration < MIN_SHOT_FRAMES)
    .map(({ s, i }) => `shot ${i + 1} at ${frameTime(s.start)} lasts ${(s.duration / VIDEO.fps).toFixed(2)} s`);
  checks.push({ name: "Shots under 0.8 s", ok: short.length === 0, details: short });

  // 6. Lyrics outside the platform safe zone.
  const outside = input.lyrics
    .map((l) => ({ l, problem: safeZoneProblem(l.box, props.cinematicBars, props.format, props.safeZone) }))
    .filter((x) => x.problem)
    .map(({ l, problem }) => `line ${l.number} "${l.text}" ${problem}`);
  checks.push({ name: "Lyrics inside the safe zone", ok: outside.length === 0, details: outside });

  // The finished video is as long as it should be (a full-song video: as long as the song).
  if (input.length) {
    const expected = props.durationInFrames / VIDEO.fps;
    const details: string[] = [];
    if (Math.abs(input.length.actualS - expected) > 0.25) details.push(`the file is ${input.length.actualS.toFixed(1)} s long, expected ${expected.toFixed(1)} s`);
    if (input.length.songS !== null && Math.abs(expected - input.length.songS) > 0.25) {
      details.push(`the video is ${expected.toFixed(1)} s but the song is ${input.length.songS.toFixed(1)} s`);
    }
    checks.push({ name: "Video length", ok: details.length === 0, details });
  }

  // Story anchors: every conflict named by line; a clip slowed to cover its line is always a WARN naming
  // the clip; anchors outside the section and pins that give way are notes (not a WARN).
  if (input.anchors) {
    const a = input.anchors;
    const slowed = a.uses.filter((u) => u.used && u.playback_rate !== undefined).map((u) => `line ${u.line} "${u.text}": ${u.clip} is slowed to ${u.playback_rate!.toFixed(2)}x to cover its line${u.playback_rate! <= 0.5 ? " (and its last frame may be held)" : ""}; choose a longer clip or an earlier clipIn`);
    const problems = [...a.missing, ...a.conflicts, ...slowed];
    const used = a.uses.filter((u) => u.used);
    checks.push({
      name: "Story anchors",
      ok: problems.length === 0,
      details: [...problems, ...(used.length ? [`used: ${used.map((u) => `line ${u.line} -> ${u.clip}${u.transition === "dissolve" ? " (dissolve)" : ""}`).join(", ")}`] : []), ...a.notes],
    });
  }

  // Reels, TikTok, Shorts loop on the platform: beat, phrase, sound, harmony and picture across the
  // wrap-around. A failed point names its cause; when all flow, one line says what was measured.
  if (input.loop) {
    const failed = input.loop.points.filter((p) => !p.ok);
    checks.push({
      name: "Loop flows",
      ok: failed.length === 0,
      details: failed.length ? failed.map((p) => p.detail) : [input.loop.points.map((p) => p.detail).join("; ")],
    });
  }

  // Spotify Canvas: a seamless loop (the jump from the last frame back to the first is no bigger
  // than an ordinary step between frames), no audio, 3-8 s.
  if (input.canvas) {
    const c = input.canvas;
    const limit = Math.max(6, c.typicalStep * 2.5);
    checks.push({
      name: "Seamless loop",
      ok: c.lastToFirst <= limit,
      details: c.lastToFirst <= limit ? [] : [`the jump from the last frame to the first is ${c.lastToFirst.toFixed(1)} (an ordinary frame step is ${c.typicalStep.toFixed(1)})`],
    });
    checks.push({ name: "No audio", ok: !c.hasAudio, details: c.hasAudio ? ["the file has an audio track (Spotify Canvas must be silent)"] : [] });
    const okLength = c.seconds >= c.min - 0.05 && c.seconds <= c.max + 0.05;
    checks.push({ name: `Length ${c.min}-${c.max} s`, ok: okLength, details: okLength ? [] : [`the loop is ${c.seconds.toFixed(2)} s`] });
  }

  // The title opening: inside the safe zone, inside the profile grid's 3:4 crop, gone before the first
  // lyric line, every character drawn.
  if (input.titleCards && input.titleCards.blocks.length) {
    const tc = input.titleCards;
    const outside = tc.blocks.map((b) => ({ b, problem: safeZoneProblem(b.box, false, props.format, props.safeZone) })).filter((x) => x.problem);
    checks.push({ name: "Title cards inside the safe zone", ok: !outside.length, details: outside.map(({ b, problem }) => `"${b.text}" ${problem}`) });
    if (tc.grid) {
      const cut = tc.blocks.filter((b) => b.box.top < tc.grid!.top || b.box.bottom > tc.grid!.bottom);
      checks.push({ name: "Title cards inside the profile grid (3:4)", ok: !cut.length, details: cut.map((b) => `"${b.text}" reaches ${b.box.top < tc.grid!.top ? "above" : "below"} the 3:4 area the profile grid shows (${Math.round(tc.grid!.top)}-${Math.round(tc.grid!.bottom)} px)`) });
    }
    if (tc.firstLyricFrame !== null) {
      const late = tc.blocks.filter((b) => b.endFrame > tc.firstLyricFrame! + 1);
      checks.push({ name: "Title cards clear of the first lyric", ok: !late.length, details: late.map((b) => `"${b.text}" is still on screen ${((b.endFrame - tc.firstLyricFrame!) / VIDEO.fps).toFixed(1)} s after the first lyric line appears`) });
    }
    checks.push({ name: "Title characters", ok: !tc.missing.length, details: tc.missing.length ? [`no font draws ${tc.missing.join(" ")} (they would show as boxes)`] : [] });
  }

  // The logo never covers a lyric line.
  if (props.logo) {
    const lg = props.logo;
    const covered = input.lyrics.filter((l) => l.box.right > lg.left && l.box.left < lg.left + lg.width && l.box.bottom > lg.top && l.box.top < lg.top + lg.height);
    checks.push({ name: "Logo clear of the lyrics", ok: covered.length === 0, details: covered.map((l) => `the logo overlaps line ${l.number} "${l.text}"`) });
    const corner = logoCornerProblem(props.format ?? DEFAULT_FORMAT, lg);
    checks.push({ name: "Logo in a frame corner", ok: !corner, details: corner ? [corner] : [] });
  }

  // YouTube: lyrics in the last seconds stay out of the end-screen area (bottom right).
  if (input.endScreen) {
    const c = input.endScreen.clear;
    const overlap = input.lyrics.filter(
      (l) => input.endScreen!.lines.includes(l.number) && l.box.right > c.left && l.box.left < c.right && l.box.bottom > c.top && l.box.top < c.bottom,
    );
    checks.push({
      name: "End-screen area clear",
      ok: overlap.length === 0,
      details: overlap.map((l) => `line ${l.number} "${l.text}" reaches into the end-screen area (bottom right) in the last seconds`),
    });
  }

  // 7. The section never cuts a sung line at its start or end (WARN, never PASS, naming the line).
  if (input.sectionCuts) {
    checks.push({
      name: "Section start/end",
      ok: input.sectionCuts.length === 0,
      details: input.sectionCuts.map(
        (c) => `the video ${c.at === "start" ? "starts" : "ends"} at ${t(c.time_ms / 1000)} in the song while line ${c.line} "${c.text}" is sung`,
      ),
    });
  }

  // 7b. A fixed section (as given, never trimmed) longer than the platform allows: WARN.
  if (input.platformLimit) {
    const l = input.platformLimit;
    const ok = l.seconds <= l.limitS + 0.05;
    checks.push({ name: "Length for the platform", ok, details: ok ? [] : [`the section is ${l.seconds.toFixed(1)} s; ${l.platform} allows up to ${l.limitS.toFixed(0)} s (it was not trimmed: choose a shorter section or "auto")`] });
  }

  // 8. Enough clips that suit this format (vertical sources for 9:16, horizontal for 16:9).
  if (input.sources) {
    const src = input.sources;
    checks.push({
      name: "Sources for this format",
      ok: src.usable >= src.needed,
      details:
        src.usable >= src.needed
          ? []
          : [`only ${src.usable} ${src.kind} source(s) for ${src.platform}; at least ${src.needed} needed so no clip repeats within 3 shots`],
    });
  }

  return { status: checks.every((c) => c.ok) ? "PASS" : "WARN", checks };
}

export function formatQa(report: QaReport, title: string): string {
  const out = [`${title}`, `QA: ${report.status}`, ""];
  for (const c of report.checks) {
    out.push(`[${c.ok ? "ok  " : "WARN"}] ${c.name}`);
    for (const d of c.details) out.push(`       ${d}`);
  }
  const reasons = report.checks.filter((c) => !c.ok).map((c) => c.name);
  out.push("", report.status === "PASS" ? "Summary: PASS" : `Summary: WARN - ${reasons.join("; ")}`);
  return `${out.join("\n")}\n`;
}

export function qaReasons(report: QaReport): string {
  return report.checks.filter((c) => !c.ok).map((c) => c.name.toLowerCase()).join(", ");
}
