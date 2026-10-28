// Storytelling pace (recipe "shotLength"): bars per shot, or "story" (2 bars on hooks, 4 on verses,
// never under 3 s); story order uses every clip once before any repeats; a clip's first shot is the
// window around its best moment (the clip editor's marker, else the strongest 2 s), not its start.
import { describe, expect, it } from "vitest";

import { assignClips, getCutPoints, STORY_MIN_SHOT_MS, type ClipInfo } from "../src";
import { grid } from "./helpers";

const ms = (frames: number) => (frames * 1000) / 30;
const lengths = (plan: ReturnType<typeof getCutPoints>) => {
  const bounds = [plan.start_frame, ...plan.cuts.map((c) => c.frame), plan.end_frame];
  return bounds.slice(1).map((b, i) => ms(b - bounds[i]));
};

describe("shot length", () => {
  // 92 BPM: a bar is 2.61 s; 90.8 s like the Reels cut of "The House My Heart Built".
  const beats = grid(92, 160, 0);
  const section = { start_ms: 0, end_ms: 90_800 };
  const hooks = [{ start_ms: 20_870, end_ms: 41_740 }, { start_ms: 62_610, end_ms: 83_480 }];

  it('"story": 12-20 shots, 2 bars on hooks, 4 on verses, none under 3 s', () => {
    const story = getCutPoints(beats, section, { cutRate: "1x", shotLength: "story", hooks });
    const l = lengths(story);
    expect(l.length).toBeGreaterThanOrEqual(12);
    expect(l.length).toBeLessThanOrEqual(20);
    expect(Math.min(...l)).toBeGreaterThanOrEqual(STORY_MIN_SHOT_MS - 1);
    const bar = 4 * (60_000 / 92);
    const startsAt = (t: number) => story.cuts.find((c) => Math.abs(ms(c.frame) - t) < bar / 2);
    // From a cut inside a hook the next cut is 2 bars on; on a verse 4 bars.
    const inHook = story.cuts.filter((c) => hooks.some((h) => ms(c.frame) >= h.start_ms && ms(c.frame) < h.end_ms - 2 * bar));
    expect(inHook.length).toBeGreaterThan(2);
    for (const c of inHook) {
      const next = story.cuts.find((n) => n.frame > c.frame);
      if (next) expect(Math.round((ms(next.frame) - ms(c.frame)) / bar)).toBe(2);
    }
    expect(Math.round(lengths(story)[0] / bar)).toBe(4); // the verse before the first hook
    expect(startsAt(0)).toBeUndefined();
  });

  it('"story" at a fast tempo: bars added until a shot is at least 3 s', () => {
    const fast = getCutPoints(grid(180, 200, 0), { start_ms: 0, end_ms: 40_000 }, { cutRate: "1x", shotLength: "story", hooks: [{ start_ms: 0, end_ms: 40_000 }] });
    expect(Math.min(...lengths(fast))).toBeGreaterThanOrEqual(STORY_MIN_SHOT_MS - 1);
  });

  it("bars per shot: 1, 2, 4, 8 (replaces the cut rate)", () => {
    const counts = ([1, 2, 4, 8] as const).map((n) => lengths(getCutPoints(beats, section, { cutRate: "2x", shotLength: n })).length);
    expect(counts[0]).toBeGreaterThan(30); // one per bar: what the storyboard showed (51 shots at 135 BPM)
    expect(counts[1]).toBeCloseTo(counts[0] / 2, -1);
    expect(counts[2]).toBeLessThanOrEqual(10);
    expect(counts[3]).toBeLessThanOrEqual(5);
    const four = getCutPoints(beats, section, { cutRate: "2x", shotLength: 4 });
    for (const l of lengths(four).slice(0, -1)) expect(Math.round(l / (4 * 4 * (60_000 / 92)))).toBe(1);
  });
});

