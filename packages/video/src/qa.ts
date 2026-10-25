// Quality checks for a finished variation ("pnpm make"), written to v<N>.qa.txt. Pure: the frame
// analysis (FFmpeg) and text measuring happen in Node and are passed in.
import { VIDEO } from "./config";
import { cinematicBarHeight, DEFAULT_FORMAT, DEFAULT_LYRIC_AREA, DEFAULT_SAFE_ZONE, type Format, type LyricArea, type SafeZone } from "./platform";
import { MAX_LINES } from "./lyrics";
import type { LyricVideoProps } from "./props";
import { RECENT_WINDOW } from "./shots";

export const MIN_SHOT_FRAMES = Math.round(0.8 * VIDEO.fps);
export const LOW_CONFIDENCE = 0.5;

export type Box = { left: number; top: number; right: number; bottom: number };
export type TimeRange = { start_s: number; end_s: number };

export type QaLyric = {
  number: number; // line number in lyrics.txt (1-based)
  text: string;
  confidence: number | null; // null: not known (LRC given by hand)
  lines: number; // text lines on screen
  box: Box; // largest extent on the 1080x1920 frame
};

export type QaInput = {
  props: Pick<LyricVideoProps, "shots" | "lyrics" | "cinematicBars" | "durationInFrames" | "format" | "safeZone">;
  shotClips: string[]; // clip file name of each shot
  poolSize: number; // clips in the collection
  lyrics: QaLyric[]; // lines visible in this variation
  frames: { black: TimeRange[]; frozen: TimeRange[] } | null; // null: frame check not run
  sources?: { usable: number; needed: number; kind: string; platform: string } | null; // clips that suit this format
  sectionCuts?: { at: "start" | "end"; line: number; text: string; time_ms: number }[]; // sung lines cut by the section
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
  const low = input.lyrics.filter((l) => l.confidence !== null && l.confidence < LOW_CONFIDENCE);
  checks.push({
    name: "Lyric timing confidence",
    ok: low.length === 0,
    details: [
      ...low.map((l) => `line ${l.number} "${l.text}": confidence ${l.confidence!.toFixed(2)} (below ${LOW_CONFIDENCE}); check its timing`),
      ...(unknown ? [`${unknown} line(s) without a confidence value (lyrics not aligned by pnpm align)`] : []),
    ],
  });

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
    checks.push({ name: "Black or frozen frames", ok: details.length === 0, details });
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
