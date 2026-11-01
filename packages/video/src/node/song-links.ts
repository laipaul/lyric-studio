// The song's links in song.json: "links" (the Assets tab) and "postLinks" (the links picked per platform
// on the Post panel). The rest of song.json is kept as it is.
import type { Workspace } from "@lyric/db";

import { checkLinks, type SongLink } from "../song-links";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export function songLinks(ws: Workspace, projectId: string): { links: SongLink[]; postLinks: Record<string, string[]> } {
  const recipe = readRecipe(songPathsById(ws, projectId).recipe);
  return { links: recipe.links ?? [], postLinks: recipe.postLinks ?? {} };
}

// Saves the song's links (checked; a wrong one is named, nothing saved). Picks of links no longer there
// are dropped; a link whose address changed keeps its picks when it stays at the same place in the list.
export function setSongLinks(ws: Workspace, projectId: string, raw: unknown): SongLink[] {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const { links, problems } = checkLinks(raw);
  if (problems.length) throw new Error(problems.join("; "));
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.url)) throw new Error(`${l.url} is in the list twice`);
    seen.add(l.url);
  }
  const recipe = readRecipe(file);
  const before = recipe.links ?? [];
  const moved = new Map<string, string>();
  before.forEach((l, i) => links[i] && links[i].service === l.service && links[i].url !== l.url && moved.set(l.url, links[i].url));
  const postLinks: Record<string, string[]> = {};
  for (const [platform, urls] of Object.entries(recipe.postLinks ?? {})) postLinks[platform] = urls.map((u) => moved.get(u) ?? u).filter((u) => seen.has(u));
  writeRecipe(file, { ...recipe, links: links.length ? links : undefined, postLinks: links.length && Object.keys(postLinks).length ? postLinks : undefined });
  return links;
}

// The links picked for one platform's posts (urls of the song's links); null = back to the default.
export function setPostLinks(ws: Workspace, projectId: string, platform: string, urls: string[] | null): void {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const recipe = readRecipe(file);
  const known = new Set((recipe.links ?? []).map((l) => l.url));
  const postLinks = { ...(recipe.postLinks ?? {}) };
  if (urls === null) delete postLinks[platform];
  else postLinks[platform] = urls.filter((u, i) => known.has(u) && urls.indexOf(u) === i);
  writeRecipe(file, { ...recipe, postLinks: Object.keys(postLinks).length ? postLinks : undefined });
}
