// The Characters library (26 Nov 2026, Nextgen sprint step 1, Cast Library): the user's characters live across every
// song (workspace\characters\<name>\card.json + pictures, linked from songs by their card id). Here: the card's own
// notes (look, outfit, vibe, age range: the user's words, never sent to a model by themselves), the cast tags' list
// (removed cards too: Remove card / Restore are cleanup.ts's) and the "Copy character for Claude" block (no API call).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { card as cardTable, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { cardRoot, currentVersion, getCard, readCardFile, usableVersion, versionDir, type CardFile } from "./cards";
import { listRemovedCards } from "./cleanup";
import { readShotListFile, SHOTLIST_FILE } from "../shotlist";
import { songPathsById } from "../song-folder";
import { describesClothes, OUTFIT_FACE_WARNING, sortCardText } from "../../card-text";
import { cleanPersona, personaBlock, personaIsEmpty } from "../../persona";
import { listLooks } from "./looks";
import { splitIsCurrent } from "./plan";

export const NOTES_MAX = 2000;

function writeCardFile(root: string, f: CardFile): void {
  writeFileSync(path.join(root, "card.json"), `${JSON.stringify(f, null, 2)}\n`);
}

// The card's notes: free words of the user's (look, outfit, vibe, age range). Kept also on a locked card: they describe,
// they do not change its pictures.
export function setCardNotes(ws: Workspace, id: string, notes: unknown): string {
  const text = typeof notes === "string" ? notes.trim().slice(0, NOTES_MAX) : "";
  const root = cardRoot(ws, getCard(ws, id));
  const f = readCardFile(root);
  if (text) f.notes = text;
  else delete f.notes;
  writeCardFile(root, f);
  ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  return text;
}

export type CardTag = { id: string; name: string; kind: "character" | "scene"; removed: boolean };

// Every card by id, removed ones too (the Storyboard's cast chips show a removed character greyed out): the library's
// rows, and the removed cards in characters\_removed\ (cleanup.ts keeps each one's id in its card.json, Restore gives it back).
export function cardTags(ws: Workspace): CardTag[] {
  const active: CardTag[] = ws.db
    .select()
    .from(cardTable)
    .all()
    .filter((r) => existsSync(path.join(cardRoot(ws, r), "card.json")))
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, removed: false }));
  const removed: CardTag[] = listRemovedCards(ws).flatMap((r) => {
    try {
      const f = readCardFile(path.join(ws.dir, r.folder)) as CardFile & { removed?: { id?: string } };
      const id = f.removed?.id;
      return id && !active.some((a) => a.id === id) ? [{ id, name: r.name, kind: r.kind, removed: true }] : [];
    } catch {
      return [];
    }
  });
  return [...active, ...removed].sort((a, b) => Number(a.removed) - Number(b.removed) || a.name.localeCompare(b.name));
}

