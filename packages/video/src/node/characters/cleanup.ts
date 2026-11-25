// Card clean-up (26 Nov 2026, Paul: "why can't I delete an old picture"): put a pack picture aside, replace the card's
// picture, remove a whole card. Nothing is ever deleted (CLAUDE.md): each one moves to a folder of its own and has a
// Restore.
//   Put aside: v<n>\<view>.png → v<n>\_aside\<view> <stamp>.png (listed in _aside\aside.json); the place is empty again.
//   Replace picture: the old picture(s) → <card>\_replaced\<stamp>\ (listed in card.json "replaced").
//   Remove card: <card> → characters\_removed\<name> <stamp>\ (or scenes\…); card.json "removed" keeps its id and scope,
//   the database row goes (Restore puts it back with the same id).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { card as cardTable, cardJob, type Card, type Workspace } from "@lyric/db";
import { and, eq } from "drizzle-orm";

import { CARD_DIRS, cardRoot, currentVersion, getCard, readCardFile, versionDir, writeCardFile, type CardFile, type CardKind } from "./cards";
import { CHARACTER_SHEET } from "./character-sheet";
import { readReport, writeReport } from "./generate";
import { ANGLES, EXTRA_VIEWS, isExtraView, VIEWS } from "./plan";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const stampOf = (d = new Date()) => d.toISOString().replace(/[:T]/g, "-").replace(/\..*$/, "");
const labelOf = (id: string) => [...VIEWS, ...EXTRA_VIEWS, ...ANGLES].find((x) => x.id === id)?.label.replace(/ \(cropped at the neck\)/, "") ?? id;

// ---------------------------------------------------------------- put a pack picture aside

export type AsideEntry = { file: string; id: string; label: string; at: string; full?: string; chosen: number | null; light: string | null; text: string };
const asideDir = (dir: string) => path.join(dir, "_aside");
const asideList = (dir: string): AsideEntry[] => {
  try {
    return JSON.parse(readFileSync(path.join(asideDir(dir), "aside.json"), "utf8")) as AsideEntry[];
  } catch {
    return [];
  }
};
const writeAside = (dir: string, list: AsideEntry[]) => {
  mkdirSync(asideDir(dir), { recursive: true });
  writeFileSync(path.join(asideDir(dir), "aside.json"), `${JSON.stringify(list, null, 2)}\n`);
};

// The pictures put aside in the current version (newest first), with their file relative to the card folder.
export function asidePictures(root: string, file: CardFile): (AsideEntry & { rel: string })[] {
  const v = currentVersion(file);
  return asideList(versionDir(root, v.n))
    .filter((e) => existsSync(path.join(asideDir(versionDir(root, v.n)), e.file)))
    .map((e) => ({ ...e, rel: `v${v.n}/_aside/${e.file}` }))
    .reverse();
}

function versionFor(ws: Workspace, id: string, view: string) {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = currentVersion(file);
  // A locked version keeps its pictures; the extra views (made also on a locked card) can change.
  if (v.status === "locked" && !isExtraView(view)) throw new Error(`Version ${v.n} is locked: start a new version to change its pictures.`);
  const dir = versionDir(root, v.n);
  const report = readReport(dir);
  return { row, root, file, v, dir, report };
}

function setAside(dir: string, report: NonNullable<ReturnType<typeof readReport>>, view: string): AsideEntry {
  const item = report.items.find((i) => i.id === view);
  const pic = path.join(dir, `${view}.png`);
  if (!item || item.chosen === null || !existsSync(pic)) throw new Error(`There is no ${labelOf(view)} picture to put aside.`);
  mkdirSync(asideDir(dir), { recursive: true });
  let name = `${view} ${stampOf()}.png`;
  for (let k = 2; existsSync(path.join(asideDir(dir), name)); k++) name = `${view} ${stampOf()} (${k}).png`;
  renameSync(pic, path.join(asideDir(dir), name));
  const entry: AsideEntry = { file: name, id: view, label: labelOf(view), at: new Date().toISOString(), chosen: item.chosen, light: item.light, text: item.text };
  // The picture as given (before the neck crop) goes with it.
  const t = item.tries[item.chosen];
  const full = t?.file ? path.join(dir, t.file.replace(/\.png$/i, "_full.png")) : null;
  if (full && existsSync(path.join(dir, `${view}_full.png`))) {
    entry.full = name.replace(/\.png$/, " full.png");
    renameSync(path.join(dir, `${view}_full.png`), path.join(asideDir(dir), entry.full));
  }
  item.chosen = null;
  item.light = null;
  item.text = "";
  return entry;
}

