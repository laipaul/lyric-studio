"use client";

import { useEffect, useState } from "react";

import { paletteFromPixels } from "@lyric/video";

// The main colours of a picture served by /api/files (a cover): read in the browser from a 24×24 copy
// (@lyric/video cover-palette.ts does the maths, tested). [] while loading or without a picture.
export function useCoverPalette(file: string | null | undefined, max = 5): string[] {
  const [colours, setColours] = useState<{ file: string; list: string[] } | null>(null);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d");
      if (!ctx || !alive) return;
      ctx.drawImage(img, 0, 0, 24, 24);
      setColours({ file, list: paletteFromPixels(ctx.getImageData(0, 0, 24, 24).data, max) });
    };
    img.src = `/api/files/${file}`;
    return () => {
      alive = false;
    };
  }, [file, max]);
  return file && colours?.file === file ? colours.list : [];
}
