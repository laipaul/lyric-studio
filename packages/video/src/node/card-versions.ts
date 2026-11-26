// Which version of a card each song uses (26 Nov 2026, Paul, "Characters tidy-up": "Edit → new version creates a v2 draft
// copied from v1; v1 stays locked and unchanged for songs that use it. When v2 is locked, ask whether to switch the songs
// using v1 to v2").
//   While v2 is a draft, every song keeps using v1 (cards.ts songVersion: the latest LOCKED version).
//   Locking v2 keeps every song that uses the card on the version it used until then (production.json "versions"), so
//   nothing changes in a song without the user's answer; the page then asks "Switch these songs to v2?". Yes clears the
//   choice (the song follows the newest locked version again); No leaves the song on v1. Each song's Cast can switch later.
// A song "uses" a card when its Cast lists it or its shot list names it (a character in a shot, or the shot's place).
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";

import { cardRoot, getCard, lockCard, readCardFile, usableVersion, type CardFile } from "./characters/cards";
import { readProduction, writeProduction } from "./production";
import { readShotListFile, SHOTLIST_FILE } from "./shotlist";
import { songPathsById } from "./song-folder";

export type SongOnVersion = { id: string; title: string; version: number };
export type LockAsk = { card: string; name: string; from: number; to: number; songs: SongOnVersion[] } | null;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function songRootOf(ws: Workspace, projectId: string): string | null {
  try {
    return songPathsById(ws, projectId).root;
  } catch {
    return null;
  }
}

// Every song that uses this card, with the version it uses.
export function songsUsingCard(ws: Workspace, cardId: string): SongOnVersion[] {
  const row = getCard(ws, cardId);
  const file: CardFile = readCardFile(cardRoot(ws, row));
  const inUse = usableVersion(file)?.n ?? 0;
  const out: SongOnVersion[] = [];
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all()) {
    const root = songRootOf(ws, p.id);
    if (!root) continue;
    const prod = readProduction(root);
    let uses = prod.cast.includes(cardId);
    if (!uses) {
      const sl = readShotListFile(path.join(root, SHOTLIST_FILE));
      uses = !!sl?.slots.some((s) => s.characters.some((n) => same(n, row.name)) || (!!s.scene && same(s.scene, row.name)));
    }
    if (uses) out.push({ id: p.id, title: p.title, version: prod.versions?.[cardId] ?? inUse });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// Lock the card's draft. Songs that used the card keep the version they used (so nothing changes in them yet); the
// answer to ask is returned (null: nothing to ask, e.g. the first version, or no song uses the card).
export function lockForSongs(ws: Workspace, cardId: string): LockAsk {
  const row = getCard(ws, cardId);
  const before = usableVersion(readCardFile(cardRoot(ws, row)))?.n ?? null;
  const songs = before ? songsUsingCard(ws, cardId) : [];
  const file = lockCard(ws, cardId);
  const to = usableVersion(file)!.n;
  const kept: SongOnVersion[] = [];
  for (const s of songs) {
    const root = songRootOf(ws, s.id);
    if (!root) continue;
    const prod = readProduction(root);
    const version = prod.versions?.[cardId] ?? before!;
    writeProduction(root, { ...prod, versions: { ...(prod.versions ?? {}), [cardId]: version } });
    kept.push({ ...s, version });
  }
  return kept.length ? { card: cardId, name: row.name, from: before!, to, songs: kept } : null;
}

// The answer: the songs named switch to the version in use (their choice cleared); the others stay where they are.
// version: a song's own choice in its Cast ("Use v1" / "Use v2"), null = the version in use.
export function setSongCardVersion(ws: Workspace, projectId: string, cardId: string, version: number | null): void {
  const root = songRootOf(ws, projectId);
  if (!root) throw new Error("Song not found.");
  const file = readCardFile(cardRoot(ws, getCard(ws, cardId)));
  const inUse = usableVersion(file)?.n ?? null;
  if (version !== null && !file.versions.some((v) => v.n === version && v.status === "locked")) throw new Error(`Version ${version} is not a locked version of this card.`);
  const prod = readProduction(root);
  const versions = { ...(prod.versions ?? {}) };
  if (version === null || version === inUse) delete versions[cardId];
  else versions[cardId] = version;
  writeProduction(root, { ...prod, versions });
}

export function switchSongs(ws: Workspace, cardId: string, songIds: readonly string[]): number {
  let n = 0;
  for (const id of songIds) {
    setSongCardVersion(ws, id, cardId, null);
    n++;
  }
  return n;
}
