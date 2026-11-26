// The face prints of a character (26 Nov 2026, Nextgen sprint step 1, Cast Library): one face embedding per face
// reference (the card's reference picture, and the close-up and 3/4 face of the version in use), stored in the card's
// folder as face.json with the engine that made them (YuNet + SFace, local, commercial-friendly licences), so the
// Consistency Score (step 3) can compare takes against them without recomputing, and a later engine can redo them.
// Recomputed when a picture changes (its SHA-256 differs) or the engine does: after a reference check, after a pack or
// a remake, after own pictures are placed. Never a cloud call.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { cardRoot, currentVersion, getCard, readCardFile, usableVersion, versionDir } from "./cards";
import type { FaceTool } from "./face";

export const FACE_FILE = "face.json";
export const FACE_REFERENCES = ["reference", "closeup", "three_quarter"] as const;
export type FaceReference = (typeof FACE_REFERENCES)[number];
export type FaceEngine = { detector: string; recognizer: string; version: number };
export type FacePrint = { file: string; sha256: string; vector: number[] | null; face_px?: number; confidence?: number; note?: string }; // file: inside the card folder
export type FacePrints = { _help?: string; engine: FaceEngine; updated_at: string; prints: Partial<Record<FaceReference, FacePrint>> };

const HELP =
  "Face embeddings of this character's face references (made on this PC by the face checks, YuNet + SFace): one per picture, with the " +
  "picture's SHA-256 so a replaced picture is redone. Used by the Consistency Score. Written by the app; nothing to edit here.";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function readFacePrints(root: string): FacePrints | null {
  try {
    const f = JSON.parse(readFileSync(path.join(root, FACE_FILE), "utf8")) as FacePrints;
    return f && f.prints && f.engine ? f : null;
  } catch {
    return null;
  }
}

// The face references a character has now (relative to its folder): its reference picture, and the close-up and 3/4
// face of the version in use (a draft's own when no version is locked yet).
export function faceSources(root: string): Partial<Record<FaceReference, string>> {
  const file = readCardFile(root);
  const out: Partial<Record<FaceReference, string>> = {};
  if (file.reference && existsSync(path.join(root, file.reference))) out.reference = file.reference;
  const v = usableVersion(file) ?? currentVersion(file);
  const dir = path.relative(root, versionDir(root, v.n));
  for (const view of ["closeup", "three_quarter"] as const) {
    const rel = path.join(dir, `${view}.png`).split(path.sep).join("/");
    if (existsSync(path.join(root, rel))) out[view] = rel;
  }
  return out;
}

// Makes the missing or outdated prints (a changed picture, another engine); keeps the others. Returns the file's content,
// or null when the face tool cannot make embeddings (then nothing is written).
export async function updateFacePrints(ws: Workspace, cardId: string, face: FaceTool): Promise<FacePrints | null> {
  const row = getCard(ws, cardId);
  if (row.kind !== "character" || !face.embed) return null;
  const root = cardRoot(ws, row);
  const sources = faceSources(root);
  const known = readFacePrints(root);
  const shas = Object.fromEntries(Object.entries(sources).map(([k, rel]) => [k, sha(path.join(root, rel!))])) as Partial<Record<FaceReference, string>>;
  const todo = (Object.keys(sources) as FaceReference[]).filter((k) => known?.prints[k]?.sha256 !== shas[k] || known?.prints[k]?.file !== sources[k]);
  const gone = known ? (Object.keys(known.prints) as FaceReference[]).filter((k) => !sources[k]) : [];
  if (!todo.length && !gone.length && known) return known;
  const made = todo.length ? await face.embed(todo.map((k) => path.join(root, sources[k]!))) : null;
  // Another engine: every print is made again with it.
  if (made && known && JSON.stringify(known.engine) !== JSON.stringify(made.engine) && todo.length < Object.keys(sources).length) {
    return updateFacePrintsAll(root, sources, shas, face);
  }
  const prints: FacePrints["prints"] = { ...(known?.prints ?? {}) };
  for (const k of gone) delete prints[k];
  todo.forEach((k, i) => {
    const r = made!.results[i];
    prints[k] = { file: sources[k]!, sha256: shas[k]!, vector: r?.vector ?? null, ...(r?.face_px ? { face_px: r.face_px } : {}), ...(r?.confidence ? { confidence: r.confidence } : {}), ...(r?.note ? { note: r.note } : {}) };
  });
  const out: FacePrints = { _help: HELP, engine: made?.engine ?? known!.engine, updated_at: new Date().toISOString(), prints };
  writeFileSync(path.join(root, FACE_FILE), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

async function updateFacePrintsAll(root: string, sources: Partial<Record<FaceReference, string>>, shas: Partial<Record<FaceReference, string>>, face: FaceTool): Promise<FacePrints> {
  const keys = Object.keys(sources) as FaceReference[];
  const made = await face.embed!(keys.map((k) => path.join(root, sources[k]!)));
  const prints: FacePrints["prints"] = {};
  keys.forEach((k, i) => {
    const r = made.results[i];
    prints[k] = { file: sources[k]!, sha256: shas[k]!, vector: r?.vector ?? null, ...(r?.face_px ? { face_px: r.face_px } : {}), ...(r?.confidence ? { confidence: r.confidence } : {}), ...(r?.note ? { note: r.note } : {}) };
  });
  const out: FacePrints = { _help: HELP, engine: made.engine, updated_at: new Date().toISOString(), prints };
  writeFileSync(path.join(root, FACE_FILE), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

// Never lets a failed embedding break what called it (a check, a pack): the prints are made again next time.
export async function refreshFacePrints(ws: Workspace, cardId: string, face: FaceTool, log: (m: string) => void = () => {}): Promise<void> {
  try {
    await updateFacePrints(ws, cardId, face);
  } catch (error) {
    log(`face prints not updated: ${(error as Error).message}`);
  }
}
