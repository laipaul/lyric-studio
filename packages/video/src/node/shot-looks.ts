// The look each person wears in a shot (23 Nov 2026, Paul: "on the storyboard I should see the right wardrobe of each
// character"). A shot can name a look per character (shotlist.json slot "looks": { "Jennifer": "Autumn City" }, from the
// shot list or chosen in Creation → Production); otherwise the look the character wears in this song (Story room →
// Cast, production.json "looks"), else the main look. One place decides it, so the Storyboard card, the Midjourney
// prompt (its outfit) and the Omni Reference picture always agree.
import { existsSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { cardRoot, listCards, readCardFile, songPicture, songVersion, type CardSummary } from "./characters/cards";
import { LOOKS_DIR, MAIN_LOOK, lookOutfit, mainLookName } from "./characters/looks";
import { readProduction } from "./production";
import { songPathsById } from "./song-folder";

export type WornLook = {
  character: string; // as the card spells it (or as written, when there is no card)
  card: string | null; // card id
  look: string; // the look's name ("Wedding Dress", "Main look")
  lookId: string;
  fromShot: boolean; // chosen for this shot (else the song's look)
  locked: boolean;
  outfit: string | null;
  picture: string | null; // inside the card's folder: the look's close-up, else its front view, else the card's picture
  viewDir?: string; // the card version this song uses ("v1"): its face views (side profile, 3/4, teeth) for the sheets
  looks: string[]; // every look of the character's wardrobe (Production's dropdown)
  problem: string | null; // in plain words: no card, a look name the card does not have, a look not locked yet
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// For one song: a function giving the looks worn in a shot.
export function shotLooks(ws: Workspace, projectId: string): (slot: { characters: string[]; looks?: Record<string, string> }) => WornLook[] {
  const cards = listCards(ws).filter((c) => c.kind === "character");
  const root = songPathsById(ws, projectId).root;
  const prod = readProduction(root);
  const songLooks = prod.looks ?? {};
  return (slot) =>
    slot.characters.map((name): WornLook => {
      const c: CardSummary | undefined = cards.find((x) => same(x.name, name));
      if (!c) return { character: name, card: null, look: "", lookId: MAIN_LOOK, fromShot: false, locked: false, outfit: null, picture: null, looks: [], problem: `${name} has no character card any more.` };
      const croot = cardRoot(ws, c);
      let file;
      try {
        file = readCardFile(croot);
      } catch {
        return { character: c.name, card: c.id, look: "", lookId: MAIN_LOOK, fromShot: false, locked: false, outfit: null, picture: c.picture, looks: [], problem: `${c.name}'s card cannot be read.` };
      }
      const main = mainLookName(file);
      const looks = [main, ...(file.looks ?? []).map((l) => l.name)];
      const asked = Object.entries(slot.looks ?? {}).find(([k]) => same(k, c.name))?.[1];
      const byName = (n: string) => (same(n, main) ? MAIN_LOOK : (file.looks ?? []).find((l) => same(l.name, n))?.id ?? null);
      let problem: string | null = null;
      let id: string = songLooks[c.id] ?? MAIN_LOOK;
      let fromShot = false;
      if (asked) {
        const found = byName(asked);
        if (found) {
          id = found;
          fromShot = true;
        } else problem = `${c.name} has no look "${asked}" (looks: ${looks.join(", ")}): the song's look is used.`;
      }
      if (id !== MAIN_LOOK && !(file.looks ?? []).some((l) => l.id === id)) id = MAIN_LOOK; // a look removed since
      const song = songPicture(croot, file, prod.versions?.[c.id] ?? null);
      const worn = lookOutfit(file, id, songVersion(file, prod.versions?.[c.id] ?? null));
      const look = id === MAIN_LOOK ? undefined : (file.looks ?? []).find((l) => l.id === id);
      const locked = id === MAIN_LOOK ? c.status === "locked" : look?.status === "locked";
      // Not locked: a character with one look says it plainly (as before); a wardrobe look is named.
      if (!problem && !locked) problem = id === MAIN_LOOK ? `${c.name} (not locked yet)` : `${c.name}'s look "${worn.name}" is not locked yet: lock it before the pictures are made.`;
      let picture: string | null = song.picture;
      if (id !== MAIN_LOOK) for (const f of ["closeup.png", "body_front.png"]) if (existsSync(path.join(croot, LOOKS_DIR, id, f))) {
        picture = `${LOOKS_DIR}/${id}/${f}`;
        break;
      }
      return { character: c.name, card: c.id, look: worn.name, lookId: id, fromShot, locked, outfit: worn.outfit, picture, viewDir: song.viewDir, looks, problem };
    });
}
