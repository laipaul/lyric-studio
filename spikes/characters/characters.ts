// Characters, C1 spike: one picture in -> reference check, a 4-view character pack and 3 scene angles from several
// fal.ai image models, each view face-checked locally against the picture (drifted views made again), contact sheets
// and a report with the actual cost. Not part of the app: it only reads the workspace (database read-only).
//
//   pnpm characters calibrate --image "<bride.jpg>" --song "Wedding Day"      (or --others "<folder or files>")
//                        [--her "<clip name>"]   (repeatable; clips of her: a part of the file name is enough)
//   pnpm characters pack --image "<bride.jpg>" --scene "<room.jpg>" [--name bride] [--outfit "<outfit in your words>"]
//                        [--views all|face|body] [--models seedream (default) | nano-pro,nano2,seedream,gpt]
//                        [--image2 "<second.jpg>"] [--crop] [--ai-opinion] [--max-cost 3] [--force] [--yes]
//   pnpm characters cost "<run folder>"                                         (the actual cost, again, later)
//   pnpm characters fetch "<run folder>"       (downloads images that fal made but that could not be downloaded; no new
//                                               generation, no cost; face-checks them and updates the report and sheets)
//
// Results: spikes\characters\out\<name>\ (calibration) and spikes\characters\out\<name>\<date_time>\ (each pack run).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { FalClient } from "@fal-ai/client";

import { envIgnored, loadEnv, REPO_ROOT, songClipsFolder, workspaceDir } from "./src/env";
import { localFaceTool, type CheckResult, type FaceTool } from "./src/face";
import { actualCosts, callModel, download, errorText, firstImageUrl, type ActualCost, type Attempt } from "./src/fal";
import {
  angleNote, anglePrompt, ANGLES, Budget, classify, DEFAULT_THRESHOLDS, DESCRIPTION_PROMPT, estimate, MODEL_IDS, MODELS, money, OPINION_PROMPT,
  safeName, SCENE_DESCRIPTION_PROMPT, VIEWS, viewPrompt, viewsFor, VISION, DEFAULT_MODELS, type Light, type ModelId, type Thresholds, type ViewId, type ViewSet,
} from "./src/plan";

export class Stop extends Error {}

const OUT_DEFAULT = path.join(REPO_ROOT, "spikes", "characters", "out");
const RETRIES = 2; // a drifted view is made again at most twice

