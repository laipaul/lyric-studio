// The HyperFrames converter (Theme Engine v2 on HyperFrames, step 1): what it can draw (gaps), the clips at
// the plan's exact frames (start, offset, speed), dissolves and dips, our own fonts only (by our own family
// names, no generic family and no URL: HyperFrames never looks a font up), and the planner's word times.
import { describe, expect, it } from "vitest";

import { compileHyperframes, hfTiming, hyperframesGaps, SIMPLE_STYLE, type LyricVideoProps } from "../src";
import { FRAME_TEST_SHOTS, frameTestProps } from "../src/node";

// As HyperFrames reads a time (to 0.1 ms): the first video frame at or after it; and the clip frame at an offset.
const r4 = (t: number) => Math.round(t * 1e4) / 1e4;
const firstFrameAt = (t: number) => Math.max(0, Math.ceil(r4(t) * 30 - 1e-9));
const clipFrameAt = (t: number) => Math.floor(r4(t) * 30 + 1e-9);
const base = (extra: Partial<Omit<LyricVideoProps, "mediaBaseUrl">> = {}): Omit<LyricVideoProps, "mediaBaseUrl"> => ({ ...frameTestProps("clips/a.mp4"), ...extra });

describe("what the converter can draw", () => {
  it("clips, cuts, dissolves and dips: nothing missing", () => {
    expect(hyperframesGaps(base({ dips: [{ frame: 100, frames: 12 }] }))).toEqual([]);
  });

  it("the Reel picture (step 2a): photos, the loop ending, grade, vignette, band, background: nothing missing", () => {
    const props = base({
      shots: [{ ...base().shots[0], kind: "photo", motion: { fromZoom: 1, toZoom: 1.1, fromX: 0, fromY: 0, toX: 0.02, toY: -0.01 } }, ...base().shots.slice(1)],
      loopInto: { frames: 6 },
      lyricBacking: true,
      picture: { grade: "warm", vignette: "soft", backing: "band", fallback: "colour", fallbackColour: "#101014", accent: "#E8A3B5" },
    });
    expect(hyperframesGaps(props)).toEqual([]);
  });

  it("the loop ending: the first shot's opening when it can play, else its first frame as a picture", () => {
    const later = base().shots.map((s, i) => (i === 0 ? { ...s, clipStartFrame: 30 } : s));
    const plays = compileHyperframes(base({ shots: later, loopInto: { frames: 6 } }), {});
    expect(plays.html).toMatch(/<video id="loop"[^>]*data-start="7.8"[^>]*data-duration="0.2"[^>]*data-media-start="0.8"/);
    const shots = base().shots.map((s, i) => (i === 0 ? { ...s, clipStartFrame: 2 } : s));
    const held = compileHyperframes(base({ shots, loopInto: { frames: 6 } }), {});
    expect(held.assets).toContainEqual({ src: "clips/a.mp4", dest: "assets/frames/a.mp4-2.png", frame: 2 });
    expect(held.html).toMatch(/<img id="loop" class="clip" src="assets\/frames\/a.mp4-2.png"/);
    expect(held.html).toContain(`tl.fromTo("#loop", { opacity: 0.166667 }, { opacity: 1, duration: 0.166667, ease: "none" }, 7.8);`);
  });

  it("anything else is listed in plain words (the video is then made by the current renderer)", () => {
    const props = base({
      lyrics: [{ text: "Hold on", startFrame: 0, endFrame: 30 }],
      lyricEffects: { verse: { name: "glide", intensity: "balanced" }, hook: { name: "karaoke-highlight", intensity: "balanced" }, accent: "#E8A3B5" },
      logo: { src: "brand/logo.png", left: 0, top: 0, width: 10, height: 10, goneAt: null },
      lyricBacking: true,
      shots: [{ ...base().shots[0], kind: "photo", fit: "fill" }],
      grain: true,
    });
    expect(hyperframesGaps(props)).toEqual(["a clip shown whole over a blurred copy", "the logo", "film grain"]);
    // Lines without lyric effects (manifests from before Step 5j): their old look is not drawn.
    const old = { ...props, lyricEffects: null };
    expect(hyperframesGaps(old)).toContain("the lyric animation");
    expect(hyperframesGaps(old, { standInLyrics: true })).not.toContain("the lyric animation");
  });
});

