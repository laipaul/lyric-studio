// Recast spike (18 Nov 2026): put the song's main character into Storyboard clips in place of the person in them, with
// several fal.ai methods side by side, then judge each result locally (face, scene, movement). Not part of the app: it
// reads the song's story line and the character's card through the app's code, and writes only into
// workspace\recast\<song>\<date-time>\. The clips and the card are never changed.
//
//   pnpm recast check                                      what fal says about each endpoint (fields, price)
//   pnpm recast "Wedding Day" --list                       the Storyboard cards with their numbers
//   pnpm recast "Wedding Day" --character "Bride No 2" --clips 7,9,10 --keyframe-only --max-cost 1   (first frames only)
//   pnpm recast "Wedding Day" --character "Bride No 2" --clips 10 --methods h3,keyframe,kwan --max-cost 3.5
//   (the same with --yes)                                  sends it
//   pnpm recast fetch "<run folder>"                       gets results that did not download (free)
//
// Methods: A wan (Wan 2.2 Animate Replace), B h3 (MiniMax H3 Max Recast, one photo), C keyframe (new first frame →
// face check → Kling O1 video edit), F kwan (the same first frame → Wan 2.2 Animate Replace), D aleph and E genjutsu
// (stubs). See README.md.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { FalClient } from "../../packages/video/node_modules/@fal-ai/client";

import { actualCosts, callModel, download, errorText } from "../../packages/video/src/node/characters/fal";
import { envIgnored, loadEnv, REPO_ROOT, workspaceDir } from "../lipsync/src/song";
import { character, open, pickClips, songClips, type Character, type StoryClip } from "./src/inputs";
import { gateVerdict, localGate, localJudge, verdict, type GateFn, type JudgeFn } from "./src/judge";
import { comparisonArgs, concatArgs, cropShare, ffmpeg, findTools, firstFrameArgs, fitArgs, hasFilter, kling720Args, padArgs, plays, probeVideo, sendCopyArgs, type Tools } from "./src/media";
import { DEFAULT_KEYFRAME_MODEL, KEYFRAME_MODEL_IDS, KEYFRAME_MODELS, lastStep, METHODS, parseMethods, type ClipInfo, type KeyframeModel, type Method, type MethodId, type Opts, type Quality, type Step, type Urls, type Variant } from "./src/methods";
import { estimate, fetchPrices, money, type Estimate, type Price } from "./src/pricing";
import { reportMarkdown, type ClipReport, type KeyframeRecord, type MethodResult, type RunReport, type StepRecord } from "./src/report";
import { fetchSchema, findUrl, mapInput, type EndpointSchema } from "./src/schema";

export class Stop extends Error {}

const HERE = path.join(REPO_ROOT, "spikes", "recast");

function args(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      character: { type: "string" },
      "card-version": { type: "string" },
      clips: { type: "string" },
      methods: { type: "string" },
      "keyframe-clips": { type: "string" },
      quality: { type: "string" },
      "max-cost": { type: "string" },
      parallel: { type: "string" },
      "timeout-min": { type: "string" },
      "keyframe-model": { type: "string" },
      "keyframe-only": { type: "boolean", default: false },
      h3: { type: "string" },
      yes: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
    },
  });
  const num = (v: string | undefined, def: number, name: string) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Stop(`--${name} takes a number (got "${v}").`);
    return n;
  };
  const q = values.quality?.toLowerCase();
  if (q && q !== "draft" && q !== "high") throw new Stop("--quality is draft or high.");
  let methods: MethodId[];
  try {
    methods = parseMethods(values.methods);
  } catch (error) {
    throw new Stop((error as Error).message);
  }
  const km = (values["keyframe-model"] ?? DEFAULT_KEYFRAME_MODEL).toLowerCase().replace(/^nano$/, "nano-pro");
  if (!(KEYFRAME_MODEL_IDS as readonly string[]).includes(km)) throw new Stop(`--keyframe-model is ${KEYFRAME_MODEL_IDS.join(", ")} (got "${km}").`);
  const keyframeOnly = values["keyframe-only"] ?? false;
  // --keyframe-only makes the new first frames and nothing else: only the keyframe methods stay in the list.
  if (keyframeOnly) methods = methods.filter((m) => m === "keyframe" || m === "kwan").length ? methods.filter((m) => m === "keyframe" || m === "kwan") : ["keyframe", "kwan"];
  return {
    command: positionals[0] === "check" || positionals[0] === "fetch" ? positionals[0] : "run",
    song: positionals[0] === "check" || positionals[0] === "fetch" ? positionals.slice(1).join(" ") : positionals.join(" "),
    character: values.character,
    cardVersion: values["card-version"] ? num(values["card-version"], 1, "card-version") : undefined,
    clips: values.clips,
    methods,
    keyframeClips: values["keyframe-clips"],
    // Wan 720p / H3 1080P unless --quality draft (480p / 768P).
    quality: (q as Quality | undefined) ?? "high",
    keyframeModel: km as KeyframeModel,
    keyframeOnly,
    maxCost: num(values["max-cost"], 3, "max-cost"),
    parallel: Math.max(1, Math.round(num(values.parallel, 3, "parallel"))),
    timeoutMs: num(values["timeout-min"], 20, "timeout-min") * 60_000,
    h3: values.h3,
    yes: values.yes,
    list: values.list,
  };
}
type Args = ReturnType<typeof args>;

