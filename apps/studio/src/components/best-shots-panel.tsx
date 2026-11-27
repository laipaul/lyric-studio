"use client";

// Best shot for each line across music videos (27 Nov 2026, Paul: "yes"). With two or more music videos of the song in
// Creation, each sung line has several shots; the app picks the best of each (mv-best.ts: the face, the whole line in
// one shot, room, size, variety), says why in plain words, and Paul can swap any line to another shot. Lines he set
// himself stay as they are. Nothing is sent anywhere: the shots are cut and checked locally.
import { Check, ChevronDown, ChevronRight, Loader2, Lock, Sparkles } from "lucide-react";
import { useState } from "react";

import type { BestView } from "@lyric/video/mv-best";
import type { ScoredCandidate } from "@lyric/video/mv-best-plan";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const linesName = (first: number, last: number) => (last > first ? `Lines ${first}–${last}` : `Line ${first}`);

export function BestShotsPanel({ best, videos, post, reload, setNotice, play }: { best: BestView; videos: Record<string, { url: string; offsetMs: number }>; post: (b: Record<string, unknown>) => Promise<unknown>; reload: () => Promise<void>; setNotice: (n: { ok: boolean; text: string }) => void; play: (url: string, title: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  async function run(key: string, body: Record<string, unknown>, done: (r: unknown) => string) {
    setBusy(key);
    try {
      const r = await post(body);
      setNotice({ ok: true, text: done(r) });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const clipUrl = (c: ScoredCandidate) => {
    const v = videos[c.video];
    if (!v) return null;
    const from = Math.max(0, (c.songFromMs - v.offsetMs) / 1000);
    const to = Math.max(from, (c.songToMs - v.offsetMs) / 1000);
    return { thumb: `${v.url}#t=${((from + to) / 2).toFixed(2)}`, range: `${v.url}#t=${from.toFixed(2)},${to.toFixed(2)}` };
  };
  const shotLine = (c: ScoredCandidate, main: boolean) => {
    const u = clipUrl(c);
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {u ? (
          <button type="button" onClick={() => play(u.range, `${c.label} · shot ${c.shot + 1}`)} className="shrink-0" title="Watch this shot">
            <video src={u.thumb} muted playsInline preload="metadata" className={cn("bg-muted rounded object-cover", main ? "h-10 w-16" : "h-8 w-12")} />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate" title={c.reasons.join(", ")}>
          <b>{c.label}</b> · shot {c.shot + 1}
          {c.reasons.length ? <span className="text-muted-foreground"> · {c.reasons.join(", ")}</span> : null}
        </span>
      </span>
    );
  };
  return (
    <div data-mv-best className="flex flex-col gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-[11px]">
      <span className="text-sm text-sky-200">
        <Sparkles className="mr-1 inline size-3.5" />
        Best shot for each line · from your {best.videos.length} music videos
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-mv-best-use
          disabled={busy !== null || (best.toPlace === 0 && best.unchecked === 0)}
          onClick={() => void run("all", { action: "mv-best" }, (r) => { const d = r as { placed: number; kept: number }; return `${d.placed} line${d.placed === 1 ? "" : "s"} got their best shot, ${d.kept} already had it. To make them sharper: "Make the shots in use 1080p" on each music video below.`; })}
          title="Every singing shot is cut out and its face checked (on this PC, free), then the best one goes on each line, in time with the song. Lines you set yourself stay as they are."
        >
          {busy === "all" ? <Loader2 className="animate-spin" /> : <Check />} {busy === "all" ? "Cutting and checking the shots…" : "Use the best for every line"}
        </Button>
        <span data-mv-best-note className="text-muted-foreground">
          {best.unchecked > 0 ? `${best.unchecked} shot${best.unchecked === 1 ? "" : "s"} to cut and check first (on this PC, free)` : best.toPlace > 0 ? `${best.toPlace} line${best.toPlace === 1 ? "" : "s"} to change` : "Every line has its best shot"}
        </span>
      </span>
      <div className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
        {best.rows.map((r) => {
          const isOpen = open.has(r.first);
          const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(r.first)) n.delete(r.first); else n.add(r.first); return n; });
          return (
            <div key={r.first} data-mv-best-row={r.first} className="flex flex-col gap-1 rounded border border-white/5 p-1">
              <span className="flex items-center gap-1.5">
                <span className="w-24 shrink-0 truncate" title={r.text}>
                  <b>{linesName(r.first, r.last)}</b>
                  <span className="text-muted-foreground block truncate">“{r.text}”</span>
                </span>
                {r.pick ? (
                  shotLine(r.pick, true)
                ) : (
                  <span data-mv-best-locked={r.locked ?? ""} className="text-muted-foreground flex flex-1 items-center gap-1">
                    <Lock className="size-3" /> {r.locked === "hand" ? "Your pick: the app leaves it" : "Your own take: the app leaves it"}
                  </span>
                )}
                {r.pick?.inUse ? (
                  <span data-mv-best-used className="flex shrink-0 items-center gap-1 text-emerald-300">
                    <Check className="size-3" /> In use
                  </span>
                ) : null}
                {r.others.length ? (
                  <button type="button" data-mv-best-others={r.first} onClick={toggle} className="hover:bg-accent flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-0.5">
                    {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Other takes ({r.others.length})
                  </button>
                ) : null}
              </span>
              {isOpen
                ? r.others.map((o) => (
                    <span key={`${o.video}:${o.shot}`} className="flex items-center gap-1.5 pl-6">
                      {shotLine(o, false)}
                      {o.inUse ? (
                        <span className="flex shrink-0 items-center gap-1 text-emerald-300">
                          <Check className="size-3" /> In use
                        </span>
                      ) : (
                        <button
                          type="button"
                          data-mv-best-pick={`${o.video}:${o.shot}`}
                          disabled={busy !== null}
                          onClick={() => void run(`${o.video}:${o.shot}`, { action: "mv-best-pick", file: o.video, shot: o.shot }, () => `${linesName(o.first, o.last)}: ${o.label} shot ${o.shot + 1}, in time with the song. Your pick: the app leaves it.`)}
                          className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5"
                          title="This shot goes on its lines instead, locked to the song; the app will not replace your pick"
                        >
                          {busy === `${o.video}:${o.shot}` ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Use this one
                        </button>
                      )}
                    </span>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
