"use client";

import { Player } from "@remotion/player";
import { useMemo, useState } from "react";
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
function PreviewScene(p: { lyrics: LyricLineProps[]; effect: EffectChoice; breathe: "off" | "gentle" | "beat"; addOns: AddOns; font: string; weight: number; italic: boolean; accent: string }) {
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
// pace for the typewriters) and Breathe, played in a loop, exactly as the video draws them. Trying an
// effect changes nothing until "Use for verses" / "Use for choruses" / "Use these add-ons" is pressed;
// the buttons hand the value to onSave (the Style tab saves it to song.json and reloads).
export function EffectPreview({
  effects,
  lines,
  initial,
  breathe: initialBreathe,
  addOns: initialAddOns,
  font,
  weight,
  italic,
  accent,
  locked = [],
  note = "",
  onSave,
}: {
  effects: { name: string; label: string }[];
  lines: string[];
  initial: string; // "glide" or "spread:subtle"
  breathe: "off" | "gentle" | "beat";
  addOns: AddOns;
  font: string;
  weight: number;
  italic: boolean;
  accent: string;
  locked?: string[]; // recipe fields locked for this song
  note?: string; // confirmation shown after a save
  onSave: (changes: { field: string; value: string }[], note: string) => void;
}) {
  const [name, setName] = useState(initial.split(":")[0]);
  const [intensity, setIntensity] = useState<Intensity>((initial.split(":")[1] as Intensity) || "balanced");
  const [breathe, setBreathe] = useState(initialBreathe);
  const [addOns, setAddOns] = useState<AddOns>(initialAddOns);
  const lyrics = useMemo(() => sampleLyrics(lines), [lines]);
  const duration = lyrics.length * LINE_FRAMES + 45;
  const select = "bg-background rounded-md border px-2 py-1 text-xs";
  const choice = `${name}${intensity !== "balanced" ? `:${intensity}` : ""}`; // as saved: "glide" or "glide:subtle"
  const changes: { field: string; value: string }[] = [];
  if (breathe !== initialBreathe) changes.push({ field: "breathe", value: breathe });
  for (const k of ["heldGlow", "chorusLift", "shine"] as const) if (addOns[k] !== initialAddOns[k]) changes.push({ field: k, value: addOns[k] ? "on" : "off" });
  const addOnsLocked = changes.some((c) => locked.includes(c.field));
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
          <p className="font-medium">Try an effect</p>
          <p className="text-muted-foreground text-xs">Your song&apos;s first lines, drawn exactly as in the video (the middle one as a chorus). Trying changes nothing until you press Use for verses / Use for choruses.</p>
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
              ["verse", "verseEffect", "Use for verses", "verses"],
              ["hook", "hookEffect", "Use for choruses", "choruses"],
            ] as const
          ).map(([key, field, label, what]) => (
            <button
              key={key}
              type="button"
              data-use-effect={key}
              disabled={locked.includes(field)}
              title={locked.includes(field) ? lockedTitle : undefined}
              onClick={() => onSave([{ field, value: choice }], `Saved: ${what} = ${choice}`)}
              className="bg-brand/15 border-brand rounded-md border px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            data-use-addons
            disabled={!changes.length || addOnsLocked}
            title={addOnsLocked ? lockedTitle : undefined}
            onClick={() => onSave(changes, `Saved: ${changes.map((c) => `${c.field} = ${c.value}`).join(", ")}`)}
            className="rounded-md border px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use these add-ons
          </button>
          {note ? (
            <span data-use-note className="text-muted-foreground">
              {note}
            </span>
          ) : null}
        </div>
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
