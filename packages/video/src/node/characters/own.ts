// "Use my own picture" / "Add my pack" (Paul, 21 Nov 2026: "if I have my character pack then I don't need to create
// it in my app?"): pictures made elsewhere (Gemini, Midjourney …) go straight into the pack's slots, free, nothing sent
// online. Each one goes to its slot by its file name (closeup, 3-4, front, back …) or, for names that say nothing
// (Gemini_Generated_Image_…), by the face check (no face: back; a small face: front; a turned face: 3/4; else close-up).
// The same face checks then run as on a made view; full-body views are cropped at the neck by the app (the picture as
// given is kept as _full). The user's files are only read: the app works on its own PNG copies.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FalClient } from "@fal-ai/client";

import { ffmpegBin, type Workspace } from "@lyric/db";

import { cardRoot, cardThresholds, currentVersion, getCard, readCardFile, referenceFiles, versionDir, writeCardFile } from "./cards";
import type { FaceTool } from "./face";
import { callModel, errorText } from "./fal";
import { buildSheet, finishPicture, judge, readReport, writeReport, type Item, type Try, type VersionReport } from "./generate";
import { ANGLES, DESCRIPTION_PROMPT, imageSize, SCENE_DESCRIPTION_PROMPT, VIEWS, VISION } from "./plan";

export type OwnPicture = { name: string; bytes: Buffer; slot?: string | null };
export type Placed = { name: string; slot: string; label: string; light: string | null; by: "you" | "name" | "face" | "order" };

const IMAGE = /\.(png|jpe?g|webp)$/i;
const labelOf = (id: string) => [...VIEWS, ...ANGLES].find((x) => x.id === id)?.label.replace(/ \(cropped at the neck\)/, "") ?? id;
export const slotsFor = (kind: string) => (kind === "character" ? VIEWS.map((v) => v.id) : ANGLES.map((a) => a.id)) as string[];

// The slot a file name points to, or null (Gemini's and Midjourney's own names say nothing).
export function slotFromName(name: string, kind: string): string | null {
  const t = path.basename(name).replace(IMAGE, "").toLowerCase().split(/[^a-z0-9¾]+/).filter(Boolean);
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const pair = (a: string, b: string) => t.some((x, i) => x === a && t[i + 1] === b);
  if (kind !== "character") {
    if (has("left")) return "wide_left";
    if (has("right")) return "wide_right";
    if (has("detail", "closer", "close", "closeup")) return "detail";
    return null;
  }
  if (has("¾", "threequarter", "threequarters", "34") || pair("3", "4") || pair("three", "quarter") || pair("three", "quarters")) return "three_quarter";
  if (has("back", "rear", "behind", "backside")) return "body_back";
  if (has("closeup", "portrait", "headshot", "face", "head") || pair("close", "up")) return "closeup";
  if (has("front", "body", "fullbody", "full")) return "body_front";
  return null;
}

// Where a nameless picture goes, from the face check: no face → back; small face → front; turned → 3/4; else close-up.
export function slotFromFace(r: { score: number | null; face_px?: number; yaw?: number | null }, frameH: number | null | undefined): string {
  if (r.score === null || !(r.face_px ?? 0)) return "body_back";
  if (frameH && (r.face_px ?? 0) / frameH < 0.2) return "body_front";
  if (Math.abs(r.yaw ?? 0) > 20) return "three_quarter";
  return "closeup";
}

function toPng(from: string, to: string): void {
  if (/\.png$/i.test(from)) {
    copyFileSync(from, to);
    return;
  }
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", from, "-frames:v", "1", to]);
}

