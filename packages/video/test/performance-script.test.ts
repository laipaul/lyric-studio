// Performance script (Part B, 26 Nov 2026): the request holds the lines, the gaps, their music cues, the personas and
// the escalation rule for repeats; Claude's answer is read back (clean and messy); entries go stale when the lyrics or
// timing change and are never applied then; Copy shot prompt prefers the line's direction over the section map; the
// music cues are measured locally and cached; render props unchanged.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, seedStylePresets, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { directionLines, parseScript, repeatsOf, scriptRequest, staleness, type ScriptEntry, type ScriptSegment } from "../src/performance-script";
import { emptyPersona, personaShotPrompt } from "../src/persona";
import { findOrCreateSongProject, makeVideos, readRecipe, songPathsById, writeRecipe, type RenderOptions } from "../src/node";
import { createCard } from "../src/node/characters";
import { cueText, cachedMusicCues, musicCues, songSegments } from "../src/node/music-cues";
import { reelRange } from "../src/node/lipsync";
import { clipShotPrompt, setPersona } from "../src/node/persona";
import { editScript, pasteScript, readScript, scriptRequestFor, scriptView } from "../src/node/performance-script";
import { setCast } from "../src/node/production";
import { setSongSections } from "../src/node/song-sections";
import { fakeAlign, ffmpeg, LYRICS, makeClip, makeSong } from "./media-helpers";

const seg = (key: string, number: number | null, text: string, startMs: number, section: string | null, sectionKind: string | null, cue = ""): ScriptSegment => ({ key, kind: number ? "line" : "gap", number, text, startMs, endMs: startMs + 1500, section, sectionKind, cue });
const SONG: ScriptSegment[] = [
  seg("G1", null, "Intro", 0, "Intro", "instrumental", "soft; sparse"),
  seg("L1", 1, "Verse one here", 4000, "Verse 1", "verse", "soft; sparse; vocal soft"),
  seg("L2", 2, "Hold on to me", 6000, "Chorus 1", "chorus", "build → drop at 0:06; loud; full; soft vocal over a loud mix"),
  seg("L3", 3, "Verse two here", 9000, "Verse 2", "verse"),
  seg("L4", 4, "Hold on to me", 11000, "Chorus 2", "chorus", "very loud; full"),
];

const ANSWER = `Here you go.

SCRIPT: Love Song
Sings to: Ken, who is leaving
Objective: to make him stay

L1 [0:04] Verse 1
Singer: Aiko
Meaning: She remembers how it started.
Emotion: tender | Intensity: 2
Beat change: none
Action: to remind
Laban: glide
Face: brows relaxed, eyes lowered, cheeks soft, lip corners slightly up, jaw loose
Body: slow breath in, hands still, gaze down, head tilted
Reaction (Ken): looks away, jaw tight
Camera: slow push-in | Pace: hold long

L2 [0:06] Chorus 1
Singer: Aiko
Meaning: She asks him to stay.
Emotion: longing | Intensity: 3
Beat change: yes: she stops hiding it
Action: to plead
Laban: press
Face: inner brows raised, eyes on the lens, lip corners down, jaw open
Body: breath caught, hand to chest
Camera: cut on the drop | Pace: cut fast

G1 [0:00-0:04] Intro
Meaning: Before anything is said.
Emotion: stillness | Intensity: 1
Camera: wide | Pace: hold long

Hope this helps!`;

describe("the script request", () => {
  it("holds the lines with sections and times, the gaps, the cues, the personas and the escalation rule for repeats", () => {
    const text = scriptRequest({ title: "Love Song", artist: "Life Lyrics", scope: "song", segments: SONG, cast: [{ name: "Aiko", persona: "PERSONA: Aiko\nArchetype: The Quiet Romantic", note: "more playful in this song" }, { name: "Ken", persona: null, note: null }] });
    expect(text).toContain('L2 [0:06] Chorus 1 (chorus 1 of 2): "Hold on to me" - build → drop at 0:06; loud; full; soft vocal over a loud mix');
    expect(text).toContain('L4 [0:11] Chorus 2 (final chorus (2 of 2); repeat 2 of 2 of line 2): "Hold on to me"');
    expect(text).toContain("G1 [0:00-0:01] Intro (instrumental) - soft; sparse");
    expect(text).toContain("PERSONA: Aiko\nArchetype: The Quiet Romantic");
    expect(text).toContain("In this song: more playful in this song");
    expect(text).toMatch(/Repeated lines and choruses ESCALATE: chorus 1 is not the final chorus/);
    expect(text).toMatch(/give a Reaction direction \(for listener shots\)/);
    expect(text).toMatch(/Action: to \.\.\. \(a transitive action verb\)/);
    expect(text).toMatch(/Laban: float \| glide \| dab \| flick \| press \| wring \| punch \| slash/);
    expect(text).toMatch(/Face: brows \.\.\., eyes \.\.\., cheeks \.\.\., lip corners \.\.\., jaw \.\.\./);
    expect(repeatsOf(SONG).get("L2")).toBe("chorus 1 of 2");
  });
});

