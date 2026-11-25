// The Character sheet (25 Nov 2026, Paul: "one picture of the same person in several views", as in the tutorials): the
// card's own views side by side in one clean picture, no captions or scores (that is the contact sheet): close-up,
// side profile, 3/4 face, full body with face (else the full body front). Made on this PC with FFmpeg (free), kept as
// v<n>\character_sheet.png and made again when one of its views is newer. Paul saves it for Midjourney or Higgsfield;
// Make with references and Animate send it as the person's reference.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { ffmpegBin } from "@lyric/db";

export const CHARACTER_SHEET = "character_sheet.png";
const HEIGHT = 1024;
// The views in sheet order, with the words a video model reads ("left to right: …").
export const SHEET_PANELS: { file: string; label: string }[] = [
  { file: "closeup.png", label: "close-up" },
  { file: "profile.png", label: "side profile" },
  { file: "three_quarter.png", label: "3/4" },
  { file: "body_full.png", label: "full body" },
];
const FALLBACK_BODY = { file: "body_front.png", label: "full body (front, cropped at the neck)" };

export type CharacterSheet = { file: string; panels: string[] }; // file: absolute

// The panels a version folder has, in order (the full body front stands in for a full body with face not made yet).
export function sheetPanels(versionDir: string): { file: string; label: string }[] {
  const have = (f: string) => existsSync(path.join(versionDir, f));
  const out = SHEET_PANELS.filter((p) => have(p.file));
  if (!have("body_full.png") && have(FALLBACK_BODY.file)) out.push(FALLBACK_BODY);
  return out.map((p) => ({ file: path.join(versionDir, p.file), label: p.label }));
}

// Builds (or reuses) the sheet; null with fewer than two views or when FFmpeg cannot make it (a convenience).
export function characterSheet(versionDir: string): CharacterSheet | null {
  const panels = sheetPanels(versionDir);
  if (panels.length < 2) return null;
  const out = path.join(versionDir, CHARACTER_SHEET);
  const newest = Math.max(...panels.map((p) => statSync(p.file).mtimeMs));
  try {
    if (!existsSync(out) || statSync(out).mtimeMs < newest) {
      const scale = panels.map((_, i) => `[${i}:v]scale=-2:${HEIGHT},setsar=1[p${i}]`).join(";");
      execFileSync(ffmpegBin(), ["-y", "-v", "error", ...panels.flatMap((p) => ["-i", p.file]), "-filter_complex", `${scale};${panels.map((_, i) => `[p${i}]`).join("")}hstack=inputs=${panels.length}[out]`, "-map", "[out]", "-frames:v", "1", out], { windowsHide: true });
    }
    return { file: out, panels: panels.map((p) => p.label) };
  } catch {
    return null;
  }
}
