// The card page's local actions (no cost): check the picture, crop it to the face, add a second picture.
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { addSecondPicture, cardRoot, getCard, readCardFile, setCheck, useCroppedReference, type CardFile } from "./cards";
import type { CheckResult, FaceTool } from "./face";
import { refreshFacePrints } from "./face-prints";

// The reference check (characters) or location check (scenes) of the card's picture, saved in card.json.
// A character's reference picture only (26 Nov 2026, Cast Library; never clips or shots): any second face at least a
// quarter the size of the main one makes it "Not suitable: more than one face" (a group photo); smaller faces in the
// background stay a fix (crop to her face).
export const SECOND_FACE_LIMIT = 0.25;
export function strictFaces(check: CheckResult): CheckResult {
  const n = Number(check.measures.faces ?? 0);
  const ratio = Number(check.measures.second_face_ratio ?? 0);
  if (n < 2 || ratio < SECOND_FACE_LIMIT) return check;
  const bad = { level: "bad" as const, text: `More than one face (${n} in the picture): a character's reference must show this person alone. Use a picture of her alone, or crop it to her face.`, check: "faces" };
  return { ...check, verdict: "Not suitable", reasons: [bad, ...check.reasons.filter((r) => r.check !== "faces")], fixes: [...new Set([...(check.fixes ?? []), "crop"])] };
}

export async function checkCardPicture(ws: Workspace, id: string, face: FaceTool, which: "reference" | "reference2" = "reference"): Promise<CardFile> {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const name = which === "reference" ? file.reference : file.reference2;
  if (!name) throw new Error("No second picture yet.");
  const image = path.join(root, name);
  const check = row.kind === "character" ? await face.check(image) : await face.sceneCheck(image);
  const out = setCheck(ws, id, row.kind === "character" ? strictFaces(check) : check, which);
  if (row.kind === "character") await refreshFacePrints(ws, id, face);
  return out;
}

// "Crop to face": a 3:4 crop around the face of the uploaded picture becomes the picture sent to the models.
export async function cropCardToFace(ws: Workspace, id: string, face: FaceTool): Promise<CardFile> {
  const row = getCard(ws, id);
  if (row.kind !== "character") throw new Error("Only a character's picture can be cropped to the face.");
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  await face.crop(path.join(root, file.original), path.join(root, "reference_cropped.jpg"));
  useCroppedReference(ws, id, "reference_cropped.jpg");
  return checkCardPicture(ws, id, face);
}

export async function addCardSecondPicture(ws: Workspace, id: string, face: FaceTool, picture: Buffer, fileName: string): Promise<CardFile> {
  addSecondPicture(ws, id, picture, fileName);
  return checkCardPicture(ws, id, face, "reference2");
}
