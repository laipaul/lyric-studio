// Making a card's pictures (the logic proven in spikes/characters, now for the app):
//   - characters: the 4 views (close-up, 3/4 face, full body front and back cropped at the neck by the app) from the
//     picture as identity AND style reference, the outfit in the user's words; the face views are face-checked
//     against the picture (green / amber / red) and a drifted view is made again (at most twice, within the cap);
//   - scenes: the 3 location angles, the key props named.
// Every try is kept as <id>_t<k>.png (body views also <id>_t<k>_full.png, the model's own picture); the chosen one is
// copied to <id>.png. A paid picture that could not be downloaded is never made again: `fetchMissing` gets it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FalClient } from "@fal-ai/client";

import { cardRoot, cardThresholds, currentVersion, getCard, readCardFile, referenceFiles, versionDir, writeCardFile, type CardFile } from "./cards";
import type { FaceTool } from "./face";
import { callModel, download, errorText, firstImageUrl, type Attempt } from "./fal";
import {
  angleNote, anglePrompt, ANGLES, Budget, classify, DESCRIPTION_PROMPT, MODELS, money, SCENE_DESCRIPTION_PROMPT, VIEWS, viewPrompt, VISION,
  type Light, type Thresholds, type ViewId,
} from "./plan";

import type { Workspace } from "@lyric/db";

export const RETRIES = 2;

export type Try = { file: string | null; url?: string; request_id: string | null; score: number | null; light: Light | null; text: string; attempts: Attempt[]; seed: number };
export type Item = { id: string; label: string; kind: "view" | "angle"; tries: Try[]; chosen: number | null; light: Light | null; text: string; angle_note?: string | null };
export type VersionReport = { updated_at: string; model: string; endpoint: string; thresholds: Thresholds; items: Item[]; request_ids: string[]; spent_usd: number; description_request?: string | null };

export type GenDeps = {
  fal: FalClient;
  face: FaceTool;
  log?: (m: string) => void;
  progress?: (done: number, total: number, current: string) => void;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
};

const reportFile = (dir: string) => path.join(dir, "report.json");

export function readReport(dir: string): VersionReport | null {
  try {
    return JSON.parse(readFileSync(reportFile(dir), "utf8")) as VersionReport;
  } catch {
    return null;
  }
}

function writeReport(dir: string, r: VersionReport): void {
  writeFileSync(reportFile(dir), `${JSON.stringify({ ...r, updated_at: new Date().toISOString() }, null, 2)}\n`);
}

const rank = (l: Light | null) => (l === "green" ? 3 : l === "amber" || l === "grey" ? 2 : 0);

function choose(item: Item, dir: string): void {
  let best: number | null = null;
  item.tries.forEach((t, k) => {
    if (!t.file || !existsSync(path.join(dir, t.file))) return;
    if (item.kind === "angle") {
      best = k; // the latest made
      return;
    }
    const prev = best === null ? null : item.tries[best];
    if (!prev || rank(t.light) > rank(prev.light) || (rank(t.light) === rank(prev.light) && (t.score ?? -1) > (prev.score ?? -1))) best = k;
  });
  item.chosen = best;
  if (best === null) return;
  const t = item.tries[best];
  item.light = t.light;
  item.text = item.tries.length > 1 ? `${t.text} (best of ${item.tries.filter((x) => x.file).length} tries)` : t.text;
  copyFileSync(path.join(dir, t.file!), path.join(dir, `${item.id}.png`));
}

// Body views are cropped at the neck here, whatever the model drew: faces only ever come from the face views.
async function finishPicture(face: FaceTool, kind: "view" | "angle", id: string, file: string): Promise<void> {
  const view = VIEWS.find((v) => v.id === id);
  if (kind === "view" && view && !view.face) {
    const full = file.replace(/\.png$/i, "_full.png");
    copyFileSync(file, full);
    await face.cropBody(full, file);
  }
}

