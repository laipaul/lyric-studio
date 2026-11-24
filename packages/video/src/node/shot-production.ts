// Creation → Production (C3, Part 1; 22 Nov 2026, decided with Paul): "Creation should be creating the pictures and
// video takes for each Storyboard item." The shot list's planned slots (shotlist.ts) are the items, in story order and
// grouped by the song's sections. A picture dropped on an item belongs to it (pictures.json "slot"); Animate makes its
// takes there as usual; "Use this take" fills the item: the take joins the song's clips, takes the slot's place in the
// story line (clips.json "order"), and goes on the slot's lyric line (song.json anchors) when it has one. The slot
// stays in shotlist.json, marked filled (shotlist.json "filled"), so a re-import keeps it filled. A take chosen again
// for the same item replaces the earlier one there (that clip is set to Omit, never deleted).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { probeMedia, type Workspace } from "@lyric/db";
import { isWholeStory } from "./song-style";

import { nameSections, sectionOfLine, type NamedSection } from "../sections";
import { shotPrompt, type ShotPromptInput } from "../shot-prompt";
import { slotSpans } from "../shot-grid";
import { readPictures, sendToStoryboard, songFolder, update, BOARD_FILE } from "./animate";
import { readClipEdits, setClipOmit, writeClipEdits } from "./clip-edits";
import { filmLookFor, readFilmLook } from "./film-looks";
import { productionData, type CastCard } from "./production";
import { cardRoot, listCards } from "./characters/cards";
import { LOOKS_DIR, MAIN_LOOK } from "./characters/looks";
import { shotLooks, type WornLook } from "./shot-looks";
import { saveAnchors } from "./lyrics-view";
import { readRecipe } from "./recipe";
import { SHOTLIST_FILE, readShotListFile, slotKey, type Slot } from "./shotlist";
import { songPathsById } from "./song-folder";
import { songSections } from "./song-sections";
import { songText } from "./textboard";

export type ProductionShot = Slot & {
  number: number; // its place in the shot list, 1 = first (the Storyboard card's number)
  lineText: string | null;
  section: string; // "Intro", "Verse 1", "Chorus" … (the song's sections; a shot without a line follows the shot before it)
  filled: string | null; // the clip that fills it ("Use this take"), else null
  pictures: string[]; // the Creation pictures that belong to it
  prompt: string; // its Midjourney first-frame prompt (src/shot-prompt.ts), "Copy prompt"
  // A Mini film (23 Nov 2026): its two films. filledWide: the landscape take (Film 16:9); promptWide: the prompt in 16:9.
  filledWide?: string | null;
  promptWide?: string;
  // The locked pictures of the people and place in it (the look each wears in this song): Midjourney's Omni Reference.
  refs: { name: string; card: string; file: string }[]; // file: inside the card's folder (/api/cards/<card>/file/<file>)
  lineStartMs?: number | null; // when its line is sung (Compare plays the song from there); null: no line or not timed yet
  span?: { startMs: number; endMs: number } | null; // its time on the song (shot-grid.ts slotSpans): how long its take must last
  people: WornLook[]; // each character with the look they wear in this shot (shot-looks.ts)
};
export type ProductionView = { shots: ProductionShot[]; sections: string[]; places?: string[] }; // places: the cast's scene cards (each shot's Place)

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function shotListFile(ws: Workspace, projectId: string): string {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return path.join(paths.root, SHOTLIST_FILE);
}

// The section a shot belongs to. Pure. A shot on a line: that line's section. A shot without a line: the section of the
// shot before it, or "Intro" when no shot before it has a line; after the last sung line: "Ending".
export function sectionsOfShots(slots: readonly Pick<Slot, "line">[], sections: readonly NamedSection[], lineCount: number): string[] {
  let last: string | null = null;
  let afterLast = false;
  const lastLine = lineCount;
  return slots.map((s) => {
    if (s.line !== null) {
      const sec = sectionOfLine(sections as NamedSection[], s.line);
      last = sec?.name ?? `Line ${s.line}`;
      afterLast = s.line >= lastLine;
      return last;
    }
    if (last === null) return "Intro";
    return afterLast ? "Ending" : last;
  });
}

