"use client";

import { ChevronDown, Minus, Play, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { THEME_MOODS } from "@lyric/video";
import type { GeneratePanelData } from "@lyric/video/library";
import type { GeneratePreset } from "@lyric/video/run-settings";

import { PickedChip, SearchPicker } from "@/components/search-picker";
import { useGoToTab, useMakePart, useShapePanel } from "@/components/song-stages";
import { Button } from "@/components/ui/button";
import { FeatureIcon, PlatformMark } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

// The Make stage (11 Nov 2026, decided with the user): two tabs, each with its own button and its own count.
//   Make: one row of platform chips, each with how many versions (Canvas: loops) this song gets. The chips ARE the
//     song's settings (song.json platforms and variations, saved at once; 0 = not made; the default 1 each, by the one
//     counts rule in recipe.ts). "One of each" makes one video for every platform that is on; "Make N videos" all of
//     them; ▶ on a chip makes only that platform. The other-orientation option sits under Advanced.
//   Compare looks: its own platform chips (Reels by default), 1-3 other themes OR 2-4 picture sets; one video per
//     platform per look (each a try with its own shot plan), and the song's own v1 wherever a platform has none yet.
// Every video comes from its shot plan (2e-1). Both buttons wait, with the reason, while something blocks.
// "Use these settings" (a past run): the chips start from that run (not saved), with a banner saying so.
export function GeneratePanel({
  projectId,
  data,
  preset,
  blocked = null,
  ownMade = [],
}: {
  projectId: string;
  data: GeneratePanelData;
  open?: boolean; // kept for callers
  preset?: GeneratePreset | null;
  blocked?: string | null; // a blocking to-do in Prepare ("First: add clips")
  ownMade?: string[]; // platforms with one of the song's own videos (not a try): the comparison's baseline
}) {
  const { part } = useMakePart();
  const choices = data.platforms.filter((p) => p.name !== "standard");
  const why = blocked ?? (!data.lyricsReady ? "First: the lyrics (Prepare → Lyrics & timing)." : null);
  return (
    <section data-generate className="flex flex-col gap-5">
      <div hidden={part !== "videos"} data-make-part="videos">
        <MakeVideos projectId={projectId} data={data} choices={choices} preset={preset ?? null} why={why} />
      </div>
      <div hidden={part !== "looks"} data-make-part="looks">
        <CompareLooks projectId={projectId} data={data} choices={choices} why={why} ownMade={ownMade} />
      </div>
    </section>
  );
}

type Choice = GeneratePanelData["platforms"][number];
const unit = (name: string, n: number) => (name === "canvas" ? `${n} loop${n === 1 ? "" : "s"}` : `${n} video${n === 1 ? "" : "s"}`);

// Queue a run (the Tasks menu shows it; Review shows a placeholder card until it is made).
function useQueue(projectId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  async function queue(request: Record<string, unknown>) {
    setBusy(true);
    setNotice(null);
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify(request));
    try {
      const res = await api("/api/runs", { method: "POST", body });
      const result = (await res.json()) as { error?: string; label?: string; saved?: { saved: string[]; kept: string[] } | null };
      if (!res.ok || result.error) throw new Error(result.error ?? `The studio answered ${res.status}`);
      const saved = result.saved ? ` ${result.saved.saved.length ? `Kept for the song: ${result.saved.saved.join(", ")}.` : ""}${result.saved.kept.length ? ` Locked, kept as they are: ${result.saved.kept.join(", ")}.` : ""}` : "";
      setNotice({ ok: true, text: `Queued: ${result.label}. Follow it in Tasks (top right); the videos appear in Review.${saved}` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
      router.refresh();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return { busy, notice, queue };
}

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  return notice ? (
    <p role="status" data-make-notice className={cn("rounded-md border p-3 text-sm whitespace-pre-line", notice.ok ? "border-brand/30 bg-brand/10" : "border-red-400/30 bg-red-400/10 text-red-200")}>
      {notice.text}
    </p>
  ) : null;
}

// ---------------------------------------------------------------- Make

function MakeVideos({ projectId, data, choices, preset, why }: { projectId: string; data: GeneratePanelData; choices: Choice[]; preset: GeneratePreset | null; why: string | null }) {
  const router = useRouter();
  const goToTab = useGoToTab();
  const { setPanel } = useShapePanel();
  const { busy, notice, queue } = useQueue(projectId);
  const r = data.recipe;
  const fromRun = (p: GeneratePreset) => Object.fromEntries(p.platforms.filter((n) => choices.some((c) => c.name === n)).map((n) => [n, p.variations[n] ?? 1]));
  const [counts, setCounts] = useState<Record<string, number>>(preset ? fromRun(preset) : data.counts);
  // The song's counts can change elsewhere (a refresh): follow them while nothing is being edited here.
  const editing = useRef(false);
  const songKey = JSON.stringify(data.counts);
  useEffect(() => {
    if (!preset && !editing.current) setCounts(data.counts);
  }, [songKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = (next: Record<string, number>) => {
    // The chips are the song's settings: saved at once (a run from a past run's settings is not saved here).
    if (preset) return;
    editing.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const on = choices.map((c) => c.name).filter((n) => (next[n] ?? 0) > 0);
      // Every platform off would read as "none chosen yet" (= every platform): kept unsaved, the button says why.
      if (!on.length) {
        editing.current = false;
        return;
      }
      try {
        for (const body of [
          { action: "set", field: "platforms", value: on },
          { action: "set", field: "variations", value: Object.fromEntries(on.map((n) => [n, next[n]])) },
        ]) {
          const res = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const d = (await res.json()) as { error?: string };
          if (!res.ok || d.error) throw new Error(d.error ?? `The studio answered ${res.status}`);
        }
        setSaveError(null);
        router.refresh();
      } catch (e) {
        setSaveError(`Not saved: ${(e as Error).message}`);
      } finally {
        editing.current = false;
      }
    }, 400);
  };
  const setCount = (name: string, n: number) => {
    const next = { ...counts, [name]: Math.max(0, Math.min(24, n)) };
    setCounts(next);
    save(next);
  };
  const on = choices.filter((c) => (counts[c.name] ?? 0) > 0);
  const total = on.reduce((n, c) => n + counts[c.name], 0);
  const reason = why ?? (!on.length ? "Turn on at least one platform." : null);

  // A past run's settings ("Use these settings"): its part of the song, length and layout go with the run.
  const [sectionEdit, setSection] = useState<string | null>(null);
  const [length, setLength] = useState("");
  const [saveToSong, setSaveToSong] = useState(false);
  const runSection = preset?.section && !r.locked.includes("section") ? preset.section : null;
  const section = sectionEdit ?? runSection;
  const layout = preset?.layout && !r.locked.includes("youtubeLayout") && preset.layout !== r.youtubeLayout ? preset.layout : null;
  const collections = preset?.collections && !r.locked.includes("collections") ? preset.collections.filter((c) => data.collections.includes(c)) : null;
  const [allowFill, setAllowFill] = useState(false);
  const runExtras = () => ({
    allowFill,
    title: data.title,
    artist: data.artist,
    ...(preset
      ? {
          ...(section && section !== r.section ? { section } : {}),
          ...(length ? { length: Number(length) } : {}),
          ...(layout ? { layout } : {}),
          ...(collections && [...collections].sort().join(",") !== [...data.chosen].sort().join(",") ? { collection: collections.join(",") } : {}),
          saveToSong,
        }
      : {}),
  });
  const make = (names: string[], each?: number) => queue({ platforms: names, counts: Object.fromEntries(names.map((n) => [n, each ?? counts[n]])), ...runExtras() });
  const when = (folder: string) => folder.replace(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2}).*$/, (_m, y, mo, d, h, mi) => `${new Date(Number(y), Number(mo) - 1, Number(d)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} ${h}:${mi}`);

  return (
    <div className="flex flex-col gap-5">
      {preset ? (
        <div data-from-run={preset.folder} className="border-brand/30 bg-brand/10 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              From the run of {when(preset.folder)}: its platforms and versions below (not saved to the song), its part of the song{layout ? " and YouTube layout" : ""}.
            </span>
            <Link href={`/songs/${projectId}?tab=generate`} className="text-muted-foreground hover:text-foreground text-xs underline">
              Back to the song&apos;s settings
            </Link>
          </div>
          {runSection ? (
            <div data-run-section className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium">Part of the song</span>
              {section === runSection ? (
                <>
                  <span data-run-section-label>{preset.sectionLabel}</span>
                  {preset.sectionWasAuto ? (
                    <Button type="button" size="sm" variant="secondary" data-switch-auto onClick={() => (setSection("auto"), setLength(preset.targetLength ? String(preset.targetLength) : ""))}>
                      Switch to auto{preset.targetLength ? ` · ${preset.targetLength} s` : ""}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <span>
                    {section}
                    {length ? ` · ${length} s` : ""}
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => (setSection(runSection), setLength(""))}>
                    Back to {preset.sectionLabel}
                  </Button>
                </>
              )}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" data-save-to-song checked={saveToSong} onChange={(e) => setSaveToSong(e.target.checked)} className="accent-brand" />
            Also keep that run&apos;s settings for this song
          </label>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          What this song gets <span className="text-muted-foreground ml-1 text-xs font-normal">{preset ? "for this run" : "saved for the song at once · 0 = not made"}</span>
        </h3>
        <div className="flex flex-wrap gap-2" data-make-chips>
          {choices.map((c) => {
            const n = counts[c.name] ?? 0;
            return (
              <div key={c.name} data-make-chip={c.name} data-count={n} className={cn("bg-card flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm", n ? "border-brand/50" : "text-muted-foreground border-dashed")}>
                <button type="button" aria-pressed={n > 0} data-chip-toggle={c.name} onClick={() => setCount(c.name, n ? 0 : 1)} className="flex items-center gap-1.5" title={n ? `Do not make ${c.label} for this song` : `Make ${c.label} for this song`}>
                  <PlatformMark platform={c.name} />
                  <span className={cn(n && "text-foreground font-medium")}>{c.label}</span>
                </button>
                <button type="button" aria-label={`fewer ${c.label}`} data-count-minus={c.name} disabled={!n} onClick={() => setCount(c.name, n - 1)} className="hover:bg-accent rounded-full p-1 disabled:opacity-30">
                  <Minus className="size-3" />
                </button>
                <span className="min-w-14 text-center text-xs tabular-nums" data-count-text={c.name}>
                  {n ? unit(c.name, n) : "off"}
                </span>
                <button type="button" aria-label={`more ${c.label}`} data-count-plus={c.name} disabled={n >= 24} onClick={() => setCount(c.name, n + 1)} className="hover:bg-accent rounded-full p-1 disabled:opacity-30">
                  <Plus className="size-3" />
                </button>
                <button
                  type="button"
                  data-make-only={c.name}
                  disabled={!n || busy || !!why}
                  onClick={() => void make([c.name])}
                  title={n ? `Make only ${c.label} now (${unit(c.name, n)})` : undefined}
                  className="text-brand hover:bg-brand/15 rounded-full p-1 disabled:opacity-30"
                >
                  <Play className="size-3" />
                  <span className="sr-only">Make only {c.label}</span>
                </button>
              </div>
            );
          })}
        </div>
        {saveError ? <p className="text-xs text-red-300">{saveError}</p> : null}
      </div>

      {/* The song's content and look, in one line: changed where they live. */}
      <p data-song-line className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 border-y py-2.5 text-xs">
        <FeatureIcon feature="song" className="size-3.5" />
        <span className="text-foreground">{data.title}</span>· {data.artist}
        {data.ep ? <>· {data.ep}</> : null}
        <span>·</span>
        <FeatureIcon feature="clips" className="size-3.5" />
        <button type="button" data-clips-line data-clips-change onClick={() => goToTab("clips")} className="hover:text-foreground underline-offset-2 hover:underline" title="The song's clips and collections: Prepare → Storyboard">
          {[data.songClips ? `${data.songClips} clips` : null, ...(collections ?? data.chosen)].filter(Boolean).join(" + ") || "no clips yet"}
        </button>
        <span>·</span>
        <FeatureIcon feature="theme" className="size-3.5" />
        <button type="button" data-look-line onClick={() => (goToTab("shape"), setPanel("look"))} className="hover:text-foreground underline-offset-2 hover:underline">
          Look: {data.theme ?? "none"}
        </button>
        <span className="ml-auto">Every video is made as Shape plans it (its shot plan).</span>
      </p>

      <details data-advanced className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs">
          <ChevronDown className="size-3" /> Advanced
        </summary>
        <div className="mt-2 flex flex-col gap-2 pl-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="allowFill" checked={allowFill} onChange={(e) => setAllowFill(e.target.checked)} className="accent-brand" /> Allow clips of the other orientation (filled to the frame)
          </label>
          <p className="text-muted-foreground text-xs">
            Timing the lyrics again is in{" "}
            <button type="button" className="text-foreground underline underline-offset-2" onClick={() => goToTab("lyrics")} data-open-retime>
              Prepare → Lyrics &amp; timing
            </button>
            .
          </p>
        </div>
      </details>

      <Notice notice={notice} />
      <div data-make-footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        {reason ? (
          <span className="text-sm text-amber-200" data-make-blocked>
            {reason}
          </span>
        ) : null}
        <span className="flex-1" />
        <Button variant="outline" disabled={busy || !!reason} data-one-of-each onClick={() => void make(on.map((c) => c.name), 1)} title="One video for every platform that is on">
          One of each ({on.length})
        </Button>
        <Button disabled={busy || !!reason} data-make-videos onClick={() => void make(on.map((c) => c.name))}>
          <Sparkles /> {busy ? "Queuing…" : `Make ${total} video${total === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Compare looks

type PickTheme = GeneratePanelData["themes"][number];

function CompareLooks({ projectId, data, choices, why, ownMade }: { projectId: string; data: GeneratePanelData; choices: Choice[]; why: string | null; ownMade: string[] }) {
  const { busy, notice, queue } = useQueue(projectId);
  const [platforms, setPlatforms] = useState<string[]>(choices.some((c) => c.name === "reels") ? ["reels"] : choices.slice(0, 1).map((c) => c.name));
  const [mode, setMode] = useState<"themes" | "pictures">("themes");
  const [themes, setThemes] = useState<string[]>([]);
  const [pictureSets, setPictureSets] = useState<{ songClips: boolean; collections: string[] }[]>([]);
  const others = [...data.themes].filter((t) => t.name !== data.theme).sort((a, b) => Number(b.songs > 0) - Number(a.songs > 0) || a.name.localeCompare(b.name));
  const themeItems = others.map((t) => ({ ...t, id: t.name, label: t.name, tags: t.moods }));
  const themeOf = (name: string): PickTheme => data.themes.find((t) => t.name === name) ?? { name, songs: 0, cover: null, moods: [], accent: null };
  const collectionItems = [...data.collections].sort((a, b) => Number(data.chosen.includes(b)) - Number(data.chosen.includes(a)) || a.localeCompare(b)).map((c) => ({ id: c, label: c, note: data.chosen.includes(c) ? "this song's" : undefined }));
  const sets = pictureSets.map((x) => [...(x.songClips ? ["song"] : []), ...x.collections].join("+")).filter(Boolean);
  const looks = mode === "themes" ? themes.length : sets.length;
  const missing = platforms.filter((p) => !ownMade.includes(p));
  const total = platforms.length * looks + missing.length;
  const label = (n: string) => choices.find((c) => c.name === n)?.label ?? n;
  const reason =
    why ??
    (!platforms.length ? "Choose at least one platform." : mode === "themes" ? (!themes.length ? "Choose 1-3 other themes." : null) : sets.length < 2 ? "Make 2-4 picture sets." : null);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        The same video in other looks, to choose the best: one video per platform per look, each with its own shot plan, labelled &quot;try&quot; in Review. Nothing changes for the song; to use a
        theme you like, change it in Shape → Look.
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Platforms</h3>
        <div className="flex flex-wrap gap-2" data-compare-chips>
          {choices
            .filter((c) => c.name !== "canvas")
            .map((c) => {
              const onC = platforms.includes(c.name);
              return (
                <button
                  key={c.name}
                  type="button"
                  data-compare-chip={c.name}
                  aria-pressed={onC}
                  onClick={() => setPlatforms((l) => (onC ? l.filter((x) => x !== c.name) : [...l, c.name]))}
                  className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", onC ? "border-brand/50 bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground border-dashed")}
                >
                  <PlatformMark platform={c.name} /> {c.label}
                </button>
              );
            })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Compare" className="flex w-fit gap-1 rounded-md border p-0.5 text-sm" data-compare-modes>
          {(["themes", "pictures"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} data-compare-mode={m} onClick={() => setMode(m)} className={cn("rounded px-3 py-1", mode === m ? "bg-brand/15 text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
              {m === "themes" ? "Other themes" : "Other pictures"}
            </button>
          ))}
        </div>
        {mode === "themes" ? (
          <div className="flex flex-wrap items-center gap-2" data-compare-themes>
            <span className="text-muted-foreground text-xs">1-3 themes besides yours ({data.theme ?? "none"}):</span>
            {themes.map((t) => (
              <PickedChip key={t} name="compare-theme" id={t} onRemove={() => setThemes((l) => l.filter((x) => x !== t))}>
                <ThemeChip theme={themeOf(t)} own={false} bare />
              </PickedChip>
            ))}
            {themes.length < 3 ? (
              <SearchPicker
                name="compare-themes"
                items={themeItems}
                selected={themes}
                max={3}
                filters={THEME_MOODS}
                tiles
                render={(t) => (
                  <>
                    <ThemeCover theme={t} className="aspect-[4/5] w-full rounded" />
                    <span className="truncate text-xs font-medium">{t.name}</span>
                    <span className="text-muted-foreground -mt-1 truncate text-[10px]">{t.songs ? `${t.songs} song${t.songs === 1 ? "" : "s"}` : "not used yet"}</span>
                  </>
                )}
                onPick={(t) => setThemes((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]))}
                trigger={<>+ Add a theme</>}
                placeholder="Search themes…"
              />
            ) : null}
          </div>
        ) : (
          <fieldset data-picture-versions className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs">2–4 sets of clips: the same words and timing over other pictures, one video per set. A clip you pinned to a line that is not in a set is shown as &quot;needs a clip&quot;.</span>
            {pictureSets.map((set, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-sm" data-picture-set={k + 1}>
                <span className="text-muted-foreground w-6 text-xs">{k + 1}</span>
                {data.songClips ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" className="accent-brand" checked={set.songClips} onChange={(e) => setPictureSets((all) => all.map((x, i) => (i === k ? { ...x, songClips: e.target.checked } : x)))} /> the song&apos;s own clips
                  </label>
                ) : null}
                {set.collections.map((c) => (
                  <PickedChip key={c} name="picture-collection" id={c} onRemove={() => setPictureSets((all) => all.map((x, i) => (i === k ? { ...x, collections: x.collections.filter((n) => n !== c) } : x)))}>
                    <FeatureIcon feature="collection" className="size-3.5" />
                    {c}
                  </PickedChip>
                ))}
                {data.collections.length ? (
                  <SearchPicker
                    name={`picture-${k + 1}`}
                    items={collectionItems}
                    selected={set.collections}
                    onPick={(c) => setPictureSets((all) => all.map((x, i) => (i === k ? { ...x, collections: x.collections.includes(c) ? x.collections.filter((n) => n !== c) : [...x.collections, c] } : x)))}
                    trigger={<>+ Collection</>}
                    placeholder="Search collections…"
                  />
                ) : null}
                <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" onClick={() => setPictureSets((all) => all.filter((_, i) => i !== k))}>
                  remove
                </button>
              </div>
            ))}
            {pictureSets.length < 4 ? (
              <button
                type="button"
                data-add-picture
                className="text-brand w-fit text-xs underline underline-offset-2"
                onClick={() => setPictureSets((all) => [...all, all.length ? { songClips: false, collections: data.collections.filter((c) => !all.some((x) => x.collections.includes(c))).slice(0, 1) } : { songClips: data.songClips > 0, collections: [] }])}
              >
                + Add a picture set
              </button>
            ) : null}
          </fieldset>
        )}
      </div>

      {platforms.length ? (
        <p className="text-muted-foreground text-xs" data-compare-baseline>
          Compared with your look ({data.theme ?? "the song's"}): its v1 of each platform
          {missing.length ? <>, made too for {missing.map(label).join(", ")} (none yet)</> : " (already made)"}.
        </p>
      ) : null}

      <Notice notice={notice} />
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        {reason ? (
          <span className="text-sm text-amber-200" data-compare-blocked>
            {reason}
          </span>
        ) : null}
        <span className="flex-1" />
        <Button disabled={busy || !!reason} data-make-comparison onClick={() => void queue({ platforms, compare: true, ...(mode === "themes" ? { themes } : { pictures: sets }), title: data.title, artist: data.artist })}>
          <Sparkles /> {busy ? "Queuing…" : `Make comparison (${total} video${total === 1 ? "" : "s"})`}
        </Button>
      </div>
    </div>
  );
}

// A theme's cover (its picture, or a backdrop in its accent colour when it has none).
function ThemeCover({ theme, className }: { theme: PickTheme; className?: string }) {
  return theme.cover ? (
    // eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files
    <img alt="" src={`/api/files/${theme.cover}`} className={cn("object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("block", className)} style={{ background: `linear-gradient(135deg, ${theme.accent ?? "#e8a3b5"}55, #141417)` }} />
  );
}

// A theme as a chip: a small cover, its name.
function ThemeChip({ theme, own, bare }: { theme: PickTheme; own: boolean; bare?: boolean }) {
  return (
    <span data-theme-chip={theme.name} className={cn("flex items-center gap-1.5 text-xs", !bare && "bg-card rounded-full border py-0.5 pr-2.5 pl-1")}>
      <ThemeCover theme={theme} className="size-5 rounded-full" />
      <span className="font-medium">{theme.name}</span>
      {own ? <span className="text-muted-foreground">(this song&apos;s)</span> : null}
    </span>
  );
}
