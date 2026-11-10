// The worker's side of the run queue: takes the next queued run and makes it with makeVideos (the same
// code as "pnpm make"), writing the progress for the Tasks menu (at most once a second), honouring
// Stop (after the current video) and recording the result.
import path from "node:path";

import { makeRun, storedPath, type MakeRun, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { assessMade } from "./exports";
import { markInterruptedJobs } from "./jobs";
import { failureSummary, makeVideos, type MakeOptions, type MakeResult, type RenderState } from "./make";
import { timeLyrics } from "./lyric-timing";
import { claimNextRun, stopRequested, type RunOptions } from "./runs";

type State = { platform: string; name: string; status: string; progress: number };

// Overall progress: every platform counts the same; a video counts by its progress (done = 1).
export function runProgress(platforms: string[], states: readonly State[]): number {
  if (!platforms.length) return 0;
  const per = platforms.map((p) => {
    const mine = states.filter((s) => s.platform === p);
    if (!mine.length) return 0;
    return mine.reduce((a, s) => a + (s.status === "done" || s.status === "failed" || s.status === "stopped" ? 1 : s.status === "checking" ? 0.97 : s.progress * 0.95), 0) / mine.length;
  });
  return Math.min(1, per.reduce((a, b) => a + b, 0) / platforms.length);
}

const LABEL: Record<string, string> = { standard: "Standard", reels: "Reels", tiktok: "TikTok", shorts: "Shorts", youtube: "YouTube", canvas: "Canvas" };

export function runCurrent(states: readonly State[]): string | null {
  const active = states.filter((s) => s.status === "rendering" || s.status === "checking");
  if (!active.length) return null;
  return active
    .map((s) => {
      // "(1 of 2)": its place among the videos this run makes (a Resume makes only the missing ones).
      const mine = states.filter((x) => x.platform === s.platform);
      return `${LABEL[s.platform] ?? s.platform} ${s.name}: ${s.status === "checking" ? "QA check" : `${Math.floor(s.progress * 100)}%`} (${mine.indexOf(s) + 1} of ${mine.length})`;
    })
    .join(" · ");
}

// A short result line by the verdicts: "3 videos: 2 ready to post · 1 to improve" (+ what failed or was stopped).
// The verdict is the Videos tab's (assessment of the qa + manifest); the QA summary only when that cannot be read.
export function runSummary(result: MakeResult, stopped: boolean): string {
  const ok = result.variations.filter((v) => !v.error);
  const verdicts = ok.map((v) => assessMade(v.qaFile, v.manifestFile)?.verdict ?? (v.qaSummary.startsWith("WARN") ? "good" : "ready"));
  const count = (verdict: string) => verdicts.filter((x) => x === verdict).length;
  const split = [[count("ready"), "ready to post"], [count("good"), "to improve"], [count("not-ready"), "not ready"]].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
  const parts = [`${ok.length} video${ok.length === 1 ? "" : "s"}${split.length ? `: ${split.join(" · ")}` : ""}`];
  if (stopped) parts.push("stopped: Resume makes the rest");
  const failures = failureSummary({ ...result, platforms: result.platforms.filter((p) => p.error !== "stopped before it started") });
  if (failures) parts.push(...failures.filter((l) => !l.startsWith("The other") && !l.startsWith("Render only") && !l.startsWith("No video")));
  // 2e-1: a shot plan saved again before making (the song, its clips or settings changed) is never silent.
  const plans = result.platforms.flatMap((p) => p.shotPlanNotes ?? []);
  return [parts.join(". "), ...plans].join("\n");
}

export async function executeRun(ws: Workspace, run: MakeRun, make: (o: MakeOptions) => Promise<MakeResult> = makeVideos, extra: Partial<MakeOptions> = {}): Promise<MakeRun> {
  const options = run.options_json as RunOptions;
  if (options.lyricsOnly) return executeLyricTiming(ws, run, extra);
  const platforms = (options.platforms ?? "standard").split(",");
  const states = new Map<string, State>();
  let lastWrite = 0;
  let wantStop = false;
  const save = (force = false) => {
    if (!force && Date.now() - lastWrite < 1000) return;
    lastWrite = Date.now();
    const list = [...states.values()];
    ws.db
      .update(makeRun)
      .set({ progress: runProgress(platforms, list), current: wantStop ? "stopping after the current video…" : runCurrent(list), states_json: list })
      .where(eq(makeRun.id, run.id))
      .run();
  };
  try {
    const result = await make({
      ...options,
      ...extra,
      runId: run.id,
      shouldStop: () => (wantStop ||= stopRequested(ws, run.id)),
      onReady: (p) => {
        const root = p.platform.name === "standard" ? p.exportDir : path.dirname(p.exportDir);
        ws.db.update(makeRun).set({ export_dir: storedPath(ws, root) }).where(eq(makeRun.id, run.id)).run();
      },
      onRenderProgress: (list: RenderState[]) => {
        for (const s of list) states.set(`${s.platform}|${s.name}`, s);
        save();
      },
    });
    save(true);
    const stopped = wantStop || [...states.values()].some((s) => s.status === "stopped");
    const failed = !result.variations.some((v) => !v.error) && result.platforms.some((p) => p.error && p.error !== "stopped before it started");
    return ws.db
      .update(makeRun)
      .set({
        status: stopped ? "stopped" : failed ? "failed" : "done",
        progress: stopped || failed ? runProgress(platforms, [...states.values()]) : 1,
        current: null,
        message: runSummary(result, stopped),
        export_dir: storedPath(ws, result.exportDir),
        finished_at: new Date(),
      })
      .where(eq(makeRun.id, run.id))
      .returning()
      .get()!;
  } catch (error) {
    return ws.db
      .update(makeRun)
      .set({ status: "failed", current: null, message: (error as Error).message.split("\n").slice(0, 6).join("\n"), finished_at: new Date() })
      .where(eq(makeRun.id, run.id))
      .returning()
      .get()!;
  } finally {
    markInterruptedJobs(ws); // a crash inside makeVideos never leaves jobs "rendering"
  }
}

// A lyric-timing run (after a new vocals.wav): align on the song's voice source and check, no videos.
async function executeLyricTiming(ws: Workspace, run: MakeRun, extra: Partial<MakeOptions>): Promise<MakeRun> {
  const set = (values: Partial<MakeRun>) => ws.db.update(makeRun).set(values).where(eq(makeRun.id, run.id)).returning().get()!;
  try {
    set({ current: "lyric timing: aligning on the vocal stem…" });
    const realign = (run.options_json as { realign?: boolean } | null)?.realign === true; // "Time the lyrics again"
    const timing = await timeLyrics(ws, run.project_id, { log: extra.log, align: extra.align, voiceMap: extra.voiceMap, firstWords: extra.firstWords, realign });
    return set({ status: "done", progress: 1, current: null, message: timing.summary, finished_at: new Date() });
  } catch (error) {
    return set({ status: "failed", current: null, message: (error as Error).message.split("\n").slice(0, 6).join("\n"), finished_at: new Date() });
  }
}

// One worker step: the next queued run, if any (one at a time).
export async function workOnce(ws: Workspace, make?: (o: MakeOptions) => Promise<MakeResult>, extra?: Partial<MakeOptions>): Promise<MakeRun | null> {
  const run = claimNextRun(ws);
  if (!run) return null;
  return executeRun(ws, run, make, extra);
}

export { markInterruptedJobs } from "./jobs";
export { markInterruptedRuns } from "./runs";
