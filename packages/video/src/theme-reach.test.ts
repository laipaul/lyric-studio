import { describe, expect, it } from "vitest";

import { themeReach } from "./theme-reach";

describe("themeReach", () => {
  it("names an unused theme", () => {
    expect(themeReach([])).toMatchObject({ badge: "Not used yet", tone: "unused" });
  });
  it("says 'This song only' for the song's own theme", () => {
    const r = themeReach(["Hold On"], "Hold On");
    expect(r.badge).toBe("This song only");
    expect(r.reach).toBe("Changes here reach: this song only.");
  });
  it("names the one song when it is another song", () => {
    expect(themeReach(["Hold On"], "Other").badge).toBe("Only Hold On");
    expect(themeReach(["Hold On"]).reach).toBe("Changes here reach: Hold On.");
  });
  it("counts shared songs and lists at most three", () => {
    const r = themeReach(["A", "B", "C", "D", "E"], "A");
    expect(r).toMatchObject({ badge: "Shared by 5 songs", tone: "shared" });
    expect(r.reach).toBe("Changes here reach: 5 songs (A, B, C and 2 more).");
  });
});