// ✕ on a pack picture: out of the pack, into _aside (with Restore). The place is empty: make it again or use your own.
export function putAsideView(ws: Workspace, id: string, view: string): { summary: string } {
  const { dir, report } = versionFor(ws, id, view);
  if (!report) throw new Error("This card has no pictures yet.");
  const entry = setAside(dir, report, view);
  writeAside(dir, [...asideList(dir), entry]);
  writeReport(dir, report);
  rmSync(path.join(dir, CHARACTER_SHEET), { force: true }); // made again from the views left
  return { summary: `${entry.label} put aside: Restore brings it back (under "Put aside").` };
}

// Restore: the picture goes back to its place; a picture now in that place is put aside in its turn.
export function restoreView(ws: Workspace, id: string, asideFile: string): { summary: string } {
  const row = getCard(ws, id);
  const list0 = asideList(versionDir(cardRoot(ws, row), currentVersion(readCardFile(cardRoot(ws, row))).n));
  const entry = list0.find((e) => e.file === asideFile);
  if (!entry) throw new Error("This picture is not in the put-aside list (any more).");
  const { dir, report } = versionFor(ws, id, entry.id);
  if (!report) throw new Error("This card has no pictures yet.");
  let list = list0.filter((e) => e.file !== asideFile);
  let item = report.items.find((i) => i.id === entry.id);
  if (item && item.chosen !== null && existsSync(path.join(dir, `${entry.id}.png`))) list = [...list, setAside(dir, report, entry.id)];
  if (!item) {
    item = { id: entry.id, label: entry.label, kind: ANGLES.some((a) => a.id === entry.id) ? "angle" : "view", tries: [], chosen: null, light: null, text: "" };
    report.items.push(item);
  }
  renameSync(path.join(asideDir(dir), entry.file), path.join(dir, `${entry.id}.png`));
  if (entry.full && existsSync(path.join(asideDir(dir), entry.full))) renameSync(path.join(asideDir(dir), entry.full), path.join(dir, `${entry.id}_full.png`));
  item.chosen = entry.chosen !== null && entry.chosen < item.tries.length ? entry.chosen : item.tries.length ? item.tries.length - 1 : null;
  item.light = (entry.light as typeof item.light) ?? null;
  item.text = entry.text;
  writeAside(dir, list);
  writeReport(dir, report);
  rmSync(path.join(dir, CHARACTER_SHEET), { force: true });
  return { summary: `${entry.label} is back in its place.` };
}

// ---------------------------------------------------------------- replace the card's picture

export type ReplacedPicture = { at: string; folder: string; reference: string; original: string; check?: CardFile["check"] };
type WithReplaced = CardFile & { replaced?: ReplacedPicture[] };

function stash(root: string, file: WithReplaced): ReplacedPicture {
  const folder = `_replaced/${stampOf()}`;
  mkdirSync(path.join(root, folder), { recursive: true });
  for (const f of new Set([file.reference, file.original])) if (existsSync(path.join(root, f))) renameSync(path.join(root, f), path.join(root, folder, f));
  return { at: new Date().toISOString(), folder, reference: file.reference, original: file.original, check: file.check };
}

// Replace picture: a new picture for the card (the one the packs and checks start from). Only on a draft; the old
// picture is kept in _replaced\ with Restore. The caller checks the new picture (as for a new card).
export function replaceReference(ws: Workspace, id: string, picture: Buffer, fileName: string): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root) as WithReplaced;
  if (currentVersion(file).status === "locked") throw new Error(`Version ${currentVersion(file).n} is locked: start a new version first, then replace the picture.`);
  const ext = path.extname(fileName).toLowerCase();
  if (!IMAGE_EXT.test(ext)) throw new Error("Use a picture: .jpg, .png or .webp.");
  const old = stash(root, file);
  const name = `reference${ext}`;
  writeFileSync(path.join(root, name), picture);
  file.replaced = [...(file.replaced ?? []), old];
  file.reference = name;
  file.original = name;
  delete file.check;
  writeCardFile(root, file);
  ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  return file;
}

// Restore an earlier picture: it becomes the card's picture again; the current one is kept in its turn.
export function restoreReference(ws: Workspace, id: string, at: string): CardFile {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root) as WithReplaced;
  if (currentVersion(file).status === "locked") throw new Error(`Version ${currentVersion(file).n} is locked: start a new version first.`);
  const back = file.replaced?.find((r) => r.at === at);
  if (!back) throw new Error("This earlier picture is not kept (any more).");
  const now = stash(root, file);
  for (const f of new Set([back.reference, back.original])) if (existsSync(path.join(root, back.folder, f))) renameSync(path.join(root, back.folder, f), path.join(root, f));
  file.replaced = [...(file.replaced ?? []).filter((r) => r.at !== at), now];
  file.reference = back.reference;
  file.original = back.original;
  if (back.check) file.check = back.check;
  else delete file.check;
  writeCardFile(root, file);
  ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, id)).run();
  return file;
}

