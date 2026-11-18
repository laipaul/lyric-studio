import { describe, expect, it, test } from "vitest";
import { backNegatives, frontNegatives, necklineOf, VIEWS, veilPhrase, viewPrompt, type OutfitSplit } from "../src/node/characters/plan";

const view = (id: string) => VIEWS.find((v) => v.id === id)!;
const OUTFIT = "ivory satin gown with a bateau neckline, buttons down the back, sheer ivory tulle veil";
const split: OutfitSplit = {
  from: OUTFIT,
  closeups: "bateau neckline, sheer ivory tulle veil",
  front: "ivory satin gown with a smooth bodice, long skirt",
  back: "row of buttons down the back, sheer ivory tulle veil",
};

describe("character view prompts", () => {
  it("detects the neckline and names it in the front view", () => {
    expect(necklineOf("a boat neck and pearls")).toBe("bateau");
    const p = viewPrompt(view("body_front"), OUTFIT, split);
    expect(p).toContain("bateau neckline");
    expect(p).toContain("not sweetheart");
    expect(p).not.toContain("not bateau");
  });
  it("adds nothing when no neckline is recognised", () => {
    const p = viewPrompt(view("body_front"), OUTFIT, { ...split, closeups: "pearl earrings" });
    expect(p).not.toContain("Neckline:");
  });
  it("adds a negative for back-only buttons, not for buttons on both sides", () => {
    expect(viewPrompt(view("body_front"), OUTFIT, split)).toContain("No buttons on the front.");
    expect(frontNegatives("buttons on the bodice", "buttons down the back")).toEqual([]);
    expect(frontNegatives("smooth bodice", "lacing and a long train")).toEqual(["No lacing or corset ties on the front.", "No train on the front."]);
  });
  it("adds negatives to the back for front-only details", () => {
    expect(backNegatives("a brooch at the waist", "plain back")).toEqual(["No brooch on the back."]);
    expect(viewPrompt(view("body_back"), OUTFIT, { ...split, front: "boutonnière on the lapel", back: "plain back" })).toContain("No boutonnière on the back.");
  });
  it("extracts the veil phrase and puts it in the 3/4, front and back views", () => {
    expect(veilPhrase(OUTFIT)).toBe("sheer ivory tulle veil");
    for (const id of ["three_quarter", "body_front", "body_back"]) expect(viewPrompt(view(id), OUTFIT, split)).toContain("Sheer ivory tulle veil falling");
    expect(viewPrompt(view("body_back"), OUTFIT, split)).toContain("falling down their back, clearly visible.");
    // without a split the raw outfit text is used
    expect(viewPrompt(view("body_front"), OUTFIT)).toContain("Sheer ivory tulle veil falling behind their shoulders, visible at both sides of the shoulders and arms.");
    expect(viewPrompt(view("closeup"), OUTFIT)).toContain("(the veil is allowed to show)");
  });
  it("falls back to 'the veil' and adds no veil sentence without a veil", () => {
    expect(veilPhrase("gown, veil")).toBe("the veil");
    expect(viewPrompt(view("body_front"), "navy suit, white shirt", { ...split, from: "navy suit, white shirt", back: "", closeups: "collar" })).not.toMatch(/veil/i);
    expect(viewPrompt(view("three_quarter"), "navy suit")).not.toMatch(/veil/i);
  });
  it("stays gender-neutral", () => {
    for (const v of VIEWS) for (const p of [viewPrompt(v, OUTFIT, split), viewPrompt(v, OUTFIT), viewPrompt(v)]) expect(p).not.toMatch(/\b(her|she|woman)\b/i);
  });
});

describe("no contradictions (Bride No 2, 18 Nov 2026)", () => {
  const o = "ivory satin gown with a bateau neckline, buttons down the back, sheer ivory tulle veil";
  const sp = { from: o, closeups: "ivory satin bateau neckline, sheer ivory tulle veil at the head", front: "ivory satin gown, bateau neckline, floor length", back: "row of buttons down the back, sheer ivory tulle veil falling down the back" };
  const p = (id: string) => viewPrompt(VIEWS.find((v) => v.id === id)!, o, sp);
  test("the front never lists the veil as a back-only detail", () => {
    expect(p("body_front")).toMatch(/only on the back \(row of buttons down the back\) must NOT/);
    expect(p("body_front")).toMatch(/veil falling behind their shoulders, visible/);
  });
  test("the back is never told the gown is invisible from behind", () => {
    expect(p("body_back")).not.toMatch(/ivory satin gown, bateau neckline, floor length\) are not visible/);
    expect(p("body_back")).toMatch(/veil falling down their back, clearly visible/);
  });
});
