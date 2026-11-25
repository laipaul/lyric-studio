// Character and scene cards (C1): one picture in, a locked, versioned pack out.
//
//   workspace/characters/<name>/   or   workspace/scenes/<name>/
//     card.json                     what the card is (kind, name, scope) and its versions
//     reference.<ext>               the picture (as uploaded), reference_cropped.jpg after "Crop to face",
//     reference2.<ext>              an optional second picture of the same character
//     v1/, v2/ …                    one folder per version: the views (closeup.png, body_front.png +
//                                   body_front_full.png, …) or angles, report.json, sheet.jpg
//     calibration.json              the face-check lines calibrated on the user's clips (characters)
//
// A locked version is read-only. "New version" copies the latest into the next folder as a draft; nothing is ever
// deleted. The database table `card` lists the cards (for the Characters page and, later, the Storyboard picker).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absPath, card as cardTable, CARD_SCOPES, type Card, type Workspace } from "@lyric/db";
import { and, eq } from "drizzle-orm";

import type { CheckResult } from "./face";
import type { Look } from "./looks";
import { ANGLES, DEFAULT_MODELS, estimate, MODELS, safeName, splitIsCurrent, TEXT_MODEL, VIEWS, VISION, type ModelId, type OutfitSplit, type Thresholds, DEFAULT_THRESHOLDS } from "./plan";

export type CardKind = Card["kind"];
export type CardScope = { kind: (typeof CARD_SCOPES)[number]; value: string | null };

export type CardVersion = {
  n: number;
  status: "draft" | "locked";
  created_at: string;
  locked_at?: string;
  model: ModelId;
  outfit?: string; // characters: the outfit in Paul's words
  outfit_split?: OutfitSplit; // the outfit in three parts (close-ups / front / back), made by the app from `outfit` (from)
  props?: string; // scenes: the key props that must not change
  description?: string; // the fixed description (drafted by the vision model, edited by Paul)
};

export type CardFile = {
  version: 1;
  kind: CardKind;
  name: string;
  created_at: string;
  reference: string; // file name in the card folder: the picture sent to the models
  original: string; // the picture as uploaded
  reference2?: string;
  check?: CheckResult; // the reference (or location) check of `reference`
  check2?: CheckResult;
  versions: CardVersion[];
  main_look?: string; // the Wardrobe: the name of the pack's own outfit (default "Main look")
  looks?: Look[]; // the Wardrobe: further looks (looks.ts)
};

export const CARD_DIRS: Record<CardKind, string> = { character: "characters", scene: "scenes" };
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

const now = () => new Date().toISOString();

export function cardRoot(ws: Workspace, row: Pick<Card, "folder">): string {
  return absPath(ws, row.folder);
}

export function readCardFile(root: string): CardFile {
  return JSON.parse(readFileSync(path.join(root, "card.json"), "utf8")) as CardFile;
}

export function writeCardFile(root: string, file: CardFile): void {
  const target = path.join(root, "card.json");
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, target);
}

export const versionDir = (root: string, n: number) => path.join(root, `v${n}`);
export const currentVersion = (file: CardFile): CardVersion => file.versions[file.versions.length - 1];
// The version scenes, stills and recasts use: the latest locked one (a newer draft does not take its place until it is
// locked). Null while nothing is locked yet.
export const usableVersion = (file: CardFile): CardVersion | null => [...file.versions].reverse().find((v) => v.status === "locked") ?? null;
// One version by number (for viewing an older, read-only version); the current one when n is missing or unknown.
export const versionByNumber = (file: CardFile, n?: number | null): CardVersion => file.versions.find((v) => v.n === n) ?? currentVersion(file);

// A file inside the card folder, never outside it (for serving pictures to the page).
export function cardFilePath(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  const inside = path.relative(root, full);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return existsSync(full) ? full : null;
}

export function getCard(ws: Workspace, id: string): Card {
  const row = ws.db.select().from(cardTable).where(eq(cardTable.id, id)).get();
  if (!row) throw new Error("This card does not exist (any more).");
  return row;
}

// draft: the number of a newer draft being worked on next to the locked version in use (null when there is none).
export type CardSummary = Card & { thumbnail: string; views: number; description: string | null; draft: number | null; looks: string[] };

