// The Textboard: the text layer of a song as its own object (the song folder's textboard.json). An
// ordered list of cards: title, byline, tagline and every lyric line. Each card's timing comes from the
// alignment, hand times and the display rules (never aligned again); its look comes from the brand and
// the recipe, then the board's per-role rules ("hook lines larger"), then the card's own overrides.
// Templates keep the design without the words. Pure: the planner, the storyboard's live preview and
// the tests use the same functions.
import { parseEffectChoice, type EffectChoice } from "./effects/names";
import { VIDEO } from "./config";
import type { LyricArea } from "./platform";
import type { LyricLineProps } from "./props";

export const CARD_TYPES = ["title", "byline", "tagline", "lyric"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const ROLES = ["title", "byline", "tagline", "verse", "hook"] as const;
export type Role = (typeof ROLES)[number];
// lyrics: the lyric spot (lyricsAt in the safe area); with-title: stacked under the title; top /
// upper / centre / lower: places inside the safe area (never in a platform's UI).
// upper-third / lower-third: the frame's thirds (the title opening), kept inside the safe area.
export const POSITIONS = ["lyrics", "with-title", "top", "upper", "centre", "lower", "upper-third", "lower-third"] as const;
export type CardPosition = (typeof POSITIONS)[number];
export const POSITION_AT: Record<"upper" | "centre" | "lower", number> = { upper: 0.3, centre: 0.5, lower: 0.7 };
export const SIZE_RANGE = [0.5, 2] as const;
export const HOLD_MAX_S = 10;

// A look; every field optional ("not set": the brand / recipe decides).
export type CardStyle = {
  show?: boolean; // title / byline / tagline: on screen or not
  position?: CardPosition;
  size?: number; // x the role's size (0.5-2)
  hold?: number; // seconds. Lyric: stays at least this long after its last word. Title cards: shown this long.
  effect?: string; // "glide", "soft-blur:subtle", ...
  font?: string;
  weight?: number;
  italic?: boolean;
};
export type CardOverrides = CardStyle & { text?: string }; // text: title / byline / tagline only
export type TextCard = { id: string; type: CardType; line?: number; text: string; isHook?: boolean; overrides: CardOverrides };
export type Textboard = { template: string | null; roles: Partial<Record<Role, CardStyle>>; cards: TextCard[] };
// A template: the design without the words (roles and the title-opening cards' looks).
export type TextTemplate = { name: string; artist: string; roles: Partial<Record<Role, CardStyle>>; opening: Partial<Record<"title" | "byline" | "tagline", CardStyle>>; createdAt?: string };

export type SongText = { title: string; artist: string; ep?: string | null; tagline?: string | null; lines: { number: number; text: string; isHook: boolean }[] };

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const taglineFor = (ep?: string | null) => (ep ? `From the EP "${ep}"` : "");

// ---------------------------------------------------------------- checks

const STYLE_KEYS = ["show", "position", "size", "hold", "effect", "font", "weight", "italic"] as const;

export function checkStyle(raw: unknown, where: string, problems: string[], withText = false): CardOverrides {
  const out: CardOverrides = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${where} must be an object`);
    return out;
  }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!(STYLE_KEYS as readonly string[]).includes(k) && !(withText && k === "text")) problems.push(`${where}.${k}: unknown setting (known: ${[...STYLE_KEYS, ...(withText ? ["text"] : [])].join(", ")})`);
  }
  if (r.show !== undefined) typeof r.show === "boolean" ? (out.show = r.show) : problems.push(`${where}.show must be true or false`);
  if (r.position !== undefined) (POSITIONS as readonly unknown[]).includes(r.position) ? (out.position = r.position as CardPosition) : problems.push(`${where}.position must be ${POSITIONS.join(", ")}`);
  if (r.size !== undefined) typeof r.size === "number" && r.size >= SIZE_RANGE[0] && r.size <= SIZE_RANGE[1] ? (out.size = Math.round(r.size * 100) / 100) : problems.push(`${where}.size must be ${SIZE_RANGE[0]}-${SIZE_RANGE[1]} (x the usual size)`);
  if (r.hold !== undefined) typeof r.hold === "number" && r.hold >= 0 && r.hold <= HOLD_MAX_S ? (out.hold = Math.round(r.hold * 10) / 10) : problems.push(`${where}.hold must be 0-${HOLD_MAX_S} seconds`);
  if (r.effect !== undefined) {
    try {
      const c = parseEffectChoice(String(r.effect), `${where}.effect`);
      out.effect = `${c.name}${c.intensity !== "balanced" ? `:${c.intensity}` : ""}`;
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  if (r.font !== undefined) typeof r.font === "string" && r.font.trim() ? (out.font = r.font.trim()) : problems.push(`${where}.font must be a font family`);
  if (r.weight !== undefined) Number.isInteger(r.weight) && (r.weight as number) >= 100 && (r.weight as number) <= 900 && (r.weight as number) % 100 === 0 ? (out.weight = r.weight as number) : problems.push(`${where}.weight must be 100, 200, ... 900`);
  if (r.italic !== undefined) typeof r.italic === "boolean" ? (out.italic = r.italic) : problems.push(`${where}.italic must be true or false`);
  if (withText && r.text !== undefined) typeof r.text === "string" ? (out.text = r.text) : problems.push(`${where}.text must be text`);
  return out;
}

function checkRoles(raw: unknown, where: string, problems: string[]): Partial<Record<Role, CardStyle>> {
  const out: Partial<Record<Role, CardStyle>> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${where} must be an object`);
    return out;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ROLES as readonly string[]).includes(k)) problems.push(`${where}.${k}: unknown role (known: ${ROLES.join(", ")})`);
    else {
      const s = checkStyle(v, `${where}.${k}`, problems);
      if (Object.keys(s).length) out[k as Role] = s;
    }
  }
  return out;
}

