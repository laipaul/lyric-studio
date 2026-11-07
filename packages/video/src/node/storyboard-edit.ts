// The storyboard's edits (stage 2): the story order (drag clips into order), a clip's in / out, speed and
// best moment (the clip editor), and story anchors (drag a clip onto a lyric line). Order and clip edits
// go to the song's clips.json, anchors to song.json; every change is followed by a new plan, so
// Generate renders exactly what the storyboard shows.
import type { Workspace } from "@lyric/db";

import { checkAnchors, type AnchorSpec, type AnchorTransition } from "../anchors";
import { mergeTimeline, resetShot, type CutMove, type Slip, type TimelineEdits } from "../timeline-edits";
import { readClipEdits, setClipOmit, withSongOrder, writeClipEdits, type ClipEdit, type ClipEdits } from "./clip-edits";
import { saveAnchors } from "./lyrics-view";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export type StoryboardEdit =
  | { action: "order"; order: string[] } // clip file names, the whole story order
  | { action: "clip"; clip: string; edit: ClipEdit | null } // null: back to the whole clip, normal speed, the automatic best moment (Use / Omit is kept)
  | { action: "omit"; clip: string; omit: boolean } // Use / Omit (the same switch as in Assets)
  | { action: "anchor"; line: number; clip: string; transition?: AnchorTransition }
  | { action: "unanchor"; line: number }
  | { action: "canvas"; clip: string | null; at?: number } // the clip (and moment) for the Spotify Canvas; null: the app chooses
  // The Shape timeline (src/timeline-edits.ts, song time): a roll (a cut moved, with the slips that keep the
  // frames around it), a slip, "↺ automatic" on a shot, or a whole timeline back (Undo / Redo).
  | { action: "roll"; move: CutMove; slips?: Slip[] }
  | { action: "slip"; slip: Slip }
  | { action: "timeline-reset"; startMs: number; endMs: number }
  | { action: "timeline"; timeline: TimelineEdits };
export const STORYBOARD_ACTIONS = ["order", "clip", "omit", "anchor", "unanchor", "canvas", "roll", "slip", "timeline-reset", "timeline"] as const;

// before / after: the timeline edits around a timeline action, for Undo / Redo.
export type StoryboardEditResult = { edits: ClipEdits; anchors: AnchorSpec[]; before?: TimelineEdits; after?: TimelineEdits };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function storyboardEdit(ws: Workspace, projectId: string, e: StoryboardEdit): StoryboardEditResult {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.recipe) throw new Error("This song still uses the old folders: migrate it first (Library → Migrate).");
  let edits = readClipEdits(paths.root);
  let anchors = readRecipe(paths.recipe).anchors ?? [];
  if (e.action === "order") {
    if (!Array.isArray(e.order) || !e.order.every((x) => typeof x === "string" && x.trim())) throw new Error("The story order must be a list of clip file names.");
    // Only the clips Shape shows move, inside the places they hold; clips this platform cannot use (and
    // other names in the order) keep theirs, so Assets and Shape stay one sequence.
    edits = writeClipEdits(paths.root, withSongOrder(edits, e.order, e.order));
  } else if (e.action === "clip") {
    if (typeof e.clip !== "string" || !e.clip.trim()) throw new Error("Which clip?");
    const omitted = Object.entries(edits.clips).find(([n]) => same(n, e.clip))?.[1]?.omit === true;
    const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => !same(n, e.clip)));
    const edit = Object.fromEntries(Object.entries({ ...(e.edit ?? {}), ...(omitted && e.edit?.omit === undefined ? { omit: true } : {}) }).filter(([, v]) => v !== null && v !== undefined));
    if (Object.keys(edit).length) clips[e.clip] = edit as ClipEdit;
    edits = writeClipEdits(paths.root, { ...edits, clips });
  } else if (e.action === "omit") {
    edits = setClipOmit(paths.root, e.clip, e.omit === true);
  } else if (e.action === "anchor") {
    const next = [...anchors.filter((a) => a.line !== e.line), { line: e.line, clip: e.clip, ...(e.transition ? { transition: e.transition } : {}) }];
    const { problems } = checkAnchors(next);
    if (problems.length) throw new Error(problems.join("; "));
    anchors = saveAnchors(ws, projectId, next);
  } else if (e.action === "canvas") {
    const recipe = readRecipe(paths.recipe);
    const next = { ...recipe, canvas: e.clip ? { clip: e.clip, ...(typeof e.at === "number" && e.at >= 0 ? { at: Math.round(e.at * 100) / 100 } : {}) } : undefined };
    writeRecipe(paths.recipe, next);
  } else if (e.action === "unanchor") {
    anchors = saveAnchors(ws, projectId, anchors.filter((a) => a.line !== e.line));
  } else if (e.action === "roll" || e.action === "slip" || e.action === "timeline-reset" || e.action === "timeline") {
    const before: TimelineEdits = { cuts: edits.cuts ?? [], slips: edits.slips ?? [] };
    const after =
      e.action === "roll" ? mergeTimeline(before, { move: e.move, slips: e.slips ?? [] })
      : e.action === "slip" ? mergeTimeline(before, { slips: [e.slip] })
      : e.action === "timeline-reset" ? resetShot(before, e.startMs, e.endMs)
      : { cuts: e.timeline?.cuts ?? [], slips: e.timeline?.slips ?? [] };
    edits = writeClipEdits(paths.root, { ...edits, cuts: after.cuts, slips: after.slips });
    return { edits, anchors, before, after: { cuts: edits.cuts ?? [], slips: edits.slips ?? [] } };
  } else {
    throw new Error("Unknown storyboard edit.");
  }
  return { edits, anchors };
}
