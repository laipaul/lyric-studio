// The HyperFrames converter (Theme Engine v2 on HyperFrames, step 1): the planner's render props (the same
// object Remotion gets) -> a HyperFrames composition (one HTML file with GSAP + the files it needs). Pure, so
// the tests, the renderer and later the studio's preview build exactly the same composition.
//
// Everything is drawn in one pass (decision D1, 6 Nov 2026): the clips as <video> elements, the lyrics on top.
// The music is never in the composition: our own FFmpeg step cuts the song and adds it (the rule that the
// music is never altered stays in one place).
//
// It draws the Reel picture exactly as the current renderer (LyricVideo.tsx) does: clips (start offset, speed
// 0.5-1x, the last frame held when a clip runs out), photos with their Ken Burns move, cuts, dissolves, dips
// to black, the loop ending (the first shot fading in over the last frames), the theme's grade, vignette and
// readability band, and the background where there is no clip (steps 1 and 2a). Everything else a video can
// use is listed by hyperframesGaps(): such a video is made by the current renderer instead, and the plan says
// why (never a silently different video). The lyric look is a stand-in ("glow reveal", the spike's style)
// until the lyric effects move over in step 2b; it is only used where asked for (the measurement and parity
// scripts), never for a real video. It already places each line as the textboard and the display rules say.
import { VIDEO } from "../config";
import { dipOpacity } from "../transitions";
import type { FontFileRef } from "../font-files";
import { applyTextCase } from "../lyrics";
import type { KenBurns } from "../photo";
import { fallbackBackground, gradeLook, vignetteBackground } from "../picture";
import { DEFAULT_LYRIC_AREA } from "../platform";
import type { LyricVideoProps, ShotProps } from "../props";

// src: as in the props (workspace-relative or _fonts/...); dest: in the composition. frame: not the file but
// that one frame of it as a picture (written once by our FFmpeg when the project is written).
export type HfAsset = { src: string; dest: string; frame?: number };
// textLayer: the page runs the shared text code (assets/text-layer.js, bundled by src/node/hf-render.ts).
export type HfComposition = { html: string; assets: HfAsset[]; durationS: number; width: number; height: number; textLayer: boolean };
type Props = Omit<LyricVideoProps, "mediaBaseUrl">;

const FPS = VIDEO.fps;
// HyperFrames reads its times to 0.1 ms. A clip or line is shown from the first frame whose time is at or after
// its start, so a start is written rounded DOWN to 0.1 ms (a start rounded up to just after its frame showed
// the shot one frame late), and its length so that it ends exactly where the next one starts. An offset into
// a clip is rounded UP (rounded down, 100 / 30 = 3.3333 s read as clip frame 99: one frame early).
const at = (frames: number) => Math.floor((Math.max(0, frames) / FPS) * 1e4 + 1e-6) / 1e4;
const span = (from: number, to: number) => Number((at(to) - at(from)).toFixed(4));
const mediaAt = (frames: number) => Math.ceil((frames / FPS) * 1e4 - 1e-6) / 1e4;
const floor4 = (s: number) => Math.floor(Math.max(0, s) * 1e4 + 1e-6) / 1e4;
const secs = (frames: number) => Number((frames / FPS).toFixed(6)); // the timeline's times (exact)

// What the props use that the HyperFrames converter cannot draw yet, in plain words (empty: it can draw all).
// standInLyrics: the lyric look is the stand-in (measurement only), so the lyric effects are not counted.
export function hyperframesGaps(props: Props, o: { standInLyrics?: boolean } = {}): string[] {
  const gaps: string[] = [];
  const add = (g: string) => !gaps.includes(g) && gaps.push(g);
  // The lyrics and cards are drawn by the shared text code (LyricScene, TextCards) when the video has lyric
  // effects (every video since Step 5j); the old fade / pop look of older manifests is not drawn.
  if (props.lyrics.length && !props.lyricEffects && !o.standInLyrics) add("the lyric animation");
  if (props.layout && props.layout !== "vertical") add(`the YouTube ${props.layout} layout`);
  for (const s of props.shots) {
    if (s.fit === "fill") add("a clip shown whole over a blurred copy");
    if (s.loopBlend) add("the Canvas loop blend");
  }
  if (props.titleOverlay) add("the title overlay");
  if (props.logo) add("the logo");
  if (props.mood?.length) add("section mood");
  if (props.grain) add("film grain");
  if (props.glow) add("the beat glow");
  if (props.cinematicBars) add("cinematic bars");
  if (props.endScreen) add("the end-screen area");
  if (props.endDim?.frames) add("the lights-dim ending");
  if (!props.shots.length) add("a video without clips");
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
  const tc = props.style.textCase;
  return props.lyrics.map((l) => {
    const words = l.words?.length
      ? l.words.map((w) => ({ text: applyTextCase(w.text, tc), start: secs(w.startFrame) }))
      : (() => {
          const ws = l.text.split(/\s+/).filter(Boolean);
          const a = l.stampFrame ?? l.startFrame;
          const b = l.sungEndFrame ?? l.endFrame;
          return ws.map((text, k) => ({ text: applyTextCase(text, tc), start: secs(a + Math.round(((b - a) * k) / ws.length)) }));
        })();
    // After a long instrumental gap the line comes in from enterFrame (the lead-in), else from its start.
    const show = l.enterFrame !== undefined && l.enterFrame < l.startFrame ? l.enterFrame : l.startFrame;
    return { text: applyTextCase(l.text, tc), hook: !!l.isHook, show: secs(show), hide: secs(Math.min(props.durationInFrames, l.endFrame)), words };
  });
}

