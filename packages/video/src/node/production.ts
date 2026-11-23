// Prepare → Production (G1, 21 Nov 2026, decided with Paul): the song as a small production. Everything the clips are
// made from lives here, step by step and all optional except the shot list:
//   1. the story bible (the song's own, or the EP's bible shared by every song of that EP),
//   2. the cast: character and scene cards LINKED from the one shared library (Characters page), never copied, so a
//      newly locked version reaches every song that uses the card,
//   3. the shot list (C2 import: planned slots in the story line),
// and the Song brief: one text to copy into Claude (Joey's Story Bible Builder and Shotcaller skills), with the
// technical facts the app knows (lyric lines with their times, length, platform sizes, the cast's locked descriptions)
// and the exact shot list format to answer in. What Claude answers is pasted back: a shot list goes to the C2 check and
// import, any other text is offered as the story bible.
//
// Stored in the song folder: production\production.json (the cast, which bible) and production\bible.md; an EP's bible
// in workspace\eps\<EP>\bible.md. A bible that is replaced goes to .studio\replaced\ first (Replaced files, Restore).
// The Storyboard's story idea and story notes are the user's own and never read here.
// No rendering code is imported here, so the studio's server can use it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { listCards, readCardFile, type CardSummary } from "./characters/cards";
import { lookOutfit, MAIN_LOOK, mainLookName } from "./characters/looks";
import { lyricsView } from "./lyrics-view";
import { keepReplaced } from "./project-settings";
import { readRecipe, studioCounts } from "./recipe";
import { readShotListFile, SHOT_TYPES, SHOTLIST_FILE } from "./shotlist";
import { songPathsById } from "./song-folder";
import { songText } from "./textboard";

export const PRODUCTION_DIR = "production";
export const PRODUCTION_FILE = "production.json";
export const BIBLE_FILE = "bible.md";
export const EPS_DIR = "eps";

export type BibleSource = "song" | "ep";
export type ProductionFile = { _help?: string; cast: string[]; bible: BibleSource; looks?: Record<string, string> }; // looks: card id → the look it wears in this song (the Wardrobe)
export type CastCard = { id: string; name: string; kind: "character" | "scene"; status: string; locked: boolean; thumbnail: string; updated_at: string; description: string | null; outfit: string | null; props: string | null; looks: { id: string; name: string; locked: boolean }[]; look: string; lookName: string | null; missing?: false };
export type MissingCard = { id: string; name: string; missing: true };
export type TimedLine = { number: number; text: string; isHook: boolean; startMs: number | null; endMs: number | null };
export type ProductionData = {
  title: string;
  artist: string;
  ep: string | null;
  bible: { source: BibleSource; text: string; epAvailable: boolean; songs: string[] }; // songs: the EP's other songs sharing it
  cast: (CastCard | MissingCard)[];
  library: CastCard[]; // every card of the shared library, for the picker
  shotlist: { slots: number; source: string; imported_at: string; usesCast: string[] } | null;
  timed: boolean; // the lyric lines have times (an alignment is stored)
  sizes: { label: string; ratio: "9:16" | "16:9"; platforms: string[] }[];
};

const HELP =
  "This song's production (Prepare → Production): \"cast\" = the character and scene cards it uses, linked by id from the shared " +
  'library on the Characters page (never copied); "bible" = "song" (production\\bible.md) or "ep" (the EP\'s bible in workspace\\eps\\<EP>\\bible.md); ' +
  '"looks" = which look of its wardrobe each character wears in this song (card id → look id; "main" or missing = the main look).';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const safeFolder = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim() || "EP";

function songRoot(ws: Workspace, projectId: string): string {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return paths.root;
}

export function readProduction(root: string): ProductionFile {
  const file = path.join(root, PRODUCTION_DIR, PRODUCTION_FILE);
  if (!existsSync(file)) return { cast: [], bible: "song" };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as Partial<ProductionFile>;
    const looks = raw.looks && typeof raw.looks === "object" ? Object.fromEntries(Object.entries(raw.looks).filter(([k, v]) => typeof v === "string" && !!k)) : {};
    return {
      cast: Array.isArray(raw.cast) ? [...new Set(raw.cast.filter((x): x is string => typeof x === "string" && !!x))] : [],
      bible: raw.bible === "ep" ? "ep" : "song",
      looks,
    };
  } catch {
    return { cast: [], bible: "song" };
  }
}

