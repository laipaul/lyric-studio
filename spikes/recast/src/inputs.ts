// The song's Storyboard clips and the character's pictures, read through the app's own code (the same story line and
// numbers as Prepare → Storyboard; the same card folders as the Characters page). Nothing here writes into the song
// folder or the card: the clips and pictures are only read.
import { existsSync } from "node:fs";
import path from "node:path";

import { openWorkspace, project as projectTable, type Workspace } from "../../../packages/db/src/index";
import { folderClips, songClipsCollection } from "../../../packages/video/src/node/assets";
import { cardRoot, cardThresholds, listCards, readCardFile, versionDir } from "../../../packages/video/src/node/characters/cards";
import { songPathsById } from "../../../packages/video/src/node/song-folder";
import { songStory } from "../../../packages/video/src/node/story-line";
import type { Refs } from "./methods";

export type StoryClip = { position: number; name: string; file: string; collection: string | null; kind: "video" | "photo"; omit: boolean };
export type SongClips = { id: string; title: string; items: { position: number; kind: "clip" | "slot" | "card"; label: string; clip?: StoryClip }[] };

export function open(wsDir: string): Workspace {
  return openWorkspace(wsDir);
}

// The song by its title (or part of it, when only one matches) or id.
export function findSong(ws: Workspace, query: string): { id: string; title: string } {
  const all = ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all();
  const q = query.trim().toLowerCase();
  const exact = all.filter((p) => p.id === query.trim() || p.title.toLowerCase() === q);
  const found = exact.length ? exact : all.filter((p) => p.title.toLowerCase().includes(q));
  if (!found.length) throw new Error(`No song matches "${query}". Songs: ${all.map((p) => p.title).join(", ") || "(none)"}`);
  if (found.length > 1) throw new Error(`"${query}" matches several songs: ${found.map((p) => p.title).join(", ")}. Type more of the title.`);
  return found[0];
}

export async function songClips(ws: Workspace, query: string): Promise<SongClips> {
  const song = findSong(ws, query);
  const clipsDir = songPathsById(ws, song.id).clips;
  if (!clipsDir) throw new Error(`"${song.title}" has no song folder yet (pnpm songs:migrate --apply first).`);
  const own = existsSync(clipsDir) ? (await folderClips(ws, clipsDir, songClipsCollection(song.id))).clips : [];
  const story = await songStory(ws, song.id, own);
  return {
    id: song.id,
    title: song.title,
    items: story.items.map((it, i) => {
      const position = i + 1;
      if (it.clip)
        return { position, kind: "clip" as const, label: it.clip.name, clip: { position, name: it.clip.name, file: path.join(ws.dir, it.clip.file), collection: it.clip.collection ?? null, kind: it.clip.kind, omit: !!it.clip.omit } };
      if (it.slot) return { position, kind: "slot" as const, label: `slot ${it.slot.id} (no picture yet)` };
      return { position, kind: "card" as const, label: `${it.card?.collection} (the app picks)` };
    }),
  };
}

// Splits a list option. PowerShell hands an unquoted 7,9,10 over as "7 9 10", so a spec of only digits, commas and
// spaces splits on both; anything else (clip file names may contain spaces) splits on commas only.
export function splitList(spec: string): string[] {
  const parts = /^[\d,\s]*$/.test(spec) ? spec.split(/[\s,]+/) : spec.split(",");
  return parts.map((s) => s.trim()).filter(Boolean);
}

// --clips 7,9,10 (the numbers on the Storyboard cards) | names | all (every video clip, not the omitted ones).
export function pickClips(s: SongClips, spec: string | undefined): StoryClip[] {
  if (!spec?.trim()) throw new Error("Which clips? --clips 7,9,10 (the numbers on the Storyboard cards), file names, or all. --list shows them.");
  const clips = s.items.flatMap((i) => (i.clip ? [i.clip] : []));
  if (spec.trim().toLowerCase() === "all") return clips.filter((c) => c.kind === "video" && !c.omit);
  return splitList(spec).map((x) => {
    if (/^\d+$/.test(x)) {
      const it = s.items.find((i) => i.position === Number(x));
      if (!it) throw new Error(`There is no card ${x} on ${s.title}'s Storyboard (it has ${s.items.length}).`);
      if (!it.clip) throw new Error(`Card ${x} is ${it.label}, not a clip.`);
      if (it.clip.kind !== "video") throw new Error(`Card ${x} (${it.clip.name}) is a photo: recast takes video clips.`);
      return it.clip;
    }
    const c = clips.find((c) => c.name.toLowerCase() === x.toLowerCase());
    if (!c) throw new Error(`No clip "${x}" on ${s.title}'s Storyboard. --list shows them.`);
    return c;
  });
}

export type Character = { name: string; version: number; refs: Refs; greenFrom: number; thresholdsSource: string };

// The character's close-up, 3/4 face and reference picture of its latest LOCKED version (or --card-version N).
// Never the full-body views (Paul, 18 Nov 2026: v1's front view has the wrong buttons and no veil).
export function character(ws: Workspace, name: string, version?: number): Character {
  const c = listCards(ws).find((x) => x.kind === "character" && x.name.toLowerCase() === name.trim().toLowerCase());
  if (!c) throw new Error(`No character called "${name}" on the Characters page (${listCards(ws).filter((x) => x.kind === "character").map((x) => x.name).join(", ") || "none yet"}).`);
  const root = cardRoot(ws, c);
  const file = readCardFile(root);
  const v = version !== undefined ? file.versions.find((x) => x.n === version) : [...file.versions].reverse().find((x) => x.status === "locked");
  if (!v) throw new Error(version !== undefined ? `${c.name} has no version ${version}.` : `${c.name} has no locked version yet: lock it on the Characters page first.`);
  if (v.status !== "locked") console.log(`Note: ${c.name} v${v.n} is not locked yet.`);
  const dir = versionDir(root, v.n);
  const refs: Refs = { closeup: path.join(dir, "closeup.png"), threeQuarter: path.join(dir, "three_quarter.png"), reference: path.join(root, file.reference) };
  for (const [k, f] of Object.entries(refs)) if (!existsSync(f)) throw new Error(`${c.name} v${v.n} has no ${k === "threeQuarter" ? "3/4 face" : k} picture (${f}).`);
  const t = cardThresholds(root);
  return { name: c.name, version: v.n, refs, greenFrom: t.green_from, thresholdsSource: t.source };
}
