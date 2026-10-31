"use client";

// The Shape page's transport bar under the viewer (31 Oct 2026, asked by the user): go to start, back one
// bar, play / pause, stop (pause and back to the start), forward one bar, go to end; the time, mute and full
// screen on the right; then the speed (1x, 0.75x, 0.5x, 0.25x: time to check the lyrics), Loop on / off and
// the volume. Speed and volume are the preview's only: the song file and the made videos are untouched.
// Shift-click on back / forward steps one frame. Keys (not while typing in a field): Space play / pause,
// ← / → one bar (Shift: one frame), Home / End.
import type { PlayerRef } from "@remotion/player";
import { FastForward, Maximize, Pause, Play, Repeat, Rewind, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { stepFrame, stepToBar } from "@lyric/video";

const FPS = 30;
const clock = (frame: number) => {
  const s = Math.max(0, Math.floor(frame / FPS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const SPEEDS = [1, 0.75, 0.5, 0.25] as const;

export function TransportBar({ player, frame, playing, durationInFrames, barFrames, rate, onRate, loop, onLoop }: { player: RefObject<PlayerRef | null>; frame: number; playing: boolean; durationInFrames: number; barFrames: number[]; rate: number; onRate: (r: number) => void; loop: boolean; onLoop: (l: boolean) => void }) {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const changeVolume = (v: number) => {
    const p = player.current;
    setVolume(v);
    if (!p) return;
    p.setVolume(v);
    // The player's own state changes after this call: keep ours as the truth.
    if (v > 0 && muted) p.unmute();
    if (v === 0 && !muted) p.mute();
    setMuted(v === 0);
  };
  const last = Math.max(0, durationInFrames - 1);
  const seek = (f: number) => player.current?.seekTo(Math.max(0, Math.min(last, f)));
  const now = () => player.current?.getCurrentFrame() ?? frame;
  const step = (dir: 1 | -1, fine: boolean) => seek(fine ? stepFrame(now(), durationInFrames, dir) : stepToBar({ frame: now(), barFrames, durationInFrames, dir, playing: player.current?.isPlaying() }));
  const toggle = () => {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else {
      if (now() >= last) p.seekTo(0); // at the end: play again from the start
      p.play();
    }
  };
  const stop = () => {
    player.current?.pause();
    seek(0);
  };
  const toggleMute = () => {
    const p = player.current;
    if (!p) return;
    if (muted) {
      p.unmute();
      if (volume === 0) {
        setVolume(1);
        p.setVolume(1);
      }
    } else p.mute();
    setMuted(!muted);
  };

  // Keyboard, while not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(t.tagName))) return;
      if (t?.closest("[role=menu], [role=listbox], [role=dialog]")) return;
      const p = player.current;
      if (!p) return;
      const at = p.getCurrentFrame();
      const go = (f: number) => p.seekTo(Math.max(0, Math.min(last, f)));
      if (e.key === " ") {
        if (p.isPlaying()) p.pause();
        else {
          if (at >= last) p.seekTo(0);
          p.play();
        }
      } else if (e.key === "ArrowLeft") go(e.shiftKey ? stepFrame(at, durationInFrames, -1) : stepToBar({ frame: at, barFrames, durationInFrames, dir: -1, playing: p.isPlaying() }));
      else if (e.key === "ArrowRight") go(e.shiftKey ? stepFrame(at, durationInFrames, 1) : stepToBar({ frame: at, barFrames, durationInFrames, dir: 1 }));
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, last, barFrames, durationInFrames]);

  return (
    <div data-transport data-frame={frame} data-playing={playing ? "1" : "0"} data-last={last} className="flex flex-wrap items-center gap-1">
      <Btn id="start" label="Go to the start (Home)" onClick={() => seek(0)}>
        <SkipBack className="size-4" />
      </Btn>
      <Btn id="back" label="Back one bar (←) · Shift: one frame" onClick={(e) => step(-1, e.shiftKey)}>
        <Rewind className="size-4" />
      </Btn>
      <Btn id="play" label={playing ? "Pause (Space)" : "Play (Space)"} onClick={toggle} big>
        {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
      </Btn>
      <Btn id="stop" label="Stop: pause and go back to the start" onClick={stop}>
        <Square className="size-3.5" />
      </Btn>
      <Btn id="forward" label="Forward one bar (→) · Shift: one frame" onClick={(e) => step(1, e.shiftKey)}>
        <FastForward className="size-4" />
      </Btn>
      <Btn id="end" label="Go to the end (End)" onClick={() => seek(last)}>
        <SkipForward className="size-4" />
      </Btn>
      <span data-transport-time className="ml-2 font-mono text-xs tabular-nums" title="Where the playhead is / the video's length">
        {clock(frame)} <span className="text-muted-foreground">/ {clock(durationInFrames)}</span>
      </span>
      <label className="text-muted-foreground ml-2 flex items-center gap-1 text-xs" title="Play slower to check the lyrics (the preview only)">
        Speed
        <select data-transport-speed value={String(rate)} onChange={(e) => onRate(Number(e.target.value))} className={`bg-background rounded border px-1 py-0.5 text-xs ${rate !== 1 ? "text-brand border-brand/60" : ""}`}>
          {SPEEDS.map((r) => (
            <option key={r} value={String(r)}>
              {r}x
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-transport-button="loop"
        aria-pressed={loop}
        title={loop ? "Loop on: plays again from the start" : "Loop off: stops at the end"}
        onClick={() => onLoop(!loop)}
        className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-xs ${loop ? "bg-brand/25 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
      >
        <Repeat className="size-4" /> Loop
      </button>
      <Btn id="mute" label={muted ? "Sound on" : "Mute"} onClick={toggleMute}>
        {muted || volume === 0 ? <VolumeX className="size-4" /> : volume < 0.5 ? <Volume1 className="size-4" /> : <Volume2 className="size-4" />}
      </Btn>
      <input
        type="range"
        data-transport-volume
        aria-label="Volume (the preview only)"
        title="Volume (the preview only)"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => changeVolume(Number(e.target.value))}
        className="accent-brand w-16"
      />
      <Btn id="fullscreen" label="Full screen" onClick={() => player.current?.requestFullscreen()}>
        <Maximize className="size-4" />
      </Btn>
    </div>
  );
}

function Btn({ id, label, onClick, big, children }: { id: string; label: string; onClick: (e: React.MouseEvent) => void; big?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      data-transport-button={id}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={big ? "bg-brand text-primary-foreground hover:bg-brand/90 mx-0.5 flex size-8 items-center justify-center rounded-full" : "text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"}
    >
      {children}
    </button>
  );
}
