// pnpm lyrics:compare-voice "<song folder>"   e.g. pnpm lyrics:compare-voice "workspace\songs\Life Lyrics\These Empty Roads"
// Lyric timing on the vocals the app separates (Demucs) next to the timing on Suno's vocal stem
// (vocals.wav, lined up on the song): per line the start, the aligner's confidence and the vocal-start
// check's result, and the totals (lines flagged for review, low-confidence lines, lines moved by the
// check). Aligns with each source once if it has not been aligned on it yet (stored like every
// alignment; the next make reuses the stem's). Changes nothing else: no video, the song and the stems
// are only read. The comparison is also written to the song's .studio\lyrics\compare-voice-<time>.md.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { DEMUCS, findOrCreateSongProject, parseMakeArgs, resolveVoiceSource, songPathsById, timeLyrics, type LyricTiming } from "../src/node";
import { clockText } from "../src/section";

const cwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: pnpm lyrics:compare-voice "<song folder>"   (e.g. "workspace\\songs\\Life Lyrics\\These Empty Roads")');
  process.exit(1);
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function rows(t: LyricTiming) {
  const reports = t.alignment.report?.lines ?? [];
  return t.alignment.lines.map((l, i) => {
    const check = t.alignment.guard?.check.lines.find((c) => c.number === i + 1);
    const conf = reports.find((r) => r.number === i + 1)?.confidence ?? null;
    const result = t.moved.some((m) => m.number === i + 1) ? "moved" : t.flagged.includes(i + 1) ? "REVIEW" : check ? check.result : "";
    return { start: l.start_ms, conf, result, low: t.lowConfidence.includes(i + 1) };
  });
}

async function main() {
  const { options } = parseMakeArgs(args, cwd);
  const ws = openWorkspace(resolveWorkspaceDir());
  try {
    const sp = await findOrCreateSongProject(ws, options.song);
    const id = sp.project.id;
    const quiet = (m: string) => (/^(lyrics: (aligning|voice|the vocal stem|checking)|vocal stem)/.test(m) ? console.log(`  ${m}`) : undefined);
    const voice = await resolveVoiceSource(ws, sp, { log: quiet });
    if (voice.kind !== "stem") {
      console.error(voice.message ?? `No vocal stem: put the vocal stem as vocals.wav in ${songPathsById(ws, id).root} first.`);
      process.exit(1);
    }
    console.log(`"${sp.project.title}": lyric timing on the vocals separated by the app (Demucs) vs ${voice.label}`);
    console.log("Demucs:");
    const a = await timeLyrics(ws, id, { voice: DEMUCS, save: false, log: quiet });
    console.log("Vocal stem:");
    const b = await timeLyrics(ws, id, { voice, save: false, log: quiet });
    const ra = rows(a);
    const rb = rows(b);
    const out: string[] = [];
    const say = (s = "") => {
      out.push(s);
      console.log(s);
    };
    say();
    say(`${pad("Line", 5)} ${pad("Text", 34)} | ${pad("Demucs", 26)} | ${pad("Vocal stem", 26)} | Diff`);
    say(`${pad("", 5)} ${pad("", 34)} | ${pad("start   conf  check", 26)} | ${pad("start   conf  check", 26)} |`);
    const cell = (r: ReturnType<typeof rows>[number] | undefined) => (r ? `${clockText(r.start).padEnd(7)} ${r.conf === null ? "  – " : r.conf.toFixed(2)}${r.low ? "!" : " "} ${r.result}` : "");
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      const diff = ra[i] && rb[i] ? (rb[i].start - ra[i].start) / 1000 : null;
      const text = (b.alignment.lines[i] ?? a.alignment.lines[i]).text;
      say(`${pad(String(i + 1), 5)} ${pad(text, 34)} | ${pad(cell(ra[i]), 26)} | ${pad(cell(rb[i]), 26)} | ${diff !== null && Math.abs(diff) >= 0.3 ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)} s` : ""}`);
    }
    say();
    say(`${pad("", 34)} ${pad("Demucs", 8)} Vocal stem`);
    say(`${pad("Lines flagged for review", 34)} ${pad(String(a.flagged.length), 8)} ${b.flagged.length}`);
    say(`${pad("Low-confidence lines", 34)} ${pad(String(a.lowConfidence.length), 8)} ${b.lowConfidence.length}`);
    say(`${pad("Lines moved by the vocal-start check", 34)} ${pad(String(a.moved.length), 8)} ${b.moved.length}`);
    const differ = ra.filter((r, i) => rb[i] && Math.abs(rb[i].start - r.start) >= 300).length;
    say(`${pad("Lines starting 0.3 s+ apart", 34)} ${differ}`);
    say();
    say(`Flagged for review: Demucs ${a.flagged.join(", ") || "none"} · vocal stem ${b.flagged.join(", ") || "none"}`);
    say(`Low confidence (!): Demucs ${a.lowConfidence.join(", ") || "none"} · vocal stem ${b.lowConfidence.join(", ") || "none"}`);
    say(`Moved to the vocals: Demucs ${a.moved.map((m) => m.number).join(", ") || "none"} · vocal stem ${b.moved.map((m) => m.number).join(", ") || "none"}`);
    const dir = songPathsById(ws, id).store;
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, `compare-voice-${stamp}.md`);
    writeFileSync(file, `# ${sp.project.title}: Demucs vs ${voice.label}\n\n\`\`\`\n${out.join("\n")}\n\`\`\`\n`);
    console.log(`\nSaved to ${file}`);
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
});