const one = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// Tidy texts (26 Nov 2026, Paul: on some cards the Outfit, "Close-ups show", "Front shows" and "Back shows" all held the
// FACE description): the face, hair, skin, makeup and age words move from the outfit texts to the Notes; only clothing
// stays in the Outfit and its three parts. Free and local (card-text.ts). On the draft and on draft looks only (a locked
// version stays as it was locked: Edit → new version first); nothing is lost (what moves is added to the Notes).
export function tidyCardTexts(ws: Workspace, id: string): { moved: number; note: string } {
  const row = getCard(ws, id);
  if (row.kind !== "character") throw new Error("Tidy texts is for characters.");
  const root = cardRoot(ws, row);
  const f = readCardFile(root);
  const v = currentVersion(f);
  const toNotes: string[] = [];
  let moved = 0;
  let lockedFace = false;
  const tidy = (o: { outfit?: string; outfit_split?: { from: string; closeups: string; front: string; back: string } }, editable: boolean) => {
    const before = o.outfit?.trim() ?? "";
    const parts = sortCardText(before);
    const splitFace = o.outfit_split ? (["closeups", "front", "back"] as const).map((k) => sortCardText(o.outfit_split![k]).face).filter(Boolean) : [];
    if (!parts.face && !splitFace.length) return;
    if (!editable) {
      lockedFace = true;
      return;
    }
    const current = splitIsCurrent(o.outfit_split, o.outfit);
    if (parts.face) toNotes.push(parts.face);
    for (const s of splitFace) if (!toNotes.some((n) => n.includes(s))) toNotes.push(s);
    o.outfit = parts.clothes || undefined;
    if (o.outfit_split) {
      for (const k of ["closeups", "front", "back"] as const) o.outfit_split[k] = sortCardText(o.outfit_split[k]).clothes;
      // Still the split of this outfit (only face words left it); an outfit with no clothes at all: no split.
      if (current && o.outfit) o.outfit_split.from = o.outfit;
      if (!o.outfit) delete o.outfit_split;
    }
    moved++;
  };
  tidy(v, v.status === "draft");
  for (const l of f.looks ?? []) tidy(l, l.status === "draft");
  const fresh = toNotes.filter((t) => !(f.notes ?? "").includes(t));
  if (fresh.length) f.notes = [f.notes?.trim(), ...fresh].filter(Boolean).join("\n").slice(0, NOTES_MAX);
  if (moved || fresh.length) {
    writeCardFile(root, f);
    ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  }
  const locked = lockedFace ? " A locked version or look still has face words in its outfit: press Edit → new version (or Change this look) first." : "";
  const note = moved
    ? `Face and hair words moved to Notes; the Outfit keeps only the clothes${moved > 1 ? ` (${moved} outfits)` : ""}. Free, nothing sent online.${locked}`
    : `Nothing to move: the outfit texts describe clothes.${locked}`;
  return { moved, note };
}

// "Copy character for Claude": a compact character-lock block to paste into claude.ai when writing shot prompts.
// (26 Nov 2026, Paul:) the description first: the Notes as its "Look" (face, hair, age range, vibe), then the wardrobe;
// only the reference pictures that exist, then one "Missing:" line; it ends by asking to attach those pictures.
// `warnings`: what is empty (the copy still happens): no Notes, a look without an outfit description.
export const NO_NOTES_WARNING = "No description yet; add Notes for better prompts";
export function characterBlock(ws: Workspace, id: string): { block: string; warnings: string[] } {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const f = readCardFile(root);
  const v = usableVersion(f) ?? currentVersion(f);
  const dir = versionDir(root, v.n);
  const has = (file: string) => existsSync(path.join(dir, file));
  const character = row.kind === "character";
  const warnings: string[] = [];
  const out: string[] = [];
  out.push(`CHARACTER LOCK: ${row.name}${character ? "" : " (a place)"}`);
  out.push("");
  out.push(character ? "Look (face, hair, age range, vibe):" : "Look:");
  if (f.notes) out.push(one(f.notes));
  else warnings.push(NO_NOTES_WARNING);
  if (v.description) out.push(`${f.notes ? "Details from the card" : "From the card"}: ${one(v.description)}`);
  if (!f.notes && !v.description) out.push("(no description yet)");
  if (character) {
    const looks = listLooks(root, f);
    if (looks.length) {
      out.push("");
      out.push("Wardrobe (looks):");
      for (const l of looks) {
        const outfit = one(l.outfit);
        if (!outfit) warnings.push(`The look "${l.name}" has no outfit description yet; add it in the Wardrobe for better prompts`);
        else if (!describesClothes(outfit)) warnings.push(`The look "${l.name}": ${OUTFIT_FACE_WARNING.toLowerCase()}`);
        out.push(`- ${l.name}${l.status === "locked" ? "" : " (draft)"}: ${outfit || "(no outfit description yet)"}`);
      }
    }
  }
  if (v.props) {
    out.push("");
    out.push(`Must not change: ${one(v.props)}`);
  }
  // The persona (26 Nov 2026): how this character acts and sings, after identity and wardrobe.
  const persona = (f as CardFile & { persona?: unknown }).persona;
  if (character && persona && !personaIsEmpty(cleanPersona(persona))) {
    out.push("");
    out.push(personaBlock(row.name, cleanPersona(persona)));
  }
  const pics: [string, boolean][] = character
    ? [["reference picture", true], ["face close-up", has("closeup.png")], ["3/4 face", has("three_quarter.png")], ["teeth close-up", has("closeup_teeth.png")], ["full body front", has("body_front.png")], ["full body back", has("body_back.png")]]
    : [["reference picture", true]];
  const present = pics.filter(([, ok]) => ok).map(([n]) => n);
  const missing = pics.filter(([, ok]) => !ok).map(([n]) => n);
  out.push("");
  out.push(`Reference pictures: ${present.join(", ")}`);
  if (missing.length) out.push(`Missing: ${missing.join(", ")}`);
  out.push(`Status: ${v.status === "locked" ? `locked (version ${v.n})` : `draft (version ${v.n}, not locked yet)`}`);
  if (character) out.push(`Rule: ${row.name} keeps exactly this face, hair, body, age and ethnicity in every shot; only the look named for the shot changes the clothes.`);
  out.push("");
  out.push(`Attach the reference picture${present.length === 1 ? "" : "s"} listed above with this block.`);
  return { block: `${out.join("\n")}\n`, warnings };
}

