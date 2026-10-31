import { describe, expect, it } from "vitest";
import { parseColourRef } from "../src/colour-ref";

describe("parseColourRef: a typed colour reference", () => {
  it("reads hex with or without #, 6 or 3 digits", () => {
    expect(parseColourRef("#ff2d95")).toBe("#FF2D95");
    expect(parseColourRef(" FF2D95 ")).toBe("#FF2D95");
    expect(parseColourRef("#f29")).toBe("#FF2299");
    expect(parseColourRef("fff")).toBe("#FFFFFF");
  });
  it("reads RGB numbers", () => {
    expect(parseColourRef("rgb(255, 45, 149)")).toBe("#FF2D95");
    expect(parseColourRef("255,45,149")).toBe("#FF2D95");
    expect(parseColourRef("255 45 149")).toBe("#FF2D95");
    expect(parseColourRef("rgba(0, 0, 0, 0.5)")).toBe("#000000");
  });
  it("is null for anything that is not a colour yet", () => {
    for (const s of ["", "#", "#FF2D9", "pink", "256,0,0", "#GGGGGG", "12,34"]) expect(parseColourRef(s), s).toBeNull();
  });
});
