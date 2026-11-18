// The outfit in three parts (decided 18 Nov 2026): Paul types one outfit text; one cheap text call splits it into what a
// head-and-shoulders frame shows, what the front of the body shows and what the back shows, so a detail that is only on
// the back (a V-neck with buttons) never reaches the front view. Stored on the card version as outfit_split with the
// outfit text it was made from; when the outfit changes, the old split is ignored and made again.
import type { FalClient } from "@fal-ai/client";
import type { Workspace } from "@lyric/db";

import { cardRoot, currentVersion, getCard, readCardFile, writeCardFile } from "./cards";
import { callModel, errorText } from "./fal";
import { splitIsCurrent, TEXT_MODEL, type OutfitSplit } from "./plan";

export const OUTFIT_SPLIT_SYSTEM = "You split an outfit description into what is visible in three kinds of photo. Answer with strict JSON only, no other text.";

export function outfitSplitPrompt(outfit: string): string {
  return `Split this outfit description (written for a person in a photo shoot) into three parts, each a complete short description of only what is visible in that kind of picture, repeating shared details such as colour and fabric where needed:
- "closeups": what shows in a head-and-shoulders frame ending at the upper chest: neckline, shoulders, sleeves at the shoulder, veil or hair at the head, earrings, tie or collar. Never skirt, trousers, shoes or anything below the chest.
- "front": what the FRONT of the whole body shows, from the neck down to the shoes.
- "back": what the BACK of the whole body shows, from the neck down to the shoes (including a veil or train falling on the back).
Details the text says are on the back go ONLY to "back". Details that are only on the front (boutonniere, front buttons, brooch, corsage) go ONLY to "front". Do not invent anything that is not in the text; use an empty string if the text says nothing for that part.
Reply with exactly: {"closeups": "...", "front": "...", "back": "..."}

Outfit text:
${outfit}`;
}

// Reads the model's answer: strict JSON, or JSON wrapped in a code fence or in a few words. Null if it is not usable.
export function parseSplit(text: string, from: string): OutfitSplit | null {
  const body = text.replace(/```(?:json)?/gi, "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(body.slice(a, b + 1)) as Record<string, unknown>;
    const part = (x: unknown): string | null => (typeof x === "string" ? x.trim() : Array.isArray(x) && x.every((y) => typeof y === "string") ? (x as string[]).join(", ").trim() : null);
    const closeups = part(j.closeups);
    const front = part(j.front);
    const back = part(j.back);
    if (closeups === null || front === null || back === null) return null;
    return { from: from.trim(), closeups, front, back };
  } catch {
    return null;
  }
}

type CallOpts = { timeoutMs?: number; pollMs?: number; log?: (m: string) => void; sleep?: (ms: number) => Promise<void> };

// One text call (about $0.01). Throws a plain message on failure.
export async function makeSplit(fal: FalClient, outfit: string, o: CallOpts = {}): Promise<{ split: OutfitSplit; requestId: string }> {
  const r = await callModel(fal, TEXT_MODEL.endpoint, { prompt: outfitSplitPrompt(outfit.trim()), system_prompt: OUTFIT_SPLIT_SYSTEM, model: TEXT_MODEL.model }, { timeoutMs: o.timeoutMs ?? 2 * 60_000, pollMs: o.pollMs ?? 1000, log: o.log, sleep: o.sleep });
  const split = parseSplit(String(r.data.output ?? ""), outfit);
  if (!split) throw new Error("the answer was not in the expected form");
  return { split, requestId: r.requestId };
}

export const splitNeeded = (outfit: string | undefined, split: OutfitSplit | undefined | null): boolean => !!outfit?.trim() && !splitIsCurrent(split, outfit);

// After the outfit is saved: makes the split if it is missing or was made from another text. Never throws: the outfit
// is saved either way; the message says plainly what happened (null = nothing to say).
export async function ensureSplit(ws: Workspace, cardId: string, fal: FalClient | null, o: CallOpts & { reason?: string } = {}): Promise<{ made: boolean; usd: number; message: string | null }> {
  const root = cardRoot(ws, getCard(ws, cardId));
  const v = currentVersion(readCardFile(root));
  if (v.status !== "draft" || !splitNeeded(v.outfit, v.outfit_split)) return { made: false, usd: 0, message: null };
  const outfit = v.outfit!;
  const fallback = "The pack will use your outfit text as it is for every view.";
  if (!fal) return { made: false, usd: 0, message: `Outfit saved. It was not split into close-up, front and back parts (no FAL_KEY). ${fallback}` };
  try {
    const { split } = await makeSplit(fal, outfit, o);
    const file = readCardFile(root);
    const cur = currentVersion(file);
    if (cur.status === "draft" && cur.outfit?.trim() === outfit.trim()) {
      cur.outfit_split = split;
      writeCardFile(root, file);
    }
    return { made: true, usd: TEXT_MODEL.perCallUsd, message: null };
  } catch (error) {
    return { made: false, usd: 0, message: `Outfit saved, but it could not be split into close-up, front and back parts (${errorText(error)}). ${fallback}` };
  }
}
