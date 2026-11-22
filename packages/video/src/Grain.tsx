// Film grain over the picture (the theme's "grain": light | medium; src/picture.ts grainLayer / grainOffset): a fine
// noise tile in soft-light that moves to another place on every frame. Under the words, over the clips, grade and
// vignette. The HyperFrames composition (hf/compile.ts) draws the same layer and moves it by the same grainOffset.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { grainLayer, grainOffset, type Grain } from "./picture";

export const GrainOverlay: React.FC<{ grain: Grain | undefined }> = ({ grain }) => {
  const frame = useCurrentFrame();
  const layer = grainLayer(grain);
  if (!layer) return null;
  return (
    <AbsoluteFill
      data-grain={grain}
      style={{ pointerEvents: "none", backgroundImage: layer.background, backgroundSize: `${layer.size}px ${layer.size}px`, backgroundRepeat: "repeat", backgroundPosition: grainOffset(frame), opacity: layer.opacity, mixBlendMode: layer.blend }}
    />
  );
};