export function productionView(ws: Workspace, projectId: string): ProductionView {
  const file = shotListFile(ws, projectId);
  const list = readShotListFile(file);
  if (!list?.slots.length) return { shots: [], sections: [] };
  const filled = list.filled ?? {};
  const slots = [...list.slots].sort((a, b) => a.order - b.order);
  const text = songText(ws, projectId).lines;
  let named: NamedSection[] = [];
  try {
    named = songSections(ws, projectId).sections;
  } catch {
    named = nameSections([], text.length);
  }
  const secs = sectionsOfShots(slots, named, text.length);
  const { dir } = songFolder(ws, projectId);
  const pics = readPictures(dir).pictures;
  const clipsDir = songPathsById(ws, projectId).clips;
  // What the prompts are made of: the cast (locked descriptions, the look each wears here), the Film look, the shape.
  const data = productionData(ws, projectId);
  const card = (name: string): CastCard | null => (data.cast.find((c) => !("missing" in c && c.missing) && c.name.toLowerCase() === name.toLowerCase()) as CastCard | undefined) ?? null;
  const film = filmLookFor(ws, projectId);
  const mj = film ? readFilmLook(ws.dir, film.name)?.midjourney?.trim() || film.line : null;
  const aspect: ShotPromptInput["aspect"] = data.sizes.some((z) => z.ratio === "9:16") || !data.sizes.length ? "9:16" : "16:9";
  const wornIn = shotLooks(ws, projectId);
  const twoFilms = isWholeStory(readRecipe(songPathsById(ws, projectId).recipe), false);
  const filledWide = list.filledWide ?? {};
  const promptOf = (s: Slot, worn: WornLook[], shape: ShotPromptInput["aspect"] = twoFilms ? "9:16" : aspect) => {
    const scene = s.scene ? card(s.scene) : null;
    return shotPrompt({
      shows: s.shows,
      shot: s.shot,
      tag: s.tag,
      // Each person's outfit: a look chosen for this shot wins; else the shot's own "outfit" text (e.g. a memory's
      // everyday clothes for someone with no such look); else the look they wear in this song.
      people: s.characters.map((n) => {
        const c = card(n);
        const w = worn.find((x) => x.character.toLowerCase() === n.toLowerCase());
        const outfit = w?.fromShot ? w.outfit : (s.outfit ?? w?.outfit ?? c?.outfit ?? null);
        return { name: n, description: c?.description ?? null, outfit };
      }),
      scene: s.scene ? { name: s.scene, description: scene?.description ?? scene?.outfit ?? null } : null,
      filmLook: mj,
      aspect: shape,
    });
  };
  const folders = new Map(listCards(ws).map((c) => [c.id, c.folder] as const));
  // A person's picture in the look they wear here (its close-up, else its front view), else the card's own picture.
  const refOf = (c: CastCard): ProductionShot["refs"][number] => {
    const root = folders.get(c.id) ? cardRoot(ws, { folder: folders.get(c.id)! }) : null;
    if (root && c.kind === "character" && c.look && c.look !== MAIN_LOOK) {
      for (const f of ["closeup.png", "body_front.png"]) if (existsSync(path.join(root, LOOKS_DIR, c.look, f))) return { name: c.name, card: c.id, file: `${LOOKS_DIR}/${c.look}/${f}` };
    }
    return { name: c.name, card: c.id, file: c.thumbnail };
  };
  // The Omni Reference pictures: each person in this shot's look, then the scene card.
  const refsOf = (s: Slot, worn: WornLook[]): ProductionShot["refs"] => [
    ...worn.filter((w) => w.card && w.picture).map((w) => ({ name: w.character, card: w.card!, file: w.picture! })),
    ...(s.scene && card(s.scene) ? [refOf(card(s.scene)!)] : []),
  ];
  const shots = slots.map((s, i): ProductionShot => {
    const clip = filled[s.id];
    const worn = wornIn(s);
    return {
      ...s,
      number: i + 1,
      lineText: s.line !== null ? (text.find((l) => l.number === s.line)?.text ?? null) : null,
      section: secs[i],
      filled: clip && clipsDir && existsSync(path.join(clipsDir, clip)) ? clip : null,
      pictures: Object.entries(pics)
        .filter(([f, p]) => p.slot === s.id && existsSync(path.join(dir, f)))
        .map(([f]) => f)
        .sort(),
      prompt: promptOf(s, worn),
      ...(twoFilms ? { filledWide: filledWide[s.id] && clipsDir && existsSync(path.join(clipsDir, filledWide[s.id])) ? filledWide[s.id] : null, promptWide: promptOf(s, worn, "16:9") } : {}),
      refs: refsOf(s, worn),
      people: worn,
    };
  });
  return { shots, sections: [...new Set(secs)], places: data.cast.flatMap((c) => (!("missing" in c && c.missing) && c.kind === "scene" ? [c.name] : [])) };
}

