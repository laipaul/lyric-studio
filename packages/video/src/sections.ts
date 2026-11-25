// Sections (22 Nov 2026, Mini film step 2): the song's verses, choruses and bridge, by line. Each section starts on a
// sung line (the Lyrics tab's numbers: blank lines not counted) and runs until the next one; the first always starts
// on line 1. song.json "sections": [{ "line": 1, "kind": "verse" }, { "line": 5, "kind": "chorus" }, ...]. Not saved:
// the app's suggestion, made from lyrics.txt:
//   - stanzas: the blocks of lyrics.txt between blank lines;
//   - chorus: a stanza with a hook line ("* "), or, when the song marks no hooks, a stanza whose words come back;
//   - pre-chorus: a stanza that comes back, has no hook and leads straight into a chorus;
//   - bridge: the first other stanza after the second chorus that a chorus still follows;
//   - outro: what comes after the last chorus; the rest are verses (numbered: Verse 1, Verse 2...).
//   Stanzas of the same kind in a row are one section. Without blank lines: hook runs are choruses, the rest verses.
// Pure: the studio's pages and the scenes use it too.
import { cleanFeeling } from "./feelings";
import { normalizeLyric } from "./lrc";

export const SECTION_KINDS = ["intro", "verse", "pre-chorus", "chorus", "bridge", "outro"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const SECTION_KIND_LABEL: Record<SectionKind, string> = { intro: "Intro", verse: "Verse", "pre-chorus": "Pre-chorus", chorus: "Chorus", bridge: "Bridge", outro: "Outro" };

export type SongSection = { line: number; kind: SectionKind; feeling?: string }; // feeling: feelings.ts (25 Nov 2026)
export type NamedSection = SongSection & { name: string; lastLine: number };

const HOOK = /^\s*\*\s*/;

export function isSectionKind(x: unknown): x is SectionKind {
  return typeof x === "string" && (SECTION_KINDS as readonly string[]).includes(x);
}

// The stanzas of lyrics.txt: for each, its sung line numbers, words and hook marks.
type Stanza = { lines: number[]; keys: string[]; hook: boolean };
function stanzas(lyricsText: string): Stanza[] {
  const out: Stanza[] = [];
  let cur: Stanza | null = null;
  let n = 0;
  for (const raw of lyricsText.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw.trim()) {
      cur = null;
      continue;
    }
    n += 1;
    if (!cur) out.push((cur = { lines: [], keys: [], hook: false }));
    cur.lines.push(n);
    cur.keys.push(normalizeLyric(raw.replace(HOOK, "")));
    if (HOOK.test(raw)) cur.hook = true;
  }
  return out;
}

export function suggestSections(lyricsText: string): SongSection[] {
  const st = stanzas(lyricsText);
  if (!st.length) return [];
  if (st.length === 1) {
    // No blank lines: runs of hook lines are choruses, the rest verses.
    const out: SongSection[] = [];
    lyricsText
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .forEach((l, i) => {
        const kind: SectionKind = HOOK.test(l) ? "chorus" : "verse";
        if (out[out.length - 1]?.kind !== kind) out.push({ line: i + 1, kind });
      });
    return out;
  }
  // A stanza "comes back" when at least half of its lines are sung in another stanza too.
  const comesBack = st.map((s, i) => {
    const others = new Set(st.flatMap((o, k) => (k === i ? [] : o.keys)));
    return s.keys.filter((k) => others.has(k)).length * 2 >= s.keys.length;
  });
  const anyHook = st.some((s) => s.hook);
  const kinds: (SectionKind | null)[] = st.map((s, i) => (anyHook ? s.hook : comesBack[i]) ? "chorus" : null);
  st.forEach((_, i) => {
    if (!kinds[i] && comesBack[i] && kinds[i + 1] === "chorus") kinds[i] = "pre-chorus";
  });
  const choruses = kinds.flatMap((k, i) => (k === "chorus" ? [i] : []));
  const lastChorus = choruses[choruses.length - 1] ?? -1;
  let bridged = false;
  st.forEach((_, i) => {
    if (kinds[i]) return;
    const after = choruses.filter((c) => c < i).length;
    if (choruses.length && i > lastChorus) kinds[i] = "outro";
    else if (!bridged && after >= 2 && i < lastChorus) {
      kinds[i] = "bridge";
      bridged = true;
    } else kinds[i] = "verse";
  });
  const out: SongSection[] = [];
  st.forEach((s, i) => {
    if (out[out.length - 1]?.kind !== kinds[i]) out.push({ line: s.lines[0], kind: kinds[i]! });
  });
  out[0].line = 1;
  return out;
}

// A saved list made right: known kinds, lines inside the song, sorted, one section per line, the first on line 1.
// Problems are said in plain words (a wrong entry is left out, never blocks the song).
export function cleanSections(raw: unknown, lineCount?: number): SongSection[] {
  if (!Array.isArray(raw)) return [];
  const byLine = new Map<number, SongSection>();
  for (const r of raw as { line?: unknown; kind?: unknown; feeling?: unknown }[]) {
    if (!r || typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 1 || !isSectionKind(r.kind)) continue;
    if (lineCount !== undefined && r.line > lineCount) continue;
    const feeling = cleanFeeling(r.feeling);
    byLine.set(r.line, { line: r.line, kind: r.kind, ...(feeling ? { feeling } : {}) });
  }
  const out = [...byLine.values()].sort((a, b) => a.line - b.line);
  if (out.length && out[0].line !== 1) out[0] = { ...out[0], line: 1 };
  return out;
}

// Names (Verse 1, Verse 2, Chorus, Bridge...) and each section's last line. Verses are numbered when there are
// several; the other kinds keep their plain name (a chorus is the same chorus each time).
export function nameSections(sections: SongSection[], lineCount: number): NamedSection[] {
  const verses = sections.filter((s) => s.kind === "verse").length;
  let v = 0;
  return sections.map((s, i) => ({
    ...s,
    name: s.kind === "verse" && verses > 1 ? `Verse ${++v}` : SECTION_KIND_LABEL[s.kind],
    lastLine: Math.max(s.line, (sections[i + 1]?.line ?? lineCount + 1) - 1),
  }));
}

export function sectionOfLine(sections: NamedSection[], line: number): NamedSection | null {
  let found: NamedSection | null = null;
  for (const s of sections) if (s.line <= line) found = s;
  return found;
}
