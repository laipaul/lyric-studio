import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fillCaption } from "../src/node/captions";
import { checkRecipe, recipeJson } from "../src/node/recipe";
import { publishText } from "../src/node/youtube";
import { bestLink, checkLinks, detectService, linkPlaceholders, normaliseUrl, pickedLinks, relink, withLinks, type SongLink } from "../src/song-links";

const spotify: SongLink = { service: "spotify", url: "https://open.spotify.com/track/abc" };
const apple: SongLink = { service: "appleMusic", url: "https://music.apple.com/album/xyz" };
const ffm: SongLink = { service: "featurefm", url: "https://ffm.to/holdon" };
const insta: SongLink = { service: "instagram", url: "https://www.instagram.com/lifelyrics/" };
const site: SongLink = { service: "website", url: "https://lifelyrics.com/" };

describe("song links", () => {
  it("recognises the service of a pasted link (the most specific host wins)", () => {
    expect(detectService("https://open.spotify.com/track/abc?si=1")).toBe("spotify");
    expect(detectService("music.apple.com/fr/album/x")).toBe("appleMusic");
    expect(detectService("https://music.youtube.com/watch?v=1")).toBe("youtubeMusic");
    expect(detectService("https://www.youtube.com/watch?v=1")).toBe("youtube");
    expect(detectService("https://youtu.be/1")).toBe("youtube");
    expect(detectService("https://ffm.to/holdon")).toBe("featurefm");
    expect(detectService("https://lifelyrics.lnk.to/holdon")).toBe("linkfire");
    expect(detectService("https://distrokid.com/hyperfollow/lifelyrics/hold-on")).toBe("hyperfollow");
    expect(detectService("https://www.facebook.com/lifelyrics")).toBe("facebook");
    expect(detectService("https://soundcloud.com/lifelyrics/hold-on")).toBe("soundcloud");
    expect(detectService("https://x.com/lifelyrics")).toBe("x");
    expect(detectService("https://linktr.ee/lifelyrics")).toBe("linktree");
    expect(detectService("https://lifelyrics.com")).toBeNull();
    expect(normaliseUrl("not a link")).toBeNull();
    expect(normaliseUrl("lifelyrics.com")).toBe("https://lifelyrics.com/");
  });

  it("checks song.json links: wrong ones are named; a wrong one never blocks the song", () => {
    expect(checkLinks([spotify, { service: "nope", url: "https://a.com" }, { service: "spotify", url: "x y" }]).problems).toHaveLength(2);
    const { recipe, problems } = checkRecipe({ links: [spotify, { service: "nope", url: "https://a.com" }], postLinks: { reels: [spotify.url] } });
    expect(problems).toEqual([]);
    expect(recipe.links).toEqual([spotify]);
    expect(JSON.parse(recipeJson(recipe))).toMatchObject({ links: [spotify], postLinks: { reels: [spotify.url] } });
  });

  it("best link: a smart link, else the website, else Spotify; picks per platform", () => {
    expect(bestLink([spotify, site, ffm])).toEqual(ffm);
    expect(bestLink([spotify, site])).toEqual(site);
    expect(bestLink([apple, spotify])).toEqual(spotify);
    expect(pickedLinks([spotify, ffm, insta], undefined, "youtube")).toEqual([spotify, ffm, insta]);
    expect(pickedLinks([spotify, ffm, insta], undefined, "reels")).toEqual([ffm]);
    expect(pickedLinks([spotify, ffm, insta], { reels: [insta.url, "https://gone.com/"] }, "reels")).toEqual([insta]);
    expect(pickedLinks([spotify], { reels: [] }, "reels")).toEqual([]);
  });

  it("placeholders: listen lines (stores and smart links), follow lines (social pages), one per service", () => {
    const map = linkPlaceholders([spotify, apple, insta]);
    expect(map.spotify).toBe(spotify.url);
    expect(map.apple).toBe(apple.url);
    expect(map.listen).toBe(`Listen:\nSpotify: ${spotify.url}\nApple Music: ${apple.url}`);
    expect(map.follow).toBe(`Follow:\nInstagram: ${insta.url}`);
    expect(map.tidal).toBe("");
  });

  it("captions: a line whose link is empty disappears", () => {
    const tpl = "== Caption ==\n{{song}}\nListen: {{bestLink}}\nApple: {{apple}}\n\n== Hashtags ==\n#x\n";
    expect(fillCaption(tpl, { song: "Hold On", artist: "A", year: 2026, links: [ffm] }).Caption).toBe(`Hold On\nListen: ${ffm.url}`);
    expect(fillCaption(tpl, { song: "Hold On", artist: "A", year: 2026 }).Caption).toBe("Hold On");
  });

  it("YouTube: the old Spotify placeholder line becomes the links; the description follows the pick", () => {
    const old = "Intro.\n\nListen on Spotify: https://open.spotify.com/ (add the link to the song)\n\n#LifeLyrics #HoldOn";
    expect(withLinks(old, [spotify])).toBe(`Intro.\n\nListen:\nSpotify: ${spotify.url}\n\n#LifeLyrics #HoldOn`);
    expect(withLinks(old, [])).toBe("Intro.\n\n\n#LifeLyrics #HoldOn");
    expect(withLinks("Intro.\n\n#tag", [spotify, insta])).toBe(`Intro.\n\nListen:\nSpotify: ${spotify.url}\n\nFollow:\nInstagram: ${insta.url}\n\n#tag`);
    const made = withLinks("Intro.\n\n#tag", [spotify, apple]);
    expect(relink(made, [spotify, apple], [apple])).toBe(`Intro.\n\nListen:\nApple Music: ${apple.url}\n\n#tag`);
  });

  it("publish.txt: the default template's links, and an older template's Spotify line", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lyric-links-"));
    const lyricsTxt = "One\n";
    const fresh = publishText(dir, { song: "Hold On", artist: "Life Lyrics", lyricsTxt, year: 2026, links: [spotify, insta] });
    expect(fresh.text).toContain(`Listen:\nSpotify: ${spotify.url}\n\nFollow:\nInstagram: ${insta.url}\n\n#LifeLyrics`);
    const none = publishText(dir, { song: "Hold On", artist: "Life Lyrics", lyricsTxt, year: 2026 });
    expect(none.text).not.toMatch(/Listen|Follow|\{\{/);
    expect(none.text).not.toMatch(/\n\n\n/);
    const oldDir = path.join(dir, "old");
    mkdirSync(path.join(oldDir), { recursive: true });
    writeFileSync(path.join(oldDir, "publish-template.txt"), "== Description ==\nHi.\n\nListen on Spotify: https://open.spotify.com/ (add the link to the song)\n\n#x\n");
    expect(publishText(dir, { song: "S", artist: "A", lyricsTxt, year: 2026, links: [spotify] }, oldDir).text).toBe(`== Description ==\nHi.\n\nListen:\nSpotify: ${spotify.url}\n\n#x\n`);
    expect(readFileSync(path.join(oldDir, "publish-template.txt"), "utf8")).toContain("Listen on Spotify"); // the template itself is never changed
  });
});
