// The theme's line shape (recipe "lineShape", Shape → Theme → Text; Theme v2 step 2b part 2, 9 Nov 2026).
// Pure, browser-safe: the lyric scene (preview and both renderers), QA and the tests use the same rows.
//   subtitle  1-2 long rows per lyric line (3 only as a last resort), as always (src/lyrics.ts layoutLyric)
//   stacked   short rows of 1-3 words, 2-4 rows per line chosen per phrase, never padded to 4 (a line of
//             one or two words stays on one row). Rules (docs/theme-rules.md LIN-01..LIN-04):
//             - every row fits the width at the line's size, else the size shrinks (down to minScale);
//             - prefer a break where the singer breathes (a pause of BREATH_S between two words);
//             - never one word alone on the last row (an orphan) when the line has 3 words or more;
//             - never a break right after a small word that belongs to the next one ("the", "my", "le", ...).
// Line build (recipe "lineBuild"): replace = a line appears whole (its effect decides how), as always;
// build = each row appears as its first word is sung and stays until the line leaves (LIN-05),
// independent of the letter animation (typewriter, word reveal, ...).
import type { MeasureFn } from "./lyrics";

export const LINE_SHAPES = ["subtitle", "stacked"] as const;
export type LineShape = (typeof LINE_SHAPES)[number];
export const LINE_SHAPE_LABELS: Record<LineShape, string> = { subtitle: "Subtitle", stacked: "Stacked" };
export const LINE_SHAPE_HINTS: Record<LineShape, string> = {
  subtitle: "one or two long rows per line",
  stacked: "short rows of 1-3 words, 2-4 rows per line",
};
export const LINE_BUILDS = ["replace", "build"] as const;
export type LineBuild = (typeof LINE_BUILDS)[number];
export const LINE_BUILD_LABELS: Record<LineBuild, string> = { replace: "Whole line", build: "Build up" };
export const LINE_BUILD_HINTS: Record<LineBuild, string> = {
  replace: "each line appears whole",
  build: "each row appears as it is sung and stays until the line ends",
};
export const FINAL_HOOKS = ["off", "on"] as const;
export type FinalHook = (typeof FINAL_HOOKS)[number];

export const STACK_MAX_ROWS = 4;
export const STACK_MAX_WORDS = 3; // per row
export const BREATH_S = 0.15; // a pause this long between two sung words is a breath
export const FINAL_HOOK_SCALE = 1.3; // the video's last chorus
export const FINAL_PHRASE_SCALE = 1.5; // the last line of that chorus
export const BUILD_ROW_FRAMES = 6; // a row's fade-in (0.2 s at 30 fps), finished at its first word's on-screen time

export const isLineShape = (v: unknown): v is LineShape => typeof v === "string" && (LINE_SHAPES as readonly string[]).includes(v);
export const isLineBuild = (v: unknown): v is LineBuild => typeof v === "string" && (LINE_BUILDS as readonly string[]).includes(v);
export const isFinalHook = (v: unknown): v is FinalHook => typeof v === "string" && (FINAL_HOOKS as readonly string[]).includes(v);

