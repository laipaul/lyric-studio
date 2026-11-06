// The HyperFrames converter (Theme Engine v2 on HyperFrames, step 1): the planner's render props (the same
// object Remotion gets) -> a HyperFrames composition (one HTML file with GSAP + the files it needs). Pure, so
// the tests, the renderer and later the studio's preview build exactly the same composition.
//
// Two modes (decision D1 is measured with both):
//   "all"     everything in one: the clips as <video> elements and the lyrics on top;
//   "lyrics"  the lyric layer only, on a transparent page (FFmpeg draws the picture and lays it underneath).
// The music is never in the composition: our own FFmpeg step cuts the song and adds it (the rule that the
// music is never altered stays in one place).
//
// Step 1 draws: clips (start offset, speed 0.5-1x, the last frame held when a clip runs out), cuts, dissolves
// and dips to black. Everything else a video can use is listed by hyperframesGaps(): such a video is made by
// the current renderer instead, and the plan says why (never a silently different video). The lyric look is
// a stand-in ("glow reveal", the spike's style) until the lyric effects move over in steps 2a / 2b; it is
// only used where asked for (the measurement script), never for a real video.
import { VIDEO } from "../config";
import { dipOpacity } from "../transitions";
import type { FontFileRef } from "../font-files";
import type { LyricVideoProps } from "../props";

export type HfMode = "all" | "lyrics";
export type HfAsset = { src: string; dest: string }; // src: as in the props (workspace-relative or _fonts/...); dest: in the composition
export type HfComposition = { html: string; assets: HfAsset[]; durationS: number; width: number; height: number };
type Props = Omit<LyricVideoProps, "mediaBaseUrl">;

const FPS = VIDEO.fps;
// Seconds for a frame position: full precision and a hair past the frame (1/1000 of a frame), so a time never
// reads as the frame before it (100 / 30 written as 3.3333 s was frame 99.999: one frame early).
const sec = (frames: number) => Number(((frames + 0.001) / FPS).toFixed(6));
const secs = (frames: number) => Number((frames / FPS).toFixed(6)); // a length

// What the props use that the HyperFrames converter cannot draw yet, in plain words (empty: it can draw all).
// standInLyrics: the lyric look is the stand-in (measurement only), so the lyric effects are not counted.
export function hyperframesGaps(props: Props, mode: HfMode = "all", o: { standInLyrics?: boolean } = {}): string[] {
  const gaps: string[] = [];
  const add = (g: string) => !gaps.includes(g) && gaps.push(g);
  if (props.lyrics.length && !o.standInLyrics) {
    const fx = props.lyricEffects;
    add(fx ? `the lyric effects (${fx.verse.name}${fx.hook.name !== fx.verse.name ? ` / ${fx.hook.name}` : ""})` : "the lyric animation");
  }
  if (props.layout && props.layout !== "vertical") add(`the YouTube ${props.layout} layout`);
  for (const s of props.shots) {
    if (s.kind === "photo") add("photos (Ken Burns)");
    if (s.fit === "fill") add("a clip shown whole over a blurred copy");
    if (s.loopBlend) add("the Canvas loop blend");
  }
  if (props.loopInto) add("the loop ending's fade into the first shot");
  if (props.textCards?.some((c) => !c.off)) add("title cards");
  if (props.titleOverlay) add("the title overlay");
  if (props.logo) add("the logo");
  if (props.mood?.length) add("section mood");
  if (props.grain) add("film grain");
  if (props.glow) add("the beat glow");
  if (props.cinematicBars) add("cinematic bars");
  if (props.lyricBacking) add("the readability band");
  if (props.endScreen) add("the end-screen area");
  const p = props.picture;
  if (p && (p.grade !== "natural" || p.vignette !== "off" || (p.backing !== "none" && p.backing !== undefined))) add("the theme's picture (grade, vignette, text backing)");
  if (!props.shots.length && mode === "all") add("a video without clips");
  return gaps;
}

