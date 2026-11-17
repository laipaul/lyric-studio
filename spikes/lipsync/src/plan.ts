// Pure logic of the lip-sync spike (no files, no network): which part of the song each job covers, what each
// provider would cost, what each provider accepts. Tested in test/lipsync.test.ts.

export type Line = { number: number; text: string; startMs: number | null; endMs: number | null; isHook: boolean };

export type Selection =
  | { kind: "lines"; numbers: number[] } // --lines 12,13 (the Lyrics tab's numbers, from 1)
  | { kind: "chorus"; count: number } // --lines chorus:2 (the first N chorus lines)
  | { kind: "range"; fromS: number; toS: number }; // --from 61.2 --to 66.8

// One job = one line (or one explicit range) = one output folder.
export type Window = {
  label: string; // "line12" | "61.20-66.80s"
  line: Line | null;
  sungStartS: number; // the line as sung (after the song's lyric offset), before padding
  sungEndS: number;
  startS: number; // after padding, inside the song
  endS: number;
  durationS: number;
};

export function parseSelection(lines: string | undefined, from: string | undefined, to: string | undefined): Selection {
  if (lines && (from || to)) throw new Error("Give either --lines or --from/--to, not both.");
  if (from || to) {
    const fromS = Number(from);
    const toS = Number(to);
    if (!from || !to || !Number.isFinite(fromS) || !Number.isFinite(toS)) throw new Error("--from and --to need both a number of seconds, e.g. --from 61.2 --to 66.8");
    if (toS <= fromS) throw new Error("--to must be after --from.");
    return { kind: "range", fromS, toS };
  }
  if (!lines) throw new Error('Say which part to lip-sync: --lines 12,13, --lines chorus:2, or --from 61.2 --to 66.8 (see the line numbers with --list).');
  const chorus = /^chorus(?::(\d+))?$/i.exec(lines.trim());
  if (chorus) return { kind: "chorus", count: chorus[1] ? Number(chorus[1]) : 1 };
  const numbers = lines.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (!numbers.length || numbers.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`--lines takes line numbers from the Lyrics tab, e.g. 12,13 (got "${lines}").`);
  return { kind: "lines", numbers: [...new Set(numbers)] };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// The windows to lip-sync, one per line (never merged), with `padS` before and after, clamped to the song.
export function resolveWindows(all: Line[], sel: Selection, opts: { padS: number; offsetMs: number; songDurationS: number | null }): Window[] {
  const pad = Math.max(0, opts.padS);
  const songEnd = opts.songDurationS ?? Infinity;
  const make = (label: string, line: Line | null, s: number, e: number): Window => {
    const startS = round3(Math.max(0, s - pad));
    const endS = round3(Math.min(songEnd, e + pad));
    return { label, line, sungStartS: round3(s), sungEndS: round3(e), startS, endS, durationS: round3(endS - startS) };
  };
  if (sel.kind === "range") return [make(`${sel.fromS.toFixed(2)}-${sel.toS.toFixed(2)}s`, null, sel.fromS, sel.toS)];
  let picked: Line[];
  if (sel.kind === "chorus") {
    const hooks = all.filter((l) => l.isHook && l.startMs !== null && l.endMs !== null);
    if (!hooks.length) throw new Error("This song has no lines marked as chorus. Pick lines by number instead (see --list).");
    picked = hooks.slice(0, sel.count);
  } else {
    picked = sel.numbers.map((n) => {
      const l = all.find((x) => x.number === n);
      if (!l) throw new Error(`Line ${n} does not exist: the song has ${all.length} lines (see --list).`);
      return l;
    });
  }
  return picked.map((l) => {
    if (l.startMs === null || l.endMs === null) throw new Error(`Line ${l.number} ("${l.text}") has no timing yet: time the lyrics first (Prepare → Lyrics Sync).`);
    return make(`line${l.number}`, l, (l.startMs + opts.offsetMs) / 1000, (l.endMs + opts.offsetMs) / 1000);
  });
}

// Step 1 never loops a clip: it must cover the whole window.
export function clipTooShort(clipDurationS: number, windowS: number, clipStartS = 0): string | null {
  const available = clipDurationS - clipStartS;
  if (available + 0.001 >= windowS) return null;
  return `The clip is ${available.toFixed(2)} s long${clipStartS ? ` from ${clipStartS} s` : ""}, but this part of the song lasts ${windowS.toFixed(2)} s: use a clip of at least ${Math.ceil(windowS * 10) / 10} s (step 1 does not loop clips).`;
}

// ---- providers: prices and limits, as fal.ai's model pages state them (checked 17 Nov 2026) ----

export type ProviderId = "sync" | "kling" | "infinitetalk";
export const PROVIDER_IDS: readonly ProviderId[] = ["sync", "kling", "infinitetalk"];

// Lesson from the first test (17 Nov 2026): mouth-only models (Sync, Kling LipSync) look unnatural for singing, because
// the rest of the face stays still. Singing defaults to a whole-face, audio-driven model (InfiniteTalk). Sync runs
// only as an automatic fallback when InfiniteTalk gives nothing usable. Kling runs only when asked for (--providers).
export const DEFAULT_PROVIDERS: readonly ProviderId[] = ["infinitetalk"];
export const FALLBACK_PROVIDER: ProviderId = "sync";

// The fallback runs when none of the chosen models gave a usable result: each one was skipped, failed, or came back
// with a problem (wrong length or shape, does not play).
export function needsFallback(results: { status: "done" | "failed" | "skipped"; problem: boolean }[]): boolean {
  return !results.some((r) => r.status === "done" && !r.problem);
}

export const PRICES = {
  // fal-ai/sync-lipsync/v2: "$3 per minute of video" (model lipsync-2).
  syncPerSecond: 3 / 60,
  // fal-ai/kling-video/lipsync/audio-to-video: "$0.014 per input video seconds, rolling up to closest 5 second increment".
  klingPerSecond: 0.014,
  klingIncrementS: 5,
  // fal-ai/infinitalk/video-to-video: "$0.3 per seconds"; "if the number of frames is greater than 81, ... 1.25x more billing units".
  infinitalkPerSecond: 0.3,
  infinitalkLongFactor: 1.25,
  infinitalkLongFrames: 81,
};

export const INFINITALK_FPS = 25; // InfiniteTalk (Wan 2.1) generates 25 fps: num_frames = seconds x 25
export const INFINITALK_MIN_FRAMES = 41;
export const INFINITALK_MAX_FRAMES = 241;

// Frames for InfiniteTalk: the 4n+1 count closest to the window (the model's frame grid), inside the endpoint's range.
export function infinitalkFrames(durationS: number): number {
  const n = Math.round((durationS * INFINITALK_FPS - 1) / 4);
  return Math.min(INFINITALK_MAX_FRAMES, Math.max(INFINITALK_MIN_FRAMES, 4 * n + 1));
}

export function estimateCost(id: ProviderId, durationS: number): number {
  switch (id) {
    case "sync":
      return durationS * PRICES.syncPerSecond;
    case "kling":
      return Math.ceil(durationS / PRICES.klingIncrementS - 1e-9) * PRICES.klingIncrementS * PRICES.klingPerSecond;
    case "infinitetalk": {
      const frames = infinitalkFrames(durationS);
      return (frames / INFINITALK_FPS) * PRICES.infinitalkPerSecond * (frames > PRICES.infinitalkLongFrames ? PRICES.infinitalkLongFactor : 1);
    }
  }
}

export const money = (usd: number) => `$${usd.toFixed(2)}`;

// What a provider cannot take, in plain words (null = fine). Video size problems for Kling are fixed by the app
// (a resized copy, see klingSize), so only the length is a reason to skip.
export function providerLimit(id: ProviderId, durationS: number, audioBytes: number): string | null {
  if (id === "kling") {
    if (durationS < 2) return `Kling LipSync needs at least 2 s; this part is ${durationS.toFixed(2)} s.`;
    if (durationS > 10) return `Kling LipSync takes at most 10 s of video; this part is ${durationS.toFixed(2)} s (pick a shorter line).`;
    if (audioBytes > 5 * 1024 * 1024) return "Kling LipSync takes audio up to 5 MB; this slice is larger.";
  }
  if (id === "infinitetalk") {
    const maxS = INFINITALK_MAX_FRAMES / INFINITALK_FPS;
    if (durationS > maxS + 0.05) return `InfiniteTalk makes at most ${maxS.toFixed(2)} s per request; this part is ${durationS.toFixed(2)} s (pick a shorter line).`;
  }
  return null;
}

// Kling accepts only 720-1920 px per side: the size of the copy sent to Kling (same aspect), or null when the clip fits.
export function klingSize(w: number, h: number): { w: number; h: number } | null {
  const fits = (a: number) => a >= 720 && a <= 1920;
  if (fits(w) && fits(h)) return null;
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  // Too small: the short side up to 720. Too large: the long side down to 1920 (as sharp as Kling allows).
  let scale = Math.min(w, h) < 720 ? 720 / Math.min(w, h) : 1920 / Math.max(w, h);
  if (Math.max(w, h) * scale > 1920) scale = 1920 / Math.max(w, h);
  return { w: even(w * scale), h: even(h * scale) };
}

// Folder-safe name (Windows): <>:"/\|?* and control characters become _, max 60 characters.
export function safeName(text: string): string {
  const clean = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return (clean || "untitled").slice(0, 60).trim();
}