export type Deps = { fal?: FalClient; fetch?: typeof fetch; judge?: JudgeFn; gate?: GateFn; env?: Record<string, string>; now?: () => Date };

const endpointOverrides = (a: Args): Record<string, string | undefined> => ({ keyframe: KEYFRAME_MODELS[a.keyframeModel].endpoint, h3: a.h3 });

// ---- endpoints: fal's description of each step (the first candidate fal knows), cached for later runs ----

type Resolved = { step: Step; schema: EndpointSchema | null; tried: string[]; error?: string };

async function resolveSteps(steps: Step[], f: typeof fetch, overrides: Record<string, string | undefined>): Promise<Map<string, Resolved>> {
  const cacheDir = path.join(HERE, "out", "endpoints");
  const out = new Map<string, Resolved>();
  for (const step of steps) {
    if (out.has(step.key)) continue;
    const candidates = overrides[step.key] ? [overrides[step.key]!] : step.candidates;
    let found: EndpointSchema | null = null;
    let error: string | undefined;
    for (const id of candidates) {
      const cache = path.join(cacheDir, `${id.replace(/[\\/]/g, "__")}.json`);
      let schema: EndpointSchema | null = null;
      try {
        schema = await fetchSchema(id, f);
        if (schema) {
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(cache, `${JSON.stringify(schema, null, 2)}\n`);
        }
      } catch (e) {
        error = errorText(e);
        if (existsSync(cache)) schema = JSON.parse(readFileSync(cache, "utf8")) as EndpointSchema; // fal out of reach: the last description read
      }
      if (schema) {
        found = schema;
        break;
      }
    }
    out.set(step.key, { step, schema: found, tried: candidates, ...(error && !found ? { error } : {}) });
  }
  return out;
}

