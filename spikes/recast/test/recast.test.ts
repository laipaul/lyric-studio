// Tests of the recast spike: matching requests to fal's own field lists, prices, the clip's shape restored, and a whole
// run on a made-up song and character with stand-ins for fal (a local HTTP server serves the "results") and for the
// local judge. Nothing goes to fal.ai and no key is used.
//   pnpm recast:test
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { createSong } from "../../../packages/video/src/node/library";
import { createCard, readCardFile, writeCardFile, cardRoot, versionDir } from "../../../packages/video/src/node/characters/cards";
import { openWorkspace } from "../../../packages/db/src/index";

import { run, Stop, stepEstimate } from "../recast";
import type { Judgement } from "../src/judge";
import { verdict } from "../src/judge";
import { cropShare, fitArgs, kling720Args, kling720Size, padArgs, padLayout, probeVideo, findTools, ffmpeg, type Tools } from "../src/media";
import { pickClips, splitList, type SongClips } from "../src/inputs";
import { keyframeSize, METHODS, parseMethods } from "../src/methods";
import { costOf } from "../src/pricing";
import { gateVerdict, type GateScores } from "../src/judge";
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
const H3 = openapi("minimax/h3-max/recast", { video_url: { type: "string" }, reference_image_urls: { type: "array", items: { type: "string" } }, prompt: { type: "string" }, seed: { type: "integer" }, enhance_realism: { type: "boolean" }, resolution: { type: "string", enum: ["768P", "1080P"] } }, ["video_url", "reference_image_urls"]);
const KLING = openapi("fal-ai/kling-video/o1/video-to-video/edit", { prompt: { type: "string" }, video_url: { type: "string" }, keep_audio: { type: "boolean" }, image_urls: { type: "array", items: { type: "string" } }, elements: { type: "array", items: { type: "object" } } }, ["prompt", "video_url"]);
const NANO = openapi("fal-ai/nano-banana-pro/edit", { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, aspect_ratio: { type: "string", enum: ["1:1", "3:4", "4:3", "9:16", "16:9"] }, resolution: { type: "string", enum: ["1K", "2K", "4K"] }, num_images: { type: "integer" }, output_format: { type: "string" }, seed: { type: "integer" } }, ["prompt", "image_urls"]);
const SEEDREAM = openapi("fal-ai/bytedance/seedream/v4.5/edit", { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, image_size: { type: "object" }, num_images: { type: "integer" }, max_images: { type: "integer" }, seed: { type: "integer" } }, ["prompt", "image_urls"]);
const GPT = openapi("fal-ai/gpt-image-1.5/edit", { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, image_size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536"] }, quality: { type: "string" }, input_fidelity: { type: "string" }, num_images: { type: "integer" }, output_format: { type: "string" } }, ["prompt", "image_urls"]);
const schemaOf = (doc: ReturnType<typeof openapi>, id: string): EndpointSchema => ({ id, fields: parseOpenApi(id, doc), fetchedAt: "" });

describe("requests built from fal's own field lists", () => {
  test("parseOpenApi: fields, required, enums through $ref, optional anyOf", () => {
    const f = parseOpenApi("w", WAN);
    assert.deepEqual(f.map((x) => [x.name, x.required]), [["video_url", true], ["image_url", true], ["resolution", false], ["seed", false], ["prompt", false]]);
    assert.deepEqual(f.find((x) => x.name === "resolution")!.enum, ["480p", "720p"]);
    assert.equal(f.find((x) => x.name === "seed")!.type, "integer");
  });

  test("mapInput: one picture field gets the first picture; an array gets them all; resolution from the offers", () => {
    const wan = mapInput(schemaOf(WAN, "wan"), { video: "V", images: ["C", "R", "T"], resolution: ["720p", "480p"], seed: 42, prompt: "p" });
    assert.deepEqual(wan.input, { video_url: "V", image_url: "C", prompt: "p", seed: 42, resolution: "720p" });
    assert.match(wan.notes[0], /takes one picture \(image_url\): the first was sent/);
    assert.deepEqual(wan.missing, []);
    const none = mapInput(schemaOf(H3, "h3"), { video: "V" });
    assert.deepEqual(none.missing, ["reference_image_urls"]);
  });

  test("H3: ONE photo goes to reference_image_urls as a 1-item array, enhance_realism is sent, 1080P", () => {
    const h3 = mapInput(schemaOf(H3, "h3"), { video: "V", images: ["C"], resolution: ["1080P"], prompt: "p", seed: 42, extra: { enhance_realism: true } });
    assert.deepEqual(h3.input, { video_url: "V", reference_image_urls: ["C"], prompt: "p", seed: 42, enhance_realism: true, resolution: "1080P" });
  });

  test("Kling: the new first frame goes to image_urls, the character to elements", () => {
    const k = mapInput(schemaOf(KLING, "kling"), { video: "V", images: ["KF"], elements: [{ frontal: "CU", refs: ["TQ", "REF"] }], prompt: "p", extra: { keep_audio: false } });
    assert.deepEqual(k.input, { video_url: "V", image_urls: ["KF"], elements: [{ frontal_image_url: "CU", reference_image_urls: ["TQ", "REF"] }], prompt: "p", keep_audio: false });
  });

  test("extra fields are sent only when fal lists a field of that exact name", () => {
    const m = mapInput(schemaOf(WAN, "wan"), { video: "V", images: ["C"], extra: { enhance_realism: true } });
    assert.ok(!("enhance_realism" in m.input));
    assert.match(m.notes.join(" "), /lists no field "enhance_realism"/);
  });

  test("image_size: an object for Seedream, text for GPT Image; Nano gets aspect_ratio and 2K", () => {
    const sd = mapInput(schemaOf(SEEDREAM, "sd"), { images: ["a"], prompt: "p", imageSize: { width: 1, height: 2 }, imageSizeText: "1024x1536" });
    assert.deepEqual(sd.input.image_size, { width: 1, height: 2 });
    const g = mapInput(schemaOf(GPT, "gpt"), { images: ["a"], prompt: "p", imageSize: { width: 1, height: 2 }, imageSizeText: "1024x1536" });
    assert.equal(g.input.image_size, "1024x1536");
    const n = mapInput(schemaOf(NANO, "nano"), { images: ["a"], prompt: "p", aspect: 544 / 720, resolution: ["2K"], seed: 43 });
    assert.deepEqual(n.input, { image_urls: ["a"], prompt: "p", seed: 43, resolution: "2K", aspect_ratio: "3:4" });
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
    assert.equal(costOf({ unitPrice: 0.08, unit: "second", source: "fal" }, { seconds: 5, fpsFactor: 1.5 })!.usd.toFixed(2), "0.60");
    assert.equal(costOf({ unitPrice: 0.04, unit: "image", source: "fal" }, {})!.usd, 0.04);
    assert.equal(costOf({ unitPrice: 1, unit: "tokens", source: "fal" }, {}), null, "an unknown unit is never counted as one unit");
  });

  test("Seedream keyframe: the clip's shape, at least 2560x1440 pixels", () => {
    const k = keyframeSize(9 / 16);
    assert.ok(k.width * k.height >= 2560 * 1440 && Math.abs(k.width / k.height - 9 / 16) < 0.01, JSON.stringify(k));
  });

  test("methods by name or letter", () => {
    assert.deepEqual(parseMethods(undefined), ["wan", "h3", "keyframe", "kwan"]);
    assert.deepEqual(parseMethods("A,c,D,f,kling"), ["wan", "keyframe", "aleph", "kwan"]);
    assert.throws(() => parseMethods("sora"), /Unknown method/);
  });

  test("H3 for 5.21 s at 1080P: output seconds + input tokens (fal docs, 18 Nov 2026)", () => {
    const info = { file: "x", width: 544, height: 720, fps: 24, durationS: 5.21 };
    const e = stepEstimate(METHODS.h3.steps[0], "minimax/h3-max/recast", { unitPrice: 0.085, unit: "second", source: "fal" }, info, "high", { keyframeModel: "nano-pro", seed: 42 });
    assert.ok(!("unknown" in e));
    const expected = 5.21 * 0.17 + ((Math.ceil(5.21 * 6750) - 4096) / 1000) * 0.022; // 0.886 + 0.684
    assert.ok(Math.abs((e as { usd: number }).usd - expected) < 0.01, String((e as { usd: number }).usd));
    assert.ok(Math.abs(expected - (0.886 + 0.68)) < 0.01);
    assert.equal((e as { source: string }).source, "fal docs");
    const draft = stepEstimate(METHODS.h3.steps[0], "x", undefined, { ...info, durationS: 4 }, "draft", { keyframeModel: "nano-pro", seed: 42 }) as { usd: number };
    assert.ok(Math.abs(draft.usd - (0.085 * 5 + ((Math.ceil(4 * 6750) - 4096) / 1000) * 0.022)) < 0.001, "5 s minimum");
  });

  test("Wan: frames ÷ 16 at the resolution's rate; Kling 0.168 per second; keyframe models", () => {
    const info = { file: "x", width: 544, height: 720, fps: 24, durationS: 5.21 };
    const o = { keyframeModel: "nano-pro" as const, seed: 42 };
    assert.ok(Math.abs((stepEstimate(METHODS.wan.steps[0], "w", undefined, info, "high", o) as { usd: number }).usd - 0.08 * 5.21 * 1.5) < 0.001);
    assert.ok(Math.abs((stepEstimate(METHODS.wan.steps[0], "w", undefined, info, "draft", o) as { usd: number }).usd - 0.04 * 5.21 * 1.5) < 0.001);
    assert.ok(Math.abs((stepEstimate(METHODS.keyframe.steps[1], "k", undefined, info, "high", o) as { usd: number }).usd - 0.168 * 5.21) < 0.001);
    const kf = METHODS.keyframe.steps[0];
    assert.equal((stepEstimate(kf, "k", undefined, info, "high", o) as { usd: number }).usd, 0.15);
    assert.equal((stepEstimate(kf, "k", undefined, info, "high", { ...o, keyframeModel: "seedream" }) as { usd: number }).usd, 0.04);
    assert.equal((stepEstimate(kf, "k", undefined, info, "high", { ...o, keyframeModel: "gpt" }) as { usd: number }).usd, 0.24);
  });

  test("the face gate: passes only for the character; fails for the original person, no face, below the red line", () => {
    const g = (character: number | null, original: number | null): GateScores => ({ faces: 1, character, original });
    assert.equal(gateVerdict(g(0.6, 0.1), 0.25).passed, true);
    assert.match(gateVerdict(g(0.3, 0.8), 0.25).reason!, /still shows the original person .*: the video step was not sent\./);
    assert.match(gateVerdict(g(null, null), 0.25).reason!, /shows no face/);
    assert.match(gateVerdict(g(0.1, null), 0.25).reason!, /below the red line 0\.25/);
    assert.equal(gateVerdict(g(0.5, null), 0.25).passed, true);
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

describe("padding to 9:16 and back", () => {
  test("the rectangle maths: 544x720 gets 544x968 with the clip at y=124; landscape and narrow clips; always even", () => {
    assert.deepEqual(padLayout(544, 720), { canvas: { width: 544, height: 968 }, clip: { x: 0, y: 124, width: 544, height: 720 } });
    assert.deepEqual(padLayout(1920, 1080).canvas, { width: 1920, height: 3414 });
    const narrow = padLayout(400, 1000); // taller than 9:16: bars left and right
    assert.deepEqual(narrow.canvas, { width: 562, height: 1000 });
    assert.deepEqual(narrow.clip, { x: 80, y: 0, width: 400, height: 1000 });
    for (const [w, h] of [[544, 720], [217, 385], [1080, 1920], [300, 301]]) {
      const l = padLayout(w, h);
      assert.ok(l.canvas.width % 2 === 0 && l.canvas.height % 2 === 0 && l.clip.x % 2 === 0 && l.clip.y % 2 === 0);
      assert.ok(l.clip.x + l.clip.width <= l.canvas.width && l.clip.y + l.clip.height <= l.canvas.height);
      assert.ok(Math.abs(l.canvas.width / l.canvas.height - 9 / 16) < 0.01, JSON.stringify(l));
    }
  });

  test("pad, then a model's 720x1280 video fitted back: the clip's size, padding removed, centre kept", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "recast-pad-"));
    try {
      const clip = path.join(dir, "clip.mp4");
      ff("-f", "lavfi", "-i", "testsrc2=s=216x288:r=24:d=1", "-pix_fmt", "yuv420p", clip);
      const padded = path.join(dir, "pad.mp4");
      ffmpeg(tools, padArgs(clip, { width: 216, height: 288 }, padded));
      const p = probeVideo(tools, padded)!;
      assert.deepEqual([p.width, p.height], [216, 384]);
      // the model returns the padded picture at another size (720x1280)
      const raw = path.join(dir, "raw.mp4");
      ff("-i", padded, "-vf", "scale=720:1280", "-pix_fmt", "yuv420p", raw);
      const fit = path.join(dir, "fit.mp4");
      ffmpeg(tools, fitArgs(raw, { width: 216, height: 288, fps: 24, durationS: 1 }, fit, true));
      const f = probeVideo(tools, fit)!;
      assert.deepEqual([f.width, f.height], [216, 288]);
      // the fitted clip is the padded picture's middle again: close to the original clip
      const r = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "info", "-i", fit, "-i", clip, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" });
      const psnr = Number(/average:([\d.]+)/.exec(r.stderr)?.[1]);
      assert.ok(psnr > 22, `psnr ${psnr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Kling's copy: both sides at least 720, same shape, even, at least 24 fps", () => {
    assert.deepEqual(kling720Size(544, 720), { width: 720, height: 954 });
    assert.deepEqual(kling720Size(216, 384), { width: 720, height: 1280 });
    assert.deepEqual(kling720Size(1920, 1080), { width: 1920, height: 1080 });
    const dir = mkdtempSync(path.join(os.tmpdir(), "recast-kling-"));
    try {
      const clip = path.join(dir, "c.mp4");
      ff("-f", "lavfi", "-i", "testsrc2=s=272x360:r=16:d=1", "-pix_fmt", "yuv420p", clip);
      const out = path.join(dir, "k.mp4");
      ffmpeg(tools, kling720Args(clip, { width: 272, height: 360 }, 16, out));
      const p = probeVideo(tools, out)!;
      assert.ok(p.width >= 720 && p.height >= 720 && p.width % 2 === 0 && p.height % 2 === 0 && p.fps >= 23.99, JSON.stringify(p));
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
    // 01 is 6 s (MiniMax needs 5 s), 02 and 03 are 3.2 s (Kling needs 3 s); 03 is landscape.
    for (const [n, c, s, d] of [["01_closeup.mp4", "red", "216x384", 6], ["02_medium.mp4", "blue", "216x384", 3.2], ["03_wide.mp4", "green", "384x216", 3.2]] as const)
      ff("-f", "lavfi", "-i", `color=c=${c}:s=${s}:r=24:d=${d}`, "-pix_fmt", "yuv420p", path.join(clips, n));
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

  // fal's descriptions, its price list and billing.
  const docs: Record<string, unknown> = {
    "fal-ai/wan/v2.2-14b/animate/replace": WAN,
    "minimax/h3-max/recast": H3,
    "fal-ai/kling-video/o1/video-to-video/edit": KLING,
    "fal-ai/nano-banana-pro/edit": NANO,
    "fal-ai/bytedance/seedream/v4.5/edit": SEEDREAM,
    "fal-ai/gpt-image-1.5/edit": GPT,
  };
  let priceList: { endpoint_id: string; unit_price: number; unit: string }[] = [{ endpoint_id: "fal-ai/wan/v2.2-14b/animate/replace", unit_price: 0.08, unit: "second" }, { endpoint_id: "minimax/h3-max/recast", unit_price: 0.085, unit: "second" }];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("openapi")) {
      const id = url.searchParams.get("endpoint_id")!;
      return docs[id] ? new Response(JSON.stringify(docs[id])) : new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    }
    if (url.pathname.endsWith("/models/pricing")) return new Response(JSON.stringify({ prices: priceList }));
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
      result: async (endpoint: string) => ({ data: /seedream|nano|gpt-image/.test(endpoint) ? { images: [{ url: `${base}/image.png` }] } : { video: { url: `${base}/result.mp4` } }, requestId: "x" }),
      cancel: async () => undefined,
    },
  } as never;
  const judged: { result: string; refs: string[] }[] = [];
  const judge = async (o: { original: string; result: string; refs: string[]; green: number }) => {
    judged.push(o);
    return { frames: 4, face: { level: "ok", text: "The character's face in 100% of the frames.", share_matching: 1, median: 0.7, weakest: { t: 1.1, score: 0.6 }, old_face_at: [], green_from: o.green }, environment: { level: "warn", text: "The scene changed somewhat around the person (structure 0.50, colour 0.90).", ssim: 0.5, colour: 0.9, background_share: 0.6 }, motion: { level: "ok", text: "Motion kept.", pose_distance: 0.1, flow_correlation: 0.9, camera_drift: 0 } } as Judgement;
  };
  // The free face check of a new first frame: answers come from a queue (default: the character, not the original person).
  const gates: GateScores[] = [];
  const gateCalls: { frame: string; keyframe: string; refs: string[] }[] = [];
  const gate = async (o: { frame: string; keyframe: string; refs: string[] }) => {
    gateCalls.push(o);
    return gates.shift() ?? ({ faces: 1, character: 0.7, original: 0.1 } as GateScores);
  };
  const deps = () => ({ fal, fetch: fakeFetch, judge, gate, env });
  const argv = ["Wedding Day", "--character", "Bride No 2", "--clips", "1,2,3", "--keyframe-clips", "1"];
  const quiet = async <T>(f: () => Promise<T>): Promise<{ out: T; lines: string[] }> => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (m?: unknown) => lines.push(String(m ?? ""));
    try {
      return { out: await f(), lines };
    } finally {
      console.log = log;
    }
  };
  const submitsTo = (re: RegExp, from = 0) => submits.slice(from).filter((s) => re.test(s.endpoint));

  test("--list shows the Storyboard cards with their numbers", async () => {
    const { lines } = await quiet(() => run(["Wedding Day", "--list"], deps()));
    assert.ok(lines.some((l) => /^\s+1\s+01_closeup\.mp4/.test(l)), lines.join("\n"));
  });

  test("without --yes: the estimate per method with its source, the keyframe counted once, nothing uploaded; above the cap: stopped", async () => {
    const { lines } = await quiet(async () => {
      assert.equal(await run([...argv, "--max-cost", "10"], deps()), null);
      await assert.rejects(run([...argv, "--max-cost", "0.5"], deps()), (e: Error) => e instanceof Stop && /above the cap of \$0\.50: nothing was uploaded/.test(e.message));
    });
    const text = lines.join("\n");
    assert.match(text, /Estimated total: \$\d+\.\d\d \(A \$\d+\.\d\d · B \$\d+\.\d\d · C \$\d+\.\d\d · F \$\d+\.\d\d; cap \$10\.00\)/);
    assert.match(text, /C Keyframe \+ Kling\s+skipped: not on this clip in this run/);
    assert.match(text, /B MiniMax H3 Max Recast\s+skipped: MiniMax needs a clip of at least 5 s \(this one is 3\.2 s\)/);
    assert.match(text, /New first frame: \$0\.15 \(fal docs, 18 Nov 2026: \$0\.15 per image \(Nano Banana Pro/);
    assert.match(text, /New first frame: \$0\.00 \(made once for the other keyframe method: counted there\)/);
    assert.match(text, /Kling O1 video edit: \$1\.01 \(fal docs, 18 Nov 2026: \$0\.168 per second × 6\.00 s\)/);
    assert.match(text, /Wan 2\.2 Animate Replace: \$0\.\d\d \(fal docs, 18 Nov 2026: \$0\.08 per video second at 720p/);
    assert.equal(uploads.length, 0);
    assert.ok(!existsSync(path.join(wsDir, "recast")));
  });

  test("a price nobody can compute (unknown unit, no formula) stops the run before anything is uploaded", async () => {
    const kf = METHODS.keyframe.steps[0];
    const old = kf.priceFormula;
    const oldList = priceList;
    kf.priceFormula = "no-such-formula";
    priceList = [...priceList, { endpoint_id: "fal-ai/nano-banana-pro/edit", unit_price: 5, unit: "tokens" }];
    try {
      await quiet(async () => {
        await assert.rejects(run([...argv, "--max-cost", "10", "--yes"], deps()), (e: Error) => e instanceof Stop && /Cannot estimate .*New first frame.*tokens.*nothing was uploaded/.test(e.message));
      });
    } finally {
      kf.priceFormula = old;
      priceList = oldList;
    }
    assert.equal(uploads.length, 0);
    assert.equal(submits.length, 0);
  });

  test("--keyframe-only: only the first frame is made (once, for C and F), face-checked, no video is sent", async () => {
    const from = submits.length;
    const up0 = uploads.length;
    const { out: runDir, lines } = await quiet(() => run(["Wedding Day", "--character", "Bride No 2", "--clips", "1", "--keyframe-only", "--max-cost", "1", "--yes"], deps()));
    assert.match(lines.join("\n"), /First frames only \(Nano Banana Pro\): no video is made/);
    assert.equal(submits.length - from, 1, JSON.stringify(submits.slice(from).map((s) => s.endpoint)));
    const nano = submits[from];
    assert.equal(nano.endpoint, "fal-ai/nano-banana-pro/edit");
    // image 1 = the frame, image 2 = the close-up, image 3 = the 3/4 face; no depth map, no reference picture
    const imgs = nano.input.image_urls as string[];
    assert.equal(imgs.length, 3);
    assert.match(imgs[0], /first_frame/);
    assert.match(imgs[1], /closeup/);
    assert.match(imgs[2], /three_quarter/);
    assert.match(String(nano.input.prompt), /^Replace the person in image 1 with the person in images 2 and 3/);
    assert.equal(nano.input.resolution, "2K");
    assert.equal(nano.input.aspect_ratio, "9:16");
    assert.ok(!uploads.slice(up0).some((u) => /padded_916|kling_720|original\.mp4/.test(u)), "no clip was uploaded");
    assert.equal(gateCalls.length, 1);
    assert.deepEqual(gateCalls[0].refs, [refFiles[0], refFiles[1]]);
    const report = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    const [c, f] = report.clips[0].results;
    assert.deepEqual([c.letter, c.status, f.letter, f.status], ["C", "done", "F", "done"]);
    assert.equal(c.keyframe!.passed, true);
    assert.equal(c.keyframe!.attempts[0].character, 0.7);
    assert.ok(existsSync(path.join(runDir!, report.clips[0].folder, "keyframe.png")));
    assert.ok(!report.clips[0].results.some((m) => m.output));
  });

  test("--keyframe-model: Seedream gets image_size and no resolution, GPT Image the portrait size; bad names are refused", async () => {
    const from = submits.length;
    const base4 = ["Wedding Day", "--character", "Bride No 2", "--clips", "1", "--keyframe-only", "--max-cost", "1", "--yes"];
    await quiet(() => run([...base4, "--keyframe-model", "seedream", "--methods", "keyframe"], deps()));
    await quiet(() => run([...base4, "--keyframe-model", "gpt", "--methods", "keyframe"], deps()));
    const sd = submits[from];
    const gp = submits[from + 1];
    assert.equal(sd.endpoint, "fal-ai/bytedance/seedream/v4.5/edit");
    assert.ok(typeof sd.input.image_size === "object" && (sd.input.image_size as { width: number }).width >= 1440);
    assert.equal(gp.endpoint, "fal-ai/gpt-image-1.5/edit");
    assert.equal(gp.input.image_size, "1024x1536");
    assert.equal(gp.input.quality, "high");
    assert.equal((gp.input.image_urls as string[]).length, 3);
    await assert.rejects(run([...base4, "--keyframe-model", "dalle"], deps()), (e: Error) => e instanceof Stop && /--keyframe-model is seedream, nano-pro, gpt/.test(e.message));
  });

  test("the face gate: a first frame that still shows the original person gets one more try; then no video is paid for", async () => {
    const from = submits.length;
    const up0 = uploads.length;
    gates.push({ faces: 1, character: 0.2, original: 0.8 }, { faces: 1, character: 0.15, original: 0.9 });
    const { out: runDir } = await quiet(() => run(["Wedding Day", "--character", "Bride No 2", "--clips", "1", "--methods", "keyframe,kwan", "--max-cost", "5", "--yes"], deps()));
    const sent = submits.slice(from);
    assert.deepEqual(sent.map((s) => s.endpoint), ["fal-ai/nano-banana-pro/edit", "fal-ai/nano-banana-pro/edit"], "two tries, no Kling, no Wan");
    assert.deepEqual(sent.map((s) => s.input.seed), [42, 43], "a new seed for the second try");
    assert.ok(!uploads.slice(up0).some((u) => /padded_916|kling_720/.test(u)));
    const report = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    for (const m of report.clips[0].results) {
      assert.equal(m.status, "failed");
      assert.match(m.reason!, /^The new first frame still shows the original person \(character score 0\.15, original person 0\.90\): the video step was not sent\.$/);
      assert.equal(m.keyframe!.attempts.length, 2);
      assert.equal(m.keyframe!.passed, false);
    }
    const md = readFileSync(path.join(runDir!, "report.md"), "utf8");
    assert.match(md, /try 1 seed 42: face vs character 0\.20, vs original person 0\.80 ×; try 2 seed 43: face vs character 0\.15, vs original person 0\.90 ×/);
  });

  test("the face gate: the second try passes and the video steps go on; the cap can forbid the second try", async () => {
    const from = submits.length;
    gates.push({ faces: 1, character: 0.2, original: 0.8 }, { faces: 1, character: 0.6, original: 0.1 });
    const { out: runDir } = await quiet(() => run(["Wedding Day", "--character", "Bride No 2", "--clips", "1", "--methods", "keyframe", "--max-cost", "5", "--yes"], deps()));
    assert.deepEqual(submitsTo(/./, from).map((s) => s.endpoint), ["fal-ai/nano-banana-pro/edit", "fal-ai/nano-banana-pro/edit", "fal-ai/kling-video/o1/video-to-video/edit"]);
    const report = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    assert.equal(report.clips[0].results[0].status, "done");
    assert.deepEqual(report.clips[0].results[0].keyframe!.attempts.map((a) => a.passed), [false, true]);
    // the cap: Kling 6 s = $1.008 + first frame $0.15 = $1.16; a second first frame would be above $1.2
    const from2 = submits.length;
    gates.push({ faces: 1, character: 0.2, original: 0.8 });
    const { out: dir2 } = await quiet(() => run(["Wedding Day", "--character", "Bride No 2", "--clips", "1", "--methods", "keyframe", "--max-cost", "1.2", "--yes"], deps()));
    assert.equal(submits.length - from2, 1, "no second try above the cap, no video");
    const r2 = JSON.parse(readFileSync(path.join(dir2!, "report.json"), "utf8")) as RunReport;
    assert.equal(r2.clips[0].results[0].status, "failed");
    assert.match(r2.clips[0].results[0].keyframe!.reason!, /above the cap/);
  });

  test("--yes: A on every clip, B only on the 6 s clip, C and F on card 1 with ONE first frame; the request shapes; judged; report with a BOM", async () => {
    const from = submits.length;
    const up0 = uploads.length;
    const { out: runDir } = await quiet(() => run([...argv, "--max-cost", "10", "--yes"], deps()));
    assert.ok(runDir && runDir.startsWith(path.join(wsDir, "recast", "Wedding Day")), String(runDir));
    const sent = submits.slice(from);
    const ups = uploads.slice(up0);
    // Only the close-up, 3/4 face and reference picture of the card were sent: never the body views.
    assert.ok(!ups.some((u) => /body_/.test(u)), ups.join(", "));
    assert.equal(ups.filter((u) => /closeup\.png|three_quarter|reference\.png/.test(u)).length, 3, ups.join(", "));
    const wan = sent.filter((s) => s.endpoint === "fal-ai/wan/v2.2-14b/animate/replace");
    const h3 = sent.filter((s) => s.endpoint === "minimax/h3-max/recast");
    const nano = sent.filter((s) => s.endpoint === "fal-ai/nano-banana-pro/edit");
    const kling = sent.filter((s) => s.endpoint === "fal-ai/kling-video/o1/video-to-video/edit");
    assert.equal(wan.length, 4, "A on three clips + F on one");
    assert.equal(h3.length, 1, "B only on the 6 s clip");
    assert.equal(nano.length, 1, "the first frame is made ONCE although C and F both use it");
    assert.equal(kling.length, 1);
    // A: the close-up on the padded clip, 720p
    const a1 = wan.find((w) => /padded_916/.test(String(w.input.video_url)) && /closeup/.test(String(w.input.image_url)))!;
    assert.ok(a1, JSON.stringify(wan.map((w) => w.input)));
    assert.equal(a1.input.resolution, "720p");
    assert.equal(wan.filter((w) => /closeup/.test(String(w.input.image_url))).length, 3);
    // F: the new first frame, padded like the clip
    const f1 = wan.find((w) => /keyframe_pad916/.test(String(w.input.image_url)))!;
    assert.ok(f1 && /padded_916/.test(String(f1.input.video_url)));
    // B: exactly one reference image (the close-up), enhance_realism, 1080P, the clip as it is
    assert.deepEqual((h3[0].input.reference_image_urls as string[]).length, 1);
    assert.match((h3[0].input.reference_image_urls as string[])[0], /closeup/);
    assert.equal(h3[0].input.enhance_realism, true);
    assert.equal(h3[0].input.resolution, "1080P");
    assert.match(String(h3[0].input.video_url), /original\.mp4/);
    // C: Kling gets the new first frame as image_urls, the character as an element, and a clip of at least 720 px
    assert.deepEqual(kling[0].input.image_urls, [`${base}/image.png`]);
    const el = kling[0].input.elements as { frontal_image_url: string; reference_image_urls: string[] }[];
    assert.equal(el.length, 1);
    assert.match(el[0].frontal_image_url, /closeup/);
    assert.equal(el[0].reference_image_urls.length, 2);
    assert.match(String(kling[0].input.prompt), /^Replace the main person in the video with @Element1/);
    assert.match(String(kling[0].input.prompt), /@Image1/);
    assert.equal(kling[0].input.keep_audio, false);
    assert.match(String(kling[0].input.video_url), /kling_720/);
    const rep0 = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    const k720 = probeVideo(tools, path.join(runDir!, rep0.clips[0].folder, "kling_720.mp4"))!;
    assert.ok(k720.width >= 720 && k720.height >= 720 && k720.fps >= 23.99, JSON.stringify(k720));

    const report = rep0;
    assert.equal(report.clips.length, 3);
    const c1 = report.clips[0];
    assert.deepEqual(c1.results.map((m) => [m.letter, m.status]), [["A", "done"], ["B", "done"], ["C", "done"], ["F", "done"]]);
    assert.deepEqual(report.clips[1].results.map((m) => [m.letter, m.status]), [["A", "done"], ["B", "skipped"], ["C", "skipped"], ["F", "skipped"]]);
    assert.match(report.clips[1].results[1].reason!, /MiniMax needs a clip of at least 5 s/);
    const cost = (letter: string) => c1.results.find((m) => m.letter === letter)!.steps.find((s) => s.key === "keyframe")!.estimated_usd;
    assert.deepEqual([cost("C"), cost("F")], [0.15, 0], "the first frame is counted once");
    assert.ok(c1.results.filter((m) => m.status === "done").every((m) => m.steps.filter((s) => s.request_id).length >= 1));
    for (const c of report.clips) {
      const dir = path.join(runDir!, c.folder);
      const p = probeVideo(tools, path.join(dir, "A_wan.mp4"))!;
      assert.equal(`${p.width}x${p.height}`, `${c.width}x${c.height}`, "the clip's shape (padding removed)");
      assert.ok(Math.abs(p.durationS - c.duration_s) < 0.06 && Math.abs(p.fps - 24) < 0.01);
      assert.ok(existsSync(path.join(dir, "comparison.mp4")));
      assert.ok(existsSync(path.join(dir, "padded_916.mp4")));
    }
    assert.ok(c1.results.find((m) => m.letter === "A")!.output!.padding_removed);
    assert.ok(!c1.results.find((m) => m.letter === "B")!.output!.padding_removed);
    assert.ok(existsSync(path.join(runDir!, "comparison.mp4")));
    assert.ok(existsSync(path.join(runDir!, c1.folder, "first_frame.png")) && existsSync(path.join(runDir!, c1.folder, "keyframe.png")) && existsSync(path.join(runDir!, c1.folder, "keyframe_pad916.png")));
    assert.ok(!existsSync(path.join(runDir!, c1.folder, "depth.png")), "no depth map any more");
    assert.match(c1.results[0].verdict!, /^Good — 2 things to improve: The scene changed somewhat/);
    assert.equal(judged.length >= 6, true);
    assert.deepEqual(judged[judged.length - 1].refs, refFiles);
    assert.match(report.billing_note, /could not be read .*dashboard/);
    const raw = readFileSync(path.join(runDir!, "report.md"), "utf8");
    assert.equal(raw.charCodeAt(0), 0xfeff, "report.md starts with a BOM so Windows PowerShell shows ✓ × → –");
    assert.ok(readFileSync(path.join(runDir!, "report.md")).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    const md = raw.slice(1);
    assert.match(md, /## Card 1: 01_closeup\.mp4/);
    assert.match(md, /padding was removed/);
    assert.match(md, /fal request IDs/);
    assert.match(md, /face vs character 0\.70, vs original person 0\.10 ✓/);
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
    const b = r2.clips[0].results.find((m) => m.letter === "B")!;
    b.status = "failed";
    b.steps[0].status = "failed";
    rmSync(path.join(runDir!, r2.clips[0].folder, "B_h3.mp4"));
    writeFileSync(path.join(runDir!, "report.json"), JSON.stringify(r2));
    const before = submits.length;
    await quiet(() => run(["fetch", runDir!], deps()));
    const r3 = JSON.parse(readFileSync(path.join(runDir!, "report.json"), "utf8")) as RunReport;
    assert.equal(r3.clips[0].results.find((m) => m.letter === "B")!.status, "done");
    assert.ok(existsSync(path.join(runDir!, r3.clips[0].folder, "B_h3.mp4")));
    assert.equal(submits.length, before, "fetch sends nothing new");
    assert.match(reportMarkdown(r3), /Card 2/);
  });
});

describe("list options survive PowerShell's unquoted 7,9,10", () => {
  const mk = (position: number, name: string) => ({ position, label: name, clip: { name, kind: "video", omit: false } });
  const song = { title: "Wedding Day", items: [mk(7, "a.mp4"), mk(9, "b.mp4"), mk(10, "c.mp4"), mk(11, "My clip 1.mp4")] } as unknown as SongClips;
  test("clips: spaces, commas, both", () => {
    for (const spec of ["7 9 10", "7,9,10", "7, 9 ,10"]) {
      assert.deepEqual(splitList(spec), ["7", "9", "10"]);
      assert.deepEqual(pickClips(song, spec).map((c) => c.name), ["a.mp4", "b.mp4", "c.mp4"]);
    }
  });
  test("a file name with a space stays whole", () => {
    assert.deepEqual(splitList("My clip 1.mp4, a.mp4"), ["My clip 1.mp4", "a.mp4"]);
    assert.deepEqual(pickClips(song, "My clip 1.mp4").map((c) => c.name), ["My clip 1.mp4"]);
  });
  test("methods accept spaces", () => {
    assert.deepEqual(parseMethods("wan h3"), ["wan", "h3"]);
    assert.deepEqual(parseMethods("wan h3 keyframe kwan"), ["wan", "h3", "keyframe", "kwan"]);
  });
});
