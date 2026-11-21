// C2 Shot list import (18 Nov 2026, decided with Paul): Paul's shot list (a JSON file, his creative input) becomes
// planned slots in Prepare → Storyboard. A slot is a place in the story line for a still the app makes later (C3):
// what it shows, its characters and place (by card name), the shot type, the lyric line it belongs to, and optional
// outfit change, tag and animation model. The story notes stay separate and are never read.
//
// Stored in the song folder as shotlist.json (the slots as imported, normalised). In clips.json "order" each slot is
// "slot:<id>", at the place its "order" gives (1 = the first item of the story line). Make and Shape skip slots
// until they have a picture (C3), so the videos do not change. A re-import updates slots by id, adds new ones and
// takes out the ones no longer in the file; the previous shotlist.json goes to .studio\replaced\ (with a Restore).
// No rendering code is imported here, so the studio's server can use it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { listCards } from "./characters/cards";
import { folderClips, songClipsCollection } from "./assets";
import { inClipOrder, readClipEdits, withSongOrder, writeClipEdits } from "./clip-edits";
import { keepReplaced } from "./project-settings";
import { songPathsById } from "./song-folder";
import { songText } from "./textboard";

export const SHOT_TYPES = ["close-up", "medium", "wide", "detail", "motion"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];
// The animation model a slot gets when the shot list names none (used by C5; Paul can name another per slot).
export const ANIMATE_DEFAULTS: Record<ShotType, string> = { "close-up": "omnihuman", medium: "kling", wide: "kling", detail: "kling", motion: "kling" };

export type Slot = {
  id: string;
  order: number;
  shows: string;
  characters: string[]; // character card names, as the cards spell them
  scene: string | null; // a scene card name
  shot: ShotType;
  line: number | null; // the Lyrics tab's line number
  outfit?: string; // a change for this slot only (else the card's locked outfit)
  tag?: string;
  animate?: string; // given in the file; else ANIMATE_DEFAULTS[shot]
};
export type ShotListFile = { _help?: string; imported_at: string; source: string; slots: Slot[] };
export type Problem = { slot: string | null; level: "error" | "warn"; text: string };
export type ShotListCheck = {
  slots: Slot[];
  problems: Problem[];
  ok: boolean; // no errors: it can be imported
  changes: { added: string[]; updated: string[]; removed: string[]; unchanged: string[] };
};

export const SHOTLIST_FILE = "shotlist.json";
export const SLOT_PREFIX = "slot:";
export const slotKey = (id: string) => `${SLOT_PREFIX}${id}`;
export const slotOf = (entry: string): string | null => (entry.startsWith(SLOT_PREFIX) ? entry.slice(SLOT_PREFIX.length) : null);
export const animateFor = (s: Pick<Slot, "animate" | "shot">) => s.animate ?? ANIMATE_DEFAULTS[s.shot];

const HELP =
  "Planned slots of this song (Prepare → Storyboard → Import shot list). Written by the import: change your own shot list file and import it again. " +
  '"slot:<id>" in clips.json "order" is each slot\'s place in the story line. Slots are skipped by Make until they have a picture (C3).';
const FIELDS = ["id", "order", "shows", "characters", "scene", "shot", "line", "outfit", "tag", "animate"];
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function distance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length];
}
// "did you mean …": the closest name when it is close enough, or one that contains the other.
export function closest(name: string, names: readonly string[]): string | null {
  let best: { n: string; d: number } | null = null;
  for (const n of names) {
    const d = n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase()) ? 1 : distance(name, n);
    if (!best || d < best.d) best = { n, d };
  }
  return best && best.d <= Math.max(2, Math.floor(name.length / 3)) ? best.n : null;
}

export type CheckContext = {
  cards: { name: string; kind: "character" | "scene"; status: string }[];
  lines: { number: number; text: string }[];
  previous: Slot[];
};

