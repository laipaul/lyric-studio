// Tests of the lip-sync spike: the pure logic, and the whole pipeline on a made-up song with a stand-in fal client
// (a local HTTP server plays fal's part: nothing goes to fal.ai, no key is used).
//   pnpm lipsync:test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { checkResult, reportMarkdown, verdict, type JobReport } from "../src/checks";
import { comparisonArgs } from "../src/media";
import { clipTooShort, DEFAULT_PROVIDERS, estimateCost, FALLBACK_PROVIDER, infinitalkFrames, klingSize, needsFallback, parseSelection, providerLimit, resolveWindows, safeName, type Line } from "../src/plan";
import { PROVIDERS, runWithRetry } from "../src/providers";
import { REPO_ROOT } from "../src/song";
import { run, Stop } from "../lipsync";

const LINES: Line[] = [
  { number: 1, text: "Here we stand", startMs: 1000, endMs: 3500, isHook: false },
  { number: 2, text: "On our wedding day", startMs: 4000, endMs: 6500, isHook: true },
  { number: 3, text: "All my love", startMs: 7000, endMs: 9500, isHook: true },
  { number: 4, text: "A very long last line", startMs: 10000, endMs: 19000, isHook: true },
  { number: 5, text: "(not timed yet)", startMs: null, endMs: null, isHook: false },
];

describe("which part of the song", () => {
  test("--lines, chorus:N and --from/--to", () => {
    assert.deepEqual(parseSelection("12,13", undefined, undefined), { kind: "lines", numbers: [12, 13] });
    assert.deepEqual(parseSelection("chorus:2", undefined, undefined), { kind: "chorus", count: 2 });
    assert.deepEqual(parseSelection(undefined, "61.2", "66.8"), { kind: "range", fromS: 61.2, toS: 66.8 });
    assert.throws(() => parseSelection("12", "1", "2"), /either/);
    assert.throws(() => parseSelection("0,x", undefined, undefined), /line numbers/);
    assert.throws(() => parseSelection(undefined, "5", "4"), /after/);
  });

  test("one window per line (never merged), padded, with the song's lyric offset, clamped to the song", () => {
    const w = resolveWindows(LINES, { kind: "lines", numbers: [2, 3] }, { padS: 0.2, offsetMs: 100, songDurationS: 20 });
    assert.equal(w.length, 2);
    assert.deepEqual([w[0].label, w[0].startS, w[0].endS, w[0].durationS], ["line2", 3.9, 6.8, 2.9]);
    assert.deepEqual([w[1].label, w[1].sungStartS, w[1].startS], ["line3", 7.1, 6.9]);
    const end = resolveWindows(LINES, { kind: "lines", numbers: [4] }, { padS: 2, offsetMs: 0, songDurationS: 20 });
    assert.equal(end[0].endS, 20); // not past the song's end
    const start = resolveWindows(LINES, { kind: "lines", numbers: [1] }, { padS: 5, offsetMs: 0, songDurationS: 20 });
    assert.equal(start[0].startS, 0);
  });

  test("chorus:2 = the first two chorus lines; errors in plain words", () => {
    assert.deepEqual(resolveWindows(LINES, { kind: "chorus", count: 2 }, { padS: 0, offsetMs: 0, songDurationS: null }).map((w) => w.label), ["line2", "line3"]);
    assert.throws(() => resolveWindows(LINES, { kind: "lines", numbers: [9] }, { padS: 0, offsetMs: 0, songDurationS: null }), /has 5 lines/);
    assert.throws(() => resolveWindows(LINES, { kind: "lines", numbers: [5] }, { padS: 0, offsetMs: 0, songDurationS: null }), /no timing/);
    assert.throws(() => resolveWindows(LINES.filter((l) => !l.isHook), { kind: "chorus", count: 1 }, { padS: 0, offsetMs: 0, songDurationS: null }), /no lines marked as chorus/);
  });

  test("a clip shorter than the part stops that line (no looping)", () => {
    assert.equal(clipTooShort(6, 5.9), null);
    assert.match(clipTooShort(5, 5.9)!, /at least 5\.9 s/);
    assert.match(clipTooShort(8, 5.9, 3)!, /from 3 s/);
  });
});