function writeProduction(root: string, p: ProductionFile): void {
  mkdirSync(path.join(root, PRODUCTION_DIR), { recursive: true });
  writeFileSync(path.join(root, PRODUCTION_DIR, PRODUCTION_FILE), `${JSON.stringify({ _help: HELP, cast: p.cast, bible: p.bible, ...(p.looks && Object.keys(p.looks).length ? { looks: p.looks } : {}) }, null, 2)}\n`);
}

function songEp(ws: Workspace, projectId: string): string | null {
  const paths = songPathsById(ws, projectId);
  const ep = paths.recipe ? readRecipe(paths.recipe).ep : undefined;
  return typeof ep === "string" && ep.trim() ? ep.trim() : null;
}

export const epBibleFile = (ws: Workspace, ep: string) => path.join(ws.dir, EPS_DIR, safeFolder(ep), BIBLE_FILE);
const songBibleFile = (root: string) => path.join(root, PRODUCTION_DIR, BIBLE_FILE);
const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").replace(/^﻿/, "") : "");

// The bible this song uses now: the EP's when chosen and the song has an EP, else its own.
function bibleOf(ws: Workspace, projectId: string): { source: BibleSource; file: string; ep: string | null } {
  const root = songRoot(ws, projectId);
  const ep = songEp(ws, projectId);
  const p = readProduction(root);
  if (p.bible === "ep" && ep) return { source: "ep", file: epBibleFile(ws, ep), ep };
  return { source: "song", file: songBibleFile(root), ep };
}

function castCard(c: CardSummary, ws: Workspace, lookId: string | null = null): CastCard {
  // The outfit / props of the version in use (the latest locked, else the current draft), read from card.json; for a
  // character, the outfit of the look it wears in this song (the Wardrobe; the main look by default).
  let outfit: string | null = null;
  let props: string | null = null;
  let looks: CastCard["looks"] = [];
  let look = MAIN_LOOK;
  let lookName: string | null = null;
  try {
    const file = readCardFile(path.join(ws.dir, c.folder));
    const used = [...file.versions].reverse().find((v) => v.status === "locked") ?? file.versions[file.versions.length - 1];
    props = used?.props?.trim() || null;
    if (c.kind === "character") {
      const worn = lookOutfit(file, lookId);
      outfit = worn.outfit?.trim() || null;
      look = worn.id;
      looks = [{ id: MAIN_LOOK, name: mainLookName(file), locked: used?.status === "locked" }, ...(file.looks ?? []).map((l) => ({ id: l.id, name: l.name, locked: l.status === "locked" }))];
      lookName = looks.length > 1 ? worn.name : null;
    } else outfit = used?.outfit?.trim() || null;
  } catch {
    // a card folder that cannot be read: shown without outfit
  }
  return { id: c.id, name: c.name, kind: c.kind, status: c.status, locked: c.status === "locked", thumbnail: c.thumbnail, updated_at: new Date(c.updated_at).toISOString(), description: c.description, outfit, props, looks, look, lookName };
}

// The platforms the song makes, grouped by picture shape (what a generated clip should be).
function songSizes(ws: Workspace, projectId: string): ProductionData["sizes"] {
  const paths = songPathsById(ws, projectId);
  const platforms = paths.recipe ? readRecipe(paths.recipe).platforms : undefined; // none chosen: every platform
  const names = Object.keys(studioCounts({ platforms: Array.isArray(platforms) ? platforms : [] }));
  const label: Record<string, string> = { reels: "Reels", tiktok: "TikTok", shorts: "Shorts", youtube: "YouTube", canvas: "Spotify Canvas" };
  const vertical = names.filter((n) => n !== "youtube").map((n) => label[n] ?? n);
  const wide = names.filter((n) => n === "youtube").map((n) => label[n] ?? n);
  return [
    ...(vertical.length ? [{ label: "Vertical", ratio: "9:16" as const, platforms: vertical }] : []),
    ...(wide.length ? [{ label: "Wide", ratio: "16:9" as const, platforms: wide }] : []),
  ];
}

