// The Characters library (26 Nov 2026, Nextgen sprint step 1, Cast Library): the user's characters live across every
// song (workspace\characters\<name>\card.json + pictures, linked from songs by their card id). Here: the card's own
// notes (look, outfit, vibe, age range: the user's words, never sent to a model by themselves), the cast tags' list
// (removed cards too: Remove card / Restore are cleanup.ts's) and the "Copy character for Claude" block (no API call).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { card as cardTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { cardRoot, currentVersion, getCard, readCardFile, usableVersion, versionDir, type CardFile } from "./cards";
import { listRemovedCards } from "./cleanup";
import { listLooks } from "./looks";

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

// "Copy character for Claude": a compact character-lock block to paste into claude.ai when writing shot prompts.
export function characterBlock(ws: Workspace, id: string): string {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const f = readCardFile(root);
  const v = usableVersion(f) ?? currentVersion(f);
  const dir = versionDir(root, v.n);
  const has = (file: string) => existsSync(path.join(dir, file));
  const out: string[] = [];
  out.push(`CHARACTER LOCK: ${row.name}${row.kind === "scene" ? " (a place)" : ""}`);
  if (f.notes) out.push(`Notes: ${one(f.notes)}`);
  if (v.description) out.push(`${row.kind === "scene" ? "Looks like" : "Appearance"}: ${one(v.description)}`);
  if (row.kind === "character") {
    const looks = listLooks(root, f);
    if (looks.length) {
      out.push("Wardrobe (looks):");
      for (const l of looks) out.push(`- ${l.name}${l.status === "locked" ? "" : " (draft)"}: ${one(l.outfit) || "(no outfit description)"}`);
    }
  }
  if (v.props) out.push(`Must not change: ${one(v.props)}`);
  const pics = row.kind === "character"
    ? [["reference picture", true], ["face close-up", has("closeup.png")], ["3/4 face", has("three_quarter.png")], ["teeth close-up", has("closeup_teeth.png")], ["full body front", has("body_front.png")], ["full body back", has("body_back.png")]]
    : [["reference picture", true]];
  out.push(`Reference pictures: ${pics.map(([n, ok]) => `${n} ${ok ? "✓" : "–"}`).join(", ")}`);
  out.push(`Status: ${v.status === "locked" ? `locked (version ${v.n})` : `draft (version ${v.n}, not locked yet)`}`);
  if (row.kind === "character") out.push(`Rule: ${row.name} keeps exactly this face, hair, body, age and ethnicity in every shot; only the look named for the shot changes the clothes.`);
  return `${out.join("\n")}\n`;
}
