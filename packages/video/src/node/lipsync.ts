// Lip-sync readiness of a song (26 Nov 2026, Nextgen sprint step 2): its clips checked for lip sync (on demand, local,
// cached by each clip's content), the singing slots of a video with their suggested clips and the meter, Accept /
// Ignore / Split, and "Export performance excerpt" for an accepted slot. Suggestions only: an accepted slot is marked on
// its clip in clips.json ("lipsync", display only); nothing changes cutting, timing or rendering, nothing is generated.
//   .studio\lipsync.json   the checks: clip name → { sha256, check }
//   .studio\singing.json   the user's decisions besides Accept: ignored suggestions (slot → clips) and splits (lines)
//   performance\<song> · <slot> · line N <words>\   the excerpts (vocal.wav, mix.wav, slot.txt, slot.json)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ffmpegBin, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { judgeLipsync, type LipCheck, type LipMeasure } from "../lipsync-check";
import { matchSlots, singingMeter, singingSlots, singingTargetMs, type SlotLine, type SlotMatch } from "../singing-slots";
import type { FaceTool } from "./characters/face";
import { editOf, readClipEdits, writeClipEdits } from "./clip-edits";
import { timedLines } from "./production";
import { isWholeStory } from "./song-style";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";
import { voiceFor } from "./singer";

export const LIPSYNC_FILE = "lipsync.json";
export const SINGING_FILE = "singing.json";
export const PERFORMANCE_DIR = "performance";
export const HANDLE_MS = 1000; // the excerpts: 1 s before the sung line (the breath) and 1 s after (the note's release)
const CLIP_FILE = /\.(mp4|mov|m4v|webm)$/i;

type Checks = { clips: Record<string, { sha256: string; check: LipCheck; at: string }> };
type Decisions = { ignored: Record<string, string[]>; splits: number[] };

const studio = (root: string) => path.join(root, ".studio");
const readJson = <T>(file: string, empty: T): T => {
  try {
    return { ...empty, ...(JSON.parse(readFileSync(file, "utf8")) as T) };
  } catch {
    return empty;
  }
};
const writeJson = (file: string, v: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
};
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function songDirs(ws: Workspace, projectId: string): { root: string; clips: string } {
  const p = songPathsById(ws, projectId);
  if (p.legacy || !p.clips) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return { root: p.root, clips: p.clips };
}

export const readChecks = (root: string): Checks => readJson<Checks>(path.join(studio(root), LIPSYNC_FILE), { clips: {} });
export const readDecisions = (root: string): Decisions => readJson<Decisions>(path.join(studio(root), SINGING_FILE), { ignored: {}, splits: [] });

// "Check lip sync" (one clip, or every video clip of the song): measured by the face engine, judged here; a clip whose
// content did not change keeps its check (free, instant).
export async function checkLipsync(ws: Workspace, projectId: string, face: FaceTool, names: readonly string[] | null = null): Promise<Record<string, LipCheck>> {
  if (!face.lipsync) throw new Error("The face checks cannot measure videos yet: update the app (pnpm audio:setup --face).");
  const { root, clips } = songDirs(ws, projectId);
  const all = existsSync(clips) ? readdirSync(clips).filter((f) => CLIP_FILE.test(f)) : [];
  const want = names ? all.filter((f) => names.some((n) => n.toLowerCase() === f.toLowerCase())) : all;
  if (names && !want.length) throw new Error("That clip is not a video of this song.");
  const checks = readChecks(root);
  for (const name of want) {
    const file = path.join(clips, name);
    const hash = sha(file);
    if (checks.clips[name]?.sha256 === hash) continue;
    const m = (await face.lipsync(file)) as LipMeasure;
    checks.clips[name] = { sha256: hash, check: judgeLipsync(m), at: new Date().toISOString() };
    writeJson(path.join(studio(root), LIPSYNC_FILE), checks); // after each clip: a long "Check all" keeps what it did
  }
  return Object.fromEntries(want.map((n) => [n, checks.clips[n].check]));
}

