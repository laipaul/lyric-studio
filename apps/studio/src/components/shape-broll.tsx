"use client";

// "B-roll here" (27 Nov 2026, Paul: "build it"): one button in Shape, at the playhead, that does the right thing for the
// shot under it:
//   - a B-roll shot: Insert at playhead (about a bar of B-roll, the shot plays on after it) or Replace this shot;
//   - a singing shot: Cut away to B-roll (the take's "hide": the singer comes back in time with the song);
//   - an empty planned shot of a Mini film: Fill this shot;
//   - B-roll already laid there: its end a beat shorter / longer, or take it out.
// The app snaps every start and end to the beat (inserts.ts, anchors.ts). Everything is saved in the edit Make uses.
import { Clapperboard, Mic, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { StoryboardView } from "@lyric/video/node";

import { cn } from "@/lib/utils";

type Shot = StoryboardView["shots"][number];
type Mode = "insert" | "replace" | "cutaway" | "fill";

const at1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function BrollHere({ view, playheadMs, busy, edit, onDone }: { view: StoryboardView; playheadMs: number; busy: boolean; edit: (body: Record<string, unknown>) => Promise<unknown>; onDone: (text: string) => void }) {
  const [open, setOpen] = useState<{ mode: Mode; shot: number } | null>(null);
  const [q, setQ] = useState("");
  const shot: Shot | undefined = view.shots.find((s) => s.startMs <= playheadMs && playheadMs < s.endMs) ?? view.shots.at(-1);
  const songS = (view.songStartMs + playheadMs) / 1000;
  const beatS = view.bpm > 0 ? 60 / view.bpm : 0.5;
  const barS = beatS * 4;
  // The picker belongs to the shot it was opened on: the playhead on another shot closes it.
  const picking = open && shot && open.shot === shot.index ? open.mode : null;
  const setPicking = (mode: Mode | null) => setOpen(mode && shot ? { mode, shot: shot.index } : null);
  const insert = view.broll?.inserts.find((x) => x.from - 0.3 <= songS && songS < x.to);
  const cutaway = view.broll?.cutaways.find((x) => x.from - 0.3 <= songS && songS < x.to);
  const laid = insert ? { kind: "insert" as const, ...insert } : cutaway ? { kind: "cutaway" as const, ...cutaway } : null;
  const clips = useMemo(() => view.clips.filter((c) => (c.role ?? "story") === "story" && !c.omit && (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()))), [view.clips, q]);
  if (!view.editable || !shot) return null;
  const shotFromS = (view.songStartMs + shot.startMs) / 1000;
  const shotToS = (view.songStartMs + shot.endMs) / 1000;
  const label = (name: string) => name.replace(/\.[^.]+$/, "");

  async function pick(clip: string) {
    const mode = picking;
    setPicking(null);
    if (!mode || !shot) return;
    if (mode === "cutaway") {
      await edit({ action: "broll", kind: "cutaway", from: songS, to: Math.min(songS + barS, shotToS), clip });
      onDone(`Cut away to ${label(clip)} at ${at1(songS)}, about a bar; the singer comes back in time. Set its end with − / + here.`);
    } else if (mode === "insert") {
      await edit({ action: "broll", kind: "insert", from: songS, to: Math.min(songS + barS, view.songStartMs / 1000 + view.durationMs / 1000), clip });
      onDone(`B-roll ${label(clip)} inserted at ${at1(songS)}, about a bar; the shot plays on after it.`);
    } else {
      await edit({ action: "broll", kind: "insert", from: shotFromS, to: shotToS, clip });
      onDone(`${mode === "fill" ? "Shot filled" : "Shot replaced"} with ${label(clip)} (${at1(shotFromS)}–${at1(shotToS)}).`);
    }
  }
  const end = async (by: number) => {
    if (!laid) return;
    await edit({ action: "broll-end", kind: laid.kind, from: laid.from, to: Math.max(laid.from + beatS, laid.to + by) });
  };
  const remove = async () => {
    if (!laid) return;
    await edit({ action: "broll-remove", kind: laid.kind, from: laid.from });
    onDone(`The B-roll at ${at1(laid.from)} is taken out${laid.kind === "cutaway" ? ": the singer shows again" : ""}.`);
  };

  const button = (mode: Mode, text: string, title: string) => (
    <button type="button" data-broll={mode} disabled={busy} onClick={() => setPicking(picking === mode ? null : mode)} className={cn("hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 whitespace-nowrap", picking === mode && "border-brand bg-brand/15")} title={title}>
      {text}
    </button>
  );
  return (
    <div className="relative flex flex-wrap items-center gap-1 text-xs" data-broll-here={shot.role}>
      <span className="flex items-center gap-1 font-medium">
        <Clapperboard className="size-3.5" /> B-roll here
      </span>
      {laid ? (
        <>
          <span className="text-muted-foreground" data-broll-laid={laid.kind}>
            {label(laid.clip)} {at1(laid.from)}–{at1(laid.to)}
          </span>
          <button type="button" disabled={busy} onClick={() => void end(-beatS)} className="hover:bg-accent rounded border p-0.5" title="End a beat earlier" aria-label="End a beat earlier">
            <Minus className="size-3" />
          </button>
          <button type="button" disabled={busy} onClick={() => void end(beatS)} className="hover:bg-accent rounded border p-0.5" title="End a beat later" aria-label="End a beat later">
            <Plus className="size-3" />
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className="hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5" data-broll-remove>
            <Trash2 className="size-3" /> Take out
          </button>
        </>
      ) : shot.role === "singing" ? (
        <>
          <span className="flex items-center gap-1 text-emerald-300">
            <Mic className="size-3" /> on the singer
          </span>
          {button("cutaway", "Cut away to B-roll", "B-roll from the playhead for about a bar (its end adjustable): the song plays on and the singer comes back in time")}
        </>
      ) : shot.role === "empty" ? (
        button("fill", "Fill this shot", "Put a clip in this empty planned shot")
      ) : (
        <>
          {button("insert", "Insert at playhead", "About a bar of B-roll from the playhead (its end adjustable); this shot plays on after it")}
          {button("replace", "Replace this shot", "Another clip for this whole shot")}
        </>
      )}
      {picking ? (
        <div className="bg-popover absolute bottom-full left-0 z-30 mb-1 flex w-[min(28rem,90vw)] flex-col gap-1.5 rounded-lg border p-2 shadow-xl" data-broll-picker>
          <div className="flex items-center gap-1">
            <Search className="text-muted-foreground size-3.5" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a clip" className="bg-background min-w-0 flex-1 rounded border px-1.5 py-0.5" />
            <button type="button" onClick={() => setPicking(null)} aria-label="Close" className="hover:bg-accent rounded p-0.5">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
            {clips.map((c) => (
              <button key={c.name} type="button" data-broll-clip={c.name} onClick={() => void pick(c.name)} className="hover:border-brand/60 flex flex-col gap-0.5 rounded border p-0.5 text-left text-[10px]" title={c.name}>
                {c.thumb ? <img src={`/api/files/${c.thumb}`} alt="" className="bg-muted aspect-video w-full rounded object-cover" /> : <span className="bg-muted aspect-video w-full rounded" />}
                <span className="truncate">{label(c.name)}</span>
              </button>
            ))}
            {!clips.length ? <span className="text-muted-foreground col-span-3 p-2" data-broll-none>{q ? "No clip with that name." : `No B-roll clip for the ${view.platform.label}: it uses clips of its own shape only (${/16:9|YouTube|wide/i.test(view.platform.label) ? "16:9, landscape" : "9:16, vertical"}). Add some in Creation or Prepare → Storyboard.`}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