async function check(a: Args, deps: Deps): Promise<void> {
  const env = deps.env ?? loadEnv();
  const steps = Object.values(METHODS).flatMap((m) => m.steps);
  const resolved = await resolveSteps(steps, deps.fetch ?? fetch, endpointOverrides(a));
  const key = env.FAL_KEY?.trim();
  const ids = [...resolved.values()].flatMap((r) => (r.schema ? [r.schema.id] : []));
  const prices = key ? await fetchPrices(key, ids, deps.fetch ?? fetch) : { error: "no FAL_KEY in .env" };
  console.log("\nWhat fal says about each endpoint:\n");
  for (const m of Object.values(METHODS)) {
    console.log(`${m.letter} ${m.name}${m.stub ? `: ${m.stub}` : ""}`);
    for (const s of m.steps) {
      const r = resolved.get(s.key)!;
      if (!r.schema) {
        console.log(`   ${s.label}: NOT FOUND on fal (tried ${r.tried.join(", ")})${r.error ? `: ${r.error}` : ""}`);
        continue;
      }
      const p = "error" in prices ? null : prices[r.schema.id];
      console.log(`   ${s.label}: ${r.schema.id}  ${p ? `fal's price list: ${money(p.unitPrice)} per ${p.unit}` : `fal's price list: ${"error" in prices ? prices.error : "no entry"} (the estimate then uses fal's documented formula)`}`);
      for (const f of r.schema.fields) console.log(`      ${f.required ? "*" : " "} ${f.name}: ${f.isArray ? `${f.type}[]` : f.type}${f.enum ? ` (${f.enum.join(" | ")})` : ""}${f.default !== undefined ? ` default ${JSON.stringify(f.default)}` : ""}`);
    }
  }
  console.log("\n* = required. Saved in spikes\\recast\\out\\endpoints\\. Nothing was sent.");
}

// ---- the plan: what each clip and method would cost ----

type Unit = { step: Step; usd: number; est: Estimate; shared: boolean };
type Job = { clip: StoryClip; info: ClipInfo; method: Method; quality: Quality; estimate: number; units: Unit[]; skip: string | null; ownsKeyframe: boolean };

const optsFor = (a: Args, seed = 42): Opts => ({ keyframeModel: a.keyframeModel, seed });

// The estimate of one step; `unknown` names a price nobody could compute (the run then stops before uploading).
export function stepEstimate(step: Step, endpoint: string, fal: Price | undefined, info: ClipInfo, q: Quality, o: Opts): Estimate | { unknown: string } {
  const formula = typeof step.priceFormula === "function" ? step.priceFormula(o) : step.priceFormula;
  return estimate({ formula, formulaFirst: step.formulaFirst, units: step.units(info), input: { durationS: info.durationS, fps: info.fps, quality: q } }, fal, endpoint);
}

function plan(clips: { clip: StoryClip; info: ClipInfo }[], a: Args, resolved: Map<string, Resolved>, prices: Record<string, Price> | { error: string }, keyframeOnly: Set<string> | null): { jobs: Job[]; unknown: string[] } {
  const jobs: Job[] = [];
  const unknown: string[] = [];
  const o = optsFor(a);
  for (const { clip, info } of clips) {
    let keyframeOwned = false; // the first runnable keyframe method of a clip makes the first frame; the other reuses it
    for (const id of a.methods) {
      const method = METHODS[id];
      const base = { clip, info, method, quality: a.quality, estimate: 0, units: [] as Unit[], ownsKeyframe: false };
      if (method.stub) {
        jobs.push({ ...base, skip: method.stub });
        continue;
      }
      const isKeyframe = method.steps.some((s) => s.key === "keyframe");
      if (isKeyframe && keyframeOnly && !keyframeOnly.has(clip.name)) {
        jobs.push({ ...base, skip: "not on this clip in this run (--keyframe-clips)." });
        continue;
      }
      const refusal = method.precheck?.(info) ?? null;
      if (refusal) {
        jobs.push({ ...base, skip: refusal });
        continue;
      }
      const steps = a.keyframeOnly ? method.steps.filter((s) => s.key === "keyframe") : method.steps;
      const missing = steps.filter((s) => !resolved.get(s.key)?.schema);
      const ownsKeyframe = isKeyframe && !keyframeOwned && !missing.length;
      if (ownsKeyframe) keyframeOwned = true;
      const units: Unit[] = [];
      for (const step of steps) {
        const schema = resolved.get(step.key)?.schema ?? null;
        const fal = schema && !("error" in prices) ? prices[schema.id] : undefined;
        const e = stepEstimate(step, schema?.id ?? step.candidates[0], fal, info, a.quality, o);
        if ("unknown" in e) {
          if (!missing.length) unknown.push(`${method.letter} card ${clip.position}: ${step.label} ${e.unknown}`);
          units.push({ step, usd: 0, est: { usd: 0, source: "not confirmed", basis: "unknown", note: null }, shared: false });
          continue;
        }
        const shared = step.key === "keyframe" && isKeyframe && !ownsKeyframe && keyframeOwned;
        units.push({ step, usd: shared ? 0 : e.usd, est: e, shared });
      }
      jobs.push({ ...base, estimate: units.reduce((s, x) => s + x.usd, 0), units, skip: missing.length ? `fal does not know ${missing.map((s) => s.label).join(", ")} under the IDs tried (pnpm recast check).` : null, ownsKeyframe });
    }
  }
  return { jobs, unknown };
}

// ---- running one job ----

type Fal = FalClient;
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
type KeyframeOut = { url: string; file: string; record: KeyframeRecord };
class GateFail extends Error {
  constructor(message: string, readonly record: KeyframeRecord) {
    super(message);
  }
}
type Ctx = {
  tools: Tools;
  fal: Fal;
  a: Args;
  urls: Omit<Urls, "frame" | "keyframe" | "keyframePad" | "clip">;
  resolved: Map<string, Resolved>;
  ch: Character;
  judge: JudgeFn;
  gate: GateFn;
  dirOf: (c: StoryClip) => string;
  clipUrl: (job: Job, variant: Variant) => Promise<string>;
  keyframes: Map<string, Deferred<KeyframeOut>>;
  budget: { cap: number; planned: number; extra: number };
};

const write = (file: string, data: Buffer) => writeFileSync(file, data);

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined); // a failure is read by whoever awaits it
  return { promise, resolve, reject };
}

// One fal request: mapped to the endpoint's own fields, queued, polled, downloaded.
async function callStep(ctx: Ctx, job: Job, u: Unit, rec: StepRecord, urls: Urls, dir: string, seed = 42, log: (m: string) => void): Promise<{ url: string; file: string }> {
  const schema = ctx.resolved.get(u.step.key)!.schema!;
  const mapped = mapInput(schema, u.step.wants(job.info, urls, job.quality, optsFor(ctx.a, seed)));
  if (mapped.missing.length) throw new Error(`${schema.id} needs ${mapped.missing.join(", ")}, which the spike does not know how to fill (pnpm recast check shows the fields)`);
  rec.sent = Object.keys(mapped.input);
  if (mapped.notes.length) rec.notes = [...new Set([...(rec.notes ?? []), ...mapped.notes])];
  log(`${u.step.label}: sending to ${schema.id}…`);
  try {
    const r = await callModel(ctx.fal, schema.id, mapped.input, { timeoutMs: ctx.a.timeoutMs, pollMs: 5000, log: (m) => log(`${u.step.label}: ${m}`) });
    rec.request_id = r.requestId;
    rec.attempts = [...(rec.attempts ?? []), ...r.attempts.map((x) => ({ request_id: x.request_id, outcome: x.outcome }))];
    const url = findUrl(r.data, u.step.output);
    if (!url) throw new Error(`no ${u.step.output} in fal's answer (${JSON.stringify(r.data).slice(0, 160)})`);
    rec.url = url;
    const file = path.join(dir, `${u.step.key}${u.step.output === "video" ? "_raw.mp4" : seed === 42 ? ".png" : `_seed${seed}.png`}`);
    await download(url, file, write);
    rec.file = path.basename(file);
    rec.status = "done";
    log(`${u.step.label}: done (request ${r.requestId})`);
    return { url, file };
  } catch (error) {
    rec.status = "failed";
    rec.reason = errorText(error);
    const tried = (error as { attempts?: { request_id: string | null; outcome: string }[] }).attempts;
    if (tried) {
      rec.attempts = tried.map((x) => ({ request_id: x.request_id, outcome: x.outcome }));
      rec.request_id = [...tried].reverse().find((x) => x.request_id)?.request_id ?? null;
    }
    throw error;
  }
}