export type Deps = {
  fal?: FalClient;
  face?: FaceTool;
  out?: string;
  env?: Record<string, string>;
  fetch?: typeof fetch;
  now?: () => Date;
  billingWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function options(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      image: { type: "string" },
      image2: { type: "string" },
      scene: { type: "string" },
      name: { type: "string" },
      song: { type: "string" },
      others: { type: "string", multiple: true },
      her: { type: "string", multiple: true },
      models: { type: "string" },
      outfit: { type: "string" },
      views: { type: "string" },
      "max-cost": { type: "string" },
      "timeout-min": { type: "string" },
      crop: { type: "boolean", default: false },
      "ai-opinion": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [command, ...rest] = positionals;
  const models = (values.models ?? DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = models.filter((m) => !(MODEL_IDS as readonly string[]).includes(m));
  if (bad.length) throw new Stop(`Unknown model "${bad.join(", ")}": use ${MODEL_IDS.join(", ")}.`);
  const views = (values.views ?? "all").trim().toLowerCase();
  if (!["all", "face", "body"].includes(views)) throw new Stop(`--views takes all, face or body (got "${values.views}").`);
  const cap = Number(values["max-cost"] ?? 3);
  if (!Number.isFinite(cap) || cap < 0) throw new Stop("--max-cost takes a number of dollars, e.g. --max-cost 5");
  const image = values.image ? path.resolve(values.image) : undefined;
  return {
    command,
    rest,
    image,
    image2: values.image2 ? path.resolve(values.image2) : undefined,
    scene: values.scene ? path.resolve(values.scene) : undefined,
    name: safeName(values.name ?? (image ? path.parse(image).name : "character")),
    song: values.song,
    others: (values.others ?? []).map((o) => path.resolve(o)),
    her: values.her ?? [],
    models: models as ModelId[],
    outfit: values.outfit?.trim() || undefined,
    views: views as ViewSet,
    cap,
    timeoutMs: Number(values["timeout-min"] ?? 10) * 60_000,
    crop: values.crop,
    aiOpinion: values["ai-opinion"],
    force: values.force,
    yes: values.yes,
  };
}
type Opts = ReturnType<typeof options>;

const need = (file: string | undefined, what: string): string => {
  if (!file) throw new Stop(`Which ${what}? --${what === "picture" ? "image" : what} "<path>"`);
  if (!existsSync(file)) throw new Stop(`Not found: ${file}`);
  return file;
};

function printCheck(title: string, r: CheckResult): void {
  console.log(`\n${title}: ${r.verdict}`);
  for (const x of r.reasons) console.log(`  ${x.level === "ok" ? "✓" : x.level === "info" ? "·" : x.level === "fix" ? "!" : "✗"} ${x.text}`);
}

// ---------------------------------------------------------------- calibrate

async function calibrate(o: Opts, face: FaceTool, out: string, env: Record<string, string>): Promise<void> {
  const ref = need(o.image, "picture");
  let others = o.others;
  if (o.song) others = [...others, songClipsFolder(workspaceDir(env), o.song).clips];
  if (!others.length) throw new Stop('Compare with whom? --song "Wedding Day" (its clips) or --others "<folder or files>"');
  const refCheck = face.check(ref);
  printCheck(`Reference check (${path.basename(ref)})`, refCheck);
  if (refCheck.verdict === "Not suitable" && !o.force)
    throw new Stop("\nThe reference is not suitable (see above): nothing was calibrated. Use another picture, or --force to try anyway.");
  console.log(`Calibrating on ${path.basename(ref)} against ${others.map((x) => path.basename(x)).join(", ")} (local, free)…`);
  const c = face.calibrate(ref, others, o.her);
  const dir = path.join(out, o.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "calibration.json"), `${JSON.stringify({ ...c, created_at: new Date().toISOString() }, null, 2)}\n`);
  const md = calibrationMarkdown(c);
  writeFileSync(path.join(dir, "calibration.md"), md);
  console.log(`\n${md}`);
  console.log(`Saved: ${path.join(dir, "calibration.json")} (the pack run for --name ${o.name} uses it)`);
}

export function calibrationMarkdown(c: ReturnType<FaceTool["calibrate"]>): string {
  const t = c.thresholds;
  const lines = [
    `# Face calibration: ${path.basename(c.reference)}`,
    "",
    "SFace score = how alike two faces are (cosine similarity; 1 = identical picture). SFace's own line for \"same person\" is 0.363.",
    "",
    "## The same picture, changed (mirror, size, light, tilt, compression, blur)",
    ...c.same_picture.map((s) => `- ${s.variant}: ${s.score ?? "no face found"}`),
    "",
    "## Clips (best face per clip)",
    "| Clip | Faces seen | Best score | Mean | |",
    "|---|---|---|---|---|",
    ...c.others.map((r) => `| ${path.basename(r.file)} | ${r.faces} (in ${r.frames} frames) | ${r.best ?? "–"} | ${r.mean ?? "–"} | ${r.role === "her" ? "**her** (marked by you)" : r.role === "copy" ? "**copy of the reference** (left out)" : ""} |`),
    "",
    "## Thresholds for the pack",
    `- **Green (same person): ${t.green_from}** or more`,
    `- **Amber (check by eye):** ${t.red_below} – ${t.green_from}`,
    `- **Red (drifted, made again): below ${t.red_below}**`,
    `- Based on ${t.others_used} other clip(s); the best other person scored ${t.top_other}.${t.her_used && t.her_range ? ` Your marked clip(s) of her score ${t.her_range[0]}–${t.her_range[1]}.` : ""}${t.copies ? ` ${t.copies} clip(s) look like the reference picture itself and were left out.` : ""}`,
    ...(t.note ? [`- Note: ${t.note}`] : []),
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- pack

type ViewReport = {
  model: ModelId;
  kind: "view" | "angle";
  id: string;
  label: string;
  file: string | null;
  tries: { file: string | null; request_id: string | null; url?: string | null; score: number | null; light: Light | null; text: string; attempts: Attempt[]; seed: number }[];
  chosen: number | null;
  light: Light | null;
  text: string;
  angle_note?: string | null;
};

function thresholdsFor(dir: string): Thresholds {
  const f = path.join(dir, "calibration.json");
  if (!existsSync(f)) return DEFAULT_THRESHOLDS;
  const t = (JSON.parse(readFileSync(f, "utf8")) as { thresholds: { red_below: number; green_from: number }; created_at?: string }).thresholds;
  return { red_below: t.red_below, green_from: t.green_from, source: "calibrated on your pictures (calibration.json)" };
}

// Contact sheets (made locally). `items` carry absolute file paths.
function buildSheets(face: FaceTool, dir: string, name: string, models: ModelId[], items: ViewReport[], refFile: string, sceneFile: string | null, t: Thresholds): Record<"pack" | "location", string | null> {
  const word: Record<Light, string> = { green: "same person", amber: "check by eye", red: "drifted", grey: "judge by eye" };
  const cap = (r: ViewReport) => {
    if (r.kind === "angle" || !r.file) return `${r.label}\n${r.file ? "judge by eye" : "not made"}`;
    const sc = r.tries[r.chosen ?? 0]?.score;
    return `${r.label}\n${sc === null || sc === undefined ? "" : `${sc.toFixed(2)} `}${word[r.light ?? "grey"]}${r.tries.length > 1 ? ` (${r.tries.length} tries)` : ""}`;
  };
  const sheets: Record<"pack" | "location", string | null> = { pack: null, location: null };
  try {
    sheets.pack = face.sheet({
      out: path.join(dir, "sheet_pack.jpg"),
      title: `${name}: character pack (outdoor daylight); face views scored vs the reference (green >= ${t.green_from}, red < ${t.red_below}); body views cropped at the neck`,
      rows: models.map((m) => ({
        label: MODELS[m].name,
        cells: [
          { file: refFile, caption: "Reference", colour: "grey" },
          ...items.filter((r) => r.model === m && r.kind === "view").map((r) => ({ file: r.file ?? "", caption: cap(r), colour: r.light ?? "grey" })),
        ],
      })),
    }).file;
    if (sceneFile)
      sheets.location = face.sheet({
        out: path.join(dir, "sheet_location.jpg"),
        title: `${name}: location angles`,
        rows: models.map((m) => ({
          label: MODELS[m].name,
          cells: [
            { file: sceneFile, caption: "Location picture", colour: "grey" },
            ...items.filter((r) => r.model === m && r.kind === "angle").map((r) => ({ file: r.file ?? "", caption: cap(r), colour: "grey" })),
          ],
        })),
      }).file;
  } catch (error) {
    console.log(`  (contact sheet not made: ${errorText(error)})`);
  }
  return sheets;
}

// Body views are cropped at the neck here, locally and for free, whatever the model did: faces only ever come from the
// face views. The model's own picture is kept next to it as <view>_full.png.
function cropBodyView(face: FaceTool, file: string): void {
  const full = file.replace(/\.png$/i, "_full.png");
  copyFileSync(file, full);
  face.cropBody(full, file);
}

async function pack(o: Opts, deps: Deps, face: FaceTool, out: string, env: Record<string, string>): Promise<void> {
  const ref = need(o.image, "picture");
  const refCheck = face.check(ref);
  printCheck(`Reference check (${path.basename(ref)})`, refCheck);
  const ref2Check = o.image2 ? face.check(need(o.image2, "image2")) : null;
  if (ref2Check) printCheck(`Second reference (${path.basename(o.image2!)})`, ref2Check);
  const sceneCheck = o.scene ? face.sceneCheck(need(o.scene, "scene")) : null;
  if (sceneCheck) printCheck(`Location picture (${path.basename(o.scene!)})`, sceneCheck);
  if (refCheck.verdict === "Not suitable" && !o.force)
    throw new Stop("\nThe reference is not suitable (see above): nothing was generated. Use another picture, or --force to try anyway.");
  if (refCheck.fixes?.length) {
    const hints: Record<string, string> = { crop: "--crop (crop to the face)", upscale: "upscale (the upscale pass is a later step; a larger picture works now)", second_image: '--image2 "<another picture of her>"' };
    console.log(`  Fixes: ${refCheck.fixes.map((f) => hints[f] ?? f).join(" · ")}`);
  }

  const charDir = path.join(out, o.name);
  const t = thresholdsFor(charDir);
  console.log(`\nFace thresholds: green ≥ ${t.green_from}, red < ${t.red_below} (${t.source})`);

  const visionCalls = 1 + (o.scene ? 1 : 0) + (o.aiOpinion ? 1 : 0);
  const chosenViews = viewsFor(o.views);
  if (!o.outfit && chosenViews.some((v) => !v.face))
    console.log('\nTip: add --outfit "<the outfit in your words>": your picture shows only part of it, and without it each model invents the rest.');
  const est = estimate(o.models, { views: chosenViews.length, angles: o.scene ? ANGLES.length : 0, retries: RETRIES, vision: visionCalls });
  console.log(`\nEstimate (${chosenViews.length} ${o.views === "all" ? "" : `${o.views} `}views${o.scene ? ` + ${ANGLES.length} location angles` : ""} per model):`);
  for (const m of est.perModel) console.log(`  ${MODELS[m.id].name.padEnd(16)} ${m.images} images  ${money(m.usd)}   (${MODELS[m.id].priceNote})`);
  console.log(`  ${"Descriptions".padEnd(16)} ${visionCalls} call(s)  ${money(est.visionUsd)}   (${VISION.model}, $0.01 per call)`);
  console.log(`  Total ${money(est.baseUsd)}; up to ${money(est.worstUsd)} if every view drifts twice. Cap ${money(o.cap)}: retries stop at the cap.`);
  if (est.baseUsd > o.cap) throw new Stop(`\nThe estimate (${money(est.baseUsd)}) is above the cap of ${money(o.cap)}: nothing was uploaded. Use fewer models (--models nano2,seedream) or raise the cap (--max-cost ${Math.ceil(est.baseUsd + 1)}).`);
  if (!o.yes) {
    console.log("\nNothing was uploaded. Add --yes to run it.");
    return;
  }

  const key = env.FAL_KEY?.trim() ?? "";
  const fal = await falClient(deps, key);

  const now = deps.now ?? (() => new Date());
  const started = now();
  const stamp = started.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  let dir = path.join(charDir, stamp);
  for (let n = 2; existsSync(dir); n++) dir = path.join(charDir, `${stamp} (${n})`);
  mkdirSync(dir, { recursive: true });

  let refFile = path.join(dir, `reference${path.extname(ref).toLowerCase() || ".jpg"}`);
  copyFileSync(ref, refFile);
  if (o.crop) {
    const cropped = path.join(dir, "reference_cropped.jpg");
    face.crop(refFile, cropped);
    refFile = cropped;
    console.log("Cropped the reference to the face: reference_cropped.jpg");
  }
  const ref2File = o.image2 ? path.join(dir, `reference2${path.extname(o.image2).toLowerCase() || ".jpg"}`) : null;
  if (ref2File) copyFileSync(o.image2!, ref2File);
  const sceneFile = o.scene ? path.join(dir, `location${path.extname(o.scene).toLowerCase() || ".jpg"}`) : null;
  if (sceneFile) copyFileSync(o.scene!, sceneFile);

  const mime = (f: string) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
  const up = (f: string) => fal.storage.upload(new File([readFileSync(f)], path.basename(f), { type: mime(f) }));
  console.log("\nUploading the pictures to fal storage…");
  const refUrls = [await up(refFile), ...(ref2File ? [await up(ref2File)] : [])];
  const sceneUrl = sceneFile ? await up(sceneFile) : null;

  const budget = new Budget(o.cap);
  const requestIds: string[] = [];
  const callOpts = { timeoutMs: o.timeoutMs, pollMs: 3000, log: (m: string) => console.log(`  ${m}`) };

  // Descriptions (and the optional opinion) in parallel with the images.
  const vision = async (prompt: string, url: string): Promise<{ text: string | null; request_id: string | null; error?: string }> => {
    if (!budget.canSpend(VISION.perCallUsd)) return { text: null, request_id: null, error: "skipped: the cap was reached" };
    budget.spend(VISION.perCallUsd);
    try {
      const r = await callModel(fal, VISION.endpoint, { prompt, image_urls: [url], model: VISION.model }, callOpts);
      requestIds.push(r.requestId);
      return { text: String(r.data.output ?? "").trim(), request_id: r.requestId };
    } catch (error) {
      return { text: null, request_id: null, error: errorText(error) };
    }
  };
  const descriptionsP = Promise.all([
    vision(DESCRIPTION_PROMPT, refUrls[0]),
    sceneUrl ? vision(SCENE_DESCRIPTION_PROMPT, sceneUrl) : Promise.resolve(null),
    o.aiOpinion ? vision(OPINION_PROMPT, refUrls[0]) : Promise.resolve(null),
  ]);

  const one = async (model: ModelId, kind: "view" | "angle", id: string, label: string, prompt: string, refs: string[], aspect: "3:4" | "2:3"): Promise<ViewReport> => {
    const m = MODELS[model];
    const sub = path.join(dir, kind === "view" ? model : path.join("location", model));
    mkdirSync(sub, { recursive: true });
    const rep: ViewReport = { model, kind, id, label, file: null, tries: [], chosen: null, light: null, text: "" };
    for (let k = 0; k <= (kind === "view" ? RETRIES : 0); k++) {
      if (!budget.canSpend(m.perImageUsd)) {
        rep.text = rep.tries.length ? `${rep.text} Not made again: the cap of ${money(o.cap)} was reached.` : `Skipped: the cap of ${money(o.cap)} was reached.`;
        break;
      }
      budget.spend(m.perImageUsd);
      const seed = 1000 + k;
      const file = path.join(sub, `${id}${k ? `_try${k + 1}` : ""}.png`);
      const tr: ViewReport["tries"][number] = { file: null, request_id: null, score: null, light: null, text: "", attempts: [], seed };
      rep.tries.push(tr);
      try {
        console.log(`  ${m.name}: ${label}${k ? ` (try ${k + 1})` : ""}…`);
        const r = await callModel(fal, m.endpoint, m.input(prompt, refs, aspect, seed), callOpts);
        tr.attempts = r.attempts;
        tr.request_id = r.requestId;
        requestIds.push(r.requestId);
        tr.url = firstImageUrl(r.data);
      } catch (error) {
        tr.attempts = (error as { attempts?: Attempt[] }).attempts ?? tr.attempts;
        for (const a of tr.attempts) if (a.request_id && !requestIds.includes(a.request_id)) requestIds.push(a.request_id);
        tr.text = `Failed: ${errorText(error)}`;
        rep.text = tr.text;
        continue;
      }
      try {
        await download(tr.url, file, (f, d) => writeFileSync(f, d), deps.sleep);
        tr.file = file;
      } catch (error) {
        // The model call worked (and was paid): never generate it again, `fetch` can still get it.
        const reason = errorText(error).replace(/^the image could not be downloaded \((.*)\)$/, "$1");
        tr.text = `Generated but not downloaded (${reason}): run pnpm characters fetch "${dir}" to get it`;
        console.log(`    ${tr.text}`);
        rep.text = rep.chosen === null ? tr.text : `${rep.text} Another try was made but not downloaded: run pnpm characters fetch "${dir}".`;
        break;
      }
      if (kind === "angle") {
        rep.file = file;
        rep.chosen = 0;
        rep.light = "grey";
        rep.text = "Location: judge by eye (no face check).";
        break;
      }
      const view = VIEWS.find((v) => v.id === id)!;
      if (!view.face) cropBodyView(face, file);
      const fr = face.compare(refFile, [file]).results[0];
      const c = classify(id as ViewId, fr, t);
      tr.score = fr.score;
      tr.light = c.light;
      tr.text = c.text;
      // Keep the best try: by result first (green, then amber / a body view with no face, then red), then by score.
      const rank = (l: Light | null) => (l === "green" ? 3 : l === "amber" || l === "grey" ? 2 : 0);
      const prev = rep.chosen === null ? null : rep.tries[rep.chosen];
      const better = !prev || rank(c.light) > rank(prev.light) || (rank(c.light) === rank(prev.light) && (fr.score ?? -1) > (prev.score ?? -1));
      if (better) {
        rep.chosen = rep.tries.length - 1;
        rep.file = file;
        rep.light = c.light;
        rep.text = c.text;
        rep.angle_note = angleNote(view, fr.yaw);
      }
      const why = c.regenerate && k < RETRIES ? (view.face ? ": drifted, making it again" : ": a face still shows, making it again") : "";
      console.log(`    ${m.name} · ${label}${k ? ` (try ${k + 1})` : ""}: ${view.face ? `face ${fr.score ?? "–"}` : "body"} → ${c.light}${why}`);
      if (!c.regenerate) break;
    }
    if (rep.tries.length > 1 && rep.chosen !== null) rep.text = `${rep.text} (best of ${rep.tries.length} tries)`;
    return rep;
  };

  console.log(`\nGenerating with ${o.models.map((m) => MODELS[m].name).join(", ")}…`);
  const perModel = await Promise.all(
    o.models.map(async (model) => {
      const out: ViewReport[] = [];
      for (const v of chosenViews) out.push(await one(model, "view", v.id, v.label, viewPrompt(v, o.outfit), refUrls, v.aspect));
      if (sceneUrl) for (const a of ANGLES) out.push(await one(model, "angle", a.id, a.label, anglePrompt(a), [sceneUrl], "3:4"));
      return out;
    }),
  );
  const items = perModel.flat();
  const [desc, sceneDesc, opinion] = await descriptionsP;
  if (desc?.text) writeFileSync(path.join(dir, "description.txt"), `${desc.text}\n`);
  if (sceneDesc?.text) writeFileSync(path.join(dir, "location-description.txt"), `${sceneDesc.text}\n`);

  // Contact sheets (made locally).
  const sheets = buildSheets(face, dir, o.name, o.models, items, refFile, sceneFile, t);

  // The actual charge per request, from fal (when the key may read billing).
  let actual: ActualCost = { status: "failed", message: "not asked" };
  if (key && requestIds.length) {
    console.log("\nAsking fal for the actual cost…");
    const startIso = new Date(started.getTime() - 5 * 60_000).toISOString();
    const wait = deps.billingWaitMs ?? 20_000;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, wait));
      actual = await actualCosts(key, requestIds, startIso, deps.fetch ?? fetch);
      if (actual.status !== "ok" || !actual.missing.length) break;
    }
  }

  const report = {
    created_at: started.toISOString(),
    name: o.name,
    reference: { file: path.basename(refFile), cropped: o.crop, check: refCheck },
    reference2: ref2Check ? { file: path.basename(ref2File!), check: ref2Check } : null,
    location: sceneCheck ? { file: path.basename(sceneFile!), check: sceneCheck } : null,
    thresholds: t,
    outfit: o.outfit ?? null,
    views: o.views,
    models: o.models.map((m) => ({ id: m, name: MODELS[m].name, endpoint: MODELS[m].endpoint, price: MODELS[m].priceNote })),
    items: items.map((r) => ({ ...r, file: r.file ? path.relative(dir, r.file) : null, tries: r.tries.map((x) => ({ ...x, file: x.file ? path.relative(dir, x.file) : null })) })),
    descriptions: { character: desc, location: sceneDesc, opinion },
    sheets: { pack: sheets.pack ? path.basename(sheets.pack) : null, location: sheets.location ? path.basename(sheets.location) : null },
    cost: { cap_usd: o.cap, estimate_base_usd: round2(est.baseUsd), estimate_spent_usd: round2(budget.spent), request_ids: requestIds, actual },
  };
  writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(dir, "report.md"), packMarkdown(report));
  console.log(`\n${packMarkdown(report)}`);
  console.log(`→ ${dir}`);
}

