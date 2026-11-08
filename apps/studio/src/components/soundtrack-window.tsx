"use client";

// The soundtrack on the Shape timeline (7 Nov 2026, asked by the user: "keep the whole song untouched, pick when
// the soundtrack starts", like trimming the music in Canva; 8 Nov 2026: the window sits on the timeline's own song
// track, not on a separate strip above it). The song track shows the WHOLE song at the timeline's zoom: the part
// before and after this video is dimmed and lies outside the video's rows, and the video is a pink window on it.
// Drag the window to move it, its edges to set where the video starts and ends: the start snaps to a bar, the end to
// the first bar after a sung line (a clean end; else a bar); Alt: exactly there. Saved as this platform's section in
// song.json (the same as Make → "Part of the song"); "Automatic" (in the command bar) gives it back to the app. The
// song file is never changed: the video takes that part of it. Edits on the clips (cuts, slips) live on the song's
// timeline, so they stay at the same musical moments when the window moves.
import { useEffect, useRef, useState } from "react";

import { clockTenths, linesCut, sectionText, snapWindow } from "@lyric/video";
import type { SongOverview } from "@lyric/video/node"; // types only

import { trackPointer } from "./pointer-track";

export type SongWindowDrag = { startMs: number; endMs: number; clean: boolean };
type Drag = { mode: "move" | "start" | "end"; startX: number; moved: boolean; from: { startMs: number; endMs: number }; now: SongWindowDrag };

// The whole song's waveform and sung lines, behind the video's own waveform: x 0 is where the video starts.
export function SongTrackBehind({ song, songStartMs, zoom }: { song: SongOverview; songStartMs: number; zoom: number }) {
  const left = -(songStartMs / 1000) * zoom;
  const w = (song.durationMs / 1000) * zoom;
  const x = (ms: number) => (ms / 1000) * zoom;
  return (
    <div className="pointer-events-none absolute inset-y-0" style={{ left, width: w }} data-song-track-behind aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${Math.max(1, song.peaks.length)} 100`} preserveAspectRatio="none">
        {song.peaks.map((p, i) => (
          <rect key={i} x={i} y={50 - p * 48} width={0.8} height={Math.max(1, p * 96)} className="fill-white/35" />
        ))}
      </svg>
      {song.lines.map((l) => (
        <div key={l.number} className={`absolute bottom-0 h-1 rounded-sm ${l.isHook ? "bg-brand/70" : "bg-white/35"}`} style={{ left: x(l.startMs), width: Math.max(2, x((l.sungEndMs ?? l.startMs + 1000) - l.startMs)) }} />
      ))}
    </div>
  );
}

// The window on the song track: the dimmed song outside it, its edges to drag, the body to move it.
export function SongWindow({
  song,
  songStartMs,
  durationMs,
  zoom,
  editable,
  busy,
  onSet,
  onDrag,
}: {
  song: SongOverview;
  songStartMs: number; // where the planned video starts in the song
  durationMs: number; // the planned video's length
  zoom: number; // px per second
  editable: boolean;
  busy: boolean;
  onSet: (section: string) => void;
  onDrag: (d: SongWindowDrag | null) => void; // the window while dragged (the command bar's readout)
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const stopTracking = useRef<(() => void) | null>(null);
  const w = { startMs: songStartMs, endMs: songStartMs + durationMs };
  const shown = drag?.moved ? drag.now : { ...w, clean: false };
  const canDrag = editable && !song.locked && !busy;
  const x = (songMs: number) => ((songMs - songStartMs) / 1000) * zoom; // px from the video's start
  const pxPerMs = zoom / 1000;

  // The listeners start inside the pointerdown (trackPointer), so a quick move or release is never lost; they
  // call this render's move / finish through `latest`.
  const move = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return; // a click, not a drag (yet)
    const delta = (e.clientX - d.startX) / pxPerMs;
    const raw =
      d.mode === "move"
        ? { startMs: d.from.startMs + delta, endMs: d.from.endMs + delta }
        : d.mode === "start"
          ? { startMs: Math.max(0, Math.min(d.from.startMs + delta, d.from.endMs - 3000)), endMs: d.from.endMs }
          : { startMs: d.from.startMs, endMs: Math.min(song.durationMs, Math.max(d.from.endMs + delta, d.from.startMs + 3000)) };
    // Moving keeps the length: never past the song's start or end.
    if (d.mode === "move") {
      const len = d.from.endMs - d.from.startMs;
      raw.startMs = Math.min(Math.max(0, raw.startMs), song.durationMs - len);
      raw.endMs = raw.startMs + len;
    }
    const snapped = snapWindow(raw, song, e.altKey);
    const now = d.mode === "start" ? { ...snapped, endMs: d.from.endMs } : d.mode === "end" ? { ...snapped, startMs: d.from.startMs } : snapped;
    const next = { ...d, moved: true, now };
    dragRef.current = next;
    setDrag(next);
    onDrag(now);
  };
  const finish = (cancelled: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    stopTracking.current = null;
    setDrag(null);
    onDrag(null);
    if (!d?.moved) return;
    justDragged.current = true; // the click that ends the drag does not move the playhead
    setTimeout(() => (justDragged.current = false), 0);
    if (cancelled) return; // pointercancel / the window lost focus: nothing is saved
    if (Math.abs(d.now.startMs - d.from.startMs) < 20 && Math.abs(d.now.endMs - d.from.endMs) < 20) return;
    onSet(sectionText(d.now.startMs, d.now.endMs));
  };
  const latest = useRef<{ move: (e: PointerEvent) => void; finish: (cancelled: boolean) => void } | null>(null);
  useEffect(() => {
    latest.current = { move, finish };
  });
  useEffect(() => () => stopTracking.current?.(), []);

  const begin = (mode: Drag["mode"], e: React.PointerEvent) => {
    if (!canDrag || e.button !== 0) return;
    e.stopPropagation();
    if (mode !== "move") e.preventDefault();
    stopTracking.current?.();
    const d: Drag = { mode, startX: e.clientX, moved: false, from: w, now: { ...w, clean: false } };
    dragRef.current = d;
    setDrag(d);
    stopTracking.current = trackPointer(
      (ev) => latest.current?.move(ev),
      (_ev, cancelled) => latest.current?.finish(cancelled),
      mode === "move" ? "grabbing" : "ew-resize",
    );
  };
  const swallow = (e: React.MouseEvent) => {
    if (justDragged.current) e.stopPropagation();
  };

  const cut = drag?.moved ? linesCut(song.lines, shown.startMs, shown.endMs) : [];
  const songEnd = x(song.durationMs);
  const songStart = x(0);
  return (
    <>
      {/* outside the window: dimmed */}
      <div className="pointer-events-none absolute inset-y-0 bg-black/55" style={{ left: songStart, width: Math.max(0, x(shown.startMs) - songStart) }} data-song-dim="before" />
      <div className="pointer-events-none absolute inset-y-0 bg-black/55" style={{ left: x(shown.endMs), width: Math.max(0, songEnd - x(shown.endMs)) }} data-song-dim="after" />
      {/* the window */}
      <div
        className={`border-brand absolute inset-y-0 z-10 rounded-sm border-2 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ left: x(shown.startMs), width: Math.max(4, x(shown.endMs) - x(shown.startMs)) }}
        onPointerDown={(e) => begin("move", e)}
        onClick={swallow}
        data-soundtrack-window
        title={canDrag ? `The part of the song this video uses (${clockTenths(shown.startMs)} – ${clockTenths(shown.endMs)}). Drag it to move it, its edges to trim (snaps to bars and sung lines; Alt: free). A click plays from there.` : undefined}
      >
        <div className={`absolute inset-y-0 -left-1.5 w-3 ${canDrag ? "cursor-ew-resize" : ""}`} onPointerDown={(e) => begin("start", e)} onClick={swallow} data-soundtrack-edge="start" title="Drag: where the video starts in the song (snaps to a bar)">
          <div className="bg-brand mx-auto h-full w-1 rounded" />
        </div>
        <div className={`absolute inset-y-0 -right-1.5 w-3 ${canDrag ? "cursor-ew-resize" : ""}`} onPointerDown={(e) => begin("end", e)} onClick={swallow} data-soundtrack-edge="end" title="Drag: where the video ends in the song (snaps to the bar after a sung line)">
          <div className="bg-brand mx-auto h-full w-1 rounded" />
        </div>
      </div>
      {cut.length ? (
        <span className="pointer-events-none absolute top-0.5 z-20 rounded bg-black/80 px-1 text-[10px] whitespace-nowrap text-amber-300" style={{ left: x(shown.endMs) + 6 }} data-soundtrack-cuts>
          cuts line {cut.join(", ")} while it is sung
        </span>
      ) : null}
    </>
  );
}