const full = "position:absolute;left:0;top:0;width:100%;height:100%;";
// A photo's Ken Burns move at its start (0) or end (1): offsets in % of the frame, then the zoom (the same
// transform as the current renderer: translate(x%, y%) scale(z)).
function kenBurnsVars(m: KenBurns, end: 0 | 1): string {
  const [x, y, zoom] = end ? [m.toX, m.toY, m.toZoom] : [m.fromX, m.fromY, m.fromZoom];
  return `{ xPercent: ${(x * 100).toFixed(4)}, yPercent: ${(y * 100).toFixed(4)}, scale: ${zoom.toFixed(5)} }`;
}
function kenBurnsCss(m: KenBurns | undefined, end: 0 | 1): string {
  if (!m) return "";
  const [x, y, zoom] = end ? [m.toX, m.toY, m.toZoom] : [m.fromX, m.fromY, m.fromZoom];
  return `transform:translate(${(x * 100).toFixed(4)}%, ${(y * 100).toFixed(4)}%) scale(${zoom.toFixed(5)});`;
}

export function compileHyperframes(props: Props, o: { gsapSrc?: string } = {}): HfComposition {
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

  // ---- the picture, in the current renderer's order: the background, the clips and photos (with
  // the loop ending) under the grade's filter, the grade's veil, the vignette, the dips, the readability band.
  const picture = props.picture ?? null;
  const area = props.lyricArea ?? DEFAULT_LYRIC_AREA;
  const background = picture ? fallbackBackground(picture) : "#000";
  {
    if (picture?.fallback === "cover" && picture.coverSrc) body.push(`      <img id="cover" class="clip" src="${asset(picture.coverSrc, "images")}" data-start="0" data-duration="${durationS}" data-track-index="0" style="${full}object-fit:cover;z-index:${z++}" />`);
    const grade = gradeLook(picture?.grade);
    const inner: string[] = [];
    // A moving photo gets its move from the timeline only (an inline transform as well would be added to it).
    const moves = (s: ShotProps) => s.kind === "photo" && !!s.motion && s.duration > 1;
    const shot = (s: ShotProps, id: string, from: number, length: number, extra = "") => {
      const src = asset(s.src, s.kind === "photo" ? "images" : "clips");
      if (s.kind === "photo") {
        inner.push(`        <div id="${id}" class="clip" data-start="${at(from)}" data-duration="${span(from, from + length)}" data-track-index="0" style="${full}overflow:hidden;z-index:${z++}${extra}"><img id="${id}i" src="${src}" style="${full}object-fit:cover;${moves(s) ? "" : kenBurnsCss(s.motion, 0)}" /></div>`);
        return;
      }
      // A clip that runs out holds its last frame (HyperFrames does this when the media ends inside its slot).
      inner.push(`        <video id="${id}" class="clip" src="${src}" muted playsinline data-start="${at(from)}" data-duration="${span(from, from + length)}" data-media-start="${mediaAt(s.clipStartFrame)}"${s.playbackRate !== 1 ? ` data-playback-rate="${s.playbackRate}"` : ""} data-track-index="0" style="${full}object-fit:cover;z-index:${z++}${extra}"></video>`);
    };
    props.shots.forEach((s, i) => {
      const before = s.dissolve?.before ?? 0;
      const from = s.start - before;
      shot(s, `s${i}`, from, s.duration + before + (s.tail ?? 0));
      // A photo's move: spread over exactly the shot (a dissolve starts it early, a tail keeps it on after:
      // it stays still there); a looping photo moves out and back.
      if (moves(s)) {
        script.push(`tl.fromTo("#s${i}i", ${kenBurnsVars(s.motion!, 0)}, { ...${kenBurnsVars(s.motion!, 1)}, duration: ${secs(s.duration - 1)}, ease: ${s.motionLoop ? "loopMove" : "burns"} }, ${secs(s.start)});`);
      }
      // A dissolve: the shot fades in over the previous one (which keeps playing underneath for `tail` frames).
      if (s.dissolve) script.push(`tl.fromTo("#s${i}", { opacity: 0 }, { opacity: 1, duration: ${secs(s.dissolve.before + s.dissolve.after)}, ease: "power1.inOut" }, ${secs(from)});`);
    });
    // The loop ending (Reels, TikTok, Shorts): over the last frames the first shot's opening fades in on top, so
    // the last frame leads straight into the first: the frames just before it, or its first frame held.
    const first = props.shots[0];
    if (props.loopInto && props.shots.length > 1 && first) {
      const frames = props.loopInto.frames;
      const back = Math.round(frames * first.playbackRate);
      const end = props.durationInFrames - frames;
      if (first.kind !== "photo" && first.clipStartFrame >= back) {
        shot({ ...first, clipStartFrame: first.clipStartFrame - back }, "loop", end, frames, ";opacity:0");
      } else if (first.kind === "photo") {
        inner.push(`        <div id="loop" class="clip" data-start="${at(end)}" data-duration="${span(end, end + frames)}" data-track-index="0" style="${full}overflow:hidden;opacity:0;z-index:${z++}"><img src="${asset(first.src, "images")}" style="${full}object-fit:cover;${kenBurnsCss(first.motion, 0)}" /></div>`);
      } else {
        const still = `assets/frames/${assetName(first.src)}-${first.clipStartFrame}.png`;
        if (!assets.some((a) => a.dest === still)) assets.push({ src: first.src, dest: still, frame: first.clipStartFrame });
        inner.push(`        <img id="loop" class="clip" src="${still}" data-start="${at(end)}" data-duration="${span(end, end + frames)}" data-track-index="0" style="${full}object-fit:cover;opacity:0;z-index:${z++}" />`);
      }
      // As the current renderer: frame k of the ending at (k + 1) / frames.
      script.push(`tl.fromTo("#loop", { opacity: ${(1 / frames).toFixed(6)} }, { opacity: 1, duration: ${secs(Math.max(1, frames - 1))}, ease: "none" }, ${secs(end)});`);
    }
    if (inner.length) body.push(`      <div id="picture" style="${full}${grade.filter ? `filter:${grade.filter};` : ""}z-index:${z++}">\n${inner.join("\n")}\n      </div>`);
    if (grade.veil && props.shots.length) body.push(`      <div id="veil" data-grade="${picture?.grade}" style="${full}background-color:${grade.veil.colour};mix-blend-mode:${grade.veil.blend};z-index:${z++}"></div>`);
    const vignette = vignetteBackground(picture?.vignette);
    if (vignette) body.push(`      <div id="vignette" style="${full}background:${vignette};z-index:${z++}"></div>`);
    if (props.dips?.length) {
      body.push(`      <div id="dip" class="clip" data-start="0" data-duration="${durationS}" data-track-index="1" style="${full}background:#000;opacity:0;z-index:${z++}"></div>`);
      // The same triangle as the current renderer: darkest on the dip's frame.
      for (const d of props.dips) {
        const half = Math.max(1, d.frames / 2);
        script.push(`tl.fromTo("#dip", { opacity: 0 }, { opacity: ${dipOpacity(d.frame, [d]).toFixed(3)}, duration: ${secs(half)}, ease: "none" }, ${secs(Math.max(0, d.frame - half))});`);
        script.push(`tl.to("#dip", { opacity: 0, duration: ${secs(half)}, ease: "none" }, ${secs(d.frame)});`);
      }
    }
  }
  // The readability band (readability "strong", "auto" on bright clips, or the theme's backing "band"): the
  // soft dark band behind the lyric area (LyricBacking.tsx), under the words.
  if ((props.lyricBacking || picture?.backing === "band") && props.lyrics.length) {
    const half = Math.max(area.bottom - area.top, height * 0.12) * 0.75;
    const top = Math.max(0, area.centerY - half);
    const bottom = Math.min(height, area.centerY + half);
    body.push(`      <div id="band" style="position:absolute;left:0;right:0;top:${top}px;height:${bottom - top}px;background:linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 35%, rgba(0,0,0,0.42) 65%, rgba(0,0,0,0) 100%);z-index:${z++}"></div>`);
  }

  // ---- the text: the shared text code (lyric effects, title / hook / end cards) on its own layer; the stand-in
  // look only for lines without lyric effects (the measurement scripts' old plans)
  const textLayer = !!props.lyricEffects || !!props.textCards?.some((c) => !c.off);
  if (textLayer) body.push(`      <div id="text" style="${full}z-index:${z + 2}"></div>`);
  const timing = props.lyricEffects ? [] : hfTiming(props);
  const verse = props.style;
  // Each line's font: its textboard card's, else the hook font on hook lines, else the style's.
  const fontOf = (i: number) => {
    const l = props.lyrics[i];
    if (l.card?.font) return { family: l.card.font.family, weight: l.card.font.weight, italic: l.card.font.italic === true };
    if (l.isHook && props.hookFont) return { family: props.hookFont.font, weight: props.hookFont.weight, italic: props.hookFont.italic === true };
    return { family: verse.font, weight: verse.weight, italic: verse.italic === true };
  };
  const families = new Set([verse.font, ...props.lyrics.map((_, i) => fontOf(i).family)]);
  const faces = props.fonts
    .filter((f: FontFileRef) => textLayer || families.has(f.family))
    .map((f: FontFileRef) => `@font-face { font-family: "${fontAlias(f.family)}"; src: url("${asset(f.src, "fonts")}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style};${f.unicodeRange ? ` unicode-range: ${f.unicodeRange};` : ""} }`);
  timing.forEach((l, i) => {
    const words = l.words.map((w, k) => `<span class="w" id="l${i}w${k}">${esc(w.text)}</span>`).join(" ");
    const from = Math.max(0, l.show);
    const card = props.lyrics[i].card;
    const f = fontOf(i);
    const own = [
      card?.centerY !== undefined ? `top:${card.centerY}px;` : "",
      f.family !== verse.font ? `font-family:"${fontAlias(f.family)}";` : "",
    ].join("");
    const innerOwn = [
      card?.scale !== undefined && card.scale !== 1 ? `font-size:${Math.round(props.textSize * card.scale)}px;` : "",
      f.weight !== verse.weight ? `font-weight:${f.weight};` : "",
      f.italic !== (verse.italic === true) ? `font-style:${f.italic ? "italic" : "normal"};` : "",
    ].join("");
    body.push(`      <div id="l${i}" class="line clip${l.hook ? " hook" : ""}" data-start="${floor4(from)}" data-duration="${Number((floor4(l.hide) - floor4(from)).toFixed(4))}" data-track-index="2" style="${own}z-index:${z + 1}"><div class="inner"${innerOwn ? ` style="${innerOwn}"` : ""}>${words}</div></div>`);
  });
  const accent = props.lyricEffects?.accent ?? "#E8A3B5";
  // The text layer's props: every family under our own name (only our files are ever drawn), no picture data.
  const fa = fontAlias;
  const textProps = textLayer
    ? JSON.stringify({
        ...props,
        shots: [],
        dips: [],
        style: { ...props.style, font: fa(props.style.font) },
        hookFont: props.hookFont ? { ...props.hookFont, font: fa(props.hookFont.font) } : null,
        lyrics: props.lyrics.map((l) => (l.card?.font ? { ...l, card: { ...l.card, font: { ...l.card.font, family: fa(l.card.font.family) } } } : l)),
        textCards: props.textCards?.map((c) => ({ ...c, font: fa(c.font), ...(c.fallbackFont ? { fallbackFont: fa(c.fallbackFont) } : {}) })),
      }).replace(/</g, "\\u003c")
    : null;
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
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${background}; font-family: "${fontAlias(verse.font)}"; }
      .line { position: absolute; left: ${area.left}px; width: ${area.right - area.left}px; top: ${area.centerY}px; transform: translateY(-50%); text-align: center; }
      .inner { font-size: ${props.textSize}px; font-weight: ${verse.weight}; font-style: ${verse.italic ? "italic" : "normal"}; font-synthesis: none; line-height: 1.18; color: ${props.colour}; text-wrap: balance; }
      .w { display: inline-block; opacity: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationS}" data-width="${width}" data-height="${height}" data-fps="${FPS}">
${body.join("\n")}
    </div>
    <script type="application/json" id="lyric-data">${data}</script>${textProps ? `\n    <script type="application/json" id="text-props">${textProps}</script>\n    <script src="assets/text-layer.js"></script>` : ""}
    <script>
      // Built once the text layer has its fonts (HyperFrames waits until the timeline is registered).
      (window.__vmText ? window.__vmText.ready : Promise.resolve()).then(() => {
      const tl = gsap.timeline({ paused: true });
      // The current renderer's photo moves (src/photo.ts kenBurnsAt, src/canvas.ts photoLoopProgress).
      const burns = (t) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
      const loopMove = (t) => burns((1 - Math.cos(2 * Math.PI * Math.min(1, Math.max(0, t)))) / 2);
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
      // The text layer: drawn by the shared text code on every frame the timeline shows.
      if (window.__vmText) {
        const clock = { f: 0 };
        tl.to(clock, { f: ${props.durationInFrames}, duration: ${durationS}, ease: "none", onUpdate: () => window.__vmText.draw(Math.round(clock.f)) }, 0);
        window.__vmText.draw(0);
      }
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
      });
    </script>
  </body>
</html>
`;
  return { html, assets, durationS, width, height, textLayer };
}
