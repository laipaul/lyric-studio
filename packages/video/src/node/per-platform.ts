// Settings that may differ per platform ("perPlatform" in brand.json and song.json), e.g.
// { "youtube": { "verseEffect": "cinematic-fade" }, "reels": { "verseEffect": "glide" } }.
import { parseEffectChoice } from "../effects/names";

export const PLATFORM_FIELDS = ["verseEffect", "hookEffect", "verseFont", "hookFont", "verseWeight", "hookWeight", "verseItalic", "hookItalic", "accentColour", "section", "length", "shotLength"] as const;
// Shot length: bars per shot, or "story" (2 bars on hooks, 4 on verses, never under 3 s).
export const SHOT_LENGTH_VALUES = ["1", "2", "4", "8", "story"] as const;
export type PlatformField = (typeof PLATFORM_FIELDS)[number];
export const WEIGHT_FIELDS = ["verseWeight", "hookWeight"] as const;
export const ITALIC_FIELDS = ["verseItalic", "hookItalic"] as const;
type NonText = "length" | (typeof WEIGHT_FIELDS)[number] | (typeof ITALIC_FIELDS)[number];
// length: the target length in seconds for an "auto" section (3-600); weights 100-900; italic true/false
export type PlatformValues = Partial<Record<Exclude<PlatformField, NonText>, string>> & {
  length?: number;
  verseWeight?: number;
  hookWeight?: number;
  verseItalic?: boolean;
  hookItalic?: boolean;
};
export const isWeight = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0;
export type PerPlatform = Record<string, PlatformValues>;
export const isPlatformField = (k: string): k is PlatformField => (PLATFORM_FIELDS as readonly string[]).includes(k);

// "perPlatform": { "<platform>": { <field>: value } } in song.json or brand.json.
export function checkPerPlatform(raw: unknown, where: string): { values: PerPlatform; problems: string[] } {
  const problems: string[] = [];
  const values: PerPlatform = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { values, problems: [`${where} must look like { "youtube": { "verseEffect": "cinematic-fade" } }`] };
  for (const [platform, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      problems.push(`${where}.${platform} must be an object of settings`);
      continue;
    }
    const out: PlatformValues = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      const at = `${where}.${platform}.${k}`;
      if (!isPlatformField(k)) problems.push(`${at}: only ${PLATFORM_FIELDS.join(", ")} can differ per platform`);
      else if (k === "length") {
        if (typeof v === "number" && Number.isFinite(v) && v >= 3 && v <= 600) out.length = Math.round(v);
        else problems.push(`${at} must be a number of seconds from 3 to 600`);
      } else if (k === "verseWeight" || k === "hookWeight") {
        if (isWeight(v)) out[k] = v;
        else problems.push(`${at} must be a font weight: 100, 200, ... 900 (400 = regular, 600 = semibold, 700 = bold)`);
      } else if (k === "verseItalic" || k === "hookItalic") {
        if (typeof v === "boolean") out[k] = v;
        else problems.push(`${at} must be true or false`);
      } else if (typeof v !== "string" || !v.trim()) problems.push(`${at} must be text`);
      else if (k === "accentColour" && !/^#[0-9a-fA-F]{6}$/.test(v)) problems.push(`${at} must look like "#E8A3B5"`);
      else if (k === "shotLength" && !(SHOT_LENGTH_VALUES as readonly string[]).includes(v.trim())) problems.push(`${at} must be ${SHOT_LENGTH_VALUES.join(", ")} (bars per shot, or "story")`);
      else if (k === "verseEffect" || k === "hookEffect") {
        try {
          parseEffectChoice(v, at);
          out[k] = v.trim();
        } catch (error) {
          problems.push((error as Error).message);
        }
      } else out[k] = v.trim();
    }
    if (Object.keys(out).length) values[platform.toLowerCase()] = out;
  }
  return { values, problems };
}