// Each shot's line start in the song (withLineStarts, for Compare). Pure.
export function withLineStarts(view: ProductionView, timed: readonly { number: number; startMs: number | null }[] | null, durationMs?: number | null): ProductionView {
  // How long each shot lasts on the song (23 Nov 2026: "needs about 5 s"): from the timed lines and the song's length.
  const spans = timed && durationMs ? slotSpans(view.shots, timed.map((l) => ({ number: l.number, text: "", startMs: l.startMs, endMs: null })), durationMs) : null;
  return { ...view, shots: view.shots.map((s) => ({ ...s, lineStartMs: s.line !== null ? (timed?.find((l) => l.number === s.line)?.startMs ?? null) : null, span: spans?.get(s.id) ?? null })) };
}

// Bulk drop by shot (23 Nov 2026): a file named after its shot lands on it: "s05 …" / "S05_…" (a slot id, also without
// the leading zero) or "shot 5 …" / "Shot1Chapel…" (the shot's number). Null: no shot in the name. Pure.
export function shotForFileName(name: string, shots: readonly { id: string; number: number }[]): string | null {
  const base = name.replace(/\.[^.]+$/, "").trim();
  const byShot = /^shot[\s_-]*0*(\d{1,3})(?!\d)/i.exec(base);
  if (byShot) return shots.find((s) => s.number === Number(byShot[1]))?.id ?? null;
  const bySlot = /^s[\s_-]?0*(\d{1,3})(?!\d)/i.exec(base);
  if (bySlot) {
    const n = Number(bySlot[1]);
    return shots.find((s) => s.id.toLowerCase() === `s${String(n).padStart(2, "0")}` || s.id.toLowerCase() === `s${n}`)?.id ?? shots.find((s) => s.number === n)?.id ?? null;
  }
  return null;
}

// The files just added: each one named after a shot belongs to it. Returns file -> shot number.
export function placeByName(ws: Workspace, projectId: string, files: readonly string[]): Record<string, number> {
  const list = readShotListFile(shotListFile(ws, projectId));
  if (!list?.slots.length) return {};
  const shots = [...list.slots].sort((a, b) => a.order - b.order).map((s, i) => ({ id: s.id, number: i + 1 }));
  const placed: Record<string, number> = {};
  for (const f of files) {
    const id = shotForFileName(f, shots);
    if (!id) continue;
    setPictureShot(ws, projectId, f, id);
    placed[f] = shots.find((s) => s.id === id)!.number;
  }
  return placed;
}

// A Creation picture belongs to a shot (or to none: null).
export function setPictureShot(ws: Workspace, projectId: string, file: unknown, slot: unknown): string | null {
  const name = path.basename(String(file ?? ""));
  const { dir } = songFolder(ws, projectId);
  if (!name || !BOARD_FILE.test(name) || !existsSync(path.join(dir, name))) throw new Error(`No ${String(file)} in this song's Creation space.`);
  const id = slot === null || slot === undefined || slot === "" ? null : String(slot);
  if (id !== null && !readShotListFile(shotListFile(ws, projectId))?.slots.some((s) => s.id === id)) throw new Error("That shot is not in this song's shot list.");
  update(dir, name, (p) => {
    if (id === null) delete p.slot;
    else p.slot = id;
  });
  return id;
}

export type UseForShot = { clip: string; shot: number; line: number | null; replaced: string | null; note: string | null; wide?: boolean }; // wide: the Film 16:9's take

