// Which vocal track everything that listens to the voice uses (pnpm align, the voice map, first_words,
// the vocal-start check, QA "Lines start with the vocals"): the vocal stem (any name, linked in the song
// folder's .studio\files.json; else vocals.wav), lined up on the song, when it is there and follows the song; else the vocals the app
// separates itself (Demucs), the fallback. The stem is checked once per song and stem content by
// services/audio vocal_stem (cross-correlation at several points along the song; analysis only), and the
// result is kept in the song's .studio\lyrics\stem-check-<song>-<stem>.json.
// Neither the song nor the stem is ever written: they are only read. backing-vocals.wav is never used here.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { cachedFileHash } from "./collection";
import { songPaths } from "./song-folder";
import { runAudioScript } from "./audio-script";
import type { SongProject } from "./song-project";

export type VoiceSource = {
  kind: "stem" | "demucs";
  label: string; // "vocal stem, offset 1.8 s" | "separated by the app"
  stemFile?: string; // the stem (kind "stem")
  stemHash?: string;
  offsetMs?: number; // stem time = song time + offset
  message?: string; // the check's words for the user (lined up, or why the stem is not used)
};

export const DEMUCS: VoiceSource = { kind: "demucs", label: "separated by the app" };

// What services/audio vocal_stem writes (--out).
export type StemCheck = {
  status: "lined-up" | "rejected";
  offset_ms: number | null;
  message: string;
  reason: string;
  stem_hash: string;
  song_hash: string;
  covered_s?: number | null;
  strength?: number | null;
  points?: { at_s: number; offset_s: number | null; strength: number }[];
};

export type StemCheckRunner = (args: { song: string; stem: string; out: string }) => Promise<void>;
export const runStemCheckCommand: StemCheckRunner = (a) => runAudioScript("vocal-stem.mjs", [a.song, "--stem", a.stem, "--out", a.out, "--line-up"]);

export const offsetText = (ms: number) => `${(Math.abs(ms) / 1000).toFixed(1)} s`;

export function stemCheckFile(storeDir: string, songHash: string, stemHash: string): string {
  return path.join(storeDir, `stem-check-${songHash.slice(0, 12)}-${stemHash.slice(0, 12)}.json`);
}

// The key part that tells alignments, voice maps and recognised words of the stem apart ("" for Demucs,
// so everything stored before the stem existed keeps its name).
export function voiceKey(v: VoiceSource): string {
  return v.kind === "stem" ? `stem-${v.stemHash!.slice(0, 12)}-${v.offsetMs}ms` : "";
}

// What the audio scripts get: the stem file, or "none" (Demucs; also when the stem does not follow the song).
export const stemArgument = (v: VoiceSource) => (v.kind === "stem" ? v.stemFile! : "none");

export function sourceFromCheck(check: StemCheck, stemFile: string): VoiceSource {
  if (check.status === "lined-up" && check.offset_ms !== null) {
    return { kind: "stem", label: `vocal stem, offset ${offsetText(check.offset_ms)}`, stemFile, stemHash: check.stem_hash, offsetMs: check.offset_ms, message: check.message };
  }
  return { ...DEMUCS, label: "separated by the app (the vocal stem doesn't follow the song)", stemHash: check.stem_hash, message: check.message };
}

// The stored check of this song and stem, or null when it has not run yet (never runs anything).
export async function storedStemCheck(ws: Workspace, sp: Pick<SongProject, "project" | "songHash">): Promise<{ check: StemCheck; file: string } | null> {
  const paths = songPaths(ws, sp.project);
  if (!paths.vocals || !existsSync(paths.vocals)) return null;
  const file = stemCheckFile(paths.store, sp.songHash, await cachedFileHash(ws, paths.vocals));
  if (!existsSync(file)) return null;
  try {
    return { check: JSON.parse(readFileSync(file, "utf8")) as StemCheck, file };
  } catch {
    return null;
  }
}

// Checks a stem file against the song (once per song and stem content; the result is kept in the song's
// .studio\lyrics). null: not checked (LYRIC_VOICE_MAP=off without a runner: the tests).
export async function checkStemFile(
  ws: Workspace,
  storeDir: string,
  song: { file: string; hash: string },
  stem: string,
  options: { log?: (m: string) => void; check?: StemCheckRunner } = {},
): Promise<{ check: StemCheck } | { error: string } | null> {
  const log = options.log ?? (() => {});
  const file = stemCheckFile(storeDir, song.hash, await cachedFileHash(ws, stem));
  if (!existsSync(file)) {
    if (!options.check && process.env.LYRIC_VOICE_MAP === "off") return null; // the tests
    log(`lyrics: checking the vocal stem ${path.basename(stem)} against the song (analysis only; once per stem)`);
    const tmp = `${file}.${process.pid}.part`;
    try {
      mkdirSync(storeDir, { recursive: true });
      await (options.check ?? runStemCheckCommand)({ song: song.file, stem, out: tmp });
      renameSync(tmp, file);
    } catch (error) {
      rmSync(tmp, { force: true });
      return { error: (error as Error).message.split("\n").pop() ?? "" };
    }
  }
  return { check: JSON.parse(readFileSync(file, "utf8")) as StemCheck };
}

// The voice source of a song: checks the vocal stem (any name, linked in .studio\files.json; else
// vocals.wav) against the song the first time (a few seconds; cached).
// options.check: runs the check (the tests); without it, and with LYRIC_VOICE_MAP=off (the tests), an
// unchecked stem counts as not there.
export async function resolveVoiceSource(
  ws: Workspace,
  sp: Pick<SongProject, "project" | "songHash" | "songFile">,
  options: { log?: (m: string) => void; check?: StemCheckRunner } = {},
): Promise<VoiceSource> {
  const log = options.log ?? (() => {});
  const paths = songPaths(ws, sp.project);
  if (!paths.vocals || !existsSync(paths.vocals)) return DEMUCS;
  const result = await checkStemFile(ws, paths.store, { file: sp.songFile, hash: sp.songHash }, paths.vocals, options);
  if (!result) return DEMUCS;
  if ("error" in result) {
    log(`lyrics: the vocal stem could not be checked (${result.error}); the app separates the vocals itself`);
    return { ...DEMUCS, message: `The vocal stem could not be checked (${result.error}).` };
  }
  return sourceFromCheck(result.check, paths.vocals);
}

// The line pnpm make and the run log print.
export function voiceLine(v: VoiceSource): string {
  if (v.kind === "stem") return `lyrics: voice: ${v.label} (${path.basename(v.stemFile ?? "vocals.wav")}). ${v.message ?? ""}`.trim();
  return `lyrics: voice: ${v.label}${v.message ? `. ${v.message}` : ""}`;
}

// What the manifest keeps (no paths: the stem never goes into any output).
export type VoiceRecord = { kind: "stem" | "demucs"; label: string; offset_ms?: number; stem_sha256?: string; message?: string };
export function voiceRecord(v: VoiceSource): VoiceRecord {
  return { kind: v.kind, label: v.label, ...(v.offsetMs !== undefined ? { offset_ms: v.offsetMs } : {}), ...(v.stemHash ? { stem_sha256: v.stemHash } : {}), ...(v.message ? { message: v.message } : {}) };
}