async function falClient(deps: Deps, key: string): Promise<FalClient> {
  if (deps.fal) return deps.fal;
  if (!envIgnored()) throw new Stop(".env is not in .gitignore: add a line `.env` there first, so your fal key never goes to git.");
  if (!key) throw new Stop("No FAL_KEY in .env: add a line FAL_KEY=<your key from fal.ai → Dashboard → API keys> to D:\\videomaker\\.env.");
  let create: typeof import("@fal-ai/client").createFalClient;
  try {
    ({ createFalClient: create } = await import("@fal-ai/client"));
  } catch {
    throw new Stop("The fal client is not installed yet. First time only: cd spikes\\characters; npm install; cd ..\\..");
  }
  return create({ credentials: key, suppressLocalCredentialsWarning: true });
}

const round2 = (x: number) => Math.round(x * 100) / 100;

type PackReport = {
  name: string;
  reference: { file: string; cropped: boolean; check: CheckResult };
  reference2: { file: string; check: CheckResult } | null;
  location: { file: string; check: CheckResult } | null;
  thresholds: Thresholds;
  outfit?: string | null;
  views?: string;
  models: { id: ModelId; name: string; endpoint: string; price: string }[];
  items: ViewReport[];
  descriptions: { character: { text: string | null; error?: string } | null; location: { text: string | null } | null; opinion: { text: string | null } | null };
  sheets: { pack: string | null; location: string | null };
  cost: { cap_usd: number; estimate_base_usd: number; estimate_spent_usd: number; request_ids: string[]; actual: ActualCost };
};