// ---------------------------------------------------------------- remove a whole card

type Removed = { id: string; at: string; scope_kind: Card["scope_kind"]; scope_value: string | null; folder: string };
type WithRemoved = CardFile & { removed?: Removed };
export type RemovedCard = { folder: string; kind: CardKind; name: string; at: string; picture: string | null };

const removedRoot = (ws: Workspace, kind: CardKind) => path.join(ws.dir, CARD_DIRS[kind], "_removed");

// Remove card: the folder moves to characters\_removed\ (or scenes\_removed\), with Restore. Refused while it works.
export function removeCard(ws: Workspace, id: string): { summary: string; folder: string } {
  const row = getCard(ws, id);
  const busy = ws.db.select().from(cardJob).where(eq(cardJob.card_id, id)).all().some((j) => j.status === "queued" || j.status === "running");
  if (busy) throw new Error("This card is still making pictures: wait for it (or stop it), then remove it.");
  const root = cardRoot(ws, row);
  const file = readCardFile(root) as WithRemoved;
  const base = removedRoot(ws, row.kind);
  mkdirSync(base, { recursive: true });
  let target = path.join(base, `${row.name} ${stampOf()}`);
  for (let k = 2; existsSync(target); k++) target = path.join(base, `${row.name} ${stampOf()} (${k})`);
  file.removed = { id: row.id, at: new Date().toISOString(), scope_kind: row.scope_kind, scope_value: row.scope_value, folder: row.folder };
  writeCardFile(root, file);
  renameSync(root, target);
  ws.db.delete(cardJob).where(eq(cardJob.card_id, id)).run();
  ws.db.delete(cardTable).where(eq(cardTable.id, id)).run();
  const rel = path.relative(ws.dir, target).split(path.sep).join("/");
  return { summary: `"${row.name}" removed: it is kept in ${rel.replace(/\//g, "\\")} and Restore on the Characters page brings it back.`, folder: rel };
}

// The removed cards (newest first), for the Characters page's Restore list.
export function listRemovedCards(ws: Workspace): RemovedCard[] {
  const out: RemovedCard[] = [];
  for (const kind of Object.keys(CARD_DIRS) as CardKind[]) {
    const base = removedRoot(ws, kind);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const root = path.join(base, d);
      try {
        const file = readCardFile(root) as WithRemoved;
        const v = currentVersion(file);
        const main = kind === "character" ? "closeup.png" : "wide_left.png";
        const picture = existsSync(path.join(versionDir(root, v.n), main)) ? `v${v.n}/${main}` : existsSync(path.join(root, file.reference)) ? file.reference : null;
        out.push({ folder: path.relative(ws.dir, root).split(path.sep).join("/"), kind, name: file.name, at: file.removed?.at ?? "", picture });
      } catch {
        // not a card folder
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// The removed card's folder (inside a _removed folder of the workspace only).
export function removedCardRoot(ws: Workspace, folder: string): string {
  const full = path.resolve(ws.dir, folder);
  const ok = (Object.keys(CARD_DIRS) as CardKind[]).some((k) => {
    const rel = path.relative(removedRoot(ws, k), full);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.includes(path.sep);
  });
  if (!ok || !existsSync(path.join(full, "card.json"))) throw new Error("This removed card is not there (any more).");
  return full;
}

// Restore: back to its own folder and into the list, with the same id (refused when the name is taken meanwhile).
export function restoreCard(ws: Workspace, folder: string): Card {
  const from = removedCardRoot(ws, folder);
  const file = readCardFile(from) as WithRemoved;
  const kind = file.kind;
  const rel = file.removed?.folder ?? `${CARD_DIRS[kind]}/${file.name}`;
  const what = kind === "character" ? "character" : "scene card";
  if (ws.db.select().from(cardTable).where(and(eq(cardTable.kind, kind), eq(cardTable.name, file.name))).get() || existsSync(path.join(ws.dir, rel)))
    throw new Error(`There is already a ${what} called "${file.name}": rename or remove that one first.`);
  const removed = file.removed;
  delete file.removed;
  writeCardFile(from, file);
  renameSync(from, path.join(ws.dir, rel));
  const v = currentVersion(file);
  const locked = [...file.versions].reverse().find((x) => x.status === "locked");
  const idFree = removed?.id && !ws.db.select().from(cardTable).where(eq(cardTable.id, removed.id)).get();
  return ws.db
    .insert(cardTable)
    .values({
      ...(idFree ? { id: removed!.id } : {}),
      kind,
      name: file.name,
      folder: rel,
      scope_kind: removed?.scope_kind ?? "artist",
      scope_value: removed?.scope_value ?? null,
      status: locked ? "locked" : "draft",
      version: locked ? locked.n : v.n,
    })
    .returning()
    .get();
}