describe("Paste script", () => {
  it("reads a clean answer: the song's two lines, each entry's fields, the reaction, gaps; prose around it ignored", () => {
    const r = parseScript(ANSWER);
    expect([r.title, r.singsTo, r.objective]).toEqual(["Love Song", "Ken, who is leaving", "to make him stay"]);
    expect(r.entries.map((e) => e.key)).toEqual(["L1", "L2", "G1"]);
    const l1 = r.entries[0];
    expect(l1).toMatchObject({ singer: "Aiko", emotion: "tender", intensity: 2, beatChange: "", action: "to remind", laban: "glide", camera: "slow push-in", pace: "hold long", reaction: { who: "Ken", direction: "looks away, jaw tight" } });
    expect(l1.face).toBe("brows relaxed, eyes lowered, cheeks soft, lip corners slightly up, jaw loose");
    expect(r.entries[1]).toMatchObject({ beatChange: "she stops hiding it", intensity: 3, reaction: null });
    expect(r.unrecognised).toEqual([]);
  });
  it("reads a messy one: bold keys, 'Line 12', fields on one line, 4/5 intensity; lists unknown labels", () => {
    const messy = [
      "**SCRIPT: Love Song**",
      "**Sings to:** Ken",
      "**Line 2** [0:06] Chorus",
      "**Singer:** Aiko | **Emotion:** longing | **Intensity:** 4/5",
      "- Action: to plead",
      "- Facial direction: inner brows raised",
      "Wardrobe: red dress",
      "**L4**",
      "Emotion - release",
    ].join("\n");
    const r = parseScript(messy);
    expect(r.singsTo).toBe("Ken");
    expect(r.entries.map((e) => e.key)).toEqual(["L2", "L4"]);
    expect(r.entries[0]).toMatchObject({ singer: "Aiko", emotion: "longing", intensity: 4, action: "to plead", face: "inner brows raised" });
    expect(r.entries[1].emotion).toBe("release");
    expect(r.unrecognised).toEqual(["Wardrobe: red dress"]);
  });
});

