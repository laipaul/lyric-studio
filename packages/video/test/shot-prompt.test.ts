// The Midjourney first-frame prompt of a shot (C3 Part 2a): framing and action, each person's description and outfit
// without their name, the scene, a memory's feel, the Film look, the shape; "never" phrases go to --no.
import { describe, expect, it } from "vitest";

import { forMidjourney, mjSafe, outfitFor, shotPrompt } from "../src/shot-prompt";

const bride = {
  name: "Jennifer",
  description: "A young adult East Asian woman with a slender build. Oval face with almond-shaped dark brown eyes. Preserve her face shape across close-ups. Never pale porcelain or tanned skin, never heavy makeup.",
  outfit: "An ivory wedding gown with sheer illusion long sleeves. Never crystal or statement earrings.",
};

describe("forMidjourney", () => {
  it("keeps the plain sentences and turns 'never' phrases into --no items", () => {
    expect(forMidjourney(bride.description)).toEqual({ text: "A young adult East Asian woman with a slender build. Oval face with almond-shaped dark brown eyes", no: ["pale porcelain or tanned skin", "heavy makeup"] });
    expect(forMidjourney("Match the groom in the reference image. He has thick black hair.").text).toBe("He has thick black hair");
  });
});

describe("mjSafe (Midjourney's moderator, 23 Nov 2026)", () => {
  it("the navy cocktail look Midjourney refused, in safe words; makeup, lips and skin sentences out", () => {
    const navy = "A midnight-navy satin cocktail dress with a softly draped cowl neckline, thin straps and a bias-cut skirt falling just below the knee. Simple nude pointed heels and a small navy satin clutch. Small gold stud earrings. Polished evening makeup with soft smoky eyes and a rose lip.";
    const out = mjSafe(navy);
    expect(out).toBe("A midnight-navy satin cocktail dress with a softly draped neckline, delicate straps and a bias-cut skirt falling just below the knee. Simple soft beige pointed heels and a small navy satin clutch. Small gold stud earrings.");
    expect(mjSafe("An oatmeal cardigan worn open and slipping off one shoulder. Barefoot. The back is open to the waist with small buttons.")).toBe("An oatmeal cardigan worn open and off-shoulder. The back is open with small buttons.");
  });
});

describe("outfitFor (only what the framing shows, 23 Nov 2026)", () => {
  const gown = "A modern ivory wedding gown with delicate illusion long sleeves scattered with delicate floral lace appliqués, a soft sweetheart neckline, and a fitted lace bodice. The back is open with a row of small covered buttons. A flowing tulle A-line skirt with a long soft train. A long delicate cathedral veil falls from a sleek low bun. Small pearl drop earrings, no necklace. She holds a loose bouquet of white roses and ranunculus.";
  it("a detail shot of hands: the sleeves and the bouquet, never the back, skirt or veil", () => {
    expect(outfitFor("detail", gown)).toBe("A modern ivory wedding gown with delicate illusion long sleeves scattered with delicate floral lace appliqués, She holds a loose bouquet of white roses and ranunculus");
  });
  it("a close-up: everything but what is below the waist; medium: all of it", () => {
    const close = outfitFor("close-up", gown);
    expect(close).toContain("sweetheart neckline");
    expect(close).toContain("cathedral veil");
    expect(close).not.toMatch(/skirt|train/);
    expect(outfitFor("medium", gown)).toBe(gown);
  });
});

describe("shotPrompt", () => {
  it("a ceremony close-up: framing, action without the name, the look's outfit, Film look, shape, --no; no face or body words", () => {
    const p = shotPrompt({ shows: "Jennifer smiles under her veil", shot: "close-up", people: [bride], scene: null, filmLook: "shot on 35mm film, Kodak Portra 400 tones", aspect: "9:16" });
    expect(p).toBe("cinematic close-up portrait: the woman smiles under her veil, wearing an ivory wedding gown with delicate illusion long sleeves, shot on 35mm film, Kodak Portra 400 tones --ar 9:16 --style raw --no crystal or statement earrings");
    expect(p).not.toMatch(/Jennifer|young|East Asian|slender|lips|skin|Preserve|never/i);
  });
  it("a memory: the shot's own outfit instead of the look's, and the memory feel; a scene card", () => {
    const p = shotPrompt({ shows: "Memory: a sunny café, she laughs", shot: "motion", tag: "memory", outfit: "a camel wool coat over a cream turtleneck", people: [bride], scene: { name: "Café", description: "A small neighbourhood café with big windows." }, filmLook: null, aspect: "16:9" });
    expect(p).toContain("candid cinematic moment in motion: a sunny café, she laughs");
    expect(p).toContain("wearing a camel wool coat over a cream turtleneck");
    expect(p).not.toContain("wedding gown");
    expect(p).toContain("the place: a small neighbourhood café with big windows");
    expect(p).toContain("a nostalgic memory, slightly faded colours, soft haze --ar 16:9 --style raw");
  });
  it("two people are labelled by their own card's words (a groom's card may mention the bride)", () => {
    const groom = { name: "Bridegroom", description: "Match the groom in the reference image. He has thick black hair. When he sees the bride, his eyes soften.", outfit: "A charcoal wool suit." };
    const p = shotPrompt({ shows: "Jennifer and Bridegroom kiss at the altar", shot: "medium", people: [bride, groom], scene: null, filmLook: null, aspect: "9:16" });
    expect(p).toContain("cinematic medium shot: the woman and the man kiss at the altar, the woman wearing an ivory wedding gown with delicate illusion long sleeves, the man wearing a charcoal wool suit");
    expect(p).not.toMatch(/sees the bride|reference image|thick black hair/);
  });
  it("a Film look with its own Midjourney settings: each setting once, the song's shape wins, its others kept", () => {
    const p = shotPrompt({ shows: "A sunlit chapel", shot: "wide", people: [bride], scene: null, filmLook: "35mm film, Kodak Portra 400, fine film grain --ar 16:9 --style raw --stylize 100 --no text, watermark", aspect: "9:16" });
    expect(p.endsWith("35mm film, Kodak Portra 400, fine film grain --ar 9:16 --style raw --stylize 100 --no crystal or statement earrings, text, watermark")).toBe(true);
    expect(p.match(/--ar/g)).toHaveLength(1);
    expect(p.match(/--style/g)).toHaveLength(1);
  });
  it("a shot without people", () => {
    expect(shotPrompt({ shows: "Petals drift through a beam of light", shot: "detail", people: [], scene: null, filmLook: null, aspect: "9:16" })).toBe("cinematic extreme close-up detail shot: Petals drift through a beam of light --ar 9:16 --style raw");
  });
});
