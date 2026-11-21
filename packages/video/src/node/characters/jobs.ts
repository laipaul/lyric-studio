// A card's background work (Make pack, Remake a view, Get missing pictures), queued in the card_job table and run in
// the studio's own process: it mostly waits on fal.ai, so it does not need the render worker. The Tasks menu lists
// these jobs next to the Make runs. A job whose process is gone (the studio was stopped) shows as interrupted.
import { geminiClient } from "./gemini";
import { getLook, lookEstimate } from "./looks";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { absPath, cardJob, card as cardTable, project as projectTable, type CardJob, type Workspace } from "@lyric/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { processAlive } from "../jobs";
import { cardRoot, cardThresholds, currentVersion, getCard, packEstimate, readCardFile, referenceFiles, versionDir } from "./cards";
import { localFaceTool, type FaceTool } from "./face";
import { errorText } from "./fal";
import { buildSheet, fetchMissing, makePictures, readReport, rescore, type GenDeps } from "./generate";
import { money, VIEWS, ANGLES } from "./plan";
import { stubFace, stubFal } from "./stub";

import { createFalClient, type FalClient } from "@fal-ai/client";

export type CardJobKind = CardJob["kind"];
export type CardJobOptions = { cap?: number; only?: string[]; songId?: string; her?: string[]; look?: string };

