"use client";

// A looping LookPreview (the theme's look on sample lyric lines): the Themes page tiles and the Motion gallery.
import { Player } from "@remotion/player";

import { LOOK_FPS, LookPreview, lookPreviewDuration, type LookPreviewProps } from "@lyric/video";

export function PreviewPlayer({ input, durationInFrames }: { input: LookPreviewProps; durationInFrames?: number }) {
  return (
    <Player
      component={LookPreview}
      inputProps={input}
      durationInFrames={durationInFrames ?? lookPreviewDuration(input.lyrics.length)}
      fps={LOOK_FPS}
      compositionWidth={1080}
      compositionHeight={1920}
      style={{ width: "100%", height: "100%" }}
      autoPlay
      loop
      controls={false}
    />
  );
}
