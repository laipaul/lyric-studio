// The Wardrobe (Paul, 21 Nov 2026: "I saw other apps added the full wardrobe with different looks"): one face, many
// looks. A character's pack (close-up, 3/4 face, full body front and back) stays as it is: its outfit is the "Main look"
// (named by the user, default "Main look"), so every existing card is already "face + one look" with nothing moved or
// made again. Further looks live next to the versions:
//
//   workspace/characters/<name>/looks/<look id>/   body_front.png (+ _full), body_back.png (+ _full), closeup.png
//                                                   (optional: the face in this outfit), report.json, tries
//
// card.json keeps each look's name, outfit (and its split), model, whether it has its own close-up, and its status:
// a look is locked on its own; adding or changing a look never touches the face pack or the other looks. Pictures
// come from Make look (Seedream, Gemini …: the cost first, the cap, the same face checks) or from the user's own
// pictures (free). A song chooses which look each cast character wears (Prepare → Production).
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { cardRoot, currentVersion, getCard, readCardFile, usableVersion, versionDir, writeCardFile, type CardFile } from "./cards";
import { estimate, MODELS, safeName, splitIsCurrent, TEXT_MODEL, type ModelId, type OutfitSplit } from "./plan";

export const MAIN_LOOK = "main";
export const LOOKS_DIR = "looks";

export type Look = {
  id: string;
  name: string;
  outfit?: string;
  outfit_split?: OutfitSplit;
  model: ModelId;
  closeup: boolean; // also a close-up of the face in this outfit (hair, neckline, jewellery)
  status: "draft" | "locked";
  created_at: string;
  locked_at?: string;
};

export type LookView = { id: string; label: string; file: string | null }; // file: relative to the card folder
export type LookSummary = { id: string; name: string; main: boolean; outfit: string | null; status: "draft" | "locked"; closeup: boolean; model: ModelId; views: LookView[] };

export const lookDir = (root: string, id: string) => path.join(root, LOOKS_DIR, id);
export const lookViews = (look: Pick<Look, "closeup">) => [...(look.closeup ? ["closeup"] : []), "body_front", "body_back"];
const LABEL: Record<string, string> = { closeup: "Close-up in this look", body_front: "Full body, front", body_back: "Full body, back", three_quarter: "3/4 face" };

export const mainLookName = (file: CardFile) => file.main_look?.trim() || "Main look";

export function getLook(file: CardFile, id: string): Look {
  const look = (file.looks ?? []).find((l) => l.id === id);
  if (!look) throw new Error("This look does not exist (any more).");
  return look;
}

function editableLook(file: CardFile, id: string): Look {
  const look = getLook(file, id);
  if (look.status === "locked") throw new Error(`"${look.name}" is locked: press "Change this look" first.`);
  return look;
}

const slug = (name: string, taken: string[]) => {
  const base = safeName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "look";
  let id = base === MAIN_LOOK ? "main-2" : base;
  for (let k = 2; taken.includes(id); k++) id = `${base}-${k}`;
  return id;
};

// Every look of a character, the main one first (the pack's outfit and body views; the version in use, else the draft).
export function listLooks(root: string, file: CardFile): LookSummary[] {
  if (file.kind !== "character") return [];
  const v = usableVersion(file) ?? currentVersion(file);
  const vdir = versionDir(root, v.n);
  const rel = (dir: string, name: string, base: string) => (existsSync(path.join(dir, name)) ? `${base}/${name}` : null);
  const main: LookSummary = {
    id: MAIN_LOOK,
    name: mainLookName(file),
    main: true,
    outfit: v.outfit ?? null,
    status: v.status,
    closeup: true,
    model: v.model,
    views: ["closeup", "three_quarter", "body_front", "body_back"].map((id) => ({ id, label: LABEL[id], file: rel(vdir, `${id}.png`, `v${v.n}`) })),
  };
  const others = (file.looks ?? []).map((l): LookSummary => {
    const dir = lookDir(root, l.id);
    return { id: l.id, name: l.name, main: false, outfit: l.outfit ?? null, status: l.status, closeup: l.closeup, model: l.model, views: lookViews(l).map((id) => ({ id, label: LABEL[id], file: rel(dir, `${id}.png`, `${LOOKS_DIR}/${l.id}`) })) };
  });
  return [main, ...others];
}

