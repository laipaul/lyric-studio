// Prepare → Storyboard (11 Nov 2026): the song's story line holds every clip the videos use, in one order: the song's
// own clips, clips of a shared collection chosen one by one (a small badge names the collection; removing one takes it
// out of this song only, never out of the collection) and "the app picks" cards (one card = a whole collection; its
// clips without a place of their own play at that place). Kept in clips.json ("order" with "collection:<name>" for a
// card, "picked": { collection: [clip names] }) and song.json "collections" (the collections the line uses, which
// Make syncs). Before 11 Nov 2026 a ticked collection mixed in all of its clips after the story line: such a song is
// shown, and saved once, as one card at the end of its line (its clips Shape had placed keep their places as picked
// clips), so its videos stay the same. No rendering code is imported here, so the studio's server can use it.
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { folderClips, songClipsCollection, type ClipAsset } from "./assets";
import { clipRoles } from "./clip-roles";
import { cardKey, cardOf, inClipOrder, isOmitted, readClipEdits, setClipOmit, withSongOrder, writeClipEdits, type ClipEdits } from "./clip-edits";
import { notesForClips, readClipNotes, setClipNote } from "./clip-notes";
import { collectionFolder } from "./collections";
import { songCollections } from "./project-settings";
import { readRecipe, writeRecipe } from "./recipe";
import { listCards } from "./characters/cards";
import { animateFor, readShotListFile, SHOTLIST_FILE, slotOf, type Slot } from "./shotlist";
import { sharedCollections, songPathsById } from "./song-folder";
import { songText } from "./textboard";

export type StoryCard = { collection: string; clips: number; thumbs: string[] }; // "Flowers · app picks · N clips"
// A planned slot from the shot list (C2): its picture is made later (C3); Make skips it until then.
export type SlotCard = { id: string; name: string; thumb: string | null; locked: boolean } | { id: null; name: string; thumb: null; locked: false };
export type StorySlot = Slot & { animateWith: string; animateIsDefault: boolean; cast: SlotCard[]; place: SlotCard | null; lineText: string | null };
export type StoryItem = { key: string; clip?: ClipAsset & { collection?: string }; card?: StoryCard; slot?: StorySlot };
export type SongStory = { items: StoryItem[]; collections: string[] };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function collectionClips(ws: Workspace, name: string): Promise<ClipAsset[]> {
  if (!sharedCollections(ws).includes(name)) return [];
  return (await folderClips(ws, collectionFolder(ws, name), name)).clips;
}

function songRoot(ws: Workspace, projectId: string): { root: string; clips: string; recipe: string | null } {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.clips) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return { root: paths.root, clips: paths.clips, recipe: paths.recipe };
}

// song.json "collections": the collections the story line uses (picked clips or a card), in the order they appear.
function syncSongCollections(ws: Workspace, projectId: string, edits: ClipEdits): void {
  const { recipe: file } = songRoot(ws, projectId);
  const used: string[] = [];
  const add = (c: string) => !used.includes(c) && used.push(c);
  for (const e of edits.order) {
    const card = cardOf(e);
    if (card !== null) add(card);
    else for (const [c, names] of Object.entries(edits.picked ?? {})) if (names.some((n) => same(n, e))) add(c);
  }
  for (const c of Object.keys(edits.picked ?? {})) add(c);
  const before = songCollections(ws, projectId);
  if (JSON.stringify(before) === JSON.stringify(used)) return;
  const path0 = file ?? path.join(songPathsById(ws, projectId).root, "song.json");
  const recipe = readRecipe(path0);
  const { collections: _c, ...rest } = recipe;
  writeRecipe(path0, { ...rest, collections: used }); // an empty list too: no shared collections (also when inherited)
}

// The first time a song from before the picker is shown: each collection it uses without picked clips or a card
// becomes a card at the end of the line; the collection clips Shape had placed become picked clips at their place
// (the videos stay the same: those keep their rank, the others follow the line as before).
async function migrate(ws: Workspace, projectId: string, ownFiles: readonly string[]): Promise<ClipEdits> {
  const { root } = songRoot(ws, projectId);
  let edits = readClipEdits(root);
  const legacy = songCollections(ws, projectId).filter((c) => !edits.order.includes(cardKey(c)) && !edits.picked?.[c]?.length);
  if (!legacy.length) return edits;
  edits = withSongOrder(edits, ownFiles, inClipOrder(edits, ownFiles)); // every own clip has its place first
  const picked = { ...(edits.picked ?? {}) };
  const order = [...edits.order];
  for (const c of legacy) {
    const names = (await collectionClips(ws, c)).map((x) => x.name);
    const placed = order.filter((e) => cardOf(e) === null && !ownFiles.some((f) => same(f, e)) && names.some((n) => same(n, e)));
    if (placed.length) picked[c] = placed;
    order.push(cardKey(c));
  }
  return writeClipEdits(root, { ...edits, order, ...(Object.keys(picked).length ? { picked } : {}) });
}

