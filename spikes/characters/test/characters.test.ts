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
import { actualCosts, callModel } from "../src/fal";
import { angleNote, anglePrompt, ANGLES, Budget, classify, DEFAULT_THRESHOLDS, estimate, MODELS, VIEWS, viewPrompt } from "../src/plan";

describe("plan", () => {
  test("every view asks for the reference as identity AND style; locations keep the room, no people", () => {
    for (const v of VIEWS) assert.match(viewPrompt(v), /BOTH the identity and the style reference/);
    assert.match(viewPrompt(VIEWS[0]), /grey studio background/);
    for (const a of ANGLES) assert.match(anglePrompt(a), /no people/);
    assert.deepEqual(VIEWS.map((v) => v.id), ["front", "three_quarter", "profile", "full_body"]);
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

  test("face score -> green / amber / red; red is made again; profiles and tiny faces are judged by eye", () => {
    const t = { red_below: 0.25, green_from: 0.4, source: "test" };
    assert.deepEqual(classify("front", { score: 0.55, face_px: 300 }, t).light, "green");
    assert.deepEqual(classify("front", { score: 0.3, face_px: 300 }, t).light, "amber");
    const red = classify("three_quarter", { score: 0.1, face_px: 300 }, t);
    assert.equal(red.light, "red");
    assert.equal(red.regenerate, true);
    assert.match(red.text, /Drifted/);
    assert.equal(classify("front", { score: null, note: "no face found" }, t).regenerate, true);
    const prof = classify("profile", { score: null }, t);
    assert.deepEqual([prof.light, prof.regenerate], ["grey", false]);
    assert.equal(classify("profile", { score: 0.1, face_px: 200 }, t).regenerate, false);
    assert.equal(classify("full_body", { score: 0.1, face_px: 40 }, t).regenerate, false);
    assert.equal(DEFAULT_THRESHOLDS.green_from, 0.363);
  });

  test("angle note: the head turn vs the view asked for", () => {
    assert.equal(angleNote(VIEWS[0], 4), null);
    assert.match(angleNote(VIEWS[1], 5)!, /turned only 5°/);
    assert.equal(angleNote(VIEWS[2], 10), null); // a profile is not measured
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

  test("calibration report says which clips were left out as probably her", () => {
    const md = calibrationMarkdown({
      reference: "bride.jpg",
      same_picture: [{ variant: "mirrored", score: 0.91 }],
      others: [
        { file: "a.mp4", frames: 10, faces: 8, best: 0.71, mean: 0.6, probably_same: true },
        { file: "b.mp4", frames: 10, faces: 5, best: 0.18, mean: 0.05, probably_same: false },
      ],
      thresholds: { red_below: 0.21, green_from: 0.363, top_other: 0.18, others_used: 1, probably_same: 1, lowest_same: 0.91, sface_default: 0.363, note: null },
    });
    assert.match(md, /\*\*probably her\*\* \(left out\)/);
    assert.match(md, /Green \(same person\): 0\.363/);
    assert.match(md, /below 0\.21/);
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

  // Face scores by model and try: Nano Banana 2's 3/4 view drifts twice then is fine; GPT's front always drifts.
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
        if (rel.startsWith("gpt/front")) score = 0.05;
        if (rel.endsWith("profile.png")) score = null;
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
    assert.equal(perModel("fal-ai/bytedance/seedream/v4.5/edit"), 7);
    assert.equal(perModel("fal-ai/nano-banana-2/edit"), 7 + 2); // the 3/4 view made twice more
    assert.equal(perModel("fal-ai/gpt-image-1.5/edit"), 7 + 2); // the front made twice more, still drifted
    const nano2tries = views.filter((s) => s.endpoint === "fal-ai/nano-banana-2/edit" && /three-quarter/.test(String(s.input.prompt)));
    assert.deepEqual(nano2tries.map((s) => s.input.seed), [1000, 1001, 1002]);

    const item = (model: string, label: string) => report.items.find((i: { model: string; label: string }) => i.model === model && i.label === label);
    assert.equal(item("nano2", "3/4 view").light, "green");
    assert.equal(item("nano2", "3/4 view").tries.length, 3);
    assert.equal(item("nano2", "3/4 view").file, path.join("nano2", "three_quarter_try3.png"));
    assert.equal(item("gpt", "Front portrait").light, "red");
    assert.match(item("gpt", "Front portrait").text, /best of 3 tries/);
    assert.equal(item("seedream", "Profile").light, "grey");
    assert.equal(item("seedream", "Wide, from the left").file, path.join("location", "seedream", "wide_left.png"));
    assert.ok(existsSync(path.join(dir, "location", "gpt", "detail.png")));
    assert.ok(readdirSync(path.join(dir, "nano-pro")).includes("full_body.png"));

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
    assert.match(md, /Nano Banana 2 — 3 of 4 views green \(1 to judge by eye\)/);
    assert.match(md, /GPT Image 1\.5 — 2 of 4 views green/);
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