describe("staleness and use", () => {
  const entry = (over: Partial<ScriptEntry> = {}): ScriptEntry => ({ key: "L2", kind: "line", number: 2, basis: { text: "Hold on to me", startMs: 6000, endMs: 7500 }, singer: "Aiko", meaning: "She asks him to stay.", emotion: "longing", intensity: 3, beatChange: "", action: "to plead", laban: "press", face: "inner brows raised", body: "hand to chest", camera: "push-in", pace: "hold", reaction: { who: "Ken", direction: "looks down" }, checked: true, ...over });
  it("the same line: fine; other words, moved words, or timing moved > 1 s: stale, in plain words", () => {
    expect(staleness(entry(), SONG.map((s) => (s.key === "L2" ? { ...s, startMs: 6400 } : s)))).toBeNull();
    expect(staleness(entry(), SONG.map((s) => (s.key === "L2" ? { ...s, text: "Hold on to you" } : s)))).toBe('the line\'s words changed (was "Hold on to me")');
    // A line added before it: the same words at the same moment are now line 4.
    expect(staleness(entry({ key: "L3", number: 3, basis: { text: "Verse two here", startMs: 9000, endMs: 10500 } }), [seg("L3", 3, "A new line", 8000, null, null), seg("L4", 4, "Verse two here", 9000, null, null)])).toBe("these words are now line 4");
    expect(staleness(entry(), SONG.map((s) => (s.key === "L2" ? { ...s, startMs: 8200 } : s)))).toBe("the line's timing moved (0:06 → 0:08)");
  });
  it("the singer gets the direction; the one sung to gets the reaction", () => {
    expect(directionLines(entry(), "Aiko")).toContain("Action: to plead");
    expect(directionLines(entry(), "Ken")).toEqual(["Reaction (Ken is sung to, listening): looks down"]);
  });
  it("the shot prompt prefers the line's direction over the section map; a stale entry is not used and says so", () => {
    const person = { name: "Aiko", identity: "A woman.", look: null, outfit: null, persona: { ...emptyPersona(), traits: ["shy"] }, songNote: null };
    const base = { people: [person], section: { kind: "chorus", name: "Chorus 1", final: false }, lyric: "Hold on to me", singing: true, song: "Love Song" };
    const withScript = personaShotPrompt({ ...base, script: { entry: entry(), stale: null, singsTo: "Ken", objective: "to make him stay" } });
    expect(withScript).toContain("On this line (performance script, Chorus 1):");
    expect(withScript).toContain("Face: inner brows raised");
    expect(withScript).toContain("Camera: push-in · Pace: hold");
    expect(withScript).toContain("Sings to: Ken · Objective: to make him stay");
    expect(withScript).not.toContain("In this part (Chorus");
    const stale = personaShotPrompt({ ...base, script: { entry: null, stale: "the line's words changed", singsTo: "", objective: "" } });
    expect(stale).toContain("In this part (Chorus, Chorus 1): finds the lens, signature gesture");
    expect(stale).toMatch(/direction for this line is stale: the line's words changed/);
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-script-"));
const wsDir = path.join(root, "workspace");
const previous = process.env.WORKSPACE_DIR;
let ws: Workspace;

beforeAll(() => {
  process.env.WORKSPACE_DIR = wsDir;
  ws = openWorkspace(wsDir);
  seedStylePresets(ws.db);
}, 60_000);
afterAll(() => {
  ws?.close();
  if (previous === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("a song with a script", () => {
  it("cues measured locally and cached; request, paste, stale after a change, the shot prompt uses the line; render props unchanged", async () => {
    const pic = path.join(root, "aiko.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=white:s=600x800", "-frames:v", "1", pic);
    const aiko = createCard(ws, { kind: "character", name: "Aiko", picture: readFileSync(pic), fileName: "aiko.png" }).id;
    setPersona(ws, aiko, { ...emptyPersona(), archetype: "The Quiet Romantic", traits: ["shy", "warm"] });
    const song = path.join(root, "Love Song.wav");
    makeSong(song, 12);
    const sid = (await findOrCreateSongProject(ws, song)).project.id;
    const p = songPathsById(ws, sid);
    writeFileSync(p.lyricsTxt, `${LYRICS.join("\n")}\n`);
    mkdirSync(p.clips!, { recursive: true });
    for (const [i, c] of ["blue", "red", "green"].entries()) makeClip(path.join(p.clips!, `0${i + 1}_${c}.mp4`), 3, c);
    writeRecipe(p.recipe!, { ...readRecipe(p.recipe!), platforms: ["reels"], section: "0:00-0:10", variations: { reels: 1 }, anchors: [{ line: 2, clip: "02_red.mp4" }] });
    setCast(ws, sid, [aiko]);
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
    await make();

    // The music cues: measured by the audio service (frequency bands here: no Demucs in the test), then cached.
    const c1 = await musicCues(ws, sid, { stems: "none" });
    expect(c1.stems).toBe("bands");
    expect(c1.segments.filter((s) => s.kind === "line").map((s) => s.key)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(c1.segments.every((s) => s.cue && s.cue.level >= 1 && s.cue.level <= 5)).toBe(true);
    const c2 = await musicCues(ws, sid, { stems: "none" });
    expect(c2.made_at).toBe(c1.made_at); // cached: same song, same timing
    expect(cueText(c1.segments[1].cue)).toMatch(/soft|medium|loud/);

    // The request: lines, cues and the persona.
    const req = await scriptRequestFor(ws, sid, "song");
    expect(req.text).toContain('L2 [0:02] Chorus (chorus 1 of 2): "Hold on to me" - ');
    expect(req.text).toContain('L5 [0:07] Chorus (final chorus (2 of 2); repeat 2 of 2 of line 2): "Hold on to me"');
    expect(req.text).toContain("Archetype: The Quiet Romantic");
    expect(req.lines).toBe(6);
    // Scope: the singing slots only (lines, no gaps), the Reel's part (its shot plan's range).
    const slots = await scriptRequestFor(ws, sid, "slots");
    expect(slots.gaps).toBe(0);
    expect(slots.lines).toBeGreaterThan(0);
    expect(slots.lines).toBeLessThan(6);
    const reel = await scriptRequestFor(ws, sid, "reel");
    expect(reel.text).toContain("for the Reel's part");
    const range = reelRange(p.root)!;
    expect(reel.lines).toBe(c1.segments.filter((s) => s.kind === "line" && s.endMs > range.startMs && s.startMs < range.endMs).length); // exactly the lines the Reel plays

    // Sections changed only: the request shows the new sections at once, the analysis is not run again.
    const before = cachedMusicCues(ws, sid)!.made_at;
    setSongSections(ws, sid, [{ line: 1, kind: "verse" }, { line: 2, kind: "chorus" }, { line: 4, kind: "bridge" }, { line: 5, kind: "chorus" }]);
    const resec = await scriptRequestFor(ws, sid, "song");
    expect(resec.text).toMatch(/L4 \[[^\]]+\] Bridge/);
    expect(resec.text).toContain("final chorus (2 of 2)");
    expect(cachedMusicCues(ws, sid)!.made_at).toBe(before);

    // Paste: L2's direction; an unknown key is listed, never guessed.
    const pasted = await pasteScript(ws, sid, ANSWER.replace("L2 [0:06]", "L2 [0:02]").replace("G1 [0:00-0:04] Intro", "G1 [0:00-0:01] Intro") + "\n\nL40 [3:00] Outro\nEmotion: calm\n");
    expect(pasted.saved).toBeGreaterThanOrEqual(2);
    expect(pasted.unrecognised).toContain("L40: not a line of this song now");
    let view = await scriptView(ws, sid);
    expect(view.entries.find((e) => e.key === "L2")).toMatchObject({ stale: null, action: "to plead", checked: false });
    await editScript(ws, sid, "L2", { checked: true, camera: "hold on her face" });
    expect(readScript(p.root)!.entries.find((e) => e.key === "L2")).toMatchObject({ checked: true, camera: "hold on her face" });

    // Copy shot prompt on the clip pinned to line 2: the line's direction, not the section default.
    const shot = await clipShotPrompt(ws, sid, "02_red.mp4");
    expect(shot.text).toContain("On this line (performance script");
    expect(shot.text).toContain("Action: to plead");
    expect(shot.text).toContain("Camera: hold on her face");
    expect(shot.text).not.toContain("In this part (Chorus");

    // The lyrics changed since the paste (simulated: the entry was made for other words): stale, never applied.
    const s = readScript(p.root)!;
    s.entries.find((e) => e.key === "L2")!.basis.text = "Hold on to you";
    writeFileSync(path.join(p.root, "production", "script.json"), JSON.stringify(s));
    view = await scriptView(ws, sid);
    expect(view.entries.find((e) => e.key === "L2")?.stale).toBe('the line\'s words changed (was "Hold on to you")');
    const staleShot = await clipShotPrompt(ws, sid, "02_red.mp4");
    expect(staleShot.text).not.toContain("Action: to plead");
    expect(staleShot.text).toMatch(/is stale: the line's words changed/);
    await editScript(ws, sid, "L2", { refresh: true });
    expect((await scriptView(ws, sid)).entries.find((e) => e.key === "L2")?.stale).toBeNull();

    // songSegments: gaps of 2 s or more between lines, the intro and the outro.
    const segs = songSegments([{ number: 1, text: "a", startMs: 3000, endMs: 4000 }, { number: 2, text: "b", startMs: 4500, endMs: 5000 }, { number: 3, text: "c", startMs: 9000, endMs: 9500 }], [], 12000);
    expect(segs.map((x) => x.key)).toEqual(["G1", "L1", "L2", "G2", "L3", "G3"]);

    // Nothing of it changes the video.
    await make();
    expect(props).toHaveLength(2);
    expect(props[1]).toBe(props[0]);
  }, 240_000);
});
