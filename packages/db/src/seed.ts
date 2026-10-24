import { and, eq } from "drizzle-orm";

import { stylePreset, type TextCase } from "./schema";
import type { Db } from "./client";

type PresetSeed = {
  name: string;
  font: string;
  weight: number;
  text_case: TextCase;
  effect: string;
  animation: string;
  default_size: number;
};

// The 10 built-in text styles. default_size is in pixels on the 1080x1920 canvas.
export const STYLE_PRESETS: PresetSeed[] = [
  { name: "Simple", font: "Inter", weight: 600, text_case: "none", effect: "none", animation: "fade", default_size: 64 },
  { name: "Bold", font: "Montserrat", weight: 900, text_case: "upper", effect: "shadow", animation: "pop", default_size: 72 },
  { name: "Blur", font: "Inter", weight: 700, text_case: "none", effect: "blur", animation: "blur-in", default_size: 72 },
  { name: "Brat", font: "Arial Narrow", weight: 500, text_case: "lower", effect: "stretch", animation: "cut", default_size: 96 },
  { name: "TikTok", font: "TikTok Sans", weight: 700, text_case: "none", effect: "outline", animation: "word-pop", default_size: 72 },
  { name: "Inked", font: "Permanent Marker", weight: 400, text_case: "none", effect: "ink", animation: "write-on", default_size: 80 },
  { name: "Hollow", font: "Anton", weight: 400, text_case: "upper", effect: "hollow", animation: "slide-up", default_size: 96 },
  { name: "Subtitle", font: "Inter", weight: 500, text_case: "none", effect: "box", animation: "fade", default_size: 48 },
  { name: "Matrix", font: "JetBrains Mono", weight: 500, text_case: "none", effect: "glow", animation: "type-on", default_size: 56 },
  { name: "Elegant", font: "Playfair Display", weight: 400, text_case: "none", effect: "none", animation: "slow-fade", default_size: 72 },
];

// Changes to built-in defaults: applied to existing databases only while the old value is still
// there (a value the user changed is kept).
export const PRESET_UPDATES: { name: string; default_size: { from: number; to: number } }[] = [
  { name: "Bold", default_size: { from: 84, to: 72 } }, // Step 5b: 84 px was too big for typical lines
];

// Inserts any missing presets and applies PRESET_UPDATES. Safe to run many times.
// Returns the number of presets added.
export function seedStylePresets(db: Db): number {
  const result = db.insert(stylePreset).values(STYLE_PRESETS).onConflictDoNothing({ target: stylePreset.name }).run();
  for (const update of PRESET_UPDATES) {
    db.update(stylePreset)
      .set({ default_size: update.default_size.to })
      .where(and(eq(stylePreset.name, update.name), eq(stylePreset.default_size, update.default_size.from)))
      .run();
  }
  return result.changes;
}
