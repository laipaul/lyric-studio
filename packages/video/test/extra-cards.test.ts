// The theme's Hook card and End card (Reels, TikTok, Shorts): placed and timed by the app, never over a lyric.
import { describe, expect, it } from "vitest";

import { extraCards, fillCardText, patchLook, type LyricVideoProps } from "../src";

const FPS = 30;
const area = { top: 300, bottom: 1500, centerY: 900 };
const look = (text: string, off = false) => ({ text, font: { family: "Cormorant Garamond", weight: 600 }, size: 92, colour: "#E8A3B5", style: "plain" as const, off });
// Line 1 (verse) 1-3 s, a pause, line 2 (chorus) 6-8 s, line 3 8-10 s; the video is 12 s.
const lyrics = [
  { startFrame: 30, endFrame: 90 },
  { startFrame: 180, endFrame: 240, isHook: true },
  { startFrame: 240, endFrame: 300 },
];

describe("hook card", () => {
  it("sits in the pause before the first chorus, at most 2.5 s, gone before the chorus line comes in", () => {
    const { cards, notes } = extraCards({ lyrics, fps: FPS, durationInFrames: 360, area, titleEndFrame: 0, hook: look("You had a heart for two"), end: null });
    const hook = cards.find((c) => c.id === "hook")!;
    expect(hook.startFrame).toBe(180 - 75);
    expect(hook.endFrame).toBe(178);
    expect(hook.startFrame).toBeGreaterThanOrEqual(90);
    expect(hook.centerY).toBe(900);
    expect(hook.upper).toBe(true);
    expect(notes).toEqual([]);
  });
  it("no pause before the chorus: no hook card, and a note says why", () => {
    const tight = [{ startFrame: 30, endFrame: 180 }, { startFrame: 180, endFrame: 240, isHook: true }];
    const r = extraCards({ lyrics: tight, fps: FPS, durationInFrames: 360, area, titleEndFrame: 0, hook: look("Hook"), end: null });
    expect(r.cards).toEqual([]);
    expect(r.notes[0]).toMatch(/no pause/);
  });
});

describe("end card", () => {
  it("after the last line: in the lyric spot for the last seconds, staying to the very end", () => {
    const { cards } = extraCards({ lyrics, fps: FPS, durationInFrames: 420, area, titleEndFrame: 0, hook: null, end: look("Stream A Heart For Two on Spotify") });
    const end = cards.find((c) => c.id === "end")!;
    expect(end.startFrame).toBeGreaterThanOrEqual(300);
    expect(end.startFrame).toBe(420 - 105);
    expect(end.endFrame).toBeGreaterThan(420);
    expect(end.centerY).toBe(900);
  });
  it("the last line sung to the end: above or below the lyrics, never on them", () => {
    const { cards } = extraCards({ lyrics, fps: FPS, durationInFrames: 310, area, titleEndFrame: 0, hook: null, end: look("Stream it") });
    const end = cards.find((c) => c.id === "end")!;
    expect(Math.abs(end.centerY! - area.centerY)).toBeGreaterThan(400);
  });
  it("{title} and {artist} are filled in", () => {
    expect(fillCardText("Stream {title} on Spotify — {artist}", { title: "A Heart For Two", artist: "Life Lyrics" })).toBe("Stream A Heart For Two on Spotify — Life Lyrics");
  });
});

describe("the editor switches them on in the viewer at once", () => {
  it("patchLook turns a planned card on or off and sets its style", () => {
    const { cards } = extraCards({ lyrics, fps: FPS, durationInFrames: 420, area, titleEndFrame: 0, hook: look("Hook", true), end: look("Stream it", true) });
    const props = { textCards: cards } as unknown as LyricVideoProps;
    const on = patchLook(props, { cards: { hook: true, hookStyle: "outline", end: true, endStyle: "label" } });
    expect(on.textCards!.map((c) => [c.id, !!c.off, c.cardStyle])).toEqual([["hook", false, "outline"], ["end", false, "label"]]);
    const off = patchLook(on, { cards: { hook: false, hookStyle: "plain", end: true, endStyle: "plain" } });
    expect(off.textCards!.map((c) => [c.id, !!c.off, c.cardStyle])).toEqual([["hook", true, undefined], ["end", false, undefined]]);
  });
});
