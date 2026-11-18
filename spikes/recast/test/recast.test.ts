// Tests of the recast spike: matching requests to fal's own field lists, prices, the clip's shape restored, and a whole
// run on a made-up song and character with stand-ins for fal (a local HTTP server serves the "results") and for the
// local judge. Nothing goes to fal.ai and no key is used.
//   pnpm recast:test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { createSong } from "../../../packages/video/src/node/library";
import { createCard, readCardFile, writeCardFile, cardRoot, versionDir } from "../../../packages/video/src/node/characters/cards";
import { openWorkspace } from "../../../packages/db/src/index";

import { run, Stop } from "../recast";
import type { Judgement } from "../src/judge";
import { verdict } from "../src/judge";
import { cropShare, fitArgs, probeVideo, findTools, ffmpeg, type Tools } from "../src/media";
import { keyframeSize, parseMethods } from "../src/methods";
import { costOf } from "../src/pricing";
import { reportMarkdown, type RunReport } from "../src/report";
import { findUrl, mapInput, parseOpenApi, type EndpointSchema } from "../src/schema";

// A fal-style OpenAPI document for an endpoint with the given input properties.
function openapi(id: string, props: Record<string, unknown>, required: string[]) {
  return {
    paths: { [`/${id}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } }, [`/${id}/requests/{request_id}`]: { get: {} } },
    components: { schemas: { Input: { type: "object", properties: props, required }, Res: { enum: ["480p", "720p"], type: "string" } } },
  };
}
const WAN = openapi("fal-ai/wan/v2.2-14b/animate/replace", { video_url: { type: "string" }, image_url: { type: "string" }, resolution: { $ref: "#/components/schemas/Res" }, seed: { anyOf: [{ type: "integer" }, { type: "null" }] }, prompt: { type: "string" } }, ["video_url", "image_url"]);
const H3 = openapi("fal-ai/minimax-h3-max-recast", { video_url: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, resolution: { type: "string", enum: ["768P", "1080P"] } }, ["video_url", "image_urls"]);
const DEPTH = openapi("fal-ai/imageutils/depth", { image_url: { type: "string" } }, ["image_url"]);
const SEEDREAM = openapi("fal-ai/bytedance/seedream/v4.5/edit", { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, image_size: { type: "object" }, seed: { type: "integer" } }, ["prompt", "image_urls"]);
const SEEDANCE = openapi("bytedance/seedance-2.0/reference-to-video", { prompt: { type: "string" }, video_urls: { type: "array", items: { type: "string" } }, image_url: { type: "string" }, resolution: { type: "string", enum: ["480p", "720p"] }, duration: { type: "string", enum: ["5", "10"] }, aspect_ratio: { type: "string", enum: ["16:9", "9:16", "3:4", "1:1"] } }, ["prompt", "video_urls"]);
const schemaOf = (doc: ReturnType<typeof openapi>, id: string): EndpointSchema => ({ id, fields: parseOpenApi(id, doc), fetchedAt: "" });

describe("requests built from fal's own field lists", () => {
  test("parseOpenApi: fields, required, enums through $ref, optional anyOf", () => {
    const f = parseOpenApi("w", WAN);
    assert.deepEqual(f.map((x) => [x.name, x.required]), [["video_url", true], ["image_url", true], ["resolution", false], ["seed", false], ["prompt", false]]);
    assert.deepEqual(f.find((x) => x.name === "resolution")!.enum, ["480p", "720p"]);
    assert.equal(f.find((x) => x.name === "seed")!.type, "integer");
  });

  test("mapInput: one picture field gets the first picture; an array gets them all; resolution, duration, aspect from the offers", () => {
    const wan = mapInput(schemaOf(WAN, "wan"), { video: "V", images: ["C", "R", "T"], resolution: ["720p", "480p"], seed: 42, prompt: "p" });
    assert.deepEqual(wan.input, { video_url: "V", image_url: "C", prompt: "p", seed: 42, resolution: "720p" });
    assert.match(wan.notes[0], /takes one picture \(image_url\): the first was sent/);
    assert.deepEqual(wan.missing, []);
    const h3 = mapInput(schemaOf(H3, "h3"), { video: "V", images: ["C", "T", "R"], resolution: ["768p", "720p"] });
    assert.deepEqual(h3.input, { video_url: "V", image_urls: ["C", "T", "R"], resolution: "768P" });
    const sd = mapInput(schemaOf(SEEDANCE, "sd"), { video: "V", firstFrame: "K", prompt: "m", resolution: ["480p"], durationS: 4.2, aspect: 9 / 16 });
    assert.deepEqual(sd.input, { video_urls: ["V"], image_url: "K", prompt: "m", resolution: "480p", duration: "5", aspect_ratio: "9:16" });
    const none = mapInput(schemaOf(H3, "h3"), { video: "V" });
    assert.deepEqual(none.missing, ["image_urls"]);
  });

  test("findUrl finds the video or picture in fal's answer", () => {
    assert.equal(findUrl({ video: { url: "https://x/a.mp4" } }, "video"), "https://x/a.mp4");
    assert.equal(findUrl({ videos: [{ url: "https://x/b" }] }, "video"), "https://x/b");
    assert.equal(findUrl({ image: { url: "https://x/d.png" } }, "image"), "https://x/d.png");
    assert.equal(findUrl({ images: [{ url: "https://x/e.jpg", width: 1 }] }, "image"), "https://x/e.jpg");
    assert.equal(findUrl({ nothing: 1 }, "video"), null);
  });
});

describe("prices, sizes, methods", () => {
  test("costOf by fal's unit", () => {
    assert.equal(costOf({ unitPrice: 0.08, unit: "second", source: "fal" }, { seconds: 5, fpsFactor: 1.5 }).usd.toFixed(2), "0.60");
    assert.equal(costOf({ unitPrice: 0.04, unit: "image", source: "fal" }, {}).usd, 0.04);
    assert.match(costOf({ unitPrice: 1, unit: "tokens", source: "fal" }, {}).note!, /not one the spike knows/);
  });

  test("Seedream keyframe: the clip's shape, at least 2560x1440 pixels", () => {
    const k = keyframeSize(9 / 16);
    assert.ok(k.width * k.height >= 2560 * 1440 && Math.abs(k.width / k.height - 9 / 16) < 0.01, JSON.stringify(k));
  });

  test("methods by name or letter", () => {
    assert.deepEqual(parseMethods(undefined), ["wan", "h3", "keyframe"]);
    assert.deepEqual(parseMethods("A,c,D"), ["wan", "keyframe", "aleph"]);
    assert.throws(() => parseMethods("sora"), /Unknown method/);
  });

  test("verdict in plain words", () => {
    const ok = { level: "ok", text: "fine." } as const;
    const j = (face: object, env: object = ok, motion: object = ok) => ({ frames: 4, face, environment: env, motion }) as unknown as Judgement;
    assert.match(verdict(j(ok), null), /^Ready to use/);
    assert.match(verdict(j(ok, { level: "warn", text: "The scene changed somewhat." }), null), /^Good — one thing to improve: The scene changed somewhat/);
    assert.match(verdict(j({ level: "problem", text: "Old face." }), null), /^Not usable yet: Old face/);
  });
});

const tools = findTools(process.env as Record<string, string>) as Tools;
const ff = (...a: string[]) => execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-v", "error", ...a]);

describe("the clip's shape is kept", () => {
  test("a model's square, slower, longer video comes back at the clip's size, frame rate and length", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "recast-fit-"));
    try {
      const raw = path.join(dir, "raw.mp4");
      ff("-f", "lavfi", "-i", "testsrc2=s=480x480:r=16:d=3", "-pix_fmt", "yuv420p", raw);
      const out = path.join(dir, "fit.mp4");
      ffmpeg(tools, fitArgs(raw, { width: 300, height: 400, fps: 24, durationS: 2 }, out));
      const p = probeVideo(tools, out)!;
      assert.equal(`${p.width}x${p.height}`, "300x400");
      assert.ok(Math.abs(p.fps - 24) < 0.01 && Math.abs(p.durationS - 2) < 0.06, JSON.stringify(p));
      assert.equal(cropShare({ width: 480, height: 480 }, { width: 300, height: 400 }), 0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a whole run with stand-ins", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "recast-run-"));
  const wsDir = path.join(root, "workspace");
  const files = path.join(root, "served");
  let server: http.Server;
  let base = "";
  const env = { WORKSPACE_DIR: wsDir, FAL_KEY: "test-key-not-real" };
  const submits: { endpoint: string; input: Record<string, unknown> }[] = [];
  const uploads: string[] = [];
  let refFiles: string[] = [];

  before(async () => {
    mkdirSync(files, { recursive: true });
    ff("-f", "lavfi", "-i", "testsrc2=s=480x480:r=16:d=3", "-pix_fmt", "yuv420p", path.join(files, "result.mp4"));
    ff("-f", "lavfi", "-i", "color=c=gray:s=64x64", "-frames:v", "1", path.join(files, "image.png"));
    server = http.createServer((req, res) => {
      const f = path.join(files, path.basename(req.url ?? ""));
      if (!existsSync(f)) return res.writeHead(404).end();
      res.writeHead(200).end(readFileSync(f));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const ws = openWorkspace(wsDir);
    const lyrics = path.join(root, "lyrics.txt");
    writeFileSync(lyrics, "Here we stand\nOn our wedding day\n");
    const song = path.join(root, "Wedding Day.wav");
    ff("-f", "lavfi", "-i", "sine=frequency=330:duration=3", song);
    const { id } = await createSong(ws, { song, lyrics });
    const { songPathsById } = await import("../../../packages/video/src/node/song-folder");
    const clips = songPathsById(ws, id).clips!;
    mkdirSync(clips, { recursive: true });
    for (const [n, c, s] of [["01_closeup.mp4", "red", "216x384"], ["02_medium.mp4", "blue", "216x384"], ["03_wide.mp4", "green", "384x216"]] as const)
      ff("-f", "lavfi", "-i", `color=c=${c}:s=${s}:r=24:d=2`, "-pix_fmt", "yuv420p", path.join(clips, n));
    const pic = path.join(root, "p.png");
    ff("-f", "lavfi", "-i", "color=c=pink:s=60x80", "-frames:v", "1", pic);
    const card = createCard(ws, { kind: "character", name: "Bride No 2", picture: readFileSync(pic), fileName: "p.png" });
    const croot = cardRoot(ws, card);
    mkdirSync(versionDir(croot, 1), { recursive: true });
    for (const v of ["closeup", "three_quarter", "body_front", "body_back"]) writeFileSync(path.join(versionDir(croot, 1), `${v}.png`), readFileSync(pic));
    const file = readCardFile(croot);
    file.versions[0].status = "locked";
    writeCardFile(croot, file);
    refFiles = [path.join(versionDir(croot, 1), "closeup.png"), path.join(versionDir(croot, 1), "three_quarter.png"), path.join(croot, file.reference)];
    ws.close();
  });
  after(() => {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  });

  // fal's descriptions (the first H3 ID is unknown to "fal": the second is used), its price list and billing.
  const docs: Record<string, unknown> = {
    "fal-ai/wan/v2.2-14b/animate/replace": WAN,
    "fal-ai/minimax-h3-max-recast": H3,
    "fal-ai/imageutils/depth": DEPTH,
    "fal-ai/bytedance/seedream/v4.5/edit": SEEDREAM,
    "bytedance/seedance-2.0/reference-to-video": SEEDANCE,
  };
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("openapi")) {
      const id = url.searchParams.get("endpoint_id")!;
      return docs[id] ? new Response(JSON.stringify(docs[id])) : new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    }
    if (url.pathname.endsWith("/models/pricing"))
      return new Response(JSON.stringify({ prices: [{ endpoint_id: "fal-ai/wan/v2.2-14b/animate/replace", unit_price: 0.08, unit: "second" }, { endpoint_id: "fal-ai/minimax-h3-max-recast", unit_price: 0.3, unit: "second" }] }));
    if (url.pathname.endsWith("/billing-events")) return new Response("", { status: 403 });
    return new Response("", { status: 404 });
  }) as typeof fetch;

  let n = 0;
  const fal = {
    storage: {
      upload: async (f: File) => {
        uploads.push(f.name);
        return `${base}/upload-${++n}-${f.name}`;
      },
    },
    queue: {
      submit: async (endpoint: string, o: { input: Record<string, unknown> }) => {
        submits.push({ endpoint, input: o.input });
        return { request_id: `req-${submits.length}` };
      },
      status: async () => ({ status: "COMPLETED" }),
      result: async (endpoint: string) => ({ data: /depth|seedream/.test(endpoint) ? { image: { url: `${base}/image.png` } } : { video: { url: `${base}/result.mp4` } }, requestId: "x" }),
      cancel: async () => undefined,
    },
  } as never;
  const judged: { result: string; refs: string[] }[] = [];
  const judge = async (o: { original: string; result: string; refs: string[]; green: number }) => {
    judged.push(o);
    return { frames: 4, face: { level: "ok", text: "The character's face in 100% of the frames.", share_matching: 1, median: 0.7, weakest: { t: 1.1, score: 0.6 }, old_face_at: [], green_from: o.green }, environment: { level: "warn", text: "The scene changed somewhat around the person (structure 0.50, colour 0.90).", ssim: 0.5, colour: 0.9, background_share: 0.6 }, motion: { level: "ok", text: "Motion kept.", pose_distance: 0.1, flow_correlation: 0.9, camera_drift: 0 } } as Judgement;
  };
  const deps = () => ({ fal, fetch: fakeFetch, judge, env });
  const argv = ["Wedding Day", "--character", "Bride No 2", "--clips", "1,2,3", "--keyframe-clips", "1"];

  test("--list shows the Storyboard cards with their numbers", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (m?: unknown) => lines.push(String(m ?? ""));
    try {
      await run(["Wedding Day", "--list"], deps());
    } finally {
      console.log = log;
    }
    assert.ok(lines.some((l) => /^\s+1\s+01_closeup\.mp4/.test(l)), lines.join("\n"));
  });

  test("without --yes: the estimate per method, nothing uploaded; above the cap: stopped", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (m?: unknown) => lines.push(String(m ?? ""));
    try {
      assert.equal(await run([...argv, "--max-cost", "10"], deps()), null);
      await assert.rejects(run([...argv, "--max-cost", "0.5"], deps()), (e: Error) => e instanceof Stop && /above the cap of \$0\.50: nothing was uploaded/.test(e.message));
    } finally {
      console.log = log;
    }
    const text = lines.join("\n");
    assert.match(text, /Estimated total: \$\d+\.\d\d \(A \$\d+\.\d\d · B \$\d+\.\d\d · C \$\d+\.\d\d; cap \$10\.00\)/);
    assert.match(text, /C Keyframe \+ Seedance\s+skipped: not on this clip in this run/);
    assert.match(text, /New first frame \(Seedream 4\.5, depth-guided\): \$0\.04 \(\$0\.04 per image; price not confirmed by fal\)/);
    assert.equal(uploads.length, 0);
    assert.ok(!existsSync(path.join(wsDir, "recast")));
  });

  test("--yes: each clip recast by A and B, C on card 1 only; shape kept; judged; report, request IDs, comparison", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (m?: unknown) => lines.push(String(m ?? ""));
    let runDir: string | null;
    try {
      runDir = await run([...argv, "--max-cost", "10", "--yes"], deps());
    } finally {
      console.log = log;
    }
    assert.ok(runDir && runDir.startsWith(path.join(wsDir, "recast", "Wedding Day")), String(runDir));
    // Only the close-up, 3/4 face and reference picture of the card were sent: never the body views.
    assert.ok(!uploads.some((u) => /body_/.test(u)), uploads.join(", "));
    assert.equal(uploads.filter((u) => /closeup|three_quarter|reference|p\.png/.test(u)).length, 3, uploads.join(", "));
    const wan = submits.filter((s) => s.endpoint === "fal-ai/wan/v2.2-14b/animate/replace");
    const h3 = submits.filter((s) => s.endpoint === "fal-ai/minimax-h3-max-recast");
    const sd = submits.filter((s) => s.endpoint === "bytedance/seedance-2.0/reference-to-video");
    assert.equal(wan.length, 3);
    assert.equal(h3.length, 3);
    assert.equal(sd.length, 1, "C only on card 1");
    assert.match(String(wan[0].input.image_url), /closeup/);
    assert.equal(wan[0].input.resolution, "720p");
    assert.equal((h3[0].input.image_urls as string[]).length, 3);
    assert.equal(h3[0].input.resolution, "768P");
    const seedream = submits.find((s) => s.endpoint === "fal-ai/bytedance/seedream/v4.5/edit")!;
    assert.equal((seedream.input.image_urls as string[]).length, 5, "first frame, depth map, close-up, 3/4, reference");
    assert.equal(sd[0].input.image_url, `${base}/image.png`, "the new first frame");
    assert.match(String((sd[0].input.video_urls as string[])[0]), /original\.mp4/, "the original clip as the motion reference");
    assert.equal(sd[0].input.resolution, "480p");

    const report = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    assert.equal(report.clips.length, 3);
    const c1 = report.clips[0];
    assert.deepEqual(c1.results.map((m) => [m.letter, m.status]), [["A", "done"], ["B", "done"], ["C", "done"]]);
    assert.deepEqual(report.clips[2].results.map((m) => [m.letter, m.status]), [["A", "done"], ["B", "done"], ["C", "skipped"]]);
    assert.ok(c1.results.every((m) => m.steps.every((s) => s.request_id)), "every request ID saved");
    for (const c of report.clips) {
      const dir = path.join(runDir!, c.folder);
      const p = probeVideo(tools, path.join(dir, "A_wan.mp4"))!;
      assert.equal(`${p.width}x${p.height}`, `${c.width}x${c.height}`, "the clip's shape");
      assert.ok(Math.abs(p.durationS - c.duration_s) < 0.06 && Math.abs(p.fps - 24) < 0.01);
      assert.ok(existsSync(path.join(dir, "comparison.mp4")));
    }
    assert.ok(existsSync(path.join(runDir!, "comparison.mp4")));
    assert.ok(existsSync(path.join(runDir!, c1.folder, "first_frame.png")) && existsSync(path.join(runDir!, c1.folder, "keyframe.png")));
    assert.match(c1.results[0].verdict!, /^Good — 2 things to improve: The scene changed somewhat .* The model changed the picture's shape \(480×480\)/);
    assert.equal(judged.length, 7);
    assert.deepEqual(judged[0].refs, refFiles);
    assert.match(report.billing_note, /could not be read .*dashboard/);
    const md = readFileSync(path.join(runDir!, "report.md"), "utf8");
    assert.match(md, /## Card 1: 01_closeup\.mp4/);
    assert.match(md, /fal request IDs/);
    // The clips folder is untouched.
    const { songPathsById } = await import("../../../packages/video/src/node/song-folder");
    const ws = openWorkspace(wsDir);
    try {
      const { findSong } = await import("../src/inputs");
      assert.deepEqual(readdirSync(songPathsById(ws, findSong(ws, "Wedding Day").id).clips!).filter((f) => f.endsWith(".mp4")).sort(), ["01_closeup.mp4", "02_medium.mp4", "03_wide.mp4"]);
    } finally {
      ws.close();
    }

    // fetch: a result that ran on fal but did not download is got later, free.
    const r2 = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    const b = r2.clips[1].results.find((m) => m.letter === "B")!;
    b.status = "failed";
    b.steps[0].status = "failed";
    rmSync(path.join(runDir!, r2.clips[1].folder, "B_h3.mp4"));
    writeFileSync(path.join(runDir!, "report.json"), JSON.stringify(r2));
    const before = submits.length;
    console.log = () => undefined;
    try {
      await run(["fetch", runDir!], deps());
    } finally {
      console.log = log;
    }
    const r3 = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    assert.equal(r3.clips[1].results.find((m) => m.letter === "B")!.status, "done");
    assert.ok(existsSync(path.join(runDir!, r3.clips[1].folder, "B_h3.mp4")));
    assert.equal(submits.length, before, "fetch sends nothing new");
    assert.match(reportMarkdown(r3), /Card 2/);
  });
});
