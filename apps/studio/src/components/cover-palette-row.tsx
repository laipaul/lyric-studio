"use client";

import { suggestThemeColours } from "@lyric/video";

import { useCoverPalette } from "@/lib/use-cover-palette";
import { cn } from "@/lib/utils";

// Colours from a Theme cover (1 Nov 2026, asked by the user): 3–5 colours from the picture and a suggestion
// for the lyric text and the accent (the chorus words use the accent). Only a suggestion: nothing changes
// until "Use these colours". A swatch click (when onPickAccent is given) uses just that colour as the accent.
export function CoverPaletteRow({ file, text, accent, onUse, onPickAccent, label = "Colours from the cover" }: { file: string | null | undefined; text: string; accent: string; onUse: (c: { textColour: string; accentColour: string }) => void; onPickAccent?: (c: string) => void; label?: string }) {
  const palette = useCoverPalette(file);
  const suggestion = suggestThemeColours(palette);
  if (!file || !palette.length || !suggestion) return null;
  const same = suggestion.textColour === text.toUpperCase() && suggestion.accentColour === accent.toUpperCase();
  return (
    <div data-cover-palette className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          data-cover-colour={c}
          disabled={!onPickAccent}
          title={onPickAccent ? `Use ${c} as the accent` : c}
          aria-pressed={c === accent.toUpperCase()}
          onClick={() => onPickAccent?.(c)}
          className={cn("size-6 rounded-full border disabled:cursor-default", c === accent.toUpperCase() && "ring-brand ring-2")}
          style={{ background: c }}
        />
      ))}
      <span className="text-muted-foreground ml-1">→</span>
      <span data-palette-suggestion className="flex items-center gap-1 rounded-md border bg-black/60 px-2 py-0.5" title="Lyrics in the first colour, the chorus and accent in the second">
        <span style={{ color: suggestion.textColour }}>Lyrics</span>
        <span style={{ color: suggestion.accentColour }}>Chorus</span>
      </span>
      <button type="button" data-use-cover-colours disabled={same} onClick={() => onUse(suggestion)} className="bg-brand/15 text-brand rounded-md px-2 py-0.5 font-medium disabled:opacity-50">
        {same ? "In use" : "Use these colours"}
      </button>
    </div>
  );
}