// The songs whose clips can calibrate a character's face check (their own clips folder).
export function calibrationSongs(ws: Workspace): { id: string; title: string }[] {
  return ws.db
    .select({ id: projectTable.id, title: projectTable.title, folder: projectTable.folder })
    .from(projectTable)
    .all()
    .filter((p) => p.folder && existsSync(absPath(ws, `${p.folder}/clips`)))
    .map((p) => ({ id: p.id, title: p.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Calibrates the character's face-check lines on a song's clips (local, free): calibration.json in the card folder.
async function calibrateCard(ws: Workspace, cardId: string, face: FaceTool, o: CardJobOptions): Promise<string> {
  const row = getCard(ws, cardId);
  if (row.kind !== "character") throw new Error("Only characters are calibrated (scene cards have no face check).");
  const song = ws.db.select().from(projectTable).where(eq(projectTable.id, String(o.songId))).get();
  if (!song?.folder) throw new Error("Choose a song with its own clips.");
  const clips = absPath(ws, `${song.folder}/clips`);
  const root = cardRoot(ws, row);
  const c = await face.calibrate(referenceFiles(root, readCardFile(root))[0], [clips], o.her ?? []);
  writeFileSync(path.join(root, "calibration.json"), `${JSON.stringify({ ...c, song: song.title, created_at: new Date().toISOString() }, null, 2)}\n`);
  const t = c.thresholds;
  // The views already made are judged again with the new lines (free).
  const file = readCardFile(root);
  const again = rescore(root, file, cardThresholds(root));
  if (again) {
    const report = readReport(versionDir(root, currentVersion(file).n));
    if (report) await buildSheet(face, root, file, report);
  }
  return `${again ? `${again} face picture(s) judged again. ` : ""}Green ≥ ${t.green_from}, red < ${t.red_below} (${t.others_used} other clip(s) of ${song.title}, the best other person ${t.top_other})${t.note ? `. ${t.note}` : ""}`;
}

const ACTIVE = ["queued", "running"] as const;
const stops = new Set<string>(); // jobs asked to stop (checked between pictures)

export const DEFAULT_CAP = 3;

export function jobLabel(name: string, kind: CardJobKind, o: CardJobOptions, lookName?: string): string {
  if (lookName) return `${name} · ${kind === "pack" ? `Make look "${lookName}"` : `Remake ${lookName}: ${o.only?.map((id) => VIEWS.find((x) => x.id === id)?.label ?? id).join(", ")}`}`;
  const what = kind === "pack" ? "Make pack" : kind === "view" ? `Remake ${o.only?.map((id) => [...VIEWS, ...ANGLES].find((x) => x.id === id)?.label ?? id).join(", ")}` : kind === "fetch" ? "Get missing pictures" : "Calibrate";
  return `${name} · ${what}`;
}

export function enqueueCardJob(ws: Workspace, cardId: string, kind: CardJobKind, o: CardJobOptions = {}): CardJob {
  const row = getCard(ws, cardId);
  const busy = ws.db.select().from(cardJob).where(and(eq(cardJob.card_id, cardId), inArray(cardJob.status, [...ACTIVE]))).get();
  if (busy) throw new Error(`"${busy.label}" is still running for this card: wait for it to finish.`);
  const file = readCardFile(cardRoot(ws, row));
  const look = o.look ? getLook(file, o.look) : null;
  if (look && look.status === "locked") throw new Error(`"${look.name}" is locked: press "Change this look" first.`);
  if (!look && kind !== "fetch" && kind !== "calibrate" && currentVersion(file).status === "locked") throw new Error("This version is locked: start a new version to change it.");
  const cap = o.cap ?? DEFAULT_CAP;
  if (kind === "pack" && look) {
    const e = lookEstimate(look);
    if (e.usd > cap) throw new Error(`The estimate (${money(e.usd)}) is above the cap of ${money(cap)}: raise the cap to make the look.`);
  } else if (kind === "pack") {
    const e = packEstimate(file);
    if (e.usd > cap) throw new Error(`The estimate (${money(e.usd)}) is above the cap of ${money(cap)}: raise the cap to make the pack.`);
  }
  return ws.db
    .insert(cardJob)
    .values({ card_id: cardId, kind, label: jobLabel(row.name, kind, o, look?.name), options_json: { ...o, cap } as Record<string, unknown> })
    .returning()
    .get();
}

// The face checks alone (local, free): the real ones, or the browser tests' stand-in.
export function cardFace(env: NodeJS.ProcessEnv = process.env): FaceTool {
  return env.LYRIC_CARDS_STUB ? stubFace() : localFaceTool();
}

// fal and the face checks: the real ones, or the browser tests' stand-ins (LYRIC_CARDS_STUB).
export function cardTools(env: NodeJS.ProcessEnv = process.env): { fal: FalClient; face: FaceTool; gemini?: FalClient | null } | { error: string } {
  if (env.LYRIC_CARDS_STUB) return { fal: stubFal(env.LYRIC_CARDS_STUB), face: stubFace(), gemini: stubFal(env.LYRIC_CARDS_STUB) };
  const key = env.FAL_KEY?.trim();
  if (!key) return { error: "No FAL_KEY in .env: add a line FAL_KEY=<your key from fal.ai → Dashboard → API keys> to D:\\videomaker\\.env, then restart Lyric Studio." };
  const g = env.GEMINI_API_KEY?.trim();
  return { fal: createFalClient({ credentials: key, suppressLocalCredentialsWarning: true }), face: localFaceTool(), gemini: g ? geminiClient(g) : null };
}

// Is Gemini usable for a pack (the user's own key in .env, or the browser tests' stand-in)?
export const hasGeminiKey = (env: NodeJS.ProcessEnv = process.env) => !!(env.LYRIC_CARDS_STUB || env.GEMINI_API_KEY?.trim());

// Calibration needs only the local face checks (no fal key).
export function toolsFor(kind: CardJobKind, env: NodeJS.ProcessEnv = process.env): { fal: FalClient; face: FaceTool } | { error: string } {
  if (kind === "calibrate") return { fal: undefined as unknown as FalClient, face: cardFace(env) };
  return cardTools(env);
}

// Runs one queued job to the end (called right after it is queued; the HTTP request does not wait for it).
export async function runCardJob(openWs: () => Workspace, jobId: string, tools: { fal: FalClient; face: FaceTool; gemini?: FalClient | null } | { error: string } = cardTools()): Promise<void> {
  const ws = openWs();
  const set = (v: Partial<CardJob>) => ws.db.update(cardJob).set(v).where(eq(cardJob.id, jobId)).run();
  try {
    const job = ws.db.select().from(cardJob).where(eq(cardJob.id, jobId)).get();
    if (!job || job.status !== "queued") return;
    set({ status: "running", started_at: new Date(), pid: process.pid, current: "starting" });
    if ("error" in tools) throw new Error(tools.error);
    const o = job.options_json as CardJobOptions;
    const deps: GenDeps = {
      ...tools,
      progress: (done, total, current) => set({ progress: Math.min(1, total ? done / total : 0), current }),
      shouldStop: () => stops.has(jobId),
    };
    if (job.kind === "calibrate") {
      set({ current: "comparing faces (local, free)" });
      const message = await calibrateCard(ws, job.card_id, tools.face, o);
      set({ status: "done", progress: 1, current: null, message, cost_usd: 0, finished_at: new Date() });
      return;
    }
    const result = job.kind === "fetch" ? await fetchMissing(ws, job.card_id, deps) : await makePictures(ws, job.card_id, deps, { cap: o.cap ?? DEFAULT_CAP, only: job.kind === "view" ? o.only : undefined, look: o.look });
    const stopped = stops.has(jobId);
    set({ status: stopped ? "stopped" : "done", progress: 1, current: null, message: result.summary, cost_usd: Math.round(result.spentUsd * 100) / 100, finished_at: new Date() });
    ws.db.update(cardTable).set({ updated_at: new Date() }).where(eq(cardTable.id, job.card_id)).run();
  } catch (error) {
    set({ status: "failed", current: null, message: errorText(error), finished_at: new Date() });
  } finally {
    stops.delete(jobId);
    ws.close();
  }
}

export function stopCardJob(ws: Workspace, id: string): void {
  const job = ws.db.select().from(cardJob).where(eq(cardJob.id, id)).get();
  if (!job) throw new Error("No such job.");
  if (job.status === "queued") ws.db.update(cardJob).set({ status: "stopped", finished_at: new Date() }).where(eq(cardJob.id, id)).run();
  else if (job.status === "running") stops.add(id);
}

// Jobs whose process is gone (the studio was stopped mid-way) are marked interrupted.
export function markInterruptedCardJobs(ws: Workspace, isAlive: (pid: number) => boolean = processAlive): number {
  const running = ws.db.select().from(cardJob).where(eq(cardJob.status, "running")).all();
  let n = 0;
  for (const j of running) {
    if (j.pid && (j.pid === process.pid || isAlive(j.pid))) continue;
    ws.db.update(cardJob).set({ status: "interrupted", finished_at: new Date(), message: "The studio stopped while this ran: start it again from the card." }).where(eq(cardJob.id, j.id)).run();
    n++;
  }
  return n;
}

export type CardTask = CardJob & { cardName: string; cardKind: string };

// For the Tasks menu: active jobs and the finished ones not cleared (newest first, at most 20).
export function listCardJobs(ws: Workspace): CardTask[] {
  markInterruptedCardJobs(ws);
  return ws.db
    .select({ job: cardJob, name: cardTable.name, kind: cardTable.kind })
    .from(cardJob)
    .innerJoin(cardTable, eq(cardJob.card_id, cardTable.id))
    .where(isNull(cardJob.cleared_at))
    .orderBy(desc(cardJob.created_at))
    .limit(20)
    .all()
    .map((r) => ({ ...r.job, cardName: r.name, cardKind: r.kind }));
}

export function cardJobsFor(ws: Workspace, cardId: string): CardJob[] {
  markInterruptedCardJobs(ws);
  return ws.db.select().from(cardJob).where(eq(cardJob.card_id, cardId)).orderBy(desc(cardJob.created_at)).limit(10).all();
}

export function clearFinishedCardJobs(ws: Workspace): number {
  const done = ws.db.select({ id: cardJob.id }).from(cardJob).where(and(isNull(cardJob.cleared_at), inArray(cardJob.status, ["done", "failed", "stopped", "interrupted"]))).all();
  for (const d of done) ws.db.update(cardJob).set({ cleared_at: new Date() }).where(eq(cardJob.id, d.id)).run();
  return done.length;
}
