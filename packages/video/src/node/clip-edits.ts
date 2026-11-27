// The song's clips.json (the storyboard's clip editor, stage 2): the story order (clip file names; clips
// not listed follow in file-name order) and per clip its usable part (in / out, seconds), speed (0.5-1,
// slow motion) and best moment (seconds; wins over the automatic one). File names stay the fallback.
//   { "order": ["03_rings.mp4", "01_hands.mp4"], "clips": { "01_hands.mp4": { "in": 1.2, "out": 6.5, "speed": 0.8, "best": 3.1 } } }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CutMove, Slip } from "../timeline-edits";

// transition: how this clip comes in (absent: the app chooses). omit: the user set the clip to Omit (Assets
// or Shape): it keeps its place in the order but Make does not use it.
// lineOnly: the clip is in clips\ only so a Lyrics Sync line (anchor) or a hidden-moment cover can use it; it is not a story moment
// (not listed in the Storyboard, never gap fill). A normal "Send to Storyboard" from Creation clears it.
// label (21 Nov 2026): a short name the user gives the clip ("Bride smile"); shown instead of the file name, which stays.
// cast (26 Nov 2026, Cast Library): the characters who appear in the clip, by their card id (a renamed character keeps
// its tags; a removed one shows greyed out). Display only: cutting, timing and rendering never read it.
// lipsync (26 Nov 2026, Nextgen step 2): the singing slot accepted for this clip (lipsync.ts). Display only as well.
export type LipsyncMark = { slot: string; lines: [number, number]; fromMs: number; toMs: number };
export type ClipEdit = { in?: number; out?: number; speed?: number; best?: number; transition?: "cut" | "dissolve"; omit?: true; label?: string; lineOnly?: true; cast?: string[]; lipsync?: LipsyncMark };
export const LABEL_MAX = 60;
// A short name as typed: spaces tidied, at most 60 characters ("" = no name).
export const cleanLabel = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
// cuts / slips: the Shape timeline's roll and slip edits, on the song's timeline (src/timeline-edits.ts).
// picked (11 Nov 2026): clips of a shared collection chosen one by one into the story line ({ "Flowers": ["03_rose.mp4"] });
// "order" names them like the song's own clips, and holds "collection:Flowers" for a whole collection the app picks
// from (one card in the story line: that collection's clips without a place of their own play there).
export type Insert = { from: number; to: number; clip: string }; // song seconds: a B-roll clip over that stretch (Shape's "B-roll here", inserts.ts)
export type ClipEdits = { order: string[]; clips: Record<string, ClipEdit>; cuts?: CutMove[]; slips?: Slip[]; inserts?: Insert[]; picked?: Record<string, string[]> };
export const CARD_PREFIX = "collection:";
export const cardKey = (collection: string) => `${CARD_PREFIX}${collection}`;
export const cardOf = (entry: string): string | null => (entry.startsWith(CARD_PREFIX) ? entry.slice(CARD_PREFIX.length) : null);
export const CLIP_EDITS_FILE = "clips.json";

const HELP =
  'The story order and clip edits of this song (Prepare → Storyboard writes the order, Shape the clip edits). "order": clip file names in the story order ' +
  "(clips not listed follow in file-name order). \"clips\": per clip \"label\" (a short name shown instead of the file name), \"omit\": true (set to Omit: not used by Make), \"lineOnly\": true (only for a Lyrics Sync line or a hidden-moment cover: not a story moment, never fills gaps), \"in\" / \"out\" (the part used, seconds), \"speed\" (0.5-1, slow motion) and " +
  '"best" (the best moment, seconds; wins over the automatic one) and "transition" ("cut" or "dissolve": how the clip comes in; left out, the app chooses). ' +
  '"cuts": cuts moved on the Shape timeline (song seconds: the planned cut at "from" goes to "to", on the beat unless "free"). ' +
  '"slips": shots that play another part of their clip ("at": the shot\'s start in the song, "clip", "in": seconds into the clip). ' +
  '"inserts": B-roll laid over a stretch of the edit (Shape\'s B-roll here: song seconds "from" / "to", "clip"; on the beat). ' +
  '"picked": clips of a shared collection put into the story line one by one ({ "Flowers": ["03_rose.mp4"] }); in "order", ' +
  '"collection:Flowers" is a whole collection the app picks from (its other clips play at that place).';