// File name inside the composition for a props file.
const assetName = (src: string) => src.split("/").pop()!.replace(/[^A-Za-z0-9._-]+/g, "_");
// Our fonts get their own family names, so HyperFrames never swaps in (or downloads) its own copy of a
// family with the same name: the exact files the props list are drawn, offline.
export const fontAlias = (family: string) => `vm ${family}`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The stand-in lyric look: each word rises in from a soft blur and lands (fully visible, glow at its peak)
// exactly on its sung start; a line already on screen at frame 0 is drawn settled.
export const STAND_IN_STYLE = { revealS: 0.22, risePx: 18, blurPx: 6, settleS: 0.7, glowPx: 18, hookGlowPx: 28, lineFadeS: 0.25 };

export type HfTimingLine = { text: string; hook: boolean; show: number; hide: number; words: { text: string; start: number }[] };

// The lyric timing the composition reads (seconds from the first frame): the planner's own frames.
export function hfTiming(props: Props): HfTimingLine[] {
  return props.lyrics.map((l) => {
    const words = l.words?.length
      ? l.words.map((w) => ({ text: w.text, start: secs(w.startFrame) }))
      : (() => {
          const ws = l.text.split(/\s+/).filter(Boolean);
          const a = l.stampFrame ?? l.startFrame;
          const b = l.sungEndFrame ?? l.endFrame;
          return ws.map((text, k) => ({ text, start: secs(a + Math.round(((b - a) * k) / ws.length)) }));
        })();
    return { text: l.text, hook: !!l.isHook, show: secs(l.startFrame), hide: secs(Math.min(props.durationInFrames, l.endFrame)), words };
  });
}