export type SingingKind = "short" | "full";
export type SingingView = {
  kind: SingingKind; // the video the slots are for: a Reel (short) or the whole song (YouTube, Mini film)
  window: { fromMs: number; toMs: number };
  windowNote: string;
  matches: SlotMatch[];
  meter: ReturnType<typeof singingMeter>;
  linesShortMs: number; // the part has fewer sung lines than the target
  checks: Record<string, LipCheck>; // clip name → its check (the cards)
  timed: boolean;
};

// The singing slots of a video of this song, matched with its checked clips. `kind`: "full" (YouTube, a Mini film: the
// whole song, 1/3) or "short" (a Reel / TikTok / Short: about 90 s from just before the first chorus, 1/6).
export async function singingView(ws: Workspace, projectId: string, kind: SingingKind | null = null): Promise<SingingView> {
  const { root } = songDirs(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  const durationMs = p?.duration_ms ?? 0;
  const paths = songPathsById(ws, projectId);
  const film = isWholeStory(readRecipe(paths.recipe), false);
  const k: SingingKind = kind ?? (film ? "full" : "short");
  const timed = (await timedLines(ws, projectId).catch(() => null)) ?? [];
  const lines: SlotLine[] = timed.flatMap((l) => (l.startMs !== null && l.endMs !== null ? [{ number: l.number, text: l.text, startMs: l.startMs, endMs: l.endMs, isHook: l.isHook }] : []));
  let sections: { line: number; lastLine: number; kind: string; name: string }[] = [];
  try {
    sections = songSections(ws, projectId).sections;
  } catch {
    sections = [];
  }
  const firstChorus = sections.find((s) => /chorus/i.test(s.kind) && !/pre/i.test(s.kind))?.line ?? lines.find((l) => l.isHook)?.number;
  const chorusAt = lines.find((l) => l.number === firstChorus)?.startMs ?? lines[0]?.startMs ?? 0;
  const window =
    k === "full" || durationMs <= 90_000
      ? { fromMs: 0, toMs: durationMs }
      : { fromMs: Math.max(0, chorusAt - 4000), toMs: Math.min(durationMs, Math.max(0, chorusAt - 4000) + 90_000) };
  const windowNote = k === "full" ? "the whole song (YouTube, Mini film): 1/3 of it" : "a Reel of about 90 s from just before the first chorus (TikTok, Shorts the same share): 1/6 of it";
  const target = singingTargetMs(window.toMs - window.fromMs, k);
  const decisions = readDecisions(root);
  const r = singingSlots(lines, sections, window, target, { splits: decisions.splits });
  const checks = Object.fromEntries(Object.entries(readChecks(root).clips).map(([n, c]) => [n, c.check]));
  const edits = readClipEdits(root);
  const accepted: Record<string, string> = {};
  for (const [name, e] of Object.entries(edits.clips)) if (e.lipsync?.slot) accepted[e.lipsync.slot] = name;
  const clips = Object.keys(checks).map((name) => ({ name, label: editOf(edits, name).label ?? null, check: checks[name] }));
  const matches = matchSlots(r.slots, clips, lines, { accepted, ignored: decisions.ignored });
  return { kind: k, window, windowNote, matches, meter: singingMeter(matches, target), linesShortMs: r.linesShortMs, checks, timed: lines.length > 0 };
}

// Accept a suggestion: the clip is marked for singing that slot in clips.json (display only); another clip accepted for
// the same slot gives way. Unaccept (clip null) clears it.
export async function acceptSlot(ws: Workspace, projectId: string, slotKey: string, clip: string | null, kind: SingingKind | null = null): Promise<void> {
  const { root, clips } = songDirs(ws, projectId);
  const view = await singingView(ws, projectId, kind);
  const m = view.matches.find((x) => x.slot.key === slotKey);
  if (!m) throw new Error("That singing slot is not in this video any more: look again.");
  const edits = readClipEdits(root);
  for (const [n, e] of Object.entries(edits.clips)) if (e.lipsync?.slot === slotKey) {
    const { lipsync: _l, ...rest } = e;
    if (Object.keys(rest).length) edits.clips[n] = rest;
    else delete edits.clips[n];
  }
  if (clip) {
    if (!existsSync(path.join(clips, clip))) throw new Error(`No clip ${clip} in this song.`);
    const key = Object.keys(edits.clips).find((n) => n.toLowerCase() === clip.toLowerCase()) ?? clip;
    edits.clips[key] = { ...(edits.clips[key] ?? {}), lipsync: { slot: slotKey, lines: m.slot.lines, fromMs: m.slot.fromMs, toMs: m.slot.toMs } };
  }
  writeClipEdits(root, edits);
}

// Ignore a suggested clip for a slot (the next best is suggested), or bring it back.
export function ignoreSuggestion(ws: Workspace, projectId: string, slotKey: string, clip: string, ignore = true): void {
  const { root } = songDirs(ws, projectId);
  const d = readDecisions(root);
  const list = new Set(d.ignored[slotKey] ?? []);
  if (ignore) list.add(clip);
  else list.delete(clip);
  d.ignored[slotKey] = [...list];
  if (!d.ignored[slotKey].length) delete d.ignored[slotKey];
  writeJson(path.join(studio(root), SINGING_FILE), d);
}

// Split slots after this sung line (a slot never continues past it), or join again.
export function splitAfterLine(ws: Workspace, projectId: string, line: number, split = true): void {
  const { root } = songDirs(ws, projectId);
  const d = readDecisions(root);
  const s = new Set(d.splits);
  if (split) s.add(line);
  else s.delete(line);
  d.splits = [...s].sort((a, b) => a - b);
  writeJson(path.join(studio(root), SINGING_FILE), d);
}

// A Windows-safe folder name part: no <>:"/\|?* or control characters, no trailing dots or spaces, at most `max` long.
export function safePart(text: string, max: number): string {
  const clean = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const cut = clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, "") || clean.slice(0, max) : clean;
  return cut.replace(/[. ]+$/, "") || "untitled";
}

