// The storyboard files of a song (Theme v2 step 2d): `<song folder>\storyboards\<platform>-<n>.json`, one per
// planned video, written whenever Shape plans that video with the song's own clips (src/storyboard-file.ts has
// the format). Written in one go (a temporary file, then renamed), so a crash never leaves half a file. From step
// 2e-1 Make settles each video's file before making it (settleShotPlan) and compiles the props from it; a Try other
// looks video has its own file, `<platform>-<n>~<kind>-<name>.json`; a file replaced by a new plan is kept as
// `<id>.previous.json` (one step back).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { VIDEO } from "../config";
import { buildStoryboard, planChanges, sameDecisions, shotPlanComplete, STORYBOARD_DIR, STORYBOARD_SCHEMA, unmatchedText, type PlanForStoryboard, type SbTry, type StoryboardFile } from "../storyboard-file";
import type { StoryboardView } from "./storyboard";
import type { PlatformPlan, VideoPlan } from "./make";
import { cachedFileHash } from "./collection";
import { toolInfo } from "./manifest";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";
import { themesDir } from "./themes";

export const storyboardId = (platform: string, video: string) => `${platform}-${video.replace(/^v/, "")}`;
const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
// A video's shot plan id: "reels-1"; a Try other looks video "reels-1~theme-night-drive" (picture versions and font
// pairings are all versions of the platform's first video: "reels-1~pictures-city", "reels-1~fonts-elegant").
export const shotPlanId = (platform: string, video: string, t: SbTry | null | undefined) =>
  !t ? storyboardId(platform, video) : `${storyboardId(platform, t.kind === "theme" ? video : "v1")}~${t.kind}-${slug(t.kind === "fonts" ? (t.pairing ?? t.label) : t.kind === "pictures" ? (t.clipSet ?? t.label) : t.label)}`;
export const previousFile = (file: string) => file.replace(/\.json$/, ".previous.json");
export const storyboardFile = (songRoot: string, id: string) => path.join(songRoot, STORYBOARD_DIR, `${id}.json`);

import { readStoryboard } from "./storyboard-read";
export { readStoryboard };

export function writeStoryboard(file: string, sb: StoryboardFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  writeFileSync(tmp, `${JSON.stringify(sb, null, 2)}\n`);
  renameSync(tmp, file);
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// The plan of one video -> its shot plan (not written yet).
export async function storyboardOfPlan(
  ws: Workspace,
  projectId: string,
  plan: PlatformPlan,
  platform: string,
  video: VideoPlan,
  view: Pick<StoryboardView, "shots" | "assessment" | "timeline">,
  lineNumbers: readonly (number | null)[],
): Promise<{ file: string; storyboard: StoryboardFile }> {
  const paths = songPathsById(ws, projectId);
  const project = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  const id = shotPlanId(platform, video.spec.name, video.try);
  const file = storyboardFile(paths.root, id);
  const recipe = paths.recipe && existsSync(paths.recipe) ? readRecipe(paths.recipe) : {};
  const themeName = video.try?.theme ?? recipe.theme ?? null;
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
    render: props.shots,
    audio: props.audio ? { fadeInFrames: props.audio.fadeInFrames, fadeOutFrames: props.audio.fadeOutFrames } : null,
    media: plan.clipFiles,
    planKey: video.planKey,
    try: video.try,
  };
  return { file, storyboard: buildStoryboard(p) };
}

// What happened to a video's shot plan when it was planned again (Shape or Make, 2e-1):
//   new: there was none; saved.  same: the plan decides the same as the saved one; saved (ids, notes, dates kept current).
//   replanned: the song, its lyric timing, its clips or its settings changed and the plan with them; the new one is saved,
//     the old one kept as <id>.previous.json, and `changes` says what changed in plain words (never silently).
//   kept: nothing the plan is made from changed, only the app would plan it differently now: the saved plan is kept
//     and made as it is (the app's newer plan shows nowhere until something changes).
export type Settled = { storyboard: StoryboardFile; status: "new" | "same" | "kept" | "replanned"; changes: string[] };
export function settleShotPlan(file: string, fresh: StoryboardFile): Settled {
  const saved = readStoryboard(file);
  if (!saved) {
    writeStoryboard(file, fresh);
    return { storyboard: fresh, status: "new", changes: [] };
  }
  if (sameDecisions(saved, fresh)) {
    writeStoryboard(file, fresh);
    return { storyboard: fresh, status: "same", changes: [] };
  }
  if (saved.inputs.planKey && saved.inputs.planKey === fresh.inputs.planKey && shotPlanComplete(saved)) return { storyboard: saved, status: "kept", changes: planChanges(fresh, saved) };
  writeStoryboard(previousFile(file), saved);
  writeStoryboard(file, fresh);
  return { storyboard: fresh, status: "replanned", changes: planChanges(saved, fresh) };
}

// The shot plan settleShotPlan would use, without saving anything: the "Make would make this" look-ahead (a duplicate
// check before a run is queued must leave no trace).
export function peekShotPlan(file: string, fresh: StoryboardFile): StoryboardFile {
  const saved = readStoryboard(file);
  if (!saved || sameDecisions(saved, fresh)) return fresh;
  return saved.inputs.planKey && saved.inputs.planKey === fresh.inputs.planKey && shotPlanComplete(saved) ? saved : fresh;
}

// The plan Shape shows for one video -> its shot plan file, settled (above). Returns the file, the shot plan used, what
// happened and the edits no shot matches, in plain words (Shape adds them to its notes).
export async function saveStoryboardOfPlan(
  ws: Workspace,
  projectId: string,
  plan: PlatformPlan,
  platform: string,
  video: VideoPlan,
  view: Pick<StoryboardView, "shots" | "assessment" | "timeline">,
  lineNumbers: readonly (number | null)[],
): Promise<{ file: string; storyboard: StoryboardFile; unmatched: string[] } & Omit<Settled, "storyboard">> {
  const { file, storyboard } = await storyboardOfPlan(ws, projectId, plan, platform, video, view, lineNumbers);
  const settled = settleShotPlan(file, storyboard);
  return { file, ...settled, unmatched: unmatchedText(settled.storyboard) };
}
