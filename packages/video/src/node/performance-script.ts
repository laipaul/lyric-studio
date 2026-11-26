// Performance script per song (Part B, 26 Nov 2026; src/performance-script.ts). Stored in <song>\production\script.json.
// "Copy script request" (Whole song / Reel range / Singing slots only) puts the lines, the gaps, their music cues and
// the cast's personas on the clipboard for claude.ai; "Paste script" reads the answer back (a new paste replaces only
// the entries it brings; the file it replaces is kept in Replaced files); each entry is editable and can be marked
// checked. When the lyrics or the line timing change, the entries that no longer match are shown "stale" and are
// never applied to a shot. Copy only: no cut, timing or render change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { cleanPersona, personaBlock, personaIsEmpty } from "../persona";
import { parseScript, scriptRequest, staleness, type ScriptEntry, type ScriptFile, type ScriptScope, type ScriptSegment } from "../performance-script";
import { getCard, readCardFile, cardRoot } from "./characters/cards";
import { reelRange, singingView } from "./lipsync";
import { cueText, musicCues, songSegments, type Segment } from "./music-cues";
import { PRODUCTION_DIR, productionData, readProduction, timedLines, type CastCard } from "./production";
import { keepReplaced } from "./project-settings";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";

export const SCRIPT_FILE = "script.json";
const scriptPath = (root: string) => path.join(root, PRODUCTION_DIR, SCRIPT_FILE);

export function readScript(root: string): ScriptFile | null {
  try {
    const f = scriptPath(root);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ScriptFile) : null;
  } catch {
    return null;
  }
}