export type VocalSource = { kind: "suno" | "own" | "demucs" | "none"; label: string; file: string | null; offsetMs: number; speed: number };

// The vocal the excerpt is cut from: the song's vocal stem (its offset applied: a Suno stem, or the user's own vocal
// file), else the app's Demucs vocals (cache\stems\, made when the lyrics were timed), else none (only the mix).
export async function vocalSource(ws: Workspace, projectId: string): Promise<VocalSource> {
  const paths = songPathsById(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  // The stem as the singing clips use it (singer.ts voiceFor: its check's offset and speed; a rejected stem is not used).
  const voice = await voiceFor(ws, projectId).catch(() => ({ kind: "song" as const }));
  if (voice.kind === "stem") {
    const name = path.basename(voice.file);
    const suno = /suno/i.test(name) || /suno/i.test(path.basename(paths.audio ?? ""));
    return { kind: suno ? "suno" : "own", label: suno ? `Suno stem (${name})` : `your vocal file (${name})`, file: voice.file, offsetMs: voice.offsetMs, speed: voice.speed ?? 1 };
  }
  const stems = path.join(ws.dir, "cache", "stems");
  const demucs = p?.audio_hash && existsSync(stems) ? readdirSync(stems).find((f) => f.startsWith(`${p.audio_hash}-`) && f.endsWith("-vocals.wav")) : undefined;
  if (demucs) return { kind: "demucs", label: "Demucs (the vocals the app separated from the song)", file: path.join(stems, demucs), offsetMs: 0, speed: 1 };
  return { kind: "none", label: "none (no vocal stem yet: only the mix)", file: null, offsetMs: 0, speed: 1 };
}

// "Export performance excerpt" on an accepted slot: the vocal and the mix cut on its sung lines with 1 s handles, and
// slot.txt / slot.json with the lines, the times in the song, the duration and the vocal source. The song is only read.
export async function exportExcerpt(ws: Workspace, projectId: string, slotKey: string, kind: SingingKind | null = null): Promise<{ folder: string; files: string[] }> {
  const view = await singingView(ws, projectId, kind);
  const m = view.matches.find((x) => x.slot.key === slotKey && x.accepted);
  if (!m) throw new Error("Accept a clip for this singing slot first.");
  const paths = songPathsById(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
  if (!paths.audio || !existsSync(paths.audio)) throw new Error("This song has no song file.");
  const songMs = p.duration_ms ?? Number.MAX_SAFE_INTEGER;
  const fromMs = Math.max(0, m.slot.fromMs - HANDLE_MS);
  const toMs = Math.min(songMs, m.slot.toMs + HANDLE_MS);
  const timed = (await timedLines(ws, projectId)) ?? [];
  const sung = timed.filter((l) => l.number >= m.slot.lines[0] && l.number <= m.slot.lines[1]);
  const lineName = m.slot.lines[0] === m.slot.lines[1] ? `line ${m.slot.lines[0]}` : `lines ${m.slot.lines[0]}-${m.slot.lines[1]}`;
  const name = `${safePart(p.title, 40)} · ${safePart(m.slot.label.replace(" · ", " "), 24)} · ${lineName} ${safePart(sung[0]?.text ?? "", 32)}`;
  const folder = path.join(paths.root, PERFORMANCE_DIR, name);
  mkdirSync(folder, { recursive: true });
  const durS = ((toMs - fromMs) / 1000).toFixed(3);
  // The mix: the song itself, cut, never processed (a WAV keeps its own sample format; another song file is decoded).
  const wav = /\.wav$/i.test(paths.audio);
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", paths.audio, "-ss", (fromMs / 1000).toFixed(3), "-t", durS, ...(wav ? ["-c:a", "copy"] : ["-c:a", "pcm_s24le"]), path.join(folder, "mix.wav")], { windowsHide: true });
  const files = ["mix.wav"];
  const voice = await vocalSource(ws, projectId);
  if (voice.file) {
    // Song time → the stem's own time (its offset and, rarely, a speed difference the stem check found).
    const startS = Math.max(0, (voice.offsetMs + voice.speed * fromMs) / 1000);
    const len = (((toMs - fromMs) / 1000) * voice.speed).toFixed(3);
    const copy = voice.speed === 1 && /\.wav$/i.test(voice.file);
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", voice.file, "-ss", startS.toFixed(3), "-t", len, ...(voice.speed !== 1 ? ["-af", `atempo=${voice.speed}`] : []), ...(copy ? ["-c:a", "copy"] : ["-c:a", "pcm_s24le"]), path.join(folder, "vocal.wav")], { windowsHide: true });
    files.unshift("vocal.wav");
  }
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;
  const info = {
    song: p.title,
    artist: p.artist,
    slot: { key: m.slot.key, label: m.slot.label, lines: m.slot.lines, sungFromMs: m.slot.fromMs, sungToMs: m.slot.toMs },
    lyrics: sung.map((l) => ({ number: l.number, text: l.text, startMs: l.startMs, endMs: l.endMs })),
    excerpt: { fromMs, toMs, durationMs: toMs - fromMs, handleBeforeMs: m.slot.fromMs - fromMs, handleAfterMs: toMs - m.slot.toMs },
    clip: m.clip,
    vocal: { source: voice.kind, label: voice.label, file: voice.file ? path.basename(voice.file) : null, offsetMs: voice.offsetMs },
    // Lining a returned clip up with the song: its first frame belongs at excerpt.fromMs (song time).
    alignTo: "excerpt.fromMs",
    files,
  };
  writeFileSync(path.join(folder, "slot.json"), `${JSON.stringify(info, null, 2)}\n`);
  const txt = [
    `${p.title} · ${m.slot.label} · ${lineName}`,
    "",
    ...sung.map((l) => `Line ${l.number}: ${l.text}`),
    "",
    `Sung in the song: ${clock(m.slot.fromMs)} – ${clock(m.slot.toMs)} (${((m.slot.toMs - m.slot.fromMs) / 1000).toFixed(2)} s)`,
    `This excerpt: ${clock(fromMs)} – ${clock(toMs)} (${((toMs - fromMs) / 1000).toFixed(2)} s; ${((m.slot.fromMs - fromMs) / 1000).toFixed(2)} s before the first word, ${((toMs - m.slot.toMs) / 1000).toFixed(2)} s after the last)`,
    `Vocal: ${voice.label}`,
    `Clip: ${m.clip}`,
    "",
    "Give the same vocal.wav (or mix.wav) to every lip-sync tool, and play it when recording a driving performance.",
    "A returned clip starts at the excerpt's start: it lines up with the song at that time.",
  ].join("\r\n");
  writeFileSync(path.join(folder, "slot.txt"), `${txt}\r\n`);
  files.push("slot.txt", "slot.json");
  return { folder, files };
}
