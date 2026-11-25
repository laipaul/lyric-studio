// Feeling per section (25 Nov 2026, realism plan step 3): Paul picks one word per section of the song (Lyrics Sync, on
// the section's row): tender, longing, hope... or a word of his own. The app turns it into small, true-to-life changes
// of the face (eyes, brows, breath, chin), never acting: the words are sent with Animate (a picture on a shot of that
// section) and with singing clips (the line's section). A take that runs into the next section with another feeling
// gets a two-stage change ("starts longing, then turns to hope"). song.json "sections": [{ line, kind, feeling? }].
// Pure: the studio's pages, Animate and the singer use it.
import type { NamedSection } from "./sections";

export const FEELINGS = ["tender", "longing", "hope", "joy", "pride", "defiance", "grief", "calm"] as const;
export type KnownFeeling = (typeof FEELINGS)[number];

// What each feeling looks like on a face, in small movements a camera would catch.
const FACE: Record<KnownFeeling, string> = {
  tender: "a soft, warm look, the eyes relaxed and kind, a slight smile that comes and goes, slow gentle breathing",
  longing: "the eyes resting just past the camera, the inner brows lifting a little, lips slightly parted, a slow breath in",
  hope: "the face lifting a little, the eyes brightening, the beginning of a smile, the chin rising slightly",
  joy: "an open smile that reaches the eyes, the cheeks lifted, light and easy breathing",
  pride: "the chin up, a steady gaze, the shoulders settling back, a calm small smile",
  defiance: "a firm jaw, a steady unblinking gaze, a sharp breath through the nose",
  grief: "the eyes glistening, the inner brows drawn up, the lips pressed together, an uneven breath",
  calm: "a still, relaxed face, slow blinks, even breathing",
};

export const MAX_FEELING = 30;

// A feeling as saved: one of the list, or the user's own word (a few words, no punctuation games); else undefined.
export function cleanFeeling(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.replace(/\s+/g, " ").replace(/[.;:]+$/, "").trim().toLowerCase().slice(0, MAX_FEELING);
  return t || undefined;
}

export const isKnownFeeling = (x: unknown): x is KnownFeeling => typeof x === "string" && (FEELINGS as readonly string[]).includes(x);

const face = (f: string) => (isKnownFeeling(f) ? FACE[f] : `the feeling of ${f}, shown only in small natural changes of the eyes, brows and breath`);

// The words sent with a take: one feeling, or a change from one to another (two different feelings) over the take.
export function feelingWords(feeling?: string, to?: string): string {
  const a = cleanFeeling(feeling);
  const b = cleanFeeling(to);
  if (a && b && a !== b) return `Feeling: it starts ${a} (${face(a)}), then in the second half slowly turns to ${b} (${face(b)}), with no sudden change`;
  const one = a ?? b;
  return one ? `Feeling: ${one}, ${face(one)}` : "";
}

// The feeling of the section a line belongs to (none before the first section or when that section has none).
export function feelingOfLine(sections: readonly NamedSection[], line: number | null | undefined): string | undefined {
  if (line === null || line === undefined) return undefined;
  let found: NamedSection | undefined;
  for (const s of sections) if (s.line <= line) found = s;
  return found?.feeling;
}

// A take over lines from..through: its feeling, and the next one when the lines run into a section that feels different.
export function feelingOfLines(sections: readonly NamedSection[], from: number | null | undefined, through?: number | null): { feeling?: string; feelingTo?: string } {
  const a = feelingOfLine(sections, from);
  const b = through && from && through > from ? feelingOfLine(sections, through) : undefined;
  if (b && b !== a) return { ...(a ? { feeling: a } : {}), feelingTo: b };
  return a ? { feeling: a } : {};
}