function writeScript(root: string, s: ScriptFile, keepOld: boolean): void {
  const f = scriptPath(root);
  if (keepOld && existsSync(f)) keepReplaced(root, f, true);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(s, null, 2)}\n`);
}

// The song's lines and gaps as they are now (timing from Lyrics Sync), without running the music analysis.
async function currentSegments(ws: Workspace, projectId: string): Promise<Segment[]> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  const lines = (await timedLines(ws, projectId).catch(() => null)) ?? [];
  let sections: { line: number; lastLine: number; kind: string; name: string }[] = [];
  try {
    sections = songSections(ws, projectId).sections;
  } catch {
    sections = [];
  }
  return songSegments(lines, sections, p?.duration_ms ?? 0);
}

function castFor(ws: Workspace, projectId: string): { name: string; persona: string | null; note: string | null }[] {
  const data = productionData(ws, projectId);
  const prod = readProduction(songPathsById(ws, projectId).root);
  return data.cast
    .filter((c): c is CastCard => !("missing" in c && c.missing) && (c as CastCard).kind === "character")
    .map((c) => {
      let persona: string | null = null;
      try {
        const raw = (readCardFile(cardRoot(ws, getCard(ws, c.id))) as { persona?: unknown }).persona;
        persona = raw && !personaIsEmpty(cleanPersona(raw)) ? personaBlock(c.name, cleanPersona(raw)) : null;
      } catch {
        persona = null;
      }
      return { name: c.name, persona, note: prod.personaNotes?.[c.id] ?? null };
    });
}

// The segments of a scope: the whole song, the part the Reel plays (its shot plan), or the singing slots' lines.
async function scopeSegments(ws: Workspace, projectId: string, scope: ScriptScope, all: Segment[]): Promise<Segment[]> {
  if (scope === "song") return all;
  const root = songPathsById(ws, projectId).root;
  if (scope === "reel") {
    const r = reelRange(root);
    if (!r) throw new Error("The Reel has no shot plan yet: make the Reel once (Make), or choose Whole song.");
    return all.filter((s) => s.endMs > r.startMs && s.startMs < r.endMs);
  }
  const view = await singingView(ws, projectId);
  const slots = view.matches.some((m) => m.accepted) ? view.matches.filter((m) => m.accepted) : view.matches;
  if (!slots.length) throw new Error("This song has no singing slots yet (Prepare → Storyboard → singing): choose Whole song.");
  return all.filter((s) => s.kind === "line" && slots.some((m) => s.number! >= m.slot.lines[0] && s.number! <= m.slot.lines[1]));
}

export async function scriptRequestFor(ws: Workspace, projectId: string, scope: ScriptScope): Promise<{ text: string; lines: number; gaps: number; stems: string }> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const cues = await musicCues(ws, projectId);
  const chosen = await scopeSegments(ws, projectId, scope, await currentSegments(ws, projectId));
  if (!chosen.some((s) => s.kind === "line")) throw new Error("No timed lyric lines in this part yet: time the lyrics first (Lyrics Sync).");
  const byKey = new Map(cues.segments.map((s) => [s.key, s] as const));
  const segments: ScriptSegment[] = chosen.map((s) => ({ ...s, cue: cueText(byKey.get(s.key)?.cue ?? null) }));
  const cast = castFor(ws, projectId);
  const text = scriptRequest({ title: p.title, artist: p.artist, scope, segments, cast });
  return { text, lines: segments.filter((s) => s.kind === "line").length, gaps: segments.filter((s) => s.kind === "gap").length, stems: cues.stems };
}

// Paste script: the entries are attached to the song's lines and gaps as they are now (their text and times are kept
// to notice later changes). Keys the song does not have are listed, never guessed.
export async function pasteScript(ws: Workspace, projectId: string, text: string): Promise<{ saved: number; unrecognised: string[] }> {
  const parsed = parseScript(String(text ?? ""));
  if (!parsed.entries.length) throw new Error("No lines found in the pasted text: paste Claude's whole answer (it starts with SCRIPT: and has blocks like L12 …).");
  const root = songPathsById(ws, projectId).root;
  const now = await currentSegments(ws, projectId);
  const unrecognised = [...parsed.unrecognised];
  const fresh: ScriptEntry[] = [];
  for (const e of parsed.entries) {
    const seg = now.find((s) => s.key === e.key);
    if (!seg) {
      unrecognised.push(`${e.key}: not a ${e.key.startsWith("G") ? "gap" : "line"} of this song now`);
      continue;
    }
    fresh.push({ ...e, kind: seg.kind, number: seg.number, basis: { text: seg.text, startMs: seg.startMs, endMs: seg.endMs }, checked: false });
  }
  const old = readScript(root);
  const keep = (old?.entries ?? []).filter((x) => !fresh.some((f) => f.key === x.key));
  const order = (k: string) => now.findIndex((s) => s.key === k);
  const entries = [...keep, ...fresh].sort((a, b) => order(a.key) - order(b.key));
  writeScript(root, { version: 1, pasted_at: new Date().toISOString(), singsTo: parsed.singsTo || old?.singsTo || "", objective: parsed.objective || old?.objective || "", entries, lastPaste: { at: new Date().toISOString(), unrecognised } }, !!old);
  return { saved: fresh.length, unrecognised };
}

const EDITABLE = ["singer", "meaning", "emotion", "intensity", "beatChange", "action", "laban", "face", "body", "camera", "pace", "reaction", "checked"] as const;

// One entry edited (or marked checked); "song" edits Sings to / Objective. An edit re-attaches a stale entry to the
// line as it is now only when Paul asks (refresh: true), after checking it.
export async function editScript(ws: Workspace, projectId: string, key: string, patch: Record<string, unknown>): Promise<void> {
  const root = songPathsById(ws, projectId).root;
  const s = readScript(root);
  if (!s) throw new Error("This song has no performance script yet.");
  if (key === "song") {
    if (typeof patch.singsTo === "string") s.singsTo = patch.singsTo.trim();
    if (typeof patch.objective === "string") s.objective = patch.objective.trim();
  } else {
    const e = s.entries.find((x) => x.key === key);
    if (!e) throw new Error("That line is not in the script.");
    for (const k of EDITABLE) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (k === "checked") e.checked = !!v;
      else if (k === "intensity") e.intensity = Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null;
      else if (k === "reaction") e.reaction = v && typeof v === "object" && typeof (v as { direction?: unknown }).direction === "string" && (v as { direction: string }).direction.trim() ? { who: String((v as { who?: unknown }).who ?? "").trim(), direction: (v as { direction: string }).direction.trim() } : null;
      else (e as Record<string, unknown>)[k] = String(v ?? "").trim();
    }
    if (patch.refresh === true) {
      const seg = (await currentSegments(ws, projectId)).find((x) => x.key === key);
      if (seg) e.basis = { text: seg.text, startMs: seg.startMs, endMs: seg.endMs };
    }
  }
  writeScript(root, s, false);
}

// Mark all checked (never a stale entry: it waits until Paul looks at it again) or untick all. Returns how many changed.
export async function setAllChecked(ws: Workspace, projectId: string, checked: boolean): Promise<number> {
  const root = songPathsById(ws, projectId).root;
  const s = readScript(root);
  if (!s) throw new Error("This song has no performance script yet.");
  const now = await currentSegments(ws, projectId);
  let n = 0;
  for (const e of s.entries) {
    if (checked && staleness(e, now)) continue;
    if (e.checked !== checked) {
      e.checked = checked;
      n++;
    }
  }
  writeScript(root, s, false);
  return n;
}

export type ScriptView = { script: ScriptFile | null; entries: (ScriptEntry & { stale: string | null; time: string; text: string; section: string | null })[]; segments: number };

export async function scriptView(ws: Workspace, projectId: string): Promise<ScriptView> {
  const root = songPathsById(ws, projectId).root;
  const s = readScript(root);
  const now = await currentSegments(ws, projectId);
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  return {
    script: s,
    segments: now.length,
    entries: (s?.entries ?? []).map((e) => {
      const seg = now.find((x) => x.key === e.key);
      return { ...e, stale: staleness(e, now), time: clock(seg?.startMs ?? e.basis.startMs), text: seg?.text ?? e.basis.text, section: seg?.section ?? null };
    }),
  };
}

// The script's entry for a line, only when it still matches the line (never a stale one).
export async function directionFor(ws: Workspace, projectId: string, line: number): Promise<{ entry: ScriptEntry | null; stale: string | null }> {
  const v = await scriptView(ws, projectId);
  const e = v.entries.find((x) => x.kind === "line" && x.number === line);
  if (!e) return { entry: null, stale: null };
  return e.stale ? { entry: null, stale: e.stale } : { entry: e, stale: null };
}
