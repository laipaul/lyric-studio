"use client";

import { Player } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill } from "remotion";

import { DEFAULT_LYRIC_AREA, INTENSITIES, LyricScene, type EffectChoice, type Intensity, type LyricLineProps } from "@lyric/video";

import { cn } from "@/lib/utils";

const FPS = 30;
const LINE_FRAMES = 84; // a line every 2.8 s
const BAR_FRAMES = 60; // "with the beat": a downbeat every 2 s (120 BPM)

// Three sample lines (the song's own), timed like sung lines: each word ~0.35 s apart, the middle one a hook.
function sampleLyrics(texts: string[]): LyricLineProps[] {
  return texts.map((text, k) => {
    const startFrame = 15 + k * LINE_FRAMES;
    const stamp = startFrame + 8;
    const words = text.split(/\s+/).filter(Boolean);
    const step = Math.min(10, Math.floor(36 / Math.max(1, words.length)));
    const held = 32; // the last word is held (~1 s), as singers do at the end of a line
    return {
      text,
      startFrame,
      endFrame: k < texts.length - 1 ? startFrame + LINE_FRAMES : startFrame + LINE_FRAMES + 30,
      isHook: k === 1,
      stampFrame: stamp,
      sungEndFrame: stamp + step * (words.length - 1) + held,
      words: words.map((w, i) => ({ text: w, startFrame: stamp + step * i, endFrame: i === words.length - 1 ? stamp + step * i + held : stamp + step * (i + 1) })),
    };
  });
}

type AddOns = { heldGlow: boolean; chorusLift: boolean; shine: boolean };
type Breathe = "off" | "gentle" | "beat";
type Tried = { name: string; intensity: Intensity; breathe: Breathe; addOns: AddOns };

// What was tried is kept per song in sessionStorage, so it survives switching stage (the tabs unmount) and a reload.
const triedKey = (projectId: string) => `lyric-effect-try:${projectId}`;
function readTried(projectId: string, effectNames: string[]): Tried | null {
  try {
    const raw = window.sessionStorage.getItem(triedKey(projectId));
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<Tried>;
    const a = (t.addOns ?? {}) as Partial<AddOns>;
    if (typeof t.name !== "string" || !effectNames.includes(t.name)) return null;
    if (!INTENSITIES.includes(t.intensity as Intensity) || !["off", "gentle", "beat"].includes(t.breathe as string)) return null;
    return { name: t.name, intensity: t.intensity as Intensity, breathe: t.breathe as Breathe, addOns: { heldGlow: a.heldGlow === true, chorusLift: a.chorusLift === true, shine: a.shine === true } };
  } catch {
    return null;
  }
}
function writeTried(projectId: string, tried: Tried) {
  try {
    window.sessionStorage.setItem(triedKey(projectId), JSON.stringify(tried));
  } catch {
    // storage unavailable (private mode, quota): the panel just forgets, as before
  }
}
type Change = { field: string; value: string; shown: string }; // shown: the value in words ("typewriter (quick)")
const BREATHE_WORDS = { off: "off", gentle: "gentle", beat: "with the beat" } as const;
const effectWords = (choice: string) => {
  const [n, i = "balanced"] = choice.split(":");
  if (i === "balanced") return n;
  const typer = n.startsWith("typewriter") && n !== "typewriter-words";
  return `${n} (${typer ? (i === "subtle" ? "calm" : "quick") : i})`;
};
const asSaved = (effect: string) => effect.replace(/:balanced$/, ""); // "glide:balanced" is saved as "glide"
function PreviewScene(p: { lyrics: LyricLineProps[]; effect: EffectChoice; breathe: Breathe; addOns: AddOns; font: string; weight: number; italic: boolean; accent: string }) {
  const downbeats = useMemo(() => Array.from({ length: 12 }, (_, k) => k * BAR_FRAMES), []);
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #3a2630 0%, #141417 60%, #0b0b0d 100%)" }}>
      <LyricScene
        lyrics={p.lyrics}
        effects={{
          verse: p.effect,
          hook: p.effect,
          accent: p.accent,
          ...(p.breathe !== "off" ? { breathe: p.breathe === "beat" ? { mode: "beat", downbeats } : { mode: "gentle" } } : {}),
          heldGlow: p.addOns.heldGlow,
          chorusLift: p.addOns.chorusLift,
          shine: p.addOns.shine,
          downbeats,
        }}
        style={{ name: "Simple", font: p.font, weight: p.weight, italic: p.italic, textCase: "none", effect: "none", animation: "none" }}
        hookFont={null}
        textSize={112}
        colour="#ffffff"
        ready
        areaFor={() => DEFAULT_LYRIC_AREA}
        showNext={false}
        nextScale={0.55}
      />
    </AbsoluteFill>
  );
}

