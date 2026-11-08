"use client";

// The Shape timeline's pro edits with the mouse (7 Nov 2026, asked by the user: "like the pros do"):
//   roll  drag the line between two shots: the cut moves (on the beat; Alt: exactly where you let go), one
//         shot gets longer and the other shorter, nothing else moves (the music is fixed);
//   slip  drag inside a shot: it keeps its place and length, another part of its clip plays in it;
//   trim  drag the outer edge of the first shot (its start) or of the last shot (its end): the clip starts
//         later / ends sooner in its own footage; the video keeps its music, so the shot keeps its place;
//   lift  (8 Nov 2026, asked by the user) drag a shot upwards first to lift it, then over another shot and let
//         go: the two clips swap places (story order, anchors follow; the cuts stay); Esc or a drop elsewhere cancels.
// While dragging: a readout (+0.5 s · the two shots' lengths / the clip's new start) and the clip's frame at
// the edge in a small preview. Saved on the song's timeline (clips.json "cuts" / "slips", see
// packages/video/src/timeline-edits.ts) and planned again; Ctrl+Z / Ctrl+Shift+Z undo and redo.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  MATCH_MS,
  rollEdit,
  slipEdit,
  snapRollMs,
  type EditShot,
  type StoryShot,
  type TimelineEdits,
} from "@lyric/video";
import type { StoryboardView } from "@lyric/video/node"; // types only

import { trackPointer } from "./pointer-track";

export type TimelinePost = (
  body: Record<string, unknown>,
) => Promise<{ before?: TimelineEdits; after?: TimelineEdits } | null>;

type Drag =
  | {
      kind: "roll";
      cut: number;
      startX: number;
      fromMs: number;
      atMs: number;
      free: boolean;
    } // cut: index of the shot it starts
  | {
      kind: "slip";
      shot: number;
      startX: number;
      startY: number;
      rowLeft: number; // the shots row's left edge on screen (to find the shot under the pointer once lifted)
      canSlip: boolean; // video shots only; any shot can be lifted
      deltaMs: number;
      active: boolean;
    }
  | {
      kind: "lift";
      shot: number;
      x: number; // the pointer now (client)
      y: number;
      rowLeft: number;
      over: number | null; // the shot under the pointer (its index)
    }
  | {
      kind: "trim";
      edge: "start" | "end";
      shot: number;
      startX: number;
      deltaMs: number;
    };

// After the mouse is released the edit stays where it was dropped, marked "saving", until the plan is made again.
type Pending =
  | { kind: "roll"; cut: number; atMs: number }
  | { kind: "trim"; edge: "start" | "end"; shot: number; deltaMs: number }
  | { kind: "slip"; shot: number }
  | { kind: "swap"; shot: number; over: number };

// Undo / Redo: a timeline state (cuts and slips) or a swap (the same swap again takes it back).
type UndoStep = { kind: "timeline"; edits: TimelineEdits } | { kind: "swap"; a: string; b: string };

const MIN_MS = 400; // a roll never makes a shot shorter than this (as the planner)
const SLIP_THRESHOLD_PX = 4; // a smaller movement is a click (select the shot)
const LIFT_PX = 18; // dragged this far upwards (more up than sideways) before a slip starts: the shot is lifted

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const signed = (ms: number) =>
  `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(2)} s`;