async function judge(face: FaceTool, refFile: string, item: Item, t: Try, file: string, th: Thresholds): Promise<{ regenerate: boolean }> {
  if (item.kind === "angle") {
    t.light = "grey";
    t.text = "Location: judge by eye (no face check).";
    return { regenerate: false };
  }
  const fr = (await face.compare(refFile, [file])).results[0];
  const c = classify(item.id as ViewId, fr, th);
  t.score = fr.score;
  t.light = c.light;
  t.text = c.text;
  const view = VIEWS.find((v) => v.id === item.id)!;
  item.angle_note = angleNote(view, fr.yaw);
  return { regenerate: c.regenerate };
}

export type MakeResult = { spentUsd: number; made: number; notDownloaded: number; skippedForCap: number; summary: string };

// Makes the pack (all views or angles) or only some of them (`only`: remake those), within `cap` dollars.
export async function makePictures(ws: Workspace, cardId: string, deps: GenDeps, o: { cap: number; only?: string[] }): Promise<MakeResult> {
  const row = getCard(ws, cardId);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = currentVersion(file);
  if (v.status === "locked") throw new Error(`Version ${v.n} is locked: start a new version to change it.`);
  const dir = versionDir(root, v.n);
  mkdirSync(dir, { recursive: true });
  const m = MODELS[v.model];
  const th = cardThresholds(root);
  const report: VersionReport = readReport(dir) ?? { updated_at: "", model: v.model, endpoint: m.endpoint, thresholds: th, items: [], request_ids: [], spent_usd: 0 };
  report.model = v.model;
  report.endpoint = m.endpoint;
  report.thresholds = th;
  const log = deps.log ?? (() => {});
  const budget = new Budget(o.cap);
  const callOpts = { timeoutMs: deps.timeoutMs ?? 10 * 60_000, pollMs: deps.pollMs ?? 3000, log, sleep: deps.sleep };

  const refs = referenceFiles(root, file);
  const refFile = refs[0];
  const mime = (f: string) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
  log("Uploading the picture to fal storage…");
  const refUrls: string[] = [];
  for (const f of refs) refUrls.push(await deps.fal.storage.upload(new File([readFileSync(f)], path.basename(f), { type: mime(f) })));

  type Job = { id: string; label: string; kind: "view" | "angle"; prompt: string; aspect: "3:4" | "2:3" };
  const all: Job[] =
    file.kind === "character"
      ? VIEWS.map((x) => ({ id: x.id, label: x.label, kind: "view" as const, prompt: viewPrompt(x, v.outfit), aspect: x.aspect }))
      : ANGLES.map((a) => ({ id: a.id, label: a.label, kind: "angle" as const, prompt: anglePrompt(a, v.props), aspect: "3:4" as const }));
  const jobs = o.only?.length ? all.filter((j) => o.only!.includes(j.id)) : all;
  if (!jobs.length) throw new Error("Nothing to make.");

  // The description draft (once, on a full pack, unless one is already written).
  let descriptionP: Promise<void> = Promise.resolve();
  if (!o.only?.length && !v.description && budget.canSpend(VISION.perCallUsd)) {
    budget.spend(VISION.perCallUsd);
    descriptionP = callModel(deps.fal, VISION.endpoint, { prompt: file.kind === "character" ? DESCRIPTION_PROMPT : SCENE_DESCRIPTION_PROMPT, image_urls: [refUrls[0]], model: VISION.model }, callOpts)
      .then((r) => {
        report.request_ids.push(r.requestId);
        report.description_request = r.requestId;
        const text = String(r.data.output ?? "").trim();
        if (text) {
          const f = readCardFile(root);
          const cur = currentVersion(f);
          if (!cur.description && cur.status === "draft") {
            cur.description = text;
            writeCardFile(root, f);
          }
        }
      })
      .catch((e) => log(`description draft not made (${errorText(e)})`));
  }

  let made = 0;
  let notDownloaded = 0;
  let skippedForCap = 0;
  let done = 0;
  for (const job of jobs) {
    if (deps.shouldStop?.()) break;
    deps.progress?.(done, jobs.length, job.label);
    let item = report.items.find((i) => i.id === job.id);
    if (!item) {
      item = { id: job.id, label: job.label, kind: job.kind, tries: [], chosen: null, light: null, text: "" };
      report.items.push(item);
    }
    const first = item.tries.length;
    for (let k = 0; k <= (job.kind === "view" ? RETRIES : 0); k++) {
      if (!budget.canSpend(m.perImageUsd)) {
        skippedForCap++;
        item.text = `${item.chosen === null ? "Not made" : item.text}: the cap of ${money(o.cap)} was reached.`;
        break;
      }
      budget.spend(m.perImageUsd);
      const n = first + k + 1;
      const seed = 1000 + n;
      const t: Try = { file: null, request_id: null, score: null, light: null, text: "", attempts: [], seed };
      item.tries.push(t);
      try {
        log(`${m.name} · ${job.label}${n > 1 ? ` (try ${n})` : ""}…`);
        const r = await callModel(deps.fal, m.endpoint, m.input(job.prompt, file.kind === "character" ? refUrls : [refUrls[0]], job.aspect, seed), callOpts);
        t.attempts = r.attempts;
        t.request_id = r.requestId;
        report.request_ids.push(r.requestId);
        t.url = firstImageUrl(r.data);
      } catch (error) {
        t.attempts = (error as { attempts?: Attempt[] }).attempts ?? t.attempts;
        for (const a of t.attempts) if (a.request_id && !report.request_ids.includes(a.request_id)) report.request_ids.push(a.request_id);
        t.text = `Failed: ${errorText(error)}`;
        continue;
      }
      const name = `${job.id}_t${n}.png`;
      try {
        await download(t.url, path.join(dir, name), (f, d) => writeFileSync(f, d), deps.sleep);
      } catch (error) {
        notDownloaded++;
        t.text = `Made but not downloaded (${errorText(error)}): "Get missing pictures" fetches it at no cost.`;
        break; // a paid picture is never made again
      }
      t.file = name;
      made++;
      await finishPicture(deps.face, job.kind, job.id, path.join(dir, name));
      const { regenerate } = await judge(deps.face, refFile, item, t, path.join(dir, name), th);
      log(`${m.name} · ${job.label}: ${t.light}${regenerate && k < RETRIES ? " (making it again)" : ""}`);
      if (!regenerate) break;
    }
    choose(item, dir);
    if (item.chosen === null && !item.text) item.text = item.tries[item.tries.length - 1]?.text ?? "";
    done++;
    writeReport(dir, report);
  }
  await descriptionP;
  report.spent_usd = Math.round((report.spent_usd + budget.spent) * 100) / 100;
  writeReport(dir, report);
  await buildSheet(deps.face, root, readCardFile(root), report);
  deps.progress?.(jobs.length, jobs.length, "done");
  const summary = summarize(file, report, { made, notDownloaded, skippedForCap, spent: budget.spent });
  return { spentUsd: budget.spent, made, notDownloaded, skippedForCap, summary };
}