export function productionData(ws: Workspace, projectId: string, timed: TimedLine[] | null = null): ProductionData {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const root = songRoot(ws, projectId);
  const prod = readProduction(root);
  const cards = listCards(ws);
  const library = cards.map((c) => castCard(c, ws));
  const cast = prod.cast.map((id): CastCard | MissingCard => {
    const c = cards.find((x) => x.id === id);
    return c ? castCard(c, ws, prod.looks?.[id] ?? null) : { id, name: "A card that is no longer in the library", missing: true };
  });
  const bible = bibleOf(ws, projectId);
  const ep = bible.ep;
  const epSongs = ep
    ? ws.db
        .select({ id: projectTable.id, title: projectTable.title })
        .from(projectTable)
        .all()
        .filter((s) => s.id !== projectId && songEp(ws, s.id) === ep && readProduction(songRoot(ws, s.id)).bible === "ep")
        .map((s) => s.title)
    : [];
  const sl = readShotListFile(path.join(root, SHOTLIST_FILE));
  const usesCast = sl ? [...new Set(sl.slots.flatMap((s) => [...s.characters, ...(s.scene ? [s.scene] : [])]))] : [];
  return {
    title: p.title,
    artist: p.artist,
    ep,
    bible: { source: bible.source, text: readText(bible.file), epAvailable: !!ep, songs: epSongs },
    cast,
    library,
    shotlist: sl ? { slots: sl.slots.length, source: sl.source, imported_at: sl.imported_at, usesCast } : null,
    timed: !!timed?.some((l) => l.startMs !== null),
    sizes: songSizes(ws, projectId),
  };
}

// The cast: card ids from the shared library, in the order given (unknown ids are refused).
export function setCast(ws: Workspace, projectId: string, ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) throw new Error("The cast must be a list of cards.");
  const known = new Set(listCards(ws).map((c) => c.id));
  const unknown = (ids as string[]).filter((id) => !known.has(id));
  if (unknown.length) throw new Error("A card in the cast is no longer in the library: reload the page and try again.");
  const root = songRoot(ws, projectId);
  const cast = [...new Set(ids as string[])];
  writeProduction(root, { ...readProduction(root), cast });
  return cast;
}

// The look a cast character wears in this song (the Wardrobe): "main" = the pack's own outfit.
export function setCastLook(ws: Workspace, projectId: string, cardId: unknown, lookId: unknown): string {
  if (typeof cardId !== "string" || typeof lookId !== "string") throw new Error("Choose a character and a look.");
  const root = songRoot(ws, projectId);
  const prod = readProduction(root);
  if (!prod.cast.includes(cardId)) throw new Error("This character is not in the song's cast.");
  const card = listCards(ws).find((c) => c.id === cardId);
  if (!card) throw new Error("This card is no longer in the library.");
  const file = readCardFile(path.join(ws.dir, card.folder));
  if (lookId !== MAIN_LOOK && !(file.looks ?? []).some((l) => l.id === lookId)) throw new Error("This look is no longer in the wardrobe: reload the page.");
  const looks = { ...(prod.looks ?? {}) };
  if (lookId === MAIN_LOOK) delete looks[cardId];
  else looks[cardId] = lookId;
  writeProduction(root, { ...prod, looks });
  return lookId;
}

// Which bible the song uses: its own, or its EP's (shared with every song of the EP that chooses it).
export function setBibleSource(ws: Workspace, projectId: string, source: unknown): BibleSource {
  if (source !== "song" && source !== "ep") throw new Error('The bible is "song" or "ep".');
  if (source === "ep" && !songEp(ws, projectId)) throw new Error("This song has no EP yet: set its EP in Song Details first.");
  const root = songRoot(ws, projectId);
  writeProduction(root, { ...readProduction(root), bible: source });
  return source;
}

