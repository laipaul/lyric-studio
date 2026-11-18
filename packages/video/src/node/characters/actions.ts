// The card page's local actions (no cost): check the picture, crop it to the face, add a second picture.
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { addSecondPicture, cardRoot, getCard, readCardFile, setCheck, useCroppedReference, type CardFile } from "./cards";
import type { FaceTool } from "./face";

// The reference check (characters) or location check (scenes) of the card's picture, saved in card.json.
export async function checkCardPicture(ws: Workspace, id: string, face: FaceTool, which: "reference" | "reference2" = "reference"): Promise<CardFile> {
  const row = getCard(ws, id);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const name = which === "reference" ? file.reference : file.reference2;
  if (!name) throw new Error("No second picture yet.");
  const image = path.join(root, name);
  const check = row.kind === "character" ? await face.check(image) : await face.sceneCheck(image);
  return setCheck(ws, id, check, which);
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
