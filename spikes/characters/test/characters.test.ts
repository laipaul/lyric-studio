// Tests of the Characters C1 spike: the pure logic, and the whole pack run with a stand-in fal client, a stand-in face
// check and a stand-in billing API (nothing goes to fal.ai, no key is used, no face models are needed).
//   pnpm characters:test        (the face checks themselves: services/audio/tests/test_face.py)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { actualTotal, calibrationMarkdown, packMarkdown, run, Stop } from "../characters";
import { importUrl } from "../src/face";
import type { CheckResult, FaceTool, SheetSpec } from "../src/face";
import { REPO_ROOT } from "../src/env";
import { actualCosts, callModel, download } from "../src/fal";
import { angleNote, anglePrompt, ANGLES, Budget, classify, DEFAULT_THRESHOLDS, estimate, MODELS, VIEWS, viewPrompt } from "../src/plan";

describe("plan", () => {
  test("every view asks for the reference as identity AND style; locations keep the room, no people", () => {
    for (const v of VIEWS) assert.match(viewPrompt(v), /BOTH the identity and the style reference/);
    for (const v of VIEWS) assert.match(viewPrompt(v), /neutral, empty outdoor place .* soft natural daylight/);
    for (const v of VIEWS) assert.match(viewPrompt(v), /Not a studio, no backdrop/);
    assert.ok(VIEWS.filter((v) => !v.face).every((v) => /CROPPED AT THE NECK/.test(v.prompt)));
    for (const a of ANGLES) assert.match(anglePrompt(a), /no people/);
    assert.deepEqual(VIEWS.map((v) => v.id), ["closeup", "three_quarter", "body_front", "body_back"]);
    assert.deepEqual(VIEWS.filter((v) => v.face).map((v) => v.id), ["closeup", "three_quarter"]); // faces only from the face views
    assert.equal(ANGLES.length, 3);
  });

  test("model inputs follow fal's schemas", () => {
    assert.deepEqual(MODELS["nano-pro"].input("p", ["r"], "3:4", 7), { prompt: "p", image_urls: ["r"], aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "png", seed: 7 });
    assert.deepEqual(MODELS.nano2.input("p", ["r"], "2:3", 7).resolution, "1K");
    assert.deepEqual(MODELS.seedream.input("p", ["r", "r2"], "3:4", 7), { prompt: "p", image_urls: ["r", "r2"], image_size: { width: 1920, height: 2560 }, num_images: 1, max_images: 1, seed: 7 });
    const s = MODELS.seedream.input("p", [], "2:3", 1).image_size as { width: number; height: number };
    assert.ok(s.width * s.height >= 2560 * 1440); // Seedream 4.5's minimum
    assert.deepEqual(MODELS.gpt.input("p", ["r"], "3:4", 1), { prompt: "p", image_urls: ["r"], image_size: "1024x1536", quality: "high", input_fidelity: "high", num_images: 1, output_format: "png" });
    assert.equal(MODELS.seedream.endpoint, "fal-ai/bytedance/seedream/v4.5/edit");
  });

  test("estimate: base and worst case (every view made twice more)", () => {
    const e = estimate(["nano-pro", "nano2", "seedream", "gpt"], { views: 4, angles: 3, retries: 2, vision: 2 });
    assert.equal(e.baseUsd.toFixed(2), (7 * (0.15 + 0.08 + 0.04 + 0.24) + 0.02).toFixed(2)); // $3.59
    assert.equal(e.worstUsd.toFixed(2), (e.baseUsd + 4 * 2 * (0.15 + 0.08 + 0.04 + 0.24)).toFixed(2));
    const b = new Budget(0.2);
    assert.ok(b.canSpend(0.15));
    b.spend(0.15);
    assert.equal(b.canSpend(0.08), false);
  });

  test("face score -> green / amber / red on face views; red is made again; body views must show no face", () => {
    const t = { red_below: 0.25, green_from: 0.4, source: "test" };
    assert.deepEqual(classify("closeup", { score: 0.55, face_px: 300 }, t).light, "green");
    assert.deepEqual(classify("closeup", { score: 0.3, face_px: 300 }, t).light, "amber");
    const red = classify("three_quarter", { score: 0.1, face_px: 300 }, t);
    assert.equal(red.light, "red");
    assert.equal(red.regenerate, true);
    assert.match(red.text, /Drifted/);
    assert.equal(classify("closeup", { score: null, note: "no face found" }, t).regenerate, true);
    const body = classify("body_back", { score: null }, t);
    assert.deepEqual([body.light, body.regenerate], ["grey", false]);
    const faceInBody = classify("body_front", { score: 0.5, face_px: 200 }, t);
    assert.deepEqual([faceInBody.light, faceInBody.regenerate], ["red", true]);
    assert.match(faceInBody.text, /cropped at the neck/);
    assert.equal(classify("body_front", { score: 0.1, face_px: 20 }, t).regenerate, false); // a speck, not a face
    assert.equal(classify("three_quarter", { score: 0.1, face_px: 40 }, t).regenerate, false); // too small to judge
    assert.equal(DEFAULT_THRESHOLDS.green_from, 0.363);
  });

  test("angle note: the head turn vs the view asked for", () => {
    assert.equal(angleNote(VIEWS[0], 4), null);
    assert.match(angleNote(VIEWS[1], 5)!, /turned only 5°/);
    assert.equal(angleNote(VIEWS[2], 10), null); // body views are not measured
  });

  test("one retry of a failed request, both request IDs kept", async () => {
    let n = 0;
    const fal = {
      queue: {
        submit: async () => {
          n++;
          if (n === 1) throw Object.assign(new Error("Unprocessable"), { status: 422, body: { detail: "bad image" } });
          return { request_id: `req-${n}` };
        },
        status: async () => ({ status: "COMPLETED" }),
        result: async () => ({ data: { images: [{ url: "u" }] } }),
        cancel: async () => undefined,
      },
    } as never;
    const r = await callModel(fal, "x", {}, { timeoutMs: 1000, pollMs: 1, sleep: async () => {} });
    assert.equal(r.requestId, "req-2");
    assert.match(r.attempts[0].outcome, /bad image/);
  });

  test("actual cost from fal's billing events; no permission said plainly", async () => {
    const seen: string[] = [];
    const ok = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push(url);
      assert.equal(init.headers.Authorization, "Key k");
      return new Response(JSON.stringify({ billing_events: [{ request_id: "a", cost_total: 0.15 }, { request_id: "b", cost_total: 0.04 }], has_more: false }));
    }) as unknown as typeof fetch;
    const r = await actualCosts("k", ["a", "b", "c"], "2026-11-17T00:00:00Z", ok);
    assert.equal(r.status, "ok");
    assert.equal(actualTotal(r), 0.19);
    assert.deepEqual(r.status === "ok" && r.missing, ["c"]);
    assert.match(seen[0], /request_id=a&request_id=b&request_id=c/);
    const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const d = await actualCosts("k", ["a"], "x", denied);
    assert.equal(d.status, "no_permission");
  });

  test("calibration report marks her clips and copies, and says when the check cannot tell them apart", () => {
    const md = calibrationMarkdown({
      reference: "bride.jpg",
      same_picture: [{ variant: "mirrored", score: 0.91 }],
      others: [
        { file: "copy.jpg", frames: 1, faces: 1, best: 0.88, mean: 0.88, role: "copy", probably_same: true },
        { file: "lena again.mp4", frames: 10, faces: 8, best: 0.369, mean: 0.3, role: "her", probably_same: true },
        { file: "b.mp4", frames: 10, faces: 5, best: 0.401, mean: 0.05, role: "other", probably_same: false },
      ],
      thresholds: {
        red_below: 0.431, green_from: 0.501, top_other: 0.401, others_used: 1, her_used: 1, her_range: [0.369, 0.369], copies: 1, overlap: true,
        lowest_same: 0.91, sface_default: 0.363, note: "The face check cannot reliably tell her from some other women here.",
      },
    });
    assert.match(md, /## Clips \(best face per clip\)/);
    assert.match(md, /lena again\.mp4 .*her\*\* \(marked by you\)/);
    assert.match(md, /copy\.jpg .*copy of the reference\*\* \(left out\)/);
    assert.match(md, /\| b\.mp4 .*\| {2}\|/);
    assert.match(md, /Green \(same person\): 0\.501/);
    assert.match(md, /below 0\.431/);
    assert.match(md, /Based on 1 other clip\(s\); the best other person scored 0\.401\./);
    assert.match(md, /Your marked clip\(s\) of her score 0\.369–0\.369\./);
    assert.match(md, /1 clip\(s\) look like the reference picture itself and were left out\./);
    assert.match(md, /cannot reliably tell her/);
    assert.doesNotMatch(md, /probably her/);
  });
});

