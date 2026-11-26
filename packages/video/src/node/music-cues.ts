// Music cues per sung line and instrumental gap (Performance script, Part B, 26 Nov 2026). Local and free: the audio
// service's music_cues.py reads the song and its stems (relative to the song's own range: Suno masters are heavily
// compressed) and measures, per line and gap, the level, the energy trend, the arrangement density, the events (build,
// drop, breakdown, silence, drums in / out, brighter / darker) and the vocal-vs-music contrast with the vocal cues.
// Cached in <song>\.studio\music-cues.json by the song's content, the vocal file and the line timing: recomputed only
// when one of them changes. The song is only read.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { project as projectTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { vocalSource } from "./lipsync";
import { timedLines } from "./production";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";

export const MUSIC_CUES_FILE = "music-cues.json";
export const GAP_MIN_MS = 2000; // a pause between sung lines this long (or longer) is an instrumental gap of its own

export type MusicEvent = { type: "build" | "drop" | "breakdown" | "silence" | "drums in" | "drums out" | "brighter" | "darker"; at_ms: number; to_ms?: number };
export type SegmentCue = { key: string; level: number; level_word: string; energy: number; trend: "rising" | "falling" | "steady"; density: "sparse" | "medium" | "full"; events: MusicEvent[]; contrast: string | null; vocal: string | null };
export type Segment = { key: string; kind: "line" | "gap"; number: number | null; text: string; startMs: number; endMs: number; section: string | null; sectionKind: string | null };
export type MusicCues = { key: string; engine: number; stems: "demucs" | "bands"; vocals: boolean; block_s: number; duration_ms: number; energy: number[]; events: MusicEvent[]; segments: (Segment & { cue: SegmentCue | null })[]; made_at: string };

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// The song's sung lines (timed) and the instrumental gaps between them (intro, breaks, outro), in time order.
export function songSegments(lines: { number: number; text: string; startMs: number | null; endMs: number | null }[], sections: { line: number; lastLine: number; kind: string; name: string }[], durationMs: number): Segment[] {
  const timed = lines.filter((l) => l.startMs !== null && l.endMs !== null).sort((a, b) => a.startMs! - b.startMs!);
  const sectionOf = (n: number) => sections.find((s) => n >= s.line && n <= s.lastLine) ?? null;
  const out: Segment[] = [];
  let gap = 0;
  const addGap = (from: number, to: number, label: string) => {
    if (to - from < GAP_MIN_MS) return;
    gap++;
    out.push({ key: `G${gap}`, kind: "gap", number: null, text: label, startMs: from, endMs: to, section: label, sectionKind: "instrumental" });
  };
  let at = 0;
  for (const [i, l] of timed.entries()) {
    addGap(at, l.startMs!, i === 0 ? "Intro" : "Instrumental");
    const s = sectionOf(l.number);
    out.push({ key: `L${l.number}`, kind: "line", number: l.number, text: l.text, startMs: l.startMs!, endMs: Math.max(l.endMs!, l.startMs! + 300), section: s?.name ?? null, sectionKind: s?.kind ?? null });
    at = Math.max(at, l.endMs!);
  }
  if (durationMs > 0) addGap(at, durationMs, timed.length ? "Outro" : "Instrumental");
  return out;
}

// The cue of a line or gap in a few words: "build → drop at 1:12; loud, rising; full; soft vocal over a loud mix".
export function cueText(c: SegmentCue | null): string {
  if (!c) return "";
  const ev = c.events.map((e) => (e.type === "build" && e.to_ms ? `build ${clock(e.at_ms)}→${clock(e.to_ms)}` : `${e.type} at ${clock(e.at_ms)}`));
  const merged = ev.join(", ").replace(/build (\d+:\d+)→(\d+:\d+), drop at \2/g, "build → drop at $2");
  return [merged, `${c.level_word}${c.trend === "steady" ? "" : `, ${c.trend}`}`, c.density, c.contrast && c.contrast !== "balanced" ? c.contrast : null, c.vocal ? `vocal ${c.vocal}` : null].filter(Boolean).join("; ");
}

function sha(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(args: string[], workspace: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "services", "audio", "scripts", "music-cues.mjs"), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, WORKSPACE_DIR: workspace, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim().split(/\r?\n/).pop() ?? "") : reject(new Error(`music analysis failed: ${err.trim().split(/\r?\n/).slice(-2).join(" | ")}`))));
  });
}