// Saves the bible text into the bible the song uses now (the earlier text goes to Replaced files first).
// `only`: "song" writes the song's own bible whatever the song uses (Restore from Replaced files).
export function saveBible(ws: Workspace, projectId: string, text: unknown, only?: "song"): { source: BibleSource; changed: boolean } {
  if (typeof text !== "string") throw new Error("The bible must be text.");
  const { source, file } = only === "song" ? { source: "song" as const, file: songBibleFile(songRoot(ws, projectId)) } : bibleOf(ws, projectId);
  const next = text.replace(/\r\n/g, "\n").trim();
  const before = readText(file).trim();
  if (before === next) return { source, changed: false };
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && before) keepReplaced(source === "song" ? songRoot(ws, projectId) : path.dirname(file), file);
  writeFileSync(file, next ? `${next}\n` : "");
  return { source, changed: true };
}

// ---------------------------------------------------------------- the Song brief

// The lyric lines as the next video has them (stored alignment + hand-set starts), or null when not timed yet.
export async function timedLines(ws: Workspace, projectId: string): Promise<TimedLine[] | null> {
  const v = await lyricsView(ws, projectId).catch(() => null);
  if (!v?.lines) return null;
  return v.lines.map((l) => ({ number: l.number, text: l.text, isHook: l.isHook, startMs: l.startMs, endMs: l.sungEndMs ?? l.screen.leaveMs }));
}