// The story line as Prepare → Storyboard shows it (own clips come from songAssets; this adds the rest in place).
export async function songStory(ws: Workspace, projectId: string, ownAll: readonly ClipAsset[]): Promise<SongStory> {
  const { root, recipe } = songRoot(ws, projectId);
  // Singing takes and clips only for a Lyrics Sync line are not story moments: they never show here (their entries in clips.json stay).
  const roles = clipRoles(root, recipe, ownAll.map((c) => c.name));
  const own = ownAll.filter((c) => (roles.get(c.name) ?? "story") === "story");
  const ownNames = own.map((c) => c.name);
  const edits = await migrate(ws, projectId, ownNames);
  const notes = readClipNotes(root);
  const byCollection = new Map<string, ClipAsset[]>();
  const clipsOfCollection = async (c: string) => {
    if (!byCollection.has(c)) byCollection.set(c, await collectionClips(ws, c));
    return byCollection.get(c)!;
  };
  const items: StoryItem[] = [];
  const shown = new Set<string>();
  const slots = readShotListFile(path.join(root, SHOTLIST_FILE))?.slots ?? [];
  const slotView = slots.length ? slotViews(ws, projectId) : null;
  const ownInOrder = inClipOrder(edits, ownNames);
  // Own clips without a place yet follow at the end (as Make plays them).
  for (const e of [...edits.order, ...ownInOrder.filter((n) => !edits.order.some((o) => same(o, n)))]) {
    const slotId = slotOf(e);
    if (slotId !== null) {
      const slot = slots.find((x) => x.id.toLowerCase() === slotId.toLowerCase());
      if (slot && slotView) items.push({ key: e, slot: slotView(slot) });
      continue;
    }
    const card = cardOf(e);
    if (card !== null) {
      const list = (await clipsOfCollection(card)).filter((x) => !x.duplicateOf);
      const placed = list.filter((x) => edits.order.some((o) => same(o, x.name)));
      const rest = list.filter((x) => !placed.includes(x));
      items.push({ key: e, card: { collection: card, clips: rest.length, thumbs: rest.flatMap((x) => (x.thumb ? [x.thumb] : [])).slice(0, 4) } });
      continue;
    }
    if (shown.has(e.toLowerCase())) continue;
    const mine = own.find((c) => same(c.name, e));
    if (mine) {
      items.push({ key: mine.name, clip: mine });
      shown.add(e.toLowerCase());
      continue;
    }
    const from = Object.entries(edits.picked ?? {}).find(([, names]) => names.some((n) => same(n, e)))?.[0];
    if (!from) continue; // a name left from an older order (a removed clip or collection): not shown
    const asset = (await clipsOfCollection(from)).find((x) => same(x.name, e));
    if (!asset) continue; // removed from the collection since
    const note = notesForClips(notes, [asset]).get(asset.name) ?? null;
    items.push({ key: asset.name, clip: { ...asset, collection: from, omit: isOmitted(edits, asset.name), note } });
    shown.add(e.toLowerCase());
  }
  return { items, collections: songCollections(ws, projectId) };
}

// How a slot shows: its characters' and scene's cards (thumbnail, locked or not; a name with no card any more shows
// as just the name), the lyric line's words and the animation model (named, or the default for the shot type).
function slotViews(ws: Workspace, projectId: string): (slot: Slot) => StorySlot {
  const cards = listCards(ws);
  const lines = songText(ws, projectId).lines;
  const find = (kind: "character" | "scene", name: string): SlotCard => {
    const c = cards.find((x) => x.kind === kind && same(x.name, name));
    return c ? { id: c.id, name: c.name, thumb: c.thumbnail, locked: c.status === "locked" } : { id: null, name, thumb: null, locked: false };
  };
  return (slot) => ({
    ...slot,
    animateWith: animateFor(slot),
    animateIsDefault: !slot.animate,
    cast: slot.characters.map((n) => find("character", n)),
    place: slot.scene ? find("scene", slot.scene) : null,
    lineText: slot.line !== null ? (lines.find((l) => l.number === slot.line)?.text ?? null) : null,
  });
}

