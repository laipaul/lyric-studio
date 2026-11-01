"use client";

import { Check, ChevronDown, Lock, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BACKING_LABELS, effectTitle, isTextLayout, parseColourRef, TEXT_LAYOUT_HINTS, TEXT_LAYOUT_LABELS, TEXT_LAYOUTS, type TextLayout, FALLBACK_LABELS, GRADE_LABELS, patchChoice, pictureOf, TITLE_STYLE_LABELS, TITLE_WARP_LABELS, titleStyleCss, VIGNETTE_LABELS, warpLetter, type TitleStyle, type TitleWarp, previewBacking, previewFace, previewLyrics, type LookPatch, type LookPreviewProps, type PatchFace, type Readability } from "@lyric/video";
import type { PairingCard, PairingsView } from "@lyric/video/pairings";
import type { StyleData, StyleField, StyleFont, StyleTheme } from "@lyric/video/style";

import { PairingsRow, type DraftFonts } from "@/components/pairings-row";
import { RowMenu, type RowMenuItem } from "@/components/row-menu";
import { SetEffect, type EffectPart, type EffectValues } from "@/components/set-effect";
import { useShapePanel } from "@/components/song-stages";

import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const INTENSITIES = ["subtle", "balanced", "expressive"] as const;
const select = "bg-input/30 border-input h-8 rounded-md border px-2 text-sm";
const input = "bg-input/30 border-input h-8 rounded-md border px-2 text-sm";

// "song:reels" -> "This song (Reels)"
function sourceLabel(source: string, platforms: StyleData["platforms"]): string {
  const [level, platform] = source.split(":");
  const name = platform ? ` (${platforms.find((p) => p.name === platform)?.label ?? platform})` : "";
  if (level === "song") return `This song${name}`;
  if (level === "theme") return `The theme${name}`;
  if (level === "artist") return `Artist's brand${name}`;
  if (level === "platforms.json") return "Platform preset";
  if (level === "run") return "This run";
  return "Library default";
}

const show = (v: unknown) => (v === null ? "preset" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : v && typeof v === "object" ? Object.entries(v).map(([k, n]) => `${k === "*" ? "every platform" : k} ${n}`).join(", ") || "each platform's preset" : String(v ?? ""));

// What the Shape page's viewer needs from the tools: the look to patch into the planned video until it is
// planned again (or while a pairing is pointed at), and the stand-in preview when there is no plan.
// demo: an effect just pointed at or picked in Motion: the viewer shows its name moving in it over the
// video's frame, until the user plays (then the song plays with the effect on the real lyrics).
export type ShapeLook = { patch: LookPatch | null; fallback: LookPreviewProps; caption: string; previewing: string | null; demo?: { key: string; input: LookPreviewProps } | null }; // previewing: the pairing pointed at
const LOOK_FIELDS_PATCHED = new Set(["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic", "verseEffect", "hookEffect", "breathe", "heldGlow", "chorusLift", "shine", "emphasis", "accentColour", "textColour", "grade", "vignette", "textBacking", "fallback", "fallbackColour", "gradeCanvas", "titleStyle", "titleWarp", "hookCard", "hookCardStyle", "endCard", "endCardStyle", "textLayout"]);

