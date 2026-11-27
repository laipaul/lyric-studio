// The storyboard's edits (stage 2): the story order (drag clips into order), a clip's in / out, speed and
// best moment (the clip editor), and story anchors (drag a clip onto a lyric line). Order and clip edits
// go to the song's clips.json, anchors to song.json; every change is followed by a new plan, so
// Generate renders exactly what the storyboard shows.
import type { Workspace } from "@lyric/db";

import { checkAnchors, type AnchorSpec, type AnchorTransition } from "../anchors";
import { mergeTimeline, resetShot, swapInStory, type CutMove, type Slip, type TimelineEdits } from "../timeline-edits";
import { readClipEdits, setClipOmit, withSongOrder, writeClipEdits, type ClipEdit, type ClipEdits } from "./clip-edits";
import { saveAnchors } from "./lyrics-view";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export type StoryboardEdit =
  | { action: "order"; order: string[] } // clip file names, the whole story order
  | { action: "swap"; a: string; b: string; order: string[] } // a clip lifted onto another shot: the two swap places (order: the story order now); anchors follow their clips
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
  | { action: "timeline"; timeline: TimelineEdits }
  // "B-roll here" (27 Nov 2026): a B-roll clip laid over a stretch (song seconds) of a B-roll shot, or over a singing
  // shot as its cut-away (the take's "hide": the singer comes back in time); "end" moves its end; "remove" takes it out.
  | { action: "broll"; kind: "insert" | "cutaway"; from: number; to: number; clip: string }
  | { action: "broll-end"; kind: "insert" | "cutaway"; from: number; to: number }
  | { action: "broll-remove"; kind: "insert" | "cutaway"; from: number };
export const STORYBOARD_ACTIONS = ["order", "swap", "clip", "omit", "anchor", "unanchor", "canvas", "roll", "slip", "timeline-reset", "timeline", "broll", "broll-end", "broll-remove"] as const;

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
  } else if (e.action === "swap") {
    const named = (x: unknown) => typeof x === "string" && x.trim() !== "";
    if (!named(e.a) || !named(e.b) || same(e.a, e.b)) throw new Error("Which two clips?");
    if (!Array.isArray(e.order) || !e.order.every(named)) throw new Error("The story order must be a list of clip file names.");
    if (!e.order.some((n) => same(n, e.a)) || !e.order.some((n) => same(n, e.b))) throw new Error("Both clips must be in the story order.");
    const swapped = swapInStory(e.order, anchors, e.a, e.b);
    edits = writeClipEdits(paths.root, withSongOrder(edits, swapped.order, swapped.order));
    if (anchors.some((x) => same(x.clip, e.a) || same(x.clip, e.b))) anchors = saveAnchors(ws, projectId, swapped.anchors);
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
  } else if (e.action === "broll" || e.action === "broll-end" || e.action === "broll-remove") {
    const from = Number(e.from);
    if (!Number.isFinite(from) || from < 0) throw new Error("Where in the song?");
    const to = "to" in e ? Number(e.to) : NaN;
    if (e.action !== "broll-remove" && (!Number.isFinite(to) || to <= from + 0.2)) throw new Error("The B-roll needs an end after its start.");
    if (e.action === "broll" && (typeof e.clip !== "string" || !e.clip.trim())) throw new Error("Which clip?");
    const near = (a: number, b: number) => Math.abs(a - b) < 0.35;
    if (e.kind === "insert") {
      const list = edits.inserts ?? [];
      const others = list.filter((x) => !near(x.from, from));
      const before = list.find((x) => near(x.from, from));
      const next =
        e.action === "broll" ? [...others.filter((x) => !(from < x.to && x.from < to)), { from, to, clip: e.clip }]
        : e.action === "broll-end" ? (before ? [...others, { ...before, to }] : list)
        : others;
      edits = writeClipEdits(paths.root, { ...edits, inserts: next.length ? next : undefined });
    } else {
      // The singing take playing at `from`: the latest singing anchor that starts by then.
      const sung = anchors.filter((a) => a.sync !== undefined && a.sync <= from + 0.01).sort((a, b) => b.sync! - a.sync!)[0];
      if (!sung) throw new Error("No singing take plays there: use Insert at playhead instead.");
      const at = Math.round((from - sung.sync!) * 100) / 100;
      const hide = [...(sung.hide ?? [])];
      const k = hide.findIndex((h) => near(h.from, at));
      if (e.action === "broll") {
        const end = Math.round((to - sung.sync!) * 100) / 100;
        const kept = hide.filter((h) => !(at < h.to && h.from < end));
        kept.push({ from: at, to: end, clip: e.clip });
        sung.hide = kept.sort((x, y) => x.from - y.from);
      } else if (k >= 0) {
        if (e.action === "broll-end") hide[k] = { ...hide[k], to: Math.round((to - sung.sync!) * 100) / 100 };
        else hide.splice(k, 1);
        sung.hide = hide.length ? hide : undefined;
      }
      if (!sung.hide?.length) delete sung.hide;
      anchors = saveAnchors(ws, projectId, anchors);
    }
  } else {
    throw new Error("Unknown shot plan edit.");
  }
  return { edits, anchors };
}