// The effects preview (Style tab): the song's own first lines with an effect and intensity (the typing
// pace for the typewriters), Breathe and the add-ons, played in a loop, exactly as the video draws them.
// Trying changes nothing until "Save to recipe — verses" / "— choruses" is pressed: one click saves everything
// that differs (the effect to the verse or chorus effect; Breathe and the add-ons are song-wide), skipping
// locked settings, and hands it to onSave (the Style tab saves it to song.json, reloads and highlights the
// rows). What was tried stays per song in sessionStorage (it survives Shape -> Make -> Shape and a reload),
// and a line says what is not in the recipe yet.
export function EffectPreview({
  projectId,
  effects,
  lines,
  initial,
  hookInitial = "",
  breathe: initialBreathe,
  addOns: initialAddOns,
  font,
  weight,
  italic,
  accent,
  locked = [],
  note = "",
  labels = {},
  onSave,
}: {
  projectId: string;
  effects: { name: string; label: string }[];
  lines: string[];
  initial: string; // the saved verse effect: "glide" or "spread:subtle"
  hookInitial?: string; // the saved chorus effect ("" = follows the verse effect)
  breathe: Breathe;
  addOns: AddOns;
  font: string;
  weight: number;
  italic: boolean;
  accent: string;
  locked?: string[]; // recipe fields locked for this song
  note?: string; // confirmation shown after a save
  labels?: Record<string, string>; // the settings' names as the rows below show them (field -> label)
  onSave: (changes: Change[], keptLocked: string[]) => void;
}) {
  // The panel is only drawn after the Style tab has loaded its data in the browser, so reading storage in the initialiser cannot mismatch server HTML.
  const [restored] = useState(() => (typeof window === "undefined" ? null : readTried(projectId, effects.map((e) => e.name))));
  const [name, setName] = useState(restored?.name ?? initial.split(":")[0]);
  const [intensity, setIntensity] = useState<Intensity>(restored?.intensity ?? ((initial.split(":")[1] as Intensity) || "balanced"));
  const [breathe, setBreathe] = useState<Breathe>(restored?.breathe ?? initialBreathe);
  const [addOns, setAddOns] = useState<AddOns>(restored?.addOns ?? initialAddOns);
  useEffect(() => writeTried(projectId, { name, intensity, breathe, addOns }), [projectId, name, intensity, breathe, addOns]);
  const lyrics = useMemo(() => sampleLyrics(lines), [lines]);
  const duration = lyrics.length * LINE_FRAMES + 45;
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
      <div className="w-[180px] shrink-0 overflow-hidden rounded-md border">
        <Player
          component={PreviewScene}
          inputProps={{ lyrics, effect: { name, intensity }, breathe, addOns, font, weight, italic, accent }}
          durationInFrames={duration}
          fps={FPS}
          compositionWidth={1080}
          compositionHeight={1920}
          style={{ width: 180, height: 320 }}
          autoPlay
          loop
          controls={false}
        />
      </div>
      <div className="flex min-w-60 flex-1 flex-col gap-3 text-sm">
        <div>
          <p className="font-medium">Set effect</p>
          <p className="text-muted-foreground text-xs">Your song&apos;s first lines, drawn exactly as in the video (the middle one as a chorus). Nothing changes until you press Save to recipe.</p>
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