// Small words that lean on the next word: a break is never put right after one (LIN-04). English and
// French (Life Lyrics, Pômé); compared without case and without a trailing apostrophe form (l', d', j').
const GLUE = new Set(
  (
    "a an the my your his her its our their this that these those to of in on at by for with from into " +
    "and or but if as no so i'm i'll you're we're they're " +
    "le la les l un une des du de d au aux mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs " +
    "ce cet cette ces et ou mais je j tu il elle on nous vous ils elles me m te t se s ne n qu que qui à en dans sur sous par pour avec sans"
  ).split(" "),
);
export function isGlueWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,!?;:"“”«»()]/g, "");
  if (/^[a-zà-ÿ]+['’]$/i.test(w)) return true; // l' d' j' qu'
  return GLUE.has(w.replace(/['’]$/, ""));
}

export type StackResult = { rows: string[]; fontSize: number; tooLong: boolean };

// Rows for one lyric line in the stacked shape. breaths[k]: the singer breathes after word k (from the
// aligned word times; optional). Deterministic: the same words, sizes and breaths give the same rows.
export function stackLyric(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: MeasureFn,
  minScale = 0.75,
  breaths?: readonly boolean[],
): StackResult {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return { rows: [""], fontSize, tooLong: false };
  const fit = (widest: number, size: number) => (widest <= maxWidth ? size : Math.floor(size * (maxWidth / widest) * 10) / 10);
  const smallest = fontSize * minScale;
  // One word, or two that fit at full size: one row (never padded).
  if (words.length === 1 || (words.length === 2 && measure(words.join(" "), fontSize) <= maxWidth)) {
    const whole = words.join(" ");
    const w = measure(whole, fontSize);
    return { rows: [whole], fontSize: fit(w, fontSize), tooLong: w * minScale > maxWidth };
  }
  const perRow = words.length > STACK_MAX_ROWS * STACK_MAX_WORDS ? Math.ceil(words.length / STACK_MAX_ROWS) : STACK_MAX_WORDS;
  const minRows = Math.max(words.length <= 2 ? 1 : 2, Math.ceil(words.length / perRow));
  let best: { rows: string[]; cost: number; widest: number } | null = null;
  const widthAt = (row: string) => measure(row, fontSize);
  // Every split of the words into minRows..4 rows of 1..perRow words (a dozen words at most: small).
  const visit = (start: number, rows: number[][], maxRows: number) => {
    if (start === words.length) {
      if (rows.length < minRows) return;
      const texts = rows.map((r) => r.map((k) => words[k]).join(" "));
      const widths = texts.map(widthAt);
      const widest = Math.max(...widths);
      if (widest * minScale > maxWidth && rows.length < maxRows) return; // too wide even shrunk: more rows will do
      const cost = splitCost(rows, widths, widest, breaths, words) + 30 * (1 - Math.min(1, maxWidth / widest)); // shrinking costs

      if (!best || cost < best.cost - 1e-9) best = { rows: texts, cost, widest };
      return;
    }
    if (rows.length >= maxRows) return;
    for (let n = 1; n <= perRow && start + n <= words.length; n++) {
      visit(start + n, [...rows, Array.from({ length: n }, (_, k) => start + k)], maxRows);
    }
  };
  visit(0, [], STACK_MAX_ROWS);
  if (!best) {
    // Long words that do not fit even four to a row: the subtitle-style fallback is the caller's (tooLong).
    const rows: string[] = [];
    for (let k = 0; k < words.length; k += perRow) rows.push(words.slice(k, k + perRow).join(" "));
    const widest = Math.max(...rows.map(widthAt));
    return { rows, fontSize: Math.max(fit(widest, fontSize), 1), tooLong: true };
  }
  const b = best as { rows: string[]; cost: number; widest: number };
  const size = fit(b.widest, fontSize);
  return { rows: b.rows, fontSize: size, tooLong: size < smallest - 0.05 || words.length > STACK_MAX_ROWS * STACK_MAX_WORDS };
}

// Lower is better. Hard rules first (glue, orphan), then breaths, then even rows, then fewer rows.
function splitCost(rows: number[][], widths: number[], widest: number, breaths: readonly boolean[] | undefined, words: readonly string[]): number {
  let cost = 0;
  for (let r = 0; r < rows.length - 1; r++) {
    const last = rows[r][rows[r].length - 1];
    if (isGlueWord(words[last])) cost += 100; // LIN-04
    if (breaths?.length) cost += breaths[last] ? -6 : 3; // LIN-02: break where the singer breathes
  }
  if (words.length >= 3 && rows[rows.length - 1].length === 1) cost += 40; // LIN-03: no orphan
  // Even rows: the narrowest against the widest (0..1), and the word counts.
  const narrowest = Math.min(...widths);
  cost += 10 * (1 - narrowest / Math.max(1, widest));
  const counts = rows.map((r) => r.length);
  cost += 2 * (Math.max(...counts) - Math.min(...counts));
  cost += 1.5 * rows.length; // never padded: fewer rows when everything else is equal
  return cost;
}

// Breaths between the words of a line, from its aligned word times (frames); undefined when the words
// on screen are not the aligned ones (another count), so the layout never guesses.
export function breathsOf(words: readonly { startFrame: number; endFrame: number }[] | undefined, count: number, fps: number): boolean[] | undefined {
  if (!words || words.length !== count || count < 2) return undefined;
  const gap = Math.round(BREATH_S * fps);
  return words.map((w, k) => (k + 1 < words.length ? words[k + 1].startFrame - w.endFrame >= gap : false));
}

// Build up: each row's opacity at `frame` (0..1). A row is fully shown at its first word's on-screen time
// (the word's sung start minus the lead, as a line's startFrame), fading in over BUILD_ROW_FRAMES; the
// first row comes with the line itself (1 from the line's own entrance). Rows never go again before the
// line leaves (the line's own exit fades them all together).
export function buildRows(rowWordCounts: readonly number[], wordStarts: readonly number[], frame: number, leadFrames: number): number[] {
  let k = 0;
  return rowWordCounts.map((n, r) => {
    const first = k;
    k += n;
    if (r === 0) return 1;
    const start = wordStarts[first];
    if (start === undefined) return 1;
    const shownAt = start - leadFrames;
    return Math.min(1, Math.max(0, (frame - (shownAt - BUILD_ROW_FRAMES)) / BUILD_ROW_FRAMES));
  });
}

// The final hook (recipe finalHook "on"): the video's last chorus (the last run of hook lines) gets
// FINAL_HOOK_SCALE, its last line FINAL_PHRASE_SCALE. Returns the scale per line index (absent: none).
export function finalHookScales(lines: readonly { isHook?: boolean }[]): Map<number, number> {
  const out = new Map<number, number>();
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].isHook) end--;
  if (end < 0) return out;
  let start = end;
  while (start > 0 && lines[start - 1].isHook) start--;
  for (let i = start; i <= end; i++) out.set(i, i === end ? FINAL_PHRASE_SCALE : FINAL_HOOK_SCALE);
  return out;
}
