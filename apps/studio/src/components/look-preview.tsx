"use client";

// The Style tab's Look block in two columns: the creative choices on the left (font pairings, fonts,
// Set effect, accent colour) and one big live preview on the right, sticky while the left scrolls
// (narrow screens: on top, not sticky). The preview is the video's own LyricScene (LookPreview in
// @lyric/video) on the song's first lines over the frame of the song's clips the pairing cards use, and
// reflects at once: the song's fonts (or the pair under the pointer / keyboard focus, without saving),
// what is tried in Set effect (kept per song in sessionStorage), the accent colour and the soft backing
// behind the lyrics when the render would add it (readability, the render's own rule).
import { shortFrom } from "@/lib/short-from";
import { Player } from "@remotion/player";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { LOOK_FPS, LookPreview, lookPreviewDuration, parseTried, previewBacking, previewFace, previewLyrics, triedKey, type CatalogFont, type FontFileRef, type LookFace, type Readability, type TriedEffect } from "@lyric/video";
import type { PairingCard, PairingsView } from "@lyric/video/pairings";

export type LookControls = {
  tried: TriedEffect;
  setTried: (t: TriedEffect) => void;
  onPairingView: (view: PairingsView) => void;
  onPairingHover: (card: PairingCard | null) => void;
};

function readStored(projectId: string, effectNames: string[]): TriedEffect | null {
  try {
    return parseTried(window.sessionStorage.getItem(triedKey(projectId)), effectNames);
  } catch {
    return null;
  }
}

export function LookWorkbench({
  projectId,
  effectNames,
  saved,
  fonts,
  lines,
  verse,
  hook,
  accent,
  readability,
  children,
}: {
  projectId: string;
  effectNames: string[];
  saved: TriedEffect; // the recipe's verse effect, Breathe and add-ons (what Set effect starts from)
  fonts: CatalogFont[];
  lines: string[];
  verse: LookFace; // the song's fonts (the recipe)
  hook: LookFace;
  accent: string; // the accent colour as it is being chosen
  readability: Readability;
  children: (controls: LookControls) => ReactNode;
}) {
  // Drawn only after the Style tab has its data in the browser, so reading storage here cannot mismatch server HTML.
  const [tried, setTried] = useState<TriedEffect>(() => (typeof window === "undefined" ? null : readStored(projectId, effectNames)) ?? saved);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(triedKey(projectId), JSON.stringify(tried));
    } catch {
      // storage unavailable (private mode, quota): the panel just forgets
    }
  }, [projectId, tried]);
  const [view, setView] = useState<PairingsView | null>(null);
  const [hovered, setHovered] = useState<PairingCard | null>(null);

  const shown = hovered ? { verse: hovered.verse, hook: hovered.hook } : { verse, hook };
  const [vf, vw, vi] = [shown.verse.family, shown.verse.weight, shown.verse.italic];
  const [hf, hw, hi] = [shown.hook.family, shown.hook.weight, shown.hook.italic];
  const v = useMemo(() => previewFace(fonts, vf, vw, vi), [fonts, vf, vw, vi]);
  const h = useMemo(() => previewFace(fonts, hf, hw, hi), [fonts, hf, hw, hi]);
  const verseFace: LookFace = useMemo(() => (v ? { family: v.family, weight: v.weight, italic: v.italic } : { family: vf, weight: vw, italic: vi }), [v, vf, vw, vi]);
  const hookFace: LookFace = useMemo(() => (h ? { family: h.family, weight: h.weight, italic: h.italic } : { family: hf, weight: hw, italic: hi }), [h, hf, hw, hi]);
  const files = useMemo(() => {
    const all: FontFileRef[] = [...(v?.files ?? []), ...(h?.files ?? [])];
    return all.filter((f, i) => all.findIndex((g) => g.src === f.src && g.family === f.family) === i);
  }, [v, h]);
  const lyrics = useMemo(() => previewLyrics(lines), [lines]);
  const backing = previewBacking(readability, view?.bandLuminance ?? null, { colour: view?.colour ?? "#ffffff", accent, verse: verseFace, hook: hookFace });
  const background = view?.background ? `/api/files/${view.background}` : null;
  const effect = useMemo(() => ({ name: tried.name, intensity: tried.intensity }), [tried.name, tried.intensity]);

  const controls: LookControls = { tried, setTried, onPairingView: setView, onPairingHover: setHovered };
  return (
    <div data-look className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_min(340px,26vw)]">
      <div className="flex min-w-0 flex-col gap-2">{children(controls)}</div>
      <aside
        data-look-preview
        data-effect={tried.name}
        data-intensity={tried.intensity}
        data-breathe={tried.breathe}
        data-addons={(["heldGlow", "chorusLift", "shine"] as const).filter((k) => tried.addOns[k]).join(",")}
        data-verse-family={verseFace.family}
        data-hook-family={hookFace.family}
        data-hook-face={`${hookFace.family} ${hookFace.weight}${hookFace.italic ? " italic" : ""}`}
        data-accent={accent}
        data-backing={backing ? "1" : "0"}
        data-previewing-pair={hovered?.id}
        className="order-first mx-auto flex w-[300px] max-w-full flex-col gap-1.5 self-start lg:sticky lg:top-4 lg:order-none lg:w-[min(340px,26vw)]"
      >
        <div className="overflow-hidden rounded-lg border shadow-lg">
          <Player
            component={LookPreview}
            inputProps={{
              mediaBaseUrl: "/api/fonts",
              fonts: files,
              background,
              lyrics,
              effect,
              breathe: tried.breathe,
              addOns: tried.addOns,
              verse: verseFace,
              hook: hookFace,
              accent,
              colour: view?.colour ?? "#ffffff",
              textSize: view?.textSize ?? 64,
              area: view?.area ?? null,
              backing,
            }}
            durationInFrames={lookPreviewDuration(lyrics.length)}
            fps={LOOK_FPS}
            compositionWidth={1080}
            compositionHeight={1920}
            style={{ width: "100%", aspectRatio: "9 / 16" }}
            autoPlay
            loop
            controls={false}
          />
        </div>
        <p data-look-preview-caption className="text-muted-foreground text-[11px] leading-snug break-words" title={view?.backgroundFrom ?? undefined}>
          {hovered ? (
            <>
              Trying <span className="text-foreground">{hovered.name}</span> — click the card to use it.
            </>
          ) : (
            <>Your song&apos;s first lines as the video draws them{view?.backgroundFrom ? `, over ${shortFrom(view.backgroundFrom)}` : ""}{backing ? ", with the soft backing the video adds behind the lyrics" : ""}. Nothing is saved until you choose.</>
          )}
        </p>
      </aside>
    </div>
  );
}
