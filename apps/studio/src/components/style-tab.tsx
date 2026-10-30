"use client";

import { ChevronDown, Lock, LockOpen, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { StyleData, StyleField, StyleFont } from "@lyric/video/style";

import { EffectPreview } from "@/components/effect-preview";
import { PairingsRow } from "@/components/pairings-row";

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
  if (level === "artist") return `Artist's brand${name}`;
  if (level === "platforms.json") return "Platform preset";
  if (level === "run") return "This run";
  return "Library default";
}

const show = (v: unknown) => (v === null ? "preset" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : v && typeof v === "object" ? Object.entries(v).map(([k, n]) => `${k === "*" ? "every platform" : k} ${n}`).join(", ") || "each platform's preset" : String(v ?? ""));

// The song's recipe (song.json): every setting with its value and where it comes from; per platform
// for the effects, fonts, accent colour and section. Changes are saved to song.json at once.
// Four blocks: This song, Look (creative choices), What to make, Automatic (folded: the app handles
// these). A row shows only what matters: the "This song" badge (other sources are the label's tooltip),
// the padlock when locked (else on hover / focus), "per platform" when a platform differs (else on hover).
export function StyleTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<StyleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [fineTune, setFineTune] = useState(false); // Look: the six font rows under the font summary
  const [autoOpen, setAutoOpen] = useState(false); // the Automatic block, folded by default
  const [previewNote, setPreviewNote] = useState("");
  const [justSaved, setJustSaved] = useState<string[]>([]); // rows the preview just saved: highlighted for a few seconds
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(justSavedTimer.current), []);
  // Changes are saved one after the other, in the order they were made: leaving a field (which saves
  // it) and clicking a padlock right after must both count; nothing is disabled while saving.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/recipe`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StyleData & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  function act(body: { action: "set" | "reset" | "lock" | "unlock" | "brand"; field: string; platform?: string; value?: unknown }) {
    // The padlock shows its new state at once (the save follows).
    if (body.action === "lock" || body.action === "unlock") {
      setData((d) => (d ? { ...d, fields: d.fields.map((f) => (f.field === body.field ? { ...f, locked: body.action === "lock" } : f)) } : d));
    }
    pending.current += 1;
    setSaving("saving");
    setError(null);
    let ok = false;
    queue.current = queue.current.then(async () => {
      try {
        const r = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = (await r.json()) as StyleData & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        setData(d);
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
          router.refresh(); // Generate starts from the recipe
        }
      }
    });
    return queue.current.then(() => ok);
  }

  // @font-face rules for the preview line (each font loads only when it is shown).
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
    router.refresh();
  }

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
    if (f.field === "accentColour") {
      return (
        <div className="flex items-center gap-2">
          <input type="color" aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} value={String(value)} onChange={(e) => set(e.target.value.toUpperCase())} className="h-8 w-12 rounded border bg-transparent" />
          <span className="text-muted-foreground text-xs tabular-nums">{String(value)}</span>
        </div>
      );
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
    if (f.field === "heldGlow" || f.field === "chorusLift" || f.field === "shine") {
      const what = {
        heldGlow: "a word sung for about a second or longer brightens in your accent colour while it is held",
        chorusLift: "the first line of each chorus arrives a touch bigger and brighter, then eases back",
        shine: "one soft light sweep across each chorus line, on a downbeat",
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
            <BrandAll field={f.field} value={String(value ?? "off")} onApply={(v) => act({ action: "brand", field: f.field, value: v })} />
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
          {!platform ? <BrandAll field={f.field} value={String(value ?? "off")} onApply={(v) => act({ action: "brand", field: f.field, value: v })} /> : null}
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
            <BrandAll field={f.field} value={String(value ?? "off")} onApply={(v) => act({ action: "brand", field: f.field, value: v })} />
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
          {!platform ? <BrandAll field={f.field} value={String(value ?? "off")} onApply={(v) => act({ action: "brand", field: f.field, value: v })} /> : null}
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
        placeholder={f.field === "section" ? "auto, full or 0:11-1:10" : ""}
       
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => e.target.value.trim() !== String(value ?? "") && set(e.target.value.trim())}
      />
    );
  };

  const byField = new Map(data.fields.map((f) => [f.field, f] as const));
  const pick = (names: readonly string[]) => names.map((n) => byField.get(n as StyleField["field"])).filter((f): f is StyleField => !!f);
  // Any setting not named in a block (a future one) lands in "This song".
  const placed = new Set<string>([...SONG_FIELDS, ...LOOK_FIELDS, ...FONT_ORDER, ...MAKE_FIELDS, ...AUTO_FIELDS]);
  const songFields = [...pick(SONG_FIELDS), ...data.fields.filter((f) => !placed.has(f.field))];
  const fontFields = pick(FONT_ORDER);
  const autoFields = pick(AUTO_FIELDS);
  // "Set by you": the song's own value (default or one platform) or a lock.
  const setByYou = autoFields.filter((f) => f.own || f.locked || (f.perPlatform ?? []).some((p) => p.own));
  const fontsOwn = fontFields.some((f) => f.own || (f.perPlatform ?? []).some((p) => p.own));
  const face = (role: "verse" | "hook") => `${String(valueOf(`${role}Font`))} ${String(valueOf(`${role}Weight`))}${valueOf(`${role}Italic`) === true ? " italic" : ""}`;

  const row = (f: StyleField) => {
    const differsPerPlatform = !!f.perPlatform?.some((p) => JSON.stringify(p.value) !== JSON.stringify(f.value));
    return (
      <li
        key={f.field}
        data-field={f.field}
        data-just-saved={justSaved.includes(f.field) ? "" : undefined}
        className={cn("group bg-card rounded-lg border px-4 py-3 transition-shadow", f.locked && "border-brand/40", justSaved.includes(f.field) && "border-brand ring-brand/60 ring-2")}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-44 text-sm font-medium" title={f.own ? undefined : `From: ${sourceLabel(f.source, data.platforms)}`} data-source-hint={f.own ? undefined : sourceLabel(f.source, data.platforms)}>
            {f.label}
            {justSaved.includes(f.field) ? (
              <span data-saved-tag className="text-brand ml-2 text-xs font-normal">
                ✓ Saved
              </span>
            ) : null}
          </span>
          <div className="min-w-0 flex-1">{editor(f, f.value)}</div>
          {f.own ? (
            <span data-source className="border-brand/40 text-brand rounded-full border px-2 py-0.5 text-xs">
              {sourceLabel(f.source, data.platforms)}
            </span>
          ) : null}
          <div className="flex items-center gap-1">
            {f.perPlatform && !differsPerPlatform ? (
              <button
                type="button"
                data-per-platform={f.field}
                aria-expanded={!!open[f.field]}
                onClick={() => setOpen((o) => ({ ...o, [f.field]: !o[f.field] }))}
                className={cn("text-muted-foreground hover:text-foreground px-1 text-xs underline underline-offset-2 transition-opacity focus:opacity-100", open[f.field] ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}
              >
                per platform
              </button>
            ) : null}
            {f.own && !f.locked ? (
              <button type="button" data-reset={f.field} title="Back to the inherited value" onClick={() => act({ action: "reset", field: f.field })} className="text-muted-foreground hover:text-foreground rounded p-1">
                <RotateCcw className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              data-lock={f.field}
              aria-pressed={f.locked}
              title={f.locked ? "Locked: click to unlock" : "Lock: keep this song's value"}
              onClick={() => act({ action: f.locked ? "unlock" : "lock", field: f.field })}
              className={cn("rounded p-1 transition-opacity", f.locked ? "text-brand" : "text-muted-foreground hover:text-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus:opacity-100")}
            >
              {f.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            </button>
          </div>
        </div>
        {f.perPlatform && (differsPerPlatform || open[f.field]) ? (
          <div className="mt-2">
            {differsPerPlatform ? (
              <button type="button" data-per-platform={f.field} aria-expanded={!!open[f.field]} onClick={() => setOpen((o) => ({ ...o, [f.field]: !o[f.field] }))} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
                <ChevronDown className={cn("size-3 transition-transform", open[f.field] && "rotate-180")} />
                Per platform
                <span className="text-brand"> · {f.perPlatform.filter((p) => JSON.stringify(p.value) !== JSON.stringify(f.value)).map((p) => `${p.label}: ${show(p.value)}`).join(" · ")}</span>
              </button>
            ) : null}
            {open[f.field] ? (
              <ul className="mt-2 flex flex-col gap-2 border-l pl-4">
                {f.perPlatform.map((p) => (
                  <li key={p.platform} data-platform-value={`${f.field}-${p.platform}`} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="w-24 text-xs" title={p.own ? undefined : `From: ${sourceLabel(p.source, data.platforms)}`}>
                      {p.label}
                    </span>
                    <div className="min-w-0 flex-1">{editor(f, p.value, p.platform)}</div>
                    {p.own ? (
                      <span data-source className="border-brand/40 text-brand rounded-full border px-2 py-0.5 text-xs">
                        {sourceLabel(p.source, data.platforms)}
                      </span>
                    ) : null}
                    {p.own ? (
                      <button type="button" data-reset={`${f.field}-${p.platform}`} title="Back to the song's default" onClick={() => act({ action: "reset", field: f.field, platform: p.platform })} className="text-muted-foreground hover:text-foreground rounded p-1">
                        <RotateCcw className="size-4" />
                      </button>
                    ) : (
                      <span className="w-6" />
                    )}
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

  return (
    <div data-style className="flex flex-col gap-4">
      <style>{fontCss}</style>
      <p
        className="text-muted-foreground truncate text-xs"
        title={`This song's recipe (${data.recipeFile?.split("/").pop()}). A setting comes from the library defaults, the artist's brand (${data.brandFile.split("/").join("\\")}) or this song; a change here is saved for this song at once. A locked setting keeps this song's value: a brand change does not reach it and Generate cannot change it for one run.`}
      >
        This song&apos;s recipe ({data.recipeFile?.split("/").pop()}). A setting comes from the library defaults, the artist&apos;s brand ({data.brandFile.split("/").join("\\")}) or this song; a change here is saved for this song at once. A
        locked setting keeps this song&apos;s value: a brand change does not reach it and Generate cannot change it for one run.
      </p>
      <p data-saving={saving} className="text-muted-foreground h-4 text-xs" aria-live="polite">
        {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved to song.json" : ""}
      </p>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <Block id="song" title="This song" subtitle="Words and layout that belong to this song only.">
        {rows(songFields)}
      </Block>

      <Block id="look" title="Look" subtitle="Your creative choices: fonts, lyric effects and colour.">
        <PairingsRow projectId={projectId} onChanged={reload} />
        <div data-font-summary className="group bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3">
          <span className="min-w-0 flex-1 text-sm" data-font-summary-text>
            Fonts: verses {face("verse")} · choruses {face("hook")}
          </span>
          {fontsOwn ? <span data-source className="border-brand/40 text-brand rounded-full border px-2 py-0.5 text-xs">This song</span> : null}
          <button type="button" data-fine-tune aria-expanded={fineTune} onClick={() => setFineTune((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline underline-offset-2">
            <ChevronDown className={cn("size-3 transition-transform", fineTune && "rotate-180")} />
            Fine-tune
          </button>
        </div>
        {fineTune ? (
          <div data-fine-tune-rows className="flex flex-col gap-2 border-l pl-4">
            {rows(fontFields)}
            <p data-user-fonts className="text-muted-foreground truncate text-xs" title={`Your own fonts: put .ttf, .otf, .woff or .woff2 files in ${data.userFonts}; they appear in the font lists after reloading this page.`}>
              Your own fonts: put .ttf, .otf, .woff or .woff2 files in <span className="text-foreground font-mono">{data.userFonts}</span>; they appear in the font lists after reloading this page.
            </p>
          </div>
        ) : null}
        <EffectPreview
          key={["verseEffect", "breathe", "heldGlow", "chorusLift", "shine"].map((k) => String(valueOf(k) ?? "")).join(":")}
          projectId={projectId}
          effects={data.effects}
          lines={data.sampleLines}
          initial={String(valueOf("verseEffect") ?? "glide")}
          hookInitial={String(valueOf("hookEffect") ?? "")}
          breathe={(valueOf("breathe") as "off" | "gentle" | "beat") ?? "off"}
          addOns={{ heldGlow: valueOf("heldGlow") === "on", chorusLift: valueOf("chorusLift") === "on", shine: valueOf("shine") === "on" }}
          font={String(valueOf("verseFont") ?? "Cormorant Garamond")}
          weight={Number(valueOf("verseWeight") ?? 400)}
          italic={valueOf("verseItalic") === true}
          accent={String(valueOf("accentColour") ?? "#E8A3B5")}
          locked={data.fields.filter((f) => f.locked).map((f) => f.field)}
          note={previewNote}
          labels={Object.fromEntries(data.fields.map((f) => [f.field, f.label]))}
          onSave={async (changes, keptLocked) => {
            const done = await Promise.all(changes.map((c) => act({ action: "set", field: c.field, value: c.value })));
            const saved = changes.filter((_, i) => done[i]);
            const nameOf = (field: string) => data.fields.find((f) => f.field === field)?.label ?? field;
            setPreviewNote(
              `${saved.length ? `Saved to the recipe: ${saved.map((c) => `${nameOf(c.field)} = ${c.shown}`).join(", ")}.` : "Nothing was saved."}${keptLocked.length ? ` Locked, kept: ${keptLocked.map(nameOf).join(", ")}.` : ""}`,
            );
            setJustSaved(saved.map((c) => c.field));
            clearTimeout(justSavedTimer.current);
            justSavedTimer.current = setTimeout(() => setJustSaved([]), 4000);
          }}
        />
        {rows(pick(LOOK_FIELDS))}
      </Block>

      <Block id="make" title="What to make" subtitle="Which videos Generate makes, and the clips it may use.">
        {rows(pick(MAKE_FIELDS))}
      </Block>

      <Block id="auto" title="Automatic — the app handles these" subtitle="Professional defaults chosen from the music and your clips; set one only to override the app.">
        <button type="button" data-auto-toggle aria-expanded={autoOpen} onClick={() => setAutoOpen((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm">
          <ChevronDown className={cn("size-4 transition-transform", autoOpen && "rotate-180")} />
          <span data-auto-summary>{setByYou.length ? `${setByYou.length} set by you: ${setByYou.map((f) => shortLabel(f.label)).join(", ")}` : "All automatic"}</span>
        </button>
        {autoOpen ? rows(autoFields) : null}
      </Block>
    </div>
  );
}

// One titled block of the Style tab.
function Block({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section data-style-block={id} className="flex flex-col gap-2">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

// "Tempo (BPM)" -> "Tempo", "Ending (Reels, TikTok, Shorts)" -> "Ending".
const shortLabel = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");

// The Style tab's blocks, each in its order (the six font rows sit under Look's "Fine-tune").
const SONG_FIELDS = ["tagline", "ep", "youtubeLayout", "titleOpening"] as const;
const LOOK_FIELDS = ["accentColour", "verseEffect", "hookEffect", "breathe", "heldGlow", "chorusLift", "shine"] as const;
const MAKE_FIELDS = ["platforms", "variations", "collections"] as const;
const AUTO_FIELDS = ["shotLength", "tempo", "section", "length", "ending", "transitions", "paceShift", "readability"] as const;

// A control's explanation: one line (cut with …), the whole text on hover.
function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="text-muted-foreground min-w-0 max-w-full truncate text-xs">
      {text}
    </span>
  );
}

const PLATFORMS_EMPTY = "Nothing ticked: Make release pack makes all five (Reels, TikTok, Shorts, YouTube, Canvas); More options starts with Reels + YouTube; pnpm make without --platforms makes the Standard video. Tick platforms to choose your own.";

// "Use for all my songs": this value in the artist's brand.json (every platform with lyrics); asks first.
function BrandAll({ field, value, onApply }: { field: string; value: string; onApply: (value: string) => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" data-brand-all={field} onClick={() => setAsking(true)} className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
        Use for all my songs
      </button>
    );
  return (
    <span className="flex items-center gap-2 text-xs" data-brand-all-ask={field}>
      Set “{value}” for every song of this artist?
      <button type="button" data-brand-all-yes={field} className="text-brand underline underline-offset-2" onClick={() => (setAsking(false), onApply(value))}>
        Yes
      </button>
      <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

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