export function addLook(ws: Workspace, cardId: string, o: { name: string; outfit?: string; closeup?: boolean }): Look {
  const row = getCard(ws, cardId);
  if (row.kind !== "character") throw new Error("Only characters have a wardrobe.");
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const name = safeName(o.name);
  if (!o.name.trim() || name === "untitled") throw new Error("Give the look a name (for example: Travel coat).");
  const all = [mainLookName(file), ...(file.looks ?? []).map((l) => l.name)];
  if (all.some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a look called "${name}".`);
  const look: Look = {
    id: slug(name, (file.looks ?? []).map((l) => l.id)),
    name,
    outfit: o.outfit?.trim() || undefined,
    model: (usableVersion(file) ?? currentVersion(file)).model,
    closeup: o.closeup ?? false,
    status: "draft",
    created_at: new Date().toISOString(),
  };
  file.looks = [...(file.looks ?? []), look];
  mkdirSync(lookDir(root, look.id), { recursive: true });
  writeCardFile(root, file);
  return look;
}

export function updateLook(
  ws: Workspace,
  cardId: string,
  lookId: string,
  o: { name?: string; outfit?: string; outfit_split?: Partial<Pick<OutfitSplit, "closeups" | "front" | "back">>; model?: ModelId; closeup?: boolean },
): CardFile {
  const root = cardRoot(ws, getCard(ws, cardId));
  const file = readCardFile(root);
  if (lookId === MAIN_LOOK) {
    // The main look's outfit and model are the pack's (changed above, on the version); only its name is set here.
    if (o.name !== undefined) file.main_look = safeName(o.name) === "untitled" ? undefined : safeName(o.name);
    writeCardFile(root, file);
    return file;
  }
  const look = o.name !== undefined && Object.keys(o).length === 1 ? getLook(file, lookId) : editableLook(file, lookId);
  if (o.name !== undefined) {
    const name = safeName(o.name);
    if (!o.name.trim() || name === "untitled") throw new Error("Give the look a name.");
    const others = [mainLookName(file), ...(file.looks ?? []).filter((l) => l.id !== lookId).map((l) => l.name)];
    if (others.some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a look called "${name}".`);
    look.name = name;
  }
  if (o.outfit !== undefined) look.outfit = o.outfit.trim() || undefined;
  if (o.outfit_split) {
    const s = look.outfit_split ?? { from: look.outfit ?? "", closeups: "", front: "", back: "" };
    for (const k of ["closeups", "front", "back"] as const) if (typeof o.outfit_split[k] === "string") s[k] = o.outfit_split[k]!.trim();
    look.outfit_split = s;
  }
  if (o.model !== undefined) {
    if (!MODELS[o.model]) throw new Error(`Unknown model "${o.model}".`);
    look.model = o.model;
  }
  if (o.closeup !== undefined) look.closeup = o.closeup;
  writeCardFile(root, file);
  return file;
}

// What a look still needs before it can be locked.
export function lookProblems(root: string, look: Look): string[] {
  const dir = lookDir(root, look.id);
  const missing = lookViews(look).filter((id) => !existsSync(path.join(dir, `${id}.png`)));
  return missing.length ? [`Not made yet: ${missing.map((id) => LABEL[id]).join(", ")}. Make the look, or add your own pictures.`] : [];
}

// Lock a look (read-only, used by songs), or "Change this look" (a draft again: every picture and try stays).
export function setLookLocked(ws: Workspace, cardId: string, lookId: string, locked: boolean): CardFile {
  const root = cardRoot(ws, getCard(ws, cardId));
  const file = readCardFile(root);
  const look = getLook(file, lookId);
  if (locked) {
    const p = lookProblems(root, look);
    if (p.length) throw new Error(p.join(" "));
    look.status = "locked";
    look.locked_at = new Date().toISOString();
  } else {
    look.status = "draft";
    look.locked_at = undefined;
  }
  writeCardFile(root, file);
  return file;
}

// What "Make look" would cost (shown first): each view once, + the outfit split when needed.
export function lookEstimate(look: Look): { usd: number; worstUsd: number; text: string } {
  const views = lookViews(look).length;
  const e = estimate([look.model], { views, angles: 0, retries: 2, vision: 0 });
  const split = !!look.outfit?.trim() && !splitIsCurrent(look.outfit_split, look.outfit);
  const extra = split ? TEXT_MODEL.perCallUsd : 0;
  const m = MODELS[look.model];
  return { usd: e.baseUsd + extra, worstUsd: e.worstUsd + extra, text: `${views} pictures with ${m.name} (${m.priceNote})${split ? ` + splitting the outfit per view (${TEXT_MODEL.model}, $0.01)` : ""}` };
}

// The outfit a song uses for a cast character: the chosen look's, else the main look's.
export function lookOutfit(file: CardFile, lookId: string | null | undefined): { id: string; name: string; outfit: string | null } {
  const look = lookId && lookId !== MAIN_LOOK ? (file.looks ?? []).find((l) => l.id === lookId) : null;
  if (look) return { id: look.id, name: look.name, outfit: look.outfit ?? null };
  return { id: MAIN_LOOK, name: mainLookName(file), outfit: (usableVersion(file) ?? currentVersion(file)).outfit ?? null };
}
