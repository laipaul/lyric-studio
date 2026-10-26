"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

import type { GeneratePanelData } from "@lyric/video/library";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const INTENSITIES = ["subtle", "balanced", "expressive"] as const;
const split = (choice: string) => {
  const [name, intensity = "balanced"] = choice.split(":");
  return { name, intensity };
};
const join = (name: string, intensity: string) => (intensity === "balanced" ? name : `${name}:${intensity}`);

const label = "flex flex-col gap-1.5 text-sm";
const select = "bg-input/30 border-input h-9 rounded-md border px-2 text-sm";

// Generate: makes videos for this song through the worker (the same as "pnpm make"); the progress
// shows in the Tasks menu. Defaults: the song's last collection, the artist's brand effects.
export function GeneratePanel({ projectId, data, open: initiallyOpen }: { projectId: string; data: GeneratePanelData; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [platforms, setPlatforms] = useState<string[]>(data.platforms.some((p) => p.name === "reels") ? ["reels"] : [data.platforms[0]?.name ?? "standard"]);
  const [collection, setCollection] = useState(data.collection ?? data.collections[0] ?? "");
  const [variations, setVariations] = useState("");
  const [verse, setVerse] = useState(split(data.verseEffect));
  const [hook, setHook] = useState(split(data.hookEffect));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const f = new FormData(event.currentTarget);
    const request = {
      platforms,
      collection: collection || undefined,
      variations: variations ? Number(variations) : undefined,
      lineEffect: join(verse.name, verse.intensity),
      hookEffect: join(hook.name, hook.intensity),
      title: String(f.get("title") ?? ""),
      artist: String(f.get("artist") ?? ""),
      ep: String(f.get("ep") ?? ""),
      section: String(f.get("section") ?? "auto"),
      allowFill: f.get("allowFill") === "on",
      layout: (String(f.get("layout") ?? "") || undefined) as "cover" | "stills" | "clips" | undefined,
      realign: f.get("realign") === "on",
    };
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify(request));
    const cover = f.get("cover");
    if (cover instanceof File && cover.size) body.set("cover", cover);
    try {
      const r = await fetch("/api/runs", { method: "POST", body });
      const result = (await r.json()) as { error?: string; label?: string };
      if (!r.ok || result.error) throw new Error(result.error ?? `The studio answered ${r.status}`);
      setNotice({ ok: true, text: `Queued: ${result.label}. Follow it in Tasks (top right); the videos appear here when they are made.` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const effectSelect = (value: { name: string; intensity: string }, set: (v: { name: string; intensity: string }) => void, name: string) => (
    <div className="flex gap-2">
      <select aria-label={`${name} effect`} className={cn(select, "flex-1")} value={value.name} onChange={(e) => set({ ...value, name: e.target.value })}>
        {data.effects.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <select aria-label={`${name} intensity`} className={select} value={value.intensity} onChange={(e) => set({ ...value, intensity: e.target.value })}>
        {INTENSITIES.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section data-generate className="bg-card rounded-xl border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left" aria-expanded={open}>
        <span className="flex items-center gap-2">
          <Sparkles className="text-brand size-4" />
          <span className="font-display text-base tracking-[0.12em] uppercase">Generate videos</span>
        </span>
        <ChevronDown className={cn("text-muted-foreground size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-5 border-t px-5 py-5">
          {!data.lyricsReady ? (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
              This song has no lyrics.txt in the app yet: use “+ New song” in the Library with the same song file and its lyrics (it updates this song).
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Platforms</legend>
            <div className="flex flex-wrap gap-2">
              {data.platforms.map((p) => {
                const on = platforms.includes(p.name);
                return (
                  <button
                    key={p.name}
                    type="button"
                    data-platform-choice={p.name}
                    onClick={() => setPlatforms((list) => (on ? list.filter((x) => x !== p.name) : [...list, p.name]))}
                    className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors", on ? "border-brand/50 bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")}
                  >
                    {p.label} <span className="opacity-60">· {p.variations} video{p.variations === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={label}>
              <span className="font-medium">Clips</span>
              <select name="collection" className={select} value={collection} onChange={(e) => setCollection(e.target.value)}>
                {data.collections.map((c) => (
                  <option key={c} value={c}>
                    {c}
                    {c === data.collection ? " (last used)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              <span className="font-medium">Verse effect</span>
              {effectSelect(verse, setVerse, "Verse")}
            </label>
            <label className={label}>
              <span className="font-medium">Hook effect</span>
              {effectSelect(hook, setHook, "Hook")}
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <label className={label}>
              <span className="font-medium">Title</span>
              <Input name="title" defaultValue={data.title} />
            </label>
            <label className={label}>
              <span className="font-medium">Artist</span>
              <Input name="artist" defaultValue={data.artist} list="generate-artists" />
              <datalist id="generate-artists">
                {data.artists.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className={label}>
              <span className="font-medium">EP</span>
              <Input name="ep" defaultValue={data.ep} placeholder="optional" />
            </label>
            <label className={label}>
              <span className="font-medium">New cover</span>
              <input name="cover" type="file" accept=".jpg,.jpeg,.png,.webp,image/*" className="text-muted-foreground file:bg-secondary file:text-secondary-foreground block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5" />
            </label>
          </div>
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">Advanced</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label className={label}>
                <span className="font-medium">Videos per platform</span>
                <Input type="number" min={1} max={24} placeholder="from the preset" value={variations} onChange={(e) => setVariations(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Section</span>
                <Input name="section" defaultValue="auto" placeholder="auto, full or 0:11-1:10" />
              </label>
              <label className={label}>
                <span className="font-medium">YouTube layout</span>
                <select name="layout" className={select} defaultValue="">
                  <option value="">from the preset (cover)</option>
                  <option value="cover">cover</option>
                  <option value="stills">stills</option>
                  <option value="clips">clips</option>
                </select>
              </label>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="allowFill" className="accent-brand" /> Allow fill (other orientation)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="realign" className="accent-brand" /> Align the lyrics again
                </label>
              </div>
            </div>
          </details>
          {notice ? (
            <p role="status" className={cn("rounded-md border p-3 text-sm whitespace-pre-line", notice.ok ? "border-brand/30 bg-brand/10" : "border-red-400/30 bg-red-400/10 text-red-200")}>
              {notice.text}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <span className="text-muted-foreground text-xs">
              {platforms.length ? `${data.platforms.filter((p) => platforms.includes(p.name)).reduce((a, p) => a + (variations ? Number(variations) : p.variations), 0)} video(s)` : "choose a platform"}
            </span>
            <Button type="submit" disabled={busy || !platforms.length || !data.lyricsReady}>
              <Sparkles /> {busy ? "Queuing…" : "Generate"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