// Pictures that were made (paid) but not downloaded: fetched again by URL, or by request ID from fal's queue. Free.
export async function fetchMissing(ws: Workspace, cardId: string, deps: GenDeps): Promise<MakeResult> {
  const row = getCard(ws, cardId);
  const root = cardRoot(ws, row);
  const file = readCardFile(root);
  const v = currentVersion(file);
  const dir = versionDir(root, v.n);
  const report = readReport(dir);
  if (!report) throw new Error("Nothing was made yet.");
  const refFile = referenceFiles(root, file)[0];
  let made = 0;
  let missing = 0;
  for (const item of report.items) {
    item.tries.forEach((t, k) => (t.seed ??= 1000 + k + 1));
    for (let k = 0; k < item.tries.length; k++) {
      const t = item.tries[k];
      if (t.file || !t.request_id || !/not downloaded/.test(t.text)) continue;
      const name = `${item.id}_t${k + 1}.png`;
      try {
        if (!t.url) t.url = firstImageUrl((await deps.fal.queue.result(report.endpoint, { requestId: t.request_id })).data as Record<string, unknown>);
        await download(t.url, path.join(dir, name), (f, d) => writeFileSync(f, d), deps.sleep);
      } catch (error) {
        missing++;
        t.text = `Made but not downloaded (${errorText(error)}): try "Get missing pictures" again later.`;
        continue;
      }
      t.file = name;
      made++;
      await finishPicture(deps.face, item.kind, item.id, path.join(dir, name));
      await judge(deps.face, refFile, item, t, path.join(dir, name), report.thresholds);
    }
    choose(item, dir);
  }
  writeReport(dir, report);
  await buildSheet(deps.face, root, file, report);
  return { spentUsd: 0, made, notDownloaded: missing, skippedForCap: 0, summary: made ? `Got ${made} missing picture(s), at no cost.${missing ? ` ${missing} still missing.` : ""}` : missing ? `${missing} picture(s) still not downloadable: try again later.` : "Nothing was missing." };
}

