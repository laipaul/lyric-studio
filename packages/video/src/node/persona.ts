// Persona on character cards (26 Nov 2026): saving it (with a history), the per-song note, the persona request for
// claude.ai, and "Copy shot prompt" for a Storyboard clip or an accepted singing slot. The persona lives in card.json
// `persona`, OUTSIDE the versions: editable on a locked card (the lock protects the look, not the acting) and never read
// by a picture pack (characters/generate.ts uses only the views and the outfit). Copy only: nothing here changes a cut,
// the timing or a render.
import path from "node:path";

import { card as cardTable, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { actingDirection, cleanPersona, forSinging, isCloseUpPicture, LIPS_FIRST, personaRequest, personaShotPrompt, type Persona, type ShotPromptPerson } from "../persona";
const MOUTH_LIKE = /\b(mouth|lips?)\b.*\b(closed|barely|minimal)\b/i;
import { songsUsingCard } from "./card-versions";
import { cardRoot, currentVersion, getCard, listCards, readCardFile, usableVersion, writeCardFile } from "./characters/cards";
import { listLooks } from "./characters/looks";
import { editOf, readClipEdits, sameClip } from "./clip-edits";
import { singingView } from "./lipsync";
import { productionData, readProduction, timedLines, writeProduction, type CastCard } from "./production";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";
import { directionFor, readScript } from "./performance-script";
import { readStoryboard } from "./storyboard-read";
import { STORYBOARD_DIR } from "../storyboard-file";

export const PERSONA_HISTORY_MAX = 20;
export type PersonaHistoryEntry = { at: string; persona: Persona };
type WithPersona = { persona?: Persona; persona_edited_at?: string; persona_history?: PersonaHistoryEntry[] };

export function readPersona(ws: Workspace, id: string): { persona: Persona | null; editedAt: string | null; history: PersonaHistoryEntry[] } {
  const f = readCardFile(cardRoot(ws, getCard(ws, id))) as ReturnType<typeof readCardFile> & WithPersona;
  return { persona: f.persona ? cleanPersona(f.persona) : null, editedAt: f.persona_edited_at ?? null, history: f.persona_history ?? [] };
}

// Save the persona (also on a locked card). The text it replaces is kept in the history (the last 20, newest first).
export function setPersona(ws: Workspace, id: string, raw: unknown): Persona {
  const row = getCard(ws, id);
  if (row.kind !== "character") throw new Error("A persona is for characters.");
  const root = cardRoot(ws, row);
  const f = readCardFile(root) as ReturnType<typeof readCardFile> & WithPersona;
  const next = cleanPersona(raw);
  if (f.persona && JSON.stringify(cleanPersona(f.persona)) === JSON.stringify(next)) return next;
  if (f.persona) f.persona_history = [{ at: f.persona_edited_at ?? new Date().toISOString(), persona: cleanPersona(f.persona) }, ...(f.persona_history ?? [])].slice(0, PERSONA_HISTORY_MAX);
  f.persona = next;
  f.persona_edited_at = new Date().toISOString();
  writeCardFile(root, f);
  ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  return next;
}

// An earlier persona back (the current one goes into the history in its turn).
export function restorePersona(ws: Workspace, id: string, at: string): Persona {
  const h = readPersona(ws, id).history.find((x) => x.at === at);
  if (!h) throw new Error("That earlier persona is not in the history any more.");
  return setPersona(ws, id, h.persona);
}

// "Copy persona request": the character's identity, notes, looks and songs, the template and the rule.
export function personaRequestFor(ws: Workspace, id: string): string {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const f = readCardFile(root);
  const v = usableVersion(f) ?? currentVersion(f);
  return personaRequest({ name: row.name, identity: v.description ?? null, notes: f.notes ?? null, looks: listLooks(root, f).map((l) => l.name), songs: songsUsingCard(ws, id).map((s) => s.title) });
}

// The per-song note ("more playful in this song"): one line per cast character, in production.json; "" removes it.
export function setPersonaNote(ws: Workspace, projectId: string, cardId: string, text: unknown): string {
  const root = songPathsById(ws, projectId).root;
  const prod = readProduction(root);
  if (!prod.cast.includes(cardId)) throw new Error("This character is not in the song's cast.");
  const note = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const notes = { ...(prod.personaNotes ?? {}) };
  if (note) notes[cardId] = note;
  else delete notes[cardId];
  writeProduction(root, { ...prod, personaNotes: notes });
  return note;
}

// ---- Copy shot prompt ---------------------------------------------------------------------------------------------

type Place = { line: number; how: "anchor" | "plan" | "slot" } | null;

async function songContext(ws: Workspace, projectId: string) {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  const lines = (await timedLines(ws, projectId).catch(() => null)) ?? [];
  let sections: { line: number; lastLine: number; kind: string; name: string }[] = [];
  try {
    sections = songSections(ws, projectId).sections;
  } catch {
    sections = [];
  }
  const prod = readProduction(paths.root);
  const data = productionData(ws, projectId);
  return { title: p.title, paths, lines, sections, prod, cast: data.cast.filter((c): c is CastCard => !("missing" in c) || !c.missing) as CastCard[] };
}

function sectionOf(sections: { line: number; lastLine: number; kind: string; name: string }[], line: number) {
  const s = sections.find((x) => line >= x.line && line <= x.lastLine);
  if (!s) return null;
  const lastChorus = [...sections].reverse().find((x) => x.kind === "chorus");
  return { kind: s.kind, name: s.name, final: s.kind === "chorus" && lastChorus === s };
}

function peopleFor(ws: Workspace, ctx: Awaited<ReturnType<typeof songContext>>, ids: readonly string[]): ShotPromptPerson[] {
  const cards = listCards(ws);
  return ids.flatMap((id) => {
    const c = cards.find((x) => x.id === id);
    if (!c || c.kind !== "character") return [];
    const inCast = ctx.cast.find((x) => x.id === id);
    return [{ name: c.name, identity: inCast?.description ?? c.description, look: inCast?.lookName ?? null, outfit: inCast?.outfit ?? null, persona: readPersona(ws, id).persona, songNote: ctx.prod.personaNotes?.[id] ?? null }];
  });
}

// Who is in the shot: the clip's cast chips, else the song's one character (else: tag the clip first).
function whoIn(ctx: Awaited<ReturnType<typeof songContext>>, cast: readonly string[] | undefined): string[] {
  if (cast?.length) return [...cast];
  const characters = ctx.cast.filter((c) => c.kind === "character");
  if (characters.length === 1) return [characters[0].id];
  throw new Error(characters.length ? "Tag who is in this clip first (+ cast on the card): the song has more than one character." : "Add the character to this song's cast first (Prepare → Production → Cast), or tag the clip (+ cast).");
}

function lineAt(lines: { number: number; startMs: number | null; endMs: number | null }[], ms: number): number | null {
  const timed = lines.filter((l) => l.startMs !== null);
  const inside = timed.find((l) => ms >= l.startMs! && ms < (l.endMs ?? l.startMs!));
  if (inside) return inside.number;
  const before = [...timed].reverse().find((l) => l.startMs! <= ms);
  return before?.number ?? null;
}

// Where a Storyboard clip sits: the line it is pinned to (a story anchor), else its first moment in the saved Reels
// shot plan, else its accepted singing slot.
function placeOfClip(ctx: Awaited<ReturnType<typeof songContext>>, clip: string): Place {
  const anchors = ctx.paths.recipe ? (readRecipe(ctx.paths.recipe).anchors ?? []) : [];
  const a = anchors.filter((x) => sameClip(x.clip, clip)).sort((x, y) => x.line - y.line)[0];
  if (a) return { line: a.line, how: "anchor" };
  for (const platform of ["reels", "tiktok", "shorts", "youtube"]) {
    const sb = readStoryboard(path.join(ctx.paths.root, STORYBOARD_DIR, `${platform}-1.json`));
    const shot = sb?.shots.filter((s) => sameClip(s.clip, clip)).sort((x, y) => x.startMs - y.startMs)[0];
    if (shot) {
      const line = lineAt(ctx.lines, shot.startMs);
      if (line) return { line, how: "plan" };
    }
  }
  const mark = editOf(readClipEdits(ctx.paths.root), clip).lipsync;
  if (mark) return { line: mark.lines[0], how: "slot" };
  return null;
}

export async function clipShotPrompt(ws: Workspace, projectId: string, clip: string): Promise<{ text: string; place: Place }> {
  const ctx = await songContext(ws, projectId);
  const edit = editOf(readClipEdits(ctx.paths.root), clip);
  const people = peopleFor(ws, ctx, whoIn(ctx, edit?.cast));
  const place = placeOfClip(ctx, clip);
  const singing = !!edit?.lipsync || place?.how === "slot";
  const lyric = place ? (edit?.lipsync ? linesText(ctx.lines, edit.lipsync.lines) : (ctx.lines.find((l) => l.number === place.line)?.text ?? null)) : null;
  const script = place ? await scriptFor(ws, projectId, ctx.paths.root, place.line) : null;
  const text = personaShotPrompt({ people, section: place ? sectionOf(ctx.sections, place.line) : null, lyric, singing, song: ctx.title, script });
  return { text, place };
}

// The performance script's direction for a line (never a stale one) and the song's two lines (Part B).
async function scriptFor(ws: Workspace, projectId: string, root: string, line: number) {
  const s = readScript(root);
  if (!s) return null;
  const d = await directionFor(ws, projectId, line);
  return { ...d, singsTo: s.singsTo, objective: s.objective };
}

const linesText = (lines: { number: number; text: string }[], [a, b]: [number, number]) =>
  lines.filter((l) => l.number >= a && l.number <= b).map((l) => l.text).join(" / ") || null;

// An accepted singing slot: its lines, its section, the clip's cast (else the song's one character); always sung.
export async function slotShotPrompt(ws: Workspace, projectId: string, slotKey: string): Promise<{ text: string }> {
  const ctx = await songContext(ws, projectId);
  const view = await singingView(ws, projectId);
  const m = view.matches.find((x) => x.slot.key === slotKey);
  if (!m) throw new Error("That singing slot is not in this song any more: reload the page.");
  const edit = m.clip ? editOf(readClipEdits(ctx.paths.root), m.clip) : undefined;
  const people = peopleFor(ws, ctx, whoIn(ctx, edit?.cast));
  const script = await scriptFor(ws, projectId, ctx.paths.root, m.slot.lines[0]);
  const text = personaShotPrompt({ people, section: sectionOf(ctx.sections, m.slot.lines[0]), lyric: linesText(ctx.lines, m.slot.lines), singing: true, song: ctx.title, script });
  return { text };
}

// The acting direction of a Creation shot (Make with references, 26 Nov 2026): its people's personas and its line's
// direction (performance script; else the persona's section map). A shot without a line (music only) takes its
// section's line. source: what it came from, for the page.
export async function shotDirection(ws: Workspace, projectId: string, slotId: string): Promise<{ text: string; source: "script" | "section" | "none"; stale: string | null }> {
  const { productionView } = await import("./shot-production");
  const shot = productionView(ws, projectId).shots.find((s) => s.id === slotId);
  if (!shot) throw new Error("That shot is not in this song's shot list.");
  const ctx = await songContext(ws, projectId);
  const cards = listCards(ws);
  const people = shot.people.flatMap((w) => {
    const c = w.card ? cards.find((x) => x.id === w.card) : undefined;
    return c && c.kind === "character" ? [{ name: c.name, persona: readPersona(ws, c.id).persona, songNote: ctx.prod.personaNotes?.[c.id] ?? null }] : [];
  });
  let section = shot.line ? sectionOf(ctx.sections, shot.line) : null;
  if (!section && shot.section) {
    const s = ctx.sections.find((x) => x.name === shot.section);
    if (s) section = sectionOf(ctx.sections, s.line);
  }
  const script = shot.line ? await scriptFor(ws, projectId, ctx.paths.root, shot.line) : null;
  const lyric = shot.line ? (ctx.lines.find((l) => l.number === shot.line)?.text ?? null) : null;
  const text = actingDirection({ people, section, script, lyric });
  return { text, source: !text ? "none" : script?.entry ? "script" : "section", stale: script?.stale ?? null };
}

// The acting direction sent with a singing take (Lip-sync review, 26 Nov 2026): who sings (the picture's "Who is this",
// else the song's one character), their persona's singing (soft / high / held), gestures and Never, and the first
// line's performance-script direction (emotion, face, body) when it is fresh. Short: InfiniteTalk's prompt is small.
export async function singingDirection(ws: Workspace, projectId: string, source: string, first: number, last: number): Promise<string> {
  const { readPictures, songFolder } = await import("./animate");
  const ctx = await songContext(ws, projectId);
  const record = readPictures(songFolder(ws, projectId).dir).pictures[path.basename(source)];
  const who = record?.who;
  const closeUp = isCloseUpPicture(`${record?.label ?? ""} ${path.basename(source)}`);
  const characters = ctx.cast.filter((c) => c.kind === "character");
  const id = who ?? (characters.length === 1 ? characters[0].id : null);
  const card = id ? listCards(ws).find((c) => c.id === id && c.kind === "character") : undefined;
  if (!card) return "";
  const per = readPersona(ws, card.id).persona;
  const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).replace(/[\s,;]+\S*$/, "")}…` : s);
  // The lips first; then this line's expression (the script), before the persona's way of singing (its restraint must
  // not flatten a peak); nothing that limits the mouth; on a close-up, nothing about hands (out of frame).
  const sing1 = (s: string) => forSinging(s, closeUp);
  const parts: string[] = [LIPS_FIRST];
  const s = readScript(ctx.paths.root);
  if (s) {
    const d = await directionFor(ws, projectId, first);
    const e = d.entry;
    if (e) {
      const face = e.face ? sing1(e.face) : "";
      const body = e.body ? sing1(e.body) : "";
      parts.push([e.emotion && `Expression: ${e.emotion}${e.intensity ? ` (${e.intensity}/5)` : ""}${last > first ? ", growing over the lines" : ""}`, face && `Face: ${cut(face)}`, body && `Body: ${cut(body)}`].filter(Boolean).join(". "));
    }
  }
  if (per) {
    const sing = [per.sing.soft && sing1(per.sing.soft) && `soft lines: ${cut(sing1(per.sing.soft), 80)}`, per.sing.high && sing1(per.sing.high) && `high notes: ${cut(sing1(per.sing.high), 80)}`, per.sing.held && sing1(per.sing.held) && `held notes: ${cut(sing1(per.sing.held), 80)}`].filter(Boolean);
    if (sing.length) parts.push(`${card.name} sings like this: ${sing.join("; ")}`);
    const gestures = closeUp ? [] : per.gestures.filter((g) => !MOUTH_LIKE.test(g));
    if (gestures.length) parts.push(`Gestures: ${cut(gestures.join("; "))}`);
  }
  if (per?.never) parts.push(`Never: ${cut(per.never, 100)}`);
  return parts.filter(Boolean).join(". ");
}
