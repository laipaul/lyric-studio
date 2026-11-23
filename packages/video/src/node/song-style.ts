// Song style per song (song-style.ts): read and set song.json "songStyle".
import type { Workspace } from "@lyric/db";

import { effectiveSongStyle, isSongStyle, type SongStyle } from "../song-style";
import { readRecipe, writeRecipe, type SongRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export type SongStyleView = { style: SongStyle; chosen: boolean; singingLines: number };

export function singingLineCount(recipe: SongRecipe): number {
  return (recipe.anchors ?? []).filter((a) => a.sync !== undefined).length;
}

export function styleOfRecipe(recipe: SongRecipe): SongStyleView {
  const singingLines = singingLineCount(recipe);
  return { style: effectiveSongStyle(recipe.songStyle, singingLines), chosen: !!recipe.songStyle, singingLines };
}

export function songStyle(ws: Workspace, projectId: string): SongStyleView {
  return styleOfRecipe(readRecipe(songPathsById(ws, projectId).recipe));
}

export function setSongStyle(ws: Workspace, projectId: string, raw: unknown): SongStyleView {
  if (!isSongStyle(raw)) throw new Error('The song style must be "cut", "singing" or "film".');
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet.");
  const recipe = readRecipe(file);
  writeRecipe(file, { ...recipe, songStyle: raw });
  return styleOfRecipe({ ...recipe, songStyle: raw });
}

// A Mini film (song style "film", 23 Nov 2026): it makes only its two films (Film 9:16 for Instagram, Film 16:9 for
// YouTube), each the whole song shot by shot (film-plan.ts); a part chosen by hand still wins. Instrumentals and other
// songs: false.
export function isWholeStory(recipe: SongRecipe, instrumental: boolean): boolean {
  return !instrumental && styleOfRecipe(recipe).style === "film";
}

