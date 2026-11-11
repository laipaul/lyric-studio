// Version names (11 Nov 2026): a video is "v1", "v2", "v3"... per platform for the whole song, in the order the videos were
// made, never reused; the files keep their run-local names (exports\<run>\reels\v1.mp4); marks stay on the file.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWorkspace, project, type Workspace } from "@lyric/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approvedVideos, setVideoMark, songPathsById, songRuns } from "../src/node";
import { existingTakes } from "../src/node/take-check";
import { versionsFile } from "../src/node/versions";
import { findSongByTitleOrId, versionsReport } from "../src/node/versions-report";
import { videoFilePart, videoTitle } from "../src/video-names";

const root = mkdtempSync(path.join(os.tmpdir(), "lyric-versions-"));
let ws: Workspace;
let projectId: string;
let exportsDir: string;
const QA = "x\nQA: PASS\n\n[ok  ] Lyric timing confidence\n\nSummary: PASS\n";

// One finished video as a run leaves it: <run>[/<platform>]/v<n>.{mp4,qa.txt,manifest.json}.
function video(run: string, platform: string, n: number, createdAt: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(exportsDir, run, platform);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `v${n}.mp4`), "mp4");
  writeFileSync(path.join(dir, `v${n}.qa.txt`), QA);
  writeFileSync(
    path.join(dir, `v${n}.manifest.json`),
    JSON.stringify({ manifest_version: 1, created_at: createdAt, variation: { index: n, name: `v${n}`, order: "story", seed: n, style: "Simple", cinematic_bars: false }, settings: {}, output: { file: `v${n}.mp4`, duration_s: 30 }, props: { layout: "vertical" }, ...extra }),
  );
  return `${songPathsById(ws, projectId).exportsRel}/${run}/${platform}/v${n}.manifest.json`;
}
const names = (platform: string) => songRuns(ws, projectId).flatMap((r) => r.platforms.filter((p) => p.name === platform).flatMap((p) => p.videos.map((v) => `${r.folder}/${v.file}=${v.name}`)));

