// "Who is this" on a Creation picture (25 Nov 2026, Paul: the character sheet is the reference for Animate). Paul picks
// one of his characters on a loose picture (a Midjourney still of Jennifer, say); Animate then sends the picture AND
// that character's face sheet (close-up, side profile, 3/4, teeth: shot-references.ts) to Seedance 2.5
// reference-to-video, so her face stays the same across all his pictures, not only on planned shots. Only the FACE
// sheet: the clothes, place, light and pose come from the picture. "Nobody" (the default): Animate as before.
// The take records both pictures and the prompt (kind "references"), like Make with references.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import {
  estimate, MAX_TAKE_SECONDS, MAX_TAKES, MIN_TAKE_SECONDS, motionPrompt, nextTakeN, readCreationDefaults, readPictures, REFERENCE_MODEL, songFolder, songTakeSeconds, startAnimate, transportFor, update,
  PICTURE_FILE, type AnimateOptions, type Estimate, type Take,
} from "./animate";
import { cardRoot, listCards } from "./characters/cards";
import { imageSize } from "./characters/plan";
import { feelFor, filmLookFor } from "./film-looks";
import { feelingForSlot } from "./section-feelings";
import { faceSheet } from "./shot-references";

export type CharacterChoice = { id: string; name: string };

// The characters a picture can be: character cards with a close-up (their face sheet's first panel).
export function characterChoices(ws: Workspace): CharacterChoice[] {
  return listCards(ws)
    .filter((c) => c.kind === "character" && /closeup\.png$/.test(c.thumbnail))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setPictureWho(ws: Workspace, projectId: string, file: string, cardId: unknown): CharacterChoice | null {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !existsSync(path.join(dir, name)) || !PICTURE_FILE.test(name)) throw new Error(`No picture ${file} on this song's board.`);
  const id = cardId === null || cardId === undefined || cardId === "" ? null : String(cardId);
  const who = id ? (characterChoices(ws).find((c) => c.id === id) ?? null) : null;
  if (id && !who) throw new Error("That character has no close-up yet: make its views in Characters first.");
  update(dir, name, (p) => {
    p.who = who?.id;
  });
  return who;
}

// The picture's shape for the video: from its size (a tall picture: 9:16).
function shapeOf(file: string): "9:16" | "16:9" {
  try {
    const s = imageSize(readFileSync(file));
    return s && s.width > s.height ? "16:9" : "9:16";
  } catch {
    return "9:16";
  }
}

// The prompt: what each picture is, then the app's usual motion prompt (realism rules, feeling, Film look, mood).
export function faceKeepPrompt(name: string, panels: readonly string[] | undefined, motion: string): string {
  const list = panels && panels.length > 1 ? ` (left to right: ${panels.join(", ")})` : "";
  return (
    "@Image 1 is the picture to bring to life: the opening frame, keep its place, light, pose, clothes and framing exactly. " +
    `@Image 2 is ${name}'s face reference sheet${list}: the person in @Image 1 is ${name}, with exactly this face, hair and makeup in every frame; never change the clothes. ` +
    motion
  );
}

// Animate on a Creation picture: with its character's face sheet when "Who is this" names one, else as before.
export function startPictureAnimate(ws: Workspace, projectId: string, file: string, o: AnimateOptions, env: NodeJS.ProcessEnv = process.env): { takes: Take[]; estimate: Estimate; withFace?: string } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  const who = rec?.who ? characterChoices(ws).find((c) => c.id === rec.who) : undefined;
  if (!who || !PICTURE_FILE.test(name)) return startAnimate(ws, projectId, file, o, env);
  if (!existsSync(path.join(dir, name))) throw new Error(`No picture ${file} on this song's board.`);
  const card = listCards(ws).find((c) => c.id === who.id)!;
  const sheet = faceSheet(ws, path.join(cardRoot(ws, card), path.dirname(card.thumbnail)), who.name);
  if (!sheet) throw new Error(`${who.name} has no close-up yet: make the views in Characters first.`);
  if (!env.LYRIC_GENERATE_STUB) transportFor("wavespeed", "best", env); // no key: the plain-words message, nothing recorded
  const defaults = readCreationDefaults(ws.dir);
  const takes = Math.round(Number(o.takes ?? defaults.takes));
  if (!Number.isFinite(takes) || takes < 1 || takes > MAX_TAKES) throw new Error(`Make 1 to ${MAX_TAKES} takes at a time.`);
  const wanted = Math.round(Number(o.seconds ?? songTakeSeconds(ws, projectId, defaults.length)));
  const seconds = Number.isFinite(wanted) ? Math.min(MAX_TAKE_SECONDS, Math.max(MIN_TAKE_SECONDS, wanted)) : 5;
  const usdPerTake = Math.round(REFERENCE_MODEL.usdPerSecond * seconds * 100) / 100;
  const e: Estimate = { ...estimate("wavespeed", "best", takes, seconds), usdPerTake, usd: Math.round(usdPerTake * takes * 100) / 100, model: REFERENCE_MODEL.label, priceNote: REFERENCE_MODEL.priceNote };
  const cap = Number(o.capUsd ?? defaults.cap);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (e.usd > cap) throw new Error(`${takes} takes of ${seconds} s with ${who.name}'s face sheet cost about $${e.usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: make fewer takes or raise the cap. Nothing was sent.`);
  const look = filmLookFor(ws, projectId);
  const feel = feelFor(ws, projectId);
  const feeling = rec?.feeling ? { feeling: rec.feeling } : feelingForSlot(ws, projectId, rec?.slot);
  const prompt = faceKeepPrompt(who.name, sheet.panels, motionPrompt(rec?.mood, look?.line, feel, feeling.feeling, feeling.feelingTo));
  const rel = (f: string) => path.relative(ws.dir, f).split(path.sep).join("/");
  const now = new Date().toISOString();
  let made: Take[] = [];
  update(dir, name, (p) => {
    const first = nextTakeN(p);
    made = Array.from({ length: takes }, (_, i): Take => ({
      n: first + i, service: "wavespeed", quality: "best", model: REFERENCE_MODEL.label, status: "running", started_at: now, cost_usd: usdPerTake, seconds,
      kind: "references", prompt, aspect: shapeOf(path.join(dir, name)), refFiles: [rel(path.join(dir, name)), rel(sheet.file)], refNames: [name, `${who.name} · face sheet`],
      ...(look ? { filmLook: look.name, look: look.line } : {}), feel, ...feeling, pid: process.pid,
    }));
    p.takes.push(...made);
  });
  return { takes: made, estimate: e, withFace: who.name };
}