export function checkClipEdits(raw: unknown): { edits: ClipEdits; problems: string[] } {
  const problems: string[] = [];
  const edits: ClipEdits = { order: [], clips: {} };
  if (!raw || typeof raw !== "object") return { edits, problems: ["clips.json must be a JSON object"] };
  const r = raw as Record<string, unknown>;
  if (r.order !== undefined) {
    if (Array.isArray(r.order) && r.order.every((x) => typeof x === "string")) edits.order = [...new Set(r.order as string[])];
    else problems.push('order must be a list of clip file names, e.g. ["01_a.mp4"]');
  }
  if (r.clips !== undefined) {
    if (!r.clips || typeof r.clips !== "object" || Array.isArray(r.clips)) problems.push("clips must be an object: { \"01_a.mp4\": { \"in\": 1.2 } }");
    else {
      for (const [name, v] of Object.entries(r.clips as Record<string, Record<string, unknown>>)) {
        const e: ClipEdit = {};
        const num = (k: "in" | "out" | "speed" | "best", min: number, max: number) => {
          if (v?.[k] === undefined || v?.[k] === null) return;
          if (typeof v[k] === "number" && (v[k] as number) >= min && (v[k] as number) <= max) e[k] = Math.round((v[k] as number) * 100) / 100;
          else problems.push(`clips["${name}"].${k} must be a number from ${min} to ${max}`);
        };
        num("in", 0, 36_000);
        num("out", 0, 36_000);
        num("speed", 0.5, 1);
        num("best", 0, 36_000);
        if (v?.transition !== undefined && v?.transition !== null) {
          if (v.transition === "cut" || v.transition === "dissolve") e.transition = v.transition;
          else problems.push(`clips["${name}"].transition must be "cut" or "dissolve" (leave it out: the app chooses)`);
        }
        if (v?.omit !== undefined && v?.omit !== null && v?.omit !== false) {
          if (v.omit === true) e.omit = true;
          else problems.push(`clips["${name}"].omit must be true (or left out: the clip is used)`);
        }
        if (v?.lineOnly !== undefined && v?.lineOnly !== null && v?.lineOnly !== false) {
          if (v.lineOnly === true) e.lineOnly = true;
          else problems.push(`clips["${name}"].lineOnly must be true (or left out: the clip is a story moment)`);
        }
        if (v?.label !== undefined && v?.label !== null) {
          if (typeof v.label === "string") {
            const label = cleanLabel(v.label);
            if (label) e.label = label;
          } else problems.push(`clips["${name}"].label must be a short name (text)`);
        }
        if (v?.cast !== undefined && v?.cast !== null) {
          if (Array.isArray(v.cast) && v.cast.every((x: unknown) => typeof x === "string" && x.trim())) {
            const ids = [...new Set((v.cast as string[]).map((x) => x.trim()))];
            if (ids.length) e.cast = ids;
          } else problems.push(`clips["${name}"].cast must be a list of character ids`);
        }
        if (v?.lipsync !== undefined && v?.lipsync !== null) {
          const l = v.lipsync as Partial<LipsyncMark>;
          if (typeof l.slot === "string" && Array.isArray(l.lines) && l.lines.length === 2 && l.lines.every((n) => Number.isInteger(n)) && typeof l.fromMs === "number" && typeof l.toMs === "number")
            e.lipsync = { slot: l.slot, lines: [l.lines[0], l.lines[1]], fromMs: l.fromMs, toMs: l.toMs };
          else problems.push(`clips["${name}"].lipsync must be like { "slot": "L5-6", "lines": [5, 6], "fromMs": 54200, "toMs": 61400 }`);
        }
        if (e.in !== undefined && e.out !== undefined && e.out <= e.in) problems.push(`clips["${name}"]: out must be after in`);
        else if (Object.keys(e).length) edits.clips[name] = e;
      }
    }
  }
  if (r.cuts !== undefined) {
    const ok = Array.isArray(r.cuts) && r.cuts.every((c) => c && typeof c === "object" && typeof c.from === "number" && typeof c.to === "number" && c.from >= 0 && c.to >= 0 && (c.free === undefined || c.free === true));
    if (ok) edits.cuts = (r.cuts as CutMove[]).map((c) => ({ from: Math.round(c.from * 100) / 100, to: Math.round(c.to * 100) / 100, ...(c.free ? { free: true as const } : {}) }));
    else problems.push('cuts must be a list like [{ "from": 47.8, "to": 48.3 }] (song seconds)');
  }
  if (r.slips !== undefined) {
    const ok = Array.isArray(r.slips) && r.slips.every((x) => x && typeof x === "object" && typeof x.at === "number" && typeof x.clip === "string" && x.clip.trim() && typeof x.in === "number" && x.at >= 0 && x.in >= 0);
    if (ok) edits.slips = (r.slips as Slip[]).map((x) => ({ at: Math.round(x.at * 100) / 100, clip: x.clip, in: Math.round(x.in * 100) / 100 }));
    else problems.push('slips must be a list like [{ "at": 48.3, "clip": "06_rings.mp4", "in": 1.4 }]');
  }
  if (r.inserts !== undefined) {
    const ok = Array.isArray(r.inserts) && r.inserts.every((x) => x && typeof x === "object" && typeof x.from === "number" && typeof x.to === "number" && x.from >= 0 && x.to > x.from && typeof x.clip === "string" && x.clip.trim());
    if (ok) edits.inserts = (r.inserts as Insert[]).map((x) => ({ from: Math.round(x.from * 100) / 100, to: Math.round(x.to * 100) / 100, clip: x.clip })).sort((a, b) => a.from - b.from);
    else problems.push('inserts must be a list like [{ "from": 48.3, "to": 50.2, "clip": "06_rings.mp4" }]');
  }
  if (r.picked !== undefined) {
    const ok = !!r.picked && typeof r.picked === "object" && !Array.isArray(r.picked) && Object.values(r.picked as Record<string, unknown>).every((v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim()));
    if (ok) {
      const picked = Object.fromEntries(Object.entries(r.picked as Record<string, string[]>).filter(([k, v]) => k.trim() && v.length).map(([k, v]) => [k, [...new Set(v)]]));
      if (Object.keys(picked).length) edits.picked = picked;
    } else problems.push('picked must be like { "Flowers": ["03_rose.mp4"] } (collection name: clip file names)');
  }
  return { edits, problems };
}

