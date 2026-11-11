"use client";

// Prepare → Storyboard → Add clips & photos → "From a collection…" (11 Nov 2026): every shared collection with its
// thumbnails; the user picks single clips (several at once) for the story line, or lets the app pick from the whole
// collection (one "app picks" card). Nothing is copied: the clips stay in their collection; the song only names them.
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import type { ClipAsset } from "@lyric/video/assets";
import type { CollectionSummary } from "@lyric/video/collections";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CollectionPicker({
  open,
  onOpenChange,
  inStory,
  cards,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inStory: (collection: string, clip: string) => boolean; // already in the story line
  cards: readonly string[]; // collections already in the line as an "app picks" card
  onAdd: (collection: string, clips: string[], whole: boolean) => Promise<boolean>;
}) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [list, setList] = useState<ClipAsset[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api("/api/collections", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ collections?: CollectionSummary[]; error?: string }>)
      .then((d) => {
        if (!alive) return;
        const all = (d.collections ?? []).filter((c) => !c.sameAs);
        setCollections(all);
        setCurrent((c) => c ?? all[0]?.name ?? null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !current) return;
    let alive = true;
    api(`/api/collections/${encodeURIComponent(current)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ list?: ClipAsset[]; error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setList((d.list ?? []).filter((c) => !c.duplicateOf))))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, current]);

  // Another collection: its clips load, nothing chosen yet.
  const choose = (name: string) => {
    if (name === current) return;
    setList(null);
    setChosen([]);
    setWhole(false);
    setCurrent(name);
  };
  const toggle = (name: string) => setChosen((c) => (c.includes(name) ? c.filter((n) => n !== name) : [...c, name]));
  const hasCard = !!current && cards.includes(current);
  const count = chosen.length + (whole && !hasCard ? 1 : 0);

  async function add() {
    if (!current || !count) return;
    setBusy(true);
    const ok = await onAdd(current, chosen, whole && !hasCard);
    setBusy(false);
    if (ok) {
      setChosen([]);
      setWhole(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-collection-picker className="flex max-h-[85vh] w-[min(56rem,95vw)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Add clips from a collection</DialogTitle>
          <DialogDescription>Pick the clips you want in your story line. They stay in the collection; removing one from this song never removes it there.</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {collections && !collections.length ? <p className="text-muted-foreground text-sm">No shared collections yet. Make one on the Collections page.</p> : null}
        {collections?.length ? (
          <div role="group" aria-label="Collections" className="flex flex-wrap gap-1.5" data-picker-collections>
            {collections.map((c) => (
              <button
                key={c.name}
                type="button"
                data-picker-collection={c.name}
                aria-pressed={current === c.name}
                onClick={() => choose(c.name)}
                className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-sm", current === c.name ? "border-brand bg-brand/15 text-brand" : "hover:bg-accent")}
              >
                {c.thumbs[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                  <img src={`/api/files/${c.thumbs[0]}`} alt="" className="size-5 rounded object-cover" />
                ) : null}
                {c.name} <span className="text-muted-foreground text-xs">{c.clips}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {current && !list ? <p className="text-muted-foreground text-sm">Loading {current}…</p> : null}
          {list && !list.length ? <p className="text-muted-foreground text-sm">{current} has no clips.</p> : null}
          {list?.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2" data-picker-clips>
              {list.map((c) => {
                const there = !!current && inStory(current, c.name);
                const on = chosen.includes(c.name);
                return (
                  <li key={c.name}>
                    <button
                      type="button"
                      data-pick-clip={c.name}
                      aria-pressed={on}
                      disabled={there || busy}
                      onClick={() => toggle(c.name)}
                      title={there ? `${c.name} is already in your story line` : c.name}
                      className={cn("bg-card relative block w-full overflow-hidden rounded-lg border text-left text-[11px]", on && "border-brand ring-brand ring-2", there && "opacity-50")}
                    >
                      <div className="aspect-[9/12] bg-black">
                        {c.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                          <img src={`/api/files/${c.thumb}`} alt="" className="size-full object-contain" />
                        ) : null}
                      </div>
                      <span className={cn("absolute top-1 left-1 flex size-5 items-center justify-center rounded-full border", on ? "bg-brand border-brand text-brand-foreground" : "bg-black/60")}>{on ? <Check className="size-3" /> : null}</span>
                      <span className="absolute top-1 right-1 rounded bg-black/70 px-1 text-[9px] uppercase">{c.orientation}</span>
                      <p className="truncate px-1.5 pt-1 font-medium">{c.name}</p>
                      <p className="text-muted-foreground px-1.5 pb-1">{there ? "in your story line" : c.kind === "photo" ? "photo" : `${(c.durationMs / 1000).toFixed(1)} s`}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <label className="flex items-center gap-2 text-sm" title={hasCard ? `${current} is already in your story line as one card` : undefined}>
              <input type="checkbox" data-pick-whole checked={whole || hasCard} disabled={hasCard || busy} onChange={(e) => setWhole(e.target.checked)} className="accent-brand" />
              Let the app pick from the whole collection{hasCard ? " (already in your story line)" : ""}
            </label>
            <div className="flex items-center gap-2">
              {chosen.length ? (
                <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline" onClick={() => setChosen([])}>
                  Clear
                </button>
              ) : null}
              <Button type="button" size="sm" data-pick-add disabled={!count || busy} onClick={() => void add()}>
                {chosen.length ? `Add ${chosen.length} clip${chosen.length === 1 ? "" : "s"}${whole && !hasCard ? " + the app's pick" : ""}` : whole && !hasCard ? `Add ${current} (the app picks)` : "Add"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
