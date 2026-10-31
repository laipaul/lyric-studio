"use client";

// Set effect (Shape, Look): the only place the song's lyric effects are set. A Verses / Choruses switch
// says which part the effect chips and the intensity (the typing pace for the typewriters) apply to;
// Breathe and the three add-ons are song-wide. Every click goes into the theme editor's draft (the viewer shows
// it straight away and the video is planned again); locked settings are greyed out with a padlock. The ⋯
// menu: "Use Breathe and add-ons for all my songs" (the artist's brand, asks first) and the per-platform
// values.
import { EFFECT_CATEGORIES, EFFECT_KINDS, effectTitle, INTENSITIES, type Intensity, type LookPreviewProps } from "@lyric/video";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";

import { PreviewPlayer } from "@/components/preview-player";
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
const paceWord = (i: string) => (i === "subtle" ? "calm" : i === "balanced" ? "normal" : "quick");
const intensityWord = (i: string) => (i === "subtle" ? "soft" : i === "expressive" ? "strong" : "balanced");
const isTyper = (n: string) => n.startsWith("typewriter") && n !== "typewriter-words";
export const effectWords = (saved: string) => {
  const [n, i = "balanced"] = saved.split(":");
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
  onPerPlatform,
  preview,
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
  onPerPlatform: () => void;
  preview?: (effect: string) => LookPreviewProps; // the gallery tile's live preview of one effect
}) {
  const [asking, setAsking] = useState(false);
  const [gallery, setGallery] = useState(false); // the effect gallery under the picker
  const [kind, setKind] = useState<"All" | (typeof EFFECT_KINDS)[number]>("All");
  const [hovered, setHovered] = useState<string | null>(null); // the tile playing
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
            { key: "platform", label: perPlatformOpen ? "Hide the per-platform values" : "Per platform…", onSelect: onPerPlatform, attrs: { "data-effects-per-platform": true } },
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
        onClick={() => setGallery((g) => !g)}
        className="bg-background flex items-center gap-2 rounded-md border px-3 py-1.5 text-left disabled:opacity-50"
      >
        <span className="flex-1 font-medium">{effectTitle(name)}</span>
        <span className="text-muted-foreground truncate text-xs">{effects.find((e) => e.name === name)?.label.split(" · ")[1] ?? ""}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", gallery && "rotate-180")} />
      </button>
      {gallery ? (
        <div data-effect-gallery className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(["All", ...EFFECT_KINDS] as const).map((k) => (
              <button key={k} type="button" data-effect-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", kind === k ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {k}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {effects
              .filter((e) => kind === "All" || (EFFECT_CATEGORIES[e.name as keyof typeof EFFECT_CATEGORIES] ?? []).includes(kind))
              .map((e) => (
                <button
                  key={e.name}
                  type="button"
                  data-try-effect={e.name}
                  title={e.label}
                  aria-pressed={name === e.name}
                  onClick={() => onSet(field, join(e.name, intensity))}
                  onMouseEnter={() => setHovered(e.name)}
                  onMouseLeave={() => setHovered((h) => (h === e.name ? null : h))}
                  className={cn("flex flex-col gap-1 rounded-md border p-1 text-left text-[11px]", name === e.name ? "border-brand bg-brand/10" : "hover:border-foreground/40")}
                >
                  <span className="relative block w-full overflow-hidden rounded bg-black" style={{ aspectRatio: "9 / 12" }}>
                    {hovered === e.name && preview ? (
                      <PreviewPlayer input={preview(join(e.name, intensity))} />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-sm text-white/90" style={{ background: "radial-gradient(circle at 50% 40%, #3a2630, #0b0b0d 75%)" }}>
                        {effectTitle(e.name)}
                      </span>
                    )}
                  </span>
                  <span className="truncate font-medium">{effectTitle(e.name)}</span>
                </button>
              ))}
          </div>
          <p className="text-muted-foreground text-[11px]">Point at a tile to see it move; click it to use it. The big viewer shows it on your song.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          {pace ? "Typing pace" : "Intensity"}
          <select className={select} value={intensity} disabled={effectLocked} onChange={(e) => onSet(field, join(name, e.target.value as Intensity))} data-try-intensity>
            {INTENSITIES.map((i) => (
              <option key={i} value={i}>
                {pace ? paceWord(i) : intensityWord(i)}
              </option>
            ))}
          </select>
        </label>
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
