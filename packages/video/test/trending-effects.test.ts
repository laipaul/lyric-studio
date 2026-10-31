import { describe, expect, it } from "vitest";

import { emphasisWord, kineticAt, kineticGroups, lyricEffect, EFFECT_TITLES, EFFECT_CATEGORIES, EFFECT_NAMES } from "../src";
import { checkRecipe } from "../src/node/recipe";
import { THEME_FIELDS } from "../src/node/themes";

describe("Emphasis word", () => {
  it("picks the word held longest, never a small word", () => {
    const words = ["You", "had", "a", "heart", "for", "two"];
    const t = [2, 2, 2, 20, 2, 6].reduce<{ startFrame: number; endFrame: number }[]>((acc, len) => [...acc, { startFrame: acc.at(-1)?.endFrame ?? 0, endFrame: (acc.at(-1)?.endFrame ?? 0) + len }], []);
    expect(emphasisWord(words, t)).toBe(3); // "heart"
    expect(emphasisWord(["and", "the", "you"])).toBe(-1);
    expect(emphasisWord(["When", "I", "had", "nothing", "left"])).toBe(3); // without timings: the longest word
  });
  it("is a theme add-on, checked like Shine", () => {
    expect(THEME_FIELDS).toContain("emphasis");
    expect(checkRecipe({ emphasis: "on" }).problems).toEqual([]);
    expect(checkRecipe({ emphasis: "yes" }).problems[0]).toContain("emphasis must be off or on");
  });
});

describe("Kinetic stack", () => {
  it("groups short words in pairs and keeps long words alone", () => {
    expect(kineticGroups(["You", "had", "a", "heart", "everlasting", "love"])).toEqual([[0, 1], [2, 3], [4], [5]]);
  });
  it("shows the group whose first word is being sung, popping in", () => {
    const groups = [[0, 1], [2]];
    const starts = [10, 20, 40];
    expect(kineticAt(groups, starts, 5).group).toBe(0);
    expect(kineticAt(groups, starts, 39).group).toBe(1); // 2 frames early
    expect(kineticAt(groups, starts, 46).pop).toBe(1);
  });
});

describe("every effect has a plain name and a gallery kind", () => {
  it.each([...EFFECT_NAMES])("%s", (name) => {
    expect(EFFECT_TITLES[name]).toMatch(/^[A-Z0-9]/);
    expect(EFFECT_CATEGORIES[name].length).toBeGreaterThan(0);
    expect(lyricEffect(name)?.name).toBe(name);
  });
});
