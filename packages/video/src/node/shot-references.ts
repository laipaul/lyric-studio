// Make with references (24 Nov 2026, Paul: "I need to provide to the video platform my character sheets in order to
// create the video with constant characters. Currently I can't do that in Midjourney"). One press on a shot in
// Creation → Production sends the shot to Seedance 2.5 reference-to-video (WaveSpeed) with the pictures that keep it
// consistent: each person in the look they wear in this shot (their wardrobe's close-up, else front view, else their
// card's picture) and the scene card. The takes come back on the shot like any take (Tasks menu, Get result, Compare,
// Use for shot N), each recording which pictures and which prompt made it.
//   The shot's reference item: a strip of the pictures sent ("s05 references 9x16.png" in the song's pictures), its
//   own item on the shot so the takes have a home and the inputs stay visible.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { ffmpegBin, type Workspace } from "@lyric/db";

import { estimate, MAX_REFERENCES, MAX_TAKE_SECONDS, MAX_TAKES, MIN_TAKE_SECONDS, nextTakeN, readCreationDefaults, REFERENCE_MODEL, songFolder, transportFor, update, type Estimate, type Take } from "./animate";
import { cardRoot, listCards } from "./characters/cards";
import { productionView, type ProductionShot } from "./shot-production";

export type ReferencePicture = { name: string; file: string }; // file: absolute
export type Shape = "9:16" | "16:9";

// The pictures of a shot, in @Image order: its people (each in this shot's look), then its scene card.
export function shotReferences(ws: Workspace, shot: ProductionShot): ReferencePicture[] {
  const folders = new Map(listCards(ws).map((c) => [c.id, c.folder] as const));
  const out: ReferencePicture[] = [];
  for (const r of shot.refs) {
    const folder = folders.get(r.card);
    if (!folder || !r.file) continue;
    const file = path.join(cardRoot(ws, { folder }), r.file);
    if (!existsSync(file)) continue;
    const worn = shot.people.find((w) => w.card === r.card);
    out.push({ name: worn ? `${worn.character}${worn.look ? ` · ${worn.look}` : ""}` : r.name, file });
  }
  return out.slice(0, MAX_REFERENCES);
}

// The prompt: who each picture is, the rule to keep them, then what happens (the shot's own prompt without Midjourney's
// --parameters, which a video model does not read). Pure.
export function referencePrompt(shot: Pick<ProductionShot, "prompt" | "people" | "scene">, refs: readonly ReferencePicture[]): string {
  const who = refs.map((r, i) => {
    const person = shot.people.find((w) => r.name === w.character || r.name.startsWith(`${w.character} · `));
    if (person) return `@Image ${i + 1} is ${person.character}${person.look ? `, wearing their "${person.look}" look` : ""}.`;
    return `@Image ${i + 1} is the place${shot.scene ? ` "${shot.scene}"` : ""}.`;
  });
  const keep = refs.some((r) => shot.people.some((w) => r.name === w.character || r.name.startsWith(`${w.character} · `)))
    ? "Keep each person's face, hair and outfit exactly as in their picture, the same person throughout the shot."
    : "";
  const action = shot.prompt.replace(/\s+--\w[\s\S]*$/, "").trim();
  return [...who, keep, action].filter(Boolean).join(" ");
}

export type ReferenceStart = { file: string; takes: Take[]; estimate: Estimate; references: string[] };

// Checks a press of "Make with references" and records its takes as running on the shot's reference item; the caller
// starts runTakes without waiting (as Animate). `seconds`: the shot's length on the song (4-30 s), else the song's take
// length; takes and the spending cap: Creation's defaults unless given.
export function startShotReferences(
  ws: Workspace,
  projectId: string,
  o: { slot: unknown; shape?: unknown; seconds?: unknown; takes?: unknown; capUsd?: unknown },
  env: NodeJS.ProcessEnv = process.env,
): ReferenceStart {
  const shot = productionView(ws, projectId).shots.find((s) => s.id === String(o.slot ?? ""));
  if (!shot) throw new Error("That shot is not in this song's shot list.");
  const refs = shotReferences(ws, shot);
  if (!refs.length) throw new Error(`Shot ${shot.number} has no character or scene card with a picture: add its people or place to the cast (Story room), then try again.`);
  const shape: Shape = o.shape === "16:9" ? "16:9" : "9:16";
  if (!env.LYRIC_GENERATE_STUB) transportFor("wavespeed", "best", env); // no key: the plain-words message, nothing recorded
  const defaults = readCreationDefaults(ws.dir);
  const takes = Math.round(Number(o.takes ?? defaults.takes));
  if (!Number.isFinite(takes) || takes < 1 || takes > MAX_TAKES) throw new Error(`Make 1 to ${MAX_TAKES} takes at a time.`);
  const wanted = Math.ceil(Number(o.seconds ?? 5));
  const seconds = Number.isFinite(wanted) ? Math.min(MAX_TAKE_SECONDS, Math.max(MIN_TAKE_SECONDS, wanted)) : 5;
  const base = estimate("wavespeed", "best", takes, seconds);
  const usdPerTake = Math.round(REFERENCE_MODEL.usdPerSecond * seconds * 100) / 100;
  const e: Estimate = { ...base, usdPerTake, usd: Math.round(usdPerTake * takes * 100) / 100, model: REFERENCE_MODEL.label, priceNote: REFERENCE_MODEL.priceNote };
  const cap = Number(o.capUsd ?? defaults.cap);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (e.usd > cap) throw new Error(`${takes} takes of ${seconds} s cost about $${e.usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: make fewer takes or raise the cap (Creation → Defaults). Nothing was sent.`);

  // The shot's reference item: the pictures side by side, as sent.
  const { dir } = songFolder(ws, projectId);
  const file = `${shot.id} references ${shape.replace(":", "x")}.png`;
  const inputs = refs.flatMap((r) => ["-i", r.file]);
  const scale = refs.map((_, i) => `[${i}:v]scale=-2:480,setsar=1[r${i}]`).join(";");
  const stack = refs.length > 1 ? `;${refs.map((_, i) => `[r${i}]`).join("")}hstack=inputs=${refs.length}[out]` : "";
  execFileSync(ffmpegBin(), ["-y", "-v", "error", ...inputs, "-filter_complex", `${scale}${stack}`, "-map", refs.length > 1 ? "[out]" : "[r0]", "-frames:v", "1", path.join(dir, file)], { windowsHide: true });

  const prompt = referencePrompt(shot, refs);
  const now = new Date().toISOString();
  let made: Take[] = [];
  update(dir, file, (p) => {
    p.slot = shot.id;
    p.source = "Character references";
    p.label ??= `Shot ${shot.number} · with references (${shape})`;
    const first = nextTakeN(p);
    made = Array.from({ length: takes }, (_, i): Take => ({
      n: first + i, service: "wavespeed", quality: "best", model: REFERENCE_MODEL.label, status: "running", started_at: now, cost_usd: usdPerTake, seconds,
      kind: "references", prompt, aspect: shape, refFiles: refs.map((r) => path.relative(ws.dir, r.file).split(path.sep).join("/")), refNames: refs.map((r) => r.name), pid: process.pid,
    }));
    p.takes.push(...made);
  });
  return { file, takes: made, estimate: e, references: refs.map((r) => r.name) };
}
