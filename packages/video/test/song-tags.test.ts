// The song's tags (Prepare → Song Details → Tags, 11 Nov 2026): a ranked list of clean hashtags, the brand's tags on
// every song, local suggestions (never generic), and the top ones per platform in the Post panel and publish.txt.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanTags, lyricsLanguage, normaliseTag, rankedTags, suggestTags, tagsFor, withSongTagsText, youtubeTagsField } from "../src/song-tags";
import { brandTagSettings } from "../src/node/brand";
import { postingPack } from "../src/node/captions";
import { readRecipe, writeRecipe } from "../src/node/recipe";
import { publishText } from "../src/node/youtube";

const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-song-tags-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const TEN = ["herewithme", "lifelyrics", "quietheartbreaks", "emotionalpop", "cinematicpop", "lovesong", "lyricvideo", "sadsongs", "piano", "ballad"];

describe("the song's tags", () => {
  it("are clean: lowercase, no spaces, accents or signs, no duplicates", () => {
    expect(normaliseTag("Here With Me")).toBe("herewithme");
    expect(normaliseTag("Pômé")).toBe("pome");
    expect(cleanTags(["#Emotional Pop", "emotionalpop", " Chanson française ", "a, #b #c", "", 7])).toEqual(["emotionalpop", "chansonfrancaise", "a", "b", "c"]);
  });

  it("keep their rank; the brand's tags are added (where the song placed them, else at the end)", () => {
    expect(rankedTags(["herewithme", "lifelyrics", "piano"], ["lifelyrics", "lifelyricsstudio"])).toEqual([
      { tag: "herewithme", brand: false },
      { tag: "lifelyrics", brand: true },
      { tag: "piano", brand: false },
      { tag: "lifelyricsstudio", brand: true },
    ]);
    expect(rankedTags(undefined, ["lifelyrics"])).toEqual([{ tag: "lifelyrics", brand: true }]);
  });

  it("each platform uses its top ones: Instagram 5, TikTok and Shorts 8, YouTube 3 above the title and up to 500 characters of tags", () => {
    expect(tagsFor(TEN, "reels")).toEqual(TEN.slice(0, 5));
    expect(tagsFor(TEN, "tiktok")).toHaveLength(8);
    expect(tagsFor(TEN, "youtube")).toEqual(TEN.slice(0, 3));
    const many = Array.from({ length: 60 }, (_, i) => `longtagnumber${i}`);
    const field = youtubeTagsField(many);
    expect(field.length).toBeLessThanOrEqual(500);
    expect(field.split(", ").every((t) => many.includes(t))).toBe(true); // whole tags only
  });

  it("suggests the artist, title, EP, the lyrics' language and the brand's starter set, never generic tags", () => {
    const fr = "Je t'attends sous la pluie ce soir\nTu es là dans mes rêves et je ne dors pas\nLe vent de la nuit me parle de toi";
    expect(lyricsLanguage(fr)).toBe("fr");
    expect(lyricsLanguage("Hold me close until the light, you and me in the night, my love")).toBe("en");
    const s = suggestTags({ artist: "Life Lyrics", song: "Here With Me", ep: "Quiet Heartbreaks", lyrics: fr, starters: ["emotionalpop", "cinematicpop", "fyp", "viral", "reels"] });
    expect(s.map((x) => `${x.tag}:${x.from}`)).toEqual([
      "lifelyrics:artist", "herewithme:title", "quietheartbreaks:EP", "chansonfrancaise:language", "musiquefrancaise:language", "emotionalpop:starter", "cinematicpop:starter",
    ]);
  });

  it("brand tags come from brand.json, else the artist's name; the starter set too", () => {
    const ws = path.join(dir, "ws");
    mkdirSync(path.join(ws, "brand", "Pômé"), { recursive: true });
    expect(brandTagSettings(ws, "Life Lyrics")).toMatchObject({ tags: ["lifelyrics"], set: false });
    writeFileSync(path.join(ws, "brand", "brand.json"), JSON.stringify({ tags: ["lifelyrics", "Life Lyrics Studio"], tagStarters: ["Emotional Pop"] }));
    expect(brandTagSettings(ws, "Life Lyrics")).toMatchObject({ tags: ["lifelyrics", "lifelyricsstudio"], starters: ["emotionalpop"], set: true });
    writeFileSync(path.join(ws, "brand", "Pômé", "brand.json"), JSON.stringify({ tags: ["pome", "chanson"] }));
    expect(brandTagSettings(ws, "Pômé").tags).toEqual(["pome", "chanson"]); // her own
  });

  it("the Post panel: captions get the platform's top tags, YouTube its Tags box and 3 hashtags in the description", () => {
    const reels = postingPack({ dir }, { platform: "reels", artist: "Life Lyrics", song: "Here With Me", tags: TEN });
    expect(reels.sections.Hashtags).toBe("#herewithme #lifelyrics #quietheartbreaks #emotionalpop #cinematicpop");
    expect(reels.sections.Hashtags).not.toMatch(/#reels|#fyp/);
    const publish = path.join(dir, "publish.txt");
    writeFileSync(publish, "== Title ==\nHere With Me (Lyrics)\n\n== Description ==\nThe official lyric video.\n\n#lifelyrics #herewithme #lyrics #lyricvideo\n\n== Tags ==\nold, tags\n");
    const yt = postingPack({ dir }, { platform: "youtube", artist: "Life Lyrics", song: "Here With Me", publishFile: publish, tags: TEN });
    expect(yt.sections.Tags).toBe(TEN.join(", "));
    expect(yt.sections.Description).toMatch(/The official lyric video\.\n\n#herewithme #lifelyrics #quietheartbreaks$/);
  });

  it("publish.txt (made with each YouTube video) gets them too; without tags nothing changes", () => {
    const brand = path.join(dir, "brand2");
    mkdirSync(brand, { recursive: true });
    const values = { song: "Here With Me", artist: "Life Lyrics", year: 2026, lyricsTxt: "Line one\n" };
    const plain = publishText(dir, values, brand).text;
    expect(plain).toMatch(/== Tags ==\nHere With Me, Here With Me lyrics, Life Lyrics/);
    const tagged = publishText(dir, { ...values, tags: TEN }, brand).text;
    expect(tagged).toMatch(/== Tags ==\nherewithme, lifelyrics, quietheartbreaks/);
    expect(tagged).toMatch(/#herewithme #lifelyrics #quietheartbreaks\n/);
    expect(tagged.split("== Description ==")[0]).toBe(plain.split("== Description ==")[0]); // the title is untouched
    expect(withSongTagsText("== Title ==\nx\n", ["a"])).toBe("== Title ==\nx\n\n== Tags ==\na\n");
  });

  it("are kept in song.json, cleaned; none: the field is left out", () => {
    const file = path.join(dir, "song.json");
    writeRecipe(file, { tags: cleanTags(["Love Song", "lovesong", " ballad "]) });
    expect(readRecipe(file).tags).toEqual(["lovesong", "ballad"]);
    writeRecipe(file, {});
    expect(readRecipe(file).tags).toBeUndefined();
  });
});