export function readClipEdits(songRoot: string): ClipEdits {
  const file = path.join(songRoot, CLIP_EDITS_FILE);
  if (!existsSync(file)) return { order: [], clips: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message})`);
  }
  const { edits, problems } = checkClipEdits(raw);
  if (problems.length) throw new Error(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);
  return edits;
}

export function writeClipEdits(songRoot: string, edits: unknown): ClipEdits {
  const { edits: checked, problems } = checkClipEdits(edits);
  if (problems.length) throw new Error(problems.join("; "));
  writeFileSync(path.join(songRoot, CLIP_EDITS_FILE), `${JSON.stringify({ _help: HELP, ...checked }, null, 2)}\n`);
  return checked;
}

// A clip's rank in the story order (clips.json), or undefined (then it follows by file name).
export function rankOf(edits: ClipEdits, name: string): number | undefined {
  const i = edits.order.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  return i >= 0 ? i : undefined;
}
// Clip names match case-insensitively and regardless of Unicode form (NFC / NFD, as Windows and macOS file names differ).
export const clipKey = (name: string): string => name.normalize("NFC").toLowerCase();
export const sameClip = (a: string, b: string): boolean => clipKey(a) === clipKey(b);
export function editOf(edits: ClipEdits, name: string): ClipEdit {
  return Object.entries(edits.clips).find(([n]) => sameClip(n, name))?.[1] ?? {};
}

// ---- The song's clip order, one sequence for Assets, Shape and Make (2 Nov 2026) ----
// clips.json "order" may also hold shared-collection clips (Shape's strip shows both); the Assets tab
// only moves the song's own clips, inside the places they already hold, so collection clips keep theirs.
const byFileName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Names in the song's order: the listed ones first (as listed), then the others by file name.
export function inClipOrder(edits: ClipEdits, names: readonly string[]): string[] {
  return [...names].sort((a, b) => (rankOf(edits, a) ?? Infinity) - (rankOf(edits, b) ?? Infinity) || byFileName(a, b));
}

// The full order with the song's own clips put in `songOrder`: they take the places song clips already
// hold, in the new sequence; song clips with no place yet go at the end. Other names (collection clips,
// or a clip removed from the folder) stay where they are.
export function withSongOrder(edits: ClipEdits, songClips: readonly string[], songOrder: readonly string[]): ClipEdits {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const isSong = (n: string) => songClips.some((c) => same(c, n));
  const next = songOrder.filter(isSong).filter((n, i, all) => all.findIndex((x) => same(x, n)) === i);
  for (const c of inClipOrder(edits, songClips)) if (!next.some((n) => same(n, c))) next.push(c); // never drop a clip
  const queue = [...next];
  const order: string[] = [];
  for (const n of edits.order) {
    if (!isSong(n)) order.push(n);
    else {
      const take = queue.shift();
      if (take) order.push(take);
    }
  }
  order.push(...queue);
  return { ...edits, order };
}

// Saves the song clips' order (Assets drag and drop, new clips at the end, Remove / Restore). `forget`:
// names taken out of the order (a removed clip).
export function saveSongClipOrder(songRoot: string, songClips: readonly string[], songOrder: readonly string[], options: { forget?: readonly string[] } = {}): ClipEdits {
  const edits = readClipEdits(songRoot);
  const forget = (options.forget ?? []).map((f) => f.toLowerCase());
  const kept = { ...edits, order: edits.order.filter((n) => !forget.includes(n.toLowerCase())) };
  return writeClipEdits(songRoot, withSongOrder(kept, songClips, songOrder));
}

// Use / Omit (Prepare → Storyboard or Shape → Shots): an omitted clip keeps its place in the order; Make does not use it.
export function isOmitted(edits: ClipEdits, name: string): boolean {
  return editOf(edits, name).omit === true;
}
export function setClipOmit(songRoot: string, name: string, omit: boolean): ClipEdits {
  if (typeof name !== "string" || !name.trim()) throw new Error("Which clip?");
  const edits = readClipEdits(songRoot);
  const key = Object.keys(edits.clips).find((n) => sameClip(n, name)) ?? name;
  const { omit: _old, ...rest } = edits.clips[key] ?? {};
  const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => n !== key));
  const next: ClipEdit = omit ? { ...rest, omit: true } : rest;
  if (Object.keys(next).length) clips[key] = next;
  return writeClipEdits(songRoot, { ...edits, clips });
}

// lineOnly on / off for one clip (Send to Storyboard from a Lyrics Sync line / from Creation). Nothing else about the clip changes.
export function isLineOnly(edits: ClipEdits, name: string): boolean {
  return editOf(edits, name).lineOnly === true;
}
export function setClipLineOnly(songRoot: string, name: string, lineOnly: boolean): ClipEdits {
  const edits = readClipEdits(songRoot);
  const key = Object.keys(edits.clips).find((n) => sameClip(n, name)) ?? name;
  const { lineOnly: _old, ...rest } = edits.clips[key] ?? {};
  const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => n !== key));
  const next: ClipEdit = lineOnly ? { ...rest, lineOnly: true } : rest;
  if (Object.keys(next).length) clips[key] = next;
  return writeClipEdits(songRoot, { ...edits, clips });
}

// Who appears in a clip (the Storyboard's cast chips): character card ids, in the order tagged; [] removes them all.
export function setClipCast(songRoot: string, name: string, ids: readonly string[]): ClipEdits {
  if (typeof name !== "string" || !name.trim()) throw new Error("Which clip?");
  const edits = readClipEdits(songRoot);
  const key = Object.keys(edits.clips).find((n) => sameClip(n, name)) ?? name;
  const { cast: _old, ...rest } = edits.clips[key] ?? {};
  const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => n !== key));
  const unique = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  const next: ClipEdit = unique.length ? { ...rest, cast: unique } : rest;
  if (Object.keys(next).length) clips[key] = next;
  return writeClipEdits(songRoot, { ...edits, clips });
}

// A clip's short name (null or "": back to its file name).
export function setClipLabel(songRoot: string, name: string, label: unknown): ClipEdits {
  if (typeof name !== "string" || !name.trim()) throw new Error("Which clip?");
  const edits = readClipEdits(songRoot);
  const key = Object.keys(edits.clips).find((n) => sameClip(n, name)) ?? name;
  const { label: _old, ...rest } = edits.clips[key] ?? {};
  const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => n !== key));
  const text = cleanLabel(label);
  const next: ClipEdit = text ? { ...rest, label: text } : rest;
  if (Object.keys(next).length) clips[key] = next;
  return writeClipEdits(songRoot, { ...edits, clips });
}

// ---- Shared-collection clips in the story line (Prepare → Storyboard, 11 Nov 2026) ----
// Which clips of a shared collection the song's story line uses: the picked ones, or null = all of them (a
// "collection:<name>" card, or a song from before the picker: the whole collection, as before).
export function storyPick(edits: ClipEdits, collection: string): string[] | null {
  if (edits.order.includes(cardKey(collection))) return null;
  const picked = edits.picked?.[collection];
  return picked?.length ? picked : null;
}

// The story order with each card replaced by its collection's clips that have no place of their own (by file
// name), so every clip has its rank. `clipsOf`: each collection's clip names.
export function expandCards(edits: ClipEdits, clipsOf: Readonly<Record<string, readonly string[]>>): ClipEdits {
  if (!edits.order.some((e) => cardOf(e) !== null)) return edits;
  const listed = new Set(edits.order.filter((e) => cardOf(e) === null).map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const order = edits.order.flatMap((e) => {
    const c = cardOf(e);
    if (c === null) return [e];
    const names = [...(clipsOf[c] ?? [])].filter((n) => !listed.has(n.toLowerCase()) && !seen.has(n.toLowerCase())).sort(byFileName);
    for (const n of names) seen.add(n.toLowerCase());
    return names;
  });
  return { ...edits, order };
}
