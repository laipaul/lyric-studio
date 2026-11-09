// The storyboard files of a song (Theme v2 step 2d): `<song folder>\storyboards\<platform>-<n>.json`, one per
// planned video, written whenever Shape plans that video with the song's own clips (src/storyboard-file.ts has
// the format). Written in one go (a temporary file, then renamed), so a crash never leaves half a file. Nothing
// reads them yet: Make plans as before until step 2e-1.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { VIDEO } from "../config";
import { buildStoryboard, STORYBOARD_DIR, STORYBOARD_SCHEMA, unmatchedText, type PlanForStoryboard, type StoryboardFile } from "../storyboard-file";
import type { StoryboardView } from "./storyboard";
import type { PlatformPlan, VideoPlan } from "./make";
import { cachedFileHash } from "./collection";
import { toolInfo } from "./manifest";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { themesDir } from "./themes";

export const storyboardId = (platform: string, video: string) => `${platform}-${video.replace(/^v/, "")}`;
export const storyboardFile = (songRoot: string, id: string) => path.join(songRoot, STORYBOARD_DIR, `${id}.json`);

export function readStoryboard(file: string): StoryboardFile | null {
  try {
    const sb = JSON.parse(readFileSync(file, "utf8")) as StoryboardFile;
    return sb && sb.schemaVersion === STORYBOARD_SCHEMA && Array.isArray(sb.shots) ? sb : null;
  } catch {
    return null;
  }
}

export function writeStoryboard(file: string, sb: StoryboardFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  writeFileSync(tmp, `${JSON.stringify(sb, null, 2)}\n`);
  renameSync(tmp, file);
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// The plan Shape shows for one video -> its storyboard file. Returns the file, the storyboard and the edits no
// shot matches, in plain words (Shape adds them to its notes).
export async function saveStoryboardOfPlan(
  ws: Workspace,
  projectId: string,
  plan: PlatformPlan,
  platform: string,
  video: VideoPlan,
  view: Pick<StoryboardView, "shots" | "assessment" | "timeline">,
  lineNumbers: readonly (number | null)[],
): Promise<{ file: string; storyboard: StoryboardFile; unmatched: string[] }> {
  const paths = songPathsById(ws, projectId);
  const project = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  const id = storyboardId(platform, video.spec.name);
  const file = storyboardFile(paths.root, id);
  const recipe = paths.recipe && existsSync(paths.recipe) ? readRecipe(paths.recipe) : {};
  const themeName = recipe.theme ?? null;
  let themeVersion: number | null = null;
  if (themeName) {
    try {
      themeVersion = (JSON.parse(readFileSync(path.join(themesDir(ws.dir), themeName, "theme.json"), "utf8")) as { version?: number }).version ?? null;
    } catch {
      themeVersion = null;
    }
  }
  const slot = async (role: "song" | "vocals" | "lyrics", f: string | null | undefined, known?: string | null) =>
    f && existsSync(f) ? { slot: role, file: path.basename(f), sha256: known ?? (await cachedFileHash(ws, f)) } : null;
  const clipsJson = path.join(paths.root, "clips.json");
  const props = video.props;
  const p: PlanForStoryboard = {
    id,
    platform,
    song: { title: project?.title ?? "", artist: project?.artist ?? "", instrumental: paths.instrumental },
    inputs: {
      song: await slot("song", paths.audio, project?.audio_hash ?? null),
      vocals: paths.instrumental ? null : await slot("vocals", paths.vocals),
      lyrics: await slot("lyrics", paths.lyricsTxt),
      alignment: plan.alignment.file,
      clips: { file: "clips.json", sha256: existsSync(clipsJson) ? sha(clipsJson) : null },
    },
    theme: { name: themeName, version: themeVersion },
    fps: VIDEO.fps,
    size: props.format ?? { width: 1080, height: 1920 },
    section: { mode: plan.section.mode, startMs: plan.section.start_ms, endMs: plan.section.end_ms, reason: plan.section.reason, locked: (recipe.locked ?? []).includes("section") },
    songStartFrame: props.audio ? props.audio.startFrame : Math.round((plan.section.start_ms * VIDEO.fps) / 1000),
    durationInFrames: props.durationInFrames,
    bpm: plan.analysis.bpm,
    beats: plan.analysis.beats,
    shots: props.shots,
    shotInfo: view.shots.map((s) => ({ clip: s.clip, inS: s.inS, outS: s.outS, dip: s.dip, anchorLine: s.anchor?.line ?? null, warnings: s.warnings })),
    lyrics: props.lyrics,
    lineNumbers,
    handSet: plan.alignment.handSet,
    instrumental: paths.instrumental,
    cards: (props.textCards ?? []).filter((c) => !c.off).map((c) => ({ id: c.id, type: c.type, text: c.text, startFrame: c.startFrame, endFrame: c.endFrame })),
    timeline: view.timeline,
    assessment: { verdict: view.assessment.verdict, headline: view.assessment.headline, points: view.assessment.points.map((x) => x.text) },
    previous: readStoryboard(file),
    now: new Date().toISOString(),
    app: toolInfo().git_commit,
  };
  const storyboard = buildStoryboard(p);
  writeStoryboard(file, storyboard);
  return { file, storyboard, unmatched: unmatchedText(storyboard) };
}
