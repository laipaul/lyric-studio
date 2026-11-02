// The song's clips.json (the storyboard's clip editor, stage 2): the story order (clip file names; clips
// not listed follow in file-name order) and per clip its usable part (in / out, seconds), speed (0.5-1,
// slow motion) and best moment (seconds; wins over the automatic one). File names stay the fallback.
//   { "order": ["03_rings.mp4", "01_hands.mp4"], "clips": { "01_hands.mp4": { "in": 1.2, "out": 6.5, "speed": 0.8, "best": 3.1 } } }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// transition: how this clip comes in (absent: the app chooses). omit: the user set the clip to Omit (Assets
// or Shape): it keeps its place in the order but Make does not use it.
export type ClipEdit = { in?: number; out?: number; speed?: number; best?: number; transition?: "cut" | "dissolve"; omit?: true };
export type ClipEdits = { order: string[]; clips: Record<string, ClipEdit> };
export const CLIP_EDITS_FILE = "clips.json";

const HELP =
  'The story order and clip edits of this song (the Storyboard tab writes it). "order": clip file names in the story order ' +
  "(clips not listed follow in file-name order). \"clips\": per clip \"omit\": true (set to Omit: not used by Make), \"in\" / \"out\" (the part used, seconds), \"speed\" (0.5-1, slow motion) and " +
  '"best" (the best moment, seconds; wins over the automatic one) and "transition" ("cut" or "dissolve": how the clip comes in; left out, the app chooses).';

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
        if (e.in !== undefined && e.out !== undefined && e.out <= e.in) problems.push(`clips["${name}"]: out must be after in`);
        else if (Object.keys(e).length) edits.clips[name] = e;
      }
    }
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
export function editOf(edits: ClipEdits, name: string): ClipEdit {
  return Object.entries(edits.clips).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? {};
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

// Use / Omit (Assets or Shape): an omitted clip keeps its place in the order; Make does not use it.
export function isOmitted(edits: ClipEdits, name: string): boolean {
  return editOf(edits, name).omit === true;
}
export function setClipOmit(songRoot: string, name: string, omit: boolean): ClipEdits {
  if (typeof name !== "string" || !name.trim()) throw new Error("Which clip?");
  const edits = readClipEdits(songRoot);
  const key = Object.keys(edits.clips).find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
  const { omit: _old, ...rest } = edits.clips[key] ?? {};
  const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => n !== key));
  const next: ClipEdit = omit ? { ...rest, omit: true } : rest;
  if (Object.keys(next).length) clips[key] = next;
  return writeClipEdits(songRoot, { ...edits, clips });
}