// Reads a shot list (text or parsed JSON) and says, slot by slot and in plain words, what is wrong (errors: it cannot
// be imported) or worth knowing (warnings). Names are matched without regard to capitals and saved as the card spells them.
export function checkShotList(input: unknown, ctx: CheckContext): ShotListCheck {
  const problems: Problem[] = [];
  const err = (slot: string | null, text: string) => problems.push({ slot, level: "error", text });
  const warn = (slot: string | null, text: string) => problems.push({ slot, level: "warn", text });
  const empty = { added: [], updated: [], removed: [], unchanged: [] };
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input.replace(/^﻿/, ""));
    } catch (e) {
      err(null, `The file is not valid JSON (${(e as Error).message}). Check for a missing comma or quote.`);
      return { slots: [], problems, ok: false, changes: empty };
    }
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { slots?: unknown }).slots : undefined;
  if (!Array.isArray(list)) {
    err(null, 'The file needs a list of slots: { "slots": [ { "id": "s01", … }, … ] }.');
    return { slots: [], problems, ok: false, changes: empty };
  }
  if (!list.length) err(null, "The shot list has no slots.");
  const characters = ctx.cards.filter((c) => c.kind === "character");
  const scenes = ctx.cards.filter((c) => c.kind === "scene");
  const card = (slot: string, name: string, pool: typeof characters, what: string): string | null => {
    const found = pool.find((c) => same(c.name, name));
    if (!found) {
      const near = closest(name, pool.map((c) => c.name));
      err(slot, `no ${what} called "${name}"${near ? ` (did you mean ${near}?)` : pool.length ? ` (yours: ${pool.map((c) => c.name).join(", ")})` : ` (make it on the Characters page first)`}.`);
      return null;
    }
    if (found.status !== "locked") warn(slot, `the ${what} "${found.name}" is not locked yet: lock it before the pictures are made (C3).`);
    return found.name;
  };
  const slots: Slot[] = [];
  const seen = new Set<string>();
  list.forEach((item, k) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      err(`#${k + 1}`, "each slot must be an object: { \"id\": \"s01\", \"shows\": \"…\", … }.");
      return;
    }
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" || typeof r.id === "number" ? String(r.id).trim() : "";
    const label = id || `#${k + 1}`;
    if (!id) err(label, 'give the slot an "id" (e.g. "s01"), so an edited shot list updates the right slot.');
    else if (!/^[\w-]{1,40}$/.test(id)) err(label, 'the "id" may only hold letters, digits, - and _ (at most 40).');
    else if (seen.has(id.toLowerCase())) err(label, `the id "${id}" is used twice.`);
    seen.add(id.toLowerCase());
    for (const key of Object.keys(r)) if (!FIELDS.includes(key)) warn(label, `"${key}" is not a shot list field and is left out (fields: ${FIELDS.join(", ")}).`);
    let order = k + 1;
    if (r.order !== undefined) {
      if (typeof r.order === "number" && Number.isFinite(r.order) && r.order >= 1) order = r.order;
      else err(label, '"order" must be a number from 1 (its place in the story line).');
    }
    const shows = typeof r.shows === "string" ? r.shows.trim() : "";
    if (!shows) err(label, 'say in one sentence what the slot shows ("shows"): the pictures are made from it.');
    let shot: ShotType = "medium";
    if (r.shot === undefined) err(label, `give the shot type ("shot": ${SHOT_TYPES.join(", ")}).`);
    else if (typeof r.shot === "string" && SHOT_TYPES.includes(r.shot.trim().toLowerCase().replace(/\s+/g, "-").replace(/^closeup$/, "close-up") as ShotType))
      shot = r.shot.trim().toLowerCase().replace(/\s+/g, "-").replace(/^closeup$/, "close-up") as ShotType;
    else err(label, `"shot" must be one of ${SHOT_TYPES.join(", ")} (not "${String(r.shot)}").`);
    const names = r.characters === undefined ? [] : typeof r.characters === "string" ? [r.characters] : r.characters;
    const chars: string[] = [];
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) err(label, '"characters" must be a list of character names, e.g. ["Bride No 2"].');
    else for (const n of names as string[]) if (n.trim()) {
      const c = card(label, n.trim(), characters, "character");
      if (c && !chars.includes(c)) chars.push(c);
    }
    let scene: string | null = null;
    if (r.scene !== undefined && r.scene !== null && r.scene !== "") {
      if (typeof r.scene !== "string") err(label, '"scene" must be the name of a scene card.');
      else scene = card(label, r.scene.trim(), scenes, "scene card");
    }
    if (!chars.length && !scene && !problems.some((p) => p.slot === label && p.level === "error")) warn(label, "no character and no scene card: nothing will keep this picture consistent with the others.");
    let line: number | null = null;
    if (r.line !== undefined && r.line !== null) {
      if (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 1) err(label, '"line" must be a line number as in the Lyrics tab (1, 2, …).');
      else if (!ctx.lines.length) {
        line = r.line;
        warn(label, `line ${r.line}: the song has no lyrics yet, so the line cannot be checked.`);
      } else if (r.line > ctx.lines.length) err(label, `there is no line ${r.line} (the lyrics have ${ctx.lines.length} lines).`);
      else line = r.line;
    }
    const text = (key: "outfit" | "tag" | "animate") => {
      if (r[key] === undefined || r[key] === null || r[key] === "") return undefined;
      if (typeof r[key] !== "string") {
        err(label, `"${key}" must be text.`);
        return undefined;
      }
      return (r[key] as string).trim() || undefined;
    };
    const outfit = text("outfit");
    const tag = text("tag");
    const animate = text("animate")?.toLowerCase();
    if (outfit && !chars.length) warn(label, '"outfit" is for a character, but the slot has none: it is kept but not used.');
    slots.push({ id: id || `#${k + 1}`, order, shows, characters: chars, scene, shot, line, ...(outfit ? { outfit } : {}), ...(tag ? { tag } : {}), ...(animate ? { animate } : {}) });
  });
  slots.sort((a, b) => a.order - b.order);
  const lineTwice = new Map<number, string[]>();
  for (const s of slots) if (s.line !== null) lineTwice.set(s.line, [...(lineTwice.get(s.line) ?? []), s.id]);
  for (const [line, ids] of lineTwice) if (ids.length > 1) warn(ids[1], `line ${line} also belongs to ${ids.filter((x, i) => i !== 1).join(", ")}: only one picture can start on a line.`);
  const prev = new Map(ctx.previous.map((s) => [s.id.toLowerCase(), s]));
  const changes = { added: [] as string[], updated: [] as string[], removed: [] as string[], unchanged: [] as string[] };
  for (const s of slots) {
    const p = prev.get(s.id.toLowerCase());
    if (!p) changes.added.push(s.id);
    else if (JSON.stringify(p) === JSON.stringify(s)) changes.unchanged.push(s.id);
    else changes.updated.push(s.id);
  }
  for (const p of ctx.previous) if (!slots.some((s) => same(s.id, p.id))) changes.removed.push(p.id);
  return { slots, problems, ok: !problems.some((p) => p.level === "error"), changes };
}

