"use client";

// The Shape page's stand-in viewer, used only while there is no planned video to play (no clips yet, the
// lyrics not timed yet, or the first plan still loading): the video's own LyricScene (LookPreview in
// @lyric/video) on the song's first lines (the middle one as a chorus) over a frame of the song's clips,
// with the song's fonts (or the pairing pointed at), the effect of the part chosen in Set effect,
// Breathe, the add-ons, the accent and the soft backing when the render would add it.
import { Player } from "@remotion/player";

import { LOOK_FPS, LookPreview, lookPreviewDuration, type LookPreviewProps } from "@lyric/video";

export function LookViewer({ input, caption, previewing }: { input: LookPreviewProps; caption: string; previewing?: string | null }) {
  return (
    <div data-look-preview data-effect={input.effect.name} data-breathe={input.breathe} data-verse-family={input.verse.family} data-hook-family={input.hook.family} data-hook-face={`${input.hook.family} ${input.hook.weight}${input.hook.italic ? " italic" : ""}`} data-previewing-pair={previewing ?? undefined} data-accent={input.accent} data-backing={input.backing ? "1" : "0"} className="flex flex-col gap-1.5">
      <div className="mx-auto overflow-hidden rounded-xl border bg-black shadow-lg" style={{ height: "min(62vh, 640px)", aspectRatio: "9 / 16" }}>
        <Player
          component={LookPreview}
          inputProps={input}
          durationInFrames={lookPreviewDuration(input.lyrics.length)}
          fps={LOOK_FPS}
          compositionWidth={1080}
          compositionHeight={1920}
          style={{ width: "100%", height: "100%" }}
          autoPlay
          loop
          controls={false}
        />
      </div>
      <p data-look-preview-caption className="text-muted-foreground text-center text-[11px] leading-snug">
        {caption}
      </p>
    </div>
  );
}