describe("the composition", () => {
  const props = base({
    shots: base().shots.map((s, i) => (i === 2 ? { ...s, dissolve: { before: 6, after: 9 }, tail: 0 } : s)),
    dips: [{ frame: 150, frames: 12 }],
    fonts: [{ family: "Cormorant Garamond", weight: 400, style: "normal", src: "_fonts/cormorant-garamond-latin-400-normal.woff2" }],
    style: { ...SIMPLE_STYLE, font: "Cormorant Garamond", weight: 400 },
    lyrics: [{ text: "Hold on to me", startFrame: 20, endFrame: 200, words: [{ text: "Hold", startFrame: 30, endFrame: 45 }, { text: "on", startFrame: 50, endFrame: 60 }, { text: "to", startFrame: 62, endFrame: 70 }, { text: "me", startFrame: 75, endFrame: 120 }] }],
  });
  const comp = compileHyperframes(props, {});

  it("each shot at its frames: start, offset into the clip, speed", () => {
    const videos = [...comp.html.matchAll(/<video id="s(\d+)"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)" data-media-start="([\d.]+)"(?: data-playback-rate="([\d.]+)")?/g)];
    expect(videos).toHaveLength(FRAME_TEST_SHOTS.length);
    for (const v of videos) {
      const s = props.shots[Number(v[1])];
      const before = s.dissolve?.before ?? 0;
      expect(firstFrameAt(Number(v[2]))).toBe(s.start - before);
      expect(firstFrameAt(Number(v[2]) + Number(v[3]))).toBe(s.start + s.duration + (s.tail ?? 0));
      expect(clipFrameAt(Number(v[4]))).toBe(s.clipStartFrame);
      expect(Number(v[5] ?? 1)).toBe(s.playbackRate);
    }
  });

  it("every frame of a minute: each cut on its own frame, each offset on its own clip frame (HyperFrames reads 0.1 ms)", () => {
    const shots = Array.from({ length: 1800 }, (_, f) => ({ start: f, duration: 1, src: "clips/a.mp4", clipStartFrame: f, clipDurationFrames: 2000, playbackRate: 1, holdLastFrame: false }));
    const html = compileHyperframes(base({ shots, durationInFrames: 1800, lyrics: [] }), {}).html;
    const videos = [...html.matchAll(/data-start="([\d.]+)" data-duration="([\d.]+)" data-media-start="([\d.]+)"/g)];
    expect(videos).toHaveLength(1800);
    videos.forEach((v, f) => {
      expect(firstFrameAt(Number(v[1]))).toBe(f);
      expect(firstFrameAt(Number(v[1]) + Number(v[2]))).toBe(f + 1);
      expect(clipFrameAt(Number(v[3]))).toBe(f);
    });
  });
  it("a dissolve fades the shot in over the previous one; a dip is a black layer", () => {
    expect(comp.html).toContain('tl.fromTo("#s2", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.inOut" }');
    expect(comp.html).toMatch(/<div id="dip" class="clip"/);
  });

  it("fonts: our own file under our own name, no generic family, nothing from the web", () => {
    expect(comp.html).toContain('font-family: "vm Cormorant Garamond"; src: url("assets/fonts/cormorant-garamond-latin-400-normal.woff2")');
    expect(comp.html).not.toMatch(/https?:\/\//);
    for (const decl of comp.html.match(/font-family:[^;]+;/g) ?? []) expect(decl).not.toMatch(/\b(serif|sans-serif|monospace|cursive|system-ui)\b/);
  });

  it("the lyrics read the planner's word times (seconds from the first frame)", () => {
    expect(hfTiming(props)[0].words.map((w) => w.start)).toEqual([1, 1.666667, 2.066667, 2.5]);
  });
});
