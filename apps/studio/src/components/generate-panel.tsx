"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { GeneratePanelData } from "@lyric/video/library";
import type { GeneratePreset } from "@lyric/video/run-settings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const INTENSITIES = ["subtle", "balanced", "expressive"] as const;
const join = (name: string, intensity: string) => (intensity === "balanced" ? name : `${name}:${intensity}`);

const label = "flex flex-col gap-1.5 text-sm";
const select = "bg-input/30 border-input h-9 rounded-md border px-2 text-sm";

// Generate: makes videos for this song through the worker (the same as "pnpm make"); the progress
// shows in the Tasks menu. It starts from the song's recipe (Style tab: song.json, the artist's brand,
// per platform where they differ); only what is changed here is sent, for this run only unless "Save
// these choices to the song" is ticked. Locked settings cannot be changed here. Clips: the song's own
// clips folder plus the shared collections ticked here. "Use these settings" (Videos tab) opens it with
// a run's settings (`preset`): an auto section comes back as the exact times that run used, with a
// one-click switch back to "auto · <its target length>"; locked settings still come from the recipe.
export function GeneratePanel({ projectId, data, open: initiallyOpen, preset }: { projectId: string; data: GeneratePanelData; open: boolean; preset?: GeneratePreset | null }) {
  const [open, setOpen] = useState(initiallyOpen);
  const r = data.recipe;
  const locked = (field: string) => r.locked.includes(field);
  const known = (list: string[]) => list.filter((p) => data.platforms.some((x) => x.name === p));
  const from = preset ?? null;
  const startPlatforms = from && known(from.platforms).length ? known(from.platforms) : known(r.platforms);
  // The recipe's platforms; none set: Reels + YouTube (the Style tab says so).
  const fallback = ["reels", "youtube"].filter((p) => data.platforms.some((x) => x.name === p));
  const [platforms, setPlatforms] = useState<string[]>(startPlatforms.length ? startPlatforms : fallback.length ? fallback : [data.platforms[0]?.name ?? "standard"]);
  const videosFor = (name: string, preset: number) => (variations ? Number(variations) : (r.variations[name] ?? r.variations["*"] ?? preset));
  const recipeCollections = data.chosen.length || data.songClips ? data.chosen : data.collections.slice(0, 1);
  const runCollections = from?.collections && !locked("collections") ? from.collections.filter((c) => data.collections.includes(c)) : null;
  const [collections, setCollections] = useState<string[]>(runCollections ?? recipeCollections);
  // A run's video counts: one number when they were the same on every platform and differ from the recipe.
  const runVideos = (() => {
    if (!from || locked("variations")) return "";
    const counts = Object.entries(from.variations).filter(([p]) => p !== "canvas");
    const n = counts[0]?.[1];
    return counts.length && counts.every(([, c]) => c === n) && counts.some(([p, c]) => c !== (r.variations[p] ?? r.variations["*"] ?? data.platforms.find((x) => x.name === p)?.variations)) ? String(n) : "";
  })();
  const [variations, setVariations] = useState(runVideos);
  // "" = from the recipe (per platform where it differs); a choice here applies to this run only
  const runEffect = (value: string | null, recipeValue: string, field: string) => {
    if (!value || locked(field) || value === recipeValue) return { name: "", intensity: "balanced" };
    const [name, intensity = "balanced"] = value.split(":");
    return { name, intensity };
  };
  const [verse, setVerse] = useState(runEffect(from?.lineEffect ?? null, data.verseEffect, "verseEffect"));
  const [hook, setHook] = useState(runEffect(from?.hookEffect ?? null, data.hookEffect, "hookEffect"));
  // Section and target length: the run's exact times ("0:34–1:06 (from that run)") until switched back to auto.
  const runSection = from?.section && !locked("section") ? from.section : null;
  const [section, setSection] = useState(runSection ?? r.section);
  const [length, setLength] = useState("");
  const [layout, setLayout] = useState(from?.layout && !locked("youtubeLayout") && from.layout !== r.youtubeLayout ? from.layout : "");
  const fromRun = !!runSection && section === runSection;
  const [saveToSong, setSaveToSong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pairings, setPairings] = useState<string[]>([]); // compare font pairings: one video per pairing

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const f = new FormData(event.currentTarget);
    // Only what differs from the recipe is sent: the rest comes from song.json / the brand per platform.
    const changed = <T,>(value: T, recipeValue: T) => (JSON.stringify(value) === JSON.stringify(recipeValue) ? undefined : value);
    const chosenSection = section.trim() || r.section;
    const sameCollections = [...collections].sort().join(",") === [...data.chosen].sort().join(",");
    const request = {
      platforms,
      collection: sameCollections || !collections.length ? undefined : collections.join(","),
      variations: variations ? Number(variations) : undefined,
      lineEffect: verse.name ? join(verse.name, verse.intensity) : undefined,
      hookEffect: hook.name ? join(hook.name, hook.intensity) : undefined,
      title: String(f.get("title") ?? ""),
      artist: String(f.get("artist") ?? ""),
      ep: changed(String(f.get("ep") ?? ""), data.ep),
      section: changed(chosenSection, r.section),
      length: length ? Number(length) : undefined,
      saveToSong,
      allowFill: f.get("allowFill") === "on",
      layout: (layout || undefined) as "cover" | "stills" | "clips" | undefined,
      realign: f.get("realign") === "on",
      ...(pairings.length ? { pairings } : {}),
    };
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify(request));
    const cover = f.get("cover");
    if (cover instanceof File && cover.size) body.set("cover", cover);
    try {
      const res = await api("/api/runs", { method: "POST", body });
      const result = (await res.json()) as { error?: string; label?: string; saved?: { saved: string[]; kept: string[] } | null };
      if (!res.ok || result.error) throw new Error(result.error ?? `The studio answered ${res.status}`);
      const saved = result.saved
        ? `\n${result.saved.saved.length ? `Saved to the song: ${result.saved.saved.join(", ")}.` : "Nothing to save: this run uses the song's recipe."}${result.saved.kept.length ? ` Locked, kept as they are: ${result.saved.kept.join(", ")}.` : ""}`
        : "";
      setNotice({ ok: true, text: `Queued: ${result.label}. Follow it in Tasks (top right); the videos appear in the Videos tab when they are made.${saved}` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // "From the recipe (glide)"; the platforms with their own value go on a line under the list.
  const fromRecipe = (kind: "verse" | "hook") => `From the recipe (${kind === "verse" ? data.verseEffect : data.hookEffect})`;
  const perPlatform = (kind: "verse" | "hook") =>
    Object.entries(r.effects)
      .filter(([name, e]) => platforms.includes(name) && e[kind] !== (kind === "verse" ? data.verseEffect : data.hookEffect))
      .map(([name, e]) => `${data.platforms.find((p) => p.name === name)?.label ?? name}: ${e[kind]}`);
  const effectSelect = (value: { name: string; intensity: string }, set: (v: { name: string; intensity: string }) => void, name: string) => (
    <div className="flex gap-2">
      <select
        aria-label={`${name} effect`}
        className={cn(select, "min-w-0 flex-1")}
        value={value.name}
        disabled={locked(name === "Verse" ? "verseEffect" : "hookEffect")}
        onChange={(e) => set({ ...value, name: e.target.value })}
      >
        <option value="">{fromRecipe(name === "Verse" ? "verse" : "hook")}</option>
        {data.effects.map((e) => {
          const brandDefault = (name === "Verse" ? r.brandDefaults.verseEffect : r.brandDefaults.hookEffect).split(":")[0];
          return (
            <option key={e.name} value={e.name}>
              {e.label}
              {brandDefault === e.name ? " · brand default" : ""}
            </option>
          );
        })}
      </select>
      <select aria-label={`${name} intensity`} className={select} value={value.intensity} disabled={!value.name} onChange={(e) => set({ ...value, intensity: e.target.value })}>
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
          {from ? (
            <div data-from-run={from.folder} className="border-brand/30 bg-brand/10 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span>
                Settings of the run {from.folder.replace(/_(\d{2})(\d{2})/, " $1:$2")}: check them, then Generate (locked settings stay as in the recipe).
              </span>
              <Link href={`/songs/${projectId}?tab=generate`} className="text-muted-foreground hover:text-foreground text-xs underline">
                Back to the recipe
              </Link>
            </div>
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
                    {p.label}{" "}
                    <span className="opacity-60">
                      · {videosFor(p.name, p.variations)} video{videosFor(p.name, p.variations) === 1 ? "" : "s"} · {r.lengths[p.name] ? `${r.lengths[p.name]} s` : r.presetLengths[p.name]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset className={label} data-collections>
              <legend className="mb-1.5 font-medium">Clips</legend>
              <p className="text-muted-foreground text-xs">
                {data.songClips ? `This song's own clips (${data.songClips})` : "No clips of its own yet (Assets tab)"}
                {data.collections.length ? ", plus:" : ""}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {data.collections.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      data-collection-choice={c}
                      disabled={locked("collections")}
                      checked={collections.includes(c)}
                      onChange={(e) => setCollections((list) => (e.target.checked ? [...list, c] : list.filter((x) => x !== c)))}
                    />
                    {c}
                    {data.chosen.includes(c) ? <span className="text-muted-foreground text-xs">(this song&apos;s)</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={label}>
              <span className="font-medium">Verse effect{locked("verseEffect") ? " 🔒 locked in the song's recipe" : ""}</span>
              {effectSelect(verse, setVerse, "Verse")}
              {!verse.name && perPlatform("verse").length ? (
                <span data-per-platform-effects="verse" className="text-muted-foreground text-xs">
                  {perPlatform("verse").join(" · ")}
                </span>
              ) : null}
            </label>
            <label className={label}>
              <span className="font-medium">Hook effect{locked("hookEffect") ? " 🔒 locked in the song's recipe" : ""}</span>
              {effectSelect(hook, setHook, "Hook")}
              {!hook.name && perPlatform("hook").length ? (
                <span data-per-platform-effects="hook" className="text-muted-foreground text-xs">
                  {perPlatform("hook").join(" · ")}
                </span>
              ) : null}
            </label>
          </div>
          {data.pairings.length ? (
            <fieldset data-compare-pairings className="flex flex-col gap-1.5 text-sm">
              <legend className="font-medium">Compare font pairings (optional)</legend>
              <span className="text-muted-foreground text-xs">
                Tick 2–3: each platform gets one video per pairing, with the same section, clips and order, so only the fonts differ (compare them in Videos and on your phone). Without: the song&apos;s own fonts.
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {data.pairings.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5" title={p.note}>
                    <input
                      type="checkbox"
                      className="accent-brand"
                      data-pairing-option={p.id}
                      checked={pairings.includes(p.id)}
                      disabled={!pairings.includes(p.id) && pairings.length >= 3}
                      onChange={(e) => setPairings((list) => (e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id)))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
              {pairings.length === 1 ? <span className="text-xs text-amber-300">Tick one more to compare (one pairing makes one video in it).</span> : null}
            </fieldset>
          ) : null}
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
              <Input name="ep" defaultValue={data.ep} placeholder="optional" disabled={locked("ep")} />
            </label>
            <label className={label}>
              <span className="font-medium">New cover</span>
              <input name="cover" type="file" accept=".jpg,.jpeg,.png,.webp,image/*" className="text-muted-foreground file:bg-secondary file:text-secondary-foreground block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5" />
            </label>
          </div>
          {runSection ? (
            <div data-run-section className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">Section</span>
              {fromRun ? (
                <>
                  <span data-run-section-label>{from!.sectionLabel}</span>
                  {from!.sectionWasAuto ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-switch-auto
                      onClick={() => {
                        setSection("auto");
                        setLength(from!.targetLength ? String(from!.targetLength) : "");
                      }}
                    >
                      Switch to auto{from!.targetLength ? ` · ${from!.targetLength} s` : ""}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <span>
                    {section}
                    {length ? ` · ${length} s` : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSection(runSection);
                      setLength("");
                    }}
                  >
                    Back to {from!.sectionLabel}
                  </Button>
                </>
              )}
            </div>
          ) : null}
          <details className="text-sm" open={!!runSection || undefined}>
            <summary className="text-muted-foreground cursor-pointer">Advanced</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label className={label}>
                <span className="font-medium">Videos per platform</span>
                <Input type="number" min={1} max={24} placeholder="from the recipe" value={variations} disabled={locked("variations")} onChange={(e) => setVariations(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Target length (s)</span>
                <Input type="number" name="length" min={3} max={600} placeholder="from the recipe" value={length} disabled={locked("length")} onChange={(e) => setLength(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Section</span>
                <Input name="section" value={section} placeholder="auto, full or 0:11-1:10" disabled={locked("section")} onChange={(e) => setSection(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">YouTube layout</span>
                <select name="layout" className={select} value={layout} disabled={locked("youtubeLayout")} onChange={(e) => setLayout(e.target.value)}>
                  <option value="">from the recipe ({r.youtubeLayout})</option>
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-save-to-song checked={saveToSong} onChange={(e) => setSaveToSong(e.target.checked)} className="accent-brand" />
            Save these choices to the song (song.json); locked settings stay as they are
          </label>
          {notice ? (
            <p role="status" className={cn("rounded-md border p-3 text-sm whitespace-pre-line", notice.ok ? "border-brand/30 bg-brand/10" : "border-red-400/30 bg-red-400/10 text-red-200")}>
              {notice.text}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <span className="text-muted-foreground text-xs">
              {platforms.length ? `${data.platforms.filter((p) => platforms.includes(p.name)).reduce((a, p) => a + videosFor(p.name, p.variations), 0)} video(s)` : "choose a platform"}
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