function songRoot(ws: Workspace, projectId: string): string {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return paths.root;
}

export function readShotListFile(file: string): ShotListFile | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as ShotListFile;
    return Array.isArray(raw.slots) ? raw : null;
  } catch {
    return null;
  }
}
export const readShotList = (ws: Workspace, projectId: string): ShotListFile | null => readShotListFile(path.join(songRoot(ws, projectId), SHOTLIST_FILE));

function context(ws: Workspace, projectId: string): CheckContext {
  return {
    cards: listCards(ws).map((c) => ({ name: c.name, kind: c.kind, status: c.status })),
    lines: songText(ws, projectId).lines.map((l) => ({ number: l.number, text: l.text })),
    previous: readShotList(ws, projectId)?.slots ?? [],
  };
}

export const checkSongShotList = (ws: Workspace, projectId: string, input: unknown): ShotListCheck => checkShotList(input, context(ws, projectId));

// The story order with the slots at their places: every slot key out, then each slot (by "order") at position
// order-1 of the line (the first is 1); a place past the end is the end.
export function placeSlots(order: readonly string[], slots: readonly Slot[]): string[] {
  const next = order.filter((e) => slotOf(e) === null);
  for (const s of [...slots].sort((a, b) => a.order - b.order)) next.splice(Math.min(Math.max(0, Math.round(s.order) - 1), next.length), 0, slotKey(s.id));
  return next;
}

