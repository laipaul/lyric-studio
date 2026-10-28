// The song's textboard.json (the text layer: title, byline, tagline and lyric cards with their looks)
// and the text templates (workspace\templates\<artist>\<name>.json: the design without the words).
// A song without textboard.json uses the brand's defaults: its videos look exactly as before.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { parseEffectChoice } from "../effects/names";
import type { FontFileRef } from "../font-files";
import { HOOK_MARKER } from "../lrc";
import type { LyricArea } from "../platform";
import type { TextCardProps, TitleOverlayProps } from "../props";
import {
  applyTemplate,
  boardFile,
  cardCenterY,
  checkStyle,
  checkTemplate,
  checkTextboard,
  overrideCount,
  ROLES,
  setCardOverrides,
  syncBoard,
  toTemplate,
  type CardOverrides,
  type CardPosition,
  type CardStyle,
  type Role,
  type SongText,
  type TextCard,
  type Textboard,
  type TextTemplate,
} from "../textboard";
import { fontFileRefs, forText, resolveFont, type FontCatalog } from "./font-catalog";
import { readRecipe } from "./recipe";
import { folderName, songPathsById } from "./song-folder";

export const TEXTBOARD_FILE = "textboard.json";
export const TEMPLATES_DIR = "templates";

const HELP =
  "The text layer of this song (the Storyboard tab writes it): every card (title, byline, tagline, each lyric line) in order, and per card " +
  'only what differs from the brand and the recipe ("overrides": position lyrics | with-title | top | upper | centre | lower, size 0.5-2, ' +
  'hold seconds, effect "name[:intensity]", font, weight, italic; title / byline / tagline also text and show). "roles": rules per kind of ' +
  'card (title, byline, tagline, verse, hook), e.g. { "hook": { "size": 1.2 } }. Timing always comes from the lyric alignment.';

export function readTextboard(songRoot: string): Textboard | null {
  const file = path.join(songRoot, TEXTBOARD_FILE);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message})`);
  }
  const { board, problems } = checkTextboard(raw);
  if (problems.length) throw new Error(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);
  return board;
}

export function writeTextboard(songRoot: string, board: Textboard): void {
  writeFileSync(path.join(songRoot, TEXTBOARD_FILE), `${JSON.stringify({ _help: HELP, ...boardFile(board) }, null, 2)}\n`);
}

export const textboardHash = (board: Textboard) => createHash("sha256").update(JSON.stringify(boardFile(board))).digest("hex").slice(0, 12);

// lyrics.txt as the Lyrics tab numbers it (sung lines counted, blank lines not); a line with the same
// words as a "* " line is a hook too.
export function lyricsLines(lyricsTxt: string): SongText["lines"] {
  const rows = lyricsTxt.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const marked = rows.map((r) => HOOK_MARKER.test(r));
  const texts = rows.map((r) => r.replace(HOOK_MARKER, ""));
  const hookWords = new Set(texts.filter((_, i) => marked[i]).map((t) => t.toLowerCase()));
  return texts.map((text, i) => ({ number: i + 1, text, isHook: marked[i] || hookWords.has(text.toLowerCase()) }));
}

// The song's text as it is now (title, artist, EP and lyrics.txt).
export function songText(ws: Workspace, projectId: string): SongText {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  const ep = paths.recipe ? readRecipe(paths.recipe).ep : undefined;
  return { title: p.title, artist: p.artist, ep: ep ?? null, lines: existsSync(paths.lyricsTxt) ? lyricsLines(readFileSync(paths.lyricsTxt, "utf8")) : [] };
}

// ---------------------------------------------------------------- templates

export function templatesDir(workspaceDir: string, artist: string): string {
  return path.join(workspaceDir, TEMPLATES_DIR, folderName(artist));
}

export function listTemplates(workspaceDir: string, artist: string): { name: string; file: string }[] {
  const dir = templatesDir(workspaceDir, artist);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((f) => ({ name: f.replace(/\.json$/i, ""), file: path.join(dir, f) }));
}

export function loadTemplate(workspaceDir: string, artist: string, name: string): TextTemplate {
  const found = listTemplates(workspaceDir, artist).find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`No text template "${name}" for ${artist} (${templatesDir(workspaceDir, artist)}).`);
  const { template, problems } = checkTemplate(JSON.parse(readFileSync(found.file, "utf8")), found.file);
  if (problems.length) throw new Error(`Problems in ${found.file}:\n  - ${problems.join("\n  - ")}`);
  return { ...template, name: found.name };
}

export function saveTemplate(workspaceDir: string, artist: string, name: string, board: Textboard, now = new Date()): { file: string; left: number } {
  const clean = folderName(name.trim());
  if (!clean) throw new Error("Give the template a name.");
  const { template, left } = toTemplate(board, clean, artist, now);
  const dir = templatesDir(workspaceDir, artist);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${clean}.json`);
  writeFileSync(file, `${JSON.stringify({ _help: "A text template (Storyboard → Save as template): the textboard's design without the words.", ...template }, null, 2)}\n`);
  return { file, left };
}

