// Fonts are served next to the media (`<mediaBaseUrl>/_fonts/<file>`), so preview and render use the
// same files and nothing is fetched from the internet.
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

import { FONT_FILES } from "./font-files";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export { FONT_FILES };

export function resolveFont(font: string, weight: number): { family: string; weight: number } {
  const weights = FONT_FILES[font];
  if (weights?.[weight]) return { family: font, weight };
  if (weights) {
    const nearest = Object.keys(weights).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0];
    return { family: font, weight: nearest };
  }
  return { family: "Inter", weight: 600 };
}

const loading = new Map<string, Promise<void>>();

export function loadFont(mediaBaseUrl: string, family: string, weight: number): Promise<void> {
  const key = `${mediaBaseUrl}|${family}|${weight}`;
  const existing = loading.get(key);
  if (existing) return existing;
  const files = FONT_FILES[family]?.[weight];
  if (!files || typeof document === "undefined") return Promise.resolve();
  const base = mediaBaseUrl.replace(/\/$/, "");
  const faces = [
    new FontFace(family, `url(${base}/_fonts/${files.latin})`, { weight: String(weight), unicodeRange: LATIN }),
    new FontFace(family, `url(${base}/_fonts/${files.latinExt})`, { weight: String(weight), unicodeRange: LATIN_EXT }),
  ];
  const promise = Promise.all(
    faces.map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  loading.set(key, promise);
  return promise;
}

// Holds the render until the font is ready (no frames with a fallback font, no layout measured
// with the wrong font). Returns true once loaded.
export function useFont(mediaBaseUrl: string, family: string, weight: number): boolean {
  const [handle] = useState(() => delayRender(`Loading font ${family} ${weight}`));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadFont(mediaBaseUrl, family, weight)
      .catch((error) => console.error(`Font ${family} ${weight} could not be loaded`, error))
      .finally(() => {
        if (!cancelled) setReady(true);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaBaseUrl, family, weight, handle]);
  return ready;
}
