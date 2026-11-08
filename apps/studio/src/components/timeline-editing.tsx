"use client";

// The Shape timeline's pro edits with the mouse (7 Nov 2026, asked by the user: "like the pros do"):
//   roll  drag the line between two shots: the cut moves (on the beat; Alt: exactly where you let go), one
//         shot gets longer and the other shorter, nothing else moves (the music is fixed);
//   slip  drag inside a shot: it keeps its place and length, another part of its clip plays in it;
//   trim  drag the outer edge of the first shot (its start) or of the last shot (its end): the clip starts
//         later / ends sooner in its own footage; the video keeps its music, so the shot keeps its place.
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
      deltaMs: number;
      active: boolean;
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
  | { kind: "slip"; shot: number };

const MIN_MS = 400; // a roll never makes a shot shorter than this (as the planner)
const SLIP_THRESHOLD_PX = 4; // a smaller movement is a click (select the shot)

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
  const [undo, setUndo] = useState<TimelineEdits[]>([]);
  const [redo, setRedo] = useState<TimelineEdits[]>([]);
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
    async (body: Record<string, unknown>, showAtMs?: number, shown?: Pending) => {
      if (shown) {
        pendingRef.current = true;
        setPending(shown);
      }
      try {
        const r = await post(body);
        if (r?.before) {
          setUndo((u) => [...u.slice(-49), r.before!]);
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
    else {
      const dx = e.clientX - d.startX;
      next = { ...d, active: d.active || Math.abs(dx) >= SLIP_THRESHOLD_PX, deltaMs: (dx / zoom) * 1000 };
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
      d.kind === "slip" ? undefined : d.kind === "roll" ? "col-resize" : "ew-resize",
    );
  }, []);
  const locked = busy || pending !== null;

  // Undo / Redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), not while typing in a field.
  const undoOne = useCallback(async () => {
    const prev = undo.at(-1);
    if (!prev || pendingRef.current) return;
    const r = await post({ action: "timeline", timeline: prev });
    if (!r) return;
    setUndo((u) => u.slice(0, -1));
    if (r.before) setRedo((x) => [...x, r.before!]);
  }, [undo, post]);
  const redoOne = useCallback(async () => {
    const next = redo.at(-1);
    if (!next || pendingRef.current) return;
    const r = await post({ action: "timeline", timeline: next });
    if (!r) return;
    setRedo((x) => x.slice(0, -1));
    if (r.before) setUndo((u) => [...u, r.before!]);
  }, [redo, post]);
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

  // A shot pressed: a slip once it moves (video shots of a plan only); otherwise a click selects it.
  const onShotPointerDown = (s: StoryShot, e: React.PointerEvent) => {
    if (!editable || locked || e.button !== 0 || s.kind !== "video") return;
    begin({ kind: "slip", shot: s.index, startX: e.clientX, deltaMs: 0, active: false });
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

  // After the drop, until the new plan is there: a small "saving" mark at the edit.
  if (!drag && pending) {
    const markAt =
      pending.kind === "roll"
        ? x(pending.atMs)
        : pending.kind === "trim"
          ? x(pending.edge === "start" ? (shots[pending.shot]?.startMs ?? 0) : (shots[pending.shot]?.endMs ?? 0)) + (pending.edge === "start" ? 40 : -40)
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
      pending?.kind === "roll" ? i === pending.cut - 1 || i === pending.cut : pending ? i === pending.shot : false,
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