export function checkTextboard(raw: unknown): { board: Textboard; problems: string[] } {
  const problems: string[] = [];
  const board: Textboard = { template: null, roles: {}, cards: [] };
  if (!raw || typeof raw !== "object") return { board, problems: ["textboard.json must be a JSON object"] };
  const r = raw as Record<string, unknown>;
  if (r.template !== undefined && r.template !== null) typeof r.template === "string" ? (board.template = r.template) : problems.push("template must be a template name");
  board.roles = checkRoles(r.roles, "roles", problems);
  if (r.cards !== undefined) {
    if (!Array.isArray(r.cards)) problems.push("cards must be a list");
    else {
      const ids = new Set<string>();
      for (const [i, c] of (r.cards as Record<string, unknown>[]).entries()) {
        const at = `cards[${i}]`;
        if (!c || typeof c !== "object") {
          problems.push(`${at} must be an object`);
          continue;
        }
        if (!(CARD_TYPES as readonly unknown[]).includes(c.type)) {
          problems.push(`${at}.type must be ${CARD_TYPES.join(", ")}`);
          continue;
        }
        const type = c.type as CardType;
        const id = typeof c.id === "string" && c.id ? c.id : type === "lyric" ? `line-${String(c.line)}` : type;
        if (ids.has(id)) problems.push(`${at}: the card id "${id}" is used twice`);
        ids.add(id);
        if (type === "lyric" && !(Number.isInteger(c.line) && (c.line as number) >= 1)) problems.push(`${at}.line must be the line's number (1, 2, ...)`);
        const overrides = checkStyle(c.overrides, `${at}.overrides`, problems, type !== "lyric");
        board.cards.push({ id, type, ...(type === "lyric" ? { line: c.line as number } : {}), text: typeof c.text === "string" ? c.text : "", ...(c.isHook === true ? { isHook: true } : {}), overrides });
      }
    }
  }
  return { board, problems };
}

export function checkTemplate(raw: unknown, file = "template"): { template: TextTemplate; problems: string[] } {
  const problems: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") problems.push(`${file} must be a JSON object`);
  const opening: TextTemplate["opening"] = {};
  if (r.opening && typeof r.opening === "object") {
    for (const [k, v] of Object.entries(r.opening as Record<string, unknown>)) {
      if (!["title", "byline", "tagline"].includes(k)) problems.push(`opening.${k}: only title, byline and tagline`);
      else opening[k as "title"] = checkStyle(v, `opening.${k}`, problems);
    }
  }
  return {
    template: { name: typeof r.name === "string" ? r.name : "", artist: typeof r.artist === "string" ? r.artist : "", roles: checkRoles(r.roles, "roles", problems), opening, ...(typeof r.createdAt === "string" ? { createdAt: r.createdAt } : {}) },
    problems,
  };
}

// ---------------------------------------------------------------- cards

