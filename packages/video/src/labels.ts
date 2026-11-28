// One label per asset, the same on every screen (Paul, 28 Nov 2026: "the cards keep their number while the singing
// cards have a different sequence", "call them S1, S2 etc"):
//   B-roll / story clips: the number of their card in Prepare → Storyboard (1, 2, 3… in story order). A clip picked
//     from a collection has its own card; a clip the app picks from a collection card gets that card's number.
//     A planned slot (no picture yet) has its number too.
//   Singing clips: S1, S2, S3… in song order (the singing anchors of song.json, those with "sync", by their first line).
// Labels are per song (the same in every video of the song). Pure: the server views compute them once
// (songLabels in node/story-line.ts) and every screen shows what they say, so no screen numbers differently.

export type StoryEntry =
  | { kind: "clip"; name: string } // the song's own clip or a clip picked from a collection
  | { kind: "card"; collection: string; clips: readonly string[] } // "the app picks": the collection's clips without a card of their own
  | { kind: "slot"; id: string }; // a planned slot of the shot list (no picture yet)

// source: where the singing clip comes from, in plain words ("WeddingDaySingingClip1 · 1:02–1:09": the music video or
// picture it was made from and the part of the song it sings), null when the app does not know.
export type SingingAnchor = { line: number; through?: number | null; clip: string; source?: string | null };
export type SingerLabel = { label: string; clip: string; line: number; through: number; source: string | null };

// JSON-safe (the views send it to the screens). clips: by clip file name in lower case.
export type AssetLabels = { clips: Record<string, string>; slots: Record<string, string>; singers: SingerLabel[] };

export const NO_LABELS: AssetLabels = { clips: {}, slots: {}, singers: [] };

export function assetLabels({ storyOrder, singingAnchors }: { storyOrder: readonly StoryEntry[]; singingAnchors: readonly SingingAnchor[] }): AssetLabels {
  const clips: Record<string, string> = {};
  const slots: Record<string, string> = {};
  // Own cards first: a clip with a card of its own keeps that number, also when its collection has a card too.
  storyOrder.forEach((e, i) => {
    const n = String(i + 1);
    if (e.kind === "clip" && !(e.name.toLowerCase() in clips)) clips[e.name.toLowerCase()] = n;
    else if (e.kind === "slot" && !(e.id.toLowerCase() in slots)) slots[e.id.toLowerCase()] = n;
  });
  storyOrder.forEach((e, i) => {
    if (e.kind !== "card") return;
    for (const c of e.clips) if (!(c.toLowerCase() in clips)) clips[c.toLowerCase()] = String(i + 1);
  });
  // Singers by their first line; the same clip on two lines keeps one label.
  const sorted = [...singingAnchors].filter((a) => a.clip).sort((a, b) => a.line - b.line || a.clip.localeCompare(b.clip));
  const singerOf = new Map<string, string>();
  const singers: SingerLabel[] = [];
  for (const a of sorted) {
    const key = a.clip.toLowerCase();
    if (!singerOf.has(key)) singerOf.set(key, `S${singerOf.size + 1}`);
    singers.push({ label: singerOf.get(key)!, clip: a.clip, line: a.line, through: Math.max(a.line, a.through ?? a.line), source: a.source ?? null });
  }
  for (const [key, label] of singerOf) clips[key] = label; // a singing clip reads as its singer, never as a number
  return { clips, slots, singers };
}

// The label of a clip (null: no card, e.g. an empty planned shot or a stand-in).
export function clipLabel(labels: AssetLabels | null | undefined, clip: string | null | undefined): string | null {
  if (!labels || !clip) return null;
  return labels.clips[clip.toLowerCase()] ?? null;
}

// The singer on a lyric line (its first line or a later line it sings through).
export function singerOnLine(labels: AssetLabels | null | undefined, line: number): SingerLabel | null {
  return labels?.singers.find((s) => s.line <= line && line <= s.through) ?? null;
}

// "L15–16" / "L17": the lines a singer sings.
export function singerLines(s: Pick<SingerLabel, "line" | "through">): string {
  return s.through > s.line ? `L${s.line}–${s.through}` : `L${s.line}`;
}
