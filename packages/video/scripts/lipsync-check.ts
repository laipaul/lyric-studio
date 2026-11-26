// pnpm lipsync:check "<folder or video files>" [--max 10]: the lip-sync check (src/lipsync-check.ts) on clips anywhere on
// the PC, for calibrating its limits by eye (26 Nov 2026, Paul: "run lipsync-check on 8-10 of my real clips and give me a
// table (clip, verdict, head turn, face size, reasons, best window)"). Local and free; changes nothing, saves nothing.
// It prints a table (paste it in the chat) and, with --frames, every measured frame of each clip as well.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { judgeLipsync, LIPSYNC_LIMITS, type LipMeasure } from "../src/lipsync-check";
import { localFaceTool } from "../src/node/characters/face";

const args = process.argv.slice(2);
const max = Number(args[args.indexOf("--max") + 1]) || 10;
const frames = args.includes("--frames");
const items = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--max");
if (!items.length) {
  console.error('usage: pnpm lipsync:check "D:\\path\\to\\clips" [--max 10] [--frames]');
  process.exit(1);
}
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const base = process.env.INIT_CWD ?? process.cwd();
const files = items.flatMap((it) => {
  const p = path.resolve(base, it);
  if (!existsSync(p)) {
    console.error(`not found: ${p}`);
    return [];
  }
  return statSync(p).isDirectory() ? readdirSync(p).filter((f) => VIDEO.test(f)).sort().map((f) => path.join(p, f)) : VIDEO.test(p) ? [p] : [];
}).slice(0, max);
if (!files.length) {
  console.error("No video clips found (.mp4, .mov, .m4v, .webm).");
  process.exit(1);
}

const face = localFaceTool();
const ICON = { good: "✅ Good", risky: "⚠️ Risky", bad: "❌ Not suitable" } as const;
const rows: string[][] = [];
for (const [i, f] of files.entries()) {
  process.stderr.write(`[${i + 1}/${files.length}] ${path.basename(f)}…\n`);
  try {
    const m = (await face.lipsync!(f)) as LipMeasure;
    const c = judgeLipsync(m);
    const yaws = m.frames.flatMap((x) => (x.face && x.yaw != null ? [Math.round(Math.abs(x.yaw))] : []));
    const turn = yaws.length ? `${c.turn} (${Math.min(...yaws)}–${Math.max(...yaws)}°)` : c.turn;
    rows.push([path.basename(f), ICON[c.verdict], turn, c.faceShare == null ? "–" : `${Math.round(c.faceShare * 100)} %`, c.reasons.join("; "), c.window ? `${c.window.from.toFixed(1)}–${c.window.to.toFixed(1)} s` : "–"]);
    if (frames) {
      console.log(`\n${path.basename(f)} (${m.duration.toFixed(1)} s):`);
      for (const x of m.frames) console.log(`  ${x.t.toFixed(2)} s  face ${x.face ? `${Math.round((x.face_frac ?? 0) * 100)} %` : "none"}  yaw ${x.yaw ?? "–"}  mouth light ${x.mouth_light ?? "–"}  covered ${x.mouth_covered ? "yes" : "no"}  sharp ${x.sharp ?? "–"}`);
    }
  } catch (error) {
    rows.push([path.basename(f), "?", "–", "–", `could not be read: ${(error as Error).message}`, "–"]);
  }
}
const head = ["Clip", "Verdict", "Head turn", "Face size", "Reasons", "Best window"];
console.log(`\n| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`);
for (const r of rows) console.log(`| ${r.map((x) => x.replace(/\|/g, "/")).join(" | ")} |`);
console.log(`\nLimits now: face too small < ${LIPSYNC_LIMITS.faceBad * 100} % (small < ${LIPSYNC_LIMITS.faceRisky * 100} %), turned > ${LIPSYNC_LIMITS.yawRisky}°, profile > ${LIPSYNC_LIMITS.yawBad}°, mouth shadow < ${LIPSYNC_LIMITS.shadowBad} (dark < ${LIPSYNC_LIMITS.shadowRisky}), blur < ${LIPSYNC_LIMITS.sharpBad} (soft < ${LIPSYNC_LIMITS.sharpRisky}), movement > ${LIPSYNC_LIMITS.moveBad} (fast-ish > ${LIPSYNC_LIMITS.moveRisky}) of the frame per second.`);