beforeAll(() => {
  ws = openWorkspace(path.join(root, "workspace"));
  projectId = ws.db.insert(project).values({ title: "Hold On", artist: "Pômé" }).returning().get().id;
  exportsDir = songPathsById(ws, projectId).exports;
});
afterAll(() => {
  ws?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("song-wide version names", () => {
  let first: string;
  let second: string;

  it("two runs for the same platform give v1 then v2 (the files are both v1.mp4)", () => {
    first = video("2025-11-11_1505", "reels", 1, "2025-11-11T15:05:10.000Z");
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1"]);
    second = video("2025-11-11_1541", "reels", 1, "2025-11-11T15:41:10.000Z");
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1", "2025-11-11_1541/v1=v2"]);
    const [a, b] = songRuns(ws, projectId).map((r) => r.platforms[0].videos[0]);
    expect([a.file, b.file]).toEqual(["v1", "v1"]); // the files on disk keep their names
    expect([a.index, b.index]).toEqual([1, 1]);
    expect(videoTitle(b, true).title).toBe("Reels v2");
    expect(videoFilePart(b)).toBe("Reels v2");
  });

  it("is written to .studio/versions.json and a re-read gives the same numbers", () => {
    const file = versionsFile(songPathsById(ws, projectId).root);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ reels: { "2025-11-11_1505/reels/v1": 1, "2025-11-11_1541/reels/v1": 2 } });
    expect(names("reels")).toEqual(names("reels"));
  });

  it("another platform counts on its own; a run with several videos numbers them in order", () => {
    video("2025-11-11_1541", "tiktok", 1, "2025-11-11T15:41:20.000Z");
    video("2025-11-11_1541", "tiktok", 2, "2025-11-11T15:41:50.000Z");
    expect(names("tiktok")).toEqual(["2025-11-11_1541/v1=v1", "2025-11-11_1541/v2=v2"]);
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1", "2025-11-11_1541/v1=v2"]);
  });

  it("marks stay on the file: approved / favourite / discarded are the same after naming", () => {
    expect(setVideoMark(ws, projectId, first, { status: "approved", favourite: true })).toEqual({ status: "approved", favourite: true });
    expect(setVideoMark(ws, projectId, second, { status: "discarded" })).toEqual({ status: "discarded", favourite: false });
    const reels = songRuns(ws, projectId).flatMap((r) => r.platforms.filter((p) => p.name === "reels").flatMap((p) => p.videos));
    expect(reels.map((v) => [v.name, v.id === first ? "first" : "second", v.mark])).toEqual([
      ["v1", "first", { favourite: true, status: "approved" }],
      ["v2", "second", { favourite: false, status: "discarded" }],
    ]);
    expect(approvedVideos(songRuns(ws, projectId)).map((g) => g.videos.map((v) => `${v.name}:${v.id === first}`))).toEqual([["v1:true"]]);
  });

  it("a discarded video keeps its number and the next run gets the next one", () => {
    video("2025-11-12_0900", "reels", 1, "2025-11-12T09:00:00.000Z");
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1", "2025-11-11_1541/v1=v2", "2025-11-12_0900/v1=v3"]);
  });

  it("a number is never reused, even when the video's files are gone", () => {
    rmSync(path.join(exportsDir, "2025-11-12_0900"), { recursive: true });
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1", "2025-11-11_1541/v1=v2"]);
    video("2025-11-13_0900", "reels", 1, "2025-11-13T09:00:00.000Z");
    expect(names("reels")).toEqual(["2025-11-11_1505/v1=v1", "2025-11-11_1541/v1=v2", "2025-11-13_0900/v1=v4"]); // v3 was used
  });

  it("existing videos are numbered in creation order the first time they are read, whatever their file names", () => {
    const other = ws.db.insert(project).values({ title: "Older Song", artist: "Pômé" }).returning().get().id;
    const ex = songPathsById(ws, other).exports;
    const make = (run: string, n: number, createdAt: string) => {
      const dir = path.join(ex, run, "reels");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `v${n}.mp4`), "mp4");
      writeFileSync(path.join(dir, `v${n}.qa.txt`), QA);
      writeFileSync(path.join(dir, `v${n}.manifest.json`), JSON.stringify({ manifest_version: 1, created_at: createdAt, variation: { index: n, name: `v${n}`, order: "story", seed: n, style: "Simple", cinematic_bars: false }, settings: {}, output: { file: `v${n}.mp4`, duration_s: 30 }, props: {} }));
    };
    make("2025-11-02_1000", 1, "2025-11-02T10:00:00.000Z");
    make("2025-11-03_1000", 1, "2025-11-03T10:00:00.000Z");
    make("2025-11-03_1000", 3, "2025-11-03T10:05:00.000Z"); // a take: file v3 inside the run
    make("2025-11-04_1000", 2, "2025-11-04T10:00:00.000Z");
    const list = songRuns(ws, other).flatMap((r) => r.platforms.flatMap((p) => p.videos.map((v) => `${r.folder}/${v.file}=${v.name}`)));
    expect(list).toEqual(["2025-11-02_1000/v1=v1", "2025-11-03_1000/v1=v2", "2025-11-03_1000/v3=v3", "2025-11-04_1000/v2=v4"]);
    // "Make another" varies by the number in the file name (the variation), not by the version names on screen.
    expect(existingTakes(ws, other, "reels")).toEqual([1, 2, 3]);
    const report = versionsReport(ws, other, "Older Song");
    expect(report).toContain("exports\\2025-11-03_1000\\reels\\v3.mp4 -> v3");
    expect(findSongByTitleOrId(ws, "older").id).toBe(other);
  });

  it("a try (Compare looks) is not a version: it keeps its own name and does not use a number", () => {
    const tryFile = video("2025-11-14_1000", "reels", 1, "2025-11-14T10:00:00.000Z", { shot_plan: { id: "reels-1~theme-night-drive", file: "x", copy: "x", status: "new", note: null, try: { kind: "theme", label: "Night Drive", theme: "Night Drive" } } });
    const reels = songRuns(ws, projectId).flatMap((r) => r.platforms.filter((p) => p.name === "reels").flatMap((p) => p.videos));
    const t = reels.find((v) => v.id === tryFile)!;
    expect(t.name).toBe("Try · Night Drive");
    expect(t.basedOn).toBe("v4"); // the newest own video made before it
    expect(videoTitle(t, true)).toEqual({ title: "Reels · Try · Night Drive", basedOn: "based on v4" });
    video("2025-11-15_1000", "reels", 1, "2025-11-15T10:00:00.000Z");
    expect(names("reels").at(-1)).toBe("2025-11-15_1000/v1=v5"); // v4 was the last own video; the try took no number
    expect(existsSync(versionsFile(songPathsById(ws, projectId).root))).toBe(true);
    expect(JSON.parse(readFileSync(versionsFile(songPathsById(ws, projectId).root), "utf8")).reels).not.toHaveProperty("2025-11-14_1000/reels/v1");
  });
});