// The Shape page's tool panels (the song's recipe, song.json), one at a time as chosen in the rail: Fonts
// (font pairing, the fonts line with Fine-tune), Effects (Set effect with its Verses / Choruses switch),
// Colour (accent), This song and What to make (each with its one-line summary), Automatic. Every change is saved
// at once; the rarely used actions (per platform, back to the inherited value, lock, use for all my songs)
// sit in each setting's ⋯ menu. onSaved: the recipe changed (the page plans the video again); planned:
// counts the plans that arrived (the look patch is dropped once the plan has it).
export function ShapeTools({ projectId, onLook, onSaved, planned }: { projectId: string; onLook: (look: ShapeLook) => void; onSaved: () => void; planned: number }) {
  // The panel open in the rail (Fonts, Effects, Colour, This song, What to make, Automatic): only that
  // block shows; the tools stay mounted (hidden) for the other panels, so the viewer keeps its look.
  const { panel, setPanel } = useShapePanel();
  const section = panel && (TOOL_SECTIONS as readonly string[]).includes(panel) ? panel : null;
  const router = useRouter();
  const [saved, setData] = useState<StyleData | null>(null); // the song's settings as saved
  // The theme editor's draft: nothing is saved until "Save" / "Save as new theme"; null = not editing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const data = useMemo(() => (saved && draft ? withDraft(saved, draft) : saved), [saved, draft]); // what the tools and the viewer show
  const editingTheme = draft && saved ? (saved.themes.find((t) => t.name === draft.name) ?? null) : null;
  // Unsaved changes are kept in this browser (per song) until Save or Cancel: leaving the editor without
  // saving loses nothing; the next "Edit theme" brings them back with a note.
  const draftKey = `lyric-studio:theme-draft:${projectId}`;
  const [restored, setRestored] = useState(false);
  const openEditor = (t: StyleTheme) => {
    let kept: Draft | null = null;
    try {
      const raw = window.localStorage.getItem(draftKey);
      kept = raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      kept = null;
    }
    if (kept && kept.name === t.name && kept.changed) {
      setDraft(kept);
      setRestored(true);
    } else {
      setDraft(draftOf(t));
      setRestored(false);
    }
  };
  const closeEditor = () => {
    setDraft(null);
    setRestored(false);
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // private mode: nothing kept
    }
  };
  useEffect(() => {
    if (!draft?.changed) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // private mode: nothing kept
    }
  }, [draft, draftKey]);
  // ?edit=<theme> (the Themes page's "Edit"): the editor opens on that theme, shown on this song.
  const editParam = useSearchParams().get("edit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [fineTune, setFineTune] = useState(false); // Look: the six font rows under the font summary
  const [part, setPart] = useState<EffectPart>("verse"); // Set effect: verses or choruses
  const [effectPlatforms, setEffectPlatforms] = useState(false); // Set effect ⋯ → Per platform
  const [dirty, setDirty] = useState(false); // a look change the planned video does not have yet
  const [hovered, setHovered] = useState<PairingCard | null>(null);
  const [hoverTheme, setHoverTheme] = useState<StyleTheme | null>(null);
  const [hoverEffect, setHoverEffect] = useState<{ field: string; value: string; at: number } | null>(null);
  const [pickedEffect, setPickedEffect] = useState<{ field: string; value: string; at: number } | null>(null); // the effect just picked: its name shows in the viewer // a Motion gallery tile under the pointer // a theme tile under the pointer: the viewer tries it
  const [naming, setNaming] = useState<{ from: string; name: string } | null>(null); // a tile's Rename: the new name being typed
  const [creating, setCreating] = useState<{ name: string; from: string } | null>(null); // "+ New theme": name first, then where to start
  const [savingAs, setSavingAs] = useState<string | null>(null); // "Save as new theme": the name being typed
  const [showRemoved, setShowRemoved] = useState(false);
  const [pairView, setPairView] = useState<PairingsView | null>(null);
  // Changes are saved one after the other, in the order they were made: leaving a field (which saves
  // it) and choosing a menu item right after must both count; nothing is disabled while saving.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/recipe`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StyleData & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) return setError(d.error);
        setData(d);
        const t = editParam ? d.themes.find((x) => x.name === editParam) : undefined;
        if (t) openEditor(t);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId, editParam]);

  // A new plan arrived with every saved change in it: the viewer plays the plan as it is.
  useEffect(() => {
    if (!pending.current) setDirty(false);
  }, [planned]);

  function act(raw: { action: "set" | "reset" | "lock" | "unlock" | "brand"; field: string; platform?: string; value?: unknown }) {
    // A theme setting goes into the editor's draft (saved with "Save"); outside the editor it cannot change.
    if (LOOK_FIELDS_PATCHED.has(raw.field)) {
      if (raw.action === "set" || raw.action === "reset") setDraft((d) => (d ? draftSet(d, raw.field, raw.action === "set" ? raw.value : null, raw.platform) : d));
      return Promise.resolve(true);
    }
    const body = raw;
    // The new value shows at once (the save follows): the padlock, and a song-wide value.
    if (body.action === "lock" || body.action === "unlock") {
      setData((d) => (d ? { ...d, fields: d.fields.map((f) => (f.field === body.field ? { ...f, locked: body.action === "lock" } : f)) } : d));
    }
    if (body.action === "set" && !body.platform) {
      // The platforms without their own value in this song follow the new default too.
      setData((d) => (d ? { ...d, fields: d.fields.map((f) => (f.field === body.field ? { ...f, value: body.value, own: true, perPlatform: f.perPlatform?.map((p) => (p.source.startsWith("song:") || p.source.startsWith("theme:") ? p : { ...p, value: body.value })) ?? null } : f)) } : d));
    }
    if (LOOK_FIELDS_PATCHED.has(body.field)) setDirty(true);
    pending.current += 1;
    setSaving("saving");
    setError(null);
    let ok = false;
    queue.current = queue.current.then(async () => {
      try {
        const r = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = (await r.json()) as StyleData & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        // Only the last answer replaces what is shown: an earlier one does not have the changes made since.
        if (pending.current === 1) setData(d);
        ok = true;
      } catch (e) {
        setError((e as Error).message);
        // Show what is really saved.
        const fresh = (await api(`/api/songs/${projectId}/recipe`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null)) as (StyleData & { error?: string }) | null;
        if (fresh && !fresh.error) setData(fresh);
      } finally {
        pending.current -= 1;
        if (!pending.current) {
          setSaving("saved");
          onSaved(); // the video is planned again
          router.refresh(); // Make starts from the recipe
        }
      }
    });
    return queue.current.then(() => ok);
  }

  // @font-face rules for the font rows' preview line (each font loads only when it is shown).
  const fontCss = useMemo(
    () =>
      (data?.fonts ?? [])
        .flatMap((f) => f.faces.flatMap((face) => face.srcs.map((src) => `@font-face{font-family:"${f.family} preview";src:url("/api/fonts/${src}");font-weight:${face.weight};font-style:${face.style};}`)))
        .join("\n"),
    [data?.fonts],
  );

  async function reload() {
    const fresh = (await api(`/api/songs/${projectId}/recipe`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as (StyleData & { error?: string }) | null;
    if (fresh && !fresh.error) setData(fresh);
    setDirty(true);
    onSaved();
    router.refresh();
  }

  // The Theme panel's actions (use, new, save, save as, rename, delete, restore): each answers with the
  // song's settings. Returns whether it worked.
  async function themeAction(body: { action: "use" | "create" | "save" | "saveAs" | "rename" | "remove" | "restore"; theme?: string; name?: string; from?: string; folder?: string; look?: unknown; perPlatform?: unknown }): Promise<boolean> {
    setSaving("saving");
    setError(null);
    try {
      const r = await api(`/api/songs/${projectId}/theme`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as StyleData & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      if (["use", "create", "save", "saveAs"].includes(body.action)) {
        closeEditor(); // saved (or another theme): nothing unsaved is kept any more
        if (body.action === "create" && d.theme) setDraft(draftOf(d.theme)); // a new theme opens in the editor
        setDirty(true);
        onSaved(); // the video is planned again with the theme
        router.refresh();
      }
      setSaving("saved");
      return true;
    } catch (e) {
      setError((e as Error).message);
      setSaving("idle");
      return false;
    }
  }

  // The look for the viewer, sent up whenever it changes.
  useEffect(() => {
    if (!data) return;
    // A gallery tile under the pointer: the big viewer plays that effect on the song (nothing is set).
    const base = hoverTheme ? withTheme(data, hoverTheme) : data;
    const shown = hoverEffect ? { ...base, fields: base.fields.map((f) => (f.field === hoverEffect.field ? { ...f, value: hoverEffect.value, own: true, perPlatform: null } : f)) } : base;
    const look = lookOf(shown, { dirty: dirty || !!hoverTheme || !!hoverEffect || !!draft?.changed, hovered, pairView, part, trying: hoverTheme?.name ?? null });
    // The effect pointed at (or just picked): its plain name, moving in it, over the viewer's frame.
    const demoOf = hoverEffect ?? pickedEffect;
    const demoName = demoOf?.value.split(":")[0];
    const demo = demoOf && demoName
      ? { key: `${demoOf.field}:${demoOf.value}:${hoverEffect ? `hover${hoverEffect.at}` : pickedEffect!.at}`, input: { ...look.fallback, background: null, backing: false, picture: null, transparent: true, lyrics: previewLyrics([effectTitle(demoName)]), textSize: 140, area: null, effect: patchChoice(demoOf.value, undefined) } }
      : null;
    onLook({ ...look, demo, ...(demo && hoverEffect ? { fallback: { ...look.fallback, lyrics: previewLyrics([effectTitle(demoName!)]), textSize: 110 } } : {}) });
  }, [data, dirty, draft?.changed, hovered, hoverTheme, hoverEffect, pickedEffect, pairView, part, onLook]);

  if (error && !data) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading the song&apos;s recipe…</p>;
  if (!data.folder) {
    return <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">This song still uses the old folders. Migrate it first (Library → Migrate); then its recipe shows here.</p>;
  }

  // A role's value (verse / hook font, weight, italic) for the default or one platform.
  const valueOf = (field: string, platform?: string): unknown => {
    const f = data.fields.find((x) => x.field === field);
    return platform ? (f?.perPlatform?.find((p) => p.platform === platform)?.value ?? f?.value) : f?.value;
  };
  const familyOf = (role: "verse" | "hook", platform?: string) => data.fonts.find((x) => x.family.toLowerCase() === String(valueOf(`${role}Font`, platform)).toLowerCase());
  const editor = (f: StyleField, value: unknown, platform?: string) => {
    const set = (v: unknown) => act({ action: "set", field: f.field, platform, value: v });
    const key = `${f.field}-${platform ?? "default"}`;
    if (f.field === "verseEffect" || f.field === "hookEffect") {
      const [name, intensity = "balanced"] = String(value).split(":");
      const join = (n: string, i: string) => (i === "balanced" ? n : `${n}:${i}`);
      if (!platform) {
        // The song's own effect is set in "Set effect" above (it shows exactly what the video draws); only the per-platform overrides keep dropdowns.
        const typer = name.startsWith("typewriter") && name !== "typewriter-words";
        return (
          <p className="text-sm">
            <span data-effect-value>
              {name} · {typer ? (intensity === "subtle" ? "calm" : intensity === "balanced" ? "normal" : "quick") : intensity}
            </span>
            <span className="text-muted-foreground ml-3 text-xs">set it in Set effect above</span>
          </p>
        );
      }
      return (
        <div className="flex gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={name} onChange={(e) => set(join(e.target.value, intensity))}>
            {data.effects.map((e) => (
              <option key={e.name} value={e.name}>
                {e.label}
                {(f.field === "verseEffect" ? data.brandDefaults.verseEffect : data.brandDefaults.hookEffect).split(":")[0] === e.name ? " · brand default" : ""}
              </option>
            ))}
          </select>
          <select aria-label={`${f.label} intensity ${platform ?? ""}`} className={select} value={intensity} onChange={(e) => set(join(name, e.target.value))}>
            {INTENSITIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (f.field === "verseFont" || f.field === "hookFont") {
      const role = f.field === "verseFont" ? "verse" : "hook";
      const font = data.fonts.find((x) => x.family.toLowerCase() === String(value).toLowerCase());
      const look = { weight: Number(valueOf(`${role}Weight`, platform)), italic: valueOf(`${role}Italic`, platform) === true };
      return <FontEditor fonts={data.fonts} value={String(value)} font={font} look={look} previewLine={data.previewLine} onChange={set} testId={key} />;
    }
    if (f.field === "verseWeight" || f.field === "hookWeight") {
      const role = f.field === "verseWeight" ? "verse" : "hook";
      const family = familyOf(role, platform);
      const italic = valueOf(`${role}Italic`, platform) === true;
      const style = italic && family?.faces.some((x) => x.style === "italic") ? "italic" : "normal";
      const weights = [...new Set((family?.faces ?? []).filter((x) => x.style === style).map((x) => x.weight))].filter((w) => w >= 300 && w <= 800).sort((a, b) => a - b);
      const n = Number(value);
      const nearest = weights.length ? weights.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)) : n;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(n)} onChange={(e) => set(Number(e.target.value))}>
            {!weights.includes(n) ? <option value={n}>{n} (not in {family?.family ?? "this font"}: {nearest} is used)</option> : null}
            {weights.map((w) => (
              <option key={w} value={w}>
                {w} · {WEIGHT_NAMES[w] ?? ""}
              </option>
            ))}
          </select>
          {!weights.includes(n) ? (
            <span data-weight-fallback={key} className="text-xs text-amber-300">
              {family?.family} has no {n}{style === "italic" ? " italic" : ""}: the video uses {nearest} (never a synthetic bold)
            </span>
          ) : null}
        </div>
      );
    }
    if (f.field === "verseItalic" || f.field === "hookItalic") {
      const role = f.field === "verseItalic" ? "verse" : "hook";
      const family = familyOf(role, platform);
      const has = !!family?.faces.some((x) => x.style === "italic");
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-edit={key} checked={value === true} disabled={!has && value !== true} onChange={(e) => set(e.target.checked)} className="accent-brand" />
          {has ? "italic" : <span className="text-muted-foreground text-xs">{family?.family ?? "This font"} has no italic{value === true ? ": the video uses upright (never a synthetic italic)" : ""}</span>}
        </label>
      );
    }
    if (f.field === "accentColour" || f.field === "textColour" || f.field === "fallbackColour") {
      return <ColourField label={`${f.label} ${platform ?? ""}`.trim()} editKey={key} value={String(value)} onSet={(c) => void set(c)} />;
    }
    if (f.field === "collections" || f.field === "platforms") {
      const all = f.field === "collections" ? data.collections : data.platforms.map((p) => p.name);
      const list = (value as string[]) ?? [];
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {all.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" data-edit={`${key}-${c}`} checked={list.includes(c)} onChange={(e) => set(e.target.checked ? [...list, c] : list.filter((x) => x !== c))} />
                {f.field === "platforms" ? (data.platforms.find((p) => p.name === c)?.label ?? c) : c}
              </label>
            ))}
          </div>
          {f.field === "platforms" && !list.length ? (
            <p data-platforms-empty className="text-muted-foreground truncate text-xs" title={PLATFORMS_EMPTY}>
              {PLATFORMS_EMPTY}
            </p>
          ) : null}
        </div>
      );
    }
    if (f.field === "variations") {
      const v = (value as Record<string, number>) ?? {};
      return (
        <div className="flex flex-wrap gap-2">
          {data.platforms.map((p) => (
            <label key={p.name} className="flex items-center gap-1 text-xs">
              {p.label}
              <input
                type="number"
                min={1}
                max={24}
                placeholder={`${p.presetVariations} (preset)`}
                key={`${p.name}-${v[p.name] ?? ""}`}
                defaultValue={v[p.name] ?? ""}
               
                className={cn(input, "w-28")}
                onBlur={(e) => {
                  const n = e.target.value ? Number(e.target.value) : undefined;
                  if (n === v[p.name]) return;
                  const next = { ...v };
                  if (n) next[p.name] = n;
                  else delete next[p.name];
                  set(next);
                }}
              />
            </label>
          ))}
        </div>
      );
    }
    if (f.field === "length") {
      const preset = platform ? data.platforms.find((p) => p.name === platform)?.presetLength : "each platform's preset";
      return (
        <div className="flex items-center gap-2">
          <input
            key={`${key}-${String(value)}`}
            type="number"
            min={3}
            max={600}
            data-edit={key}
            className={cn(input, "w-24")}
            defaultValue={value === null || value === undefined ? "" : String(value)}
            placeholder="preset"
           
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const n = e.target.value ? Number(e.target.value) : null;
              if (n === (value ?? null)) return;
              if (n === null) act({ action: "reset", field: f.field, platform });
              else set(n);
            }}
          />
          <Hint text={`s · empty = ${preset}; shapes an "auto" section only`} />
        </div>
      );
    }
    if (f.field === "titleOpening") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "off")} onChange={(e) => (e.target.value === "off" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            <option value="off">off (start on the hook)</option>
            <option value="on">on (title, artist and tagline before the first hook)</option>
          </select>
          <Hint text="the app places and times them: upper third, lower third, gone as the first line fades in" />
        </div>
      );
    }
    if (f.field === "heldGlow" || f.field === "chorusLift" || f.field === "shine" || f.field === "emphasis") {
      const what = {
        heldGlow: "a word sung for about a second or longer brightens in your accent colour while it is held",
        chorusLift: "the first line of each chorus arrives a touch bigger and brighter, then eases back",
        shine: "one soft light sweep across each chorus line, on a downbeat",
        emphasis: "the key word of each line in the hook font, bigger and in the accent colour",
      }[f.field];
      if (!platform) {
        // Set in "Set effect" above; only "Use for all my songs" (the brand) and the per-platform overrides are edited here.
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span data-effect-value className="text-sm">
              {String(value ?? "off")}
            </span>
            <Hint text={what} />
            <span className="text-muted-foreground text-xs">· set it in Set effect above</span>
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "off")} onChange={(e) => (e.target.value === "off" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            <option value="off">off</option>
            <option value="on">on</option>
          </select>
          <Hint text={what} />
        </div>
      );
    }
    if (f.field === "breathe") {
      if (!platform) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span data-effect-value className="text-sm">
              {{ off: "off", gentle: "gentle", beat: "with the beat" }[String(value ?? "off")] ?? String(value)}
            </span>
            <Hint text="works with every lyric effect; a little deeper on choruses" />
            <span className="text-muted-foreground text-xs">· set it in Set effect above</span>
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "off")} onChange={(e) => (e.target.value === "off" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            <option value="off">off</option>
            <option value="gentle">gentle (a slow swell every few seconds)</option>
            <option value="beat">with the beat (one swell per bar, on the downbeats)</option>
          </select>
          <Hint text="works with every lyric effect; a little deeper on choruses" />
        </div>
      );
    }
    if (f.field === "transitions") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "auto")} onChange={(e) => (e.target.value === "auto" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            {TRANSITIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Hint text="a clip's own choice (Storyboard → clip editor) always wins" />
        </div>
      );
    }
    if (f.field === "readability") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "auto")} onChange={(e) => (e.target.value === "auto" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            {READABILITY.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Hint text="auto = the app measures your clips behind the lyrics and adds a soft dark band when they are bright there; the run's log and manifest say which and why" />
        </div>
      );
    }
    if (f.field === "ending") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={String(value ?? "auto")} onChange={(e) => (e.target.value === "auto" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            {ENDINGS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Hint text="auto = the app listens to the end of the section and chooses; the Storyboard header says which and why" />
        </div>
      );
    }
    if (f.field === "shotLength") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={value === null || value === undefined ? "auto" : String(value)} onChange={(e) => (e.target.value === "auto" && !platform ? act({ action: "reset", field: f.field, platform }) : set(e.target.value))}>
            {SHOT_LENGTHS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Hint text="auto = the app picks whole-bar shots from the song's feel and your clips' length (the Storyboard header says which); story = 2 bars on hooks, 4 on verses" />
        </div>
      );
    }
    if (f.field === "tempo") {
      return <TempoEditor projectId={projectId} value={typeof value === "number" ? value : null} song={data.song} onSet={(n) => (n === null ? act({ action: "reset", field: f.field }) : set(n))} />;
    }
    if (f.field === "youtubeLayout") {
      return (
        <select aria-label={f.label} data-edit={key} className={select} value={String(value)} onChange={(e) => set(e.target.value)}>
          {["cover", "stills", "clips"].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      );
    }
    // section, ep: text, saved on Enter or when leaving the field
    return (
      <input
        key={`${key}-${String(value)}`}
        data-edit={key}
        className={cn(input, "w-48")}
        defaultValue={String(value ?? "")}
        placeholder={f.field === "section" ? "auto, full or 0:11-1:10" : f.field === "hookText" ? "the first chorus line" : f.field === "endText" ? "Stream {title} on Spotify" : ""}
       
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => e.target.value.trim() !== String(value ?? "") && set(e.target.value.trim())}
      />
    );
  };

  const byField = new Map(data.fields.map((f) => [f.field, f] as const));
  const pick = (names: readonly string[]) => names.map((n) => byField.get(n as StyleField["field"])).filter((f): f is StyleField => !!f);
  // Any setting not named in a block (a future one) lands in "This song".
  const placed = new Set<string>([...SONG_FIELDS, ...LOOK_FIELDS, ...PICTURE_FIELDS, ...EFFECT_FIELDS, ...FONT_ORDER, ...MAKE_FIELDS, ...AUTO_FIELDS]);
  const songFields = [...pick(SONG_OTHER_FIELDS), ...data.fields.filter((f) => !placed.has(f.field))];
  const fontFields = pick(FONT_ORDER);
  const autoFields = pick(AUTO_FIELDS);
  // "Set by you": the song's own value (default or one platform) or a lock.
  const setByYou = autoFields.filter((f) => f.own || f.locked || (f.perPlatform ?? []).some((p) => p.own));
  const sampleStyle = (role: "verse" | "hook") => ({ fontFamily: `"${String(valueOf(`${role}Font`))} preview", serif`, fontWeight: Number(valueOf(`${role}Weight`) ?? 400), fontStyle: valueOf(`${role}Italic`) === true ? "italic" : "normal" });
  const face = (role: "verse" | "hook") => `${String(valueOf(`${role}Font`))} ${String(valueOf(`${role}Weight`))}${valueOf(`${role}Italic`) === true ? " italic" : ""}`;

  const menuFor = (f: StyleField, differsPerPlatform: boolean): RowMenuItem[] => LOOK_FIELDS_PATCHED.has(f.field) ? (f.perPlatform && !differsPerPlatform
      ? [{ key: "platform", label: open[f.field] ? "Hide the per-platform values" : "Per platform…", onSelect: () => setOpen((o) => ({ ...o, [f.field]: !o[f.field] })), attrs: { "data-per-platform": f.field } }]
      : []) : [
    ...(f.perPlatform && !differsPerPlatform
      ? [{ key: "platform", label: open[f.field] ? "Hide the per-platform values" : "Per platform…", onSelect: () => setOpen((o) => ({ ...o, [f.field]: !o[f.field] })), attrs: { "data-per-platform": f.field } }]
      : []),
    ...(f.own && !f.locked ? [{ key: "reset", label: "Back to the inherited value", onSelect: () => void act({ action: "reset", field: f.field }), attrs: { "data-reset": f.field } }] : []),
    {
      key: "lock",
      label: f.locked ? "Unlock" : "Lock: keep this song's value",
      onSelect: () => void act({ action: f.locked ? "unlock" : "lock", field: f.field }),
      attrs: { "data-lock": f.field, "aria-pressed": f.locked ? "true" : "false" },
    },
  ];

  const row = (f: StyleField) => {
    const differsPerPlatform = !!f.perPlatform?.some((p) => JSON.stringify(p.value) !== JSON.stringify(f.value));
    return (
      <li key={f.field} data-field={f.field} className={cn("bg-card rounded-lg border px-3 py-2.5", f.locked && "border-brand/40")}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium" title={f.own ? undefined : `From: ${sourceLabel(f.source, data.platforms)}`} data-source-hint={f.own ? undefined : sourceLabel(f.source, data.platforms)}>
            {f.label}
          </span>
          {f.own ? (
            <span data-source className="border-brand/40 text-brand rounded-full border px-2 py-0.5 text-xs">
              {sourceLabel(f.source, data.platforms)}
            </span>
          ) : null}
          {f.locked ? <Lock className="text-brand size-3.5" aria-label="locked" data-locked={f.field} /> : null}
          <RowMenu label={f.label} menuId={f.field} items={menuFor(f, differsPerPlatform)} />
        </div>
        <div className="mt-1.5 min-w-0">{editor(f, f.value)}</div>
        {f.perPlatform && (differsPerPlatform || open[f.field]) ? (
          <div className="mt-2">
            {differsPerPlatform ? (
              <button type="button" data-per-platform={f.field} aria-expanded={!!open[f.field]} onClick={() => setOpen((o) => ({ ...o, [f.field]: !o[f.field] }))} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-left text-xs">
                <ChevronDown className={cn("size-3 shrink-0 transition-transform", open[f.field] && "rotate-180")} />
                <span>
                  Per platform
                  <span className="text-brand"> · {f.perPlatform.filter((p) => JSON.stringify(p.value) !== JSON.stringify(f.value)).map((p) => `${p.label}: ${show(p.value)}`).join(" · ")}</span>
                </span>
              </button>
            ) : null}
            {open[f.field] ? (
              <ul className="mt-2 flex flex-col gap-2 border-l pl-3">
                {f.perPlatform.map((p) => (
                  <li key={p.platform} data-platform-value={`${f.field}-${p.platform}`} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-xs" title={p.own ? undefined : `From: ${sourceLabel(p.source, data.platforms)}`}>
                        {p.label}
                      </span>
                      {p.own ? (
                        <span data-source className="border-brand/40 text-brand rounded-full border px-2 py-0.5 text-xs">
                          {sourceLabel(p.source, data.platforms)}
                        </span>
                      ) : null}
                      {p.own ? (
                        <button type="button" data-reset={`${f.field}-${p.platform}`} title={LOOK_FIELDS_PATCHED.has(f.field) ? "Back to the theme's default" : "Back to the song's default"} onClick={() => act({ action: "reset", field: f.field, platform: p.platform })} className="text-muted-foreground hover:text-foreground rounded px-1 text-xs underline underline-offset-2">
                          reset
                        </button>
                      ) : null}
                    </div>
                    <div className="min-w-0">{editor(f, p.value, p.platform)}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };
  const rows = (fields: StyleField[]) => <ul className="flex flex-col gap-2">{fields.map(row)}</ul>;

  // The compact lines.
  const word = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));
  const songLine = [`Tagline: ${word(valueOf("tagline"))}`, `EP: ${word(valueOf("ep"))}`, `YouTube: ${word(valueOf("youtubeLayout"))}`, `Title opening: ${valueOf("titleOpening") === "on" ? "on" : "off"}`].join(" · ");
  const chosen = (valueOf("platforms") as string[] | undefined) ?? [];
  const counts = (valueOf("variations") as Record<string, number> | undefined) ?? {};
  const shownPlatforms = data.platforms.filter((p) => (chosen.length ? chosen.includes(p.name) : RELEASE.includes(p.name)));
  const collections = (valueOf("collections") as string[] | undefined) ?? [];
  const makeLine = `${shownPlatforms.map((p) => `${p.label} ${counts[p.name] ?? p.presetVariations}`).join(" · ")}${chosen.length ? "" : " (none ticked: all five)"} · clips: the song's own${collections.length ? ` + ${collections.join(" + ")}` : ""}`;
  const effectValues = effectValuesOf(data);

  return (
    <div data-style data-section={section ?? ""} className={cn("flex flex-col gap-4", !section && "hidden")}>
      <style>{fontCss}</style>
      <p
        data-saving={saving}
        className="text-muted-foreground -mb-2 h-4 truncate text-xs"
        aria-live="polite"
        title={`This song's recipe (${data.recipeFile?.split("/").pop()}). A setting comes from the library defaults, the artist's brand (${data.brandFile.split("/").join("\\")}), the song's theme (fonts, effects, colour) or this song; a change here is saved at once. A locked setting keeps this song's value: a brand change does not reach it and Make cannot change it for one run.`}
      >
        {saving === "saving" ? "Saving…" : saving === "saved" ? (section === "theme" ? "✓ Saved in the theme" : "✓ Saved for this song") : section === "theme" ? "The song's look comes from its theme." : "Every change is saved for this song at once."}
      </p>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      {section === "theme" ? (
        <Block id="theme" title="Theme">
          {draft && editingTheme ? (
            // The theme editor: four sections, the viewer shows every change at once; nothing is saved until Save.
            <div data-theme-editors className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" data-theme-editing={editingTheme.name}>
                  Editing theme: {editingTheme.name}
                  {editingTheme.name !== saved?.theme?.name ? <span className="text-muted-foreground font-normal"> (shown on this song)</span> : null}
                </span>
                {draft.changed ? <span data-theme-unsaved className="text-xs text-amber-300">not saved yet</span> : null}
              </div>
              {restored && draft.changed ? (
                <p data-theme-restored className="rounded-md border border-amber-300/40 bg-amber-300/10 px-2.5 py-1.5 text-xs text-amber-100">
                  Your unsaved changes from last time are back. Save keeps them; Cancel drops them.
                </p>
              ) : null}
              {/* The save bar, right below "Editing:" and staying in view while the sections scroll (moved up from the
                  bottom on 31 Oct 2026: Save as new theme was easy to miss there). The only place a change is saved. */}
              <div data-theme-footer className="bg-card/95 sticky top-0 z-10 -mx-3 -mt-2 flex flex-col gap-2 border-b px-3 py-2.5 backdrop-blur">
                {savingAs !== null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      data-theme-save-as-name
                      aria-label="New theme name"
                      placeholder="Name the new theme"
                      className={cn(input, "min-w-0 flex-1")}
                      value={savingAs}
                      onChange={(e) => setSavingAs(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setSavingAs(null)}
                    />
                    <button type="button" data-theme-save-as-confirm disabled={!savingAs.trim()} onClick={() => void themeAction({ action: "saveAs", theme: draft.name, name: savingAs, look: draft.look, perPlatform: draft.perPlatform }).then((ok) => ok && setSavingAs(null))} className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50">
                      Save
                    </button>
                    <button type="button" onClick={() => setSavingAs(null)} className="text-muted-foreground text-xs underline underline-offset-2">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" data-theme-save onClick={() => void themeAction({ action: "save", theme: draft.name, look: draft.look, perPlatform: draft.perPlatform })} className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium">
                      {editingTheme.users.length > 1 ? `Save (changes ${editingTheme.users.length} songs)` : "Save"}
                    </button>
                    <button type="button" data-theme-save-as onClick={() => setSavingAs(`${editingTheme.name} 2`)} className="bg-muted rounded-md px-3 py-1 text-xs">
                      Save as new theme
                    </button>
                    <button type="button" data-theme-cancel onClick={() => (closeEditor(), setDirty(false))} className="text-muted-foreground ml-auto text-xs underline underline-offset-2">
                      Cancel
                    </button>
                  </div>
                )}
                {editingTheme.users.length > 1 && savingAs === null ? <p className="text-muted-foreground text-[11px]">Used by {editingTheme.users.join(", ")}. “Save as new theme” keeps it as it is for them.</p> : null}
              </div>

              <EditorSection id="cards" title="Cards">
                <p className="text-muted-foreground -mt-1 text-[11px]">
                  How the cards look, for every song on this theme. Their words (title, tagline, Hook and End card text) are this song&apos;s:{" "}
                  <button type="button" data-card-text-link onClick={() => setPanel("song")} className="text-foreground underline underline-offset-2">
                    This song → Card text
                  </button>
                </p>
                <TitleStyleControls value={(k) => valueOf(k)} onSet={(field, value) => void act({ action: "set", field, value })} sample={data.title || "Your title"} font={String(valueOf("verseFont") ?? "")} />
                <ExtraCardControls value={(k) => valueOf(k)} onSet={(field, value) => void act({ action: "set", field, value })} font={String(valueOf("hookFont") ?? valueOf("verseFont") ?? "")} hookSample={String(valueOf("hookText") || data.sampleLines.find((_, i) => i === 1) || "Your chorus")} endSample={String(valueOf("endText") || "Stream {title} on Spotify").replace(/\{title\}/gi, data.title || "Your song").replace(/\{artist\}/gi, "")} />
              </EditorSection>

              <EditorSection id="text" title="Text">
                <TextLayoutControls value={(k) => valueOf(k)} onSet={(field, value) => void act({ action: "set", field, value })} />
                <PairingsRow
                  projectId={projectId}
                  scope="all"
                  fonts={draftFonts(draft)}
                  onPick={(card) => setDraft((d) => (d ? pickPair(d, card) : d))}
                  onChanged={reload}
                  onView={setPairView}
                  onHover={setHovered}
                />
                <div data-font-summary className="bg-card flex flex-col gap-1.5 rounded-lg border px-3 py-2.5">
                  <span className="sr-only" data-font-summary-text>
                    Fonts: verses {face("verse")} · choruses {face("hook")}
                  </span>
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wide">Lyric line</span>
                  <span data-font-sample="verse" className="truncate text-xl leading-tight" style={sampleStyle("verse")} title={face("verse")}>
                    {data.sampleLines[0] || "Your verses"}
                  </span>
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wide">Hook</span>
                  <span data-font-sample="hook" className="truncate text-xl leading-tight" style={{ ...sampleStyle("hook"), color: String(valueOf("accentColour") ?? "inherit") }} title={face("hook")}>
                    {data.sampleLines[1] || "Your choruses"}
                  </span>
                  <button type="button" data-fine-tune aria-expanded={fineTune} onClick={() => setFineTune((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs underline underline-offset-2">
                    <ChevronDown className={cn("size-3 transition-transform", fineTune && "rotate-180")} />
                    Choose each font
                  </button>
                </div>
                {fineTune ? (
                  <div data-fine-tune-rows className="flex flex-col gap-2 border-l pl-3">
                    {rows(fontFields)}
                    <p data-user-fonts className="text-muted-foreground text-xs" title={`Your own fonts: put .ttf, .otf, .woff or .woff2 files in ${data.userFonts}; they appear in the font lists after reloading this page.`}>
                      Your own fonts: put .ttf, .otf, .woff or .woff2 files in <span className="text-foreground font-mono break-all">{data.userFonts}</span>, then reload this page.
                    </p>
                  </div>
                ) : null}
              </EditorSection>

              <EditorSection id="motion" title="Motion">
                <SetEffect
                  effects={data.effects}
                  values={effectValues}
                  part={part}
                  setPart={setPart}
                  locked={[]}
                  saved={false}
                  onSet={(field, value) => {
                    if (field === "verseEffect" || field === "hookEffect") setPickedEffect({ field, value, at: Date.now() });
                    void act({ action: "set", field, value });
                  }}
                  onTry={(field, value) => setHoverEffect(value ? { field, value, at: Date.now() } : null)}
                  perPlatformOpen={effectPlatforms}
                  onPerPlatform={() => {
                    const next = !effectPlatforms;
                    setEffectPlatforms(next);
                    setOpen((o) => ({ ...o, ...Object.fromEntries(EFFECT_FIELDS.map((k) => [k, next])) }));
                  }}
                />
                {effectPlatforms ? <div data-effect-platform-rows className="border-l pl-3">{rows(pick(EFFECT_FIELDS))}</div> : null}
              </EditorSection>

              <EditorSection id="colours" title="Colours">
                {rows(pick(LOOK_FIELDS))}
                <CoverColours cover={data.cover} current={String(valueOf("accentColour") ?? "")} onPick={(c) => void act({ action: "set", field: "accentColour", value: c })} />
              </EditorSection>

              <EditorSection id="picture" title="Picture">
                <PictureControls value={(k) => valueOf(k)} onSet={(field, value) => void act({ action: "set", field, value })} />
                {valueOf("fallback") === "colour" ? rows(pick(["fallbackColour"])) : null}
              </EditorSection>

            </div>
          ) : (
            <>
              {data.theme ? (
                <div data-theme-current={data.theme.name} className="bg-card flex flex-col gap-1.5 rounded-lg border px-3 py-2.5">
                  <span className="min-w-0 truncate text-sm font-medium">This song&apos;s theme: {data.theme.name}</span>
                  <p data-theme-users className="text-muted-foreground text-xs" title={data.theme.users.join(", ")}>
                    {data.theme.users.length > 1 ? `Used by ${data.theme.users.length} songs: ${data.theme.users.join(", ")}` : "Used by this song only"}
                  </p>
                  {data.theme.problems.length ? <p className="text-xs text-amber-300">{data.theme.problems.join(" ")}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-theme-edit onClick={() => saved?.theme && openEditor(saved.theme)} className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium">
                      Edit theme
                    </button>
                    <button type="button" data-theme-new onClick={() => setCreating({ name: "", from: data.theme?.name ?? "" })} className="bg-muted flex items-center gap-1 rounded-md px-3 py-1 text-xs">
                      <Plus className="size-3.5" /> New theme
                    </button>
                  </div>
                </div>
              ) : null}

              {creating ? (
                <div data-theme-create className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5">
                  <span className="text-sm font-medium">New theme</span>
                  <input autoFocus data-new-theme-name aria-label="Theme name" placeholder="Name it first (e.g. Night Drive)" className={input} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
                  <label className="flex items-center gap-2 text-xs">
                    Start from
                    <select data-new-theme-from className={cn(select, "min-w-0 flex-1")} value={creating.from} onChange={(e) => setCreating({ ...creating, from: e.target.value })}>
                      {data.themes.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                          {t.name === data.theme?.name ? " (this song's look)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button type="button" data-new-theme-create disabled={!creating.name.trim()} onClick={() => void themeAction({ action: "create", name: creating.name, from: creating.from }).then((ok) => ok && setCreating(null))} className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50">
                      Create and edit
                    </button>
                    <button type="button" onClick={() => setCreating(null)} className="text-muted-foreground text-xs underline underline-offset-2">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div data-theme-tiles className="flex flex-col gap-2">
                {data.themes.map((t) => {
                  const current = t.name === data.theme?.name;
                  const v = t.look as Record<string, unknown>;
                  const fam = (role: "verse" | "hook") => ({ fontFamily: `"${String(v[`${role}Font`])} preview", serif`, fontWeight: Number(v[`${role}Weight`] ?? 400), fontStyle: v[`${role}Italic`] === true ? "italic" : "normal" });
                  return (
                    <div
                      key={t.name}
                      data-theme-tile={t.name}
                      aria-pressed={current}
                      title={`${t.name}: verses ${String(v.verseFont)}, choruses ${String(v.hookFont)}; ${String(v.verseEffect).split(":")[0]} / ${String(v.hookEffect || v.verseEffect).split(":")[0]}`}
                      onMouseEnter={() => !current && setHoverTheme(t)}
                      onMouseLeave={() => setHoverTheme(null)}
                      className={cn("bg-card hover:border-foreground/40 relative flex min-w-0 flex-col gap-1 rounded-lg border p-2", current && "border-brand")}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="size-3 shrink-0 rounded-full border" style={{ background: String(v.accentColour ?? "#E8A3B5") }} />
                        {naming?.from === t.name ? (
                          <input
                            autoFocus
                            data-theme-name-input
                            aria-label="Theme name"
                            className={cn(input, "h-7 min-w-0 flex-1")}
                            value={naming.name}
                            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setNaming(null);
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            onBlur={() => {
                              const name = naming.name.trim();
                              setNaming(null);
                              if (name && name !== t.name) void themeAction({ action: "rename", from: t.name, name });
                            }}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.name}</span>
                        )}
                        {current ? (
                          <span className="text-brand flex shrink-0 items-center gap-0.5 text-[11px]">
                            <Check className="size-3.5" aria-label="this song's theme" /> this song
                          </span>
                        ) : (
                          <button type="button" data-theme-use={t.name} onClick={() => (setHoverTheme(null), void themeAction({ action: "use", name: t.name }))} className="bg-brand/15 text-brand shrink-0 rounded px-2 py-0.5 text-[11px] font-medium">
                            Use for this song
                          </button>
                        )}
                        <RowMenu
                          label={t.name}
                          menuId={`theme-${t.name}`}
                          items={[
                            { key: "rename", label: "Rename", onSelect: () => setNaming({ from: t.name, name: t.name }), attrs: { "data-theme-rename": t.name } },
                            { key: "duplicate", label: "Duplicate (as a new theme)…", onSelect: () => setCreating({ name: `${t.name} copy`, from: t.name }), attrs: { "data-theme-duplicate": t.name } },
                            ...(t.users.length ? [] : [{ key: "delete", label: "Delete", onSelect: () => void themeAction({ action: "remove", name: t.name }), attrs: { "data-theme-delete": t.name } }]),
                          ]}
                        />
                      </span>
                      <span className="line-clamp-2 text-base leading-tight" style={fam("verse")}>
                        {data.sampleLines[0] || data.previewLine || "Your words here"}
                      </span>
                      <span className="line-clamp-2 text-base leading-tight" style={{ ...fam("hook"), color: String(v.accentColour ?? "inherit") }}>
                        {data.sampleLines[1] || "The chorus"}
                      </span>
                      <span className="text-muted-foreground truncate text-[10px]">
                        {String(v.verseEffect).split(":")[0]} · {String(v.hookEffect || v.verseEffect).split(":")[0]} · {t.users.length ? `used by ${t.users.length} song${t.users.length === 1 ? "" : "s"}` : "not used yet"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {data.removedThemes.length ? (
                <div data-removed-themes className="flex flex-col gap-1 text-xs">
                  <button type="button" aria-expanded={showRemoved} onClick={() => setShowRemoved((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start underline underline-offset-2">
                    <ChevronDown className={cn("size-3 transition-transform", showRemoved && "rotate-180")} />
                    Deleted themes ({data.removedThemes.length})
                  </button>
                  {showRemoved
                    ? data.removedThemes.map((r) => (
                        <div key={r.folder} className="flex items-center gap-2 pl-4">
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          <button type="button" data-theme-restore={r.name} onClick={() => void themeAction({ action: "restore", folder: r.folder })} className="text-brand underline underline-offset-2">
                            Restore
                          </button>
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
            </>
          )}
        </Block>
      ) : null}

      {section === "song" ? (
        <Block id="song" title="This song">
          <p data-compact-summary="song" className="text-muted-foreground text-xs">
            {songLine}
          </p>
          {/* Card text (31 Oct 2026): every card's words for this song in one place; how the cards look is the theme's (Theme → Cards). */}
          <div data-card-text className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5">
            <h4 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"><FeatureIcon feature="lyrics" className="size-3.5" /> Card text</h4>
            <p className="text-muted-foreground -mt-1 text-[11px]">The words on this song&apos;s cards. How the cards look (on or off, style, font, colour) comes from the theme: Theme → Cards.</p>
            <CardTitleRow
              projectId={projectId}
              title={data.title}
              onSaved={(t) => {
                setData((d) => (d ? { ...d, title: t } : d));
                router.refresh();
              }}
            />
            {rows(pick(CARD_TEXT_FIELDS))}
          </div>
          {rows(songFields)}
        </Block>
      ) : null}

      {section === "make" ? (
        <Block id="make" title="What to make">
          <p data-compact-summary="make" className="text-muted-foreground text-xs">
            {makeLine}
          </p>
          {rows(pick(MAKE_FIELDS))}
        </Block>
      ) : null}

      {section === "auto" ? (
        <Block id="auto" title="Automatic">
          <p data-auto-summary className="text-muted-foreground text-xs" title="Professional defaults chosen from the music and your clips; set one only to override the app.">
            {setByYou.length ? `${setByYou.length} set by you: ${setByYou.map((f) => shortLabel(f.label)).join(", ")}` : "All automatic: the app handles these"}
          </p>
          {rows(autoFields)}
        </Block>
      ) : null}
    </div>
  );
}

// The stand-in preview of a theme on a few lyric lines (the Themes page's tiles and detail view).
export function themePreview(look: Record<string, unknown>, fonts: StyleFont[], sampleLines: string[], background: string | null = null): LookPreviewProps {
  const fields = Object.entries(look).map(([field, value]) => ({ field, value })) as unknown as StyleField[];
  const p = lookOf({ fields, fonts, sampleLines } as unknown as StyleData, { dirty: false, hovered: null, pairView: null, part: "verse" }).fallback;
  // background: the Theme cover (workspace-relative; Themes page) or a frame of the song's clip (Shape).
  return background ? { ...p, background: `/api/files/${background}` } : p;
}

// The look the viewer shows: the recipe's (or the pairing pointed at), patched into the planned video
// while a change is not planned yet; and the stand-in preview.
// The song's Style data as if it used another theme (the theme tile under the pointer).
function withTheme(data: StyleData, theme: StyleTheme): StyleData {
  const look = theme.look as Record<string, unknown>;
  return { ...data, fields: data.fields.map((f) => (f.field in look ? { ...f, value: look[f.field], own: true, perPlatform: null } : f)) };
}

function lookOf(data: StyleData, s: { dirty: boolean; hovered: PairingCard | null; pairView: PairingsView | null; part: EffectPart; trying?: string | null }): ShapeLook {
  const value = (field: string) => data.fields.find((f) => f.field === field)?.value;
  const verseRecipe = { family: String(value("verseFont") ?? "Cormorant Garamond"), weight: Number(value("verseWeight") ?? 400), italic: value("verseItalic") === true };
  const hookRecipe = { family: String(value("hookFont") ?? verseRecipe.family), weight: Number(value("hookWeight") ?? 400), italic: value("hookItalic") === true };
  const faceOf = (f: { family: string; weight: number; italic: boolean }): PatchFace => {
    const p = previewFace(data.fonts, f.family, f.weight, f.italic);
    return p ? { family: p.family, weight: p.weight, italic: p.italic, files: p.files } : { ...f, files: [] };
  };
  const verse = faceOf(s.hovered ? s.hovered.verse : verseRecipe);
  const hook = faceOf(s.hovered ? s.hovered.hook : hookRecipe);
  const fx = effectValuesOf(data);
  const verseEffect = fx.verseEffect;
  const hookEffect = fx.hookEffect || verseEffect;
  const breathe = fx.breathe;
  const addOns = { heldGlow: fx.heldGlow, chorusLift: fx.chorusLift, shine: fx.shine, emphasis: fx.emphasis };
  const accent = String(value("accentColour") ?? "#E8A3B5");
  const colour = String(value("textColour") ?? s.pairView?.colour ?? "#FFFFFF");
  const picture = pictureOf({ grade: str(value("grade")), vignette: str(value("vignette")), textBacking: str(value("textBacking")), fallback: str(value("fallback")), fallbackColour: str(value("fallbackColour")), titleStyle: str(value("titleStyle")), titleWarp: str(value("titleWarp")), accentColour: accent });
  const cards = { hook: value("hookCard") === "on", hookStyle: (str(value("hookCardStyle")) ?? "plain") as TitleStyle, end: value("endCard") === "on", endStyle: (str(value("endCardStyle")) ?? "label") as TitleStyle };
  const textLayout: TextLayout = isTextLayout(value("textLayout")) ? (value("textLayout") as TextLayout) : "centre";
  const patch: LookPatch | null = s.dirty ? { verse, hook, verseEffect, hookEffect, breathe, ...addOns, accent, colour, picture, cards, textLayout } : s.hovered ? { verse, hook } : null;
  const all = [...verse.files, ...hook.files];
  const fallback: LookPreviewProps = {
    mediaBaseUrl: "/api/fonts",
    fonts: all.filter((f, i) => all.findIndex((g) => g.src === f.src && g.family === f.family) === i),
    background: s.pairView?.background ? `/api/files/${s.pairView.background}` : null,
    lyrics: previewLyrics(data.sampleLines),
    effect: patchChoice(s.part === "verse" ? verseEffect : hookEffect, undefined),
    breathe,
    addOns,
    verse: { family: verse.family, weight: verse.weight, italic: verse.italic },
    hook: { family: hook.family, weight: hook.weight, italic: hook.italic },
    accent,
    colour,
    textSize: s.pairView?.textSize ?? 64,
    area: s.pairView?.area ?? null,
    picture,
    ...(textLayout !== "centre" ? { textLayout } : {}),
    backing: previewBacking((value("readability") as Readability | undefined) ?? "auto", s.pairView?.bandLuminance ?? null, { colour, accent, verse, hook }),
  };
  const caption = s.trying ? `Trying the theme ${s.trying}: click it to use it for this song.` : s.hovered ? `Trying ${s.hovered.name}: click it in the list to use it.` : "Your song's first lines with your theme (no planned video yet).";
  return { patch, fallback, caption, previewing: s.hovered?.id ?? null };
}

// What Set effect shows: the song's own value; without one, the value most platforms have (after "Use for
// all my songs" the artist's brand sets it per platform with lyrics, while the default stays the library's).
function effectValuesOf(data: StyleData): EffectValues {
  const shown = (field: string): unknown => {
    const f = data.fields.find((x) => x.field === field);
    if (!f?.perPlatform?.length || f.own) return f?.value;
    const count = new Map<string, number>();
    for (const p of f.perPlatform) count.set(JSON.stringify(p.value), (count.get(JSON.stringify(p.value)) ?? 0) + 1);
    const own = JSON.stringify(f.value);
    const best = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] === own ? -1 : b[0] === own ? 1 : 0))[0][0];
    return JSON.parse(best);
  };
  return {
    verseEffect: String(shown("verseEffect") ?? "glide"),
    hookEffect: String(shown("hookEffect") ?? ""),
    breathe: (shown("breathe") as EffectValues["breathe"]) ?? "off",
    heldGlow: shown("heldGlow") === "on",
    chorusLift: shown("chorusLift") === "on",
    shine: shown("shine") === "on",
    emphasis: shown("emphasis") === "on",
  };
}

// One titled block of the tools column.
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-style-block={id} className="flex flex-col gap-2">
      <h3 className="sr-only">{title}</h3>
      {children}
    </section>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// "Tempo (BPM)" -> "Tempo", "Ending (Reels, TikTok, Shorts)" -> "Ending".
const shortLabel = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");

// The tools column's blocks, each in its order (the six font rows sit under Look's "Fine-tune"; the
// effect, Breathe and add-on settings are set in Set effect, their per-platform values under its ⋯).
const CARD_TEXT_FIELDS = ["tagline", "hookText", "endText"] as const; // This song → Card text (with the title)
const SONG_OTHER_FIELDS = ["ep", "youtubeLayout", "titleOpening"] as const;
const SONG_FIELDS = [...CARD_TEXT_FIELDS, ...SONG_OTHER_FIELDS] as const;
const LOOK_FIELDS = ["textColour", "accentColour"] as const;
const PICTURE_FIELDS = ["grade", "vignette", "textBacking", "fallback", "fallbackColour", "gradeCanvas", "titleStyle", "titleWarp", "hookCard", "hookCardStyle", "endCard", "endCardStyle", "textLayout"] as const;
const EFFECT_FIELDS = ["verseEffect", "hookEffect", "breathe", "heldGlow", "chorusLift", "shine", "emphasis"] as const;
const MAKE_FIELDS = ["platforms", "variations", "collections"] as const;
const AUTO_FIELDS = ["shotLength", "tempo", "section", "length", "ending", "transitions", "paceShift", "readability"] as const;
const RELEASE = ["reels", "tiktok", "shorts", "youtube", "canvas"];
const TOOL_SECTIONS = ["theme", "song", "make", "auto"] as const;

// A control's explanation: one line (cut with …), the whole text on hover.
function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="text-muted-foreground min-w-0 max-w-full truncate text-xs">
      {text}
    </span>
  );
}

const PLATFORMS_EMPTY = "Nothing ticked: Make release pack makes all five (Reels, TikTok, Shorts, YouTube, Canvas); More options starts with Reels + YouTube; pnpm make without --platforms makes the Standard video. Tick platforms to choose your own.";

const ENDINGS: [string, string][] = [
  ["auto", "auto (tight loop, soft fade or ring-out, chosen from the music)"],
  ["loop", "tight loop (cut on the bar)"],
  ["fade", "soft fade after the last line"],
  ["ring-out", "ring-out (one more bar, then fade)"],
];
const SHOT_LENGTHS: [string, string][] = [["auto", "auto (from the song and your clips)"], ["1", "1 bar"], ["2", "2 bars"], ["4", "4 bars"], ["8", "8 bars"], ["story", "story (2-4 bars)"], ["rate", "the cut rate (Generate's 0.5x / 1x / 2x)"]];
const TRANSITIONS: [string, string][] = [["auto", "auto (cuts, dissolves and dips chosen from the music)"], ["crisp", "crisp (cuts on the beat)"], ["flowing", "flowing (dissolves outside the hooks)"]];
const READABILITY: [string, string][] = [["auto", "auto (a soft backing when your clips are bright behind the lyrics)"], ["strong", "strong (always a soft dark band behind the lyrics)"], ["normal", "normal (never a backing)"]];
const RATIOS:[string, number][] = [["½", 1 / 2], ["×2", 2], ["×2/3", 2 / 3], ["×3/2", 3 / 2]];
const round1 = (n: number) => Math.round(n * 10) / 10;

// The song's tempo: empty = as detected. Quick fixes for the usual errors (half, double, 3:2), a tap
// test over the song (tap along on the beat) and the tempo check (the likeliest tempi). Saved in
// song.json "tempo": the beats are re-tracked around it and the storyboard plans with it.
function TempoEditor({ projectId, value, song, onSet }: { projectId: string; value: number | null; song: StyleData["song"]; onSet: (n: number | null) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [tapping, setTapping] = useState(false);
  const [check, setCheck] = useState<{ state: "idle" | "busy" | "done"; text?: string; candidates?: { bpm: number; strength: number; ratio: string | null }[]; detected?: number }>({ state: "idle" });
  const base = value ?? song.bpm ?? check.detected ?? null;
  // BPM from the taps: the median gap (one stray tap does not spoil it).
  const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
  const tapBpm = gaps.length >= 3 ? round1(60_000 / gaps[Math.floor(gaps.length / 2)]) : null;
  const tap = () => setTaps((t) => [...t.filter((x) => performance.now() - x < 12_000), performance.now()]);
  async function runCheck() {
    setCheck({ state: "busy" });
    try {
      const r = await api(`/api/songs/${projectId}/tempo`, { cache: "no-store" });
      const d = (await r.json()) as { bpm: number; candidates: { bpm: number; strength: number; ratio: string | null }[]; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setCheck({ state: "done", candidates: d.candidates, detected: d.bpm });
    } catch (e) {
      setCheck({ state: "done", text: (e as Error).message });
    }
  }
  return (
    <div data-tempo className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={`tempo-${value ?? ""}`}
          type="number"
          min={30}
          max={300}
          step={0.1}
          data-edit="tempo-default"
          className={cn(input, "w-24")}
          defaultValue={value ?? ""}
          placeholder="detected"
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => {
            const n = e.target.value ? Number(e.target.value) : null;
            if (n !== value) onSet(n);
          }}
        />
        <span className="text-muted-foreground text-xs">BPM{value === null ? (song.bpm ? ` · as detected (${round1(song.bpm)} in the last video)` : " · as detected") : " · set for this song"}</span>
        {base
          ? RATIOS.map(([label, r]) => (
              <button key={label} type="button" data-tempo-ratio={label} title={`${round1(base)} ${label} = ${round1(base * r)} BPM`} onClick={() => onSet(round1(base * r))} className="hover:bg-accent rounded-md border px-2 py-0.5 text-xs">
                {label}
              </button>
            ))
          : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {song.file ? (
          <>
            <audio ref={audio} src={`/api/files/${song.file}`} preload="none" onEnded={() => setTapping(false)} />
            <button
              type="button"
              data-tempo-tap-start
              onClick={() => {
                const a = audio.current;
                if (!a) return;
                if (tapping) {
                  a.pause();
                  setTapping(false);
                } else {
                  setTaps([]);
                  void a.play();
                  setTapping(true);
                }
              }}
              className="hover:bg-accent rounded-md border px-2 py-0.5"
            >
              {tapping ? "Stop the song" : "Tap test: play the song"}
            </button>
            <button type="button" data-tempo-tap onClick={tap} onKeyDown={(e) => e.key === " " && e.preventDefault()} className="bg-brand/20 text-brand hover:bg-brand/30 rounded-md border px-3 py-0.5">
              Tap
            </button>
            <span data-tempo-tapped className="text-muted-foreground">
              {taps.length ? `${taps.length} tap(s)` : "tap on every beat (1 tap per beat)"}
              {tapBpm ? `: ${tapBpm} BPM` : ""}
            </span>
            {tapBpm ? (
              <button type="button" data-tempo-use-tap onClick={() => onSet(tapBpm)} className="text-brand underline">
                use {tapBpm}
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" data-tempo-check disabled={check.state === "busy"} onClick={runCheck} className="hover:bg-accent rounded-md border px-2 py-0.5">
          {check.state === "busy" ? "Checking the tempo…" : "Check the tempo"}
        </button>
      </div>
      {check.state === "done" ? (
        <div data-tempo-candidates className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          {check.text ? <span className="text-red-300">{check.text}</span> : <span>Likely tempi:</span>}
          {(check.candidates ?? []).map((c) => (
            <button key={c.bpm} type="button" data-tempo-candidate={c.bpm} onClick={() => onSet(c.bpm)} className="hover:bg-accent rounded-md border px-2 py-0.5">
              {c.bpm} BPM{c.ratio === "x1" || (!c.ratio && Math.abs(c.bpm - (check.detected ?? 0)) < 1) ? " (detected)" : c.ratio ? ` (${c.ratio} the detected)` : ""} · {Math.round(c.strength * 100)}%
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const WEIGHT_NAMES: Record<number, string> = { 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "extra bold" };
// Look → Fine-tune: each font, then its weight and italic.
const FONT_ORDER = ["verseFont", "verseWeight", "verseItalic", "hookFont", "hookWeight", "hookItalic"] as const;

// A font list (bundled and your own) with a live preview line (in the chosen weight and italic: the exact
// file, never a synthetic one) and a warning when accents are missing.
function FontEditor({ fonts, value, font, look, previewLine, onChange, testId }: { fonts: StyleFont[]; value: string; font?: StyleFont; look: { weight: number; italic: boolean }; previewLine: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <select aria-label="font" data-edit={testId} className={cn(select, "w-64")} value={font?.family ?? value} onChange={(e) => onChange(e.target.value)}>
        {!font ? <option value={value}>{value} (not found)</option> : null}
        {(["bundled", "user"] as const).map((source) =>
          fonts.some((f) => f.source === source) ? (
            <optgroup key={source} label={source === "bundled" ? "Bundled" : "Your fonts (workspace\\fonts)"}>
              {fonts
                .filter((f) => f.source === source)
                .map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family}
                    {f.missing.length ? "  ⚠ no French accents" : ""}
                  </option>
                ))}
            </optgroup>
          ) : null,
        )}
      </select>
      <p data-preview={testId} className="text-lg leading-snug" style={{ fontFamily: `"${font?.family ?? value} preview", sans-serif`, fontWeight: look.weight || 400, fontStyle: look.italic ? "italic" : "normal", fontSynthesis: "none" }}>
        {previewLine}
      </p>
      {font?.missing.length ? (
        <p data-missing={testId} className="text-xs text-amber-300">
          {font.family} has no {font.missing.join(" ")}: these letters would show in another font. Pick another font for French lyrics.
        </p>
      ) : null}
    </div>
  );
}

// ---- The theme editor's draft (nothing saved until Save) ----
type Draft = { name: string; look: Record<string, unknown>; perPlatform: Record<string, Record<string, unknown>>; changed: boolean }; // name: the theme being edited

const draftOf = (t: StyleTheme): Draft => ({ name: t.name, look: { ...(t.look as Record<string, unknown>) }, perPlatform: JSON.parse(JSON.stringify(t.perPlatform ?? {})) as Draft["perPlatform"], changed: false });

// One change: the default look, or one platform's own value (null removes it: back to the theme's default).
function draftSet(d: Draft, field: string, value: unknown, platform?: string): Draft {
  if (!platform) return value === null || value === undefined ? d : { ...d, look: { ...d.look, [field]: value }, changed: true };
  const own = { ...(d.perPlatform[platform] ?? {}) };
  if (value === null || value === undefined) delete own[field];
  else own[field] = value;
  const perPlatform = { ...d.perPlatform };
  if (Object.keys(own).length) perPlatform[platform] = own;
  else delete perPlatform[platform];
  return { ...d, perPlatform, changed: true };
}

const draftFonts = (d: Draft): DraftFonts => ({
  verseFont: String(d.look.verseFont ?? ""),
  verseWeight: Number(d.look.verseWeight ?? 400),
  verseItalic: d.look.verseItalic === true,
  hookFont: String(d.look.hookFont ?? ""),
  hookWeight: Number(d.look.hookWeight ?? 400),
  hookItalic: d.look.hookItalic === true,
});

// A font pairing chosen in the editor: its six font settings into the draft.
function pickPair(d: Draft, card: PairingCard): Draft {
  return { ...d, look: { ...d.look, verseFont: card.verse.family, verseWeight: card.verse.weight, verseItalic: card.verse.italic, hookFont: card.hook.family, hookWeight: card.hook.weight, hookItalic: card.hook.italic }, changed: true };
}

// The song's settings with the draft in place of its theme's values.
function withDraft(data: StyleData, d: Draft): StyleData {
  return {
    ...data,
    fields: data.fields.map((f) => {
      if (!(f.field in d.look)) return f;
      const value = d.look[f.field];
      return {
        ...f,
        value,
        source: "theme",
        own: false,
        perPlatform:
          f.perPlatform?.map((p) => {
            const own = d.perPlatform[p.platform]?.[f.field];
            return { ...p, value: own !== undefined ? own : value, source: own !== undefined ? `theme:${p.platform}` : "theme", own: own !== undefined };
          }) ?? null,
      };
    }),
  };
}

// One titled section of the theme editor (Cards, Text, Motion, Colours, Picture: in the order a design is made).
function EditorSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-editor-section={id} className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h4>
      {children}
    </section>
  );
}

// The theme's Hook card and End card (src/extra-cards.ts): on / off and a style each, with a sample. The app
// places and times them (the pause before the first chorus; the video's last seconds), never over a lyric.
function ExtraCardControls({ value, onSet, font, hookSample, endSample }: { value: (field: string) => unknown; onSet: (field: string, value: string) => void; font: string; hookSample: string; endSample: string }) {
  const accent = String(value("accentColour") ?? "#E8A3B5");
  const colour = String(value("textColour") ?? "#FFFFFF");
  const card = (id: "hook" | "end") => {
    const on = value(`${id}Card`) === "on";
    const style = (String(value(`${id}CardStyle`) ?? (id === "end" ? "label" : "plain")) as TitleStyle) || "plain";
    const sample = id === "hook" ? hookSample.toUpperCase() : endSample;
    return (
      <div key={id} data-extra-card={id} className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
        <label className="flex items-center gap-2">
          <span className="flex-1 font-medium">{id === "hook" ? "Hook card" : "End card"}</span>
          <select data-picture-select={`${id}Card`} className="bg-background rounded-md border px-2 py-1 text-xs" value={on ? "on" : "off"} onChange={(e) => onSet(`${id}Card`, e.target.value)}>
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        {on ? (
          <>
            <div data-extra-card-sample={id} className="flex min-h-12 items-center justify-center overflow-hidden rounded bg-[#1a1418] px-2 py-2 text-center" style={{ fontFamily: `"${font} preview", serif`, color: id === "hook" ? accent : colour, fontSize: id === "hook" ? 20 : 15 }}>
              <span style={titleStyleCss(style, id === "hook" ? 20 : 15, id === "hook" ? accent : colour, accent)}>{sample}</span>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="flex-1">Style</span>
              <select data-picture-select={`${id}CardStyle`} className="bg-background rounded-md border px-2 py-1 text-xs" value={style} onChange={(e) => onSet(`${id}CardStyle`, e.target.value)}>
                {Object.entries(TITLE_STYLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {id === "hook"
            ? "Reels, TikTok, Shorts: big, in the pause just before the first chorus (the app finds it; no pause, no card). Its words: This song → Hook card text, else the chorus's first line."
            : "Reels, TikTok, Shorts: the last seconds of the video, never over a lyric. Its words: This song → End card text ({title} = the song's title)."}
        </p>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2" data-extra-cards>
      {card("hook")}
      {card("end")}
    </div>
  );
}

// Card text → Title: the song's title (the same as the page header's pencil; the song folder follows it).
function CardTitleRow({ projectId, title, onSaved }: { projectId: string; title: string; onSaved: (title: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = async (next: string) => {
    const clean = next.trim();
    if (!clean || clean === title) return;
    setError(null);
    const r = await api(`/api/songs/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: clean }) });
    const d = (await r.json().catch(() => ({}))) as { title?: string; error?: string };
    if (!r.ok || d.error) return setError(d.error ?? `The studio answered ${r.status}`);
    onSaved(d.title ?? clean);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">Title</span>
      <input
        key={title}
        data-card-title
        aria-label="Title"
        defaultValue={title}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => void save(e.target.value)}
        className="bg-input/30 border-input h-8 w-full rounded-md border px-2 text-sm"
      />
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </div>
  );
}

// A colour: the picker, plus a box to type or paste the colour reference (31 Oct 2026): "#FF2D95", "FF2D95",
// "#F29", "rgb(255, 45, 149)" or "255, 45, 149". Saved when it reads as a colour (Enter or leaving the box);
// otherwise the box says what it expects and the colour stays as it was.
function ColourField({ label, editKey, value, onSet }: { label: string; editKey: string; value: string; onSet: (colour: string) => void }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);
  const commit = () => {
    if (text.trim() === "" || text.trim().toUpperCase() === value.toUpperCase()) {
      setText(value);
      setBad(false);
      return;
    }
    const c = parseColourRef(text);
    if (!c) return setBad(true);
    setBad(false);
    setText(c);
    if (c !== value.toUpperCase()) onSet(c);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="color" aria-label={label} data-edit={editKey} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#FFFFFF"} onChange={(e) => onSet(e.target.value.toUpperCase())} className="h-8 w-12 rounded border bg-transparent" />
      <input
        type="text"
        aria-label={`${label} code`}
        data-edit-code={editKey}
        value={text}
        spellCheck={false}
        placeholder="#FF2D95"
        title="Type or paste a colour: #FF2D95, FF2D95, #F29, rgb(255, 45, 149) or 255, 45, 149. Press Enter."
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setText(value);
            setBad(false);
          }
        }}
        className={cn("h-8 w-36 rounded border bg-transparent px-2 font-mono text-xs uppercase tabular-nums", bad && "border-destructive")}
      />
      {bad ? (
        <span data-colour-bad className="text-destructive basis-full text-xs">
          Not a colour yet: type #FF2D95 or 255, 45, 149.
        </span>
      ) : null}
    </div>
  );
}

// Five colours from the song's cover, as accent suggestions (read in the browser from a small copy).
// The title card's style and shape (src/picture.ts), with a sample of the title drawn that way.
function TitleStyleControls({ value, onSet, sample, font }: { value: (field: string) => unknown; onSet: (field: string, value: string) => void; sample: string; font: string }) {
  const style = (String(value("titleStyle") ?? "plain") as TitleStyle) || "plain";
  const warp = (String(value("titleWarp") ?? "none") as TitleWarp) || "none";
  const accent = String(value("accentColour") ?? "#E8A3B5");
  const colour = String(value("textColour") ?? "#FFFFFF");
  const letters = [...sample];
  return (
    <div data-title-style-controls className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
      <span className="font-medium">Title</span>
      <div data-title-sample className="flex min-h-16 items-center justify-center overflow-hidden rounded bg-[#1a1418] px-2 py-3 text-center text-2xl" style={{ fontFamily: `"${font} preview", serif`, color: colour }}>
        <span style={titleStyleCss(style, 24, colour, accent)}>
          {warp === "none"
            ? sample
            : letters.map((ch, k) => {
                const w = warpLetter(warp, k, letters.length, 24);
                return (
                  <span key={k} style={{ display: "inline-block", whiteSpace: "pre", transform: `translateY(${w.y.toFixed(1)}px) rotate(${w.rotate.toFixed(1)}deg)` }}>
                    {ch}
                  </span>
                );
              })}
        </span>
      </div>
      {(
        [
          ["titleStyle", "Style", TITLE_STYLE_LABELS],
          ["titleWarp", "Shape", TITLE_WARP_LABELS],
        ] as const
      ).map(([field, label, options]) => (
        <label key={field} className="flex items-center gap-2 text-xs">
          <span className="flex-1">{label}</span>
          <select data-picture-select={field} className="bg-background rounded-md border px-2 py-1 text-xs" value={String(value(field) ?? "")} onChange={(e) => onSet(field, e.target.value)}>
            {Object.entries(options).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="text-muted-foreground text-xs">For the song title: the YouTube video and, with the title opening on, Reels, TikTok and Shorts.</p>
    </div>
  );
}

// The theme's text layout (src/text-layout.ts): three small frames showing where the lyrics sit; the viewer
// shows a click at once, Save keeps it. The app keeps every layout inside the platform's safe zones.
function TextLayoutControls({ value, onSet }: { value: (field: string) => unknown; onSet: (field: string, value: string) => void }) {
  const current = isTextLayout(value("textLayout")) ? (value("textLayout") as TextLayout) : "centre";
  return (
    <div data-text-layout-controls className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
      <span className="font-medium">Text layout</span>
      <div className="grid grid-cols-3 gap-2">
        {TEXT_LAYOUTS.map((l) => (
          <button key={l} type="button" data-text-layout={l} aria-pressed={current === l} title={TEXT_LAYOUT_HINTS[l]} onClick={() => onSet("textLayout", l)} className={cn("flex flex-col items-center gap-1 rounded-md border p-1.5 text-[11px]", current === l ? "border-brand bg-brand/10" : "hover:border-foreground/40")}>
            <span aria-hidden className="relative block h-16 w-9 overflow-hidden rounded-sm bg-[#2a2328]">
              {l === "bighook" ? (
                <>
                  <span className="absolute inset-x-1.5 top-[34%] h-[3px] rounded bg-white/70" />
                  <span className="bg-brand absolute inset-x-0.5 top-[44%] h-[6px] rounded" />
                </>
              ) : (
                <>
                  <span className={cn("absolute inset-x-1.5 h-[3px] rounded bg-white/80", l === "lower" ? "top-[62%]" : "top-[38%]")} />
                  <span className={cn("absolute inset-x-2.5 h-[3px] rounded bg-white/60", l === "lower" ? "top-[70%]" : "top-[46%]")} />
                </>
              )}
            </span>
            {TEXT_LAYOUT_LABELS[l]}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{TEXT_LAYOUT_HINTS[current]}. The app keeps the words clear of each platform&apos;s buttons.</p>
    </div>
  );
}

// The theme's picture (src/picture.ts): chips per setting; the viewer shows each click, Save keeps it.
function PictureControls({ value, onSet }: { value: (field: string) => unknown; onSet: (field: string, value: string) => void }) {
  const groups: { field: string; label: string; hint: string; options: Record<string, string> }[] = [
    { field: "grade", label: "Colour grade", hint: "One look on every clip, so mixed footage feels like one film. Your clips themselves are never changed.", options: GRADE_LABELS },
    { field: "vignette", label: "Vignette", hint: "Darker edges draw the eye to the middle.", options: VIGNETTE_LABELS },
    { field: "textBacking", label: "Behind the words", hint: "The app still adds a soft band by itself when a clip is too bright to read the lyrics.", options: BACKING_LABELS },
    { field: "fallback", label: "Background without a clip", hint: "For a song without clips, or a slot waiting for one.", options: FALLBACK_LABELS },
  ];
  return (
    <div data-picture className="flex flex-col gap-2">
      {groups.map((g) => (
        <label key={g.field} data-picture-group={g.field} title={g.hint} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="flex-1 font-medium">{g.label}</span>
          <select data-picture-select={g.field} className="bg-background rounded-md border px-2 py-1 text-xs" value={String(value(g.field) ?? "")} onChange={(e) => onSet(g.field, e.target.value)}>
            {Object.entries(g.options).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label data-picture-group="gradeCanvas" className="bg-card flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2.5 text-sm">
        <input type="checkbox" data-picture-option="gradeCanvas" checked={value("gradeCanvas") !== "off"} onChange={(e) => onSet("gradeCanvas", e.target.checked ? "on" : "off")} />
        Grade the Spotify Canvas too
        <span className="text-muted-foreground basis-full pl-5 text-xs">Off: the Canvas keeps the clips&apos; own colours.</span>
      </label>
    </div>
  );
}

function CoverColours({ cover, current, onPick }: { cover: string | null; current: string; onPick: (colour: string) => void }) {
  const [colours, setColours] = useState<string[]>([]);
  useEffect(() => {
    if (!cover) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d");
      if (!ctx || !alive) return;
      ctx.drawImage(img, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      const buckets = new Map<string, { n: number; r: number; g: number; b: number; s: number }>();
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 40 || min > 225) continue; // too dark or too pale for lyrics
        const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
        const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
        buckets.set(key, { n: e.n + 1, r: e.r + r, g: e.g + g, b: e.b + b, s: e.s + (max - min) });
      }
      const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
      const best = [...buckets.values()]
        .sort((a, b) => b.n * (1 + b.s / b.n / 128) - a.n * (1 + a.s / a.n / 128))
        .slice(0, 5)
        .map((e) => `#${hex(e.r / e.n)}${hex(e.g / e.n)}${hex(e.b / e.n)}`.toUpperCase());
      setColours(best);
    };
    img.src = `/api/files/${cover}`;
    return () => {
      alive = false;
    };
  }, [cover]);
  if (!cover) return <p className="text-muted-foreground text-xs">Add a cover (Prepare → Assets) to get colours from it.</p>;
  if (!colours.length) return null;
  return (
    <div data-cover-colours className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">From your cover:</span>
      {colours.map((c) => (
        <button key={c} type="button" data-cover-colour={c} title={`Use ${c} as the accent`} aria-pressed={c === current.toUpperCase()} onClick={() => onPick(c)} className={cn("size-6 rounded-full border", c === current.toUpperCase() && "ring-brand ring-2")} style={{ background: c }} />
      ))}
    </div>
  );
}
