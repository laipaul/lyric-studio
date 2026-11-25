// A take's short tag (25 Nov 2026, Paul: "how do I distinguish which take and run was it?" … "add timestamp"): the same
// in Creation and Compare; everything else on hover.
import { describe, expect, it } from "vitest";

import { takeDetails, takeKind, takeTag } from "../src/take-facts";

const base = { status: "done", started_at: "2026-11-25T10:00:00Z", ended_at: "2026-11-25T10:06:00Z", request_id: "r", cost_usd: 0.54, seconds: 5, service: "wavespeed" };

describe("take tags", () => {
  it("draft, final, face sheet, full quality, singing: what made it, feeling, cost, time", () => {
    expect(takeTag({ ...base, n: 3, quality: "draft", model: "Draft (cheap preview)", feeling: "joy" }, "en-GB")).toMatch(/^Take 3 · Draft 480p · joy · \$0\.54 · 25 Nov, \d\d:06$/);
    expect(takeTag({ ...base, n: 4, quality: "best", model: "Video Upscaler Pro 1080p", finalOf: 3, cost_usd: 0.2 }, "en-GB")).toMatch(/^Take 4 · final of 3 · 1080p · \$0\.20 · /);
    expect(takeTag({ ...base, n: 5, kind: "references", quality: "best", refNames: ["mj.png", "Jennifer · face sheet"], cost_usd: 1.62 }, "en-GB")).toMatch(/^Take 5 · Jennifer's face · \$1\.62/);
    expect(takeTag({ ...base, n: 2, quality: "best", cost_usd: 1.62 }, "en-GB")).toMatch(/^Take 2 · Full quality 720p · \$1\.62/);
    expect(takeKind({ ...base, n: 6, kind: "lipsync", line: 9, through: 11, resolution: "480p" })).toBe("singing, lines 9-11 · 480p");
  });

  it("Paul's own name or the draft test's label comes first, without saying the same word twice", () => {
    expect(takeTag({ ...base, n: 1, label: "Draft", quality: "draft" }, "en-GB")).toMatch(/^Draft · 480p · \$0\.54/);
    expect(takeTag({ ...base, n: 3, label: "Draft upscaled Pro", quality: "best", model: "Video Upscaler Pro 1080p" }, "en-GB")).toMatch(/^Draft upscaled Pro · 1080p upscale · /);
    expect(takeTag({ ...base, n: 1, label: "Her smile", quality: "standard" }, "en-GB")).toMatch(/^Her smile · Flash 720p · /);
    expect(takeTag({ ...base, n: 1, status: "failed", request_id: undefined, quality: "draft" }, "en-GB")).toMatch(/· nothing spent · /);
  });

  it("the hover holds the rest", () => {
    const d = takeDetails({ ...base, n: 5, kind: "references", model: "Seedance 2.5 · with references", refNames: ["mj.png", "Jennifer · face sheet"], filmLook: "Golden hour", feel: "natural" }, "en-GB");
    expect(d.split("\n")).toEqual(["WaveSpeed · Seedance 2.5 · with references", expect.stringMatching(/^5 s · about \$0\.54 · 25 Nov/), "Film look: Golden hour", "Feel: natural", "Pictures sent: mj.png, Jennifer · face sheet"]);
  });
});
