// The storyboard's edits (stage 2): the story order (drag clips into order), a clip's in / out, speed and
// best moment (the clip editor), and story anchors (drag a clip onto a lyric line). Order and clip edits
// go to the song's clips.json, anchors to song.json; every change is followed by a new plan, so
// Generate renders exactly what the storyboard shows.
import type { Workspace } from "@lyric/db";

import { checkAnchors, type AnchorSpec, type AnchorTransition } from "../anchors";
import { readClipEdits, writeClipEdits, type ClipEdit, type ClipEdits } from "./clip-edits";
import { saveAnchors } from "./lyrics-view";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export type StoryboardEdit =
  | { action: "order"; order: string[] } // clip file names, the whole story order
  | { action: "clip"; clip: string; edit: ClipEdit | null } // null: back to the whole clip, normal speed, the automatic best moment
  | { action: "anchor"; line: number; clip: string; transition?: AnchorTransition }
  | { action: "unanchor"; line: number };

export type StoryboardEditResult = { edits: ClipEdits; anchors: AnchorSpec[] };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function storyboardEdit(ws: Workspace, projectId: string, e: StoryboardEdit): StoryboardEditResult {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy || !paths.recipe) throw new Error("This song still uses the old folders: migrate it first (Library → Migrate).");
  let edits = readClipEdits(paths.root);
  let anchors = readRecipe(paths.recipe).anchors ?? [];
  if (e.action === "order") {
    if (!Array.isArray(e.order) || !e.order.every((x) => typeof x === "string" && x.trim())) throw new Error("The story order must be a list of clip file names.");
    edits = writeClipEdits(paths.root, { ...edits, order: e.order });
  } else if (e.action === "clip") {
    if (typeof e.clip !== "string" || !e.clip.trim()) throw new Error("Which clip?");
    const clips = Object.fromEntries(Object.entries(edits.clips).filter(([n]) => !same(n, e.clip)));
    const edit = Object.fromEntries(Object.entries(e.edit ?? {}).filter(([, v]) => v !== null && v !== undefined));
    if (Object.keys(edit).length) clips[e.clip] = edit as ClipEdit;
    edits = writeClipEdits(paths.root, { ...edits, clips });
  } else if (e.action === "anchor") {
    const next = [...anchors.filter((a) => a.line !== e.line), { line: e.line, clip: e.clip, ...(e.transition ? { transition: e.transition } : {}) }];
    const { problems } = checkAnchors(next);
    if (problems.length) throw new Error(problems.join("; "));
    anchors = saveAnchors(ws, projectId, next);
  } else if (e.action === "unanchor") {
    anchors = saveAnchors(ws, projectId, anchors.filter((a) => a.line !== e.line));
  } else {
    throw new Error("Unknown storyboard edit.");
  }
  return { edits, anchors };
}
