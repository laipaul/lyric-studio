// Library cards (Step H): one colour system per platform chip, one summary and one action per song,
// the filters and the sorting.
import { describe, expect, it } from "vitest";

import { chipCount, chipState, songSummary, sortSongs, type ChipInput } from "../src/library-status";

const chip = (status: ChipInput["status"], videos = 0, approved = 0): ChipInput => ({ status, videos, approved });

describe("chip state", () => {
  it("grey not made, amber to review, green approved, red failed / stopped", () => {
    expect(chipState(chip("none"))).toBe("none");
    expect(chipState(chip("PASS", 3))).toBe("review");
    expect(chipState(chip("WARN", 1))).toBe("review"); // a QA warning is still "to review", not an error
    expect(chipState(chip("PASS", 3, 1))).toBe("ready");
    expect(chipState(chip("FAILED", 0))).toBe("error");
    expect(chipState(chip("interrupted", 1))).toBe("stopped");
    expect(chipState(chip("Rendering", 1, 1))).toBe("rendering");
  });

  it("never a green 0: every video discarded is grey, an approved video elsewhere stays green", () => {
    expect(chipState(chip("PASS", 0))).toBe("none");
    expect(chipCount(chip("PASS", 0))).toBe("—");
    expect(chipState(chip("PASS", 0, 2))).toBe("ready"); // approved in an older run
    expect(chipCount(chip("PASS", 0, 2))).toBe("2");
    expect(chipState(chip("FAILED", 0, 1))).toBe("ready"); // something approved to post wins over a failed newer run
  });

  it("the number: approved when ready, made when to review, ! for an error", () => {
    expect(chipCount(chip("PASS", 3, 1))).toBe("1");
    expect(chipCount(chip("PASS", 3))).toBe("3");
    expect(chipCount(chip("FAILED"))).toBe("!");
    expect(chipCount(chip("Rendering", 1))).toBe("…");
  });
});

describe("song summary", () => {
  it("counts per state and picks one action", () => {
    const s = songSummary(["ready", "ready", "review", "error", "none"]);
    expect(s.text).toBe("2/5 ready · 1 to review · 1 error");
    expect(s.action).toBe("fix");
    expect(s.filters).toEqual(["review", "errors"]);
  });

  it("no videos -> Generate; stopped -> Resume; to review -> Review; all ready -> no button, Ready", () => {
    expect(songSummary(["none", "none", "none"])).toMatchObject({ text: "No videos yet", action: "generate", filters: ["none"] });
    expect(songSummary(["review", "stopped", "none"]).action).toBe("resume");
    expect(songSummary(["review", "none"])).toMatchObject({ action: "review", filters: ["review"] });
    expect(songSummary(["ready", "ready", "none"])).toMatchObject({ text: "2/3 ready", action: null, filters: ["ready"] });
    expect(songSummary(["ready", "rendering"])).toMatchObject({ text: "1/2 ready · 1 rendering", action: null, filters: [] });
  });
});

describe("sorting", () => {
  const songs = [
    { title: "these empty roads", createdAt: "2026-10-01T00:00:00Z", lastRun: "2026-10-29T10:00:00Z" },
    { title: "A Heart For Two", createdAt: "2026-10-20T00:00:00Z", lastRun: null },
    { title: "Love Is A Good Thing", createdAt: "2026-09-01T00:00:00Z", lastRun: "2026-10-28T10:00:00Z" },
  ];
  it("last made (else added), title (ignoring case), date added", () => {
    expect(sortSongs(songs, "last").map((s) => s.title)).toEqual(["these empty roads", "Love Is A Good Thing", "A Heart For Two"]);
    expect(sortSongs(songs, "title").map((s) => s.title)).toEqual(["A Heart For Two", "Love Is A Good Thing", "these empty roads"]);
    expect(sortSongs(songs, "added").map((s) => s.title)).toEqual(["A Heart For Two", "these empty roads", "Love Is A Good Thing"]);
  });
});
