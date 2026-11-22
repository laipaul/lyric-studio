"use client";

// Set effect (Shape, Look): the only place the song's lyric effects are set. A Verses / Choruses switch
// says which part the effect chips and the intensity (the typing pace for the typewriters) apply to;
// Breathe and the three add-ons are song-wide. Every click goes into the theme editor's draft (the viewer shows
// it straight away and the video is planned again); locked settings are greyed out with a padlock. The ⋯
// menu: "Use Breathe and add-ons for all my songs" (the artist's brand, asks first) and the per-platform
// values.
import { EFFECT_CATEGORIES, EFFECT_KINDS, effectTitle, intensityStrength, type Intensity } from "@lyric/video";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";

import { RowMenu } from "@/components/row-menu";
import { cn } from "@/lib/utils";

export type EffectPart = "verse" | "hook";
export type EffectValues = { verseEffect: string; hookEffect: string; breathe: "off" | "gentle" | "beat"; heldGlow: boolean; chorusLift: boolean; shine: boolean; emphasis: boolean };
type Field = "verseEffect" | "hookEffect" | "breathe" | "heldGlow" | "chorusLift" | "shine" | "emphasis";

const ADD_ONS = [
  ["heldGlow", "Held-note glow", "a word sung for about a second or longer brightens in your accent colour while it is held"],
  ["chorusLift", "Chorus lift", "the first line of each chorus arrives a touch bigger and brighter, then eases back"],
  ["shine", "Shine", "one soft light sweep across each chorus line, on a downbeat"],
  ["emphasis", "Emphasis word", "the key word of each line (the longest held) in the hook font, bigger and in the accent colour"],
] as const;
const join = (name: string, i: string) => (i === "balanced" ? name : `${name}:${i}`);
// The Strength slider's value of a saved effect ("glide", "glide:subtle", "glide:70").
const strengthOf = (raw: string) => (/^\d{1,3}$/.test(raw) ? Math.min(100, Number(raw)) : intensityStrength((["subtle", "balanced", "expressive"].includes(raw) ? raw : "balanced") as Intensity));
const paceWord = (i: string) => (i === "subtle" ? "calm" : i === "balanced" ? "normal" : "quick");
const intensityWord = (i: string) => (i === "subtle" ? "soft" : i === "expressive" ? "strong" : "balanced");
const isTyper = (n: string) => n.startsWith("typewriter") && n !== "typewriter-words";
export const effectWords = (saved: string) => {
  const [n, i = "balanced"] = saved.split(":");
  if (/^\d{1,3}$/.test(i)) return `${effectTitle(n)} (${i}%)`;
  return i === "balanced" ? effectTitle(n) : `${effectTitle(n)} (${isTyper(n) ? paceWord(i) : intensityWord(i)})`;
};

