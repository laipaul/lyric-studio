// The song's links in song.json: "links" (the Assets tab) and "postLinks" (the links picked per platform
// on the Post panel). The rest of song.json is kept as it is.
import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkLinks, detectService, normaliseUrl, type SongLink } from "../song-links";
import { cleanTags, rankedTags, suggestTags, TAG_LIMITS, TAG_PLATFORM_LABEL, tagsFor, type RankedTag, type TagSuggestion } from "../song-tags";
import { brandTagSettings } from "./brand";
import { songEp } from "./project-settings";
import { keepReplaced } from "./project-settings";
import { readRecipe, writeRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export function songLinks(ws: Workspace, projectId: string): { links: SongLink[]; postLinks: Record<string, string[]> } {
  const recipe = readRecipe(songPathsById(ws, projectId).recipe);
  return { links: recipe.links ?? [], postLinks: recipe.postLinks ?? {} };
}

// Saves the song's links (checked; a wrong one is named, nothing saved). Picks of links no longer there
// are dropped; a link whose address changed keeps its picks when it stays at the same place in the list.
export function setSongLinks(ws: Workspace, projectId: string, raw: unknown, extraPicks: Record<string, string[]> = {}): SongLink[] {
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
  // The song.json before a change of the links is kept (copy) in .studio\replaced\<date>-song.json: nothing the user made is lost.
  if (existsSync(file) && JSON.stringify(before) !== JSON.stringify(links)) keepReplaced(path.dirname(file), file, true);
  const moved = new Map<string, string>();
  before.forEach((l, i) => links[i] && links[i].service === l.service && links[i].url !== l.url && moved.set(l.url, links[i].url));
  const postLinks: Record<string, string[]> = {};
  for (const [platform, urls] of Object.entries(recipe.postLinks ?? {})) postLinks[platform] = urls.map((u) => moved.get(u) ?? u).filter((u) => seen.has(u));
  for (const [platform, urls] of Object.entries(extraPicks)) {
    const have = (postLinks[platform] ??= []);
    for (const u of urls) if (seen.has(u) && !have.includes(u)) have.push(u);
  }
  writeRecipe(file, { ...recipe, links: links.length ? links : undefined, postLinks: links.length && Object.keys(postLinks).length ? postLinks : undefined });
  return links;
}

export type LinkOp =
  | { op: "add"; url: string; service?: string; label?: string }
  | { op: "update"; url: string; patch: { url?: string; service?: string; label?: string | null } }
  | { op: "remove"; url: string }
  | { op: "restore"; link: SongLink; index?: number; picks?: string[] };

// One change to the list, applied to the list as it is in song.json NOW (not to a copy the page holds):
// adding a link always appends a new row, and no change can drop a link it was not about.
// Returns the list and, for "remove", the platforms whose Post picks had that link (so Undo can give them back).
export function changeSongLinks(ws: Workspace, projectId: string, op: LinkOp): { links: SongLink[]; removedPicks?: string[] } {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const recipe = readRecipe(file);
  const now = [...(recipe.links ?? [])];
  const norm = (u: string) => normaliseUrl(u) ?? u;
  const at = (u: string) => {
    const i = now.findIndex((l) => l.url === norm(u));
    if (i < 0) throw new Error("That link is not in the list any more.");
    return i;
  };
  if (op.op === "add") {
    const url = normaliseUrl(op.url);
    if (!url) throw new Error(`"${String(op.url).trim()}" is not a web address`);
    if (now.some((l) => l.url === url)) throw new Error("That link is already in the list");
    now.push({ service: op.service ?? detectService(url) ?? "website", url, ...(op.label?.trim() ? { label: op.label.trim() } : {}) });
    return { links: setSongLinks(ws, projectId, now) };
  }
  if (op.op === "update") {
    const i = at(op.url);
    const { label, ...rest } = op.patch;
    const next: SongLink = { ...now[i], ...rest };
    if (rest.url !== undefined) next.url = normaliseUrl(rest.url) ?? rest.url;
    if (label !== undefined) {
      if (label?.trim()) next.label = label.trim();
      else delete next.label;
    }
    if (rest.service !== undefined && rest.service !== "other" && label === undefined) delete next.label;
    now[i] = next;
    return { links: setSongLinks(ws, projectId, now) };
  }
  if (op.op === "remove") {
    const i = at(op.url);
    const removedPicks = Object.entries(recipe.postLinks ?? {}).filter(([, urls]) => urls.includes(now[i].url)).map(([p]) => p);
    now.splice(i, 1);
    return { links: setSongLinks(ws, projectId, now), removedPicks };
  }
  const { links: back, problems } = checkLinks([op.link]);
  if (problems.length) throw new Error(problems.join("; "));
  if (now.some((l) => l.url === back[0].url)) return { links: now };
  now.splice(Math.max(0, Math.min(op.index ?? now.length, now.length)), 0, back[0]);
  const picks: Record<string, string[]> = {};
  for (const p of op.picks ?? []) picks[p] = [back[0].url];
  return { links: setSongLinks(ws, projectId, now, picks) };
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

// The song's tags (Prepare → Song Details → Tags): the ranked list with the brand's tags, the suggestions and what
// each platform's post uses (the top ones; song-tags.ts TAG_LIMITS).
export type SongTagsView = {
  tags: RankedTag[];
  brand: { tags: string[]; starters: string[]; file: string; set: boolean };
  suggestions: (TagSuggestion & { added: boolean })[];
  previews: { platform: string; label: string; limit: number; uses: string[] }[];
};
export function songTags(ws: Workspace, projectId: string): SongTagsView {
  const paths = songPathsById(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const brand = brandTagSettings(ws.dir, p.artist);
  const tags = rankedTags(readRecipe(paths.recipe).tags, brand.tags);
  const list = tags.map((t) => t.tag);
  const lyrics = paths.lyricsTxt && existsSync(paths.lyricsTxt) ? readFileSync(paths.lyricsTxt, "utf8") : "";
  const suggestions = suggestTags({ artist: p.artist, song: p.title, ep: songEp(ws, projectId) ?? null, lyrics, starters: brand.starters })
    .filter((s) => !brand.tags.includes(s.tag))
    .map((s) => ({ ...s, added: list.includes(s.tag) }));
  const previews = ["reels", "tiktok", "shorts", "youtube"].map((platform) => ({ platform, label: TAG_PLATFORM_LABEL[platform], limit: TAG_LIMITS[platform], uses: tagsFor(list, platform) }));
  return { tags, brand, suggestions, previews };
}

// The list the Post panel and publish.txt use: the song's ranked tags with the brand's.
export function songTagList(ws: Workspace, projectId: string, artist: string): string[] {
  return rankedTags(readRecipe(songPathsById(ws, projectId).recipe).tags, brandTagSettings(ws.dir, artist).tags).map((t) => t.tag);
}

// Saves the song's ranked list (cleaned: lowercase, no spaces or accents, no duplicates); brand tags may be placed
// in it (they are added at the end otherwise). Empty: only the brand's tags.
export function setSongTags(ws: Workspace, projectId: string, raw: unknown): string[] {
  const file = songPathsById(ws, projectId).recipe;
  if (!file) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  const tags = cleanTags(raw);
  const { tags: _old, ...rest } = readRecipe(file);
  writeRecipe(file, tags.length ? { ...rest, tags } : rest);
  return tags;
}
