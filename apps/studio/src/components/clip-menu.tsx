"use client";

// The ⋯ menu of a clip on the Shape timeline (8 Nov 2026, asked by the user: no Clip editor box, trim directly
// on the clip; its other settings in a small menu). Trimming is done on the timeline itself (drag a cut, the
// outer edges, slip inside a shot); this menu holds what is left of the old Clip editor: slow motion, how the clip
// comes in, its best moment and the Spotify Canvas, plus "Whole clip, automatic" and Omit. "Here" is the moment of
// the clip under the playhead (or the shot's first frame when the playhead is elsewhere). Each choice is saved in
// clips.json (song.json for the Canvas) and the video is planned again.
import { Check, MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import type { StoryShot } from "@lyric/video";
import type { StoryboardClip } from "@lyric/video/node"; // types only

import { cn } from "@/lib/utils";

export type ClipEditBody = { in?: number; out?: number; speed?: number; best?: number; transition?: "cut" | "dissolve" };

export const SPEEDS = [1, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5];

// The clip's own edits now (clips.json), so one menu choice changes only its own field.
export function currentClipEdit(c: StoryboardClip): ClipEditBody {
  return {
    ...(c.inS !== null ? { in: c.inS } : {}),
    ...(c.outS !== null ? { out: c.outS } : {}),
    ...(c.speed !== null && c.speed < 1 ? { speed: c.speed } : {}),
    ...(c.bestFrom === "clip editor" && c.bestS !== null ? { best: c.bestS } : {}),
    ...(c.transition ? { transition: c.transition } : {}),
  };
}

// The moment of the clip (seconds) shown at `playheadMs` in this shot; the shot's first frame when the playhead
// is outside it.
export function clipMomentAt(s: StoryShot, playheadMs: number): number {
  const at = Math.min(Math.max(playheadMs, s.startMs), Math.max(s.startMs, s.endMs - 34));
  return Math.round((s.inS + ((at - s.startMs) / 1000) * s.speed) * 100) / 100;
}

const item = "hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none select-none";
const content = "bg-popover text-popover-foreground z-50 min-w-56 rounded-md border p-1 text-xs shadow-lg";

function Radio({ on, label, onSelect, attrs }: { on: boolean; label: ReactNode; onSelect: () => void; attrs: Record<string, string> }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={item} {...attrs} aria-checked={on} role="menuitemradio">
      <Check className={cn("size-3 shrink-0", on ? "opacity-100" : "opacity-0")} />
      {label}
    </DropdownMenu.Item>
  );
}