export function actualTotal(a: ActualCost): number | null {
  return a.status === "ok" ? round2(Object.values(a.byRequest).reduce((s, x) => s + x, 0)) : null;
}

export function packMarkdown(r: PackReport): string {
  const L: string[] = [`# Character pack: ${r.name}`, ""];
  const check = (title: string, c: CheckResult) => [`**${title}: ${c.verdict}**`, ...c.reasons.filter((x) => x.level !== "ok").map((x) => `- ${x.text}`), ""];
  L.push(...check(`Reference check (${r.reference.file}${r.reference.cropped ? ", cropped to the face" : ""})`, r.reference.check));
  if (r.reference2) L.push(...check(`Second reference (${r.reference2.file})`, r.reference2.check));
  if (r.location) L.push(...check(`Location picture (${r.location.file})`, r.location.check));
  L.push(`Face scores: green ≥ ${r.thresholds.green_from}, red < ${r.thresholds.red_below} (${r.thresholds.source}).`, "");
  if (r.outfit !== undefined) L.push(r.outfit ? `Outfit (yours): ${r.outfit}` : "Outfit: not given, so each model invented what the reference does not show (use --outfit).", "");
  L.push("Body views are cropped at the neck by the app (the model's own picture is kept as <view>_full.png).", "");
  const dot: Record<string, string> = { green: "🟢", amber: "🟠", red: "🔴", grey: "⚪" };
  for (const m of r.models) {
    const mine = r.items.filter((i) => i.model === m.id);
    const views = mine.filter((i) => i.kind === "view");
    const faceIds = new Set<string>(VIEWS.filter((v) => v.face).map((v) => v.label));
    const faceViews = views.filter((v) => faceIds.has(v.label));
    const greens = faceViews.filter((v) => v.light === "green").length;
    const bodies = views.length - faceViews.length;
    const parts = [faceViews.length ? `${greens} of ${faceViews.length} face views green` : "", bodies ? `${bodies} body views to judge by eye` : ""].filter(Boolean);
    L.push(`## ${m.name} — ${parts.join(" · ")}`, `\`${m.endpoint}\` · ${m.price}`, "");
    L.push("| View | Face | Result | Tries |", "|---|---|---|---|");
    for (const v of views) {
      const best = Math.max(...v.tries.map((x) => x.score ?? -1));
      L.push(`| ${v.label} | ${best >= 0 ? best.toFixed(2) : "–"} | ${dot[v.light ?? "grey"]} ${v.text}${v.angle_note ? ` Angle: ${v.angle_note}.` : ""} | ${v.tries.length} |`);
    }
    const angles = mine.filter((i) => i.kind === "angle");
    if (angles.length) L.push("", `Location angles: ${angles.map((a) => `${a.label} ${a.file ? "✓" : `(${a.text})`}`).join(" · ")}`);
    L.push("");
  }
  if (r.descriptions.character?.text) L.push("## Draft description (edit it before locking)", "", r.descriptions.character.text, "");
  else if (r.descriptions.character?.error) L.push(`Draft description: not made (${r.descriptions.character.error}).`, "");
  if (r.descriptions.location?.text) L.push("## Draft location description", "", r.descriptions.location.text, "");
  if (r.descriptions.opinion?.text) L.push("## AI opinion on the reference (paid, as asked)", "", r.descriptions.opinion.text, "");
  L.push("## Cost");
  L.push(`- Estimate: ${money(r.cost.estimate_spent_usd)} for what was sent (cap ${money(r.cost.cap_usd)}).`);
  const a = r.cost.actual;
  const total = actualTotal(a);
  if (a.status === "ok") L.push(`- **Actual, from fal: ${money(total!)}**${a.missing.length ? ` (${a.missing.length} of ${r.cost.request_ids.length} requests not reported by fal yet: run \`pnpm characters cost "<this folder>"\` in a few minutes)` : ""}.`);
  else L.push(`- Actual: not available (${a.message}). fal.ai → Dashboard → Usage shows it; the request IDs are in report.json.`);
  L.push("", `Sheets: ${[r.sheets.pack, r.sheets.location].filter(Boolean).join(", ") || "none"}.`, "");
  return L.join("\n");
}

// ---------------------------------------------------------------- cost (again, later)

async function costAgain(o: Opts, deps: Deps, env: Record<string, string>): Promise<void> {
  const dir = path.resolve(o.rest[0] ?? "");
  const file = path.join(dir, "report.json");
  if (!existsSync(file)) throw new Stop(`No report.json in ${dir}`);
  const key = env.FAL_KEY?.trim();
  if (!key) throw new Stop("No FAL_KEY in .env.");
  const r = JSON.parse(readFileSync(file, "utf8")) as PackReport & { created_at: string };
  r.cost.actual = await actualCosts(key, r.cost.request_ids, new Date(new Date(r.created_at).getTime() - 5 * 60_000).toISOString(), deps.fetch ?? fetch);
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(path.join(dir, "report.md"), packMarkdown(r));
  const total = actualTotal(r.cost.actual);
  console.log(total !== null ? `Actual cost from fal: ${money(total)}${r.cost.actual.status === "ok" && r.cost.actual.missing.length ? ` (${r.cost.actual.missing.length} requests not reported yet)` : ""}` : `Not available: ${(r.cost.actual as { message: string }).message}`);
}

// ---------------------------------------------------------------- fetch (images made by fal but not downloaded)

type RunReport = PackReport & { created_at: string };

async function fetchAgain(o: Opts, deps: Deps, env: Record<string, string>): Promise<void> {
  const dir = path.resolve(o.rest[0] ?? "");
  const file = path.join(dir, "report.json");
  if (!existsSync(file)) throw new Stop(`No report.json in ${dir}`);
  const report = JSON.parse(readFileSync(file, "utf8")) as RunReport;
  const abs = (f: string | null) => (f ? path.join(dir, f) : null);
  const lost = (it: ViewReport) => !it.file || !existsSync(abs(it.file)!) || it.tries.some((x) => !x.file && x.request_id && /^Generated but not downloaded/.test(x.text));
  const todo = report.items.filter(lost);
  if (!todo.length) {
    console.log("Nothing to fetch: every image of this run is on disk.");
    return;
  }
  const fal = await falClient(deps, env.FAL_KEY?.trim() ?? "");
  const face = deps.face ?? (await localFaceTool(REPO_ROOT));
  const refFile = path.join(dir, report.reference.file);
  const t = report.thresholds;
  const rank = (l: Light | null) => (l === "green" ? 3 : l === "amber" || l === "grey" ? 2 : 0);
  const recovered: string[] = [];
  const notRecovered: string[] = [];

  for (const it of todo) {
    const endpoint = report.models.find((m) => m.id === it.model)?.endpoint ?? MODELS[it.model].endpoint;
    const sub = path.join(dir, it.kind === "view" ? it.model : path.join("location", it.model));
    mkdirSync(sub, { recursive: true });
    const yaws = new Map<number, number | null | undefined>();
    let got = 0;
    for (let k = 0; k < it.tries.length; k++) {
      const tr = it.tries[k];
      if (!tr.request_id || (tr.file && existsSync(abs(tr.file)!))) continue;
      const target = path.join(sub, `${it.id}${k ? `_try${k + 1}` : ""}.png`);
      try {
        console.log(`  ${MODELS[it.model].name}: ${it.label}${k ? ` (try ${k + 1})` : ""}…`);
        if (!tr.url) tr.url = firstImageUrl((await fal.queue.result(endpoint, { requestId: tr.request_id })).data as Record<string, unknown>);
        await download(tr.url, target, (f, d) => writeFileSync(f, d), deps.sleep);
      } catch (error) {
        const reason = errorText(error).replace(/^the image could not be downloaded \((.*)\)$/, "$1");
        tr.text = `Generated but not downloaded (${reason}): run pnpm characters fetch "${dir}" to get it`;
        if (!it.file) it.text = tr.text;
        notRecovered.push(`${it.model}/${it.id}: ${reason}`);
        continue;
      }
      tr.file = path.relative(dir, target);
      got++;
      if (it.kind === "angle") {
        tr.light = "grey";
        tr.text = "Location: judge by eye (no face check).";
      } else {
        if (!VIEWS.find((v) => v.id === it.id)?.face) cropBodyView(face, target);
        const fr = face.compare(refFile, [target]).results[0];
        const c = classify(it.id as ViewId, fr, t);
        tr.score = fr.score;
        tr.light = c.light;
        tr.text = c.text;
        yaws.set(k, fr.yaw);
      }
    }
    if (!got) continue;
    // Choose the best try again, by the same rule as the pack run.
    let chosen: number | null = null;
    for (let k = 0; k < it.tries.length; k++) {
      const tr = it.tries[k];
      if (!tr.file || !existsSync(abs(tr.file)!)) continue;
      if (it.kind === "angle") {
        chosen ??= k;
        continue;
      }
      const prev = chosen === null ? null : it.tries[chosen];
      if (!prev || rank(tr.light) > rank(prev.light) || (rank(tr.light) === rank(prev.light) && (tr.score ?? -1) > (prev.score ?? -1))) chosen = k;
    }
    if (chosen === null) continue;
    const best = it.tries[chosen];
    it.chosen = chosen;
    it.file = best.file;
    it.light = best.light;
    it.text = `${best.text}${it.tries.length > 1 && it.kind === "view" ? ` (best of ${it.tries.length} tries)` : ""}`;
    if (it.kind === "view" && yaws.has(chosen)) it.angle_note = angleNote(VIEWS.find((v) => v.id === it.id)!, yaws.get(chosen));
    recovered.push(`${it.model}/${it.id}: ${it.light}`);
  }

  if (recovered.length) {
    const items = report.items.map((r) => ({ ...r, file: abs(r.file) }));
    const sceneFile = report.location ? path.join(dir, report.location.file) : null;
    const modelIds = report.models.map((m) => m.id);
    const sheets = buildSheets(face, dir, report.name, modelIds, items, refFile, sceneFile, t);
    report.sheets = { pack: sheets.pack ? path.basename(sheets.pack) : report.sheets.pack, location: sheets.location ? path.basename(sheets.location) : report.sheets.location };
  }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(dir, "report.md"), packMarkdown(report));
  console.log(`\nRecovered ${recovered.length} of ${todo.length} image(s), no new generation (no cost).`);
  for (const r of recovered) console.log(`  ✓ ${r}`);
  for (const r of notRecovered) console.log(`  ✗ ${r}`);
  if (notRecovered.length) console.log(`Run the same command again later for the ones that failed.`);
  console.log(`→ ${dir}`);
}

// ---------------------------------------------------------------- entry

export async function run(argv: string[], deps: Deps = {}): Promise<void> {
  const o = options(argv);
  const env = deps.env ?? loadEnv();
  const out = deps.out ?? OUT_DEFAULT;
  if (o.command === "cost") return costAgain(o, deps, env);
  if (o.command === "fetch") return fetchAgain(o, deps, env);
  if (o.command !== "calibrate" && o.command !== "pack") throw new Stop("Use: pnpm characters calibrate … | pack … | cost <folder> | fetch <folder> (see spikes\\characters\\README.md)");
  const face = deps.face ?? (await localFaceTool(REPO_ROOT));
  if (o.command === "calibrate") return calibrate(o, face, out, env);
  return pack(o, deps, face, out, env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error instanceof Stop ? error.message : `Error: ${errorText(error)}`}`);
    process.exitCode = 1;
  });
}
