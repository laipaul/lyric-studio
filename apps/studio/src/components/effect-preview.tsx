"use client";

import { INTENSITIES, type Intensity, type TriedAddOns, type TriedBreathe, type TriedEffect } from "@lyric/video";

import { cn } from "@/lib/utils";

type AddOns = TriedAddOns;
type Breathe = TriedBreathe;
type Change = { field: string; value: string; shown: string }; // shown: the value in words ("typewriter (quick)")
const BREATHE_WORDS = { off: "off", gentle: "gentle", beat: "with the beat" } as const;
const effectWords = (choice: string) => {
  const [n, i = "balanced"] = choice.split(":");
  if (i === "balanced") return n;
  const typer = n.startsWith("typewriter") && n !== "typewriter-words";
  return `${n} (${typer ? (i === "subtle" ? "calm" : "quick") : i})`;
};
const asSaved = (effect: string) => effect.replace(/:balanced$/, ""); // "glide:balanced" is saved as "glide"

// Set effect (Style tab, Look): try an effect and intensity (the typing pace for the typewriters), Breathe
// and the add-ons; the Look block's big preview (look-preview.tsx) plays them on the song's first lines,
// exactly as the video draws them. The tried state lives in the Look block (shared with the preview, kept
// per song in sessionStorage: it survives Shape -> Make -> Shape and a reload). Trying changes nothing
// until "Save to recipe — verses" / "— choruses" is pressed: one click saves everything that differs (the
// effect to the verse or chorus effect; Breathe and the add-ons are song-wide), skipping locked settings,
// and hands it to onSave (the Style tab saves it to song.json, reloads and highlights the rows); a line
// says what is not in the recipe yet.
export function EffectPreview({
  tried,
  onTry,
  effects,
  initial,
  hookInitial = "",
  breathe: initialBreathe,
  addOns: initialAddOns,
  locked = [],
  note = "",
  labels = {},
  onSave,
}: {
  tried: TriedEffect;
  onTry: (tried: TriedEffect) => void;
  effects: { name: string; label: string }[];
  initial: string; // the saved verse effect: "glide" or "spread:subtle"
  hookInitial?: string; // the saved chorus effect ("" = follows the verse effect)
  breathe: Breathe;
  addOns: AddOns;
  locked?: string[]; // recipe fields locked for this song
  note?: string; // confirmation shown after a save
  labels?: Record<string, string>; // the settings' names as the rows below show them (field -> label)
  onSave: (changes: Change[], keptLocked: string[]) => void;
}) {
  const { name, intensity, breathe, addOns } = tried;
  const setName = (n: string) => onTry({ ...tried, name: n });
  const setIntensity = (i: Intensity) => onTry({ ...tried, intensity: i });
  const setBreathe = (b: Breathe) => onTry({ ...tried, breathe: b });
  const setAddOns = (f: (a: AddOns) => AddOns) => onTry({ ...tried, addOns: f(addOns) });
  const select = "bg-background rounded-md border px-2 py-1 text-xs";
  const choice = `${name}${intensity !== "balanced" ? `:${intensity}` : ""}`; // as saved: "glide" or "glide:subtle"
  const label = (field: string) => labels[field] ?? field;
  // The song-wide settings that differ from the recipe (Breathe and the add-ons), saved with either button.
  const others: Change[] = [];
  if (breathe !== initialBreathe) others.push({ field: "breathe", value: breathe, shown: BREATHE_WORDS[breathe] });
  for (const k of ["heldGlow", "chorusLift", "shine"] as const) if (addOns[k] !== initialAddOns[k]) others.push({ field: k, value: addOns[k] ? "on" : "off", shown: addOns[k] ? "on" : "off" });
  // What is not in the recipe yet (the effect counts as saved when it equals the verse or the chorus effect).
  const effectSaved = [asSaved(initial), asSaved(hookInitial)].filter(Boolean).includes(choice);
  const unsaved: string[] = [];
  if (!effectSaved) unsaved.push(`${label("verseEffect")} / ${label("hookEffect")} = ${effectWords(choice)}`);
  for (const c of others) unsaved.push(`${label(c.field)} = ${c.shown}`);
  // One click saves everything that differs; locked settings are skipped (and named afterwards).
  const plan = (field: "verseEffect" | "hookEffect") => {
    const all: Change[] = [{ field, value: choice, shown: effectWords(choice) }, ...others];
    return { save: all.filter((c) => !locked.includes(c.field)), kept: all.filter((c) => locked.includes(c.field)).map((c) => c.field) };
  };
  const lockedTitle = "Locked for this song (unlock it below)";
  const pace = name.startsWith("typewriter") && name !== "typewriter-words";
  return (
    <div className="bg-card flex flex-wrap items-start gap-5 rounded-lg border p-4" data-effect-preview>
      <div className="flex min-w-60 flex-1 flex-col gap-3 text-sm">
        <div>
          <p className="font-medium">Set effect</p>
          <p className="text-muted-foreground text-xs">Try an effect: the preview plays it on your song&apos;s first lines (the middle one as a chorus), exactly as in the video. Nothing changes until you press Save to recipe.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {effects.map((e) => (
            <button key={e.name} type="button" data-try-effect={e.name} onClick={() => setName(e.name)} className={cn("rounded-full border px-2.5 py-1 text-xs", name === e.name ? "border-brand bg-brand/15" : "text-muted-foreground hover:text-foreground")}>
              {e.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs" data-use-row>
          {(
            [
              ["verse", "verseEffect", "Save to recipe — verses"],
              ["hook", "hookEffect", "Save to recipe — choruses"],
            ] as const
          ).map(([key, field, text]) => {
            const { save, kept } = plan(field);
            const blocked = save.length === 0; // the effect is locked and nothing else differs
            return (
              <button
                key={key}
                type="button"
                data-use-effect={key}
                disabled={blocked}
                title={blocked ? lockedTitle : kept.length ? `Locked, kept as they are: ${kept.map(label).join(", ")}` : undefined}
                onClick={() => onSave(save, kept)}
                className="bg-brand/15 border-brand rounded-md border px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {text}
              </button>
            );
          })}
          {note ? (
            <span data-use-note className="text-muted-foreground">
              {note}
            </span>
          ) : null}
        </div>
        {unsaved.length ? (
          <p data-unsaved className="text-muted-foreground text-xs">
            Not saved to the recipe yet: {unsaved.join(", ")} — press Save to recipe to keep {unsaved.length === 1 ? "it" : "them"}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            {pace ? "Typing pace" : "Intensity"}
            <select className={select} value={intensity} onChange={(e) => setIntensity(e.target.value as Intensity)} data-try-intensity>
              {INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {pace ? (i === "subtle" ? "calm" : i === "balanced" ? "normal" : "quick") : i}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Breathe
            <select className={select} value={breathe} onChange={(e) => setBreathe(e.target.value as typeof breathe)} data-try-breathe>
              <option value="off">off</option>
              <option value="gentle">gentle</option>
              <option value="beat">with the beat</option>
            </select>
          </label>
          {(
            [
              ["heldGlow", "Held-note glow"],
              ["chorusLift", "Chorus lift"],
              ["shine", "Shine"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" data-try-addon={k} checked={addOns[k]} onChange={(e) => setAddOns((a) => ({ ...a, [k]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