describe("providers", () => {
  test("singing defaults to InfiniteTalk (whole face); Sync only as the fallback; Kling only when asked", () => {
    assert.deepEqual(DEFAULT_PROVIDERS, ["infinitetalk"]);
    assert.equal(FALLBACK_PROVIDER, "sync");
    assert.equal(needsFallback([{ status: "done", problem: false }]), false);
    assert.equal(needsFallback([{ status: "failed", problem: false }]), true);
    assert.equal(needsFallback([{ status: "skipped", problem: false }]), true);
    assert.equal(needsFallback([{ status: "done", problem: true }]), true); // wrong length / shape / does not play
    assert.equal(needsFallback([{ status: "failed", problem: false }, { status: "done", problem: false }]), false);
  });

  test("estimated cost per fal's price rules", () => {
    assert.equal(estimateCost("sync", 6).toFixed(3), "0.300"); // $3 / min
    assert.equal(estimateCost("kling", 3).toFixed(3), "0.070"); // rounded up to 5 s x $0.014
    assert.equal(estimateCost("kling", 5.2).toFixed(3), "0.140");
    assert.equal(infinitalkFrames(2.9), 73); // 4n+1 closest to 72.5
    assert.equal(estimateCost("infinitetalk", 2.9).toFixed(3), "0.876"); // 73 / 25 s x $0.30, x1.25 above 81 frames: no
    assert.equal(infinitalkFrames(3.6), 89);
    assert.equal(estimateCost("infinitetalk", 3.6).toFixed(3), (3.56 * 0.3 * 1.25).toFixed(3));
    assert.equal(infinitalkFrames(30), 241);
  });

  test("limits: Kling 2-10 s, InfiniteTalk at most 9.64 s; Kling's size range is handled with a resized copy", () => {
    assert.match(providerLimit("kling", 1.5, 1000)!, /at least 2 s/);
    assert.match(providerLimit("kling", 11, 1000)!, /at most 10 s/);
    assert.match(providerLimit("kling", 5, 6 * 1024 * 1024)!, /5 MB/);
    assert.equal(providerLimit("kling", 5, 1000), null);
    assert.match(providerLimit("infinitetalk", 10, 1000)!, /9\.64 s/);
    assert.equal(providerLimit("sync", 30, 1000), null);
    assert.equal(klingSize(1080, 1920), null);
    assert.deepEqual(klingSize(832, 464), { w: 1292, h: 720 });
    assert.deepEqual(klingSize(3840, 2160), { w: 1920, h: 1080 });
  });

  test("inputs match fal's schemas", () => {
    const job = { videoUrl: "v", audioUrl: "a", durationS: 2.9, prompt: "p" };
    assert.deepEqual(PROVIDERS.sync.input(job), { video_url: "v", audio_url: "a", model: "lipsync-2", sync_mode: "cut_off" });
    assert.deepEqual(PROVIDERS.kling.input(job), { video_url: "v", audio_url: "a" });
    assert.deepEqual(PROVIDERS.infinitetalk.input(job), { video_url: "v", audio_url: "a", prompt: "p", num_frames: 73, resolution: "480p", seed: 42, acceleration: "regular" });
    assert.equal(PROVIDERS.infinitetalk.endpoint, "fal-ai/infinitalk/video-to-video");
  });

  test("timeout then one retry; both request IDs kept", async () => {
    let n = 0;
    let clock = 0;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const fal = {
        queue: {
          submit: async () => ({ request_id: `req-${++n}` }),
          status: async (_e: string, o: { requestId: string }) => ({ status: o.requestId === "req-1" ? "IN_PROGRESS" : "COMPLETED" }),
          result: async () => ({ data: { video: { url: "http://x/v.mp4" } } }),
          cancel: async () => undefined,
        },
      } as never;
      const r = await runWithRetry(fal, PROVIDERS.sync, { videoUrl: "v", audioUrl: "a", durationS: 3, prompt: "" }, { timeoutMs: 1000, pollMs: 400, log: () => {}, sleep: async (ms) => void (clock += ms) });
      assert.equal(r.url, "http://x/v.mp4");
      assert.deepEqual(r.attempts.map((a) => [a.request_id, a.outcome.split(" (")[0]]), [["req-1", "failed: no answer within 0 min"], ["req-2", "done"]]);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("checks", () => {
  const clip = { width: 1080, height: 1920, fps: 30, durationS: 6 };
  test("lower resolution and another frame rate = information, not a problem", () => {
    const c = checkResult(clip, 2.9, { width: 720, height: 1280, fps: 25, durationS: 2.92 }, { ok: true });
    assert.deepEqual(c.map((x) => [x.name, x.level]), [["plays", "ok"], ["duration", "ok"], ["aspect", "ok"], ["resolution", "info"], ["fps", "info"]]);
    assert.equal(c.find((x) => x.name === "resolution")!.message, "Model output 720p, clip was 1080p.");
    assert.match(verdict(c), /^Good: usable/);
  });
  test("wrong length or shape, or a file that does not play = problem", () => {
    const c = checkResult(clip, 2.9, { width: 1080, height: 1080, fps: 30, durationS: 3.2 }, { ok: false, error: "corrupt" });
    assert.deepEqual(c.filter((x) => x.level === "problem").map((x) => x.name), ["plays", "duration", "aspect"]);
    assert.match(verdict(c), /^Could be better/);
    assert.equal(checkResult(clip, 2.9, null, { ok: false })[0].level, "problem");
    assert.match(verdict(checkResult(clip, 2.9, { ...clip, durationS: 2.95 }, { ok: true })), /^Excellent/);
  });
  test("side by side: same height, at most 3840 px wide, labels, the full mix as sound", () => {
    const args = comparisonArgs([{ file: "a.mp4", label: "Original", aspect: 9 / 16 }, { file: "b.mp4", label: "Sync: v2", aspect: 9 / 16 }], "mix.wav", 2.9, 30, 1920, "c.mp4", "f.woff");
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.match(fc, /scale=-2:1080/);
    assert.match(fc, /hstack=inputs=2/);
    assert.match(fc, /text='Sync\\: v2'/);
    assert.equal(args[args.indexOf("-map") + 3], "2:a:0");
    const wide = comparisonArgs(Array(4).fill({ file: "a.mp4", label: "x", aspect: 16 / 9 }), "m.wav", 3, 30, 1080, "c.mp4", null);
    assert.match(wide[wide.indexOf("-filter_complex") + 1], /scale=-2:540/); // 4 x 16:9 within 3840 px
  });
  test("names safe for Windows folders", () => {
    assert.equal(safeName('Wedding Day: "live"?'), "Wedding Day_ _live__");
  });
});

// ---- the whole pipeline, on a made-up song ----

const ff = (...a: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a]);
const probe = (f: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f], { encoding: "utf8" }));

describe("pipeline (stand-in fal)", () => {
  let tmp: string;
  let ws: string;
  let out: string;
  let clip: string;
  let server: http.Server;
  let base: string;
  const uploads = new Map<string, Buffer>();
  const submitted: { endpoint: string; input: Record<string, unknown> }[] = [];
  const inputs = new Map<string, Record<string, unknown>>();
  let klingCalls = 0;

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lipsync-"));
    ws = path.join(tmp, "workspace");
    out = path.join(tmp, "out");
    const folder = "songs/Life Lyrics/Wedding Day";
    const root = path.join(ws, ...folder.split("/"));
    mkdirSync(path.join(root, ".studio"), { recursive: true });
    ff("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=20", "-ac", "2", "-c:a", "pcm_s24le", path.join(root, "Wedding Day (Master).wav"));
    ff("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=20", "-ac", "2", "-c:a", "pcm_s16le", path.join(root, "WD Lead Vocal.wav"));
    writeFileSync(path.join(root, ".studio", "files.json"), JSON.stringify({ version: 1, song: "Wedding Day (Master).wav", vocals: "WD Lead Vocal.wav" }));
    clip = path.join(tmp, "midjourney clip.mp4");
    ff("-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=6", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", clip);

    const req = createRequire(path.join(REPO_ROOT, "packages", "db", "package.json"));
    const Database = req("better-sqlite3");
    const db = new Database(path.join(ws, "studio.db"));
    db.exec(`create table project (id text primary key, title text not null, artist text not null, audio_path text, folder text, lyrics_offset_ms integer not null default 0, duration_ms integer);
      create table lyric_line (id text, project_id text, "index" integer, text text, start_ms integer, end_ms integer, is_hook integer, words_json text);`);
    db.prepare("insert into project values (?, ?, ?, ?, ?, ?, ?)").run("p1", "Wedding Day", "Life Lyrics", `${folder}/Wedding Day (Master).wav`, folder, 0, 20000);
    LINES.forEach((l, i) => db.prepare("insert into lyric_line values (?, ?, ?, ?, ?, ?, ?, null)").run(`l${i}`, "p1", i, l.text, l.startMs, l.endMs, l.isHook ? 1 : 0));
    db.close();

    // fal's part: uploads kept in memory; "models" return the clip (Sync, Kling) or a 480p 25 fps version (InfiniteTalk).
    server = http.createServer((rq, rs) => {
      const body = uploads.get(rq.url ?? "");
      if (!body) return void rs.writeHead(404).end();
      rs.writeHead(200, { "content-type": "video/mp4" }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(() => {
    server?.close();
    if (process.env.LIPSYNC_KEEP_TEST_FILES) console.log(`kept: ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  });

  let failInfinitalk = false;
  const fakeFal = () => {
    let n = 0;
    return {
      storage: {
        upload: async (f: File) => {
          const key = `/up/${++n}-${f.name}`;
          uploads.set(key, Buffer.from(await f.arrayBuffer()));
          return `${base}${key}`;
        },
      },
      queue: {
        submit: async (endpoint: string, o: { input: Record<string, unknown> }) => {
          submitted.push({ endpoint, input: o.input });
          if (endpoint.includes("infinitalk") && failInfinitalk) throw Object.assign(new Error("Internal Server Error"), { status: 500, body: { detail: "GPU out of memory" } });
          if (endpoint.includes("kling") && ++klingCalls === 1) throw Object.assign(new Error("Unprocessable Entity"), { status: 422, body: { detail: "face not found" } });
          const id = `${endpoint.split("/")[1]}-${submitted.length}`;
          inputs.set(id, o.input);
          return { request_id: id };
        },
        status: async () => ({ status: "COMPLETED" }),
        result: async (endpoint: string, o: { requestId: string }) => {
          const input = inputs.get(o.requestId)!;
          const src = uploads.get(new URL(String(input.video_url)).pathname)!;
          let body = src;
          if (endpoint.includes("infinitalk")) {
            const a = path.join(tmp, `in-${o.requestId}.mp4`);
            const b = path.join(tmp, `out-${o.requestId}.mp4`);
            writeFileSync(a, src);
            ff("-i", a, "-vf", "scale=480:854,fps=25", "-frames:v", String(input.num_frames), "-c:v", "libx264", "-preset", "ultrafast", b);
            body = readFileSync(b);
          }
          const key = `/result/${o.requestId}.mp4`;
          uploads.set(key, body);
          return { data: { video: { url: `${base}${key}` } }, requestId: o.requestId };
        },
        cancel: async () => undefined,
      },
    } as never;
  };

  const env = () => ({ WORKSPACE_DIR: ws });

  test("cost above --max-cost stops before any upload, even with --yes", async () => {
    await assert.rejects(run(["Wedding Day", "--clip", clip, "--lines", "chorus:2", "--max-cost", "1", "--yes"], { fal: fakeFal(), out, env: env() }), (e: Error) => e instanceof Stop && /above the cap of \$1\.00/.test(e.message));
    assert.equal(submitted.length, 0);
    assert.equal(uploads.size, 0);
  });

  test("without --yes: the estimate only, nothing uploaded", async () => {
    await run(["Wedding Day", "--clip", clip, "--lines", "2"], { fal: undefined, out, env: env() });
    assert.equal(uploads.size, 0);
    assert.equal(existsSync(path.join(out, "Wedding Day", "midjourney clip_line2", "report.json")), false);
  });

  test("two chorus lines: one folder each, slices, results, review copies, comparison, report with request IDs", async () => {
    await run(["Wedding Day", "--clip", clip, "--lines", "chorus:2", "--providers", "sync,kling,infinitetalk", "--yes"], { fal: fakeFal(), out, env: env() });
    const songDir = path.join(out, "Wedding Day");
    assert.deepEqual(readdirSync(songDir).sort(), ["midjourney clip_line2", "midjourney clip_line3"]);
    const dir = path.join(songDir, "midjourney clip_line2");
    for (const f of ["clip_trimmed.mp4", "audio_slice.wav", "mix_slice.wav", "sync.mp4", "sync_review.mp4", "kling.mp4", "kling_review.mp4", "infinitetalk.mp4", "infinitetalk_review.mp4", "comparison.mp4", "report.json", "report.md"])
      assert.ok(existsSync(path.join(dir, f)), f);
    assert.equal(existsSync(path.join(dir, "label-font.woff")), false);

    // The VOCAL STEM went to the models (440 Hz, 16-bit), the full mix only into the review files.
    const slice = probe(path.join(dir, "audio_slice.wav")).streams[0];
    assert.equal(slice.codec_name, "pcm_s16le");
    assert.equal(Number(slice.duration).toFixed(2), "2.90");
    assert.equal(probe(path.join(dir, "mix_slice.wav")).streams[0].codec_name, "pcm_s24le");
    const sent = uploads.get([...uploads.keys()].find((k) => k.endsWith("audio_slice.wav"))!)!;
    assert.deepEqual(sent, readFileSync(path.join(dir, "audio_slice.wav")));

    const trimmed = probe(path.join(dir, "clip_trimmed.mp4")).streams.find((s: { codec_type: string }) => s.codec_type === "video");
    assert.deepEqual([trimmed.width, trimmed.height, trimmed.avg_frame_rate], [1080, 1920, "30/1"]);
    const cmp = probe(path.join(dir, "comparison.mp4"));
    const cv = cmp.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    assert.equal(cv.height, 1080);
    assert.equal(cv.width, 4 * 608);
    assert.ok(cmp.streams.some((s: { codec_type: string }) => s.codec_type === "audio"));

    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as JobReport;
    assert.equal(report.vocal_stem, "WD Lead Vocal.wav");
    assert.deepEqual([report.part.line, report.part.start_s, report.part.end_s], [2, 3.8, 6.7]);
    const byId = Object.fromEntries(report.providers.map((p) => [p.id, p]));
    assert.equal(byId.sync.status, "done");
    assert.match(byId.sync.verdict!, /^Excellent/);
    assert.equal(byId.sync.endpoint, "fal-ai/sync-lipsync/v2");
    // Kling failed once (422) then worked: both tries with their request IDs.
    assert.equal(byId.kling.status, "done");
    assert.equal(byId.kling.attempts.length, 2);
    assert.match(byId.kling.attempts[0].outcome, /face not found/);
    assert.ok(byId.kling.attempts[1].request_id);
    // InfiniteTalk at 480p / 25 fps: information, not a problem.
    assert.equal(byId.infinitetalk.status, "done");
    assert.match(byId.infinitetalk.verdict!, /^Good: usable/);
    assert.ok(byId.infinitetalk.checks!.some((c) => c.message === "Model output 480p, clip was 1080p."));
    assert.equal(byId.infinitetalk.estimated_cost_usd, 0.88);
    const md = readFileSync(path.join(dir, "report.md"), "utf8");
    assert.match(md, /fal request IDs/);
    assert.match(md, /comparison\.mp4/);
    assert.equal(reportMarkdown(report), md);
  });

  test("a line longer than the clip stops with a clear message; a rerun does not overwrite a finished folder", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...m: unknown[]) => void logs.push(m.join(" "));
    try {
      await run(["Wedding Day", "--clip", clip, "--lines", "4,2", "--providers", "sync", "--yes"], { fal: fakeFal(), out, env: env() });
    } finally {
      console.log = orig;
    }
    assert.ok(logs.some((l) => /Line 4 .*STOPPED\. The clip is 6\.00 s long, but this part of the song lasts 9\.40 s/.test(l)), logs.join("\n"));
    assert.ok(existsSync(path.join(out, "Wedding Day", "midjourney clip_line2 (2)", "sync.mp4")), `${readdirSync(path.join(out, "Wedding Day")).join(", ")}\n${logs.join("\n")}`);
    assert.equal(existsSync(path.join(out, "Wedding Day", "midjourney clip_line4")), false);
  });

  const endpointsSent = () => submitted.map((x) => x.endpoint.split("/")[1]);

  test("default: InfiniteTalk only; no Sync while it works, never Kling", async () => {
    submitted.length = 0;
    const out2 = path.join(tmp, "out-default");
    await run(["Wedding Day", "--clip", clip, "--lines", "3", "--yes"], { fal: fakeFal(), out: out2, env: env() });
    assert.deepEqual(endpointsSent(), ["infinitalk"]);
    const dir = path.join(out2, "Wedding Day", "midjourney clip_line3");
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as JobReport;
    assert.deepEqual(report.providers.map((p) => [p.id, p.status]), [["infinitetalk", "done"]]);
    assert.equal(existsSync(path.join(dir, "sync.mp4")), false);
    assert.ok(existsSync(path.join(dir, "comparison.mp4")));
  });

  test("InfiniteTalk fails (both tries): Sync runs as the automatic fallback, and the report says why", async () => {
    submitted.length = 0;
    failInfinitalk = true;
    const out3 = path.join(tmp, "out-fallback");
    try {
      await run(["Wedding Day", "--clip", clip, "--lines", "3", "--yes"], { fal: fakeFal(), out: out3, env: env() });
    } finally {
      failInfinitalk = false;
    }
    assert.deepEqual(endpointsSent(), ["infinitalk", "infinitalk", "sync-lipsync"]);
    const dir = path.join(out3, "Wedding Day", "midjourney clip_line3");
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as JobReport;
    const [inf, sync] = report.providers;
    assert.equal(inf.status, "failed");
    assert.match(inf.reason!, /GPU out of memory/);
    assert.equal(sync.id, "sync");
    assert.equal(sync.status, "done");
    assert.equal(sync.fallback_for, "InfiniteTalk failed");
    assert.match(readFileSync(path.join(dir, "report.md"), "utf8"), /\(automatic fallback: InfiniteTalk failed\)/);
    assert.ok(existsSync(path.join(dir, "sync_review.mp4")));
  });

  test("--no-fallback: no Sync; and the cap also holds the fallback back", async () => {
    submitted.length = 0;
    failInfinitalk = true;
    try {
      await run(["Wedding Day", "--clip", clip, "--lines", "3", "--no-fallback", "--yes"], { fal: fakeFal(), out: path.join(tmp, "out-nofb"), env: env() });
      assert.deepEqual(endpointsSent(), ["infinitalk", "infinitalk"]);
      submitted.length = 0;
      const out5 = path.join(tmp, "out-cap");
      await run(["Wedding Day", "--clip", clip, "--lines", "3", "--max-cost", "0.9", "--yes"], { fal: fakeFal(), out: out5, env: env() });
      assert.deepEqual(endpointsSent(), ["infinitalk", "infinitalk"]); // $0.88 + Sync $0.14 > $0.90
      const report = JSON.parse(readFileSync(path.join(out5, "Wedding Day", "midjourney clip_line3", "report.json"), "utf8")) as JobReport;
      assert.equal(report.providers[1].status, "skipped");
      assert.match(report.providers[1].reason!, /cap of \$0\.90/);
    } finally {
      failInfinitalk = false;
    }
  });
});