describe("story order rounds and the best-moment window", () => {
  const plan = getCutPoints(grid(120, 130), { start_ms: 0, end_ms: 64_000 }, { cutRate: "1x" }); // 2 s shots
  const clips: ClipInfo[] = Array.from({ length: 6 }, (_, i) => ({ id: `0${i + 1}_clip.mp4`, duration_ms: 10_000 }));

  it("each clip once before any repeats", () => {
    const ids = assignClips(plan, clips, 1, { order: "story" }).map((s) => s.clip_id);
    for (let r = 0; r + 6 <= ids.length; r += 6) expect(new Set(ids.slice(r, r + 6)).size).toBe(6);
  });

  it("the clip editor's order (rank) wins over the file names", () => {
    const ranked = clips.map((c, i) => ({ ...c, rank: 5 - i }));
    const ids = assignClips(plan, ranked, 1, { order: "story" }).map((s) => s.clip_id);
    expect(ids.slice(0, 6)).toEqual(clips.map((c) => c.id).reverse());
  });

  it("a clip's first shot is centred on its best moment, inside its in / out", () => {
    const withBest = clips.map((c, i) => ({ ...c, best_ms: 1000 * (i + 2) }));
    const shots = assignClips(plan, withBest, 1, { order: "story" });
    shots.slice(0, 6).forEach((s, i) => {
      const centre = (s.clip_start_frame + s.duration_frames / 2) / 30;
      expect(Math.abs(centre - (i + 3))).toBeLessThan(0.1); // best moment + 1 s (the middle of its 2 s)
    });
    // Without a best moment: from the start (as before).
    expect(assignClips(plan, clips, 1, { order: "story" })[0].clip_start_frame).toBe(0);
    // In / out from the clip editor: never outside them.
    const trimmed = clips.map((c) => ({ ...c, in_ms: 3000, out_ms: 6000, best_ms: 9000 }));
    for (const s of assignClips(plan, trimmed, 1, { order: "story" })) {
      expect(s.clip_start_frame).toBeGreaterThanOrEqual(90);
      expect(s.clip_start_frame + s.duration_frames * s.playback_rate).toBeLessThanOrEqual(180);
    }
  });

  it("the clip editor's speed slows the clip down", () => {
    const slow = clips.map((c) => ({ ...c, speed: 0.5 }));
    expect(assignClips(plan, slow, 1, { order: "story" }).every((s) => s.playback_rate === 0.5)).toBe(true);
  });
});

describe("shot length and tempo in the recipe, on the command line and from Generate", async () => {
  const { checkRecipe, resolveRecipe, LIBRARY_RECIPE, parseMakeArgs, checkRunRequest } = await import("../src/node");
  const artist = { verseEffect: "glide", hookEffect: "karaoke-highlight", verseFont: "Cormorant Garamond", hookFont: "Kaushan Script", accentColour: "#E8A3B5" };

  it("song.json shotLength (per platform too) and tempo are checked", () => {
    expect(checkRecipe({ shotLength: "story", tempo: 92, perPlatform: { youtube: { shotLength: "8" } } }).problems).toEqual([]);
    expect(checkRecipe({ shotLength: "3" as never, tempo: 400 }).problems).toEqual([
      'shotLength must be 1, 2, 4, 8, story (bars per shot, or "story": 2 bars on hooks, 4 on verses, never under 3 s)',
      "tempo must be a number of BPM from 30 to 300 (the song's real tempo)",
    ]);
  });

  it("brand -> song -> song per platform", () => {
    const input = { library: LIBRARY_RECIPE, artist: { ...artist, shotLength: "story" }, artistPlatforms: {}, song: { tempo: 92, perPlatform: { youtube: { shotLength: "4" } } } };
    expect(resolveRecipe(input, "reels").values).toMatchObject({ shotLength: "story", tempo: 92 });
    expect(resolveRecipe(input, "reels").sources.shotLength).toBe("artist");
    expect(resolveRecipe(input, "youtube").values.shotLength).toBe("4");
    expect(resolveRecipe({ ...input, artist }, "reels").values).toMatchObject({ shotLength: null }); // the cut rate
  });

  it("--shot-length and --tempo; Generate's shot length", () => {
    expect(parseMakeArgs(["a.wav", "b.txt", "--shot-length", "story", "--tempo", "92"], "/").options).toMatchObject({ shotLength: "story", tempo: 92 });
    expect(() => parseMakeArgs(["a.wav", "b.txt", "--shot-length", "3"], "/")).toThrow(/--shot-length must be 1, 2, 4 or 8/);
    expect(() => parseMakeArgs(["a.wav", "b.txt", "--tempo", "900"], "/")).toThrow(/--tempo must be/);
    expect(checkRunRequest({ platforms: ["reels"], shotLength: "story" }, ["reels"])).toEqual([]);
    expect(checkRunRequest({ platforms: ["reels"], shotLength: "16" }, ["reels"])).toEqual(["Shot length must be 1, 2, 4 or 8 bars, or story."]);
  });
});
