// Lyric timing on its own, without making videos: the alignment (stored, or made now on the song's voice
// source: Suno's vocal stem when it follows the song, else Demucs), the hand-set starts (hints.lrc) and
// the vocal-start check, saved for the studio's screens. The studio queues it as a run when vocals.wav is
// added or replaced (Assets tab), so the Lyrics tab and the next videos use the stem at once. Stored hints
// and hand-set starts are kept, as on every alignment. pnpm lyrics:compare-voice uses it for both sources.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, lyricLine as lyricLineTable, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { loadBrand } from "./brand";
import { loadFontCatalog } from "./font-catalog";
import { songPathsById } from "./song-folder";
import { recognizeSongFiles } from "./song-files";
import { applyHandSet, applyVocalGuard, ensureAlignment, matchReport, type Alignment, type AlignRunner, type FirstWordsRunner, type SongProject, type VoiceMapRunner } from "./song-project";
import { resolveVoiceSource, type StemCheckRunner, type VoiceSource } from "./voice-source";

export type LyricTiming = {
  alignment: Alignment; // after the hand-set starts and the vocal-start check
  voice: VoiceSource;
  flagged: number[]; // line numbers flagged for review
  lowConfidence: number[]; // line numbers below the aligner's confidence threshold
  moved: { number: number; from_ms: number; to_ms: number }[]; // moved by the vocal-start check
  summary: string; // one line for the Tasks menu and the log
};

export type LyricTimingOptions = {
  log?: (m: string) => void;
  voice?: VoiceSource; // default: the song's voice source
  realign?: boolean;
  save?: boolean; // store the lines for the studio's screens (default true)
  align?: AlignRunner;
  voiceMap?: VoiceMapRunner;
  firstWords?: FirstWordsRunner;
  stemCheck?: StemCheckRunner;
  now?: Date;
};

// The language the song was aligned in before (its newest stored alignment), else English.
export function storedLanguage(storeDir: string): string {
  if (!existsSync(storeDir)) return "en";
  const reports = readdirSync(storeDir)
    .filter((f) => /^aligned-.*\.report\.json$/.test(f))
    .sort((a, b) => statSync(path.join(storeDir, b)).mtimeMs - statSync(path.join(storeDir, a)).mtimeMs);
  for (const f of reports) {
    try {
      const lang = (JSON.parse(readFileSync(path.join(storeDir, f), "utf8")) as { lang?: string }).lang;
      if (lang) return lang;
    } catch {
      // unreadable: the next one
    }
  }
  return "en";
}

export function songProjectById(ws: Workspace, projectId: string): SongProject {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  if (!p.audio_path || !p.audio_hash || !existsSync(absPath(ws, p.audio_path))) throw new Error(`The song file of "${p.title}" is missing from the workspace.`);
  return { project: p, songFile: absPath(ws, p.audio_path), songHash: p.audio_hash, created: false };
}

export async function timeLyrics(ws: Workspace, projectId: string, options: LyricTimingOptions = {}): Promise<LyricTiming> {
  const log = options.log ?? (() => {});
  // Files put into the song folder by hand (any names) are found first.
  if (!options.voice) await recognizeSongFiles(ws, projectId, { check: options.stemCheck, queue: false, log });
  const sp = songProjectById(ws, projectId);
  const paths = songPathsById(ws, projectId);
  if (paths.instrumental) throw new Error(`"${sp.project.title}" is an instrumental: nothing is sung, so there is no lyric timing.`);
  if (!existsSync(paths.lyricsTxt)) throw new Error(`"${sp.project.title}" has no lyrics yet.`);
  const hints = paths.hints && existsSync(paths.hints) ? paths.hints : undefined;
  const voice = options.voice ?? (await resolveVoiceSource(ws, sp, { log, check: options.stemCheck }));
  const stored = await ensureAlignment(ws, sp, {
    lyricsTxt: paths.lyricsTxt,
    hint: hints,
    lang: storedLanguage(paths.store),
    durationMs: sp.project.duration_ms ?? 600_000,
    realign: options.realign,
    log,
    align: options.align,
    voice,
    now: options.now,
  });
  const brand = loadBrand(ws.dir, loadFontCatalog(ws.dir), sp.project.artist).brand;
  const hand = applyHandSet(stored, hints, log);
  const alignment = await applyVocalGuard(ws, sp, hand.alignment, {
    log,
    skip: hand.skip,
    voiceMap: options.voiceMap,
    firstWords: options.firstWords,
    reviewMs: Math.round(brand.motion.gapLeadInS * 1000),
  });
  if (options.save !== false) saveLines(ws, projectId, alignment);
  const reports = matchReport(alignment.lines, alignment.report);
  const flagged = (alignment.guard?.check.lines ?? []).filter((c) => c.result === "flagged for review" && !hand.skip.has(c.number - 1)).map((c) => c.number);
  const lowConfidence = reports.flatMap((r, i) => (r && r.confidence < (alignment.report?.low_confidence ?? 0.5) ? [i + 1] : []));
  const moved = (alignment.guard?.moves ?? []).map((m) => ({ number: m.number, from_ms: m.from_ms, to_ms: m.to_ms }));
  const count = (n: number, what: string) => `${n} line${n === 1 ? "" : "s"} ${what}`;
  const summary = `Lyric timing on the ${voice.kind === "stem" ? voice.label : "vocals separated by the app"}: ${count(flagged.length, "to review")} · ${count(lowConfidence.length, "low confidence")} · ${count(moved.length, "moved to the vocals")}`;
  log(summary);
  return { alignment, voice, flagged, lowConfidence, moved, summary };
}

// The project's lyric lines (a copy of the timed lines, for the studio screens), as pnpm make stores them.
export function saveLines(ws: Workspace, projectId: string, alignment: Alignment): void {
  ws.db.transaction((tx) => {
    tx.delete(lyricLineTable).where(eq(lyricLineTable.project_id, projectId)).run();
    alignment.lines.forEach((l, index) => {
      const words = l.words?.map((w, k) => ({ text: w.text, start_ms: w.start_ms, end_ms: l.words![k + 1]?.start_ms ?? l.end_ms }));
      tx.insert(lyricLineTable).values({ project_id: projectId, index, text: l.text, start_ms: l.start_ms, end_ms: l.end_ms, is_hook: l.isHook, words_json: words ?? null }).run();
    });
  });
}