// The user's pictures into the draft's slots. `slot` on a picture: that slot (Use my own picture); otherwise sorted.
export async function useOwnPictures(ws: Workspace, cardId: string, face: FaceTool, pictures: OwnPicture[]): Promise<{ placed: Placed[]; summary: string }> {
  const row = getCard(ws, cardId);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = currentVersion(file);
  if (v.status === "locked") throw new Error(`Version ${v.n} is locked: start a new version to change it.`);
  const slots = slotsFor(row.kind);
  const pics = pictures.filter((p) => p.bytes.length);
  if (!pics.length) throw new Error("Choose a picture.");
  for (const p of pics) if (!IMAGE.test(p.name)) throw new Error(`${p.name} is not a picture (.png, .jpg, .webp).`);
  if (pics.length > slots.length) throw new Error(`A ${row.kind === "character" ? "pack has 4" : "scene has 3"} pictures: you chose ${pics.length}.`);
  for (const p of pics) if (p.slot && !slots.includes(p.slot)) throw new Error(`Unknown place "${p.slot}".`);
  const dir = versionDir(root, v.n);
  mkdirSync(dir, { recursive: true });
  const th = cardThresholds(root);
  const report: VersionReport = readReport(dir) ?? { updated_at: "", model: v.model, endpoint: "", thresholds: th, items: [], request_ids: [], spent_usd: 0 };
  const refFile = referenceFiles(root, file)[0];

  // The app's own PNG copies first (the user's files are only read).
  const incoming = pics.map((p, k) => {
    const src = path.join(dir, `own_in_${k}${path.extname(p.name).toLowerCase()}`);
    writeFileSync(src, p.bytes);
    const png = path.join(dir, `own_in_${k}.png`);
    try {
      if (src !== png) toPng(src, png);
    } catch {
      throw new Error(`${p.name} could not be read as a picture.`);
    } finally {
      if (src !== png) rmSync(src, { force: true });
    }
    return { ...p, png };
  });
  try {
    // Sort: your choice, then the file name, then the face check, then the first free place.
    const taken = new Map<string, number>();
    const where: { slot: string; by: Placed["by"] }[] = incoming.map(() => ({ slot: "", by: "order" as const }));
    const claim = (k: number, slot: string | null, by: Placed["by"]) => {
      if (!slot || taken.has(slot)) return false;
      taken.set(slot, k);
      where[k] = { slot, by };
      return true;
    };
    incoming.forEach((p, k) => p.slot && claim(k, p.slot, "you"));
    incoming.forEach((p, k) => !where[k].slot && claim(k, slotFromName(p.name, row.kind), "name"));
    const rest = incoming.map((_, k) => k).filter((k) => !where[k].slot);
    if (rest.length && row.kind === "character") {
      try {
        const r = (await face.compare(refFile, rest.map((k) => incoming[k].png))).results;
        rest.forEach((k, i) => r[i] && claim(k, slotFromFace(r[i], imageSize(readFileSync(incoming[k].png))?.height), "face"));
      } catch {
        // no face check: the first free places
      }
    }
    for (const k of incoming.keys()) if (!where[k].slot) claim(k, slots.find((s) => !taken.has(s)) ?? null, "order");

    const run = Math.max(0, ...report.items.flatMap((i) => i.tries.map((t) => t.run ?? 0))) + 1;
    const placed: Placed[] = [];
    for (const [k, p] of incoming.entries()) {
      const id = where[k].slot;
      let item = report.items.find((i) => i.id === id);
      if (!item) {
        item = { id, label: labelOf(id), kind: row.kind === "character" ? "view" : "angle", tries: [], chosen: null, light: null, text: "" };
        report.items.push(item);
      }
      const n = item.tries.length + 1;
      const name = `${id}_t${n}.png`;
      copyFileSync(p.png, path.join(dir, name));
      copyFileSync(p.png, path.join(dir, `${id}_t${n}_own.png`)); // as given, for "Move to"
      const t: Try = { file: name, request_id: null, score: null, light: null, text: "", attempts: [], seed: 0, run, own: path.basename(p.name) };
      item.tries.push(t);
      await finishPicture(face, item.kind, id, path.join(dir, name));
      await judge(face, refFile, item, t, path.join(dir, name), th);
      pickOwn(item, n - 1, dir);
      placed.push({ name: path.basename(p.name), slot: id, label: labelOf(id), light: item.light, by: where[k].by });
    }
    report.items.sort((a, b) => slots.indexOf(a.id) - slots.indexOf(b.id));
    writeReport(dir, report);
    await buildSheet(face, root, readCardFile(root), report);
    const how = (b: Placed["by"]) => (b === "name" ? " (by its name)" : b === "face" ? " (by the face check)" : b === "order" ? " (first free place)" : "");
    const summary = `${placed.map((x) => `${x.name} → ${x.label}${how(x.by)}`).join(" · ")}. Free, nothing sent online. Wrong place? Use "Move to" under the picture.`;
    return { placed, summary };
  } finally {
    for (const p of incoming) rmSync(p.png, { force: true });
  }
}

