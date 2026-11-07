"use client";

// The Shape timeline's pro edits with the mouse (7 Nov 2026, asked by the user: "like the pros do"):
//   roll  drag the line between two shots: the cut moves (on the beat; Alt: exactly where you let go), one
//         shot gets longer and the other shorter, nothing else moves (the music is fixed);
//   slip  drag inside a shot: it keeps its place and length, another part of its clip plays in it.
// While dragging: a readout (+0.5 s · the two shots' lengths / the clip's new start) and the clip's frame at
// the edge in a small preview. Saved on the song's timeline (clips.json "cuts" / "slips", see
// packages/video/src/timeline-edits.ts) and planned again; Ctrl+Z / Ctrl+Shift+Z undo and redo.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { MATCH_MS, rollEdit, slipEdit, type EditShot, type StoryShot, type TimelineEdits } from "@lyric/video";
import type { StoryboardView } from "@lyric/video/node"; // types only

export type TimelinePost = (body: Record<string, unknown>) => Promise<{ before?: TimelineEdits; after?: TimelineEdits } | null>;

type Drag =
  | { kind: "roll"; cut: number; startX: number; fromMs: number; atMs: number; free: boolean } // cut: index of the shot it starts
  | { kind: "slip"; shot: number; startX: number; deltaMs: number; active: boolean };

const MIN_MS = 400; // a roll never makes a shot shorter than this (as the planner)
const SLIP_THRESHOLD_PX = 4; // a smaller movement is a click (select the shot)

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const signed = (ms: number) => `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(2)} s`;

