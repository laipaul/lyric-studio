// report.json (everything, incl. the fal request IDs) and report.md (the same in plain words).
import type { Judgement } from "./judge";
import { money } from "./pricing";

export type StepRecord = {
  key: string;
  label: string;
  endpoint: string | null;
  status: "done" | "failed" | "skipped" | "waiting";
  request_id?: string | null;
  attempts?: { request_id: string | null; outcome: string }[];
  estimated_usd: number;
  billed_usd?: number | null; // fal's billing, when the key may read it
  file?: string; // what came back (in the clip's folder)
  url?: string; // fal's URL of it (kept so a later step or `fetch` can use it)
  sent?: string[]; // the fields sent (values left out: they are URLs and prompts)
  notes?: string[];
  reason?: string;
};

// The new first frame of the keyframe methods and the free face check on it (every try).
export type KeyframeRecord = { file: string | null; model: string; passed: boolean; attempts: { seed: number; character: number | null; original: number | null; passed: boolean; file: string }[]; reason?: string };

export type MethodResult = {
  method: string;
  letter: string;
  name: string;
  status: "done" | "failed" | "skipped";
  reason?: string;
  steps: StepRecord[];
  seconds?: number;
  output?: { raw: string; fitted: string; raw_size: string; crop_share: number; padding_removed?: boolean };
  keyframe?: KeyframeRecord;
  judge?: Judgement | null;
  judge_error?: string;
  verdict?: string;
};

export type ClipReport = { position: number; name: string; source: string; width: number; height: number; fps: number; duration_s: number; folder: string; results: MethodResult[]; comparison: string | null };

export type RunReport = {
  created_at: string;
  song: string;
  character: { name: string; version: number; pictures: string[]; green_from: number; lines: string };
  methods: string[];
  keyframe_model?: string;
  cap_usd: number;
  estimated_usd: number;
  billed_usd: number | null;
  billing_note: string;
  clips: ClipReport[];
  comparison: string | null;
};

const icon = (l: string | undefined) => (l === "ok" ? "✓" : l === "warn" ? "!" : l === "problem" ? "✗" : "·");

export function reportMarkdown(r: RunReport): string {
  const out: string[] = [];
  out.push(`# Recast: ${r.song} → ${r.character.name} (v${r.character.version})`, "");
  out.push(`- Pictures: ${r.character.pictures.join(", ")} (never the full-body views). MiniMax and Wan get the close-up only; the keyframe gets the close-up and 3/4 face; Kling gets all three as an element.`);
  out.push(`- Face check: SFace against those pictures, same person from ${r.character.green_from} (${r.character.lines}).`);
  out.push(`- Cost: estimated ${money(r.estimated_usd)} (cap ${money(r.cap_usd)})${r.billed_usd !== null ? `, billed by fal ${money(r.billed_usd)}` : ""}. ${r.billing_note}`);
  out.push(`- Methods: ${r.methods.join(", ")}.`, "");
  if (r.comparison) out.push(`**Watch \`${r.comparison}\`**: every clip, original first, then each method, side by side.`, "");
  for (const c of r.clips) {
    out.push(`## Card ${c.position}: ${c.name} (${c.width}×${c.height}, ${c.fps.toFixed(2)} fps, ${c.duration_s.toFixed(2)} s)`, "");
    out.push("| Method | Verdict | Face | Scene | Motion | Cost | Time |", "|---|---|---|---|---|---|---|");
    for (const m of c.results) {
      const cost = m.steps.reduce((s, x) => s + (x.status === "done" || x.status === "failed" ? x.estimated_usd : 0), 0);
      const billed = m.steps.every((x) => x.billed_usd !== undefined && x.billed_usd !== null) && m.steps.length ? m.steps.reduce((s, x) => s + (x.billed_usd ?? 0), 0) : null;
      const j = m.judge;
      const v = m.status === "done" ? m.verdict ?? "" : `${m.status === "skipped" ? "Skipped" : "Failed"}: ${m.reason ?? ""}`;
      const cell = (x: { level: string; text: string } | undefined) => (x ? `${icon(x.level)} ${x.text}` : "–");
      out.push(`| ${m.letter} ${m.name} | ${v.replace(/\|/g, "/")} | ${cell(j?.face).replace(/\|/g, "/")} | ${cell(j?.environment).replace(/\|/g, "/")} | ${cell(j?.motion).replace(/\|/g, "/")} | ${m.status === "skipped" ? "–" : `${money(cost)}${billed !== null ? ` (billed ${money(billed)})` : ""}`} | ${m.seconds !== undefined ? `${Math.round(m.seconds)} s` : "–"} |`);
    }
    out.push("");
    if (c.comparison) out.push(`Side by side: \`${c.folder}/${c.comparison}\``, "");
    for (const m of c.results) {
      if (m.judge?.face.weakest) out.push(`- ${m.letter}: weakest face moment ${m.judge.face.weakest.t.toFixed(1)} s (score ${m.judge.face.weakest.score.toFixed(2)}).`);
      if (m.keyframe) out.push(`- ${m.letter}: new first frame (${m.keyframe.model}): ${m.keyframe.attempts.map((x, i) => `try ${i + 1} seed ${x.seed}: face vs character ${x.character === null ? "none" : x.character.toFixed(2)}, vs original person ${x.original === null ? "none" : x.original.toFixed(2)} ${x.passed ? "✓" : "×"}`).join("; ")}${m.keyframe.reason ? `. ${m.keyframe.reason}` : ""}`);
      if (m.output?.padding_removed) out.push(`- ${m.letter}: the model worked on the clip padded to 9:16; the padding was removed (nothing of the picture was cropped).`);
      else if (m.output && m.output.crop_share > 0.02) out.push(`- ${m.letter}: the model returned ${m.output.raw_size}; ${Math.round(m.output.crop_share * 100)}% was cropped to keep the clip's shape.`);
      for (const s of m.steps) for (const n of s.notes ?? []) out.push(`- ${m.letter} (${s.label}): ${n}`);
    }
    out.push("");
  }
  out.push("Which recast looks right is your call; the checks say whether the character, the scene and the movement held.");
  const ids = r.clips.flatMap((c) => c.results.flatMap((m) => m.steps.filter((s) => s.request_id).map((s) => `card ${c.position} ${m.letter} ${s.label}: ${s.endpoint} ${s.request_id} (${s.status})`)));
  if (ids.length) out.push("", "fal request IDs (to trace a result, or `pnpm recast fetch` to get one that did not download):", ...ids.map((x) => `- ${x}`));
  return `\uFEFF${out.join("\n")}\n`; // with a BOM: Windows PowerShell's Get-Content then shows ✓ × → – correctly
}