// Imports a checked shot list: shotlist.json (the previous one kept in Replaced files) and the slots' places in
// clips.json "order". Refused while the check finds errors.
export async function importShotList(ws: Workspace, projectId: string, input: unknown, source = "shot list"): Promise<ShotListCheck> {
  const check = checkSongShotList(ws, projectId, input);
  if (!check.ok) throw new Error(`The shot list cannot be imported yet: ${check.problems.filter((p) => p.level === "error").map((p) => (p.slot ? `${p.slot}: ${p.text}` : p.text)).join(" ")}`);
  const root = songRoot(ws, projectId);
  const file = path.join(root, SHOTLIST_FILE);
  if (existsSync(file)) keepReplaced(root, file);
  const out: ShotListFile = { _help: HELP, imported_at: new Date().toISOString(), source: path.win32.basename(source), slots: check.slots };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  // Every own clip gets its place in the order first (clips never moved follow in file-name order), so "order"
  // counts the story line as it is shown.
  const clipsDir = songPathsById(ws, projectId).clips;
  const own = clipsDir && existsSync(clipsDir) ? (await folderClips(ws, clipsDir, songClipsCollection(projectId))).clips.map((c) => c.name) : [];
  let edits = readClipEdits(root);
  edits = withSongOrder(edits, own, inClipOrder(edits, own));
  writeClipEdits(root, { ...edits, order: placeSlots(edits.order, check.slots) });
  return check;
}

// Remove planned slots (Paul, 21 Nov 2026: "why can't I remove 2 and 6 from my Storyboard"): the slots leave the story
// line; shotlist.json is kept in Replaced files first (Restore brings every slot back) and written again with the
// slots that stay (none left: no shot list). `ids` null: every slot. Returns how many were removed.
export function removeSlots(ws: Workspace, projectId: string, ids: readonly string[] | null): number {
  const root = songRoot(ws, projectId);
  const file = path.join(root, SHOTLIST_FILE);
  const current = readShotListFile(file);
  const edits = readClipEdits(root);
  const inOrder = edits.order.map(slotOf).filter((x): x is string => x !== null);
  const gone = new Set(ids ?? [...(current?.slots ?? []).map((s) => s.id), ...inOrder]);
  if (ids && ids.some((id) => !(current?.slots ?? []).some((s) => s.id === id) && !inOrder.includes(id))) throw new Error("That planned slot is not in this song's Storyboard.");
  const removed = new Set([...(current?.slots ?? []).map((s) => s.id), ...inOrder].filter((id) => gone.has(id)));
  if (!removed.size) return 0;
  if (existsSync(file)) {
    keepReplaced(root, file);
    const left = (current?.slots ?? []).filter((s) => !gone.has(s.id));
    if (left.length) writeFileSync(file, `${JSON.stringify({ ...current, slots: left }, null, 2)}\n`);
  }
  writeClipEdits(root, { ...edits, order: edits.order.filter((e) => { const id = slotOf(e); return id === null || !gone.has(id); }) });
  return removed.size;
}

// Restore of a kept shotlist.json (Assets → Replaced files): imported again as it was.
export async function restoreShotList(ws: Workspace, projectId: string, keptFile: string): Promise<ShotListCheck> {
  const kept = readShotListFile(keptFile);
  if (!kept) throw new Error("That shot list file cannot be read.");
  return importShotList(ws, projectId, { slots: kept.slots }, kept.source ?? "shot list");
}

export function changesText(c: ShotListCheck["changes"]): string {
  const part = (n: number, what: string) => (n ? `${n} ${what}` : "");
  return [part(c.added.length, "new"), part(c.updated.length, "changed"), part(c.removed.length, "taken out"), part(c.unchanged.length, "unchanged")].filter(Boolean).join(", ") || "nothing";
}