export function SetEffect({
  effects,
  values,
  part,
  setPart,
  locked,
  saved,
  onSet,
  onBrandAll,
  perPlatformOpen,
  perPlatformHidden,
  onPerPlatform,
  onTry,
}: {
  effects: { name: string; label: string }[];
  values: EffectValues;
  part: EffectPart;
  setPart: (p: EffectPart) => void;
  locked: string[];
  saved: boolean; // "✓ Saved" for a few seconds after a change
  onSet: (field: Field, value: string) => void;
  onBrandAll?: () => void; // themes: absent (a theme is shared by choosing it for other songs)
  perPlatformOpen: boolean;
  perPlatformHidden?: boolean; // theme editor, "Same look on every platform" on: no Per platform… here
  onPerPlatform: () => void;
  onTry?: (field: Field, value: string | null) => void; // a tile under the pointer: the big viewer plays it (null: back)
}) {
  const [asking, setAsking] = useState(false);
  const [gallery, setGallery] = useState(false); // the effect gallery under the picker
  const [kind, setKind] = useState<"All" | (typeof EFFECT_KINDS)[number]>("All");
  const [search, setSearch] = useState(""); // the gallery's search box: part of an effect's name
  const [pinned, setPinned] = useState<string | null>(null); // the effect first in the gallery: the one in use when it opened (clicks never reorder it under the pointer)
  const field = part === "verse" ? "verseEffect" : "hookEffect";
  const [name, intensity = "balanced"] = (values[field] || values.verseEffect).split(":");
  const effectLocked = locked.includes(field);
  const pace = isTyper(name);
  const select = "bg-background rounded-md border px-2 py-1 text-xs disabled:opacity-50";
  const lockIcon = (f: string) => (locked.includes(f) ? <Lock className="text-brand size-3" aria-label="locked" /> : null);
  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-3 text-sm" data-effect-preview data-set-effect>
      <div className="flex items-center gap-2">
        <p className="font-medium">Set effect</p>
        {saved ? (
          <span data-effect-saved className="text-brand text-xs">
            ✓ Saved
          </span>
        ) : null}
        <div role="radiogroup" aria-label="Which part" className="ml-auto flex rounded-md border p-0.5 text-xs" data-effect-part={part}>
          {(
            [
              ["verse", "Verses"],
              ["hook", "Choruses"],
            ] as const
          ).map(([p, label]) => (
            <button key={p} type="button" role="radio" aria-checked={part === p} data-part={p} onClick={() => setPart(p)} className={cn("rounded px-2 py-0.5", part === p ? "bg-brand/20 text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <RowMenu
          label="Set effect"
          menuId="effects"
          items={[
            ...(onBrandAll ? [{ key: "brand", label: "Use Breathe and add-ons for all my songs…", onSelect: () => setAsking(true), attrs: { "data-brand-all": "effects" } }] : []),
            ...(perPlatformHidden ? [] : [{ key: "platform", label: perPlatformOpen ? "Hide the per-platform values" : "Per platform…", onSelect: onPerPlatform, attrs: { "data-effects-per-platform": true } }]),
          ]}
        />
      </div>
      {asking ? (
        <p className="flex flex-wrap items-center gap-2 text-xs" data-brand-all-ask="effects">
          Use Breathe {values.breathe}, Held-note glow {values.heldGlow ? "on" : "off"}, Chorus lift {values.chorusLift ? "on" : "off"} and Shine {values.shine ? "on" : "off"} for every song of this artist?
          <button type="button" data-brand-all-yes="effects" className="text-brand underline underline-offset-2" onClick={() => (setAsking(false), onBrandAll?.())}>
            Yes
          </button>
          <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </p>
      ) : null}
      <p className="text-muted-foreground -mt-1 text-xs">
        {part === "verse" ? "Verses" : "Choruses"}: {effectWords(values[field] || values.verseEffect)}. The viewer shows each click; Save keeps it.
        {effectLocked ? <span className="text-brand"> Locked for this song (unlock it in its ⋯ under Per platform).</span> : null}
      </p>
      {/* The effect: one picker; it opens the gallery (a live tile per effect, filter chips by kind). */}
      <button
        type="button"
        data-effect-picker
        data-current={name}
        aria-expanded={gallery}
        disabled={effectLocked}
        onClick={() => {
          setPinned(name);
          setGallery((g) => !g);
        }}
        className="bg-background flex items-center gap-2 rounded-md border px-3 py-1.5 text-left disabled:opacity-50"
      >
        <span className="flex-1 font-medium">{effectTitle(name)}</span>
        <span className="text-muted-foreground truncate text-xs">{effects.find((e) => e.name === name)?.label.split(" · ")[1] ?? ""}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", gallery && "rotate-180")} />
      </button>
      {/* Strength: how strongly the effect moves (the typing speed for the typewriters), 0-100 %; 50 % is
          clearly seen on a phone. Verses and Choruses each have their own. */}
      <label className="flex items-center gap-2 text-xs" title={pace ? "how fast the letters are typed" : "how strongly the effect moves, blurs or glows"}>
        <span className="w-20 shrink-0">{pace ? "Typing speed" : "Strength"}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          data-effect-strength
          disabled={effectLocked}
          value={strengthOf(intensity)}
          onChange={(e) => onSet(field, `${name}:${e.target.value}`)}
          className="accent-brand flex-1"
        />
        <span className="w-9 text-right tabular-nums" data-effect-strength-value>
          {strengthOf(intensity)}%
        </span>
      </label>
      {gallery ? (
        <div data-effect-gallery className="flex flex-col gap-2">
          <input
            data-effect-search
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search effects (e.g. neon, slide)"
            className="bg-background rounded-md border px-2.5 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {(["All", ...EFFECT_KINDS] as const).map((k) => (
              <button key={k} type="button" data-effect-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", kind === k ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {k}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {/* Compact name tiles (pointing at one plays it in the big viewer). A to Z by the shown name (easy to find one you remember), the current effect first. */}
            {[...effects]
              .filter((e) => kind === "All" || (EFFECT_CATEGORIES[e.name as keyof typeof EFFECT_CATEGORIES] ?? []).includes(kind))
              .filter((e) => !search.trim() || `${effectTitle(e.name)} ${e.name}`.toLowerCase().includes(search.trim().toLowerCase()))
              .sort((a, b) => (a.name === pinned ? -1 : b.name === pinned ? 1 : effectTitle(a.name).localeCompare(effectTitle(b.name))))
              .map((e) => (
                <button
                  key={e.name}
                  type="button"
                  data-try-effect={e.name}
                  title={`${effectTitle(e.name)} · ${e.label.split(" · ").slice(1).join(" · ")}`}
                  aria-pressed={name === e.name}
                  onClick={() => onSet(field, join(e.name, intensity))}
                  onMouseEnter={() => onTry?.(field, join(e.name, intensity))}
                  onMouseLeave={() => onTry?.(field, null)}
                  className={cn("flex h-8 items-center justify-center rounded-md border px-1.5 text-center text-[11px] leading-tight", name === e.name ? "border-brand bg-brand/15" : "hover:border-foreground/40 hover:bg-accent")}
                >
                  <span className="line-clamp-2 font-medium">{effectTitle(e.name)}</span>
                </button>
              ))}
          </div>
          <p className="text-muted-foreground text-[11px]">Point at an effect: the big viewer shows it. Click it to use it.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2" title="works with every lyric effect; a little deeper on choruses">
          Breathe {lockIcon("breathe")}
          <select className={select} value={values.breathe} disabled={locked.includes("breathe")} onChange={(e) => onSet("breathe", e.target.value)} data-try-breathe>
            <option value="off">off</option>
            <option value="gentle">gentle</option>
            <option value="beat">with the beat</option>
          </select>
        </label>
        {ADD_ONS.map(([k, label, what]) => (
          <label key={k} className="flex items-center gap-1.5" title={what}>
            <input type="checkbox" data-try-addon={k} checked={values[k]} disabled={locked.includes(k)} onChange={(e) => onSet(k, e.target.checked ? "on" : "off")} />
            {label} {lockIcon(k)}
          </label>
        ))}
      </div>
    </div>
  );
}
