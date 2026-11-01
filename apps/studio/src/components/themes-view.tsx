"use client";

// The Themes page, Canva style: a gallery of tall tiles (each theme on real lyric lines in its fonts, effect
// and accent; pointing at a tile plays it), filter chips at the top and the "New theme" tile first in the grid. Clicking a tile opens
// its detail view: the theme playing large, its name and designer credit, the songs that use it, "Use for a
// song", "Edit" (opens the theme editor on a song: Shape → Theme), Duplicate, Delete (to themes\_removed\,
// with Restore) and "More like this".
import { ChevronDown, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { backingShadow, BOX_STYLE, fallbackBackground, gradeLook, isTextLayout, pictureOf, THEME_MOODS, TILE_LOOP_FRAMES, tileLyrics, vignetteBackground, type LookPreviewProps } from "@lyric/video";
import type { ThemeCard, ThemesPageData } from "@lyric/video/style";

import { PreviewPlayer } from "@/components/preview-player";
import { themePreview } from "@/components/shape-tools";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

type Filter = "all" | "used" | "unused";
const input = "bg-input/30 border-input h-8 rounded-md border px-2 text-sm";
const effectName = (v: unknown) => String(v ?? "").split(":")[0];

export function ThemesView() {
  const [data, setData] = useState<ThemesPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [mood, setMood] = useState<string | null>(null); // a mood filter (the theme's moods, ticked on its page)
  const [open, setOpen] = useState<string | null>(null); // the theme in the detail view
  const [creating, setCreating] = useState<{ name: string; from: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => {
    let alive = true;
    api("/api/themes", { cache: "no-store" })
      .then((r) => r.json() as Promise<ThemesPageData & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  async function act(body: Record<string, unknown>): Promise<boolean> {
    return send("/api/themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  // Any Themes request that answers with the page's data (the Theme cover's upload and Remove too).
  async function send(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    try {
      const r = await api(url, init);
      const d = (await r.json()) as ThemesPageData & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  // @font-face rules for every font (each loads only when a tile draws it).
  const fontCss = useMemo(
    () =>
      (data?.fonts ?? [])
        .flatMap((f) => f.faces.flatMap((face) => face.srcs.map((src) => `@font-face{font-family:"${f.family} preview";src:url("/api/fonts/${src}");font-weight:${face.weight};font-style:${face.style};}`)))
        .join("\n"),
    [data?.fonts],
  );

  if (error && !data) return <p className="p-6 text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-muted-foreground p-6 text-sm">Loading the themes…</p>;
  const shown = data.themes.filter((t) => (filter === "used" ? t.songs.length > 0 : filter === "unused" ? t.songs.length === 0 : true) && (!mood || t.moods.includes(mood)));
  const detail = open ? data.themes.find((t) => t.name === open) ?? null : null;
  const counts = { all: data.themes.length, used: data.themes.filter((t) => t.songs.length).length, unused: data.themes.filter((t) => !t.songs.length).length };

  return (
    <div data-themes-page className="flex flex-col gap-4 p-6">
      <style>{fontCss}</style>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display flex items-center gap-2 text-2xl"><FeatureIcon feature="theme" className="size-6" /> Themes</h1>
        <p className="text-muted-foreground text-sm">A theme is a song&apos;s whole look: fonts, motion and colours. Click a theme, then <b>Edit theme</b> to change it; the <b>New theme</b> tile starts one from a copy.</p>
      </div>
      <div className="flex flex-wrap gap-2" data-theme-filters>
        {(
          [
            ["all", "All"],
            ["used", "In use"],
            ["unused", "Not used yet"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" data-theme-filter={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn("rounded-full border px-3 py-1 text-xs", filter === id ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {label} · {counts[id]}
          </button>
        ))}
        <span aria-hidden className="bg-border mx-1 w-px self-stretch" />
        {THEME_MOODS.map((m) => (
          <button key={m} type="button" data-theme-mood-filter={m} aria-pressed={mood === m} onClick={() => setMood((x) => (x === m ? null : m))} className={cn("rounded-full border px-3 py-1 text-xs", mood === m ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {m} · {data.themes.filter((t) => t.moods.includes(m)).length}
          </button>
        ))}
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      {creating ? (
        <div data-themes-create className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span className="font-medium">New theme</span>
          <input autoFocus data-themes-new-name aria-label="Theme name" placeholder="Name it first (e.g. Night Drive)" className={cn(input, "w-64")} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">
            Start from
            <select data-themes-new-from className={input} value={creating.from} onChange={(e) => setCreating({ ...creating, from: e.target.value })}>
              {data.themes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-themes-new-create
            disabled={!creating.name.trim()}
            onClick={() => void act({ action: "create", name: creating.name, from: creating.from }).then((ok) => ok && (setOpen(creating.name.trim()), setCreating(null)))}
            className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          >
            Create
          </button>
          <button type="button" onClick={() => setCreating(null)} className="text-muted-foreground text-xs underline underline-offset-2">
            Cancel
          </button>
        </div>
      ) : null}

      <div data-themes-grid className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {/* "New theme" as the first tile, like Canva's "Create blank" (1 Nov 2026). */}
        <button
          type="button"
          data-themes-new-tile
          onClick={() => {
            setCreating({ name: "", from: data.themes[0]?.name ?? "" });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="group flex min-w-0 flex-col gap-1.5 text-left"
        >
          <div className="border-foreground/25 group-hover:border-brand group-hover:bg-brand/5 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors" style={{ aspectRatio: "9 / 16" }}>
            <span className="bg-brand text-brand-foreground flex size-12 items-center justify-center rounded-full">
              <Plus className="size-6" />
            </span>
            <span className="text-sm font-medium">New theme</span>
          </div>
          <span className="truncate text-sm font-medium">New theme</span>
          <span className="text-muted-foreground -mt-1 text-xs">name it, start from any theme</span>
        </button>
        {shown.map((t) => (
          <ThemeTile key={t.name} theme={t} data={data} onOpen={() => setOpen(t.name)} />
        ))}
      </div>
      {!shown.length ? <p className="text-muted-foreground text-sm">No theme here yet.</p> : null}

      {data.removed.length ? (
        <div data-themes-removed className="flex flex-col gap-1 text-xs">
          <button type="button" aria-expanded={showRemoved} onClick={() => setShowRemoved((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start underline underline-offset-2">
            <ChevronDown className={cn("size-3 transition-transform", showRemoved && "rotate-180")} />
            Deleted themes ({data.removed.length})
          </button>
          {showRemoved
            ? data.removed.map((r) => (
                <div key={r.folder} className="flex items-center gap-3 pl-4">
                  <span>{r.name}</span>
                  <button type="button" data-themes-restore={r.name} onClick={() => void act({ action: "restore", folder: r.folder })} className="text-brand underline underline-offset-2">
                    Restore
                  </button>
                </div>
              ))
            : null}
        </div>
      ) : null}

      {detail ? <ThemeDetail theme={detail} data={data} act={act} send={send} onOpen={setOpen} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

// The theme playing over its cover: a video cover loops under the words (the words drawn on top, transparent);
// a picture cover (or none) is drawn by the preview itself.
function CoverPlayer({ theme, input, gradeFilter, durationInFrames }: { theme: ThemeCard; input: LookPreviewProps; gradeFilter?: string; durationInFrames?: number }) {
  if (!theme.backgroundVideo) return <PreviewPlayer input={input} durationInFrames={durationInFrames} />;
  return (
    <div className="absolute inset-0">
      <video data-cover-video src={`/api/files/${theme.backgroundVideo}`} poster={theme.background ? `/api/files/${theme.background}` : undefined} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" style={{ filter: gradeFilter }} />
      <div className="absolute inset-0">
        <PreviewPlayer input={{ ...input, background: null, transparent: true }} durationInFrames={durationInFrames} />
      </div>
    </div>
  );
}

// One tall tile: the theme on two lyric lines over a dark frame in its accent; pointing at it plays it.
function ThemeTile({ theme, data, onOpen }: { theme: ThemeCard; data: ThemesPageData; onOpen: () => void }) {
  const [playing, setPlaying] = useState(false);
  const v = theme.look as Record<string, unknown>;
  const accent = String(v.accentColour ?? "#E8A3B5");
  const pic = pictureOf({ ...(v as Record<string, string>), accentColour: accent });
  const grade = gradeLook(pic.grade);
  const textLook: React.CSSProperties = { color: String(v.textColour ?? "#FFFFFF"), textShadow: backingShadow(pic.backing, accent).replace(/(\d+)px/g, (_m, n) => `${Math.max(1, Math.round(Number(n) / 3))}px`), ...(pic.backing === "box" ? { ...BOX_STYLE } : {}) };
  const layout = isTextLayout(v.textLayout) ? v.textLayout : "centre";
  const fam = (role: "verse" | "hook") => ({ fontFamily: `"${String(v[`${role}Font`])} preview", serif`, fontWeight: Number(v[`${role}Weight`] ?? 400), fontStyle: v[`${role}Italic`] === true ? "italic" : "normal" });
  return (
    <button type="button" data-themes-tile={theme.name} onClick={onOpen} onMouseEnter={() => setPlaying(true)} onMouseLeave={() => setPlaying(false)} onFocus={() => setPlaying(true)} onBlur={() => setPlaying(false)} className="group flex min-w-0 flex-col gap-1.5 text-left">
      <div className="relative w-full overflow-hidden rounded-lg border bg-black group-hover:border-foreground/40" style={{ aspectRatio: "9 / 16" }}>
        {playing ? (
          // A tight ~3 s loop of one line, moving at once (the chorus line in Big hook).
          <CoverPlayer theme={theme} gradeFilter={grade.filter} input={{ ...themePreview(v, data.fonts, data.sampleLines, theme.background ?? null), lyrics: tileLyrics(layout === "bighook" ? data.sampleLines[1] || "Your chorus here" : data.sampleLines[0] || "Your lyric line here", layout === "bighook") }} durationInFrames={TILE_LOOP_FRAMES} />
        ) : (
          <div data-tile-layout={layout} className={cn("absolute inset-0 flex flex-col items-center gap-2 px-3 text-center", layout === "lower" ? "justify-end pb-[28%]" : "justify-center pb-[12%]")} style={{ background: theme.background ? "#000" : fallbackBackground(pic) }}>
            {theme.background ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a workspace frame served by /api/files */}
                <img data-tile-frame alt="" src={`/api/files/${theme.background}`} className="absolute inset-0 size-full object-cover" style={{ filter: grade.filter }} />
                {grade.veil ? <span aria-hidden className="absolute inset-0" style={{ backgroundColor: grade.veil.colour, mixBlendMode: grade.veil.blend }} /> : null}
              </>
            ) : null}
            {vignetteBackground(pic.vignette) ? <span aria-hidden className="absolute inset-0" style={{ background: vignetteBackground(pic.vignette)! }} /> : null}
            {pic.backing === "band" ? <span aria-hidden className="absolute inset-x-0 top-1/3 h-1/3" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 35%, rgba(0,0,0,0.42) 65%, rgba(0,0,0,0) 100%)" }} /> : null}
            <span className="relative line-clamp-2 text-xl leading-tight" style={{ ...fam("verse"), ...textLook }}>
              {data.sampleLines[0] || "Your lyric line here"}
            </span>
            <span className={cn("relative line-clamp-2 leading-tight", layout === "bighook" ? "text-[1.7rem]" : "text-xl")} style={{ ...fam("hook"), ...textLook, color: accent }}>
              {data.sampleLines[1] || "Your chorus here"}
            </span>
          </div>
        )}
        {/* always on top: the pointer stays on the same element while the player takes the tile's place, so a click opens the detail view */}
        <span className="absolute inset-0" aria-hidden />
      </div>
      <span className="truncate text-sm font-medium">{theme.name}</span>
      <span className="text-muted-foreground -mt-1 truncate text-[11px]">
        {theme.author ? `by ${theme.author} · ` : ""}
        {theme.songs.length ? `${theme.songs.length} song${theme.songs.length === 1 ? "" : "s"}` : "not used yet"}
        {theme.brandDefault !== null ? " · new songs start on it" : ""}
      </span>
    </button>
  );
}

// The detail view (like Canva's template page): the theme playing large, name, designer credit, the songs,
// the main actions and "More like this".
function ThemeDetail({ theme, data, act, send, onOpen, onClose }: { theme: ThemeCard; data: ThemesPageData; act: (body: Record<string, unknown>) => Promise<boolean>; send: (url: string, init: RequestInit) => Promise<boolean>; onOpen: (name: string) => void; onClose: () => void }) {
  const [naming, setNaming] = useState<string | null>(null);
  const [song, setSong] = useState<string>(theme.songs[0]?.id ?? data.songs[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const v = theme.look as Record<string, unknown>;
  const like = data.themes
    .filter((t) => t.name !== theme.name)
    .map((t) => {
      const o = t.look as Record<string, unknown>;
      const score = (effectName(o.verseEffect) === effectName(v.verseEffect) ? 2 : 0) + (o.verseFont === v.verseFont ? 1 : 0) + (o.hookFont === v.hookFont ? 1 : 0) + (effectName(o.hookEffect) === effectName(v.hookEffect) ? 1 : 0);
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.t);
  const deletable = !theme.songs.length && theme.brandDefault === null;
  const editSong = theme.songs[0]?.id ?? song;
  return (
    <div data-theme-detail={theme.name} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-6" onClick={onClose}>
      <div className="bg-background flex w-full max-w-4xl flex-col gap-5 rounded-xl border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-5">
          <div className="relative w-[300px] shrink-0 overflow-hidden rounded-lg border bg-black" style={{ aspectRatio: "9 / 16" }}>
            <CoverPlayer key={theme.name} theme={theme} gradeFilter={gradeLook(pictureOf({ ...(v as Record<string, string>) }).grade).filter} input={themePreview(v, data.fonts, data.sampleLines, theme.background ?? null)} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-start gap-2">
              {naming !== null ? (
                <input
                  autoFocus
                  data-theme-detail-name
                  aria-label="Theme name"
                  className={cn(input, "flex-1 text-lg")}
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setNaming(null);
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={() => {
                    const name = naming.trim();
                    setNaming(null);
                    if (name && name !== theme.name) void act({ action: "rename", from: theme.name, name }).then((ok) => ok && onOpen(name));
                  }}
                />
              ) : (
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* "Theme" written above the name (1 Nov 2026): a theme made from a song carries the song's name, so this says it is the look, not the song. */}
                  <span data-theme-detail-kind className="text-brand text-[11px] font-semibold tracking-[0.18em] uppercase">Theme</span>
                  <h2 className="font-display min-w-0 text-2xl">{theme.name}</h2>
                </div>
              )}
              <button type="button" data-theme-detail-rename aria-label="Rename the theme" title="Rename the theme (your songs keep their names)" onClick={() => setNaming(theme.name)} className="text-muted-foreground hover:text-foreground rounded p-1.5">
                <Pencil className="size-4" />
              </button>
              <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded p-1.5">
                <X className="size-5" />
              </button>
            </div>
            <p className="text-muted-foreground text-xs">
              Fits Reels, TikTok, Shorts and YouTube · verses {String(v.verseFont)}, choruses {String(v.hookFont)} · {effectName(v.verseEffect)} / {effectName(v.hookEffect || v.verseEffect)}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">Designer</span>
              <input key={`${theme.name}-author`} data-theme-detail-author className={cn(input, "flex-1")} defaultValue={theme.author} placeholder="you (or the designer's name, for themes you buy or sell)" onBlur={(e) => e.target.value.trim() !== theme.author && void act({ action: "details", name: theme.name, author: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">About</span>
              <input key={`${theme.name}-description`} data-theme-detail-description className={cn(input, "flex-1")} defaultValue={theme.description} placeholder="a line about the mood" onBlur={(e) => e.target.value.trim() !== theme.description && void act({ action: "details", name: theme.name, description: e.target.value })} />
            </label>
            <div data-theme-detail-moods className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">Mood</span>
              {THEME_MOODS.map((m) => {
                const on = theme.moods.includes(m);
                return (
                  <button key={m} type="button" data-theme-mood={m} aria-pressed={on} onClick={() => void act({ action: "details", name: theme.name, moods: on ? theme.moods.filter((x) => x !== m) : [...theme.moods, m] })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {m}
                  </button>
                );
              })}
            </div>
            {/* Theme cover (1 Nov 2026): the theme's own picture, kept in its folder; without one its previews show a neutral backdrop in its colours (never a song's picture). */}
            <div data-theme-cover-row className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">Theme cover</span>
              {theme.background ? (
                // eslint-disable-next-line @next/next/no-img-element -- the theme folder's picture, served by /api/files
                <span className="relative shrink-0">
                  <img data-theme-cover alt="Theme cover" src={`/api/files/${theme.background}`} className="h-12 w-[27px] rounded border object-cover" />
                  {theme.backgroundVideo ? <span data-theme-cover-video className="bg-brand text-brand-foreground absolute -right-1 -bottom-1 rounded px-0.5 text-[8px] leading-tight">▶</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">none: a neutral backdrop in the theme&apos;s colours (a picture, or a video: its first frame shows, it plays on hover)</span>
              )}
              <label className="bg-muted hover:bg-accent cursor-pointer rounded-md px-2.5 py-1 text-xs">
                {theme.background ? "Change…" : "Set theme cover…"}
                <input
                  type="file"
                  data-theme-cover-file
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const form = new FormData();
                    form.set("name", theme.name);
                    form.set("file", file);
                    void send("/api/themes/cover", { method: "POST", body: form });
                  }}
                />
              </label>
              {theme.background ? (
                <button type="button" data-theme-cover-remove onClick={() => void send(`/api/themes/cover?name=${encodeURIComponent(theme.name)}`, { method: "DELETE" })} className="text-muted-foreground text-xs underline underline-offset-2">
                  Remove
                </button>
              ) : null}
            </div>
            <p data-theme-detail-songs className="text-sm">
              {theme.songs.length ? (
                <>
                  Used by {theme.songs.length === 1 ? "the song" : `${theme.songs.length} songs:`}{" "}
                  {theme.songs.map((s, i) => (
                    <span key={s.id}>
                      {i ? ", " : ""}
                      <Link href={`/songs/${s.id}?tab=shape&panel=theme`} className="text-brand underline underline-offset-2">
                        {s.title}
                      </Link>
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-muted-foreground">Not used by a song yet.</span>
              )}
              {theme.brandDefault !== null ? <span className="text-muted-foreground"> · new songs start on it</span> : null}
            </p>
            {data.songs.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <select data-theme-detail-song aria-label="Song" className={cn(input, "min-w-0 max-w-64")} value={song} onChange={(e) => setSong(e.target.value)}>
                  {data.songs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.theme === theme.name ? " (uses it)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-theme-detail-use
                  disabled={data.songs.find((s) => s.id === song)?.theme === theme.name}
                  onClick={() => void act({ action: "use", projectId: song, name: theme.name }).then((ok) => ok && setNotice(`${data.songs.find((s) => s.id === song)?.title} now uses ${theme.name}.`))}
                  className="bg-brand text-brand-foreground rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Use this theme for the song
                </button>
              </div>
            ) : null}
            {notice ? (
              <p data-theme-detail-notice role="status" className="text-xs text-emerald-300">
                {notice}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {editSong ? (
                <Link
                  data-theme-detail-edit
                  href={`/songs/${editSong}?tab=shape&panel=theme&edit=${encodeURIComponent(theme.name)}`}
                  title={`Opens the theme editor next to ${data.songs.find((s) => s.id === editSong)?.title ?? "a song"}'s video: fonts, motion, colours, cards`}
                  className="bg-brand text-brand-foreground rounded-md px-4 py-1.5 text-sm font-medium"
                >
                  Edit theme
                </Link>
              ) : null}
              <button type="button" data-theme-detail-duplicate onClick={() => void act({ action: "duplicate", name: theme.name })} className="bg-muted rounded-md px-3 py-1.5 text-sm">
                Duplicate
              </button>
              <button
                type="button"
                data-theme-detail-delete
                disabled={!deletable}
                title={deletable ? "Moves it to themes\\_removed\\ (Restore at the bottom of the page)" : theme.songs.length ? "Songs use it: give them another theme first" : "New songs start on it"}
                onClick={() => void act({ action: "remove", name: theme.name }).then((ok) => ok && onClose())}
                className="text-muted-foreground rounded-md px-3 py-1.5 text-sm underline underline-offset-2 disabled:no-underline disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        {like.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">More like this</h3>
            <div className="grid grid-cols-4 gap-3" data-theme-detail-like>
              {like.map((t) => (
                <ThemeTile key={t.name} theme={t} data={data} onOpen={() => onOpen(t.name)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
