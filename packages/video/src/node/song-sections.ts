// The song's sections (sections.ts): the saved list (song.json "sections") or the app's suggestion from lyrics.txt.
import { existsSync, readFileSync } from "node:fs";

import type { Workspace } from "@lyric/db";

import { cleanSections, nameSections, suggestSections, type NamedSection, type SongSection } from "../sections";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export type SectionsView = { sections: NamedSection[]; saved: boolean; suggestion: SongSection[]; lineCount: number };

function lyricsOf(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function songSections(ws: Workspace, projectId: string): SectionsView {
  const paths = songPathsById(ws, projectId);
  const text = lyricsOf(paths.lyricsTxt);
  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const suggestion = suggestSections(text);
  const saved = cleanSections(readRecipe(paths.recipe).sections, lineCount);
  const list = saved.length ? saved : suggestion;
  return { sections: nameSections(list, lineCount), saved: saved.length > 0, suggestion, lineCount };
}

// Saves the whole list (null or []: back to the app's suggestion). The rest of song.json is kept.
export function setSongSections(ws: Workspace, projectId: string, raw: unknown): SectionsView {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet.");
  const lineCount = songSections(ws, projectId).lineCount;
  const list = raw === null ? [] : cleanSections(raw, lineCount);
  if (raw !== null && Array.isArray(raw) && raw.length && !list.length) throw new Error("No section could be kept: each needs a line of the song and a kind (verse, chorus, bridge...).");
  const { sections: _old, ...rest } = readRecipe(file);
  writeRecipe(file, list.length ? { ...rest, sections: list } : rest);
  return songSections(ws, projectId);
}