// "From a collection…": clips chosen in the picker join the end of the story line (each once); `whole`: the
// collection as one "the app picks" card. Returns the story keys added.
export async function addFromCollection(ws: Workspace, projectId: string, collection: unknown, clips: unknown, whole: unknown): Promise<string[]> {
  const name = String(collection ?? "");
  if (!sharedCollections(ws).includes(name)) throw new Error(`No collection "${name}".`);
  const { root, clips: ownFolder } = songRoot(ws, projectId);
  const chosen = Array.isArray(clips) ? clips.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  if (!chosen.length && whole !== true) throw new Error("Choose one or more clips, or let the app pick from the whole collection.");
  const available = await collectionClips(ws, name);
  const own = (await folderClips(ws, ownFolder, songClipsCollection(projectId))).clips.map((c) => c.name);
  const edits = await migrate(ws, projectId, own);
  const order = [...edits.order];
  const picked = { ...(edits.picked ?? {}) };
  const added: string[] = [];
  for (const clip of chosen) {
    const asset = available.find((x) => same(x.name, clip));
    if (!asset) throw new Error(`"${clip}" is not in the collection ${name} (any more). Reload the page and try again.`);
    if (order.some((e) => same(e, asset.name)) || own.some((n) => same(n, asset.name))) {
      if (picked[name]?.some((n) => same(n, asset.name))) continue; // already in the line
      throw new Error(`Your story line already has a clip called "${asset.name}". Rename one of the two files first.`);
    }
    picked[name] = [...(picked[name] ?? []), asset.name];
    order.push(asset.name);
    added.push(asset.name);
  }
  if (whole === true && !order.includes(cardKey(name))) {
    order.push(cardKey(name));
    added.push(cardKey(name));
  }
  const next = writeClipEdits(root, { ...edits, order, ...(Object.keys(picked).length ? { picked } : {}) });
  syncSongCollections(ws, projectId, next);
  return added;
}

// Remove on a collection clip or card: out of this song's story line only (the collection keeps the clip).
export async function removeFromStory(ws: Workspace, projectId: string, key: unknown): Promise<string> {
  const k = String(key ?? "");
  const { root } = songRoot(ws, projectId);
  const edits = readClipEdits(root);
  const card = cardOf(k);
  const from = card ?? Object.entries(edits.picked ?? {}).find(([, names]) => names.some((n) => same(n, k)))?.[0];
  if (!from) throw new Error(`"${k}" is not a collection clip of this song's story line.`);
  const order = edits.order.filter((e) => !same(e, k));
  const picked = Object.fromEntries(
    Object.entries(edits.picked ?? {})
      .map(([c, names]) => [c, card === null && c === from ? names.filter((n) => !same(n, k)) : names] as const)
      .filter(([, names]) => names.length),
  );
  const clipEdits = card === null ? Object.fromEntries(Object.entries(edits.clips).filter(([n]) => !same(n, k))) : edits.clips;
  const { picked: _p, ...rest } = edits;
  const next = writeClipEdits(root, { ...rest, order, clips: clipEdits, ...(Object.keys(picked).length ? { picked } : {}) });
  syncSongCollections(ws, projectId, next);
  return from;
}

// Drag and drop in the story line: every key (own clips, picked clips, cards) in the new order.
export async function setStoryOrder(ws: Workspace, projectId: string, keys: unknown): Promise<string[]> {
  if (!Array.isArray(keys) || !keys.every((x) => typeof x === "string" && x.trim())) throw new Error("The story order must be a list of the story line's clips.");
  const { root, clips: ownFolder } = songRoot(ws, projectId);
  const own = (await folderClips(ws, ownFolder, songClipsCollection(projectId))).clips;
  const story = await songStory(ws, projectId, own);
  const known = story.items.map((i) => i.key);
  const unknown = keys.filter((k) => !known.some((n) => same(n, k)));
  if (unknown.length) throw new Error(`Not in this song's story line: ${unknown.join(", ")}. Reload the page and try again.`);
  const missing = known.filter((n) => !keys.some((k) => same(k, n)));
  const edits = readClipEdits(root);
  const next = [...new Set([...keys, ...missing])];
  // Hidden clips (singing takes, clips only for a line) keep the entries they have, at the places they have.
  const roles = clipRoles(root, songRoot(ws, projectId).recipe, own.map((c) => c.name));
  const hidden = edits.order.map((e, i) => ({ e, i })).filter(({ e }) => own.some((c) => same(c.name, e) && roles.get(c.name) !== "story"));
  for (const { e, i } of hidden) next.splice(Math.min(i, next.length), 0, e);
  writeClipEdits(root, { ...edits, order: [...new Set(next)] });
  return [...keys, ...missing];
}

// Use / Omit and the story note of a picked collection clip (the song's own clips: assets.ts).
export function isPickedClip(ws: Workspace, projectId: string, name: string): string | null {
  const edits = readClipEdits(songRoot(ws, projectId).root);
  return Object.entries(edits.picked ?? {}).find(([, names]) => names.some((n) => same(n, name)))?.[0] ?? null;
}
export function setPickedClipOmit(ws: Workspace, projectId: string, name: string, omit: boolean): boolean {
  if (!isPickedClip(ws, projectId, name)) throw new Error(`No clip ${name} in this song.`);
  return isOmitted(setClipOmit(songRoot(ws, projectId).root, name, omit), name);
}
export async function setPickedClipNote(ws: Workspace, projectId: string, name: string, text: string): Promise<string | null> {
  const from = isPickedClip(ws, projectId, name);
  if (!from) throw new Error(`There is no clip "${name}" in this song.`);
  const asset = (await collectionClips(ws, from)).find((x) => same(x.name, name));
  if (!asset) throw new Error(`"${name}" is no longer in the collection ${from}.`);
  return setClipNote(songRoot(ws, projectId).root, { hash: asset.hash, clip: asset.name, text })?.text ?? null;
}