// The user's own picture always wins its slot (even amber or red: the light and the reasons stay shown).
function pickOwn(item: Item, k: number, dir: string): void {
  const t = item.tries[k];
  item.chosen = k;
  item.light = t.light;
  item.text = `Your picture (${t.own}): ${t.text}`;
  copyFileSync(path.join(dir, t.file!), path.join(dir, `${item.id}.png`));
}

// "Move to": the user's picture in one slot goes to another; a picture of theirs already there takes its place.
export async function moveOwnPicture(ws: Workspace, cardId: string, face: FaceTool, from: string, to: string): Promise<{ placed: Placed[]; summary: string }> {
  const row = getCard(ws, cardId);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const dir = versionDir(root, currentVersion(file).n);
  const report = readReport(dir);
  const given = (id: string) => {
    const it = report?.items.find((i) => i.id === id);
    const t = it && it.chosen !== null ? it.tries[it.chosen] : null;
    if (!t?.own || !t.file) return null;
    const f = path.join(dir, t.file.replace(/\.png$/i, "_own.png"));
    return existsSync(f) ? { name: t.own, bytes: readFileSync(f) } : null;
  };
  const a = given(from);
  if (!a) throw new Error("Only your own pictures can be moved.");
  if (from === to) throw new Error("It is already there.");
  const b = given(to);
  return useOwnPictures(ws, cardId, face, [{ ...a, slot: to }, ...(b ? [{ ...b, slot: from }] : [])]);
}

// The description drafted from the card's picture by the cheap vision model (about $0.01): for a pack of the user's
// own pictures, where no Make pack drafted it. Overwrites nothing the user wrote.
export async function draftDescription(ws: Workspace, cardId: string, fal: FalClient): Promise<{ text: string; usd: number }> {
  const row = getCard(ws, cardId);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = currentVersion(file);
  if (v.status === "locked") throw new Error(`Version ${v.n} is locked: start a new version to change it.`);
  if (v.description?.trim()) throw new Error("There is already a description: clear it first to draft a new one.");
  const dir = versionDir(root, v.n);
  const closeup = path.join(dir, "closeup.png");
  const image = row.kind === "character" && existsSync(closeup) ? closeup : referenceFiles(root, file)[0];
  const mime = /\.png$/i.test(image) ? "image/png" : /\.webp$/i.test(image) ? "image/webp" : "image/jpeg";
  try {
    const url = await fal.storage.upload(new File([readFileSync(image)], path.basename(image), { type: mime }));
    const r = await callModel(fal, VISION.endpoint, { prompt: row.kind === "character" ? DESCRIPTION_PROMPT : SCENE_DESCRIPTION_PROMPT, image_urls: [url], model: VISION.model }, { timeoutMs: 120_000, pollMs: 2000 });
    const text = String(r.data.output ?? "").trim();
    if (!text) throw new Error("the model gave no text");
    const f = readCardFile(root);
    const cur = currentVersion(f);
    if (!cur.description?.trim()) {
      cur.description = text;
      writeCardFile(root, f);
    }
    const report = readReport(dir);
    if (report) {
      report.request_ids.push(r.requestId);
      report.description_request = r.requestId;
      report.spent_usd = Math.round((report.spent_usd + VISION.perCallUsd) * 100) / 100;
      writeReport(dir, report);
    }
    return { text, usd: VISION.perCallUsd };
  } catch (error) {
    throw new Error(`The description could not be drafted (${errorText(error)}): write it yourself, or try again.`);
  }
}