// ---------------------------------------------------------------- the Storyboard tab

export type TextboardData = {
  file: string | null; // workspace-relative textboard.json (null: not made yet: the brand's defaults)
  template: string | null;
  roles: Partial<Record<Role, CardStyle>>;
  cards: TextCard[];
  orphans: { id: string; text: string }[]; // cards whose words are gone (their changes are not used)
  templates: string[]; // the artist's templates
  artist: string;
};

export function textboardData(ws: Workspace, projectId: string): TextboardData {
  const paths = songPathsById(ws, projectId);
  const song = songText(ws, projectId);
  const stored = paths.legacy ? null : readTextboard(paths.root);
  const { board, orphans } = syncBoard(stored, song);
  return {
    file: stored ? path.relative(ws.dir, path.join(paths.root, TEXTBOARD_FILE)).split(path.sep).join("/") : null,
    template: board.template,
    roles: board.roles,
    cards: board.cards,
    orphans: orphans.map((o) => ({ id: o.id, text: o.text })),
    templates: listTemplates(ws.dir, song.artist).map((t) => t.name),
    artist: song.artist,
  };
}

export type TextboardEdit =
  | { action: "card"; id: string; overrides: CardOverrides | null }
  | { action: "role"; role: Role; style: CardStyle | null }
  | { action: "save-template"; name: string }
  | { action: "apply-template"; name: string };