// The default cards of a song: its title, byline (artist), tagline (the EP line) and every lyric line.
export function defaultCards(song: SongText): TextCard[] {
  return [
    { id: "title", type: "title", text: song.title, overrides: {} },
    { id: "byline", type: "byline", text: song.artist, overrides: {} },
    { id: "tagline", type: "tagline", text: song.tagline ?? "", overrides: {} }, // the song's own tagline (song.json), never the EP
    ...song.lines.map((l): TextCard => ({ id: `line-${l.number}`, type: "lyric", line: l.number, text: l.text, ...(l.isHook ? { isHook: true } : {}), overrides: {} })),
  ];
}

// The board for the song as it is now: title / byline / tagline texts and the lyric cards follow the
// current lyrics (a card keeps its overrides when its line kept its words, also when it moved to
// another number); a card whose words are gone is listed (its changes are not used, never silently).
export function syncBoard(board: Textboard | null, song: SongText): { board: Textboard; orphans: TextCard[] } {
  const fresh = defaultCards(song);
  if (!board) return { board: { template: null, roles: {}, cards: fresh }, orphans: [] };
  const old = board.cards.filter((c) => c.type === "lyric");
  const used = new Set<TextCard>();
  const cards = fresh.map((c) => {
    if (c.type !== "lyric") {
      const own = board.cards.find((x) => x.type === c.type);
      return own ? { ...c, overrides: own.overrides } : c;
    }
    // The same number with the same words, else the nearest card with the same words.
    let match = old.find((x) => !used.has(x) && x.line === c.line && norm(x.text) === norm(c.text));
    match ??= old.filter((x) => !used.has(x) && norm(x.text) === norm(c.text)).sort((a, b) => Math.abs((a.line ?? 0) - c.line!) - Math.abs((b.line ?? 0) - c.line!))[0];
    if (!match) return c;
    used.add(match);
    return { ...c, overrides: match.overrides };
  });
  const orphans = old.filter((x) => !used.has(x) && Object.keys(x.overrides).length);
  return { board: { template: board.template, roles: board.roles, cards }, orphans };
}

// Only what differs from the defaults goes into textboard.json (cards without overrides are kept as
// the list of the text, so the file reads as the song's text layer).
export function boardFile(board: Textboard): Record<string, unknown> {
  return {
    template: board.template,
    roles: board.roles,
    cards: board.cards.map((c) => ({ id: c.id, type: c.type, ...(c.line !== undefined ? { line: c.line } : {}), text: c.text, ...(c.isHook ? { isHook: true } : {}), ...(Object.keys(c.overrides).length ? { overrides: c.overrides } : {}) })),
  };
}

export const overrideCount = (board: Textboard) => board.cards.filter((c) => Object.keys(c.overrides).length).length + Object.keys(board.roles).length;

// One card changed (or reset with null).
export function setCardOverrides(board: Textboard, id: string, overrides: CardOverrides | null): Textboard {
  if (!board.cards.some((c) => c.id === id)) throw new Error(`No card "${id}" on this textboard.`);
  const problems: string[] = [];
  const card = board.cards.find((c) => c.id === id)!;
  const checked = overrides ? checkStyle(overrides, id, problems, card.type !== "lyric") : {};
  if (problems.length) throw new Error(problems.join("; "));
  return { ...board, cards: board.cards.map((c) => (c.id === id ? { ...c, overrides: checked } : c)) };
}

// ---------------------------------------------------------------- templates

export function toTemplate(board: Textboard, name: string, artist: string, now = new Date()): { template: TextTemplate; left: number } {
  const opening: TextTemplate["opening"] = {};
  for (const type of ["title", "byline", "tagline"] as const) {
    const c = board.cards.find((x) => x.type === type);
    if (!c) continue;
    const { text: _text, ...style } = c.overrides; // never the words
    if (Object.keys(style).length) opening[type] = style;
  }
  // Per-line changes belong to this song's words: not part of a template (said so).
  const left = board.cards.filter((c) => c.type === "lyric" && Object.keys(c.overrides).length).length;
  return { template: { name, artist, roles: board.roles, opening, createdAt: now.toISOString() }, left };
}

// A template on a song: its own title, byline, tagline (texts it set itself are kept) and lyrics,
// the template's design.
export function applyTemplate(template: TextTemplate, song: SongText, current: Textboard | null): Textboard {
  const own = (type: CardType) => current?.cards.find((c) => c.type === type)?.overrides.text;
  const cards = defaultCards(song).map((c) => {
    if (c.type === "lyric") return c;
    const style = template.opening[c.type as "title"] ?? {};
    const text = own(c.type);
    return { ...c, overrides: { ...style, ...(text !== undefined ? { text } : {}) } };
  });
  return { template: template.name, roles: template.roles, cards };
}