function Sub({ label, value, children, attr }: { label: string; value: string; children: ReactNode; attr: string }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={cn(item, "justify-between")} data-clip-menu-sub={attr}>
        <span>{label}</span>
        <span className="text-muted-foreground">{value} ›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={content} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function ClipMenu({
  shot: s,
  clip,
  playheadMs,
  busy,
  onEdit,
  onCanvas,
  onOmit,
  variant = "icon",
  style,
}: {
  shot: StoryShot;
  clip: StoryboardClip;
  playheadMs: number;
  busy: boolean;
  onEdit: (edit: ClipEditBody | null) => void;
  onCanvas: (at: number | null) => void;
  onOmit?: () => void;
  variant?: "icon" | "button";
  style?: React.CSSProperties;
}) {
  const now = currentClipEdit(clip);
  const set = (patch: Partial<ClipEditBody>) => {
    const next: ClipEditBody = { ...now, ...patch };
    for (const k of Object.keys(next) as (keyof ClipEditBody)[]) if (next[k] === undefined) delete next[k];
    onEdit(next);
  };
  const video = clip.kind === "video";
  const here = clipMomentAt(s, playheadMs);
  const speed = clip.speed ?? 1;
  const own = Object.keys(now).length > 0;
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild disabled={busy}>
        {variant === "icon" ? (
          <button
            type="button"
            {...stop}
            data-clip-menu={clip.name}
            data-clip-menu-shot={s.index + 1}
            aria-label={`Settings of ${clip.name}`}
            title="Clip settings: slow motion, how it comes in, best moment, Spotify Canvas"
            className="absolute z-30 flex size-4 items-center justify-center rounded bg-black/70 text-white opacity-80 hover:opacity-100 disabled:opacity-30"
            style={style}
          >
            <MoreHorizontal className="size-3" />
          </button>
        ) : (
          <button type="button" {...stop} data-clip-menu={clip.name} data-clip-menu-panel className="hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs disabled:opacity-40">
            <MoreHorizontal className="size-3" /> Clip settings
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={content} {...stop} data-clip-menu-content={clip.name}>
          <DropdownMenu.Label className="text-muted-foreground truncate px-2 py-1 text-[11px]">{clip.name}</DropdownMenu.Label>
          {video ? (
            <Sub label="Speed" value={speed === 1 ? "1x" : `${speed}x`} attr="speed">
              {SPEEDS.map((v) => (
                <Radio key={v} on={speed === v} onSelect={() => set({ speed: v < 1 ? v : undefined })} attrs={{ "data-clip-speed": String(v) }} label={v === 1 ? "1x (normal)" : v < 0.75 ? `${v}x (the motion may look choppy)` : `${v}x slow motion`} />
              ))}
            </Sub>
          ) : null}
          <Sub label="Comes in with" value={clip.transition === "cut" ? "a cut" : clip.transition === "dissolve" ? "a dissolve" : "automatic"} attr="transition">
            <Radio on={!clip.transition} onSelect={() => set({ transition: undefined })} attrs={{ "data-clip-transition": "auto" }} label="Automatic (the app chooses)" />
            <Radio on={clip.transition === "cut"} onSelect={() => set({ transition: "cut" })} attrs={{ "data-clip-transition": "cut" }} label="A cut" />
            <Radio on={clip.transition === "dissolve"} onSelect={() => set({ transition: "dissolve" })} attrs={{ "data-clip-transition": "dissolve" }} label="A dissolve" />
          </Sub>
          {video ? (
            <Sub label="Best moment" value={clip.bestFrom === "clip editor" && clip.bestS !== null ? `yours, ${clip.bestS} s` : clip.autoBestS !== null ? `automatic, ${clip.autoBestS} s` : "automatic"} attr="best">
              <Radio on={clip.bestFrom === "clip editor" && clip.bestS === here} onSelect={() => set({ best: here })} attrs={{ "data-clip-best": "here" }} label={`Here: ${here} s of the clip (at the playhead)`} />
              <Radio on={clip.bestFrom !== "clip editor"} onSelect={() => set({ best: undefined })} attrs={{ "data-clip-best": "auto" }} label={clip.autoBestS !== null ? `Automatic: ${clip.autoBestS} s (the strongest 2 s)` : "Automatic"} />
            </Sub>
          ) : null}
          {video ? (
            <Sub label="Spotify Canvas" value={clip.canvas ? `this clip${clip.canvas.at !== null ? `, ${clip.canvas.at} s` : ""}` : "automatic"} attr="canvas">
              <Radio on={!!clip.canvas && clip.canvas.at === here} onSelect={() => onCanvas(here)} attrs={{ "data-canvas-use": "" }} label={`Use this clip from here (${here} s)`} />
              <Radio on={!clip.canvas} onSelect={() => onCanvas(null)} attrs={{ "data-canvas-unset": "" }} label="Let the app choose" />
            </Sub>
          ) : null}
          {own || onOmit ? <DropdownMenu.Separator className="bg-border my-1 h-px" /> : null}
          {own ? (
            <DropdownMenu.Item onSelect={() => onEdit(null)} className={item} data-clip-reset title="The whole clip, normal speed, the automatic best moment and transition">
              Whole clip, automatic
            </DropdownMenu.Item>
          ) : null}
          {onOmit ? (
            <DropdownMenu.Item onSelect={onOmit} className={item} data-clip-menu-omit title="Leaves this clip out of the videos (it keeps its place in the story order; Use it again in the Clips panel)">
              Omit this clip
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
