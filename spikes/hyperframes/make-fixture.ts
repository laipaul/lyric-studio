// Cloud only (the real songs are on the user's PC): makes a stand-in song with our own pipeline, so the
// spike has a genuine Reels manifest to read. A 45 s song at 92 BPM (a click and a held chord), eleven
// lines with word times like a real alignment (words of uneven length, a held word, a hook), four clips,
// and one Reels video rendered by our current renderer (Remotion). Nothing in the app is changed.
//   pnpm exec tsx spikes/hyperframes/make-fixture.ts     (from the project root)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wsDir = path.join(here, "fixture-workspace");
process.env.WORKSPACE_DIR = wsDir; // before the app's modules read it
const { openWorkspace, seedStylePresets } = await import("../../packages/db/src/index.ts");
const { findOrCreateSongProject, makeVideos, songPathsById, writeRecipe } = await import("../../packages/video/src/node/index.ts");
type AlignRunner = Parameters<typeof makeVideos>[0]["align"];

const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
rmSync(wsDir, { recursive: true, force: true });
mkdirSync(wsDir, { recursive: true });
const song = path.join(wsDir, "Spike Song.wav");
// 92 BPM: a click on every beat, a kick on every bar, a soft A minor chord underneath.
const beat = 60 / 92;
ffmpeg("-f", "lavfi", "-i",
  `aevalsrc='0.35*sin(2*PI*1200*t)*exp(-60*mod(t,${beat}))+0.8*sin(2*PI*55*t)*exp(-10*mod(t,${beat * 4}))+0.08*sin(2*PI*220*t)+0.06*sin(2*PI*261.6*t)+0.06*sin(2*PI*329.6*t)':s=44100:d=45`,
  "-ac", "2", song);

const LINES = [
  "Under the lights we were young",
  "Counting the stars on the run",
  "* Hold on to me tonight",
  "Every heartbeat feels so right",
  "Whisper my name in the dark",
  "We were the fire and the spark",
  "* Hold on to me tonight",
  "Every heartbeat feels so right",
  "Rivers will carry us home",
  "Never again be alone",
  "* Hold on to me tonight",
];
// Each line on a bar (2.61 s), two bars apart; words of uneven length; the last word of each hook held.
const bar = beat * 4;
const lines = LINES.map((raw, i) => {
  const text = raw.replace(/^\*\s+/, "");
  const start = 1.3 + i * bar * 1.5;
  const words = text.split(" ");
  const lengths = words.map((w, k) => (raw.startsWith("* ") && k === words.length - 1 ? 1.1 : 0.16 + w.length * 0.045));
  let t = start;
  const timed = words.map((w, k) => {
    const s = t;
    t += lengths[k] + (k % 3 === 2 ? 0.12 : 0.04); // small gaps, like singing
    return { w, s };
  });
  return { raw, text, start, timed, end: t };
});
const stamp = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const align: AlignRunner = async (a) => {
  writeFileSync(a.out, `${lines.map((l) => `[${stamp(l.start)}]${l.raw.startsWith("* ") ? "* " : ""}${l.timed.map((x) => `<${stamp(x.s)}>${x.w}`).join(" ")} <${stamp(l.end)}>`).join("\n")}\n`);
  writeFileSync(a.report, JSON.stringify({ model: "fake", lang: "en", low_confidence: 0.5, lines: lines.map((l, i) => ({ number: i + 1, text: l.text, is_hook: l.raw.startsWith("* "), start_ms: Math.round(l.start * 1000), end_ms: Math.round(l.end * 1000), confidence: 0.9 })) }));
};

const ws = openWorkspace(wsDir);
seedStylePresets(ws.db);
const id = (await findOrCreateSongProject(ws, song)).project.id;
const paths = songPathsById(ws, id);
writeFileSync(paths.lyricsTxt, `${LINES.join("\n")}\n`);
mkdirSync(paths.clips!, { recursive: true });
for (const [i, c] of ["blue", "orange", "purple", "teal"].entries()) {
  ffmpeg("-f", "lavfi", "-i", `testsrc2=s=540x960:r=30:d=8`, "-vf", `drawbox=c=${c}@0.55:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(paths.clips!, `0${i + 1}_clip.mp4`));
}
writeRecipe(paths.recipe!, { platforms: ["reels"], section: "0:00-0:40", variations: { reels: 1 } });
ws.close();
const started = Date.now();
const r = await makeVideos({ workspaceDir: wsDir, song: paths.audio!, lyrics: paths.lyricsTxt, platforms: "reels", align, frameCheck: false, log: () => {} });
console.log(`fixture: ${r.platforms[0].variations[0].manifestFile}`);
console.log(`our renderer made the whole Reels video (${r.platforms[0].variations[0].durationS.toFixed(1)} s) in ${((Date.now() - started) / 1000).toFixed(1)} s (incl. preparing clips and QA)`);
console.log(`song folder: ${paths.root}`);