export function useTimelineEditing({ view, zoom, mediaUrl, post }: { view: StoryboardView | null; zoom: number; mediaUrl: string; post: TimelinePost }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const [undo, setUndo] = useState<TimelineEdits[]>([]);
  const [redo, setRedo] = useState<TimelineEdits[]>([]);
  const editable = !!view?.editable;
  const shots = view?.shots ?? [];
  const x = (ms: number) => (ms / 1000) * zoom;

  const clipOf = (s: StoryShot) => view?.clips.find((c) => c.name.toLowerCase() === s.clip.toLowerCase()) ?? null;
  const editShot = (s: StoryShot): EditShot => {
    const c = clipOf(s);
    return { startMs: s.songMs, endMs: s.songMs + (s.endMs - s.startMs), clip: s.clip, kind: s.kind, inS: s.inS, speed: s.speed || 1, clipInS: c?.inS ?? 0, clipOutS: c?.outS ?? (c ? c.durationMs / 1000 : s.outS) };
  };
  // The beat nearest a video time (view.beats are video times); free: the frame there.
  const snap = (ms: number, free: boolean) => {
    if (free || !view?.beats.length) return Math.round(ms / (1000 / 30)) * (1000 / 30);
    return view.beats.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a), view.beats[0]);
  };
  const rollTarget = (d: Extract<Drag, { kind: "roll" }>, clientX: number, free: boolean) => {
    const raw = d.fromMs + ((clientX - d.startX) / zoom) * 1000;
    const lo = shots[d.cut - 1].startMs + MIN_MS;
    const hi = shots[d.cut].endMs - MIN_MS;
    return Math.min(hi, Math.max(lo, snap(raw, free)));
  };

  const save = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await post(body);
      if (r?.before) {
        setUndo((u) => [...u.slice(-49), r.before!]);
        setRedo([]);
      }
    },
    [post],
  );

  // Mouse moves and the release, wherever the pointer goes while dragging.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let next: Drag;
      if (d.kind === "roll") next = { ...d, atMs: rollTarget(d, e.clientX, e.altKey), free: e.altKey };
      else {
        const dx = e.clientX - d.startX;
        next = { ...d, active: d.active || Math.abs(dx) >= SLIP_THRESHOLD_PX, deltaMs: (dx / zoom) * 1000 };
      }
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (d.kind === "roll") {
        justDragged.current = true;
        if (Math.abs(d.atMs - d.fromMs) < 20) return;
        const left = editShot(shots[d.cut - 1]);
        const right = editShot(shots[d.cut]);
        const songStart = view!.songStartMs;
        const { move, slips } = rollEdit(left, right, shots[d.cut].songMs, songStart + d.atMs, d.free);
        void save({ action: "roll", move, slips });
      } else if (d.active) {
        justDragged.current = true;
        const s = shots[d.shot];
        const slip = slipEdit(editShot(s), d.deltaMs);
        if (Math.abs(slip.in - s.inS) >= 0.03) void save({ action: "slip", slip });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the drag's own state is in dragRef
  }, [drag === null]);

  // Undo / Redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), not while typing in a field.
  const undoOne = useCallback(async () => {
    const prev = undo.at(-1);
    if (!prev) return;
    const r = await post({ action: "timeline", timeline: prev });
    if (!r) return;
    setUndo((u) => u.slice(0, -1));
    if (r.before) setRedo((x) => [...x, r.before!]);
  }, [undo, post]);
  const redoOne = useCallback(async () => {
    const next = redo.at(-1);
    if (!next) return;
    const r = await post({ action: "timeline", timeline: next });
    if (!r) return;
    setRedo((x) => x.slice(0, -1));
    if (r.before) setUndo((u) => [...u, r.before!]);
  }, [redo, post]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
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
  const near = (sec: number, ms: number) => Math.abs(sec * 1000 - ms) <= MATCH_MS;
  const movedCut = (i: number) => !!view?.timeline.cuts.some((c) => near(c.to, shots[i].songMs));
  const slipped = (s: StoryShot) => !!view?.timeline.slips.some((x) => near(x.at, s.songMs) && x.clip.toLowerCase() === s.clip.toLowerCase());
  const edited = (s: StoryShot) => slipped(s) || movedCut(s.index) || (s.index + 1 < shots.length && movedCut(s.index + 1));

  // A shot pressed: a slip once it moves (video shots of a plan only); otherwise a click selects it.
  const onShotPointerDown = (s: StoryShot, e: React.PointerEvent) => {
    if (!editable || e.button !== 0 || s.kind !== "video") return;
    const d: Drag = { kind: "slip", shot: s.index, startX: e.clientX, deltaMs: 0, active: false };
    dragRef.current = d;
    setDrag(d);
  };
  // After a drag, the click that follows does not select the shot or play from there.
  const onRowClickCapture = (e: React.MouseEvent) => {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // The handles on the cuts (between two shots), and what the drag shows.
  const handles: ReactNode = editable
    ? shots.slice(1).map((s) => {
        const i = s.index;
        const active = drag?.kind === "roll" && drag.cut === i;
        const at = active ? (drag as Extract<Drag, { kind: "roll" }>).atMs : s.startMs;
        return (
          <div
            key={`cut-${i}`}
            data-cut-handle={i}
            data-cut-moved={movedCut(i) || undefined}
            title={`Drag to move this cut (the shots on either side get longer / shorter; it snaps to the beat, Alt: free)${movedCut(i) ? " · moved by you" : ""}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              const d: Drag = { kind: "roll", cut: i, startX: e.clientX, fromMs: s.startMs, atMs: s.startMs, free: e.altKey };
              dragRef.current = d;
              setDrag(d);
            }}
            onClick={(e) => e.stopPropagation()}
            className="group absolute top-0 bottom-0 z-20 flex w-3 -translate-x-1/2 cursor-col-resize justify-center"
            style={{ left: x(at) }}
          >
            <div className={`h-full w-0.5 rounded ${active ? "bg-brand" : movedCut(i) ? "bg-brand/80" : "bg-transparent group-hover:bg-white/70"}`} />
          </div>
        );
      })
    : null;

  let overlay: ReactNode = null;
  if (drag?.kind === "roll") {
    const left = shots[drag.cut - 1];
    const right = shots[drag.cut];
    const delta = drag.atMs - drag.fromMs;
    const r = rollEdit(editShot(left), editShot(right), right.songMs, view!.songStartMs + drag.atMs, drag.free);
    const rightIn = r.slips.find((s) => s.clip === right.clip && right.kind === "video")?.in ?? null;
    overlay = (
      <EditBubble left={x(drag.atMs)} mediaSrc={rightIn !== null && clipOf(right) ? `${mediaUrl}/${clipOf(right)!.src}` : null} atS={rightIn} thumb={right.thumb}>
        <span className="text-brand font-medium">{signed(delta)}</span> · shot {left.index + 1}: {s1(left.endMs - left.startMs + delta)} · shot {right.index + 1}: {s1(right.endMs - right.startMs - delta)}
        {drag.free ? " · free" : " · on the beat"}
      </EditBubble>
    );
  } else if (drag?.kind === "slip" && drag.active) {
    const s = shots[drag.shot];
    const slip = slipEdit(editShot(s), drag.deltaMs);
    const c = clipOf(s);
    overlay = (
      <EditBubble left={x(s.startMs) + 4} mediaSrc={c ? `${mediaUrl}/${c.src}` : null} atS={slip.in} thumb={s.thumb}>
        <span className="text-brand font-medium">slip</span> · {s.clip}: from {slip.in.toFixed(2)} s <span className="text-muted-foreground">(was {s.inS.toFixed(2)} s)</span>
      </EditBubble>
    );
  }

  const resetBody = (s: StoryShot) => ({ action: "timeline-reset", startMs: s.songMs, endMs: s.songMs + (s.endMs - s.startMs) });
  return { handles, overlay, onShotPointerDown, onRowClickCapture, slipped, edited, resetBody, save, undo: undoOne, redo: redoOne, canUndo: undo.length > 0, canRedo: redo.length > 0, dragging: !!drag && (drag.kind === "roll" || drag.active) };
}

// The readout above the shots while dragging, with the clip's frame at the edge.
function EditBubble({ left, mediaSrc, atS, thumb, children }: { left: number; mediaSrc: string | null; atS: number | null; thumb: string | null; children: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && atS !== null && Number.isFinite(atS)) video.current.currentTime = atS;
  }, [atS]);
  return (
    <div className="pointer-events-none absolute bottom-full z-30 mb-1 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left }} data-edit-readout>
      {mediaSrc ? (
        <video ref={video} src={mediaSrc} muted preload="auto" className="h-16 rounded border border-white/30 bg-black object-contain shadow-lg" data-edit-preview />
      ) : thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail
        <img src={`/api/files/${thumb}`} alt="" className="h-16 rounded border border-white/30 object-contain shadow-lg" />
      ) : null}
      <span className="bg-background/95 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums shadow">{children}</span>
    </div>
  );
}