// "Use this take" on a shot: the take (or the picture itself, n null) fills that Storyboard item, in its place and on its line.
export async function useForShot(ws: Workspace, projectId: string, o: { file: unknown; n?: unknown; slot: unknown }): Promise<UseForShot> {
  const file = shotListFile(ws, projectId);
  const list = readShotListFile(file);
  const slot = list?.slots.find((s) => s.id === String(o.slot ?? ""));
  if (!list || !slot) throw new Error("That shot is not in this song's shot list.");
  const n = o.n === undefined || o.n === null ? null : Number(o.n);
  const name = path.basename(String(o.file ?? ""));
  const { clip } = await sendToStoryboard(ws, projectId, name, n);
  const root = songPathsById(ws, projectId).root;
  // A landscape take (23 Nov 2026) is the shot's take for the Film 16:9 (YouTube): remembered as such; the story line,
  // the vertical take and the lyric line stay as they are.
  const clipsDir = songPathsById(ws, projectId).clips;
  const info = clipsDir ? await probeMedia(path.join(clipsDir, clip)).catch(() => null) : null;
  if (info?.width && info.height && info.width > info.height && isWholeStory(readRecipe(songPathsById(ws, projectId).recipe), false)) {
    const wideBefore = (list.filledWide ?? {})[slot.id] ?? null;
    if (wideBefore && !same(wideBefore, clip)) setClipOmitSafe(root, wideBefore, true); // kept, out of the films
    setClipOmitSafe(root, clip, false);
    const fresh = readShotListFile(file)!;
    writeFileSync(file, `${JSON.stringify({ ...fresh, filledWide: { ...(fresh.filledWide ?? {}), [slot.id]: clip } }, null, 2)}\n`);
    const { dir } = songFolder(ws, projectId);
    if (readPictures(dir).pictures[name]) update(dir, name, (p) => void (p.slot ??= slot.id));
    const shot = [...list.slots].sort((a, b) => a.order - b.order).findIndex((s) => s.id === slot.id) + 1;
    return { clip, shot, line: slot.line, replaced: wideBefore && !same(wideBefore, clip) ? wideBefore : null, note: "A landscape take: it is this shot's take in the Film 16:9 (YouTube); the vertical film keeps its own.", wide: true };
  }
  const before = (list.filled ?? {})[slot.id] ?? null;
  const replaced = before && !same(before, clip) ? before : null;

  // The story line: the clip takes the slot's place (or the place of the clip that filled it before).
  const edits = readClipEdits(root);
  const at = (e: string) => e === slotKey(slot.id) || (replaced !== null && same(e, replaced));
  let order = edits.order.filter((e) => !same(e, clip));
  const index = order.findIndex(at);
  if (index < 0) order.push(clip);
  else order[index] = clip;
  order = order.filter((e) => e !== slotKey(slot.id));
  writeClipEdits(root, { ...edits, order });
  if (replaced) {
    try {
      setClipOmit(root, replaced, true); // stays in the Storyboard and Creation, out of the videos
    } catch {
      // no longer a song clip
    }
  }
  setClipOmitSafe(root, clip, false);

  // Remembered on the shot list, so a re-import keeps the item filled.
  const fresh = readShotListFile(file)!;
  writeFileSync(file, `${JSON.stringify({ ...fresh, filled: { ...(fresh.filled ?? {}), [slot.id]: clip } }, null, 2)}\n`);

  // Its lyric line: the clip shows on it (a line a singing take covers keeps its singer).
  let note: string | null = null;
  if (slot.line !== null) {
    const paths = songPathsById(ws, projectId);
    const anchors = paths.recipe ? (readRecipe(paths.recipe).anchors ?? []) : [];
    const singing = anchors.find((a) => a.sync !== undefined && a.line <= slot.line! && slot.line! <= (a.through ?? a.line));
    if (singing) note = `Line ${slot.line} is sung by a singing take: the clip is in the story line, the singer stays on the line.`;
    else saveAnchors(ws, projectId, [...anchors.filter((a) => a.line !== slot.line && !(replaced && same(a.clip, replaced))), { line: slot.line, clip }]);
  }
  // The picture's take is marked as used for this shot.
  const { dir } = songFolder(ws, projectId);
  if (readPictures(dir).pictures[name]) update(dir, name, (p) => void (p.slot ??= slot.id));
  const shot = [...list.slots].sort((a, b) => a.order - b.order).findIndex((s) => s.id === slot.id) + 1;
  return { clip, shot, line: slot.line, replaced, note };
}

function setClipOmitSafe(root: string, clip: string, omit: boolean): void {
  try {
    const edits = readClipEdits(root);
    const key = Object.keys(edits.clips).find((c) => same(c, clip));
    if (key && edits.clips[key]?.omit) setClipOmit(root, clip, omit);
  } catch {
    // nothing to change
  }
}