// The new first frame, checked for free before any video is paid for: the face must be the character's and not the
// original person's. One more try with a new seed when it fails (while the cap allows), then the clip's video steps stop.
async function makeKeyframe(ctx: Ctx, job: Job, u: Unit, rec: StepRecord, urls: Urls, dir: string, log: (m: string) => void): Promise<KeyframeOut> {
  const { info } = job;
  const frame = path.join(dir, "first_frame.png");
  ffmpeg(ctx.tools, firstFrameArgs(info.file, frame));
  urls.frame = await ctx.fal.storage.upload(new File([readFileSync(frame)], "first_frame.png", { type: "image/png" }));
  const model = KEYFRAME_MODELS[ctx.a.keyframeModel].name;
  const record: KeyframeRecord = { file: null, model, passed: false, attempts: [] };
  const each = u.est.usd;
  for (let attempt = 0; attempt < 2; attempt++) {
    const seed = 42 + attempt;
    if (attempt > 0) {
      if (ctx.budget.planned + ctx.budget.extra + each > ctx.budget.cap + 1e-9) {
        record.reason = `A second try would go above the cap of ${money(ctx.budget.cap)}.`;
        break;
      }
      ctx.budget.extra += each;
      rec.estimated_usd = round2(rec.estimated_usd + each);
      log("the new first frame did not pass the face check: trying once more with a new seed…");
    }
    const got = await callStep(ctx, job, u, rec, urls, dir, seed, log);
    const kf = path.join(dir, "keyframe.png");
    if (got.file !== kf) copyFileSync(got.file, kf);
    const g = await ctx.gate({ frame, keyframe: kf, refs: [ctx.ch.refs.closeup, ctx.ch.refs.threeQuarter] });
    if ("error" in g) throw new GateFail(`The new first frame could not be checked (${g.error}): the video step was not sent.`, { ...record, reason: g.error });
    const v = gateVerdict(g, ctx.ch.redBelow);
    record.attempts.push({ seed, character: g.character, original: g.original, passed: v.passed, file: path.basename(got.file) });
    if (v.passed) {
      record.passed = true;
      record.file = "keyframe.png";
      return { url: got.url, file: kf, record };
    }
    record.reason = v.reason!;
    log(`the new first frame fails the face check (character ${g.character ?? "none"}, original person ${g.original ?? "none"}).`);
  }
  throw new GateFail(record.reason ?? "The new first frame failed the face check: the video step was not sent.", record);
}

async function runJob(ctx: Ctx, job: Job): Promise<MethodResult> {
  const { method, clip, info } = job;
  const dir = ctx.dirOf(clip);
  const tag = `card ${clip.position} ${method.letter}`;
  const log = (m: string) => console.log(`  [${tag}] ${m}`);
  const base: MethodResult = { method: method.id, letter: method.letter, name: method.name, status: "skipped", steps: [] };
  if (job.skip) return { ...base, reason: job.skip };
  const started = Date.now();
  const urls: Urls = { ...ctx.urls, clip: "" };
  const steps: StepRecord[] = job.units.map((u) => ({ key: u.step.key, label: u.step.label, endpoint: ctx.resolved.get(u.step.key)?.schema?.id ?? null, status: "waiting", estimated_usd: round2(u.usd), ...(u.est.note ? { notes: [u.est.note] } : {}) }));
  let keyframe: KeyframeRecord | undefined;
  try {
    let last: { url: string; file: string } | null = null;
    for (const [i, u] of job.units.entries()) {
      const rec = steps[i];
      try {
        if (u.step.key === "keyframe") {
          let sh = ctx.keyframes.get(clip.name);
          if (!sh) ctx.keyframes.set(clip.name, (sh = deferred<KeyframeOut>()));
          let out: KeyframeOut;
          if (job.ownsKeyframe) {
            try {
              out = await makeKeyframe(ctx, job, u, rec, urls, dir, log);
              sh.resolve(out);
            } catch (e) {
              sh.reject(e);
              throw e;
            }
          } else {
            out = await sh.promise; // made once for the other keyframe method: no second request, no second charge
            Object.assign(rec, { status: "done", url: out.url, file: "keyframe.png", notes: [...(rec.notes ?? []), "the first frame made for the other keyframe method was reused (counted once)"] });
          }
          keyframe = out.record;
          urls.keyframe = out.url;
          last = { url: out.url, file: out.file };
          continue;
        }
        urls.clip = await ctx.clipUrl(job, u.step.variant ?? "orig");
        if (u.step.key === "kwan") {
          // The new first frame gets the same 9:16 padding as the clip.
          const kf = path.join(dir, "keyframe.png");
          const sz = probeVideo(ctx.tools, kf)!;
          const padded = path.join(dir, "keyframe_pad916.png");
          ffmpeg(ctx.tools, padArgs(kf, sz, padded, true));
          urls.keyframePad = await ctx.fal.storage.upload(new File([readFileSync(padded)], "keyframe_pad916.png", { type: "image/png" }));
        }
        last = await callStep(ctx, job, u, rec, urls, dir, 42, log);
      } catch (error) {
        if (rec.status !== "failed") {
          rec.status = "failed";
          rec.reason = errorText(error);
        }
        for (const later of steps.slice(i + 1)) {
          later.status = "skipped";
          later.reason = `${u.step.label} failed`;
        }
        throw error;
      }
    }
    if (ctx.a.keyframeOnly) return { ...base, status: "done", steps, keyframe, seconds: (Date.now() - started) / 1000, verdict: `First frame only: see keyframe.png (${keyframe?.attempts.length ?? 0} ${keyframe?.attempts.length === 1 ? "try" : "tries"}, face check passed). No video was sent.` };
    return { ...(await finishVideo(ctx, job, last!.file, dir)), steps, keyframe, seconds: (Date.now() - started) / 1000 };
  } catch (error) {
    const gateFail = error instanceof GateFail;
    return { ...base, status: "failed", reason: errorText(error), steps, ...(gateFail ? { keyframe: (error as GateFail).record } : {}), seconds: (Date.now() - started) / 1000 };
  }
}