// onEdited: after an edit is saved and planned again, the video time to show in the viewer (the edit point).
export function useTimelineEditing({
  view,
  zoom,
  mediaUrl,
  post,
  onEdited,
  busy = false,
}: {
  view: StoryboardView | null;
  zoom: number;
  mediaUrl: string;
  post: TimelinePost;
  onEdited?: (videoMs: number) => void;
  busy?: boolean; // the board is saving / planning something else: no new edit starts
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef(false);
  const stopTracking = useRef<(() => void) | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const [undo, setUndo] = useState<UndoStep[]>([]);
  const [redo, setRedo] = useState<UndoStep[]>([]);
  const editable = !!view?.editable;
  const shots = view?.shots ?? [];
  const x = (ms: number) => (ms / 1000) * zoom;

  const clipOf = (s: StoryShot) =>
    view?.clips.find((c) => c.name.toLowerCase() === s.clip.toLowerCase()) ??
    null;
  const editShot = (s: StoryShot): EditShot => {
    const c = clipOf(s);
    return {
      startMs: s.songMs,
      endMs: s.songMs + (s.endMs - s.startMs),
      clip: s.clip,
      kind: s.kind,
      inS: s.inS,
      speed: s.speed || 1,
      clipInS: c?.inS ?? 0,
      clipOutS: c?.outS ?? (c ? c.durationMs / 1000 : s.outS),
    };
  };
  const rollTarget = (
    d: Extract<Drag, { kind: "roll" }>,
    clientX: number,
    free: boolean,
  ) => {
    const raw = d.fromMs + ((clientX - d.startX) / zoom) * 1000;
    const lo = shots[d.cut - 1].startMs + MIN_MS;
    const hi = shots[d.cut].endMs - MIN_MS;
    return Math.min(hi, Math.max(lo, snapRollMs(raw, d.fromMs, view?.beats ?? [], free)));
  };

  // Saves one edit and plans again. `shown` keeps the edit where it was dropped until the new plan is there (or
  // the save failed: then it goes back and the board shows the error); no second edit starts meanwhile.
  const save = useCallback(
    async (body: Record<string, unknown>, showAtMs?: number, shown?: Pending, step?: UndoStep) => {
      if (shown) {
        pendingRef.current = true;
        setPending(shown);
      }
      try {
        const r = await post(body);
        const undoStep: UndoStep | null = step && r ? step : r?.before ? { kind: "timeline", edits: r.before } : null;
        if (undoStep) {
          setUndo((u) => [...u.slice(-49), undoStep]);
          setRedo([]);
        }
        if (r && showAtMs !== undefined) onEdited?.(showAtMs);
      } finally {
        if (shown) {
          pendingRef.current = false;
          setPending(null);
        }
      }
    },
    [post, onEdited],
  );

  // Two shots can swap when they show different clips and neither is a Reel's loop ending (it always replays the
  // first clip, so the video loops seamlessly: swapping the first clip changes it too).
  const swappable = (a: StoryShot, b: StoryShot) => a.index !== b.index && !a.loop && !b.loop && a.clip.toLowerCase() !== b.clip.toLowerCase();
  // The shot under the pointer (by its place along the row; the pointer may be above the row while lifted).
  const shotAt = (clientX: number, rowLeft: number): number | null => {
    const ms = ((clientX - rowLeft) / zoom) * 1000;
    return shots.find((s) => ms >= s.startMs && ms < s.endMs)?.index ?? null;
  };
  // Mouse moves and the release, wherever the pointer goes while dragging. The listeners start inside the
  // pointerdown (trackPointer), they call the latest move / finish of the render through `latest`.
  const move = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "roll" ? !shots[d.cut - 1] || !shots[d.cut] : !shots[d.shot]) return; // the plan changed under the drag
    let next: Drag;
    if (d.kind === "roll")
      next = { ...d, atMs: rollTarget(d, e.clientX, e.altKey), free: e.altKey };
    else if (d.kind === "trim")
      next = { ...d, deltaMs: ((e.clientX - d.startX) / zoom) * 1000 };
    else if (d.kind === "lift") next = { ...d, x: e.clientX, y: e.clientY, over: shotAt(e.clientX, d.rowLeft) };
    else {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      // Upwards first (before any slip): the shot is lifted, to be dropped on another one (a swap).
      if (!d.active && -dy >= LIFT_PX && -dy > Math.abs(dx) && !shots[d.shot].loop) next = { kind: "lift", shot: d.shot, x: e.clientX, y: e.clientY, rowLeft: d.rowLeft, over: shotAt(e.clientX, d.rowLeft) };
      else if (!d.canSlip) next = d;
      else next = { ...d, active: d.active || Math.abs(dx) >= SLIP_THRESHOLD_PX, deltaMs: (dx / zoom) * 1000 };
    }
    dragRef.current = next;
    setDrag(next);
  };
  const finish = (cancelled: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    stopTracking.current = null;
    setDrag(null);
    // The click that ends a drag (if the browser sends one) comes before this timer; later clicks are real.
    setTimeout(() => (justDragged.current = false), 0);
    if (!d || cancelled) return; // pointercancel / the window lost focus: nothing is saved
    if (d.kind === "roll") {
      justDragged.current = true;
      if (Math.abs(d.atMs - d.fromMs) < 20 || !shots[d.cut - 1] || !shots[d.cut]) return;
      const left = editShot(shots[d.cut - 1]);
      const right = editShot(shots[d.cut]);
      const { move, slips } = rollEdit(left, right, shots[d.cut].songMs, view!.songStartMs + d.atMs, d.free);
      void save({ action: "roll", move, slips }, d.atMs, { kind: "roll", cut: d.cut, atMs: d.atMs });
    } else if (d.kind === "trim") {
      justDragged.current = true;
      const s = shots[d.shot];
      if (!s) return;
      const slip = slipEdit(editShot(s), -d.deltaMs); // the start edge to the right = the clip starts later
      if (Math.abs(slip.in - s.inS) >= 0.03)
        void save({ action: "slip", slip }, d.edge === "start" ? s.startMs : Math.max(s.startMs, s.endMs - 1000), { kind: "trim", edge: d.edge, shot: d.shot, deltaMs: d.deltaMs });
    } else if (d.kind === "lift") {
      justDragged.current = true;
      const from = shots[d.shot];
      const to = d.over !== null ? shots[d.over] : undefined;
      if (!from || !to || !swappable(from, to)) return; // dropped elsewhere: nothing changes
      const order = (view?.clips ?? []).map((c) => c.name);
      void save({ action: "swap", a: from.clip, b: to.clip, order }, to.startMs, { kind: "swap", shot: from.index, over: to.index }, { kind: "swap", a: from.clip, b: to.clip });
    } else if (d.active) {
      justDragged.current = true;
      const s = shots[d.shot];
      if (!s) return;
      const slip = slipEdit(editShot(s), d.deltaMs);
      if (Math.abs(slip.in - s.inS) >= 0.03) void save({ action: "slip", slip }, s.startMs, { kind: "slip", shot: d.shot });
    }
  };
  const latest = useRef<{ move: (e: PointerEvent) => void; finish: (cancelled: boolean) => void } | null>(null);
  useEffect(() => {
    latest.current = { move, finish };
  });
  useEffect(() => () => stopTracking.current?.(), []);
  // Starts a drag at once (state and listeners), unless another edit is still being saved or planned.
  const begin = useCallback((d: Drag) => {
    stopTracking.current?.();
    dragRef.current = d;
    setDrag(d);
    stopTracking.current = trackPointer(
      (e) => latest.current?.move(e),
      (_e, cancelled) => latest.current?.finish(cancelled),
      d.kind === "slip" || d.kind === "lift" ? undefined : d.kind === "roll" ? "col-resize" : "ew-resize",
    );
  }, []);
  const locked = busy || pending !== null;
  // Esc while a shot is lifted: put it back (nothing changes).
  const lifting = drag?.kind === "lift";
  useEffect(() => {
    if (!lifting) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      stopTracking.current?.();
      latest.current?.finish(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [lifting]);

  // Undo / Redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), not while typing in a field.
  // A step done again: a timeline state is posted (its "before" is the step back), a swap is swapped again.
  const orderRef = useRef<string[]>([]); // the story order now (a swap sends it)
  useEffect(() => {
    orderRef.current = (view?.clips ?? []).map((c) => c.name);
  }, [view]);
  const apply = useCallback(
    async (step: UndoStep): Promise<UndoStep | null> => {
      if (step.kind === "swap") {
        const r = await post({ action: "swap", a: step.a, b: step.b, order: orderRef.current });
        return r ? step : null;
      }
      const r = await post({ action: "timeline", timeline: step.edits });
      return r?.before ? { kind: "timeline", edits: r.before } : null;
    },
    [post],
  );
  const undoOne = useCallback(async () => {
    const prev = undo.at(-1);
    if (!prev || pendingRef.current) return;
    const back = await apply(prev);
    if (!back) return;
    setUndo((u) => u.slice(0, -1));
    setRedo((x) => [...x, back]);
  }, [undo, apply]);
  const redoOne = useCallback(async () => {
    const next = redo.at(-1);
    if (!next || pendingRef.current) return;
    const back = await apply(next);
    if (!back) return;
    setRedo((x) => x.slice(0, -1));
    setUndo((u) => [...u, back]);
  }, [redo, apply]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey && undo.length) {
        e.preventDefault();
        void undoOne();
      } else if (((k === "z" && e.shiftKey) || k === "y") && redo.length) {
        e.preventDefault();
        void redoOne();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo.length, redo.length, undoOne, redoOne]);

  // Which cuts the user moved and which shots they slipped (marked on the timeline).
  const near = (sec: number, ms: number) =>
    Math.abs(sec * 1000 - ms) <= MATCH_MS;
  const movedCut = (i: number) =>
    !!view?.timeline.cuts.some((c) => near(c.to, shots[i].songMs));
  const slipped = (s: StoryShot) =>
    !!view?.timeline.slips.some(
      (x) =>
        near(x.at, s.songMs) && x.clip.toLowerCase() === s.clip.toLowerCase(),
    );
  const edited = (s: StoryShot) =>
    slipped(s) ||
    movedCut(s.index) ||
    (s.index + 1 < shots.length && movedCut(s.index + 1));

  // A shot pressed: a slip once it moves sideways (video shots of a plan only), lifted (to swap) once it moves
  // upwards first; otherwise a click selects it.
  const onShotPointerDown = (s: StoryShot, e: React.PointerEvent) => {
    if (!editable || locked || e.button !== 0) return;
    const row = (e.currentTarget as HTMLElement).closest("[data-shots-row]");
    const rowLeft = row ? row.getBoundingClientRect().left : e.clientX - x(s.startMs);
    begin({ kind: "slip", shot: s.index, startX: e.clientX, startY: e.clientY, rowLeft, canSlip: s.kind === "video", deltaMs: 0, active: false });
  };
  // After a drag, the click that follows does not select the shot or play from there.
  const onRowClickCapture = (e: React.MouseEvent) => {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // The handles on the cuts (between two shots): an 18 px wide grab zone around the line, a faint line always
  // visible; and what the drag shows. After the drop the handle stays where it was dropped (data-pending).
  const handles: ReactNode = editable
    ? shots.slice(1).map((s) => {
        const i = s.index;
        const active = drag?.kind === "roll" && drag.cut === i;
        const held = pending?.kind === "roll" && pending.cut === i;
        const at = active
          ? (drag as Extract<Drag, { kind: "roll" }>).atMs
          : held
            ? pending.atMs
            : s.startMs;
        return (
          <div
            key={`cut-${i}`}
            data-cut-handle={i}
            data-cut-moved={movedCut(i) || undefined}
            data-pending={held || undefined}
            title={`Drag to move this cut (the shots on either side get longer / shorter; it snaps to the beat, Alt: free)${movedCut(i) ? " · moved by you" : ""}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              if (!editable || locked) return;
              begin({ kind: "roll", cut: i, startX: e.clientX, fromMs: s.startMs, atMs: s.startMs, free: e.altKey });
            }}
            onClick={(e) => e.stopPropagation()}
            className={`group absolute top-0 bottom-0 z-40 flex w-[18px] -translate-x-1/2 touch-none justify-center select-none ${locked && !active ? "cursor-progress" : "cursor-col-resize"}`}
            style={{ left: x(at) }}
          >
            <div
              className={`h-full w-0.5 rounded ${active || held ? "bg-brand" : movedCut(i) ? "bg-brand/80" : "bg-white/30 group-hover:bg-white/80"}`}
            />
          </div>
        );
      })
    : null;

  // The outer edges: the first shot's start and the last shot's end (video shots of a plan). A 16 px grab zone
  // that reaches 10 px into the shot and 6 px outside it.
  const first = shots[0];
  const last = shots.at(-1);
  const edgeHandles: ReactNode = !editable
    ? null
    : (["start", "end"] as const).map((edge) => {
        const s = edge === "start" ? first : last;
        if (!s || s.kind !== "video") return null;
        const active = drag?.kind === "trim" && drag.edge === edge;
        const held = pending?.kind === "trim" && pending.edge === edge;
        const offset = active
          ? (drag as Extract<Drag, { kind: "trim" }>).deltaMs
          : held
            ? pending.deltaMs
            : 0;
        const at = (edge === "start" ? s.startMs : s.endMs) + offset;
        const into = edge === "start" ? 6 : 10; // px of the zone before the edge line
        return (
          <div
            key={`edge-${edge}`}
            data-trim-handle={edge}
            data-pending={held || undefined}
            title={
              edge === "start"
                ? "Drag right: the first clip starts later in its footage (the video keeps its music and length)"
                : "Drag left: the last clip ends sooner in its footage (the video keeps its music and length)"
            }
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              if (!editable || locked) return;
              // eslint-disable-next-line react-hooks/refs -- only runs when the pointer is pressed, not while rendering
              begin({ kind: "trim", edge, shot: s.index, startX: e.clientX, deltaMs: 0 });
            }}
            onClick={(e) => e.stopPropagation()}
            className={`group absolute top-0 bottom-0 z-40 w-4 touch-none select-none ${locked && !active ? "cursor-progress" : "cursor-ew-resize"}`}
            style={{ left: x(at) - into }}
          >
            <div
              className={`absolute top-0 h-full w-1 rounded ${active || held ? "bg-brand" : "bg-white/30 group-hover:bg-white/80"}`}
              style={{ left: into - 2 }}
            />
          </div>
        );
      });

  // What the big viewer shows while dragging: the clip's frame at the edge (null: the plan's own frame).
  let viewerFrame: { src: string; atS: number } | null = null;
  let overlay: ReactNode = null;
  if (drag?.kind === "roll") {
    const left = shots[drag.cut - 1];
    const right = shots[drag.cut];
    const delta = drag.atMs - drag.fromMs;
    const r = rollEdit(
      editShot(left),
      editShot(right),
      right.songMs,
      view!.songStartMs + drag.atMs,
      drag.free,
    );
    const rightIn =
      r.slips.find((s) => s.clip === right.clip && right.kind === "video")
        ?.in ?? null;
    if (rightIn !== null && clipOf(right))
      viewerFrame = { src: `${mediaUrl}/${clipOf(right)!.src}`, atS: rightIn };
    overlay = (
      <EditBubble
        left={x(drag.atMs)}
        mediaSrc={
          rightIn !== null && clipOf(right)
            ? `${mediaUrl}/${clipOf(right)!.src}`
            : null
        }
        atS={rightIn}
        thumb={right.thumb}
      >
        <span className="text-brand font-medium">{signed(delta)}</span> · shot{" "}
        {left.index + 1}: {s1(left.endMs - left.startMs + delta)} · shot{" "}
        {right.index + 1}: {s1(right.endMs - right.startMs - delta)}
        {drag.free ? " · free" : " · on the beat"}
      </EditBubble>
    );
  } else if (drag?.kind === "slip" && drag.active) {
    const s = shots[drag.shot];
    const slip = slipEdit(editShot(s), drag.deltaMs);
    const c = clipOf(s);
    if (c) viewerFrame = { src: `${mediaUrl}/${c.src}`, atS: slip.in };
    overlay = (
      <EditBubble
        left={x(s.startMs) + 4}
        mediaSrc={c ? `${mediaUrl}/${c.src}` : null}
        atS={slip.in}
        thumb={s.thumb}
      >
        <span className="text-brand font-medium">slip</span> · {s.clip}: from{" "}
        {slip.in.toFixed(2)} s{" "}
        <span className="text-muted-foreground">
          (was {s.inS.toFixed(2)} s)
        </span>
        {Math.abs(slip.in - slipEdit(editShot(s), drag.deltaMs + Math.sign(drag.deltaMs || 1) * 100).in) < 0.005 ? <span className="text-amber-300"> · no more footage this way</span> : null}
      </EditBubble>
    );
  } else if (drag?.kind === "trim") {
    const s = shots[drag.shot];
    const slip = slipEdit(editShot(s), -drag.deltaMs);
    const needS = ((s.endMs - s.startMs) / 1000) * (s.speed || 1);
    const c = clipOf(s);
    const atS =
      drag.edge === "start"
        ? slip.in
        : Math.max(slip.in, slip.in + needS - 1 / 30);
    if (c) viewerFrame = { src: `${mediaUrl}/${c.src}`, atS };
    overlay = (
      <EditBubble
        left={
          x(drag.edge === "start" ? s.startMs : s.endMs) +
          (drag.edge === "start" ? 40 : -40)
        }
        mediaSrc={c ? `${mediaUrl}/${c.src}` : null}
        atS={atS}
        thumb={s.thumb}
      >
        <span className="text-brand font-medium">
          trim {drag.edge === "start" ? "start" : "end"}
        </span>{" "}
        · {s.clip}:{" "}
        {drag.edge === "start"
          ? `starts at ${slip.in.toFixed(2)} s of the clip (was ${s.inS.toFixed(2)} s)`
          : `ends at ${(slip.in + needS).toFixed(2)} s of the clip (was ${(s.inS + needS).toFixed(2)} s)`}
        {Math.abs(slip.in - slipEdit(editShot(s), -drag.deltaMs - Math.sign(drag.deltaMs || (drag.edge === "start" ? 1 : -1)) * 100).in) < 0.005 ? (
          <span className="text-amber-300" data-no-more-footage> · no more footage {drag.edge === "start" ? "after this" : "before this"} in the clip</span>
        ) : null}
      </EditBubble>
    );
  }

  if (drag?.kind === "lift") {
    const from = shots[drag.shot];
    const to = drag.over !== null ? shots[drag.over] : undefined;
    const same = !!to && !!from && !swappable(from, to);
    if (from)
      overlay = (
        <>
          {/* the lifted clip follows the pointer */}
          <div
            className="border-brand pointer-events-none fixed z-50 flex h-10 w-28 -translate-x-1/2 -translate-y-full items-end overflow-hidden rounded border-2 bg-black/80 bg-cover bg-center px-1 text-[10px] text-white shadow-xl"
            style={{ left: drag.x, top: drag.y - 6, backgroundImage: from.thumb ? `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.7)), url(/api/files/${from.thumb})` : undefined }}
            data-lift-ghost
          >
            <span className="truncate">{from.clip}</span>
          </div>
          <EditBubble left={x(to && !same ? (to.startMs + to.endMs) / 2 : (from.startMs + from.endMs) / 2)} mediaSrc={null} atS={null} thumb={null}>
            {to && !same ? (
              <>
                <span className="text-brand font-medium">swap</span> {from.index + 1} · {from.clip} ↔ {to.index + 1} · {to.clip}
              </>
            ) : same && to?.loop ? (
              <span className="text-amber-300" data-lift-loop>the last shot is the loop ending: it always replays the first clip</span>
            ) : same ? (
              <span className="text-muted-foreground">the same clip: drop it on another one to swap them</span>
            ) : (
              <span className="text-muted-foreground">drop it on another clip to swap them (Esc: put it back)</span>
            )}
          </EditBubble>
        </>
      );
  }

  // After the drop, until the new plan is there: a small "saving" mark at the edit.
  if (!drag && pending) {
    const markAt =
      pending.kind === "roll"
        ? x(pending.atMs)
        : pending.kind === "trim"
          ? x(pending.edge === "start" ? (shots[pending.shot]?.startMs ?? 0) : (shots[pending.shot]?.endMs ?? 0)) + (pending.edge === "start" ? 40 : -40)
          : pending.kind === "swap"
            ? x(((shots[pending.over]?.startMs ?? 0) + (shots[pending.over]?.endMs ?? 0)) / 2)
            : x(shots[pending.shot]?.startMs ?? 0) + 40;
    overlay = (
      <span
        className="bg-background/95 text-muted-foreground pointer-events-none absolute bottom-full z-30 mb-1 -translate-x-1/2 animate-pulse rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap shadow"
        style={{ left: markAt }}
        data-edit-saving
      >
        saving…
      </span>
    );
  }

  const resetBody = (s: StoryShot) => ({
    action: "timeline-reset",
    startMs: s.songMs,
    endMs: s.songMs + (s.endMs - s.startMs),
  });
  return {
    handles: [handles, edgeHandles],
    overlay,
    viewerFrame,
    onShotPointerDown,
    onRowClickCapture,
    slipped,
    pendingShot: (i: number) =>
      pending?.kind === "roll" ? i === pending.cut - 1 || i === pending.cut : pending?.kind === "swap" ? i === pending.shot || i === pending.over : pending ? i === pending.shot : false,
    // What a shot shows on the row: right after a swap is dropped, the two shots already show each other's clip
    // (name and picture) while the plan is made again (8 Nov 2026, asked by the user: "make it swap faster").
    shown: (s: StoryShot): StoryShot => {
      if (pending?.kind !== "swap" || (s.index !== pending.shot && s.index !== pending.over)) return s;
      const other = shots[s.index === pending.shot ? pending.over : pending.shot];
      return other ? { ...s, clip: other.clip, thumb: other.thumb, kind: other.kind } : s;
    },
    liftFrom: drag?.kind === "lift" ? drag.shot : null, // the lifted shot (dimmed on the row)
    liftOver: drag?.kind === "lift" && drag.over !== null && shots[drag.over] && shots[drag.shot] && swappable(shots[drag.shot], shots[drag.over]) ? drag.over : null, // where it would land (ringed)
    edited,
    resetBody,
    save,
    undo: undoOne,
    redo: redoOne,
    canUndo: undo.length > 0,
    canRedo: redo.length > 0,
    dragging: !!drag && (drag.kind !== "slip" || drag.active),
  };
}

// The readout above the shots while dragging, with the clip's frame at the edge.
function EditBubble({
  left,
  mediaSrc,
  atS,
  thumb,
  children,
}: {
  left: number;
  mediaSrc: string | null;
  atS: number | null;
  thumb: string | null;
  children: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && atS !== null && Number.isFinite(atS))
      video.current.currentTime = atS;
  }, [atS]);
  return (
    <div
      className="pointer-events-none absolute bottom-full z-30 mb-1 flex -translate-x-1/2 flex-col items-center gap-1"
      style={{ left }}
      data-edit-readout
    >
      {mediaSrc ? (
        <video
          ref={video}
          src={mediaSrc}
          muted
          preload="auto"
          className="h-16 rounded border border-white/30 bg-black object-contain shadow-lg"
          data-edit-preview
        />
      ) : thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail
        <img
          src={`/api/files/${thumb}`}
          alt=""
          className="h-16 rounded border border-white/30 object-contain shadow-lg"
        />
      ) : null}
      <span className="bg-background/95 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums shadow">
        {children}
      </span>
    </div>
  );
}

// The clip's frame in the big viewer while an edit is dragged (as a program monitor shows the trim frame).
export function ViewerFrame({
  frame,
}: {
  frame: { src: string; atS: number } | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && frame && Number.isFinite(frame.atS))
      video.current.currentTime = frame.atS;
  }, [frame]);
  if (!frame) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 bg-black"
      data-viewer-edit-frame
    >
      <video
        ref={video}
        src={frame.src}
        muted
        preload="auto"
        className="h-full w-full object-cover"
      />
      <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white tabular-nums">
        {frame.atS.toFixed(2)} s of the clip
      </span>
    </div>
  );
}
