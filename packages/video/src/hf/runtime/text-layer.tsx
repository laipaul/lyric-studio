// The HyperFrames text layer (Theme Engine v2, step 2b): the lyrics and the title / hook / end cards drawn by the
// SAME code as the current renderer (LyricScene.tsx, TextCards.tsx), so every lyric effect looks the same. The
// page's GSAP timeline calls draw(frame) on every frame it shows (seekable, deterministic: the look is a pure
// function of the frame). Bundled locally by src/node/hf-render.ts; nothing is fetched.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { LyricScene } from "../../LyricScene";
import { TextCards } from "../../TextCards";
import { DEFAULT_FORMAT, DEFAULT_LYRIC_AREA } from "../../platform";
import type { LyricVideoProps } from "../../props";
import { setFrame, setVideoConfig } from "./clock";

type Props = Omit<LyricVideoProps, "mediaBaseUrl">;
const props = JSON.parse(document.getElementById("text-props")!.textContent!) as Props;
const format = props.format ?? DEFAULT_FORMAT;
setVideoConfig({ fps: 30, durationInFrames: props.durationInFrames, width: format.width, height: format.height });
const root = createRoot(document.getElementById("text")!);
let ready = false;

function Layer() {
  const area = props.lyricArea ?? DEFAULT_LYRIC_AREA;
  return (
    <>
      {props.lyricEffects ? (
        <LyricScene
          lyrics={props.lyrics}
          effects={props.lyricEffects}
          style={props.style}
          hookFont={props.hookFont ?? null}
          textSize={props.textSize}
          colour={props.colour}
          ready={ready}
          areaFor={() => area}
          showNext={props.nextLine ?? false}
          nextScale={props.nextLineScale ?? 0.55}
          backing={props.picture?.backing}
        />
      ) : null}
      {props.textCards?.length ? <TextCards cards={props.textCards} format={format} picture={props.picture} /> : null}
    </>
  );
}

declare global {
  interface Window {
    __vmText?: { ready: Promise<void>; draw: (frame: number) => void };
  }
}
window.__vmText = {
  // Every font face of the page loaded before anything is measured or drawn.
  ready: (async () => {
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));
    await document.fonts.ready;
    ready = true;
  })(),
  draw(frame: number) {
    setFrame(frame);
    flushSync(() => root.render(<Layer />));
  },
};