// The model's video back to the clip's shape, then judged. A video made on the 9:16 canvas is scaled to the canvas and
// the clip's own rectangle cut out again (the padding goes; nothing of the picture is lost).
async function finishVideo(ctx: Ctx, job: Job, raw: string, dir: string): Promise<MethodResult> {
  const { method, info } = job;
  const padded = lastStep(method)?.variant === "pad916";
  const rawInfo = probeVideo(ctx.tools, raw);
  if (!rawInfo || !plays(ctx.tools, raw).ok) throw new Error("the video fal returned does not play");
  const fitted = path.join(dir, `${method.letter}_${method.id}.mp4`);
  ffmpeg(ctx.tools, fitArgs(raw, { width: info.width, height: info.height, fps: info.fps, durationS: info.durationS }, fitted, padded));
  const crop = padded ? 0 : cropShare(rawInfo, info);
  const short = rawInfo.durationS < info.durationS - 0.15 ? `The model returned ${rawInfo.durationS.toFixed(2)} s of the ${info.durationS.toFixed(2)} s clip: the last frame is held to keep the length.` : null;
  const fitNote = [crop > 0.05 ? `The model changed the picture's shape (${rawInfo.width}×${rawInfo.height}): ${Math.round(crop * 100)}% was cropped to keep the clip's shape.` : null, short].filter(Boolean).join(" ") || null;
  const j = await ctx.judge({ original: info.file, result: fitted, refs: [ctx.ch.refs.closeup, ctx.ch.refs.threeQuarter, ctx.ch.refs.reference], green: ctx.ch.greenFrom });
  const judged = "error" in j ? null : j;
  return {
    method: method.id,
    letter: method.letter,
    name: method.name,
    status: "done",
    steps: [],
    output: { raw: path.basename(raw), fitted: path.basename(fitted), raw_size: `${rawInfo.width}×${rawInfo.height}, ${rawInfo.fps.toFixed(2)} fps, ${rawInfo.durationS.toFixed(2)} s`, crop_share: crop, ...(padded ? { padding_removed: true } : {}) },
    judge: judged,
    ...("error" in j ? { judge_error: j.error } : {}),
    verdict: judged ? verdict(judged, fitNote) : `Made, but not judged: ${"error" in j ? j.error : ""}`,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

async function pool<T, R>(items: T[], n: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

function labelFont(): string | null {
  try {
    return createRequire(path.join(REPO_ROOT, "packages", "video", "package.json")).resolve("@fontsource/inter/files/inter-latin-600-normal.woff");
  } catch {
    return null;
  }
}

// Side by side per clip (original first), then all clips one after another in the run folder.
function comparisons(tools: Tools, runDir: string, report: RunReport): void {
  const font = hasFilter(tools, "drawtext") ? labelFont() : null;
  const made: { file: string; width: number; height: number }[] = [];
  for (const c of report.clips) {
    const dir = path.join(runDir, c.folder);
    const done = c.results.filter((m) => m.status === "done" && m.output);
    if (!done.length) continue;
    const panels = [{ file: "original.mp4", label: `Original (card ${c.position})` }, ...done.map((m) => ({ file: m.output!.fitted, label: `${m.letter} ${m.name}` }))];
    if (font) copyFileSync(font, path.join(dir, "label-font.woff"));
    try {
      ffmpeg(tools, comparisonArgs(panels, { width: c.width, height: c.height, fps: c.fps, durationS: c.duration_s }, "comparison.mp4", font ? "label-font.woff" : null), dir);
      c.comparison = "comparison.mp4";
      const info = probeVideo(tools, path.join(dir, "comparison.mp4"));
      if (info) made.push({ file: path.join(dir, "comparison.mp4"), width: info.width, height: info.height });
    } catch (error) {
      console.log(`  card ${c.position}: the side-by-side video could not be made (${errorText(error)})`);
    } finally {
      rmSync(path.join(dir, "label-font.woff"), { force: true });
    }
  }
  if (made.length) {
    try {
      ffmpeg(tools, concatArgs(made, path.join(runDir, "comparison.mp4")));
      report.comparison = "comparison.mp4";
    } catch (error) {
      console.log(`  the combined comparison could not be made (${errorText(error)})`);
    }
  }
}

function saveReport(runDir: string, report: RunReport): void {
  writeFileSync(path.join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(runDir, "report.md"), reportMarkdown(report)); // starts with a BOM (see report.ts)
}

async function billing(env: Record<string, string>, report: RunReport, startIso: string, f: typeof fetch): Promise<void> {
  const key = env.FAL_KEY?.trim();
  const steps = report.clips.flatMap((c) => c.results.flatMap((m) => m.steps)).filter((s) => s.request_id);
  if (!key || !steps.length) return;
  const r = await actualCosts(key, steps.map((s) => s.request_id!), startIso, f);
  if (r.status !== "ok") {
    report.billing_note = `fal's billing could not be read (${r.message}): your fal.ai dashboard shows the real charge.`;
    return;
  }
  for (const s of steps) s.billed_usd = s.request_id! in r.byRequest ? round2(r.byRequest[s.request_id!]) : null;
  report.billed_usd = round2(Object.values(r.byRequest).reduce((x, y) => x + y, 0));
  report.billing_note = r.missing.length ? `fal has not billed ${r.missing.length} request(s) yet: see the dashboard later.` : "Billed amounts from fal's billing.";
}

const stamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60) || "untitled";

async function falClient(env: Record<string, string>, deps: Deps): Promise<FalClient> {
  if (deps.fal) return deps.fal;
  if (!envIgnored()) throw new Stop(".env is not in .gitignore: add a line `.env` there first, so your fal key never goes to git.");
  const key = env.FAL_KEY?.trim();
  if (!key) throw new Stop("No FAL_KEY in .env: add a line FAL_KEY=<your key from fal.ai → Dashboard → API keys> to D:\\videomaker\\.env.");
  // The fal client the app installed (packages/video), loaded by file URL (Windows: a bare D:\ path is refused).
  let createFalClient: typeof import("../../packages/video/node_modules/@fal-ai/client").createFalClient;
  try {
    const entry = createRequire(path.join(REPO_ROOT, "packages", "video", "package.json")).resolve("@fal-ai/client");
    ({ createFalClient } = (await import(pathToFileURL(entry).href)) as typeof import("../../packages/video/node_modules/@fal-ai/client"));
  } catch {
    throw new Stop("The fal client was not found: run pnpm install in D:\\videomaker first.");
  }
  return createFalClient({ credentials: key, suppressLocalCredentialsWarning: true });
}

export async function run(argv: string[], deps: Deps = {}): Promise<string | null> {
  const a = args(argv);
  const env = deps.env ?? loadEnv();
  const f = deps.fetch ?? fetch;
  if (a.command === "check") {
    await check(a, deps);
    return null;
  }
  if (a.command === "fetch") return fetchMissing(a, env, deps);
  if (!a.song.trim()) throw new Stop('Which song? pnpm recast "<song title>" --list');
  const ws = open(workspaceDir(env));
  try {
    let song;
    try {
      song = await songClips(ws, a.song);
    } catch (error) {
      throw new Stop((error as Error).message);
    }
    if (a.list) {
      console.log(`\n${song.title}: the Storyboard cards (numbers as on Prepare → Storyboard)\n`);
      for (const it of song.items) console.log(`${String(it.position).padStart(3)}  ${it.kind === "clip" ? `${it.clip!.name}${it.clip!.collection ? `  (from ${it.clip!.collection})` : ""}${it.clip!.kind === "photo" ? "  (photo)" : ""}${it.clip!.omit ? "  (omitted)" : ""}` : it.label}`);
      return null;
    }
    const tools = findTools(env);
    if (typeof tools === "string") throw new Stop(tools);
    if (!a.character) throw new Stop('Which character? --character "Bride No 2"');
    let ch: Character;
    let picked: StoryClip[];
    try {
      ch = character(ws, a.character, a.cardVersion);
      picked = pickClips(song, a.clips);
    } catch (error) {
      throw new Stop((error as Error).message);
    }
    const keyframeOnly = a.keyframeClips ? new Set(pickClips(song, a.keyframeClips).map((c) => c.name)) : null;
    const clips = picked.map((clip) => {
      const p = probeVideo(tools, clip.file);
      if (!p) throw new Stop(`Cannot read ${clip.file} as a video.`);
      return { clip, info: { file: clip.file, width: p.width, height: p.height, fps: p.fps, durationS: p.durationS } as ClipInfo };
    });

    const steps = a.methods.flatMap((id) => METHODS[id].steps);
    const resolved = await resolveSteps(steps, f, endpointOverrides(a));
    const key = env.FAL_KEY?.trim();
    const prices = key ? await fetchPrices(key, [...resolved.values()].flatMap((r) => (r.schema ? [r.schema.id] : [])), f) : { error: "no FAL_KEY" };
    const { jobs, unknown } = plan(clips, a, resolved, prices, keyframeOnly);

    console.log(`\n${song.title} → ${ch.name} v${ch.version} (close-up, 3/4 face and reference picture; never the full-body views)${a.keyframeOnly ? `\nFirst frames only (${KEYFRAME_MODELS[a.keyframeModel].name}): no video is made.` : ""}`);
    for (const { clip, info } of clips) {
      console.log(`\nCard ${clip.position}: ${clip.name} (${info.width}×${info.height}, ${info.fps.toFixed(2)} fps, ${info.durationS.toFixed(2)} s)`);
      for (const j of jobs.filter((x) => x.clip === clip)) {
        if (j.skip) console.log(`   ${j.method.letter} ${j.method.name.padEnd(26)} skipped: ${j.skip}`);
        else {
          console.log(`   ${j.method.letter} ${j.method.name.padEnd(26)} est. ${money(j.estimate)}`);
          for (const u of j.units) console.log(`        ${u.step.label}: ${money(u.usd)} (${u.shared ? "made once for the other keyframe method: counted there" : `${u.est.basis}${u.est.note ? `; ${u.est.note}` : ""}`})`);
        }
      }
    }
    if (unknown.length) throw new Stop(`Cannot estimate ${unknown.join("; ")}: nothing was uploaded. (fal's price list gave no unit the spike can compute and there is no documented formula: tell me what pnpm recast check prints.)`);
    const total = jobs.reduce((s, j) => s + (j.skip ? 0 : j.estimate), 0);
    const perMethod = a.methods.map((id) => `${METHODS[id].letter} ${money(jobs.filter((j) => j.method.id === id && !j.skip).reduce((s, j) => s + j.estimate, 0))}`).join(" · ");
    console.log(`\nEstimated total: ${money(total)} (${perMethod}; cap ${money(a.maxCost)}${"error" in prices ? `; fal's price list could not be read (${prices.error}): documented formulas used` : ""}). A second try of a first frame that fails the free face check is added only if the cap allows.`);
    if (total > a.maxCost + 1e-9) throw new Stop(`The estimate (${money(total)}) is above the cap of ${money(a.maxCost)}: nothing was uploaded. Fewer clips or methods (--keyframe-clips, --methods), or --max-cost ${Math.ceil(total)}.`);
    const runnable = jobs.filter((j) => !j.skip);
    if (!runnable.length) throw new Stop("Nothing to send.");
    if (!a.yes) {
      console.log("Nothing was uploaded. Add --yes to run it.");
      return null;
    }

    const fal = await falClient(env, deps);
    const started = (deps.now ?? (() => new Date()))();
    let runDir = path.join(workspaceDir(env), "recast", safe(song.title), stamp(started));
    for (let n = 2; existsSync(runDir); n++) runDir = path.join(workspaceDir(env), "recast", safe(song.title), `${stamp(started)} (${n})`);
    const folderOf = (c: StoryClip) => `${String(c.position).padStart(2, "0")}_${safe(path.parse(c.name).name)}`;
    for (const { clip } of clips) mkdirSync(path.join(runDir, folderOf(clip)), { recursive: true });
    console.log(`\nResults: ${runDir}\nUploading the clips and ${ch.name}'s pictures…`);
    const up = async (file: string, type: string) => fal.storage.upload(new File([readFileSync(file)], path.basename(file), { type }));
    const refUrls = { closeup: await up(ch.refs.closeup, "image/png"), threeQuarter: await up(ch.refs.threeQuarter, "image/png"), reference: await up(ch.refs.reference, ch.refs.reference.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg") };
    for (const { clip, info } of clips) {
      const sent = path.join(runDir, folderOf(clip), "original.mp4");
      ffmpeg(tools, sendCopyArgs(info.file, sent));
      info.file = sent; // judged and compared against exactly what was sent
    }
    // The prepared copy of a clip each method gets, made and uploaded once per (clip, variant), when first needed.
    const variants = new Map<string, Promise<string>>();
    const clipUrl = (job: Job, variant: Variant): Promise<string> => {
      const k = `${job.clip.name}|${variant}`;
      if (!variants.has(k)) {
        variants.set(k, (async () => {
          const dir = path.join(runDir, folderOf(job.clip));
          let file = job.info.file;
          if (variant === "pad916") {
            file = path.join(dir, "padded_916.mp4");
            ffmpeg(tools, padArgs(job.info.file, job.info, file));
          } else if (variant === "kling720") {
            file = path.join(dir, "kling_720.mp4");
            ffmpeg(tools, kling720Args(job.info.file, job.info, job.info.fps, file));
          }
          return up(file, "video/mp4");
        })());
      }
      return variants.get(k)!;
    };
    const report: RunReport = {
      created_at: started.toISOString(),
      song: song.title,
      character: { name: ch.name, version: ch.version, pictures: ["close-up", "3/4 face", "reference picture"], green_from: ch.greenFrom, lines: ch.thresholdsSource },
      methods: a.methods.map((id) => `${METHODS[id].letter} ${METHODS[id].name}`),
      keyframe_model: KEYFRAME_MODELS[a.keyframeModel].name,
      cap_usd: a.maxCost,
      estimated_usd: round2(total),
      billed_usd: null,
      billing_note: "Your fal.ai dashboard shows the real charge.",
      clips: clips.map(({ clip, info }) => ({ position: clip.position, name: clip.name, source: clip.file, width: info.width, height: info.height, fps: info.fps, duration_s: info.durationS, folder: folderOf(clip), results: [], comparison: null })),
      comparison: null,
    };
    saveReport(runDir, report);
    const judge = deps.judge ?? localJudge(REPO_ROOT);
    const gate = deps.gate ?? localGate(REPO_ROOT);
    const keyframes = new Map<string, Deferred<KeyframeOut>>();
    const budget = { cap: a.maxCost, planned: total, extra: 0 };
    const results = await pool(jobs, a.parallel, async (job) => {
      const ctx: Ctx = { tools, fal, a, urls: refUrls, resolved, ch, judge, gate, dirOf: (c) => path.join(runDir, folderOf(c)), clipUrl, keyframes, budget };
      const r = await runJob(ctx, job);
      report.clips.find((c) => c.name === job.clip.name)!.results.push(r);
      saveReport(runDir, report); // the request IDs are on disk as soon as they exist
      return r;
    });
    for (const c of report.clips) c.results.sort((x, y) => x.letter.localeCompare(y.letter));
    comparisons(tools, runDir, report);
    await billing(env, report, started.toISOString(), f);
    saveReport(runDir, report);
    console.log("");
    for (const c of report.clips) {
      console.log(`Card ${c.position} ${c.name}:`);
      for (const m of c.results) console.log(`  ${m.letter} ${m.name}: ${m.status === "done" ? m.verdict : `${m.status}: ${m.reason}`}`);
    }
    console.log(`\n→ ${path.join(runDir, report.comparison ?? "report.md")}\n  ${results.filter((r) => r.status === "done").length} result(s); details in report.md`);
    return runDir;
  } finally {
    ws.close();
  }
}

// `pnpm recast fetch "<run folder>"`: results whose request ran on fal but did not download are fetched (free), then
// fitted and judged; a method whose earlier step is missing is reported (send it again instead).
async function fetchMissing(a: Args, env: Record<string, string>, deps: Deps): Promise<string> {
  const runDir = path.resolve(a.song.trim() || ".");
  const file = path.join(runDir, "report.json");
  if (!existsSync(file)) throw new Stop(`No report.json in ${runDir}: give the run folder (workspace\\recast\\<song>\\<date-time>).`);
  const report = JSON.parse(readFileSync(file, "utf8")) as RunReport;
  const tools = findTools(env);
  if (typeof tools === "string") throw new Stop(tools);
  const fal = await falClient(env, deps);
  const ws = open(workspaceDir(env));
  try {
    const ch = character(ws, report.character.name, report.character.version);
    const judge = deps.judge ?? localJudge(REPO_ROOT);
    let got = 0;
    for (const c of report.clips) {
      const dir = path.join(runDir, c.folder);
      const info: ClipInfo = { file: path.join(dir, "original.mp4"), width: c.width, height: c.height, fps: c.fps, durationS: c.duration_s };
      for (const [k, m] of c.results.entries()) {
        const lastStep = m.steps[m.steps.length - 1];
        if (m.status === "done" || !lastStep || !lastStep.request_id || !lastStep.endpoint) continue;
        if (m.steps.slice(0, -1).some((s) => s.status !== "done")) {
          console.log(`Card ${c.position} ${m.letter}: an earlier step did not finish; send it again instead.`);
          continue;
        }
        try {
          const r = await fal.queue.result(lastStep.endpoint, { requestId: lastStep.request_id });
          const url = findUrl(r.data, "video");
          if (!url) throw new Error("no video in fal's answer");
          const raw = path.join(dir, `${lastStep.key}_raw.mp4`);
          await download(url, raw, write);
          Object.assign(lastStep, { status: "done", file: path.basename(raw), url, reason: undefined });
          const job = { clip: { position: c.position, name: c.name } as StoryClip, info, method: METHODS[m.method as MethodId], quality: "draft" as Quality, estimate: 0, units: [], skip: null, ownsKeyframe: false };
          const ctx = { tools, fal, a, urls: { closeup: "", threeQuarter: "", reference: "" }, resolved: new Map(), ch, judge, dirOf: () => dir } as unknown as Ctx;
          c.results[k] = { ...(await finishVideo(ctx, job, raw, dir)), steps: m.steps, seconds: m.seconds, ...(m.keyframe ? { keyframe: m.keyframe } : {}) };
          got++;
          console.log(`Card ${c.position} ${m.letter}: got it.`);
        } catch (error) {
          console.log(`Card ${c.position} ${m.letter}: still not available (${errorText(error)}).`);
        }
      }
    }
    if (got) comparisons(tools, runDir, report);
    saveReport(runDir, report);
    console.log(`${got} result(s) fetched. → ${path.join(runDir, "report.md")}`);
    return runDir;
  } finally {
    ws.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error instanceof Stop ? error.message : `Error: ${errorText(error)}`}`);
    process.exitCode = 1;
  });
}
