"use client";

// The soundtrack track on the Shape page (7 Nov 2026, asked by the user: "keep the whole song untouched, pick when
// the soundtrack starts", like trimming the music in Canva): the WHOLE song (waveform, sung lines, choruses) with
// this video as a window on it. Drag the window to move it, its edges to set where the video starts and ends: the
// start snaps to a bar, the end to the first bar after a sung line (a clean end; else a bar); Alt: exactly there.
// Saved as this platform's section in song.json (the same as Make → "Part of the song"); "Automatic" gives it back
// to the app. The song file is never changed: the video takes that part of it. Edits on the clips (cuts, slips)
// live on the song's timeline, so they stay at the same musical moments when the window moves.
import { useEffect, useRef, useState } from "react";

import { clockTenths, linesCut, sectionText, snapWindow } from "@lyric/video";
import type { SongOverview } from "@lyric/video/node"; // types only

type Drag = { mode: "move" | "start" | "end"; startX: number; from: { startMs: number; endMs: number }; now: { startMs: number; endMs: number; clean: boolean } };

export function SoundtrackWindow({
  song,
  window: w,
  playheadSongMs,
  platformLabel,
  editable,
  busy,
  onSet,
  onAutomatic,
}: {
  song: SongOverview;
  window: { startMs: number; endMs: number };
  playheadSongMs: number;
  platformLabel: string;
  editable: boolean;
  busy: boolean;
  onSet: (section: string) => void;
  onAutomatic: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxPerMs = width / Math.max(1, song.durationMs);
  const x = (ms: number) => ms * pxPerMs;
  const shown = drag?.now ?? { ...w, clean: false };
  const canDrag = editable && !song.locked && !busy;

  useEffect(() => {
    if (!drag) return;
    dragRef.current = drag;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !pxPerMs) return;
      const delta = (e.clientX - d.startX) / pxPerMs;
      const raw =
        d.mode === "move"
          ? { startMs: d.from.startMs + delta, endMs: d.from.endMs + delta }
          : d.mode === "start"
            ? { startMs: Math.min(d.from.startMs + delta, d.from.endMs - 3000), endMs: d.from.endMs }
            : { startMs: d.from.startMs, endMs: Math.max(d.from.endMs + delta, d.from.startMs + 3000) };
      // Moving keeps the length: never past the song's start or end.
      if (d.mode === "move") {
        const len = d.from.endMs - d.from.startMs;
        raw.startMs = Math.min(Math.max(0, raw.startMs), song.durationMs - len);
        raw.endMs = raw.startMs + len;
      }
      const snapped = snapWindow(raw, song, e.altKey);
      const next = { ...d, now: d.mode === "start" ? { ...snapped, endMs: d.from.endMs } : d.mode === "end" ? { ...snapped, startMs: d.from.startMs } : snapped };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (Math.abs(d.now.startMs - d.from.startMs) < 20 && Math.abs(d.now.endMs - d.from.endMs) < 20) return;
      onSet(sectionText(d.now.startMs, d.now.endMs));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the drag's own state is in dragRef
  }, [drag === null]);

  const begin = (mode: Drag["mode"]) => (e: React.PointerEvent) => {
    if (!canDrag || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({ mode, startX: e.clientX, from: { startMs: w.startMs, endMs: w.endMs }, now: { ...w, clean: false } }); // dragRef follows in the effect
  };

  const cut = linesCut(song.lines, shown.startMs, shown.endMs);
  const firstLine = song.lines.find((l) => l.startMs >= shown.startMs && l.startMs < shown.endMs) ?? null;
  const maxPeak = Math.max(0.0001, ...song.peaks);
  return (
    <div className="flex items-center gap-2" data-soundtrack>
      <div className="flex w-80 shrink-0 items-center gap-1.5 text-[11px] leading-tight">
        <span className="truncate tabular-nums" data-soundtrack-range title={`Soundtrack: the whole song (${clockTenths(song.durationMs)}), never changed. ${platformLabel} uses this part of it.`}>
          <span className="font-medium">Soundtrack</span> {platformLabel.replace(/^Instagram /, "")}: <span className="text-brand font-medium">{clockTenths(shown.startMs)} – {clockTenths(shown.endMs)}</span> · {((shown.endMs - shown.startMs) / 1000).toFixed(1)} s
          {firstLine ? ` · line ${firstLine.number}` : ""}
          {drag ? (drag.now.clean ? " · ends after a sung line" : " · on the bar") : song.own ? " · chosen by you" : " · automatic"}
        </span>
        {song.own && editable && !song.locked ? (
          <button type="button" disabled={busy} onClick={onAutomatic} className="hover:bg-accent ml-auto shrink-0 rounded border px-1 py-px" data-soundtrack-auto title="Let the app choose the part of the song again (starts just before the first chorus, ends on a finished phrase near the platform's length)">
            Automatic
          </button>
        ) : null}
        {song.locked ? <span className="text-muted-foreground ml-auto shrink-0">locked</span> : null}
      </div>
      <div ref={track} className="bg-card/40 relative h-7 min-w-0 flex-1 overflow-hidden rounded-md border select-none" data-soundtrack-track title="The whole song. Drag the window to move it, its edges to trim (snaps to bars and sung lines; Alt: free)">
        {/* the waveform of the whole song */}
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${Math.max(1, song.peaks.length)} 100`} preserveAspectRatio="none" aria-hidden>
          {song.peaks.map((p, i) => (
            <rect key={i} x={i} y={50 - (p / maxPeak) * 46} width={0.8} height={Math.max(1, (p / maxPeak) * 92)} className="fill-white/35" />
          ))}
        </svg>
        {/* sung lines (choruses brighter) */}
        {song.lines.map((l) => (
          <div key={l.number} className={`absolute bottom-0 h-1.5 rounded-sm ${l.isHook ? "bg-brand/80" : "bg-white/40"}`} style={{ left: x(l.startMs), width: Math.max(2, x((l.sungEndMs ?? l.startMs + 1000) - l.startMs)) }} title={`line ${l.number}: ${l.text}`} />
        ))}
        {/* outside the window: dimmed */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: x(shown.startMs) }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/55" style={{ left: x(shown.endMs) }} />
        {/* the window */}
        <div
          className={`border-brand absolute inset-y-0 rounded-sm border-2 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
          style={{ left: x(shown.startMs), width: Math.max(4, x(shown.endMs - shown.startMs)) }}
          onPointerDown={begin("move")}
          data-soundtrack-window
          title={canDrag ? "Drag to move the part of the song this video uses" : undefined}
        >
          <div className={`absolute inset-y-0 -left-1.5 w-3 ${canDrag ? "cursor-ew-resize" : ""}`} onPointerDown={begin("start")} data-soundtrack-edge="start" title="Drag: where the video starts in the song (snaps to a bar)">
            <div className="bg-brand mx-auto h-full w-1 rounded" />
          </div>
          <div className={`absolute inset-y-0 -right-1.5 w-3 ${canDrag ? "cursor-ew-resize" : ""}`} onPointerDown={begin("end")} data-soundtrack-edge="end" title="Drag: where the video ends in the song (snaps to the bar after a sung line)">
            <div className="bg-brand mx-auto h-full w-1 rounded" />
          </div>
        </div>
        {drag && cut.length ? (
          <span className="absolute top-0.5 right-1 rounded bg-black/80 px-1 text-[10px] text-amber-300" data-soundtrack-cuts>
            cuts line {cut.join(", ")} while it is sung
          </span>
        ) : null}
        {/* where the preview is in the song */}
        {!drag ? <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: x(playheadSongMs) }} data-soundtrack-playhead /> : null}
      </div>
    </div>
  );
}
