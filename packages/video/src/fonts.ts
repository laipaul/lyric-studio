// Loads the font files listed in the props (served next to the media), so preview and render use
// exactly the same fonts and nothing is fetched from the internet.
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

import type { FontFileRef } from "./font-files";
import { mediaUrl } from "./props";

const loading = new Map<string, Promise<void>>();

function loadFontFile(mediaBaseUrl: string, ref: FontFileRef): Promise<void> {
  const key = `${mediaBaseUrl}|${ref.src}|${ref.family}|${ref.weight}|${ref.style}`;
  const existing = loading.get(key);
  if (existing) return existing;
  if (typeof document === "undefined") return Promise.resolve();
  const face = new FontFace(ref.family, `url("${mediaUrl(mediaBaseUrl, ref.src)}")`, {
    weight: String(ref.weight),
    style: ref.style,
    ...(ref.unicodeRange ? { unicodeRange: ref.unicodeRange } : {}),
  });
  const promise = face.load().then((loaded) => {
    document.fonts.add(loaded);
  });
  loading.set(key, promise);
  return promise;
}

// Holds the render until all fonts are ready (no frames with a fallback font, no layout measured
// with the wrong font). Returns true once loaded.
export function useFonts(mediaBaseUrl: string, fonts: readonly FontFileRef[]): boolean {
  const key = fonts.map((f) => f.src).join("|");
  const [handle] = useState(() => delayRender("Loading fonts"));
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all(fonts.map((f) => loadFontFile(mediaBaseUrl, f).catch((e) => console.error(`Font ${f.src} could not be loaded`, e))))
      .finally(() => {
        if (!cancelled) setReadyKey(key);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaBaseUrl, key, handle]);
  return readyKey === key;
}