export function readMusicCues(songRoot: string): MusicCues | null {
  const f = path.join(songRoot, ".studio", MUSIC_CUES_FILE);
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as MusicCues) : null;
  } catch {
    return null;
  }
}

// The cached cues of a song (no measuring): the Script panel and Shape's band.
export function cachedMusicCues(ws: Workspace, projectId: string): MusicCues | null {
  return readMusicCues(songPathsById(ws, projectId).root);
}

// The cues of a song: the cached ones when the song, its vocal and its line timing are the same; else measured again.
export async function musicCues(ws: Workspace, projectId: string, o: { fresh?: boolean; stems?: "auto" | "none" } = {}): Promise<MusicCues> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  if (!paths.audio || !existsSync(paths.audio)) throw new Error("This song has no song file.");
  const lines = (await timedLines(ws, projectId).catch(() => null)) ?? [];
  let sections: { line: number; lastLine: number; kind: string; name: string }[] = [];
  try {
    sections = songSections(ws, projectId).sections;
  } catch {
    sections = [];
  }
  const segments = songSegments(lines, sections, p.duration_ms ?? 0);
  // The vocal for the contrast: a stem that lines up as it is (no offset, normal speed), else Demucs's (found by the
  // service itself), else none.
  const v = await vocalSource(ws, projectId).catch(() => null);
  const vocal = v?.file && existsSync(v.file) && Math.abs(v.offsetMs) < 50 && Math.abs(v.speed - 1) < 0.001 ? v.file : null;
  const songHash = sha(paths.audio);
  const key = createHash("sha256")
    .update(JSON.stringify({ songHash, vocal: vocal ? `${vocal}:${statSync(vocal).size}:${statSync(vocal).mtimeMs}` : null, segments: segments.map((s) => [s.key, s.startMs, s.endMs]), stems: o.stems ?? "auto", engine: 1 }))
    .digest("hex");
  const cached = readMusicCues(paths.root);
  if (!o.fresh && cached?.key === key) return cached;
  const tmp = path.join(os.tmpdir(), `lyric-segments-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(segments.map((s) => ({ key: s.key, start_ms: s.startMs, end_ms: s.endMs, sung: s.kind === "line" }))));
  try {
    const raw = JSON.parse(await run([paths.audio, "--segments", tmp, "--workspace", ws.dir, "--stems", o.stems ?? "auto", ...(vocal ? ["--vocals", vocal] : [])], ws.dir)) as Omit<MusicCues, "key" | "segments" | "made_at"> & { segments: SegmentCue[] };
    const byKey = new Map(raw.segments.map((s) => [s.key, s] as const));
    const result: MusicCues = { ...raw, key, segments: segments.map((s) => ({ ...s, cue: byKey.get(s.key) ?? null })), made_at: new Date().toISOString() };
    mkdirSync(path.join(paths.root, ".studio"), { recursive: true });
    writeFileSync(path.join(paths.root, ".studio", MUSIC_CUES_FILE), `${JSON.stringify(result)}\n`);
    return result;
  } finally {
    rmSync(tmp, { force: true });
  }
}

// The cue table (pnpm music:cues): time, section, line, level, trend, density, events, contrast.
export function cueTable(c: MusicCues): string {
  const rows = c.segments.map((s) => [
    clock(s.startMs),
    s.kind === "gap" ? s.text : (s.section ?? ""),
    s.kind === "gap" ? "(instrumental)" : `${s.number}. ${s.text.length > 34 ? `${s.text.slice(0, 33)}…` : s.text}`,
    s.cue ? `${s.cue.level} ${s.cue.level_word}` : "",
    s.cue?.trend ?? "",
    s.cue?.density ?? "",
    s.cue ? s.cue.events.map((e) => `${e.type} ${clock(e.at_ms)}`).join(", ") : "",
    [s.cue?.contrast, s.cue?.vocal ? `vocal ${s.cue.vocal}` : null].filter(Boolean).join("; "),
  ]);
  const head = ["Time", "Section", "Line", "Level", "Trend", "Density", "Events", "Contrast / vocal"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((x, i) => x.padEnd(w[i])).join(" | ").trimEnd();
  return [`Stems: ${c.stems === "demucs" ? "Demucs (drums, bass, other, vocals)" : "frequency bands (Demucs not installed: pnpm audio:setup --ai for stems)"} · vocal for the contrast: ${c.vocals ? "yes" : "none"}`, fmt(head), w.map((n) => "-".repeat(n)).join("-|-"), ...rows.map(fmt)].join("\n");
}