const clock = (ms: number | null) => {
  if (ms === null) return "?";
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

function cardBlock(c: CastCard): string {
  const parts = [`- **${c.name}** (${c.kind === "character" ? "character" : "scene"}${c.locked ? "" : ", not locked yet"})`];
  if (c.description) parts.push(`  - Looks: ${c.description.replace(/\s+/g, " ").trim()}`);
  if (c.outfit) parts.push(`  - Outfit${c.lookName ? ` (look: ${c.lookName})` : ""}: ${c.outfit.replace(/\s+/g, " ").trim()}`);
  if (c.props) parts.push(`  - Props that must not change: ${c.props.replace(/\s+/g, " ").trim()}`);
  // The wardrobe (23 Nov 2026): the looks a shot can name in "looks".
  if (c.kind === "character" && c.looks.length > 1) parts.push(`  - Wardrobe (for "looks"): ${c.looks.map((l) => `${l.name}${l.locked ? "" : " (not locked)"}`).join(", ")}`);
  return parts.join("\n");
}

// One Markdown text with what Claude needs to write the bible (when there is none) and the shot list: the technical
// facts come from the app; the story and the shots are Paul's (with Claude). `timed`: the lyric lines with their times.
export function songBrief(ws: Workspace, projectId: string, timed: TimedLine[] | null): string {
  const d = productionData(ws, projectId, timed);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
  const lines: TimedLine[] = timed ?? songText(ws, projectId).lines.map((l) => ({ number: l.number, text: l.text, isHook: l.isHook, startMs: null, endMs: null }));
  const cast = d.cast.filter((c): c is CastCard => !c.missing);
  const characters = cast.filter((c) => c.kind === "character");
  const scenes = cast.filter((c) => c.kind === "scene");
  const out: string[] = [];
  out.push(`# Song brief: ${d.title}`, "");
  out.push(`Artist: ${d.artist}${d.ep ? ` · EP: ${d.ep}` : ""}${p.duration_ms ? ` · Length: ${clock(p.duration_ms)}` : ""}${p.bpm ? ` · Tempo: ${Math.round(p.bpm)} BPM` : ""}`);
  out.push(`Picture: ${d.sizes.length ? d.sizes.map((s) => `${s.ratio} (${s.platforms.join(", ")})`).join(" and ") : "9:16 (Reels, TikTok, Shorts)"}. No sound in the clips: the song is the only audio.`, "");
  out.push("## What I need from you", "");
  out.push(
    "Use the Story Bible Builder skill (only if there is no story bible below) and the Shotcaller skill to plan the clips of this lyric video.",
    "Every clip is made with Seedance 2.5 (text or image to video, 4 to 10 s each, one continuous shot, no cuts, no text on screen).",
    "My app sets the length, size and sound of each clip itself, so please do not put those in the shot list.",
    "",
    "Answer with **only** the shot list as JSON (one code block), in this format:",
    "",
    "```json",
    "{",
    '  "slots": [',
    `    { "id": "s01", "order": 1, "shows": "one sentence: what happens in this shot", "characters": [${characters.length ? `"${characters[0].name}"` : ""}], "scene": ${scenes.length ? `"${scenes[0].name}"` : "null"}, "shot": "wide", "line": 1 }`,
    "  ]",
    "}",
    "```",
    "",
    `- **id**: s01, s02, … (keep the same id when you change a shot later). **order**: its place in the video, 1 = first.`,
    `- **shot**: one of ${SHOT_TYPES.join(", ")}. **line**: the lyric line number below where the shot starts (one shot per line at most; leave it out for an instrumental part).`,
    `- **characters** and **scene**: only names from the cast below, spelled exactly as written.${cast.length ? "" : " (The cast is empty: leave them out, or tell me which characters to make first.)"}`,
    `- Optional: **looks** (which look of their wardrobe each character wears in this shot, by name, e.g. { "Jennifer": "Wedding Dress" }; without it, the look they wear in this song), **outfit** (a change for this shot only, when no look fits), **tag** (a word to group shots, e.g. "chorus").`,
    "- If you also write a story bible, give it to me as a second, separate Markdown answer.",
    "",
  );
  out.push("## Lyrics with times", "");
  if (!lines.length) out.push("(No lyrics yet: this is an instrumental, or the lyrics are not added yet.)");
  else {
    if (!d.timed) out.push("(The lines are not timed yet: use the order of the lines.)", "");
    let prevEnd = 0;
    for (const l of lines) {
      if (l.startMs !== null && l.startMs - prevEnd >= 4000) out.push(`- (instrumental ${clock(prevEnd)}–${clock(l.startMs)})`);
      out.push(`- **${l.number}.** ${l.startMs !== null ? `${clock(l.startMs)}–${clock(l.endMs)} · ` : ""}${l.text}${l.isHook ? " _(hook)_" : ""}`);
      if (l.endMs !== null) prevEnd = l.endMs;
      else if (l.startMs !== null) prevEnd = l.startMs;
    }
    if (d.timed && p.duration_ms && p.duration_ms - prevEnd >= 4000) out.push(`- (instrumental ${clock(prevEnd)}–${clock(p.duration_ms)}, end of the song)`);
  }
  out.push("");
  out.push("## Cast (from my character library)", "");
  out.push(cast.length ? cast.map(cardBlock).join("\n") : "(No cast chosen yet.)", "");
  out.push("## Story bible", "");
  out.push(d.bible.text.trim() ? d.bible.text.trim() : "(None yet. If it helps, write one first with the Story Bible Builder skill, then the shot list.)", "");
  return `${out.join("\n").trimEnd()}\n`;
}

// What a pasted answer is: a shot list (JSON with slots, also inside a ```json block) or a story bible (other text).
export function readPasted(text: string): { kind: "shotlist"; json: string; slots: number } | { kind: "bible"; text: string } | { kind: "empty" } {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return { kind: "empty" };
  const candidates = [t, ...[...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim())];
  const brace = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (brace >= 0 && end > brace) candidates.push(t.slice(brace, end + 1));
  for (const c of candidates) {
    try {
      const raw = JSON.parse(c) as unknown;
      const slots = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { slots?: unknown }).slots : undefined;
      if (Array.isArray(slots)) return { kind: "shotlist", json: JSON.stringify(Array.isArray(raw) ? { slots } : raw, null, 2), slots: slots.length };
    } catch {
      // not JSON: try the next form
    }
  }
  return { kind: "bible", text: t };
}

export const isCastName = (cast: readonly { name: string }[], name: string) => cast.some((c) => same(c.name, name));