// Rename (26 Nov 2026, Paul: "only the display name changes: the character's ID and folder stay the same"): the card's
// name in the library and its card.json; its folder, id, face prints, pictures, cast chips and songs' Cast lists (all by
// id) do not move. Shot lists name people and places by their name: every song's shot list is updated with it (who is
// in each shot, its place, the look per person). Refused when another card of the same kind has that name.
export function renameCard(ws: Workspace, id: string, name: unknown): { name: string; shots: number; songs: number } {
  const row = getCard(ws, id);
  const next = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!next) throw new Error("Type a name.");
  if (next.length > 60) throw new Error("A name of 60 characters at most.");
  if (/[<>:"/\\|?*]/.test(next)) throw new Error('A name without < > : " / \\ | ? *');
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const what = row.kind === "character" ? "character" : "scene card";
  const taken = ws.db.select().from(cardTable).all().find((r) => r.id !== id && r.kind === row.kind && same(r.name, next));
  if (taken) throw new Error(`Another ${what} is already called "${taken.name}": choose another name.`);
  const old = row.name;
  if (old === next) return { name: next, shots: 0, songs: 0 };
  const root = cardRoot(ws, row);
  const f = readCardFile(root);
  f.name = next;
  writeFileSync(path.join(root, "card.json"), `${JSON.stringify(f, null, 2)}\n`);
  ws.db.update(cardTable).set({ name: next, updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  // Every song's shot list: the old name becomes the new one (case-insensitive match).
  let shots = 0;
  let songs = 0;
  for (const p of ws.db.select().from(projectTable).all()) {
    let file: string;
    try {
      const paths = songPathsById(ws, p.id);
      if (paths.legacy) continue;
      file = path.join(paths.root, SHOTLIST_FILE);
    } catch {
      continue;
    }
    const list = readShotListFile(file);
    if (!list) continue;
    let changed = 0;
    const slots = list.slots.map((x) => {
      let hit = false;
      const characters = x.characters.map((c) => (same(c, old) ? ((hit = true), next) : c));
      const scene = x.scene && same(x.scene, old) ? ((hit = true), next) : x.scene;
      const looks = x.looks ? Object.fromEntries(Object.entries(x.looks).map(([k, v]) => (same(k, old) ? ((hit = true), [next, v]) : [k, v]))) : undefined;
      if (hit) changed++;
      return hit ? { ...x, characters, scene, ...(looks ? { looks } : {}) } : x;
    });
    if (!changed) continue;
    writeFileSync(file, `${JSON.stringify({ ...list, slots }, null, 2)}\n`);
    shots += changed;
    songs++;
  }
  return { name: next, shots, songs };
}

