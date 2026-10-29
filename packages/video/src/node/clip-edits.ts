// The song's clips.json (the storyboard's clip editor, stage 2): the story order (clip file names; clips
// not listed follow in file-name order) and per clip its usable part (in / out, seconds), speed (0.5-1,
// slow motion) and best moment (seconds; wins over the automatic one). File names stay the fallback.
//   { "order": ["03_rings.mp4", "01_hands.mp4"], "clips": { "01_hands.mp4": { "in": 1.2, "out": 6.5, "speed": 0.8, "best": 3.1 } } }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ClipEdit = { in?: number; out?: number; speed?: number; best?: number; transition?: "cut" | "dissolve" }; // transition: how this clip comes in (absent: the app chooses)
export type ClipEdits = { order: string[]; clips: Record<string, ClipEdit> };
export const CLIP_EDITS_FILE = "clips.json";

const HELP =
  'The story order and clip edits of this song (the Storyboard tab writes it). "order": clip file names in the story order ' +
  "(clips not listed follow in file-name order). \"clips\": per clip \"in\" / \"out\" (the part used, seconds), \"speed\" (0.5-1, slow motion) and " +
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
