"use client";

import { ChevronDown, Lock, LockOpen, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { StyleData, StyleField, StyleFont } from "@lyric/video/style";

import { cn } from "@/lib/utils";

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
export function StyleTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<StyleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    fetch(`/api/songs/${projectId}/recipe`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StyleData & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function act(body: { action: "set" | "reset" | "lock" | "unlock"; field: string; platform?: string; value?: unknown }) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as StyleData & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      router.refresh(); // Generate starts from the recipe
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // @font-face rules for the preview line (each font loads only when it is shown).
  const fontCss = useMemo(
    () =>
      (data?.fonts ?? [])
        .flatMap((f) => f.faces.flatMap((face) => face.srcs.map((src) => `@font-face{font-family:"${f.family} preview";src:url("/api/fonts/${src}");font-weight:${face.weight};font-style:${face.style};}`)))
        .join("\n"),
    [data?.fonts],
  );

  if (error && !data) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading the song&apos;s recipe…</p>;
  if (!data.folder) {
    return <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">This song still uses the old folders. Migrate it first (Library → Migrate); then its recipe shows here.</p>;
  }

  const editor = (f: StyleField, value: unknown, platform?: string) => {
    const set = (v: unknown) => act({ action: "set", field: f.field, platform, value: v });
    const key = `${f.field}-${platform ?? "default"}`;
    if (f.field === "verseEffect" || f.field === "hookEffect") {
      const [name, intensity = "balanced"] = String(value).split(":");
      const join = (n: string, i: string) => (i === "balanced" ? n : `${n}:${i}`);
      return (
        <div className="flex gap-2">
          <select aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} className={select} value={name} disabled={busy} onChange={(e) => set(join(e.target.value, intensity))}>
            {data.effects.map((e) => (
              <option key={e.name} value={e.name}>
                {e.label}
                {(f.field === "verseEffect" ? data.brandDefaults.verseEffect : data.brandDefaults.hookEffect).split(":")[0] === e.name ? " · brand default" : ""}
              </option>
            ))}
          </select>
          <select aria-label={`${f.label} intensity ${platform ?? ""}`} className={select} value={intensity} disabled={busy} onChange={(e) => set(join(name, e.target.value))}>
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
      const font = data.fonts.find((x) => x.family.toLowerCase() === String(value).toLowerCase());
      return <FontEditor fonts={data.fonts} value={String(value)} font={font} previewLine={data.previewLine} disabled={busy} onChange={set} testId={key} />;
    }
    if (f.field === "accentColour") {
      return (
        <div className="flex items-center gap-2">
          <input type="color" aria-label={`${f.label} ${platform ?? ""}`} data-edit={key} value={String(value)} disabled={busy} onChange={(e) => set(e.target.value.toUpperCase())} className="h-8 w-12 rounded border bg-transparent" />
          <span className="text-muted-foreground text-xs tabular-nums">{String(value)}</span>
        </div>
      );
    }
    if (f.field === "collections" || f.field === "platforms") {
      const all = f.field === "collections" ? data.collections : data.platforms.map((p) => p.name);
      const list = (value as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {all.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" data-edit={`${key}-${c}`} checked={list.includes(c)} disabled={busy} onChange={(e) => set(e.target.checked ? [...list, c] : list.filter((x) => x !== c))} />
              {f.field === "platforms" ? (data.platforms.find((p) => p.name === c)?.label ?? c) : c}
            </label>
          ))}
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
                placeholder="preset"
                key={`${p.name}-${v[p.name] ?? ""}`}
                defaultValue={v[p.name] ?? ""}
                disabled={busy}
                className={cn(input, "w-16")}
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
            disabled={busy}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const n = e.target.value ? Number(e.target.value) : null;
              if (n === (value ?? null)) return;
              if (n === null) act({ action: "reset", field: f.field, platform });
              else set(n);
            }}
          />
          <span className="text-muted-foreground text-xs">s · empty = {preset}; shapes an &quot;auto&quot; section only</span>
        </div>
      );
    }
    if (f.field === "youtubeLayout") {
      return (
        <select aria-label={f.label} data-edit={key} className={select} value={String(value)} disabled={busy} onChange={(e) => set(e.target.value)}>
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
        disabled={busy}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => e.target.value.trim() !== String(value ?? "") && set(e.target.value.trim())}
      />
    );
  };

  return (
    <div data-style className="flex flex-col gap-4">
      <style>{fontCss}</style>
      <p className="text-muted-foreground text-xs">
        This song&apos;s recipe ({data.recipeFile?.split("/").pop()}). A setting comes from the library defaults, the artist&apos;s brand ({data.brandFile.split("/").join("\\")}) or this song; a change here is saved for this song at once. A
        locked setting keeps this song&apos;s value: a brand change does not reach it and Generate cannot change it for one run.
      </p>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {data.fields.map((f) => (
          <li key={f.field} data-field={f.field} className={cn("bg-card rounded-lg border px-4 py-3", f.locked && "border-brand/40")}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="w-44 text-sm font-medium">{f.label}</span>
              <div className="min-w-0 flex-1">{editor(f, f.value)}</div>
              <span data-source className={cn("rounded-full border px-2 py-0.5 text-xs", f.own ? "border-brand/40 text-brand" : "text-muted-foreground")}>
                {sourceLabel(f.source, data.platforms)}
              </span>
              <div className="flex items-center gap-1">
                {f.own && !f.locked ? (
                  <button type="button" data-reset={f.field} title="Back to the inherited value" disabled={busy} onClick={() => act({ action: "reset", field: f.field })} className="text-muted-foreground hover:text-foreground rounded p-1">
                    <RotateCcw className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-lock={f.field}
                  aria-pressed={f.locked}
                  title={f.locked ? "Locked: click to unlock" : "Lock: keep this song's value"}
                  disabled={busy}
                  onClick={() => act({ action: f.locked ? "unlock" : "lock", field: f.field })}
                  className={cn("rounded p-1", f.locked ? "text-brand" : "text-muted-foreground hover:text-foreground")}
                >
                  {f.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
                </button>
              </div>
            </div>
            {f.perPlatform ? (
              <div className="mt-2">
                <button type="button" data-per-platform={f.field} onClick={() => setOpen((o) => ({ ...o, [f.field]: !o[f.field] }))} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
                  <ChevronDown className={cn("size-3 transition-transform", open[f.field] && "rotate-180")} />
                  Per platform
                  {f.perPlatform.some((p) => JSON.stringify(p.value) !== JSON.stringify(f.value)) ? (
                    <span className="text-brand"> · {f.perPlatform.filter((p) => JSON.stringify(p.value) !== JSON.stringify(f.value)).map((p) => `${p.label}: ${show(p.value)}`).join(" · ")}</span>
                  ) : (
                    <span> · the same on every platform</span>
                  )}
                </button>
                {open[f.field] ? (
                  <ul className="mt-2 flex flex-col gap-2 border-l pl-4">
                    {f.perPlatform.map((p) => (
                      <li key={p.platform} data-platform-value={`${f.field}-${p.platform}`} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="w-24 text-xs">{p.label}</span>
                        <div className="min-w-0 flex-1">{editor(f, p.value, p.platform)}</div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs", p.own ? "border-brand/40 text-brand" : "text-muted-foreground")}>{sourceLabel(p.source, data.platforms)}</span>
                        {p.own ? (
                          <button type="button" data-reset={`${f.field}-${p.platform}`} title="Back to the song's default" disabled={busy} onClick={() => act({ action: "reset", field: f.field, platform: p.platform })} className="text-muted-foreground hover:text-foreground rounded p-1">
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
        ))}
      </ul>
    </div>
  );
}

// A font list (bundled and your own) with a live preview line and a warning when accents are missing.
function FontEditor({ fonts, value, font, previewLine, disabled, onChange, testId }: { fonts: StyleFont[]; value: string; font?: StyleFont; previewLine: string; disabled: boolean; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <select aria-label="font" data-edit={testId} className={cn(select, "w-64")} value={font?.family ?? value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
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
      <p data-preview={testId} className="text-lg leading-snug" style={{ fontFamily: `"${font?.family ?? value} preview", sans-serif` }}>
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