// ---- the whole pack run ----

describe("pack run (stand-in fal, face check and billing)", () => {
  let tmp: string;
  let server: http.Server;
  let base: string;
  const files = new Map<string, Buffer>();
  const submitted: { endpoint: string; input: Record<string, unknown>; id: string }[] = [];

  const png = (name: string, colour: string, size = "300x400") => {
    const f = path.join(tmp, name);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}`, "-frames:v", "1", f]);
    return f;
  };

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "characters-"));
    server = http.createServer((rq, rs) => {
      const b = files.get(rq.url ?? "");
      if (!b) return void rs.writeHead(404).end();
      rs.writeHead(200, { "content-type": "image/png" }).end(b);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => {
    server?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const fakeFal = () => {
    let n = 0;
    const out = readFileSync(png(`gen.png`, "pink"));
    return {
      storage: {
        upload: async (f: File) => {
          const k = `/up/${++n}-${f.name}`;
          files.set(k, Buffer.from(await f.arrayBuffer()));
          return `${base}${k}`;
        },
      },
      queue: {
        submit: async (endpoint: string, o: { input: Record<string, unknown> }) => {
          const id = `${endpoint.split("/").slice(-2).join("-")}-${submitted.length + 1}`;
          submitted.push({ endpoint, input: o.input, id });
          return { request_id: id };
        },
        status: async () => ({ status: "COMPLETED" }),
        result: async (endpoint: string, o: { requestId: string }) => {
          if (endpoint === "fal-ai/any-llm/vision") return { data: { output: "A woman in her late twenties with an oval face…" } };
          files.set(`/r/${o.requestId}.png`, out);
          return { data: { images: [{ url: `${base}/r/${o.requestId}.png` }] } };
        },
        cancel: async () => undefined,
      },
    } as never;
  };

  // Face scores by model and try: Nano Banana 2's 3/4 face drifts twice then is fine; GPT's close-up always drifts;
  // Seedream's back view shows a face once (not cropped at the neck); body views otherwise have no face.
  const fakeFace = (): FaceTool & { compared: string[]; sheets: SheetSpec[] } => {
    const ok: CheckResult = { file: "", measures: {}, verdict: "Ready", reasons: [{ level: "ok", text: "One face.", check: "faces" }], fixes: [] };
    const compared: string[] = [];
    const sheets: SheetSpec[] = [];
    return {
      compared,
      sheets,
      check: () => ok,
      sceneCheck: () => ({ ...ok, reasons: [{ level: "ok", text: "Size 1920×1080.", check: "size" }] }),
      compare: (_ref, fs) => {
        const f = fs[0];
        compared.push(f);
        const rel = f.split(path.sep).slice(-2).join("/");
        let score: number | null = 0.52;
        if (rel === "nano2/three_quarter.png" || rel === "nano2/three_quarter_try2.png") score = 0.1;
        if (rel.startsWith("gpt/closeup")) score = 0.05;
        if (rel.includes("/body_")) score = rel === "seedream/body_back.png" ? 0.4 : null;
        return { results: [{ file: f, score, face_px: 300, yaw: rel.includes("three_quarter") ? 40 : 3 }] };
      },
      calibrate: () => {
        throw new Error("not used");
      },
      crop: (_i, o) => {
        writeFileSync(o, "x");
        return { file: o };
      },
      sheet: (spec) => {
        sheets.push(spec);
        writeFileSync(spec.out, "jpg");
        return { file: spec.out };
      },
    };
  };

  test("above the cap: stops before uploading, even with --yes", async () => {
    const ref = png("bride.png", "white");
    await assert.rejects(
      run(["pack", "--image", ref, "--scene", ref, "--yes"], { fal: fakeFal(), face: fakeFace(), out: path.join(tmp, "out"), env: {} }),
      (e: Error) => e instanceof Stop && /above the cap of \$3\.00/.test(e.message),
    );
    assert.equal(files.size, 0);
  });

  test("a not-suitable reference stops before any cost", async () => {
    const ref = png("bad.png", "black");
    const face = fakeFace();
    face.check = () => ({ file: "", measures: {}, verdict: "Not suitable", reasons: [{ level: "bad", text: "No face found.", check: "faces" }] });
    await assert.rejects(run(["pack", "--image", ref, "--yes"], { fal: fakeFal(), face, out: path.join(tmp, "out"), env: {} }), /not suitable/);
  });

  test("calibrate stops on a not-suitable reference unless --force", async () => {
    const ref = png("bad2.png", "black");
    const face = fakeFace();
    face.check = () => ({ file: "", measures: {}, verdict: "Not suitable", reasons: [{ level: "bad", text: "No face found.", check: "faces" }] });
    await assert.rejects(run(["calibrate", "--image", ref, "--others", tmp], { face, out: path.join(tmp, "out"), env: {} }), (e: Error) => e instanceof Stop && /not suitable/.test(e.message));
  });

  test("full run: 4 views + 3 angles per model, drifted views made again (max 2), sheets, descriptions, report with actual cost", async () => {
    const ref = png("bride.png", "white");
    const room = png("room.png", "beige", "640x480");
    const face = fakeFace();
    const billing = (async (url: string) => {
      const ids = new URL(url).searchParams.getAll("request_id");
      return new Response(JSON.stringify({ billing_events: ids.map((id) => ({ request_id: id, cost_total: id.includes("vision") ? 0.01 : 0.05 })), has_more: false }));
    }) as unknown as typeof fetch;
    const out = path.join(tmp, "out");
    await run(["pack", "--image", ref, "--scene", room, "--name", "bride", "--max-cost", "8", "--yes"], {
      fal: fakeFal(),
      face,
      out,
      env: { FAL_KEY: "test-key" },
      fetch: billing,
      now: () => new Date("2026-11-17T20:30:00Z"),
      billingWaitMs: 1,
    });
    const dir = path.join(out, "bride", "2026-11-17_2030");
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"));

    // What was sent: the reference (identity + style) for views, the location picture for angles.
    const views = submitted.filter((s) => s.endpoint !== "fal-ai/any-llm/vision");
    const perModel = (ep: string) => views.filter((s) => s.endpoint === ep).length;
    assert.equal(perModel("fal-ai/nano-banana-pro/edit"), 7);
    assert.equal(perModel("fal-ai/bytedance/seedream/v4.5/edit"), 7 + 1); // the back view showed a face: made again
    assert.equal(perModel("fal-ai/nano-banana-2/edit"), 7 + 2); // the 3/4 view made twice more
    assert.equal(perModel("fal-ai/gpt-image-1.5/edit"), 7 + 2); // the close-up made twice more, still drifted
    const nano2tries = views.filter((s) => s.endpoint === "fal-ai/nano-banana-2/edit" && /three-quarter/.test(String(s.input.prompt)));
    assert.deepEqual(nano2tries.map((s) => s.input.seed), [1000, 1001, 1002]);

    const item = (model: string, label: string) => report.items.find((i: { model: string; label: string }) => i.model === model && i.label === label);
    assert.equal(item("nano2", "3/4 face").light, "green");
    assert.equal(item("nano2", "3/4 face").tries.length, 3);
    assert.equal(item("nano2", "3/4 face").file, path.join("nano2", "three_quarter_try3.png"));
    assert.equal(item("gpt", "Close-up face").light, "red");
    assert.match(item("gpt", "Close-up face").text, /best of 3 tries/);
    assert.equal(item("nano-pro", "Full body, front (cropped at the neck)").light, "grey");
    const back = item("seedream", "Full body, back (cropped at the neck)");
    assert.deepEqual([back.light, back.tries.length, back.file], ["grey", 2, path.join("seedream", "body_back_try2.png")]);
    assert.equal(item("seedream", "Wide, from the left").file, path.join("location", "seedream", "wide_left.png"));
    assert.ok(existsSync(path.join(dir, "location", "gpt", "detail.png")));
    assert.ok(readdirSync(path.join(dir, "nano-pro")).includes("body_back.png"));

    // Angles are not face-checked; every view is.
    assert.ok(face.compared.every((f) => !f.includes(`${path.sep}location${path.sep}`)));
    assert.equal(face.sheets.length, 2);
    assert.equal(face.sheets[0].rows.length, 4);
    assert.equal(face.sheets[0].rows[0].cells.length, 5); // reference + 4 views

    assert.equal(readFileSync(path.join(dir, "description.txt"), "utf8").trim().slice(0, 7), "A woman");
    assert.ok(existsSync(path.join(dir, "location-description.txt")));

    // Cost: every request ID asked for, the actual total from fal.
    assert.equal(report.cost.request_ids.length, submitted.length);
    assert.equal(report.cost.actual.status, "ok");
    assert.equal(actualTotal(report.cost.actual), Math.round((views.length * 0.05 + 2 * 0.01) * 100) / 100);
    const md = readFileSync(path.join(dir, "report.md"), "utf8");
    assert.match(md, /Actual, from fal: \$/);
    assert.match(md, /Nano Banana 2 — 2 of 2 face views green · 2 body views to judge by eye/);
    assert.match(md, /GPT Image 1\.5 — 1 of 2 face views green/);
    assert.equal(packMarkdown(report), md);
  });

  test("retries stop at the cap, and the report says so", async () => {
    submitted.length = 0;
    const ref = png("bride2.png", "white");
    const face = fakeFace();
    face.compare = (_r, fs) => ({ results: [{ file: fs[0], score: 0.05, face_px: 300, yaw: 0 }] }); // everything drifts
    const out = path.join(tmp, "out2");
    await run(["pack", "--image", ref, "--models", "seedream", "--max-cost", "0.25", "--yes"], { fal: fakeFal(), face, out, env: {}, now: () => new Date("2026-11-17T21:00:00Z") });
    const report = JSON.parse(readFileSync(path.join(out, "bride2", "2026-11-17_2100", "report.json"), "utf8"));
    // $0.25: 4 views ($0.16) + description ($0.01) + 2 retries ($0.08) = $0.25, then nothing more.
    assert.equal(report.cost.estimate_spent_usd, 0.25);
    assert.ok(report.items.some((i: { text: string }) => /the cap of \$0\.25 was reached/.test(i.text)));
    assert.equal(report.cost.actual.status, "failed"); // no key: not asked
  });

  test("a result that cannot be downloaded: not regenerated, URL kept; fetch then recovers it (also via queue.result for old reports)", async () => {
    submitted.length = 0;
    const ref = png("bride3.png", "white");
    const room = png("room3.png", "beige", "640x480");
    const out = path.join(tmp, "out3");
    const base0 = fakeFal() as unknown as { queue: { submit: (e: string, o: { input: Record<string, unknown> }) => Promise<{ request_id: string }>; result: (e: string, o: { requestId: string }) => Promise<unknown> } };
    let submits = 0;
    let resultCalls = 0;
    const brokenIds = new Set<string>(); // request ids whose result URL answers 500
    let n = 0;
    const fal = {
      ...base0,
      queue: {
        ...base0.queue,
        submit: async (e: string, o: { input: Record<string, unknown> }) => {
          submits++;
          const r = await base0.queue.submit(e, o);
          // One model: 4 views + 1 redo of the back view, then the first angle (wide_left) is the 6th image request.
          if (e !== "fal-ai/any-llm/vision" && ++n === 6) brokenIds.add(r.request_id);
          return r;
        },
        result: async (e: string, o: { requestId: string }) => {
          resultCalls++;
          return base0.queue.result(e, o);
        },
      },
    } as never;
    const origCreate = server.listeners("request")[0] as (rq: http.IncomingMessage, rs: http.ServerResponse) => void;
    server.removeAllListeners("request");
    server.on("request", (rq, rs) => {
      const id = /\/r\/(.*)\.png/.exec(rq.url ?? "")?.[1];
      if (id && brokenIds.has(id)) return void rs.writeHead(500).end();
      origCreate(rq, rs);
    });
    const face = fakeFace();
    const sleeps: number[] = [];
    await run(["pack", "--image", ref, "--scene", room, "--name", "bride", "--models", "seedream", "--max-cost", "5", "--yes"], {
      fal, face, out, env: {}, now: () => new Date("2026-11-18T09:00:00Z"), sleep: async (ms) => void sleeps.push(ms),
    });
    const dir = path.join(out, "bride", "2026-11-18_0900");
    const rj = () => JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"));
    let report = rj();
    const lost = report.items.find((i: { id: string }) => i.id === "wide_left");
    assert.match(lost.text, /^Generated but not downloaded \(HTTP 500\): run pnpm characters fetch "/);
    assert.equal(lost.file, null);
    assert.equal(lost.tries.length, 1); // no retry spent
    assert.ok(lost.tries[0].request_id && /^http/.test(lost.tries[0].url));
    assert.deepEqual(sleeps.slice(0, 5), [1000, 2000, 4000, 8000, 15000]);
    assert.equal(submitted.filter((s) => s.endpoint !== "fal-ai/any-llm/vision").length, 8); // 4 views + 1 redo (back view) + 3 angles; the lost one is not made again
    assert.match(readFileSync(path.join(dir, "report.md"), "utf8"), /not downloaded/);
    const target = path.join(dir, "location", "seedream", "wide_left.png");
    assert.equal(existsSync(target), false);

    // fetch: the URL answers 200 now. No new submit, no regeneration.
    brokenIds.clear();
    const submitsBefore = submits;
    const sheetsBefore = face.sheets.length;
    await run(["fetch", dir], { fal, face, env: { FAL_KEY: "k" }, out, sleep: async () => {} });
    assert.equal(submits, submitsBefore);
    assert.equal(existsSync(target), true);
    report = rj();
    const got = report.items.find((i: { id: string }) => i.id === "wide_left");
    assert.equal(got.file, path.join("location", "seedream", "wide_left.png"));
    assert.equal(got.light, "grey");
    assert.equal(got.text, "Location: judge by eye (no face check).");
    assert.doesNotMatch(readFileSync(path.join(dir, "report.md"), "utf8"), /not downloaded/);
    assert.ok(face.sheets.length > sheetsBefore);
    await run(["fetch", dir], { fal, face, env: { FAL_KEY: "k" }, out }); // nothing left: still fine
    assert.equal(submits, submitsBefore);

    // An old report (no url on the try): the result is asked from fal again.
    rmSync(target);
    report = rj();
    const t0 = report.items.find((i: { id: string }) => i.id === "wide_left");
    t0.file = null;
    t0.tries[0].file = null;
    t0.tries[0].text = "Failed: the image could not be downloaded (HTTP 500)";
    delete t0.tries[0].url;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
    const before = resultCalls;
    await run(["fetch", dir], { fal, face, env: { FAL_KEY: "k" }, out });
    assert.equal(resultCalls, before + 1);
    assert.equal(submits, submitsBefore);
    assert.equal(existsSync(target), true);
    assert.equal(rj().items.find((i: { id: string }) => i.id === "wide_left").light, "grey");
    assert.ok(rj().items.find((i: { id: string }) => i.id === "wide_left").tries[0].url);
    server.removeAllListeners("request");
    server.on("request", origCreate);
  });
});

describe("download retries", () => {
  const stub = (statuses: number[]) => {
    const calls: string[] = [];
    const waits: number[] = [];
    const fetchImpl = (async (u: string) => {
      calls.push(u);
      const st = statuses[Math.min(calls.length - 1, statuses.length - 1)];
      return new Response(st === 200 ? "img" : "no", { status: st });
    }) as unknown as typeof fetch;
    return { calls, waits, fetchImpl, sleep: async (ms: number) => void waits.push(ms) };
  };
  test("500, 500, then 200: saved after 3 tries, with backoff and no real waiting", async () => {
    const s = stub([500, 500, 200]);
    let written = "";
    await download("http://x/a.png", "f", (_f, d) => void (written = d.toString()), s.sleep, s.fetchImpl);
    assert.equal(s.calls.length, 3);
    assert.deepEqual(s.waits, [1000, 2000]);
    assert.equal(written, "img");
  });
  test("a 404 gives up at once; a 500 forever gives up after 6 tries", async () => {
    const a = stub([404]);
    await assert.rejects(download("u", "f", () => {}, a.sleep, a.fetchImpl), /could not be downloaded \(HTTP 404\)/);
    assert.equal(a.calls.length, 1);
    const b = stub([500]);
    await assert.rejects(download("u", "f", () => {}, b.sleep, b.fetchImpl), /HTTP 500/);
    assert.equal(b.calls.length, 6);
    assert.deepEqual(b.waits, [1000, 2000, 4000, 8000, 15000]);
  });
});

describe("importUrl (dynamic imports of absolute paths)", () => {
  test("Windows paths become file:// URLs, spaces and accents encoded", () => {
    assert.equal(importUrl("D:\\videomaker\\services\\audio\\scripts\\common.mjs", true), "file:///D:/videomaker/services/audio/scripts/common.mjs");
    assert.equal(importUrl("D:\\Mes Vidéos\\x.mjs", true), "file:///D:/Mes%20Vid%C3%A9os/x.mjs");
  });
  test("POSIX paths become file:// URLs", () => {
    assert.equal(importUrl("/home/x/common.mjs", false), "file:///home/x/common.mjs");
  });
  test("the URL is importable here, also from a folder with a space and an accent", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "imp orté-"));
    try {
      const f = path.join(dir, "m.mjs");
      writeFileSync(f, "export const ok = 42;\n");
      const m = (await import(importUrl(f))) as { ok: number };
      assert.equal(m.ok, 42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("no source file imports a path directly (only package names or importUrl)", () => {
    const root = path.join(REPO_ROOT, "spikes");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!["node_modules", "out", "test"].includes(e.name)) walk(p); }
        else if (e.name.endsWith(".ts")) files.push(p);
      }
    };
    walk(path.join(root, "characters"));
    walk(path.join(root, "lipsync"));
    assert.ok(files.some((f) => f.endsWith(`${path.sep}face.ts`)) && files.some((f) => f.endsWith(`${path.sep}lipsync.ts`)), "the scan found the spikes' files");
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/await import\(([^)]*)/g)) {
        if (!/^\s*("[^"./][^"]*"|importUrl\()/.test(m[1])) bad.push(`${path.relative(root, f)}: import(${m[1]}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