export function compileHyperframes(props: Props, o: { mode: HfMode; gsapSrc?: string }): HfComposition {
  const width = props.format?.width ?? VIDEO.width;
  const height = props.format?.height ?? VIDEO.height;
  const durationS = secs(props.durationInFrames);
  const assets: HfAsset[] = [];
  const asset = (src: string, folder: string) => {
    const dest = `assets/${folder}/${assetName(src)}`;
    if (!assets.some((a) => a.dest === dest)) assets.push({ src, dest });
    return dest;
  };
  const body: string[] = [];
  const script: string[] = [];
  let z = 1;

  // ---- the picture: clips, dissolves, dips ("all" only)
  if (o.mode === "all") {
    props.shots.forEach((s, i) => {
      const before = s.dissolve?.before ?? 0;
      const from = s.start - before;
      const length = s.duration + before + (s.tail ?? 0);
      const src = asset(s.src, "clips");
      // A clip that runs out holds its last frame (HyperFrames does this when the media ends inside its slot).
      body.push(
        `      <video id="s${i}" class="clip" src="${src}" muted playsinline data-start="${sec(from)}" data-duration="${secs(length)}" data-media-start="${sec(s.clipStartFrame)}"${s.playbackRate !== 1 ? ` data-playback-rate="${s.playbackRate}"` : ""} data-track-index="0" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;object-fit:cover;z-index:${z++}"></video>`,
      );
      // A dissolve: the shot fades in over the previous one (which keeps playing underneath for `tail` frames).
      if (s.dissolve) script.push(`tl.fromTo("#s${i}", { opacity: 0 }, { opacity: 1, duration: ${secs(s.dissolve.before + s.dissolve.after)}, ease: "power1.inOut" }, ${sec(from)});`);
    });
    if (props.dips?.length) {
      body.push(`      <div id="dip" class="clip" data-start="0" data-duration="${durationS}" data-track-index="1" style="position:absolute;inset:0;background:#000;opacity:0;z-index:${z++}"></div>`);
      // The same triangle as the current renderer: darkest on the dip's frame.
      for (const d of props.dips) {
        const half = Math.max(1, d.frames / 2);
        script.push(`tl.fromTo("#dip", { opacity: 0 }, { opacity: ${dipOpacity(d.frame, [d]).toFixed(3)}, duration: ${secs(half)}, ease: "none" }, ${sec(Math.max(0, d.frame - half))});`);
        script.push(`tl.to("#dip", { opacity: 0, duration: ${secs(half)}, ease: "none" }, ${sec(d.frame)});`);
      }
    }
  }

  // ---- the lyrics (stand-in look)
  const timing = hfTiming(props);
  const area = props.lyricArea ?? { left: Math.round(width * 0.06), right: Math.round(width * 0.82), centerY: Math.round(height * 0.45) };
  const verse = props.style;
  const faces = props.fonts
    .filter((f: FontFileRef) => f.family === verse.font)
    .map((f: FontFileRef) => `@font-face { font-family: "${fontAlias(f.family)}"; src: url("${asset(f.src, "fonts")}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style};${f.unicodeRange ? ` unicode-range: ${f.unicodeRange};` : ""} }`);
  timing.forEach((l, i) => {
    const words = l.words.map((w, k) => `<span class="w" id="l${i}w${k}">${esc(w.text)}</span>`).join(" ");
    const from = Math.max(0, l.show);
    body.push(`      <div id="l${i}" class="line clip${l.hook ? " hook" : ""}" data-start="${from}" data-duration="${Number((l.hide - from).toFixed(6))}" data-track-index="2" style="z-index:${z + 1}"><div class="inner">${words}</div></div>`);
  });
  const accent = props.lyricEffects?.accent ?? "#E8A3B5";
  const data = JSON.stringify({ accent, style: STAND_IN_STYLE, lines: timing }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<!-- Made by Videomaker's HyperFrames converter (packages/video/src/hf/compile.ts) from the planner's render props. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="${o.gsapSrc ?? "assets/gsap.min.js"}"></script>
    <style>
      ${faces.join("\n      ")}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${o.mode === "all" ? "#000" : "transparent"}; }
      #root { position: relative; width: 100%; height: 100%; background: ${o.mode === "all" ? "#000" : "transparent"}; font-family: "${fontAlias(verse.font)}"; }
      .line { position: absolute; left: ${area.left}px; width: ${area.right - area.left}px; top: ${area.centerY}px; transform: translateY(-50%); text-align: center; }
      .inner { font-size: ${props.textSize}px; font-weight: ${verse.weight}; font-style: ${verse.italic ? "italic" : "normal"}; font-synthesis: none; line-height: 1.18; color: ${props.colour}; text-wrap: balance; }
      .w { display: inline-block; opacity: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationS}" data-width="${width}" data-height="${height}" data-fps="${FPS}">
${body.join("\n")}
    </div>
    <script type="application/json" id="lyric-data">${data}</script>
    <script>
      const tl = gsap.timeline({ paused: true });
${script.map((l) => `      ${l}`).join("\n")}
      // Lyrics (stand-in look): every word lands on its sung start.
      const D = JSON.parse(document.getElementById("lyric-data").textContent);
      const S = D.style;
      const rgba = (hex, a) => { const n = parseInt(hex.replace("#", ""), 16); return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
      const shadow = (px, a) => "0px 2px 12px rgba(0,0,0,0.55), 0px 0px " + px + "px " + rgba(D.accent, a);
      D.lines.forEach((line, i) => {
        const inner = document.getElementById("l" + i).firstElementChild;
        const peak = line.hook ? S.hookGlowPx : S.glowPx;
        const from = Math.max(0, line.show);
        if (line.show < 0) gsap.set(inner, { opacity: 1 });
        else tl.fromTo(inner, { opacity: 0 }, { opacity: 1, duration: S.lineFadeS, ease: "power1.out" }, line.show);
        tl.to(inner, { opacity: 0, duration: S.lineFadeS, ease: "power1.in" }, line.hide - S.lineFadeS);
        line.words.forEach((w, k) => {
          const el = document.getElementById("l" + i + "w" + k);
          if (w.start <= 0) { gsap.set(el, { opacity: 1, y: 0, filter: "blur(0px)", textShadow: shadow(peak * 0.45, 0.35) }); return; }
          const d = Math.max(1 / ${FPS}, Math.min(S.revealS, w.start - from));
          tl.fromTo(el, { opacity: 0, y: S.risePx, filter: "blur(" + S.blurPx + "px)", textShadow: shadow(0, 0) }, { opacity: 1, y: 0, filter: "blur(0px)", textShadow: shadow(peak, 0.95), duration: d, ease: "power2.out" }, w.start - d);
          tl.to(el, { textShadow: shadow(peak * 0.45, 0.35), duration: S.settleS, ease: "power1.out" }, w.start);
        });
      });
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  return { html, assets, durationS, width, height };
}
