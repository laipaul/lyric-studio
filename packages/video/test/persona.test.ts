// Persona on character cards (26 Nov 2026): saved with a history and editable on a locked card; never in a picture
// pack's prompts; Claude's answer read back (also a slightly misformatted one); the shot prompt takes the right section
// line (chorus vs verse vs final chorus) and the song's own note; render props unchanged.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_SECTION_MAP, emptyPersona, parsePersona, personaBlock, personaShotPrompt, sectionKeyOf, type Persona } from "../src/persona";
import { findOrCreateSongProject, makeVideos, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "../src/node";
import { characterBlock, createCard, getCard, cardRoot, lockCard, makePictures, readCardFile, updateDraft, VIEWS } from "../src/node/characters";
import { stubFace, stubFal } from "../src/node/characters/stub";
import { clipShotPrompt, personaRequestFor, readPersona, restorePersona, setPersona, setPersonaNote } from "../src/node/persona";
import { editOf, setClipCast } from "../src/node/clip-edits";
import { setCast } from "../src/node/production";
import { setSongSections } from "../src/node/song-sections";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const AIKO: Persona = {
  ...emptyPersona(),
  archetype: "The Quiet Romantic: feels everything, shows it in small ways",
  traits: ["shy", "warm", "quietly intense"],
  sing: { soft: "half-smile, eyes lowered", high: "chin lifts, brows rise", held: "eyes close, hand to chest" },
  gestures: ["tucks hair behind her ear", "touches her necklace"],
  movement: "glide and float; press on the peaks",
  actions: ["to reassure", "to confess", "to hold on"],
  gaze: "away on verses, into the lens on the chorus",
  range: { rest: "calm, soft eyes", peak: "eyes glistening, breath catching" },
  camera: "3/4 from her left, soft window light",
  never: "no wide grin, no winking",
  sections: { ...DEFAULT_SECTION_MAP, chorus: "finds the lens, hand drifts to her chest", verse: "eyes lowered, small breaths" },
};

describe("Paste persona (Claude's answer back into the fields)", () => {
  it("reads the template as Claude writes it, with text around it", () => {
    const answer = `Here is Aiko's persona:\n\n${personaBlock("Aiko", AIKO)}\n\nHope this helps!`;
    const r = parsePersona(answer);
    expect(r.name).toBe("Aiko");
    expect(r.persona).toEqual(AIKO);
    expect(r.found).toHaveLength(11);
    expect(r.unrecognised).toEqual([]);
  });
  it("tolerates bold labels, -> arrows, a bullet list, sections on their own lines, Pre chorus without a dash; lists what it cannot place", () => {
    const messy = [
      "**PERSONA: Aiko**",
      "**Archetype:** The Quiet Romantic",
      "**Personality** - shy; warm; quietly intense",
      "How she sings: soft lines -> half-smile / high notes -> chin lifts / held notes -> eyes close",
      "Signature gestures:",
      "- tucks hair behind her ear",
      "- touches her necklace",
      "Movement quality: glide, float",
      "**Favourite actions:** to reassure; to confess",
      "Gaze: away, then into the lens",
      "Emotional range: rest = calm -> peak = eyes glistening",
      "Camera loves: 3/4 from her left",
      "Never: no wide grin",
      "Section map:",
      "Verse: eyes lowered",
      "Pre chorus: breath visible",
      "Chorus: finds the lens",
      "Bridge: most vulnerable",
      "Final Chorus: release",
      "Favourite colour: blue",
    ].join("\n");
    const r = parsePersona(messy);
    expect(r.persona.archetype).toBe("The Quiet Romantic");
    expect(r.persona.traits).toEqual(["shy", "warm", "quietly intense"]);
    expect(r.persona.sing).toEqual({ soft: "half-smile", high: "chin lifts", held: "eyes close" });
    expect(r.persona.gestures).toEqual(["tucks hair behind her ear", "touches her necklace"]);
    expect(r.persona.range).toEqual({ rest: "calm", peak: "eyes glistening" });
    expect(r.persona.movement).toBe("glide, float");
    expect(r.persona.actions).toEqual(["to reassure", "to confess"]);
    expect(r.persona.sections).toEqual({ verse: "eyes lowered", preChorus: "breath visible", chorus: "finds the lens", bridge: "most vulnerable", finalChorus: "release" });
    expect(r.unrecognised).toEqual(["Favourite colour: blue"]);
  });
});

describe("the shot prompt's section line", () => {
  const person = { name: "Aiko", identity: "A woman in her late twenties.", look: "Wedding", outfit: "ivory satin gown", persona: AIKO, songNote: "more playful in this song" };
  it("chorus vs verse vs final chorus; intro and outro rest like a verse", () => {
    expect(sectionKeyOf("chorus")).toBe("chorus");
    expect(sectionKeyOf("chorus", true)).toBe("finalChorus");
    expect(sectionKeyOf("intro")).toBe("verse");
    const chorus = personaShotPrompt({ people: [person], section: { kind: "chorus", name: "Chorus 1", final: false }, lyric: "Hold on to me", singing: true, song: "Song" });
    expect(chorus).toContain("In this part (Chorus, Chorus 1): finds the lens, hand drifts to her chest");
    expect(chorus).toContain("In this song: more playful in this song");
    expect(chorus).toMatch(/Lip-sync framing: front or 3\/4 medium close-up, the mouth always visible and unobstructed/);
    expect(chorus).toMatch(/How they sing: soft lines → half-smile/);
    expect(chorus).toContain("Movement quality (Laban): glide and float; press on the peaks");
    expect(chorus).toContain("Favourite actions: to reassure, to confess, to hold on");
    const verse = personaShotPrompt({ people: [person], section: { kind: "verse", name: "Verse 1", final: false }, lyric: "Verse one here", singing: false, song: "Song" });
    expect(verse).toContain("In this part (Verse, Verse 1): eyes lowered, small breaths");
    expect(verse).not.toMatch(/Lip-sync framing|How they sing/);
    const unknown = personaShotPrompt({ people: [person], section: null, lyric: null, singing: false, song: "Song" });
    expect(unknown).toMatch(/not known yet: put the clip on a lyric line/);
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-persona-"));
const wsDir = path.join(root, "workspace");
const pics = path.join(root, "pics");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  mkdirSync(pics, { recursive: true });
  ffmpeg("-f", "lavfi", "-i", "color=c=white:s=600x800", "-frames:v", "1", path.join(pics, "default.png"));
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 60_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a persona on a card and in a song", () => {
  let id: string;
  let sid: string;
  it("never goes into a picture pack's prompts", async () => {
    id = createCard(ws, { kind: "character", name: "Aiko", picture: readFileSync(path.join(pics, "default.png")), fileName: "aiko.png" }).id;
    setPersona(ws, id, AIKO);
    const fal = stubFal(pics);
    const sent: Record<string, unknown>[] = [];
    const submit = fal.queue.submit.bind(fal.queue);
    (fal.queue as { submit: unknown }).submit = (e: string, o: { input: Record<string, unknown> }) => (sent.push(o.input), submit(e as never, o as never));
    await makePictures(ws, id, { fal, face: stubFace(), sleep: async () => {} }, { cap: 3 });
    expect(sent.length).toBeGreaterThan(3);
    const all = JSON.stringify(sent);
    for (const words of ["Quiet Romantic", "eyes lowered", "hand to chest", "no winking", "tucks hair", "small breaths"]) expect(all).not.toContain(words);
    // Nor in the identity (the description drafted with the pack).
    expect(readCardFile(cardRoot(ws, getCard(ws, id))).versions[0].description ?? "").not.toMatch(/Quiet Romantic|eyes lowered/);
  }, 60_000);

  it("is editable on a locked card; each save keeps the text it replaces; Restore", () => {
    const r = cardRoot(ws, getCard(ws, id));
    for (const v of VIEWS) copyFileSync(path.join(pics, "default.png"), path.join(r, "v1", `${v.id}.png`));
    updateDraft(ws, id, { description: "A woman in her late twenties." });
    lockCard(ws, id);
    setPersona(ws, id, { ...AIKO, gaze: "always into the lens" });
    const p = readPersona(ws, id);
    expect(p.persona?.gaze).toBe("always into the lens");
    expect(p.editedAt).toBeTruthy();
    expect(p.history).toHaveLength(1);
    expect(p.history[0].persona.gaze).toBe(AIKO.gaze);
    restorePersona(ws, id, p.history[0].at);
    expect(readPersona(ws, id).persona?.gaze).toBe(AIKO.gaze);
    expect(readPersona(ws, id).history).toHaveLength(2);
    // Copy character for Claude: identity, wardrobe, then the persona.
    const block = characterBlock(ws, id).block;
    expect(block.indexOf("PERSONA: Aiko")).toBeGreaterThan(block.indexOf("Wardrobe"));
    expect(block).toContain("Archetype: The Quiet Romantic");
    // The persona request for claude.ai: identity, the template, the physical rule.
    const req = personaRequestFor(ws, id);
    expect(req).toContain("A woman in her late twenties.");
    expect(req).toContain("PERSONA: [Name]");
    expect(req).toMatch(/brows, eyes, breath, mouth, hands/);
  });

  it("the shot prompt of a Storyboard clip: its section's line (chorus, verse, final chorus) and the song's note; render props unchanged", async () => {
    const song = path.join(root, "Love Song.wav");
    makeSong(song, 12);
    sid = (await findOrCreateSongProject(ws, song)).project.id;
    const p = songPathsById(ws, sid);
    writeFileSync(p.lyricsTxt, `${LYRICS.join("\n")}\n`);
    mkdirSync(p.clips!, { recursive: true });
    for (const [i, c] of ["blue", "red", "green"].entries()) makeClip(path.join(p.clips!, `0${i + 1}_${c}.mp4`), 3, c);
    writeRecipe(p.recipe!, { ...readRecipe(p.recipe!), platforms: ["reels"], section: "0:00-0:10", variations: { reels: 1 } });
    setCast(ws, sid, [id]);
    setSongSections(ws, sid, [{ line: 1, kind: "verse" }, { line: 2, kind: "chorus" }, { line: 4, kind: "verse" }, { line: 5, kind: "chorus" }]);
    const sample = path.join(root, "s.mp4");
    const still = path.join(root, "s.jpg");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=216x384:r=30:d=1", "-pix_fmt", "yuv420p", sample);
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=216x384:d=1", "-frames:v", "1", still);
    const props: string[] = [];
    const make = () =>
      makeVideos({
        workspaceDir: wsDir, song: p.audio!, lyrics: p.lyricsTxt, platforms: "reels", align: fakeAlign, frameCheck: false, platform: "win32",
        renderer: async (o: RenderOptions) => (props.push(JSON.stringify(o.props)), copyFileSync(sample, o.outFile), o.outFile),
        thumbnailRenderer: async (o) => (copyFileSync(still, o.outFile), o.outFile),
      });
    // Pinned clips: red on the first chorus, blue on the second verse, green on the last chorus.
    writeRecipe(p.recipe!, { ...readRecipe(p.recipe!), anchors: [{ line: 2, clip: "02_red.mp4" }, { line: 4, clip: "01_blue.mp4" }, { line: 5, clip: "03_green.mp4" }] });
    await make();
    setPersonaNote(ws, sid, id, "more playful in this song");
    const red = await clipShotPrompt(ws, sid, "02_red.mp4");
    expect(red.place).toEqual({ line: 2, how: "anchor" });
    expect(red.text).toContain("In this part (Chorus");
    expect(red.text).toContain("finds the lens, hand drifts to her chest");
    expect(red.text).toContain('Lyric line: "Hold on to me"');
    expect(red.text).toContain("In this song: more playful in this song");
    expect(red.text).toContain("A woman in her late twenties.");
    const blue = await clipShotPrompt(ws, sid, "01_blue.mp4");
    expect(blue.text).toContain("In this part (Verse");
    expect(blue.text).toContain("eyes lowered, small breaths");
    const green = await clipShotPrompt(ws, sid, "03_green.mp4");
    expect(green.text).toContain("In this part (Final chorus");
    expect(green.text).toContain("peak and release");
    // The persona and the song note change no cut, timing or render.
    await make();
    expect(props).toHaveLength(2);
    expect(props[1]).toBe(props[0]);
  }, 180_000);

  it("finds a clip's cast tag whatever the case of its key in clips.json, with two characters in the song", async () => {
    const other = createCard(ws, { kind: "character", name: "Ben", picture: readFileSync(path.join(pics, "default.png")), fileName: "ben.png" }).id;
    setCast(ws, sid, [id, other]);
    const p = songPathsById(ws, sid);
    // Untagged: the song has two characters, so the shot prompt must ask for a tag.
    await expect(clipShotPrompt(ws, sid, "02_red.mp4")).rejects.toThrow(/Tag who is in this clip/);
    setClipCast(p.root, "02_RED.mp4", [id]);
    expect(Object.keys(JSON.parse(readFileSync(path.join(p.root, "clips.json"), "utf8")).clips)).toEqual(["02_RED.mp4"]);
    const red = await clipShotPrompt(ws, sid, "02_red.mp4");
    expect(red.text).toContain("A woman in her late twenties.");
  }, 60_000);
});

describe("clip edit lookup", () => {
  it("matches a clip name across case and Unicode forms", () => {
    const edits = { order: [], clips: { ["Café.mp4".normalize("NFD")]: { cast: ["x"] } } } as never;
    expect(editOf(edits, "Café.mp4".normalize("NFC")).cast).toEqual(["x"]);
    expect(editOf(edits, "CAFÉ.MP4").cast).toEqual(["x"]);
  });
});