// ---------------------------------------------------------------- resolving (planner + live preview)

const mergeStyle = (...s: (CardStyle | undefined)[]): CardStyle => Object.assign({}, ...s.filter(Boolean));

// The look of a lyric card for the planner: the board's role rules (verse / hook), then the card.
// Fields not set stay with the recipe (fonts, effects) and the display rules (timing).
export function lyricCardStyle(board: Textboard, card: TextCard, isHook: boolean): CardStyle {
  const { text: _t, show: _s, ...own } = card.overrides;
  return mergeStyle(board.roles[isHook ? "hook" : "verse"], own);
}

export type LineCard = NonNullable<LyricLineProps["card"]>;

// Where a card sits (its centre, px) in the lyric area: lyrics = the usual spot.
export function cardCenterY(position: CardPosition | undefined, area: Pick<LyricArea, "top" | "bottom" | "centerY">, frameHeight?: number): number | undefined {
  if (!position || position === "lyrics" || position === "with-title") return undefined;
  if (position === "top") return Math.round(area.top + (area.bottom - area.top) * 0.15);
  if (position === "upper-third" || position === "lower-third") {
    const h = area.bottom - area.top;
    // On the frame's third lines (rule of thirds), kept 12% inside the safe area.
    const want = frameHeight ? (frameHeight * (position === "upper-third" ? 1 : 2)) / 3 : area.top + h * (position === "upper-third" ? POSITION_AT.upper : POSITION_AT.lower);
    return Math.round(Math.min(area.bottom - h * 0.12, Math.max(area.top + h * 0.12, want)));
  }
  return Math.round(area.top + (area.bottom - area.top) * POSITION_AT[position]);
}

// A lyric line with its card's look: position, size, effect, font (resolved by the planner) and hold
// (stays at least `hold` s after its last word, never into the next line). `baseEndFrame` keeps the
// display rules' own end, so the preview can change the hold again.
export function withCard(
  line: LyricLineProps,
  card: { id: string; style: CardStyle; font?: { family: string; weight: number; italic?: boolean } },
  ctx: { area: Pick<LyricArea, "top" | "bottom" | "centerY">; nextStartFrame: number | null; durationInFrames: number },
): LyricLineProps {
  const baseEnd = line.card?.baseEndFrame ?? line.endFrame;
  const s = card.style;
  let endFrame = baseEnd;
  if (s.hold !== undefined) {
    const from = line.sungEndFrame ?? line.stampFrame ?? line.startFrame;
    endFrame = Math.max(baseEnd, from + Math.round(s.hold * VIDEO.fps));
    if (ctx.nextStartFrame !== null) endFrame = Math.min(endFrame, Math.max(baseEnd, ctx.nextStartFrame));
    endFrame = Math.min(endFrame, ctx.durationInFrames);
  }
  const centerY = cardCenterY(s.position, ctx.area);
  const next: LineCard = {
    id: card.id,
    ...(s.effect ? { effect: parseEffectChoice(s.effect) } : {}),
    ...(s.size !== undefined && s.size !== 1 ? { scale: s.size } : {}),
    ...(centerY !== undefined ? { centerY, position: s.position } : {}),
    ...(card.font ? { font: card.font } : {}),
    ...(endFrame !== baseEnd ? { baseEndFrame: baseEnd } : {}),
  };
  return { ...line, endFrame, card: next };
}

// The storyboard's live preview: one card's new look on props already planned (fonts need a new plan).
export function previewCard(
  lyrics: readonly LyricLineProps[],
  cardId: string,
  style: CardStyle,
  ctx: { area: Pick<LyricArea, "top" | "bottom" | "centerY">; durationInFrames: number },
): LyricLineProps[] {
  return lyrics.map((l, k) =>
    l.card?.id === cardId
      ? withCard(l, { id: cardId, style, ...(l.card.font ? { font: l.card.font } : {}) }, { ...ctx, nextStartFrame: lyrics[k + 1]?.startFrame ?? null })
      : l,
  );
}

export const effectOf = (style: CardStyle): EffectChoice | null => (style.effect ? parseEffectChoice(style.effect) : null);
