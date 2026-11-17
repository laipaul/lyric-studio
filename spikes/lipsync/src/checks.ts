// Automatic checks of each result and the plain-language report (pure: the measurements come in as data).
// A problem = the result cannot be used as it is (wrong length, wrong shape, does not play).
// Info = worth knowing, fixable later by the app (a lower resolution, another frame rate).

export type VideoInfo = { width: number; height: number; fps: number; durationS: number; hasAudio?: boolean };
export type Check = { name: string; level: "ok" | "info" | "problem"; message: string };

export const DURATION_TOLERANCE_S = 0.1;
export const ASPECT_TOLERANCE = 0.02; // 2 %

const p = (h: number) => `${h}p`;

export function checkResult(input: VideoInfo, sliceS: number, output: VideoInfo | null, plays: { ok: boolean; error?: string }): Check[] {
  if (!output) return [{ name: "plays", level: "problem", message: `The file cannot be read as a video${plays.error ? `: ${plays.error}` : ""}.` }];
  const checks: Check[] = [];
  checks.push(plays.ok ? { name: "plays", level: "ok", message: "Plays from start to end." } : { name: "plays", level: "problem", message: `Does not play cleanly: ${plays.error ?? "decoding failed"}.` });

  const diff = output.durationS - sliceS;
  checks.push(
    Math.abs(diff) <= DURATION_TOLERANCE_S
      ? { name: "duration", level: "ok", message: `Length ${output.durationS.toFixed(2)} s matches the audio (${sliceS.toFixed(2)} s).` }
      : { name: "duration", level: "problem", message: `Length ${output.durationS.toFixed(2)} s, the audio is ${sliceS.toFixed(2)} s (${diff > 0 ? "+" : ""}${diff.toFixed(2)} s): the mouth would drift from the song.` },
  );

  const inAspect = input.width / input.height;
  const outAspect = output.width / output.height;
  checks.push(
    Math.abs(outAspect - inAspect) / inAspect <= ASPECT_TOLERANCE
      ? { name: "aspect", level: "ok", message: `Same shape as the clip (${output.width}×${output.height}).` }
      : { name: "aspect", level: "problem", message: `Different shape: ${output.width}×${output.height}, the clip is ${input.width}×${input.height} (picture cropped or stretched).` },
  );

  const sameSize = output.width === input.width && output.height === input.height;
  checks.push(
    sameSize
      ? { name: "resolution", level: "ok", message: `Same resolution as the clip (${p(Math.min(input.width, input.height))}).` }
      : { name: "resolution", level: "info", message: `Model output ${p(Math.min(output.width, output.height))}, clip was ${p(Math.min(input.width, input.height))}.` },
  );

  checks.push(
    Math.abs(output.fps - input.fps) < 0.01
      ? { name: "fps", level: "ok", message: `Same frame rate (${round2(output.fps)} fps).` }
      : { name: "fps", level: "info", message: `Model output ${round2(output.fps)} fps, clip was ${round2(input.fps)} fps.` },
  );
  return checks;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// One verdict line per result, in the app's words.
export function verdict(checks: Check[]): string {
  const problems = checks.filter((c) => c.level === "problem");
  const infos = checks.filter((c) => c.level === "info");
  if (problems.length) return `Could be better: ${problems.map((c) => c.message).join(" ")}`;
  if (infos.length) return `Good: usable as it is. Note: ${infos.map((c) => c.message).join(" ")}`;
  return "Excellent: length, shape, resolution and frame rate all match the clip.";
}

export type ProviderReport = {
  id: string;
  name: string;
  endpoint: string;
  status: "done" | "failed" | "skipped";
  reason?: string;
  attempts: { request_id: string | null; started_at: string; ended_at: string; outcome: string }[];
  seconds?: number; // wall time from first submit to download
  estimated_cost_usd: number;
  billed_cost_usd?: number; // fal's price rule applied to what was sent (fal does not return the charge per request)
  output?: { file: string; review: string; width: number; height: number; fps: number; duration_s: number };
  checks?: Check[];
  verdict?: string;
};

export type JobReport = {
  created_at: string;
  song: string;
  part: { label: string; line: number | null; text: string | null; sung_start_s: number; sung_end_s: number; start_s: number; end_s: number; duration_s: number; pad_s: number };
  clip: { path: string; start_s: number; width: number; height: number; fps: number; duration_s: number };
  vocal_stem: string;
  files: Record<string, string>;
  providers: ProviderReport[];
  comparison: { file: string | null; note: string };
};

export function reportMarkdown(r: JobReport): string {
  const out: string[] = [];
  const part = r.part.line ? `line ${r.part.line} — “${r.part.text}”` : `${r.part.start_s.toFixed(2)}–${r.part.end_s.toFixed(2)} s`;
  out.push(`# Lip sync: ${r.song}, ${part}`, "");
  out.push(`- Part of the song: ${r.part.start_s.toFixed(2)}–${r.part.end_s.toFixed(2)} s (${r.part.duration_s.toFixed(2)} s, sung ${r.part.sung_start_s.toFixed(2)}–${r.part.sung_end_s.toFixed(2)} s, ${r.part.pad_s} s added each side)`);
  out.push(`- Clip: ${r.clip.path} (${r.clip.width}×${r.clip.height}, ${round2(r.clip.fps)} fps${r.clip.start_s ? `, from ${r.clip.start_s} s` : ""})`);
  out.push(`- Voice sent to the models: the vocal stem (${r.vocal_stem}); the review copies and comparison.mp4 play the full song.`, "");
  out.push("| Model | Result | Time | Cost (est. → by fal's price) |", "|---|---|---|---|");
  for (const p of r.providers) {
    const result = p.status === "done" ? p.verdict ?? "" : p.status === "skipped" ? `Skipped: ${p.reason}` : `Failed: ${p.reason}`;
    const time = p.seconds !== undefined ? `${Math.round(p.seconds)} s` : "–";
    const cost = `${money(p.estimated_cost_usd)}${p.billed_cost_usd !== undefined ? ` → ${money(p.billed_cost_usd)}` : ""}`;
    out.push(`| ${p.name} | ${result.replace(/\|/g, "/")} | ${time} | ${cost} |`);
  }
  out.push("");
  out.push(r.comparison.file ? `**Watch \`${r.comparison.file}\`**: ${r.comparison.note}` : `No comparison video: ${r.comparison.note}`);
  out.push("", "Which mouth looks most like singing is your call; the checks above only say whether each result fits the clip and the song.");
  const traced = r.providers.flatMap((p) => p.attempts.filter((a) => a.request_id).map((a) => `${p.name}: ${a.request_id} (${a.outcome})`));
  if (traced.length) out.push("", "fal request IDs (to trace a result on fal.ai):", ...traced.map((t) => `- ${t}`));
  return `${out.join("\n")}\n`;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;