// The page's list: every card with its thumbnail (the close-up, or the first location angle, else the picture).
export function listCards(ws: Workspace): CardSummary[] {
  const rows = ws.db.select().from(cardTable).all();
  return rows
    .map((row): CardSummary | null => {
      const root = cardRoot(ws, row);
      if (!existsSync(path.join(root, "card.json"))) return null;
      const file = readCardFile(root);
      const v = currentVersion(file);
      const vdir = versionDir(root, v.n);
      const views = existsSync(vdir) ? readdirSync(vdir).filter((f) => IMAGE_EXT.test(f) && !/_full|_try\d/.test(f) && !/^(character_)?sheet/.test(f)) : [];
      const main = row.kind === "character" ? "closeup.png" : "wide_left.png";
      const thumbnail = views.includes(main) ? `v${v.n}/${main}` : file.reference;
      const used = usableVersion(file);
      const looks = row.kind === "character" && file.looks?.length ? [file.main_look?.trim() || "Main look", ...file.looks.map((l) => l.name)] : [];
      return { ...row, thumbnail, views: views.length, description: (used ?? v).description ?? null, draft: used && v.status === "draft" ? v.n : null, looks };
    })
    .filter((x): x is CardSummary => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A new card from one picture: its folder, card.json (version 1, draft) and the database row. The reference check
// is done by the caller (it needs the face tool) and saved with setCheck.
export function createCard(ws: Workspace, o: { kind: CardKind; name: string; picture: Buffer; fileName: string; scope?: CardScope }): Card {
  const name = safeName(o.name);
  if (!name.trim() || name === "untitled") throw new Error("Give the card a name.");
  if (ws.db.select().from(cardTable).where(and(eq(cardTable.kind, o.kind), eq(cardTable.name, name))).get())
    throw new Error(`There is already a ${o.kind === "character" ? "character" : "scene card"} called "${name}".`);
  const ext = path.extname(o.fileName).toLowerCase();
  if (!IMAGE_EXT.test(ext)) throw new Error("Use a picture: .jpg, .png or .webp.");
  const folder = `${CARD_DIRS[o.kind]}/${name}`;
  const root = absPath(ws, folder);
  if (existsSync(root)) throw new Error(`The folder ${folder} already exists: choose another name.`);
  mkdirSync(versionDir(root, 1), { recursive: true });
  const original = `reference${ext}`;
  writeFileSync(path.join(root, original), o.picture);
  const file: CardFile = {
    version: 1,
    kind: o.kind,
    name,
    created_at: now(),
    reference: original,
    original,
    versions: [{ n: 1, status: "draft", created_at: now(), model: DEFAULT_MODELS[0] }],
  };
  writeCardFile(root, file);
  return ws.db
    .insert(cardTable)
    .values({ kind: o.kind, name, folder, scope_kind: o.scope?.kind ?? "artist", scope_value: o.scope?.value ?? null })
    .returning()
    .get();
}

function touch(ws: Workspace, id: string, set: Partial<Pick<Card, "status" | "version" | "scope_kind" | "scope_value">> = {}): void {
  ws.db.update(cardTable).set({ ...set, updated_at: new Date() }).where(eq(cardTable.id, id)).run();
}

function editable(file: CardFile): CardVersion {
  const v = currentVersion(file);
  if (v.status === "locked") throw new Error(`Version ${v.n} is locked (read-only). Start a new version to change it.`);
  return v;
}

export function setCheck(ws: Workspace, id: string, check: CheckResult, which: "reference" | "reference2" = "reference"): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  if (which === "reference") file.check = check;
  else file.check2 = check;
  writeCardFile(root, file);
  touch(ws, id);
  return file;
}

// The draft's texts and settings (refused on a locked version).
export function updateDraft(
  ws: Workspace,
  id: string,
  o: { outfit?: string; outfit_split?: Partial<Pick<OutfitSplit, "closeups" | "front" | "back">>; props?: string; description?: string; model?: ModelId; scope?: CardScope },
): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = editable(file);
  if (o.outfit !== undefined) v.outfit = o.outfit.trim() || undefined;
  if (o.outfit_split) {
    // Paul's corrections: the parts he sends replace the app's; `from` is kept (a split of an older outfit stays stale).
    const s = v.outfit_split ?? { from: v.outfit ?? "", closeups: "", front: "", back: "" };
    for (const k of ["closeups", "front", "back"] as const) if (typeof o.outfit_split[k] === "string") s[k] = o.outfit_split[k]!.trim();
    v.outfit_split = s;
  }
  if (o.props !== undefined) v.props = o.props.trim() || undefined;
  if (o.description !== undefined) v.description = o.description.trim() || undefined;
  if (o.model !== undefined) {
    if (!MODELS[o.model]) throw new Error(`Unknown model "${o.model}".`);
    v.model = o.model;
  }
  writeCardFile(root, file);
  touch(ws, id, o.scope ? { scope_kind: o.scope.kind, scope_value: o.scope.value } : {});
  return file;
}

// "Crop to face": the cropped copy becomes the picture sent to the models (the original stays).
export function useCroppedReference(ws: Workspace, id: string, croppedName: string): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  editable(file);
  file.reference = croppedName;
  writeCardFile(root, file);
  touch(ws, id);
  return file;
}