export function textboardEdit(ws: Workspace, projectId: string, e: TextboardEdit): { data: TextboardData; message: string } {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song still uses the old folders: migrate it first (Library → Migrate).");
  const song = songText(ws, projectId);
  let board = syncBoard(readTextboard(paths.root), song).board;
  let message = "";
  if (e.action === "card") {
    board = setCardOverrides(board, e.id, e.overrides);
    message = e.overrides ? `card ${e.id} saved` : `card ${e.id} reset`;
  } else if (e.action === "role") {
    if (!(ROLES as readonly string[]).includes(e.role)) throw new Error(`Unknown role ${e.role}.`);
    const problems: string[] = [];
    const style = e.style ? checkStyle(e.style, e.role, problems) : {};
    if (problems.length) throw new Error(problems.join("; "));
    const roles = { ...board.roles };
    if (Object.keys(style).length) roles[e.role] = style;
    else delete roles[e.role];
    board = { ...board, roles };
    message = `${e.role} lines: ${Object.keys(style).length ? "saved" : "reset"}`;
  } else if (e.action === "save-template") {
    const { file, left } = saveTemplate(ws.dir, song.artist, e.name, board);
    board = { ...board, template: path.basename(file, ".json") };
    message = `saved as template "${path.basename(file, ".json")}" for ${song.artist}${left ? ` (${left} change(s) on single lyric lines belong to this song's words and are not part of it)` : ""}`;
  } else if (e.action === "apply-template") {
    board = applyTemplate(loadTemplate(ws.dir, song.artist, e.name), song, board);
    message = `template "${board.template}" applied: this song's own title, byline, tagline and ${song.lines.length} lyric lines`;
  } else {
    throw new Error("Unknown textboard edit.");
  }
  writeTextboard(paths.root, board);
  return { data: textboardData(ws, projectId), message };
}

export { overrideCount };

// ---------------------------------------------------------------- the planner

export type RunBoard = { board: Textboard; stored: boolean; hash: string | null; orphans: TextCard[] };

// The board a run uses: textboard.json synced to the song's current lines (null file: the defaults).
export function boardForRun(songRoot: string | null, song: SongText): RunBoard {
  const stored = songRoot ? readTextboard(songRoot) : null;
  const { board, orphans } = syncBoard(stored, song);
  return { board, stored: !!stored, hash: stored ? textboardHash(stored) : null, orphans };
}

type Face = { family: string; weight: number; italic?: boolean };
export type CardFont = { font: Face; refs: FontFileRef[]; warnings: string[] };

// A card's own font (font / weight / italic set on it or its role), from the font catalog: the exact
// file, else the nearest (with a warning); null when the card keeps the recipe's font.
export function cardFont(catalog: FontCatalog, style: CardStyle, base: Face, text: string, role: string): CardFont | null {
  if (style.font === undefined && style.weight === undefined && style.italic === undefined) return null;
  const r = resolveFont(catalog, style.font ?? base.family, style.weight ?? base.weight, style.italic ?? base.italic === true, role);
  const face = forText(r.face, text);
  return { font: { family: face.family, weight: face.weight, ...(face.style === "italic" ? { italic: true } : {}) }, refs: fontFileRefs(face), warnings: r.warnings };
}

export const TITLE_SIZE_VERTICAL = 84; // px at 1080x1920 (x the platform's text scale)
export const TITLE_HOLD_VERTICAL_S = 4;

// The title, byline and tagline cards of one video. Defaults: YouTube shows title + artist as before
// (`youtube`, the layout's title), the vertical platforms none (a card shows when the board says
// show: true); the tagline only with a text and show: true.
export function titleCards(
  board: Textboard,
  o: {
    format: { width: number; height: number };
    area: Pick<LyricArea, "top" | "bottom" | "centerY">;
    fps: number;
    durationInFrames: number;
    youtube: TitleOverlayProps | null;
    titleFont: { family: string; weight: number; letterSpacing?: number };
    accent: string;
    textScale: number;
    fontFor: (style: CardStyle, base: Face, text: string, role: string) => CardFont | null;
  },
): { cards: TextCardProps[]; fonts: FontFileRef[]; warnings: string[] } {
  const y = o.youtube;
  const baseSize = y?.size ?? Math.round(TITLE_SIZE_VERTICAL * o.textScale);
  const defaults = {
    title: { show: !!y, size: baseSize, position: (y ? "top" : "centre") as CardPosition, colour: o.accent, opacity: 1, upper: true },
    byline: { show: !!y, size: Math.round(baseSize * 0.45), position: "with-title" as CardPosition, colour: "#ffffff", opacity: 0.85, upper: false },
    tagline: { show: false, size: Math.round(baseSize * 0.35), position: "with-title" as CardPosition, colour: "#ffffff", opacity: 0.75, upper: false },
  };
  const holdFrames = y ? y.untilFrame : Math.round(TITLE_HOLD_VERTICAL_S * o.fps);
  const fonts: FontFileRef[] = [];
  const warnings: string[] = [];
  const place = (position: CardPosition): Pick<TextCardProps, "top" | "centerY"> => {
    if (position === "top") return { top: y ? Math.round(o.format.height * 0.07) : Math.max(Math.round(o.format.height * 0.07), o.area.top) };
    const c = cardCenterY(position, o.area);
    return c !== undefined ? { centerY: c } : {};
  };
  const out: TextCardProps[] = [];
  for (const type of ["title", "byline", "tagline"] as const) {
    const card = board.cards.find((c) => c.type === type);
    const d = defaults[type];
    const style = { ...board.roles[type], ...(card?.overrides ?? {}) } as CardOverrides;
    const text = (card?.overrides.text ?? card?.text ?? "").trim();
    if (!(style.show ?? d.show) || !text) continue;
    const base: Face = { family: o.titleFont.family, weight: o.titleFont.weight };
    const own = o.fontFor(style, base, text, `${type} font`);
    if (own) {
      fonts.push(...own.refs);
      warnings.push(...own.warnings);
    }
    const font = own?.font ?? base;
    const position = style.position ?? d.position;
    const stackOn = position === "with-title" && type !== "title" ? "title" : undefined;
    out.push({
      id: type,
      type,
      text,
      font: font.family,
      weight: font.weight,
      ...(font.italic ? { italic: true } : {}),
      size: Math.round(d.size * (style.size ?? 1)),
      colour: d.colour,
      ...(d.opacity !== 1 ? { opacity: d.opacity } : {}),
      letterSpacing: o.titleFont.letterSpacing ?? 0.18,
      upper: d.upper,
      startFrame: 0,
      endFrame: style.hold !== undefined ? Math.min(o.durationInFrames, Math.round(style.hold * o.fps)) : holdFrames,
      effect: style.effect ? parseEffectChoice(style.effect) : null,
      ...(stackOn ? { stackOn } : place(position === "with-title" ? (type === "title" ? d.position : "centre") : position)),
      ...(y?.left !== undefined ? { left: y.left } : {}),
      ...(y?.right !== undefined ? { right: y.right } : {}),
    });
  }
  // A card stacked on a title that is not shown takes the title's place.
  const title = out.find((c) => c.id === "title");
  const titlePlace = place(((board.roles.title?.position ?? board.cards.find((c) => c.type === "title")?.overrides.position) as CardPosition | undefined) ?? defaults.title.position);
  for (const c of out) if (c.stackOn && !title) Object.assign(c, { stackOn: undefined }, titlePlace);
  return { cards: out.map((c) => (c.stackOn === undefined ? (({ stackOn: _s, ...rest }) => rest)(c) : c)), fonts, warnings };
}
