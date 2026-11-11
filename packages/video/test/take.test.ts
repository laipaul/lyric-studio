// "Try another take": only take N of a platform, the same variation a run of N videos would make as vN,
// so each take differs from the ones before (its own seed, order and style).
import { describe, expect, it } from "vitest";

import { planTake, planVariations } from "../src/node/make";
import { checkRunRequest } from "../src/node/runs";

describe("another take", () => {
  it("take N is exactly vN of a run of N videos", () => {
    expect(planTake(1)).toEqual(planVariations(1));
    expect(planTake(3)).toEqual([{ ...planVariations(3)[2], moment: 2 }]); // plus the take's own other-part-of-the-clips
    expect(planTake(3)[0]).toMatchObject({ index: 3, name: "v3", order: "shuffle", seed: 3 });
    expect(planTake(4, { rate: "1x" })).toEqual([{ ...planVariations(4, { rate: "1x" })[3], moment: 3 }]); // with a story: its rate / transitions
  });

  it("each take is different from the one before", () => {
    const seen = new Set([1, 2, 3, 4, 5].map((n) => JSON.stringify({ ...planTake(n)[0], index: 0, name: "" })));
    expect(seen.size).toBe(5);
  });

  it("a take is a number 1-99", () => {
    expect(checkRunRequest({ platforms: ["reels"], take: 3 }, ["reels"])).toEqual([]);
    expect(checkRunRequest({ platforms: ["reels"], take: 0 }, ["reels"])).toEqual(["A take is a number 1-99."]);
  });
});
