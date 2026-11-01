"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { THEME_MOODS } from "@lyric/video";
import type { GeneratePanelData } from "@lyric/video/library";
import type { GeneratePreset } from "@lyric/video/run-settings";

import { PickedChip, SearchPicker } from "@/components/search-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";


const label = "flex flex-col gap-1.5 text-sm";
const select = "bg-input/30 border-input h-9 rounded-md border px-2 text-sm";

const shotLengthText = (v: string | null) => (v === null || v === "auto" ? "auto: from the song and your clips" : v === "rate" ? "the cut rate" : v === "story" ? "story: 2-4 bars, at least 3 s" : `${v} bar${v === "1" ? "" : "s"}`);

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
  const choices = data.platforms.filter((p) => p.name !== "standard"); // the "Standard" preset is never offered (pnpm make still uses it without --platforms)
  const known = (list: string[]) => list.filter((p) => choices.some((x) => x.name === p));
  const from = preset ?? null;
  const startPlatforms = from && known(from.platforms).length ? known(from.platforms) : known(r.platforms);
  // The recipe's platforms; none set: Reels + YouTube (the Style tab says so).
  const fallback = ["reels", "youtube"].filter((p) => choices.some((x) => x.name === p));
  const [platforms, setPlatforms] = useState<string[]>(startPlatforms.length ? startPlatforms : fallback.length ? fallback : choices[0] ? [choices[0].name] : []);
  // One video per platform unless the song's recipe or this run asks for more ("Try another take" in
  // Videos makes one more when wanted); the platform presets' larger numbers are for the command line.
  const recipeCounts = Object.keys(r.variations).length > 0;
  const videosFor = (name: string) => (pictureSets.length >= 2 && name !== "canvas" ? pictureSets.length : variations ? Number(variations) : (r.variations[name] ?? r.variations["*"] ?? 1));
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
  // The theme for this run ("" = the song's own) and Compare themes (2-3: one set of videos per theme).
  const [runTheme, setRunTheme] = useState("");
  const [compareThemes, setCompareThemes] = useState<string[]>([]);
  // The pickers (the user's rule, 1 Nov 2026: no tick boxes for lists that grow): the song's theme first,
  // then the themes in use, then the rest; collections with the song's own first.
  const themeOf = (name: string) => data.themes.find((t) => t.name === name) ?? { name, songs: 0, cover: null, moods: [], accent: null };
  const themeItems = [...data.themes]
    .sort((a, b) => Number(b.name === data.theme) - Number(a.name === data.theme) || Number(b.songs > 0) - Number(a.songs > 0) || a.name.localeCompare(b.name))
    .map((t) => ({ ...t, id: t.name, label: t.name, tags: t.moods }));
  const renderTheme = (t: (typeof themeItems)[number]) => (
    <>
      <ThemeCover theme={t} className="aspect-[4/5] w-full rounded" />
      <span className="truncate text-xs font-medium">{t.name}</span>
      <span className="text-muted-foreground -mt-1 truncate text-[10px]">{t.name === data.theme ? "this song's" : t.songs ? `${t.songs} song${t.songs === 1 ? "" : "s"}` : "not used yet"}</span>
    </>
  );
  const collectionItems = [...data.collections].sort((a, b) => Number(data.chosen.includes(b)) - Number(data.chosen.includes(a)) || a.localeCompare(b)).map((c) => ({ id: c, label: c, note: data.chosen.includes(c) ? "this song's" : undefined }));
  // Section and target length: the run's exact times ("0:34–1:06 (from that run)") until switched back to auto.
  const runSection = from?.section && !locked("section") ? from.section : null;
  const [section, setSection] = useState(runSection ?? r.section);
  const [length, setLength] = useState("");
  const [layout, setLayout] = useState(from?.layout && !locked("youtubeLayout") && from.layout !== r.youtubeLayout ? from.layout : "");
  const [shotLength, setShotLength] = useState(""); // "" = from the recipe (per platform where it differs)
  const fromRun = !!runSection && section === runSection;
  const [saveToSong, setSaveToSong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pictureSets, setPictureSets] = useState<{ songClips: boolean; collections: string[] }[]>([]); // picture versions: one video per clip set

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
      variations: variations ? Number(variations) : recipeCounts ? undefined : 1,
      ...(runTheme && runTheme !== data.theme && compareThemes.length < 2 ? { theme: runTheme } : {}),
      title: String(f.get("title") ?? ""),
      artist: String(f.get("artist") ?? ""),
      ep: changed(String(f.get("ep") ?? ""), data.ep),
      section: changed(chosenSection, r.section),
      length: length ? Number(length) : undefined,
      saveToSong,
      allowFill: f.get("allowFill") === "on",
      layout: (layout || undefined) as "cover" | "stills" | "clips" | undefined,
      shotLength: shotLength || undefined,
      realign: f.get("realign") === "on",
      ...(compareThemes.length >= 2 ? { themes: compareThemes } : {}),
      ...(pictureSets.length >= 2 ? { pictures: pictureSets.map((x) => [...(x.songClips ? ["song"] : []), ...x.collections].join("+")).filter(Boolean) } : {}),
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
        ? `\n${result.saved.saved.length ? `Saved to the song: ${result.saved.saved.join(", ")}.` : "Nothing to save: this run uses the song's own settings."}${result.saved.kept.length ? ` Locked, kept as they are: ${result.saved.kept.join(", ")}.` : ""}`
        : "";
      setNotice({ ok: true, text: `Queued: ${result.label}. Follow it in Tasks (top right); the videos appear in the Videos tab when they are made.${saved}` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

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
              This song has no lyrics in the app yet: use “+ New song” in the Library with the same song file and its lyrics (it updates this song).
            </p>
          ) : null}
          {from ? (
            <div data-from-run={from.folder} className="border-brand/30 bg-brand/10 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span>
                Settings of the run {from.folder.replace(/_(\d{2})(\d{2})/, " $1:$2")}: check them, then Generate (locked settings stay as the song has them).
              </span>
              <Link href={`/songs/${projectId}?tab=generate`} className="text-muted-foreground hover:text-foreground text-xs underline">
                Back to the song&apos;s settings
              </Link>
            </div>
          ) : null}
          <Group n={1} title="What to make" hint="Pick the platforms: the app sets each one's size and length.">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Platforms</legend>
            <div className="flex flex-wrap gap-2">
              {choices.map((p) => {
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
                      · {videosFor(p.name)} video{videosFor(p.name) === 1 ? "" : "s"} · {r.lengths[p.name] ? `${r.lengths[p.name]} s` : r.presetLengths[p.name]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          </Group>
          <Group n={2} title="Look and pictures" hint="The theme gives the look; the clips give the pictures.">
          <div className="grid gap-6 md:grid-cols-2">
            <div className={label}>
              <span className="font-medium">Theme</span>
              <div className="flex flex-wrap items-center gap-1.5" data-generate-theme={runTheme || data.theme || ""}>
                {compareThemes.length >= 2 ? (
                  <span className="text-muted-foreground text-xs">Compare themes below picks the themes.</span>
                ) : (
                  <>
                    <ThemeChip theme={themeOf(runTheme || data.theme || "")} own={!runTheme} />
                    <SearchPicker name="run-theme" items={themeItems} selected={[runTheme || data.theme || ""]} max={1} filters={THEME_MOODS} tiles render={renderTheme} onPick={(t) => setRunTheme(t === data.theme ? "" : t)} trigger={<>Change…</>} placeholder="Search themes…" />
                  </>
                )}
              </div>
              <span className="text-muted-foreground text-xs">{runTheme ? "For this run only: the song keeps its own theme." : "The song's look: fonts, motion and colours (change it in the Look → Theme menu)."}</span>
            </div>
            <fieldset className={label} data-collections>
              <legend className="mb-1.5 font-medium">Clips</legend>
              <p className="text-muted-foreground text-xs">
                {data.songClips ? `This song's own clips (${data.songClips})` : "No clips of its own yet (Prepare → Assets)"}
                {data.collections.length ? ", plus:" : ""}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {collections.map((c) => (
                  <PickedChip key={c} name="collection" id={c} onRemove={locked("collections") ? undefined : () => setCollections((list) => list.filter((x) => x !== c))}>
                    <FeatureIcon feature="collection" className="size-3" />
                    {c}
                  </PickedChip>
                ))}
                {data.collections.length ? (
                  <SearchPicker
                    name="collections"
                    items={collectionItems}
                    selected={collections}
                    disabled={locked("collections")}
                    onPick={(c) => setCollections((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))}
                    trigger={<>+ Add a collection</>}
                    placeholder="Search collections…"
                  />
                ) : null}
              </div>
            </fieldset>
          </div>
          </Group>
          <details data-compare className="rounded-lg border px-4 py-3" open={compareThemes.length > 0 || pictureSets.length > 0 || undefined}>
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">3 · Compare (optional)</span>
              <span className="text-muted-foreground ml-2 text-xs">the same video in 2–3 themes, or over other clips, to choose the best</span>
            </summary>
            <div className="mt-3 flex flex-col gap-4">
          {data.themes.length >= 2 ? (
            <fieldset data-compare-themes className="flex flex-col gap-1.5 text-sm">
              <legend className="font-medium">Themes</legend>
              <span className="text-muted-foreground text-xs">Pick 2–3: the same part of the song, clips and order, only the look differs. The song keeps its own theme.</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {compareThemes.map((t) => (
                  <PickedChip key={t} name="compare-theme" id={t} onRemove={() => setCompareThemes((list) => list.filter((x) => x !== t))}>
                    <ThemeChip theme={themeOf(t)} own={t === data.theme} bare />
                  </PickedChip>
                ))}
                {compareThemes.length < 3 ? (
                  <SearchPicker
                    name="compare-themes"
                    items={themeItems}
                    selected={compareThemes}
                    max={3}
                    filters={THEME_MOODS}
                    tiles
                    render={renderTheme}
                    disabled={pictureSets.length > 0}
                    onPick={(t) => setCompareThemes((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]))}
                    trigger={<>+ Add a theme to compare</>}
                    placeholder="Search themes…"
                  />
                ) : null}
                {pictureSets.length ? <span className="text-muted-foreground text-xs">(not together with Picture versions)</span> : null}
              </div>
              {compareThemes.length === 1 ? <span className="text-xs text-amber-300">Add one more to compare.</span> : null}
            </fieldset>
          ) : null}
          <fieldset data-picture-versions className="flex flex-col gap-1.5 text-sm">
            <legend className="font-medium">Pictures</legend>
            <span className="text-muted-foreground text-xs">2–4 sets of clips: the same words and timing over other pictures, one video per set. A clip you pinned to a line that is not in a set is shown as &quot;needs a clip&quot;.</span>
            {pictureSets.map((set, k) => (
              <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1" data-picture-set={k + 1}>
                <span className="text-muted-foreground w-6 text-xs">v{k + 1}</span>
                {data.songClips ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="accent-brand" checked={set.songClips} onChange={(e) => setPictureSets((all) => all.map((x, i) => (i === k ? { ...x, songClips: e.target.checked } : x)))} /> the song&apos;s clips
                  </label>
                ) : null}
                {set.collections.map((c) => (
                  <PickedChip key={c} name="picture-collection" id={c} onRemove={() => setPictureSets((all) => all.map((x, i) => (i === k ? { ...x, collections: x.collections.filter((n) => n !== c) } : x)))}>
                    <FeatureIcon feature="collection" className="size-3" />
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
                <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setPictureSets((all) => all.filter((_, i) => i !== k))}>
                  remove
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              {pictureSets.length < 4 ? (
                <button
                  type="button"
                  data-add-picture
                  className="hover:bg-accent w-fit rounded-md border px-2 py-0.5 text-xs"
                  disabled={compareThemes.length > 0}
                  onClick={() => setPictureSets((all) => [...all, all.length ? { songClips: false, collections: data.collections.filter((c) => !all.some((x) => x.collections.includes(c))).slice(0, 1) } : { songClips: data.songClips > 0, collections: [...collections] }])}
                >
                  + Add a picture version
                </button>
              ) : null}
              {pictureSets.length === 1 ? <span className="text-xs text-amber-300">Add one more to compare (one set makes one video).</span> : null}
              {compareThemes.length ? <span className="text-muted-foreground text-xs">(not together with Compare themes)</span> : null}
            </div>
          </fieldset>
            </div>
          </details>
          <Group n={4} title="Video details" hint="The words on the title card and the cover.">
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
          </Group>
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
          <details data-advanced className="rounded-lg border px-4 py-3 text-sm" open={!!runSection || undefined}>
            <summary className="cursor-pointer">
              <span className="font-medium">5 · Advanced (optional)</span>
              <span className="text-muted-foreground ml-2 text-xs">the app sets all of these; change one only to override it</span>
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label className={label}>
                <span className="font-medium">Videos per platform</span>
                <Input type="number" min={1} max={24} placeholder="automatic" value={variations} disabled={locked("variations")} onChange={(e) => setVariations(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Target length (s)</span>
                <Input type="number" name="length" min={3} max={600} placeholder="automatic" value={length} disabled={locked("length")} onChange={(e) => setLength(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Section</span>
                <Input name="section" value={section} placeholder="auto, full or 0:11-1:10" disabled={locked("section")} onChange={(e) => setSection(e.target.value)} />
              </label>
              <label className={label}>
                <span className="font-medium">Shot length</span>
                <select name="shotLength" data-shot-length className={select} value={shotLength} disabled={locked("shotLength")} onChange={(e) => setShotLength(e.target.value)}>
                  <option value="">automatic ({shotLengthText(r.shotLength)}{Object.entries(r.shotLengths).some(([p, v]) => platforms.includes(p) && v !== r.shotLength) ? `; ${Object.entries(r.shotLengths).filter(([p, v]) => platforms.includes(p) && v !== r.shotLength).map(([p, v]) => `${data.platforms.find((x) => x.name === p)?.label ?? p}: ${shotLengthText(v)}`).join(", ")}` : ""})</option>
                  {["auto", "1", "2", "4", "8", "story", "rate"].map((v) => (
                    <option key={v} value={v}>
                      {shotLengthText(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                <span className="font-medium">YouTube layout</span>
                <select name="layout" className={select} value={layout} disabled={locked("youtubeLayout")} onChange={(e) => setLayout(e.target.value)}>
                  <option value="">automatic ({r.youtubeLayout})</option>
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
          <div data-generate-footer className="bg-card/95 sticky bottom-0 z-20 -mx-5 -mb-5 flex flex-wrap items-center gap-3 rounded-b-xl border-t px-5 py-3 backdrop-blur">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-save-to-song checked={saveToSong} onChange={(e) => setSaveToSong(e.target.checked)} className="accent-brand" />
              Keep these choices for this song
            </label>
            <span className="text-muted-foreground ml-auto text-xs">
              {platforms.length ? `${choices.filter((p) => platforms.includes(p.name)).reduce((a, p) => a + videosFor(p.name), 0)} video(s)` : "choose a platform"}
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

type PickTheme = GeneratePanelData["themes"][number];

// A numbered group of the Generate form (1 Nov 2026: the form in five clear groups, asked by the user).
function Group({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section data-generate-group={n} className="flex flex-col gap-3">
      <h3 className="text-sm">
        <span className="font-medium">
          {n} · {title}
        </span>
        <span className="text-muted-foreground ml-2 text-xs">{hint}</span>
      </h3>
      {children}
    </section>
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

// The chosen theme as a chip: a small cover, its name, "this song's".
function ThemeChip({ theme, own, bare }: { theme: PickTheme; own: boolean; bare?: boolean }) {
  return (
    <span data-theme-chip={theme.name} className={cn("flex items-center gap-1.5 text-xs", !bare && "bg-card rounded-full border py-0.5 pr-2.5 pl-1")}>
      <ThemeCover theme={theme} className="size-5 rounded-full" />
      <span className="font-medium">{theme.name}</span>
      {own ? <span className="text-muted-foreground">(this song&apos;s)</span> : null}
    </span>
  );
}