const WORD: Record<Light, string> = { green: "same person", amber: "check by eye", red: "drifted", grey: "judge by eye" };

// The contact sheet: the picture + the chosen views (with their face scores) or angles.
export async function buildSheet(face: FaceTool, root: string, file: CardFile, report: VersionReport): Promise<string | null> {
  const v = currentVersion(file);
  const dir = versionDir(root, v.n);
  const order = file.kind === "character" ? VIEWS.map((x) => x.id) : ANGLES.map((x) => x.id);
  const items = order.map((id) => report.items.find((i) => i.id === id)).filter((i): i is Item => !!i);
  try {
    const out = path.join(dir, "sheet.jpg");
    await face.sheet({
      out,
      title: `${file.name} v${v.n}: ${MODELS[v.model].name}${file.kind === "character" ? ` · green >= ${report.thresholds.green_from}, red < ${report.thresholds.red_below}` : ""}`,
      rows: [
        {
          label: file.name,
          cells: [
            { file: path.join(root, file.reference), caption: file.kind === "character" ? "Reference" : "Location picture", colour: "grey" },
            ...items.map((i) => {
              const t = i.chosen === null ? null : i.tries[i.chosen];
              const score = t?.score === null || t?.score === undefined ? "" : `${t.score.toFixed(2)} `;
              return { file: existsSync(path.join(dir, `${i.id}.png`)) ? path.join(dir, `${i.id}.png`) : "", caption: `${i.label}\n${t ? `${score}${WORD[i.light ?? "grey"]}` : "not made"}`, colour: i.light ?? "grey" };
            }),
          ],
        },
      ],
    });
    return out;
  } catch {
    return null; // the sheet is a convenience: the pictures and the report are there
  }
}

export function summarize(file: CardFile, report: VersionReport, r: { made: number; notDownloaded: number; skippedForCap: number; spent: number }): string {
  const faces = report.items.filter((i) => VIEWS.find((x) => x.id === i.id)?.face);
  const greens = faces.filter((i) => i.light === "green").length;
  const parts = [
    `${r.made} picture(s) made`,
    file.kind === "character" && faces.length ? `${greens} of ${faces.length} face views green` : "",
    r.notDownloaded ? `${r.notDownloaded} not downloaded ("Get missing pictures" fetches them free)` : "",
    r.skippedForCap ? `${r.skippedForCap} stopped by the cost cap` : "",
    `about ${money(r.spent)} sent`,
  ].filter(Boolean);
  return parts.join(" · ");
}
