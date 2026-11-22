// Sections (22 Nov 2026, Mini film step 2): the suggestion from lyrics.txt, a saved list made right, the names.
import { describe, expect, it } from "vitest";

import { cleanSections, nameSections, sectionOfLine, suggestSections } from "../src/sections";

const SONG = [
  "Morning light on the chapel door", // 1 verse
  "I keep your letter in my hand",
  "",
  "And I wait, and I wait", // 3 pre-chorus (comes back, leads into the chorus)
  "",
  "* You're beautiful", // 4 chorus
  "On our wedding day",
  "",
  "Years from now we'll laugh about it", // 6 verse
  "The rain, the ring, the band",
  "",
  "And I wait, and I wait", // 8 pre-chorus
  "",
  "* You're beautiful", // 9 chorus
  "On our wedding day",
  "",
  "If the music stops", // 11 bridge
  "I'll still be dancing",
  "",
  "* You're beautiful", // 13 chorus
  "On our wedding day",
  "",
  "Goodnight, my love", // 15 outro
].join("\n");

describe("sections", () => {
  it("suggests verses, pre-choruses, choruses, a bridge and an outro from stanzas, repeats and hooks", () => {
    expect(suggestSections(SONG)).toEqual([
      { line: 1, kind: "verse" },
      { line: 3, kind: "pre-chorus" },
      { line: 4, kind: "chorus" },
      { line: 6, kind: "verse" },
      { line: 8, kind: "pre-chorus" },
      { line: 9, kind: "chorus" },
      { line: 11, kind: "bridge" },
      { line: 13, kind: "chorus" },
      { line: 15, kind: "outro" },
    ]);
  });

  it("without hook marks a stanza that comes back is the chorus; without blank lines hook runs are", () => {
    const plain = SONG.replace(/\* /g, "");
    expect(suggestSections(plain).filter((s) => s.kind === "chorus").map((s) => s.line)).toEqual([3, 8, 13]);
    expect(suggestSections("One\nTwo\n* Hook\n* Hook two\nThree")).toEqual([
      { line: 1, kind: "verse" },
      { line: 3, kind: "chorus" },
      { line: 5, kind: "verse" },
    ]);
    expect(suggestSections("")).toEqual([]);
  });

  it("names them, finds a line's section, and cleans a saved list", () => {
    const named = nameSections(suggestSections(SONG), 15);
    expect(named.map((s) => s.name)).toEqual(["Verse 1", "Pre-chorus", "Chorus", "Verse 2", "Pre-chorus", "Chorus", "Bridge", "Chorus", "Outro"]);
    expect(named[0].lastLine).toBe(2);
    expect(named[8].lastLine).toBe(15);
    expect(sectionOfLine(named, 12)?.name).toBe("Bridge");
    expect(cleanSections([{ line: 5, kind: "chorus" }, { line: 2, kind: "verse" }, { line: 9, kind: "solo" }, { line: 40, kind: "outro" }, "x"], 20)).toEqual([
      { line: 1, kind: "verse" },
      { line: 5, kind: "chorus" },
    ]);
  });
});