// The command bar's readout: which part of the song this video uses, and "Automatic" when it is the user's.
export function SongRange({ song, window: w, drag, platformLabel, editable, busy, onAutomatic }: { song: SongOverview; window: { startMs: number; endMs: number }; drag: SongWindowDrag | null; platformLabel: string; editable: boolean; busy: boolean; onAutomatic: () => void }) {
  const shown = drag ?? { ...w, clean: false };
  const firstLine = song.lines.find((l) => l.startMs >= shown.startMs && l.startMs < shown.endMs) ?? null;
  return (
    <span className="flex items-center gap-1.5" data-soundtrack>
      <span className="tabular-nums" data-soundtrack-range title={`The whole song (${clockTenths(song.durationMs)}) is on the timeline's song track, never changed; ${platformLabel} uses the pink window. Drag the window or its edges on the song track.`}>
        Song {platformLabel.replace(/^Instagram /, "")}: <span className="text-brand font-medium">{clockTenths(shown.startMs)} – {clockTenths(shown.endMs)}</span> · {((shown.endMs - shown.startMs) / 1000).toFixed(1)} s
        {firstLine ? ` · line ${firstLine.number}` : ""}
        {drag ? (drag.clean ? " · ends after a sung line" : " · on the bar") : song.own ? " · chosen by you" : " · automatic"}
      </span>
      {song.own && editable && !song.locked ? (
        <button type="button" disabled={busy} onClick={onAutomatic} className="hover:bg-accent shrink-0 rounded border px-1 py-px" data-soundtrack-auto title="Let the app choose the part of the song again (starts just before the first chorus, ends on a finished phrase near the platform's length)">
          Automatic
        </button>
      ) : null}
      {song.locked ? <span className="text-muted-foreground shrink-0">locked</span> : null}
    </span>
  );
}