// "Add a second picture" of the same character: sent as a second reference.
export function addSecondPicture(ws: Workspace, id: string, picture: Buffer, fileName: string): { file: CardFile; name: string } {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  editable(file);
  const ext = path.extname(fileName).toLowerCase();
  if (!IMAGE_EXT.test(ext)) throw new Error("Use a picture: .jpg, .png or .webp.");
  const name = `reference2${ext}`;
  writeFileSync(path.join(root, name), picture);
  file.reference2 = name;
  writeCardFile(root, file);
  touch(ws, id);
  return { file, name };
}

// What a version needs before it can be locked: every view (or angle) made, and a description.
export function lockProblems(root: string, file: CardFile): string[] {
  const v = currentVersion(file);
  const dir = versionDir(root, v.n);
  const ids = file.kind === "character" ? VIEWS.map((x) => x.id) : ANGLES.map((x) => x.id);
  const missing = ids.filter((id) => !existsSync(path.join(dir, `${id}.png`)));
  const problems: string[] = [];
  const label = (id: string) => [...VIEWS, ...ANGLES].find((x) => x.id === id)?.label.replace(/ \(cropped at the neck\)/, "") ?? id;
  if (missing.length) problems.push(`Not made yet: ${missing.map(label).join(", ")}. Make the pack (or remake those) first.`);
  if (!v.description?.trim()) problems.push("Write (or keep) the description first: it is locked with the pictures.");
  return problems;
}

export function lockCard(ws: Workspace, id: string): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = editable(file);
  const problems = lockProblems(root, file);
  if (problems.length) throw new Error(problems.join(" "));
  v.status = "locked";
  v.locked_at = now();
  writeCardFile(root, file);
  touch(ws, id, { status: "locked", version: v.n });
  return file;
}

// The next version as a draft, starting from the latest locked one: the same reference picture(s) (kept at the card's
// root), outfit, outfit split, description, model and pictures, so only what needs it is remade. The locked version
// stays read-only AND in use (the card row keeps status "locked" and its number) until the new draft is locked.
export function newVersion(ws: Workspace, id: string): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const last = currentVersion(file);
  if (last.status !== "locked") throw new Error(`Version ${last.n} is still a draft: change it directly.`);
  const n = last.n + 1;
  if (existsSync(versionDir(root, last.n))) cpSync(versionDir(root, last.n), versionDir(root, n), { recursive: true });
  else mkdirSync(versionDir(root, n), { recursive: true });
  file.versions.push({ n, status: "draft", created_at: now(), model: last.model, outfit: last.outfit, outfit_split: last.outfit_split, props: last.props, description: last.description });
  writeCardFile(root, file);
  touch(ws, id, { status: "locked", version: last.n });
  return file;
}

// The face-check lines: calibrated on the user's clips (calibration.json) or SFace's defaults.
export function cardThresholds(root: string): Thresholds {
  const f = path.join(root, "calibration.json");
  if (!existsSync(f)) return DEFAULT_THRESHOLDS;
  const t = (JSON.parse(readFileSync(f, "utf8")) as { thresholds: { red_below: number; green_from: number } }).thresholds;
  return { red_below: t.red_below, green_from: t.green_from, source: "calibrated on your clips" };
}

// What "Make pack" would cost (shown before anything is sent): every view or angle once + the description draft.
export function packEstimate(file: CardFile): { usd: number; worstUsd: number; images: number; model: ModelId; text: string } {
  const v = currentVersion(file);
  const views = file.kind === "character" ? VIEWS.length : 0;
  const angles = file.kind === "scene" ? ANGLES.length : 0;
  const e = estimate([v.model], { views, angles, retries: 2, vision: 1 });
  const m = MODELS[v.model];
  // The outfit split (a text call) is still to be made when the outfit has no current split.
  const split = file.kind === "character" && !!v.outfit?.trim() && !splitIsCurrent(v.outfit_split, v.outfit);
  const extra = split ? TEXT_MODEL.perCallUsd : 0;
  return {
    usd: e.baseUsd + extra,
    worstUsd: e.worstUsd + extra,
    images: views + angles,
    model: v.model,
    text: `${views + angles} pictures with ${m.name} (${m.priceNote}) + the description draft (${VISION.model}, $0.01)${split ? ` + splitting your outfit per view (${TEXT_MODEL.model}, $0.01)` : ""}`,
  };
}

// The picture(s) sent to the models, as files (the cropped picture when "Crop to face" was used).
export function referenceFiles(root: string, file: CardFile): string[] {
  return [file.reference, ...(file.reference2 ? [file.reference2] : [])].map((f) => path.join(root, f));
}

export function copyInto(root: string, from: string, name: string): string {
  copyFileSync(from, path.join(root, name));
  return name;
}
