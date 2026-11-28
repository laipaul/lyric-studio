// Singing lines (Lyrics Sync → Singer, 21 Nov 2026, Paul's workflow): Paul ticks the lines where the singer shows and
// picks, per line, a picture or video from Creation. The app cuts the vocal for each line (the vocal stem, lined up on
// the song; else the song itself), sends it with the picture or video to WaveSpeed InfiniteTalk (his own key; cost
// first, the spending cap), and each singing clip comes back:
//   - into Creation, as a take of its picture labelled "Lip sync · line N" (pictures\takes\<picture> sings line N.mp4,
//     without sound: the vocal is never kept in any file);
//   - into the Storyboard (the end of his story line; he may move it) and onto its line as a story anchor with "sync":
//     the song second its first frame belongs to. Make cuts it in on the beat and plays it in time with the song
//     (anchors.ts), never slowed, never used for other shots.
// Lines in a row sung from the same picture or video are one RUN: one continuous take from just before the first line
// to two bars after the last (one request, one cost), placed on the first line with "through" = the last line, so the
// singer stays on screen, lips in time, until the last line is sung (Paul, 21 Nov 2026: "the missing part"). A pause
// between two lines longer than RUN_GAP_MS (an instrumental break) starts a new run.
// The vocal piece runs from just before the downbeat before the line to two bars after it is sung, so the cut and the
// hold that follow always have footage, and the lips sing what the song sings there.
// The song and the stem are only read (FFmpeg decodes a piece into a temporary file). Requests are never retried.
// Settings: <song folder>\pictures\singer.json { "lines": { "<line>": "<Creation file>" }, "scripts": { "<first line of a block>": "what the
// singer does" } }: the little script goes to InfiniteTalk with the voice (its optional prompt: expression and pose).
import { dryVocalInstalled, dryVocalState, ensureDereverbed, type DryKind } from "./dereverb";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { absPath, beat as beatTable, ffmpegBin, probeMedia, project as projectTable, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { applyDownbeatOffset } from "../beats";
import { detectTakeCuts, MV_GENERATOR_PATH } from "../music-video";
import { V2_V1_CHANGE } from "../tracks";
import { type PicturesView } from "./animate";
import { nextTakeN } from "./animate";
import { BOARD_VIDEO_FILE, itemLabel, makePlayable, PICTURE_FILE, POLL_MS, TAKES_DIR, TIMEOUT_MS, WAVESPEED, data, json, keyFor, readPictures, setTake, sleepMs, songFolder, update, waveSpeedUpload, type Take } from "./animate";
import { importSongClips } from "./assets";
import { setClipLabel, setClipOmit } from "./clip-edits";
import { download, errorText } from "./characters/fal";
import { lyricsView, saveAnchors } from "./lyrics-view";
import { feelFor, filmLookFor } from "./film-looks";
import { singingRealism, type Feel } from "./realism";
import { feelingWords } from "../feelings";
import { feelingForLines, type TakeFeeling } from "./section-feelings";
import { readRecipe } from "./recipe";
import { songPaths, songPathsById } from "./song-folder";
import { storedStemCheck } from "./voice-source";

export const SINGER_FILE = "singer.json";
// The resolution asked of InfiniteTalk (Lyrics Sync → Singer bar, saved per video in singer.json; 720p by default, the
// only one sent before 21 Nov 2026) and its price per second (WaveSpeed price list, 21 Nov 2026).
export const LIPSYNC_RESOLUTIONS = ["480p", "720p"] as const;
export type LipsyncResolution = (typeof LIPSYNC_RESOLUTIONS)[number];
export const LIPSYNC_RESOLUTION: LipsyncResolution = "720p"; // the default
export const LIPSYNC_USD_PER_SECOND_AT: Record<LipsyncResolution, number> = { "480p": 0.03, "720p": 0.06 };
export const LIPSYNC_USD_PER_SECOND = LIPSYNC_USD_PER_SECOND_AT[LIPSYNC_RESOLUTION];
export const isLipsyncResolution = (v: unknown): v is LipsyncResolution => LIPSYNC_RESOLUTIONS.includes(v as LipsyncResolution);
export const LIPSYNC_MIN_SECONDS = 3; // billed at least 3 s, rounded up to whole seconds
export const LIPSYNC_MODEL = "InfiniteTalk";
// The piece starts this long before the downbeat the shot cuts in on: room for the soft entry (the singer is cut in 0.4 s before the
// beat the B-roll fade ends on, V2 → V1 change in tracks.ts) and the 2 skipped frames (tested: LEAD_MS >= entry fade + skipped frames).
export const LEAD_MS = 500;
const TAIL_BARS = 2; // and runs two bars past the line's sung end (the shot holds until the next regular cut)
export const RUN_GAP_MS = 8000; // lines in a row with the same picture and at most this pause between them: one take

// The second singing engine (28 Nov 2026, Paul: "WaveSpeed's Music Video Generator gives better lip sync than
// InfiniteTalk"): per group, InfiniteTalk (the default) or the Music Video Generator (wavespeed-ai/music-video-generator,
// WaveSpeed's docs read 28 Nov 2026: audio, images 0-9, prompt, aspect_ratio 16:9 / 9:16 / 1:1 / 4:3 / 3:4, resolution
// 480p / 720p / 1080p; billed per second of audio, rounded up, at least 3 s). Sent: ONE picture (one picture = the
// singer's look; several would cut between set-ups), the voice of Lips follow for the take's song range with
// MV_HANDLE_MS before and after (cut off again when it comes back), the rules below + the take's lip prompt + its
// scene. The voice goes as it is: no breathing-room silencing (a silent stretch can make the generator cut to a story
// scene). It comes back silent, trimmed to the song range, placed like an InfiniteTalk take; a length off by more than
// MV_LENGTH_TOLERANCE_MS or a cut inside it is said on the take (never stretched).
export const SING_ENGINES = ["infinitetalk", "mv"] as const;
export type SingEngine = (typeof SING_ENGINES)[number];
export const isSingEngine = (v: unknown): v is SingEngine => SING_ENGINES.includes(v as SingEngine);
export const MV_SING_MODEL = "MV Generator";
export const SING_RESOLUTIONS = ["480p", "720p", "1080p"] as const; // 1080p: the MV Generator only
export type SingResolution = (typeof SING_RESOLUTIONS)[number];
export const isSingResolution = (v: unknown): v is SingResolution => SING_RESOLUTIONS.includes(v as SingResolution);
export const MV_SING_USD_PER_SECOND: Record<SingResolution, number> = { "480p": 0.03, "720p": 0.06, "1080p": 0.12 };
export const MV_HANDLE_MS = 1000;
export const MV_LENGTH_TOLERANCE_MS = 100;
export const MV_SING_RULES = "Keep exactly the woman, face, outfit, setting and light from the image. ONE continuous shot, no cuts, no transitions, no other people, no text.";
export const SCENE_MAX = 300;
export type SingAspect = "9:16" | "16:9";
// InfiniteTalk makes 480p or 720p: a song set to 1080p (for the MV Generator) gets 720p from it.
export const itResolution = (r: SingResolution | undefined): LipsyncResolution => (r === "480p" ? "480p" : "720p");

// The MV Generator's piece: the song range of the group, the handles that fit inside the song, and what the voice sent
// costs (the handles included; whole seconds, at least 3 s).
export function mvSingPiece(range: { fromMs: number; toMs: number }, songMs: number, resolution: SingResolution): Piece {
  const handles = { inMs: Math.min(MV_HANDLE_MS, Math.max(0, range.fromMs)), outMs: Math.min(MV_HANDLE_MS, Math.max(0, songMs - range.toMs)) };
  const seconds = Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((range.toMs - range.fromMs + handles.inMs + handles.outMs) / 1000));
  return { fromMs: range.fromMs, toMs: range.toMs, seconds, usd: Math.round(seconds * MV_SING_USD_PER_SECOND[resolution] * 100) / 100, handles };
}
// The prompt: the fixed rules, the take's lip prompt (the singing cue, mood, direction, look), its scene.
export const mvSingPrompt = (lip: string, scene?: string) => [MV_SING_RULES, lip.trim().replace(/\.?$/, "."), scene?.trim() ? `Scene and mood: ${scene.trim().replace(/\.?$/, ".")}` : ""].filter(Boolean).join(" ");
// The request body, as WaveSpeed's docs show it (one picture).
export const mvSingRequest = (o: { image: string; audio: string; prompt: string; aspect: SingAspect; resolution: SingResolution }) => ({ audio: o.audio, images: [o.image], prompt: o.prompt, aspect_ratio: o.aspect, resolution: o.resolution });
const clockS = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
// What the returned video says, in plain words: its length against the voice sent, and the cuts found inside it.
export function mvTakeWarnings(returnedMs: number, sentMs: number, cutsMs: readonly number[]): string[] {
  const out: string[] = [];
  if (Math.abs(returnedMs - sentMs) > MV_LENGTH_TOLERANCE_MS) out.push(`It came back ${(returnedMs / 1000).toFixed(2)} s long for ${(sentMs / 1000).toFixed(2)} s of voice sent: kept as it is, not stretched. Check the lips with the song, or retake.`);
  if (cutsMs.length === 1) out.push(`The model added a cut at ${clockS(cutsMs[0])}: retake it, or use the take up to there.`);
  else if (cutsMs.length > 1) out.push(`The model added ${cutsMs.length} cuts: at ${cutsMs.slice(0, -1).map(clockS).join(", ")} and ${clockS(cutsMs.at(-1)!)}: retake it, or use the take up to the first one.`);
  return out;
}

// voices: per group (its first line), the audio that drives the lips ("song": the whole mix; default: the vocal stem).
// engine: the last engine chosen in this song (a group without its own choice uses it); engines / scenes: per group
// (its first line); aspect: the shape asked of the MV Generator.
export type LipsVoice = "stem" | "song" | "dereverb" | "lead"; // dereverb: the dry vocal (the stem de-reverbed); lead: the lead vocal only, dry (dereverb.ts)
export type SingerSettings = { lines: Record<string, string>; scripts?: Record<string, string>; resolution?: SingResolution; voices?: Record<string, LipsVoice>; engine?: SingEngine; engines?: Record<string, SingEngine>; scenes?: Record<string, string>; aspect?: SingAspect };
// A draft (lip-sync review, 26 Nov 2026): 480p at half the price, to check the lips and the expression first; an
// approved draft becomes the final by Make final (upscaled to 1080p: the same lips and expression).
export const DRAFT_RESOLUTION: LipsyncResolution = "480p";
export const draftUsd = (seconds: number) => Math.round(seconds * LIPSYNC_USD_PER_SECOND_AT[DRAFT_RESOLUTION] * 100) / 100;
export const REVIEW_REASONS = ["lips late", "lips early", "mouth too open", "mouth too closed", "wrong expression", "face drifts"] as const;
export const NUDGE_MAX_MS = 1500;
// Per lip-sync model (26 Nov 2026, Paul: "avoid splitting a continuous singing performance whenever the model supports
// the required duration"):
//   LIPSYNC_MAX_TAKE_MS: the longest take; a longer group is split at sung-line boundaries into takes.
//   LIPSYNC_ONE_REQUEST_MS: the longest piece sent in ONE request; longer ones are made in parts, each from the picture.
// InfiniteTalk takes up to 10 minutes of audio in one request (WaveSpeed's docs) and keeps continuity and identity itself
// over long videos (it continues from its own frames with the reference image as the identity anchor, inside the call),
// so a passage of continuous singing is ONE take in ONE request. The split and the parts stay for a model with a short
// limit.
export const LIPSYNC_MAX_TAKE_MS: Record<string, number> = { InfiniteTalk: 600_000 };
export const LIPSYNC_ONE_REQUEST_MS: Record<string, number> = { InfiniteTalk: 600_000 };
const oneRequestMs = () => LIPSYNC_ONE_REQUEST_MS[LIPSYNC_MODEL] ?? PART_MAX_MS;
export const SINGING_TAIL_BARS = 1; // a singing take runs one bar past its last sung line (before: two)
export const SCRIPT_MAX = 200;
// Every singing take asks InfiniteTalk to SING, not talk (Paul, 21 Nov 2026: a calm portrait came back "talking"):
// this cue opens the prompt, then Paul's own script. SINGING_STYLE marks takes made with it; a block made before it
// shows as to make again (only made when Paul presses Make singing clips, cost first).
export const SINGING_CUE = "A person singing a song with deep emotion, like a live music performance: wide open mouth on sustained notes, expressive lips and jaw following the melody, visible breathing between phrases, eyes closing on long notes, natural head and shoulder movement with the rhythm";
export const SINGING_STYLE = 1;
// The song's Film look line (film-looks.ts), as the take was recorded with it, closes the prompt.
// The realism rules of the take's feel (realism.ts) follow the cue; a take made before them (no feel) keeps its old prompt.
// Then the feeling of the lines' section (feelings.ts), changing over the take when its lines run into another section.
// rests (breathing room): the voice sent is quiet between lines, and the prompt says what happens there.
export const BREATHING = "Between sung lines the mouth closes and the singer takes a natural breath, a small pause before singing again";
export const singingPrompt = (script: string, look?: string, feel?: Feel, feeling?: string, feelingTo?: string, rests = false) =>
  [SINGING_CUE, feel ? singingRealism(feel) : "", rests ? BREATHING : "", feelingWords(feeling, feelingTo), script.trim().replace(/\.$/, ""), look ? `Film look, the same in every shot: ${look.trim().replace(/\.$/, "")}` : ""].filter(Boolean).join(". ");
// parts: a vocal piece longer than PART_MAX_MS is made in parts of about PART_TARGET_MS (Joey's 4-10 s rule, Paul 22 Nov
// 2026: "6 to 8 s the lips are not in sync"), each its own request, every part from the picture itself (26 Nov 2026,
// Paul: a chained part 2 turned Aiko's face into a white mask), joined into one take, the join on a breath where possible; seconds / usd are then the parts' (each billed at least 3 s, whole seconds).
export type Piece = { fromMs: number; toMs: number; seconds: number; usd: number; parts?: { fromMs: number; toMs: number }[]; handles?: { inMs: number; outMs: number } }; // handles: the MV Generator's extra voice before and after
export const PART_MAX_MS = 10_000; // a piece up to this long is one request
export const PART_TARGET_MS = 8_000; // else parts of about this long
export const PART_MIN_MS = 4_000; // and never shorter than this
// A take of a group (the same picture or video, the same lines), as Lyrics Sync lists it under the group.
// inUse: its clip is the singing anchor on those lines now. fresh: a later take not chosen yet ("New — compare").
export type GroupTake = Take & { inUse: boolean; fresh: boolean };
export type SingerLine = {
  number: number;
  text: string;
  source: string | null; // the Creation file sung from (null: not ticked)
  piece: Piece; // what would be sent for this line's run (the same on every line of a run)
  script: string; // the block's little script (what the singer does; on every line of the block)
  run: { first: number; last: number } | null; // the run of lines in a row sung from the same source, in one take
  rests?: { fromMs: number; toMs: number }[]; // breathing room: where the voice sent is quieted (voiceRests)
  take: (Take & { file?: string }) | null; // the newest singing take of this line's run from its source
  takes: GroupTake[]; // every singing take of this group (its source, its lines), oldest first (only on a run's first line)
  needed: boolean; // ticked and without a finished or running take of this source and piece (only on a run's first line)
  voice?: LipsVoice; // the audio chosen for this group (on a run's first line)
  splitOf?: { first: number; last: number }; // the lines in a row with this picture, split into takes of at most the model's max
  draftUsd?: number; // what a draft of this group costs (480p)
  engine?: SingEngine; // the engine of the group's next take (on a run's first line)
  scene?: string; // the MV Generator's scene / mood for this group (on a run's first line)
  resolution?: SingResolution; // what this group's next take is made at (InfiniteTalk: at most 720p)
};
export type SingerView = {
  lines: SingerLine[] | null; // null: no timed lines yet
  why: string | null;
  sources: { file: string; label: string | null; url: string; kind: "picture" | "video" }[]; // Creation's pictures and videos (url: workspace-relative)
  voice: "stem" | "song";
  ready: boolean; // WAVESPEED_API_KEY (or the stand-in)
  keyName: string;
  toMake: { lines: number[]; seconds: number; usd: number }; // what Make singing clips would send (a group that cannot be made is not in it)
  blocked: { line: number; note: string }[]; // groups waiting for a take that cannot be made as chosen, in plain words
  usdPerSecond: number; // InfiniteTalk's, at the chosen resolution
  resolution: SingResolution; // what the next take is made at (singer.json; 720p by default; 1080p: the MV Generator only)
  engine: SingEngine; // the song's last engine choice
  aspect: SingAspect; // the shape asked of the MV Generator
  mvUsdPerSecond: number; // the MV Generator's, at the chosen resolution
  song: string | null; // workspace-relative song file (a take plays with the song from its first frame's song time)
  folder: string; // workspace-relative Creation folder (a take's file is <folder>/<take.file>)
  running: number; // singing takes being made now
  // The lip-sync review: groups (runs) with a source, how many have an approved take in use (or approved), how many
  // were marked to redo, and how many have no take yet.
  review: { groups: number; approved: number; redo: number; notMade: number };
  // The dry vocal for lips (28 Nov 2026): whether it can be made (a vocal stem, the de-reverb installed) and the state of
  // the dry vocal and the lead-only copy of this song's stem.
  dryVocal: { stem: boolean; installed: boolean; dry: "ready" | "making" | "none"; lead: "ready" | "making" | "none" };
};

export function readSinger(dir: string): SingerSettings {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, SINGER_FILE), "utf8")) as Partial<SingerSettings>;
    const obj = (v: unknown) => !!v && typeof v === "object";
    return {
      lines: obj(raw.lines) ? raw.lines! : {},
      ...(obj(raw.scripts) ? { scripts: raw.scripts } : {}),
      ...(isSingResolution(raw.resolution) ? { resolution: raw.resolution } : {}),
      ...(obj(raw.voices) ? { voices: raw.voices } : {}),
      ...(isSingEngine(raw.engine) ? { engine: raw.engine } : {}),
      ...(obj(raw.engines) ? { engines: Object.fromEntries(Object.entries(raw.engines!).filter(([, e]) => isSingEngine(e))) } : {}),
      ...(obj(raw.scenes) ? { scenes: raw.scenes } : {}),
      ...(raw.aspect === "9:16" || raw.aspect === "16:9" ? { aspect: raw.aspect } : {}),
    };
  } catch {
    return { lines: {} };
  }
}
function writeSinger(dir: string, s: SingerSettings): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SINGER_FILE), `${JSON.stringify({ _help: "Lyrics Sync → Singer: the lines where the singer shows, each with the Creation picture or video it is sung from. Written by the app.", ...s }, null, 2)}\n`);
}

// The vocal piece for a line: from just before the downbeat at or before the line shows, to two bars after it is sung.
export function singingPiece(line: { shownMs: number; sungEndMs: number }, downbeats: readonly number[], songMs: number, usdPerSecond = LIPSYNC_USD_PER_SECOND, tailBars = TAIL_BARS): Piece {
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).sort((a, b) => a - b);
  const bar = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2000;
  const cutAt = downbeats.filter((d) => d <= line.shownMs).at(-1) ?? line.shownMs - bar;
  let fromMs = Math.max(0, Math.round((cutAt - LEAD_MS) / 10) * 10);
  let toMs = Math.min(songMs, Math.round((line.sungEndMs + tailBars * bar) / 10) * 10);
  if (toMs - fromMs < LIPSYNC_MIN_SECONDS * 1000) {
    toMs = Math.min(songMs, fromMs + LIPSYNC_MIN_SECONDS * 1000);
    fromMs = Math.max(0, toMs - LIPSYNC_MIN_SECONDS * 1000);
  }
  const seconds = Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((toMs - fromMs) / 1000));
  return { fromMs, toMs, seconds, usd: Math.round(seconds * usdPerSecond * 100) / 100 };
}

// Breathing room (25 Nov 2026, realism plan; measured 26 Nov 2026): in the voice SENT to the lip-sync model (never the
// song or the video's sound), the real pauses are quieted with soft fades, so the mouth closes and the singer breathes
// where nobody sings. Where a pause is is MEASURED on the audio that is sent (the stem or the song, as cutVoice cuts it),
// never taken from the lyric timing: the lead-in may hold the end of the line before, and a pickup ("Oh") is often sung
// before the line's timed start. Everything sung in the piece is sent. A pause: at least REST_MIN_MS under a level
// relative to the piece's own vocal (REST_BELOW_DB under its 95th percentile, and above REST_FLOOR_DB); the rest keeps
// REST_PAD_MS of the voice around every sung sound. Never within REST_SAFE_MS before the first line's timed start.
// Song time, ms.
export const REST_PAD_MS = 250;
export const REST_MIN_MS = 500;
export const REST_FADE_MS = 120;
export const REST_WINDOW_MS = 50;
export const REST_BELOW_DB = 35;
export const REST_FLOOR_DB = -60;
export const REST_SAFE_MS = 600;
export type Rest = { fromMs: number; toMs: number };
// The rests of a mono 16-bit piece (samples from piece.fromMs at `rate`). protectFromMs: the first line's timed start.
export function measureRests(samples: Int16Array, rate: number, piece: { fromMs: number; toMs: number }, protectFromMs?: number): Rest[] {
  const win = Math.max(1, Math.round((rate * REST_WINDOW_MS) / 1000));
  const n = Math.floor(samples.length / win);
  if (n < 1) return [];
  const db: number[] = [];
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sum += (samples[i] / 32768) ** 2;
    db.push(10 * Math.log10(sum / win + 1e-12));
  }
  const p95 = [...db].sort((x, y) => x - y)[Math.min(n - 1, Math.floor(n * 0.95))];
  if (p95 < REST_FLOOR_DB) return []; // no voice to measure against
  const threshold = Math.max(p95 - REST_BELOW_DB, REST_FLOOR_DB);
  const minWindows = Math.ceil(REST_MIN_MS / REST_WINDOW_MS);
  const out: Rest[] = [];
  for (let w = 0; w < n; ) {
    if (db[w] >= threshold) { w++; continue; }
    let e = w;
    while (e < n && db[e] < threshold) e++;
    if (e - w >= minWindows) {
      const from = w === 0 ? 0 : w * REST_WINDOW_MS + REST_PAD_MS;
      const to = e === n ? piece.toMs - piece.fromMs : e * REST_WINDOW_MS - REST_PAD_MS;
      if (to > from) out.push({ fromMs: piece.fromMs + from, toMs: piece.fromMs + to });
    }
    w = e;
  }
  if (protectFromMs === undefined) return out;
  const lo = protectFromMs - REST_SAFE_MS;
  const safe: Rest[] = [];
  for (const r of out) {
    if (r.toMs <= lo || r.fromMs >= protectFromMs) safe.push(r);
    else {
      if (r.fromMs < lo) safe.push({ fromMs: r.fromMs, toMs: lo });
      if (r.toMs > protectFromMs) safe.push({ fromMs: protectFromMs, toMs: r.toMs });
    }
  }
  return safe.filter((r) => r.toMs > r.fromMs).map((r) => ({ fromMs: Math.round(r.fromMs), toMs: Math.round(r.toMs) }));
}
// The rests of a piece of the voice sent: the piece is cut exactly as cutVoice cuts it (no rests), decoded and measured.
// Any failure (no audio, no ffmpeg): no rests, the voice is sent whole.
export function voiceRests(voice: Voice, songFile: string, piece: { fromMs: number; toMs: number }, protectFromMs?: number): Rest[] {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-rests-"));
  try {
    const wav = path.join(tmp, "piece.wav");
    cutVoice(voice, songFile, piece, wav);
    const b = readFileSync(wav);
    const at = b.indexOf("data");
    if (at < 0) return [];
    const start = at + 8;
    const samples = new Int16Array(Math.floor((b.length - start) / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = b.readInt16LE(start + i * 2);
    return measureRests(samples, 44100, piece, protectFromMs);
  } catch {
    return [];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
// The rests of a group, for the take recorded now (undefined: none, the voice is sent whole and the prompt says nothing).
async function restsFor(ws: Workspace, projectId: string, l: SingerLine): Promise<Rest[] | undefined> {
  try {
    const c = await context(ws, projectId);
    const first = c.lines?.find((x) => x.number === l.number);
    const sv = await voiceFor(ws, projectId);
    const voice: Voice = l.voice === "song" ? { kind: "song" } : sv; // (the de-reverbed copy is made later: the stem measures the same pauses)
    const r = voiceRests(voice, c.songFile, { fromMs: l.piece.fromMs, toMs: l.piece.toMs }, first?.shownMs);
    return r.length ? r : undefined;
  } catch {
    return undefined;
  }
}

// The line with its rests measured, and its parts (if any) cut again on those pauses (price and seconds as before).
async function withRests(ws: Workspace, projectId: string, l: SingerLine, usdPerSecond: number): Promise<SingerLine> {
  const rests = await restsFor(ws, projectId, l);
  if (!rests || !l.piece.parts) return { ...l, rests };
  const c = await context(ws, projectId);
  return { ...l, rests, piece: singingParts({ ...l.piece, parts: undefined }, c.downbeats, c.lines ?? [], usdPerSecond, rests, oneRequestMs()) };
}

// The ffmpeg gain for a voice piece starting at song time fromMs: 0 inside each rest, soft fades at its edges.
export function restGain(rests: readonly { fromMs: number; toMs: number }[], fromMs: number, toMs = Infinity): string | null {
  const inPiece = rests.map((r) => ({ a: (r.fromMs - fromMs) / 1000, b: (r.toMs - fromMs) / 1000 })).filter((r) => r.b > 0);
  if (!inPiece.length) return null;
  const f = REST_FADE_MS / 1000;
  // Each rest: 1 - clip(min((t-a)/f, (b-t)/f), 0, 1); the edge at the piece's own start or end does not fade in.
  const end = (toMs - fromMs) / 1000;
  return inPiece.map((r) => `(1-clip(min((t-${r.a.toFixed(3)})/${f}+${r.a <= 0 ? 99 : 0},(${r.b.toFixed(3)}-t)/${f}+${r.b >= end ? 99 : 0}),0,1))`).join("*");
}

// The parts of a long vocal piece, a cut near every PART_TARGET_MS (between PART_MIN_MS and PART_MAX_MS from the last cut,
// leaving at least PART_MIN_MS). Each cut goes, in this order: the middle of a measured pause (`rests`, where the vocal is
// silent: the join falls on a breath), a downbeat not inside a sung line, any downbeat, the target. Short pieces: one part.
export function singingParts(piece: Piece, downbeats: readonly number[], lines: readonly { shownMs: number; sungEndMs: number }[], usdPerSecond = LIPSYNC_USD_PER_SECOND, rests: readonly { fromMs: number; toMs: number }[] = [], oneRequest = PART_MAX_MS): Piece {
  if (piece.toMs - piece.fromMs <= oneRequest) return piece;
  const parts: { fromMs: number; toMs: number }[] = [];
  const sung = (t: number) => lines.some((l) => l.shownMs <= t && t <= l.sungEndMs);
  let start = piece.fromMs;
  while (piece.toMs - start > PART_MAX_MS) {
    const lo = start + PART_MIN_MS;
    const hi = Math.min(start + PART_MAX_MS, piece.toMs - PART_MIN_MS);
    const near = (list: number[]) => list.sort((a, b) => Math.abs(a - (start + PART_TARGET_MS)) - Math.abs(b - (start + PART_TARGET_MS)))[0];
    const inWindow = downbeats.filter((d) => d >= lo && d <= hi);
    // A pause's middle, when it lies inside the window (the pause nearest the target first).
    const mids = rests.map((x) => (x.fromMs + x.toMs) / 2).filter((m) => m >= lo && m <= hi);
    const cut = near(mids) ?? near(inWindow.filter((d) => !sung(d))) ?? near(inWindow) ?? Math.min(hi, start + PART_TARGET_MS);
    parts.push({ fromMs: start, toMs: Math.round(cut) });
    start = Math.round(cut);
  }
  parts.push({ fromMs: start, toMs: piece.toMs });
  const seconds = parts.reduce((n, x) => n + Math.max(LIPSYNC_MIN_SECONDS, Math.ceil((x.toMs - x.fromMs) / 1000)), 0);
  return { ...piece, seconds, usd: Math.round(seconds * usdPerSecond * 100) / 100, parts };
}

type Ctx = { root: string; dir: string; songRel: string | null; songFile: string; songMs: number; lines: { number: number; text: string; shownMs: number; sungEndMs: number }[] | null; why: string | null; downbeats: number[] };
async function context(ws: Workspace, projectId: string): Promise<Ctx> {
  const { root, dir } = songFolder(ws, projectId);
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path) throw new Error("Song not found.");
  const view = await lyricsView(ws, projectId);
  const beats = applyDownbeatOffset(
    ws.db.select().from(beatTable).where(eq(beatTable.project_id, projectId)).all().sort((a, b) => a.time_ms - b.time_ms).map((b) => ({ time_ms: b.time_ms, strength: b.strength, is_downbeat: b.is_downbeat })),
    p.downbeat_offset ?? 0,
  );
  return {
    root,
    dir,
    songRel: p.audio_path ?? null,
    songFile: absPath(ws, p.audio_path),
    songMs: p.duration_ms ?? 600_000,
    lines: view.lines?.map((l) => ({ number: l.number, text: l.text, shownMs: l.screen.readableMs, sungEndMs: l.sungEndMs ?? l.screen.leaveMs })) ?? null,
    why: view.why,
    downbeats: beats.filter((b) => b.is_downbeat).map((b) => b.time_ms),
  };
}

// The song's file, lines (shown time, sung end) and downbeats, as the Singer reads them (music-video.ts too).
export const singerContext = (ws: Workspace, projectId: string) => context(ws, projectId);

// Every singing take of a group: the same picture or video, the same first and last line (oldest first).
function groupTakes(dir: string, source: string, first: number, last: number): Take[] {
  const rec = readPictures(dir).pictures[source];
  return (rec?.takes ?? []).filter((t) => t.kind === "lipsync" && t.line === first && (t.through ?? t.line) === last).map((t) => (t.clip && !t.sent ? { ...t, sent: t.clip } : t));
}
// The singing anchors of the song now: "first:last:clip" (lower case), to tell which take is in use.
function singingAnchorKeys(ws: Workspace, projectId: string): Set<string> {
  const recipe = songPathsById(ws, projectId).recipe;
  return new Set((recipe ? (readRecipe(recipe).anchors ?? []) : []).filter((a) => a.sync !== undefined).map((a) => `${a.line}:${a.through ?? a.line}:${a.clip.toLowerCase()}`));
}
// Does a singing anchor (a clip locked to the song) cover any of these lines, whichever clip or source it is from?
export function singingAnchorOver(ws: Workspace, projectId: string, first: number, last: number): boolean {
  const recipe = songPathsById(ws, projectId).recipe;
  return (recipe ? (readRecipe(recipe).anchors ?? []) : []).some((a) => a.sync !== undefined && a.line <= last && (a.through ?? a.line) >= first);
}
const inUseKey = (t: Take) => (t.sent ? `${t.line}:${t.through ?? t.line}:${t.sent.toLowerCase()}` : "");

// A run longer than the model's max take split at sung-line boundaries (greedy: as many lines as fit; a single line
// that is longer on its own stays whole and is made in parts).
export function splitRun(run: { source: string; first: number; last: number }, fits: (first: number, last: number) => boolean): { source: string; first: number; last: number }[] {
  const out: { source: string; first: number; last: number }[] = [];
  let first = run.first;
  while (first <= run.last) {
    let last = first;
    while (last < run.last && fits(first, last + 1)) last++;
    out.push({ source: run.source, first, last });
    first = last + 1;
  }
  return out;
}

// The runs: ticked lines in a row (by number) with the same source and a short pause between them.
export function singingRuns(lines: readonly { number: number; shownMs: number; sungEndMs: number }[], settings: SingerSettings, gapMs = RUN_GAP_MS): { source: string; first: number; last: number }[] {
  const runs: { source: string; first: number; last: number; endMs: number }[] = [];
  for (const l of [...lines].sort((a, b) => a.number - b.number)) {
    const source = settings.lines[String(l.number)];
    if (!source) continue;
    const prev = runs.at(-1);
    if (prev && prev.source === source && prev.last === l.number - 1 && l.shownMs - prev.endMs <= gapMs) {
      prev.last = l.number;
      prev.endMs = l.sungEndMs;
    } else runs.push({ source, first: l.number, last: l.number, endMs: l.sungEndMs });
  }
  return runs.map(({ source, first, last }) => ({ source, first, last }));
}
// A group is made when one of its takes (running, done, or sent and waiting for its result) has this vocal piece and
// the singing cue. A new mood text or resolution does not make a group "to make" again: Retake makes another take.
const covers = (t: Take, piece: Piece) => (t.status === "running" || t.status === "done" || t.status === "interrupted") && t.sync_ms !== undefined && t.sync_ms + (t.kept?.inMs ?? 0) === piece.fromMs && t.style === SINGING_STYLE; // (an MV take that kept its breath in starts earlier than the piece)

export async function singerView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<SingerView> {
  const c = await context(ws, projectId);
  const settings = readSinger(c.dir);
  const board = readPictures(c.dir).pictures;
  const rel = path.relative(ws.dir, c.dir).split(path.sep).join("/");
  const sources = existsSync(c.dir)
    ? readdirSync(c.dir)
        .filter((f) => (PICTURE_FILE.test(f) || BOARD_VIDEO_FILE.test(f)) && statSync(path.join(c.dir, f)).isFile())
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((f) => ({ file: f, label: board[f]?.label ?? null, url: `${rel}/${f}`, kind: PICTURE_FILE.test(f) ? ("picture" as const) : ("video" as const) }))
    : [];
  const byNumber = new Map((c.lines ?? []).map((l) => [l.number, l]));
  const maxMs = LIPSYNC_MAX_TAKE_MS[LIPSYNC_MODEL] ?? 8000;
  const fits = (first: number, last: number) => {
    const p = singingPiece({ shownMs: byNumber.get(first)!.shownMs, sungEndMs: byNumber.get(last)!.sungEndMs }, c.downbeats, c.songMs, LIPSYNC_USD_PER_SECOND, SINGING_TAIL_BARS);
    return p.toMs - p.fromMs <= maxMs;
  };
  const whole = c.lines ? singingRuns(c.lines, settings) : [];
  const runs = whole.flatMap((r) => splitRun(r, fits).map((x) => ({ ...x, ...(x.first !== r.first || x.last !== r.last ? { of: { first: r.first, last: r.last } } : {}) })));
  const resolution: SingResolution = settings.resolution ?? LIPSYNC_RESOLUTION;
  const usdPerSecond = LIPSYNC_USD_PER_SECOND_AT[itResolution(resolution)];
  const anchors = singingAnchorKeys(ws, projectId);
  const lines = c.lines?.map((l) => {
    const source = settings.lines[String(l.number)] ?? null;
    const run = runs.find((r) => r.first <= l.number && l.number <= r.last) ?? null;
    const first = run ? byNumber.get(run.first)! : l;
    const last = run ? byNumber.get(run.last)! : l;
    const engine = engineOf(settings, run?.first ?? l.number, source);
    // A picture's long piece is made in parts (a video source stays one request: its motion cannot be chained).
    // The MV Generator takes up to 10 minutes in one request: never in parts; its handles are in its cost.
    const whole = singingPiece({ shownMs: first.shownMs, sungEndMs: last.sungEndMs }, c.downbeats, c.songMs, usdPerSecond, SINGING_TAIL_BARS);
    const piece = engine === "mv" ? mvSingPiece(whole, c.songMs, resolution) : source && BOARD_VIDEO_FILE.test(source) ? whole : singingParts(whole, c.downbeats, c.lines ?? [], usdPerSecond, [], oneRequestMs());
    const all = source && run ? groupTakes(c.dir, source, run.first, run.last) : [];
    const take = all.at(-1) ?? null;
    const script = run ? (settings.scripts?.[String(run.first)] ?? "") : "";
    const takes: GroupTake[] = run?.first === l.number ? all.map((t) => ({ ...t, inUse: t.status === "done" && anchors.has(inUseKey(t)), fresh: !!t.fresh && t.status === "done" })) : [];
        const firstLine = run?.first === l.number;
    return { number: l.number, text: l.text, source, piece, script, run: run ? { first: run.first, last: run.last } : null, ...(run && "of" in run && run.of ? { splitOf: run.of } : {}), take, takes, needed: !!source && firstLine && !all.some((t) => covers(t, piece)), ...(firstLine ? { voice: settings.voices?.[String(l.number)] ?? "stem", draftUsd: draftUsd(piece.seconds), engine, scene: settings.scenes?.[String(l.number)] ?? "", resolution: engine === "mv" ? resolution : itResolution(resolution) } : {}) };
  }) ?? null;
  const toMake = (lines ?? []).filter((l) => l.needed && !mvBlocked(l));
  const blocked = (lines ?? []).filter((l) => l.needed).flatMap((l) => (mvBlocked(l) ? [{ line: l.number, note: mvBlocked(l)! }] : []));
  return {
    lines,
    why: c.lines ? null : c.why,
    sources,
    voice: (await voiceFor(ws, projectId)).kind,
    ready: !!env.LYRIC_GENERATE_STUB || !!keyFor("wavespeed", env),
    keyName: "WAVESPEED_API_KEY",
    blocked,
    toMake: { lines: toMake.map((l) => l.number), seconds: toMake.reduce((s, l) => s + l.piece.seconds, 0), usd: Math.round(toMake.reduce((s, l) => s + l.piece.usd, 0) * 100) / 100 },
    usdPerSecond,
    resolution,
    engine: settings.engine ?? "infinitetalk",
    aspect: settings.aspect ?? "9:16",
    mvUsdPerSecond: MV_SING_USD_PER_SECOND[resolution],
    song: c.songRel,
    folder: rel,
    running: (lines ?? []).reduce((n, l) => n + l.takes.filter((t) => t.status === "running").length, 0),
    review: reviewCounts(lines ?? []),
    dryVocal: await dryVocalView(ws, projectId, env),
  };
}

// The review progress: a group counts approved when its take in use (else its newest done take) is approved, or is the
// final of an approved draft; to redo when that take is marked redo; not made when it has no done take.
export function reviewCounts(lines: readonly Pick<SingerLine, "source" | "run" | "number" | "takes">[]): SingerView["review"] {
  const groups = lines.filter((l) => l.source && l.run && l.run.first === l.number);
  let approved = 0;
  let redo = 0;
  let notMade = 0;
  for (const g of groups) {
    const done = g.takes.filter((t) => t.status === "done");
    const t = done.find((x) => x.inUse) ?? done.at(-1);
    if (!t) notMade++;
    else if (t.review?.verdict === "approved" || (t.finalOf !== undefined && done.some((d) => d.n === t.finalOf && d.review?.verdict === "approved"))) approved++;
    else if (t.review?.verdict === "redo" || !!t.qa?.segments.length) redo++;
  }
  return { groups: groups.length, approved, redo, notMade };
}

// The engine of a group (its first line): its own choice, else the song's last choice, else InfiniteTalk. The song's
// remembered choice only applies to a group sung from a picture (the MV Generator takes pictures only): a group sung
// from a video uses InfiniteTalk unless the group itself was set to the MV Generator (then "needs a picture" stands).
export const engineOf = (s: SingerSettings, first: number, source?: string | null): SingEngine => s.engines?.[String(first)] ?? (source && BOARD_VIDEO_FILE.test(source) ? "infinitetalk" : (s.engine ?? "infinitetalk"));

// The engine of the group that starts on `line` from its next take on; it is also the song's choice from now on (a
// group without its own choice uses it).
export function setSingerEngine(ws: Workspace, projectId: string, line: unknown, engine: unknown): SingerSettings {
  if (!isSingEngine(engine)) throw new Error("Choose InfiniteTalk or MV Generator.");
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const s = readSinger(dir);
  const next = { ...s, engine, engines: { ...(s.engines ?? {}), [String(n)]: engine } };
  writeSinger(dir, next);
  return next;
}

// The MV Generator's scene / mood for the group that starts on `line` (empty removes it); saved with each take sent.
export function setSingerScene(ws: Workspace, projectId: string, line: unknown, text: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, SCENE_MAX);
  const s = readSinger(dir);
  const scenes = { ...(s.scenes ?? {}) };
  if (clean) scenes[String(n)] = clean;
  else delete scenes[String(n)];
  const next = { ...s, scenes };
  writeSinger(dir, next);
  return next;
}

// The shape asked of the MV Generator (the video's shape: 9:16 for Reels, TikTok and Shorts; 16:9 for YouTube).
export function setSingerAspect(ws: Workspace, projectId: string, aspect: unknown): SingerSettings {
  if (aspect !== "9:16" && aspect !== "16:9") throw new Error("Choose 9:16 or 16:9.");
  const { dir } = songFolder(ws, projectId);
  const next = { ...readSinger(dir), aspect: aspect as SingAspect };
  writeSinger(dir, next);
  return next;
}

// The resolution singing clips are made at from now on (this video's singer.json); takes already made keep theirs.
export function setSingerResolution(ws: Workspace, projectId: string, resolution: unknown): SingerSettings {
  if (!isSingResolution(resolution)) throw new Error(`Choose ${SING_RESOLUTIONS.join(", ")}.`);
  const { dir } = songFolder(ws, projectId);
  const next = { ...readSinger(dir), resolution };
  writeSinger(dir, next);
  return next;
}

// Tick or untick a line, or choose what it is sung from (null: not a singing line).
export function setSingerLine(ws: Workspace, projectId: string, line: unknown, source: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const s = readSinger(dir);
  if (source === null || source === undefined || source === "") {
    delete s.lines[String(n)];
    // No singer on this line: the singing clip that covers it leaves (and is set to Omit, see saveAnchors); the other
    // lines of its run are made again as their own run.
    const recipe = readRecipe(songPathsById(ws, projectId).recipe);
    const covering = (a: { line: number; sync?: number; through?: number }) => a.sync !== undefined && a.line <= n && n <= (a.through ?? a.line);
    if ((recipe.anchors ?? []).some(covering)) saveAnchors(ws, projectId, (recipe.anchors ?? []).filter((a) => !covering(a)));
  } else {
    const name = path.basename(String(source));
    if (!(PICTURE_FILE.test(name) || BOARD_VIDEO_FILE.test(name)) || !existsSync(path.join(dir, name))) throw new Error(`No ${name} in this song's Creation space: add the picture or video there first.`);
    s.lines[String(n)] = name;
  }
  writeSinger(dir, s);
  return s;
}

// The little script of the block that starts on `line` (what the singer does: "turns to the sea, soft smile"); empty
// removes it. A block already made is made again only when Paul presses Make singing clips (the cost shows first).
export function setSingerScript(ws: Workspace, projectId: string, line: unknown, text: unknown): SingerSettings {
  const { dir } = songFolder(ws, projectId);
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1) throw new Error("Choose a line.");
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, SCRIPT_MAX);
  const s = readSinger(dir);
  const scripts = { ...(s.scripts ?? {}) };
  if (clean) scripts[String(n)] = clean;
  else delete scripts[String(n)];
  const next = { ...s, scripts };
  writeSinger(dir, next);
  return next;
}

// The voice sent to the model: the vocal stem (lined up on the song by the stem check) when it follows the song, else
// the song itself.
export type Voice = { kind: "stem"; file: string; offsetMs: number; speed?: number } | { kind: "song" };
export async function voiceFor(ws: Workspace, projectId: string, project?: typeof projectTable.$inferSelect): Promise<Voice> {
  const p = project ?? ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) return { kind: "song" };
  const paths = songPaths(ws, p);
  if (!paths.vocals || !existsSync(paths.vocals)) return { kind: "song" };
  const stored = p.audio_hash ? await storedStemCheck(ws, { project: p, songHash: p.audio_hash }).catch(() => null) : null;
  if (stored?.check.status === "rejected") return { kind: "song" };
  return { kind: "stem", file: paths.vocals, offsetMs: stored?.check.offset_ms ?? 0, ...(typeof stored?.check.speed === "number" ? { speed: stored.check.speed } : {}) };
}

// A piece of the voice as a WAV (song time fromMs → toMs; the stem's offset and speed applied).
// rests (breathing room, measured by voiceRests): quieted in this copy only.
export function cutVoice(voice: Voice, songFile: string, piece: { fromMs: number; toMs: number }, out: string, rests: readonly { fromMs: number; toMs: number }[] = []): void {
  const durS = (piece.toMs - piece.fromMs) / 1000;
  const gain = restGain(rests, piece.fromMs, piece.toMs);
  const quiet = gain ? [`volume='${gain}':eval=frame`] : [];
  if (voice.kind === "stem") {
    const speed = voice.speed ?? 1;
    const startS = Math.max(0, (voice.offsetMs + speed * piece.fromMs) / 1000);
    const af = [...(speed !== 1 ? [`atempo=${speed}`] : []), ...quiet];
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", startS.toFixed(3), "-t", (durS * speed).toFixed(3), "-i", voice.file, ...(af.length ? ["-af", af.join(",")] : []), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  } else {
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (piece.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3), "-i", songFile, ...(quiet.length ? ["-af", quiet[0]] : []), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  }
}

// ---------------------------------------------------------------- a take with the song (Creation's player)

// Where each take belongs in the song (Paul, 21 Nov 2026: "why can't I hear the song with the take? it would be easier to
// check"): a singing take from its own first frame (sync_ms: the vocal piece it was made from); an Animate take shown on
// a line from the downbeat that line cuts in on (minus where in the clip it starts). A take on no line has no place in
// the song yet. Adds song / songFromMs / clipInS / songWhy to the view (Creation plays the song file with the silent take).
export async function withSongStarts(ws: Workspace, projectId: string, view: PicturesView): Promise<PicturesView> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p?.audio_path) return view;
  const recipe = songPathsById(ws, projectId).recipe;
  const plain = (recipe ? (readRecipe(recipe).anchors ?? []) : []).filter((a) => a.sync === undefined);
  const placed = (t: Take) => {
    const clip = (t.sent ?? t.clip)?.toLowerCase();
    return clip ? plain.filter((a) => a.clip.toLowerCase() === clip).sort((a, b) => a.line - b.line)[0] : undefined;
  };
  const needLines = view.pictures.some((pic) => pic.takes.some((t) => t.kind !== "lipsync" && t.status === "done" && placed(t)));
  const c = needLines ? await context(ws, projectId).catch(() => null) : null;
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
  for (const pic of view.pictures) {
    pic.takes = pic.takes.map((t) => {
      if (t.status !== "done") return t;
      if (t.kind === "lipsync" && t.sync_ms !== undefined) return { ...t, songFromMs: t.sync_ms, clipInS: 0, songWhy: `with the song from ${clock(t.sync_ms)}, where this take's vocal starts: the lips should sing what the song sings` };
      const a = placed(t);
      const line = a && c?.lines?.find((l) => l.number === a.line);
      if (!a || !line || !c) return t;
      const cut = c.downbeats.filter((d) => d <= line.shownMs).at(-1) ?? line.shownMs;
      return { ...t, songFromMs: cut, clipInS: a.clipIn ?? 0, songWhy: `with the song from ${clock(cut)}, where line ${a.line} cuts to it` };
    });
  }
  return { ...view, song: p.audio_path };
}

// ---------------------------------------------------------------- the service

export type SingTransport = {
  upload: (file: string) => Promise<string>;
  // mv: the Music Video Generator instead of InfiniteTalk (one picture, its shape).
  submit: (o: { image?: string; video?: string; audio: string; prompt?: string; resolution?: SingResolution; mv?: { aspect: SingAspect } }) => Promise<{ id: string }>;
  poll: (id: string) => Promise<{ status: "running" } | { status: "done"; url: string } | { status: "failed"; error: string }>;
  download: (url: string, file: string) => Promise<void>;
};

export function infiniteTalkTransport(key: string, f: typeof fetch = (...a) => globalThis.fetch(...a)): SingTransport {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    upload: (file) => waveSpeedUpload(key, file, f),
    submit: async (o) => {
      if (o.mv) {
        if (!o.image) throw Object.assign(new Error("The MV Generator needs a picture of the singer"), { unsent: true });
        const body = mvSingRequest({ image: o.image, audio: o.audio, prompt: o.prompt ?? MV_SING_RULES, aspect: o.mv.aspect, resolution: o.resolution ?? LIPSYNC_RESOLUTION });
        const b = data(await json(await f(`${WAVESPEED}/${MV_GENERATOR_PATH}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), "WaveSpeed MV Generator"));
        if (typeof b.id !== "string") throw new Error("WaveSpeed: no request id in the answer");
        return { id: b.id };
      }
      const model = o.video ? "wavespeed-ai/infinitetalk/video-to-video" : "wavespeed-ai/infinitetalk";
      const body = { ...(o.video ? { video: o.video } : { image: o.image }), audio: o.audio, ...(o.prompt ? { prompt: o.prompt } : {}), resolution: itResolution(o.resolution), seed: -1 };
      const b = data(await json(await f(`${WAVESPEED}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), "WaveSpeed InfiniteTalk"));
      if (typeof b.id !== "string") throw new Error("WaveSpeed: no request id in the answer");
      return { id: b.id };
    },
    poll: async (id) => {
      const r = await f(`${WAVESPEED}/predictions/${encodeURIComponent(id)}/result`, { headers: auth });
      if (r.status === 429 || r.status >= 500) return { status: "running" };
      const b = data(await json(r, "WaveSpeed"));
      const s = String(b.status ?? "");
      if (s === "completed") {
        const url = (b.outputs as unknown[] | undefined)?.find((x): x is string => typeof x === "string");
        return url ? { status: "done", url } : { status: "failed", error: "finished without a video" };
      }
      if (["failed", "cancelled", "timeout", "deleted"].includes(s)) return { status: "failed", error: String(b.error || s) };
      return { status: "running" };
    },
    download: (url, file) => download(url, file, writeFileSync, undefined, f),
  };
}

// Tests and the cloud (LYRIC_GENERATE_STUB): a clip as long as the voice, made from the picture (or the video's first
// frame) by FFmpeg, with the voice as its sound (as the real service returns it); nothing sent anywhere.
let stubTakes = 0; // every stand-in take a little different (as the real ones are), across requests
export function stubSingTransport(mode: string): SingTransport {
  const files = new Map<string, string>();
  let n = 0;
  return {
    upload: async (file) => {
      const url = `stub://${++n}`;
      files.set(url, file);
      return url;
    },
    submit: async (o) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      return { id: JSON.stringify({ picture: files.get(o.image ?? o.video ?? "") ?? "", audio: files.get(o.audio) ?? "", take: ++stubTakes }) };
    },
    poll: async (id) => ({ status: "done", url: id }),
    download: async (url, file) => {
      const { picture, audio, take } = JSON.parse(url) as { picture: string; audio: string; take?: number };
      const still = PICTURE_FILE.test(picture);
      // As long as the voice, exactly (-shortest alone lets a looped still run a few frames past it).
      const voiceMs = (await probeMedia(audio)).durationMs;
      execFileSync(ffmpegBin(), ["-y", "-v", "error", ...(still ? ["-loop", "1"] : ["-stream_loop", "-1"]), "-i", picture, "-i", audio, "-shortest", "-t", (voiceMs / 1000).toFixed(3), "-r", "30", "-vf", `scale=trunc(iw/2)*2:trunc(ih/2)*2,drawbox=x=${(take ?? 0) % 40}:y=0:w=2:h=2:color=white:t=fill,format=yuv420p`, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", file]);
    },
  };
}

export function singTransportFor(env: NodeJS.ProcessEnv = process.env): SingTransport {
  if (env.LYRIC_GENERATE_STUB) return stubSingTransport(env.LYRIC_GENERATE_STUB);
  const key = keyFor("wavespeed", env);
  if (!key) throw new Error("No WAVESPEED_API_KEY in .env: add a line WAVESPEED_API_KEY=<your key from wavespeed.ai → API keys> to D:\\videomaker\\.env, then restart Lyric Studio.");
  return infiniteTalkTransport(key);
}

// ---------------------------------------------------------------- make the singing clips

export type SingJob = { source: string; n: number };

// "Make singing clips": checks the cost against the cap and records a running take for every ticked line that has no
// clip for its source and piece yet (a line already made is never paid for twice). `lines`: only these.
export async function startSinging(ws: Workspace, projectId: string, o: { capUsd: number; lines?: number[]; draft?: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<{ jobs: SingJob[]; usd: number; seconds: number; notes: string[]; lines: number[] }> {
  const view = await singerView(ws, projectId, env);
  if (!view.lines) throw new Error(view.why ?? "This song's lines are not timed yet.");
  const wanted = view.lines.filter((l) => l.needed && (!o.lines || o.lines.includes(l.number)));
  if (!wanted.length) throw new Error("Nothing to make: tick the lines where the singer shows (each with its picture or video), or they are made already.");
  // A group that cannot be made as chosen is left out with a note; the others are made.
  const todo = wanted.filter((l) => !mvBlocked(l));
  const notes = wanted.filter((l) => mvBlocked(l)).map((l) => mvBlocked(l)!);
  if (!todo.length) throw new Error(`${notes.join(" ")} Nothing was sent.`);
  if (!view.ready) singTransportFor(env); // throws the plain-words message
  const cost = (l: SingerLine) => (o.draft ? draftUsd(l.piece.seconds) : l.piece.usd);
  const usd = Math.round(todo.reduce((s, l) => s + cost(l), 0) * 100) / 100;
  const seconds = todo.reduce((s, l) => s + l.piece.seconds, 0);
  const cap = Number(o.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (usd > cap) throw new Error(`${todo.length} singing line${todo.length === 1 ? "" : "s"} (${seconds} s of voice) cost about $${usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: tick fewer lines or raise the cap. Nothing was sent.`);
  const { dir } = songFolder(ws, projectId);
  const now = new Date().toISOString();
  const look = filmLookFor(ws, projectId);
  const feel = feelFor(ws, projectId);
  const jobs: SingJob[] = [];
  for (const l0 of todo) {
    // The MV Generator gets the voice as it is (no breathing room: a silent stretch can make it cut to a story scene).
    const l = l0.engine === "mv" ? l0 : await withRests(ws, projectId, l0, view.usdPerSecond);
    jobs.push(recordTake(dir, l, l.resolution ?? view.resolution, now, look, feel, feelingForLines(ws, projectId, l.number, l.run?.last), { draft: !!o.draft, direction: await directionOf(ws, projectId, l), aspect: view.aspect }));
  }
  return { jobs, usd, seconds, notes, lines: todo.map((l) => l.number) };
}

// The MV Generator sings from a picture only (it takes images, not a video): why a group cannot be made, else null.
function mvBlocked(l: SingerLine): string | null {
  return l.engine === "mv" && l.source && !PICTURE_FILE.test(l.source) ? `Line ${l.number} was not made: it is sung from a video and the MV Generator needs a picture: choose a picture or InfiniteTalk.` : null;
}
// (a single group asked for by name: the plain refusal)
function mvNeedsPicture(l: SingerLine): void {
  if (mvBlocked(l)) throw new Error(`Line ${l.number} is sung from a video: the MV Generator needs a picture of the singer. Choose a picture for it, or InfiniteTalk. Nothing was sent.`);
}

// A new running take of a group (its picture, its lines, its vocal piece, the mood text and resolution of now; the
// engine, scene and shape of now).
function recordTake(dir: string, l: SingerLine, resolution: SingResolution, now: string, look: { name: string; line: string } | null, feel: Feel, feeling: TakeFeeling = {}, o: { draft?: boolean; direction?: string; aspect?: SingAspect } = {}): SingJob {
  let n = 0;
  const mv = l.engine === "mv";
  const res = o.draft ? DRAFT_RESOLUTION : mv ? resolution : itResolution(resolution);
  const usd = o.draft ? draftUsd(l.piece.seconds) : l.piece.usd;
  update(dir, l.source!, (p) => {
    n = nextTakeN(p);
    p.takes.push({ n, kind: "lipsync", line: l.number, ...(l.run && l.run.last > l.number ? { through: l.run.last } : {}), sync_ms: l.piece.fromMs, to_ms: l.piece.toMs, ...(l.piece.parts && !mv ? { parts: l.piece.parts.map((x) => ({ ...x })) } : {}), ...(l.script ? { prompt: l.script } : {}), ...(o.direction ? { direction: o.direction } : {}), voice: l.voice ?? "stem", style: SINGING_STYLE, ...(look ? { filmLook: look.name, look: look.line } : {}), feel, ...feeling, ...(l.rests && !mv ? { rests: l.rests.map((r) => ({ ...r })) } : {}), ...(mv ? { engine: "mv" as const, handles: { ...(l.piece.handles ?? { inMs: 0, outMs: 0 }) }, aspect: o.aspect ?? "9:16", ...(l.scene ? { scene: l.scene } : {}) } : {}), resolution: res, service: "wavespeed", quality: o.draft ? "draft" : "best", model: mv ? MV_SING_MODEL : LIPSYNC_MODEL, status: "running", started_at: now, cost_usd: usd, pid: process.pid });
  });
  return { source: l.source!, n };
}

// The acting direction sent with a group's singing cue (26 Nov 2026): who sings (the picture's "Who is this", else the
// song's one character), their persona (how they sing, gestures, never) and the first line's performance-script
// direction (emotion, face, body). "" without a persona or script. Imported lazily (persona.ts reads lipsync.ts, which
// reads this file).
async function directionOf(ws: Workspace, projectId: string, l: SingerLine): Promise<string> {
  try {
    const { singingDirection } = await import("./persona");
    return await singingDirection(ws, projectId, l.source!, l.number, l.run?.last ?? l.number);
  } catch {
    return "";
  }
}

// "Retake" (Lyrics Sync, next to "singing clip on lines X–Y"): the same group again as a new take: the same picture or
// video, the same piece of the vocal, the mood text and resolution of now. Earlier takes are never touched; the new one
// arrives as "New — compare" when the group already has a take in use.
export async function startRetake(ws: Workspace, projectId: string, o: { capUsd: number; line: unknown; draft?: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<{ jobs: SingJob[]; usd: number; seconds: number }> {
  const view = await singerView(ws, projectId, env);
  if (!view.lines) throw new Error(view.why ?? "This song's lines are not timed yet.");
  const n = Number(o.line);
  const l = view.lines.find((x) => x.number === n);
  if (!l?.source || !l.run) throw new Error(`Line ${o.line} has no singer: choose a picture or video in Lip sync first.`);
  if (l.run.first !== n) throw new Error(`Line ${n} is sung with line ${l.run.first}: retake lines ${l.run.first}-${l.run.last} there.`);
  mvNeedsPicture(l);
  if (!view.ready) singTransportFor(env); // throws the plain-words message
  const cap = Number(o.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  const usd = o.draft ? draftUsd(l.piece.seconds) : l.piece.usd;
  if (usd > cap) throw new Error(`A retake (${l.piece.seconds} s of voice) costs about $${usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: raise the cap in Creation → Your defaults. Nothing was sent.`);
  const { dir } = songFolder(ws, projectId);
  return { jobs: [recordTake(dir, l.engine === "mv" ? l : await withRests(ws, projectId, l, view.usdPerSecond), l.resolution ?? view.resolution, new Date().toISOString(), filmLookFor(ws, projectId), feelFor(ws, projectId), feelingForLines(ws, projectId, l.number, l.run.last), { draft: !!o.draft, direction: await directionOf(ws, projectId, l), aspect: view.aspect })], usd, seconds: l.piece.seconds };
}

// The finished take's clip in the Storyboard (added once; a later take waits outside it until it is chosen).
async function takeIntoStoryboard(ws: Workspace, projectId: string, dir: string, source: string, t: Take): Promise<string> {
  const known = t.sent ?? t.clip;
  const clips = songPathsById(ws, projectId).clips;
  if (known && clips && existsSync(path.join(clips, known))) return known;
  if (!t.file) throw new Error("This take has no video yet.");
  const file = path.join(dir, t.file);
  const r = await importSongClips(ws, projectId, [{ file, name: path.basename(file) }]);
  const clip = r.added[0] ?? r.duplicates[0]?.sameAs;
  if (!clip) throw Object.assign(new Error(r.skipped[0]?.reason ?? "it could not be added to the Storyboard"), { made: true });
  const label = itemLabel(readPictures(dir).pictures[source], t.n);
  if (label && r.added.length) setClipLabel(songPathsById(ws, projectId).root, clip, label);
  setTake(dir, source, t.n, { sent: clip });
  return clip;
}

// The take on its lines, locked to the song (any other anchor on those lines gives way and, if singing, is set to Omit).
function placeTake(ws: Workspace, projectId: string, t: Take, clip: string): void {
  const paths = songPathsById(ws, projectId);
  const recipe = readRecipe(paths.recipe!);
  const last = t.through ?? t.line!;
  const others = (recipe.anchors ?? []).filter((a) => a.line < t.line! || a.line > last);
  try {
    setClipOmit(paths.root, clip, false); // a take chosen again comes back out of Omit
  } catch {
    // not a song clip (the anchor still names it)
  }
  saveAnchors(ws, projectId, [...others, { line: t.line!, clip, sync: (t.sync_ms! + (t.nudge_ms ?? 0)) / 1000, ...(t.through ? { through: t.through } : {}) }]);
}

// "Use this take": the line switches to this take at once (nothing is made or rendered again). The other takes of the
// group stay in Creation; the one it replaces is set to Omit in the Storyboard (out of its line its lips are out of time).
export async function chooseSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown): Promise<{ clip: string; line: number; through: number }> {
  const { dir } = songFolder(ws, projectId);
  const file = path.basename(String(source ?? ""));
  const t = readPictures(dir).pictures[file]?.takes.find((x) => x.n === Number(n));
  if (!t || t.kind !== "lipsync" || !t.line || t.sync_ms === undefined) throw new Error("No such singing take.");
  if (t.status !== "done" || !t.file) throw new Error("This take is not ready yet.");
  const clip = await takeIntoStoryboard(ws, projectId, dir, file, t);
  placeTake(ws, projectId, t, clip);
  // Chosen: the group's "New — compare" marks go (Paul has compared).
  update(dir, file, (p) => {
    for (const x of p.takes) if (x.kind === "lipsync" && x.line === t.line && (x.through ?? x.line) === (t.through ?? t.line)) delete x.fresh;
  });
  return { clip, line: t.line, through: t.through ?? t.line };
}

// A "New — compare" take was watched: the mark goes.
export function seenSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown): void {
  const { dir } = songFolder(ws, projectId);
  const file = path.basename(String(source ?? ""));
  if (readPictures(dir).pictures[file]?.takes.some((x) => x.n === Number(n) && x.fresh)) setTake(dir, file, Number(n), { fresh: undefined });
}


// A take in parts (singingParts): every part from the picture itself, the same upload as part 1 (26 Nov 2026, Paul: a
// part chained from the last frame of the one before turned Aiko's face into a white mask), each with its own piece of the voice; each part cut to its exact
// song length (a frame short or long would put the next part's lips out of time), then joined into one silent take.
// A part already sent (its request id kept in the take) is only fetched again (free).
async function singInParts(c: { dir: string; source: string; n: number; take: Take; tmp: string; voice: Voice; songFile: string; transport: SingTransport; picture: Promise<string>; sleep: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; onSent: (id: string) => void }, out: string): Promise<void> {
  const parts = c.take.parts!;
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = readPictures(c.dir).pictures[c.source]?.takes.find((x) => x.n === c.n)?.parts?.[i] ?? parts[i];
    let rid = part.request_id;
    if (!rid) {
      const voiceFile = path.join(c.tmp, `voice-${i + 1}.wav`);
      cutVoice(c.voice, c.songFile, part, voiceFile, c.take.rests);
      let image: string;
      let audio: string;
      try {
        image = await c.picture;
        audio = await c.transport.upload(voiceFile);
      } catch (error) {
        throw Object.assign(new Error(`Part ${i + 1}: the picture or the voice could not be put online: ${errorText(error)}`), { unsent: i === 0 });
      }
      const t = c.take;
      rid = (await c.transport.submit({ image, audio, prompt: t.style === SINGING_STYLE ? singingPrompt(promptOf(t), t.look, t.feel, t.feeling, t.feelingTo, !!t.rests) : (t.prompt ?? "") || undefined, resolution: isLipsyncResolution(t.resolution) ? t.resolution : LIPSYNC_RESOLUTION })).id; // never retried
      const sent = rid;
      update(c.dir, c.source, (p) => {
        const tk = p.takes.find((x) => x.n === c.n);
        if (!tk?.parts?.[i]) return;
        tk.parts[i].request_id = sent;
        tk.request_id ??= sent;
      });
      c.onSent(rid);
    }
    const t0 = Date.now();
    let url: string;
    for (;;) {
      const st = await c.transport.poll(rid);
      if (st.status === "done") {
        url = st.url;
        break;
      }
      if (st.status === "failed") throw new Error(`WaveSpeed, part ${i + 1}: ${st.error}`);
      if (Date.now() - t0 > (c.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error(`part ${i + 1}: no answer within an hour: get its result later (free)`);
      await c.sleep(c.pollMs ?? POLL_MS);
    }
    const raw = path.join(c.tmp, `part-${i + 1}-raw.mp4`);
    await c.transport.download(url, raw);
    makePlayable(raw, false); // the voice removed
    const fitted = path.join(c.tmp, `part-${i + 1}.mp4`);
    fitLength(raw, fitted, part.toMs - part.fromMs);
    files.push(fitted);
  }
  joinParts(files, out, path.join(c.tmp, "parts.txt"));
}

// A part at exactly its song length, 30 fps (its last frame held if the model's clip is a little short).
export function fitLength(file: string, out: string, ms: number): void {
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-vf", "tpad=stop_mode=clone:stop_duration=3,fps=30,format=yuv420p", "-t", (ms / 1000).toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out]);
}
// The parts one after another, as one file (they are encoded alike, so nothing is encoded again).
export function joinParts(files: string[], out: string, list: string): void {
  writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
}

// How much of an MV Generator take's handles is kept: the breath in and the release of the note (the V2 → V1 change, tracks.ts).
export const keptHandles = (h: { inMs: number; outMs: number }) => ({ inMs: Math.min(h.inMs, V2_V1_CHANGE.mvHandleInMs), outMs: Math.min(h.outMs, V2_V1_CHANGE.mvHandleOutMs) });

// The returned MV Generator video without its handles: from inMs, at most the take's song length (never stretched:
// a short video stays short), silent, 30 fps, browser-ready.
export function trimHandles(file: string, out: string, inMs: number, lengthMs: number): void {
  execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (inMs / 1000).toFixed(3), "-i", file, "-t", (lengthMs / 1000).toFixed(3), "-an", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", out]);
}

// The cuts inside a take, found on the video as the model returned it (before any frame-rate change: the 30 fps copy
// repeats frames and its regular rhythm made ordinary motion look like cuts), with an absolute minimum change
// (detectTakeCuts). Take ms: the raw video's time minus where the take starts in it; the ones in the trimmed-off handles
// are dropped. The first frame always scores as a change (nothing before it), so the edges are left out.
export const CUT_EDGE_MS = 200;
export async function cutsInTake(raw: string, fromMs: number, lengthMs: number): Promise<number[]> {
  const { sceneScores } = await import("./music-video"); // lazily: music-video.ts reads this file
  return detectTakeCuts(sceneScores(raw))
    .map((c) => c - fromMs)
    .filter((c) => c >= CUT_EDGE_MS && c <= lengthMs - CUT_EDGE_MS);
}

// One take of the MV Generator: the voice of Lips follow for the take's song range plus its handles (as it is, no
// silencing), one picture, the rules + lip prompt + scene, the video's shape and the resolution; sent once (a take
// already sent is only fetched again, free). It comes back silent and trimmed to the song range; its length and any
// cut inside it are said on the take.
async function singWithMv(c: { dir: string; source: string; n: number; take: Take; tmp: string; voice: Voice; songFile: string; transport: SingTransport; uploads: Map<string, Promise<string>>; sleep: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; onSent: (id: string) => void; sentId?: string }, out: string): Promise<void> {
  const t = c.take;
  if (!PICTURE_FILE.test(c.source)) throw Object.assign(new Error("The MV Generator needs a picture of the singer, not a video"), { unsent: true });
  const h = t.handles ?? { inMs: 0, outMs: 0 };
  // The song range of the group (a take already finished with kept handles starts earlier: its range is without them).
  const range = { fromMs: t.sync_ms! + (t.kept?.inMs ?? 0), toMs: t.to_ms! - (t.kept?.outMs ?? 0) };
  const sent = { fromMs: range.fromMs - h.inMs, toMs: range.toMs + h.outMs };
  let id = c.sentId;
  if (!id) {
    if (!c.uploads.has(c.source)) c.uploads.set(c.source, c.transport.upload(path.join(c.dir, c.source)));
    const voiceFile = path.join(c.tmp, "voice.wav");
    cutVoice(c.voice, c.songFile, sent, voiceFile);
    let image: string;
    let audio: string;
    try {
      [image, audio] = await Promise.all([c.uploads.get(c.source)!, c.transport.upload(voiceFile)]);
    } catch (error) {
      throw Object.assign(new Error(`The picture or the voice could not be put online: ${errorText(error)}`), { unsent: true });
    }
    const lip = singingPrompt(promptOf(t), t.look, t.feel, t.feeling, t.feelingTo, false);
    id = (await c.transport.submit({ image, audio, prompt: mvSingPrompt(lip, t.scene), resolution: isSingResolution(t.resolution) ? t.resolution : LIPSYNC_RESOLUTION, mv: { aspect: t.aspect ?? "9:16" } })).id; // never retried
    setTake(c.dir, c.source, c.n, { request_id: id });
    c.onSent(id);
  }
  const t0 = Date.now();
  let url: string;
  for (;;) {
    const s = await c.transport.poll(id);
    if (s.status === "done") {
      url = s.url;
      break;
    }
    if (s.status === "failed") throw new Error(`WaveSpeed MV Generator: ${s.error}`);
    if (Date.now() - t0 > (c.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error("no answer within an hour: get its result later (free)");
    await c.sleep(c.pollMs ?? POLL_MS);
  }
  const raw = path.join(c.tmp, "mv-raw.mp4");
  await c.transport.download(url, raw);
  makePlayable(raw, false); // its sound removed: the video always plays with the song
  const returnedMs = (await probeMedia(raw)).durationMs;
  // Not all of the handles are cut off (V2 → V1 change, 28 Nov 2026): the take keeps the singer's breath in (0.4 s of the
  // handle before the song range) and the release of the note (0.3 s after it), at song time, never stretched; the take then
  // starts at sync_ms - kept.inMs, which is written on the take (existing takes stay as they are).
  const kept = keptHandles(h);
  const takeMs = range.toMs - range.fromMs + kept.inMs + kept.outMs;
  trimHandles(raw, out, h.inMs - kept.inMs, takeMs);
  const warnings = mvTakeWarnings(returnedMs, sent.toMs - sent.fromMs, await cutsInTake(raw, h.inMs - kept.inMs, takeMs).catch(() => []));
  setTake(c.dir, c.source, c.n, { warnings: warnings.length ? warnings : undefined, sync_ms: range.fromMs - kept.inMs, to_ms: range.toMs + kept.outMs, kept });
}

// Makes the singing clips (in parallel). Each: the picture or video and its piece of voice go online, the request is
// sent once, polled, downloaded; the sound is removed; the clip goes to Creation, the Storyboard and onto its line.
// `resume`: takes that already have a request id are only polled and fetched (free).
// The mood text and the acting direction, as InfiniteTalk's prompt after the singing cue.
const promptOf = (t: Take) => [t.prompt?.trim().replace(/\.$/, ""), t.direction?.trim().replace(/\.$/, "")].filter(Boolean).join(". ");
// The audio that drives the lips: the whole song when the group chose it; the de-reverbed copy of the stem (same
// timing, same offset) when chosen and made; else the song's voice (the stem when it fits).
const voiceOfTake = (t: Take, songVoice: Voice, dry: Partial<Record<DryKind, string>> = {}): Voice => {
  if (t.voice === "song") return { kind: "song" };
  const kind = dryKindOf(t.voice);
  const file = kind ? dry[kind] : undefined;
  return file && songVoice.kind === "stem" ? { ...songVoice, file } : songVoice;
};
// The copy a Lips follow choice needs ("dereverb": the dry vocal; "lead": the lead vocal only, dry).
const dryKindOf = (v: string | undefined): DryKind | null => (v === "dereverb" ? "dry" : v === "lead" ? "lead" : null);

// The dry vocal's state for the Singer bar.
async function dryVocalView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv): Promise<SingerView["dryVocal"]> {
  const voice = await voiceFor(ws, projectId);
  const installed = dryVocalInstalled(env);
  if (voice.kind !== "stem") return { stem: false, installed, dry: "none", lead: "none" };
  const root = path.dirname(songFolder(ws, projectId).dir);
  return { stem: true, installed, dry: dryVocalState(root, voice.file, "dry"), lead: dryVocalState(root, voice.file, "lead") };
}

// "Prepare dry vocal" (Lyrics Sync → Singer, 28 Nov 2026): the dry vocal (and the lead only, when asked) of this song's
// stem made now, on this PC, so the next takes can use them at once. Starts them and returns; each is kept per stem.
export async function prepareDryVocal(ws: Workspace, projectId: string, o: { lead?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): Promise<{ started: DryKind[] }> {
  const voice = await voiceFor(ws, projectId);
  if (voice.kind !== "stem") throw new Error("The dry vocal is made from your vocal stem: add it in Prepare → Assets first.");
  if (!dryVocalInstalled(env)) throw new Error("The de-reverb is not installed yet: run  pnpm audio:setup --dereverb  once, then try again.");
  const root = path.dirname(songFolder(ws, projectId).dir);
  const kinds: DryKind[] = o.lead ? ["dry", "lead"] : ["dry"];
  const started = kinds.filter((k) => dryVocalState(root, voice.file, k) === "none");
  // One after the other (each uses the whole GPU); a failure shows on the next take that needs it.
  void (async () => {
    for (const k of started) await ensureDereverbed(root, voice.file, env, k).catch(() => undefined);
  })();
  return { started };
}

// ---- The lip-sync review (26 Nov 2026) ----

function takeOf(dir: string, source: unknown, n: unknown): { file: string; t: Take } {
  const file = path.basename(String(source ?? ""));
  const t = readPictures(dir).pictures[file]?.takes.find((x) => x.n === Number(n));
  if (!t || t.kind !== "lipsync" || !t.line) throw new Error("No such singing take.");
  return { file, t };
}

// Paul's verdict on a take: approved, or to redo with the reasons (null clears it).
export function setSingingReview(ws: Workspace, projectId: string, source: unknown, n: unknown, verdict: unknown, reasons: unknown, note: unknown): Take["review"] | null {
  const { dir } = songFolder(ws, projectId);
  const { file, t } = takeOf(dir, source, n);
  if (verdict === null || verdict === "" || verdict === undefined) {
    setTake(dir, file, t.n, { review: undefined });
    return null;
  }
  if (verdict !== "approved" && verdict !== "redo") throw new Error('A verdict is "approved" or "redo".');
  const list = Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string" && !!r.trim()).map((r) => r.trim().slice(0, 60)).slice(0, 8) : [];
  const text = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const review = { verdict, reasons: verdict === "redo" ? list : [], ...(text ? { note: text } : {}), at: new Date().toISOString() } as NonNullable<Take["review"]>;
  setTake(dir, file, t.n, { review });
  return review;
}

// Lips late or early: the take sits this much later (+) or earlier (-) on the song. Free: nothing is made again; a take
// in use moves on its lines at once (its anchor's sync), a take chosen later is placed with it.
export function nudgeSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown, deltaMs: unknown): number {
  const { dir } = songFolder(ws, projectId);
  const { file, t } = takeOf(dir, source, n);
  const d = Math.round(Number(deltaMs));
  if (!Number.isFinite(d) || d === 0) throw new Error("Nudge by a number of milliseconds (e.g. 100 or -100).");
  const next = Math.max(-NUDGE_MAX_MS, Math.min(NUDGE_MAX_MS, (t.nudge_ms ?? 0) + d));
  setTake(dir, file, t.n, { nudge_ms: next || undefined });
  if (t.status === "done" && singingAnchorKeys(ws, projectId).has(inUseKey(t.clip && !t.sent ? { ...t, sent: t.clip } : t))) {
    const paths = songPathsById(ws, projectId);
    const recipe = readRecipe(paths.recipe!);
    const clip = (t.sent ?? t.clip)!.toLowerCase();
    saveAnchors(ws, projectId, (recipe.anchors ?? []).map((a) => (a.line === t.line && a.clip.toLowerCase() === clip ? { ...a, sync: (t.sync_ms! + next) / 1000 } : a)));
  }
  return next;
}

// The audio that drives the lips of a group from its next take on: the vocal stem (default) or the whole song.
export function setSingerVoice(ws: Workspace, projectId: string, line: unknown, voice: unknown): SingerSettings {
  if (voice !== "stem" && voice !== "song" && voice !== "dereverb" && voice !== "lead") throw new Error('Choose "stem", "song", "dereverb" or "lead".');
  const { dir } = songFolder(ws, projectId);
  const s = readSinger(dir);
  const voices = { ...(s.voices ?? {}) };
  if (voice === "stem") delete voices[String(Number(line))];
  else voices[String(Number(line))] = voice;
  const next = { ...s, voices };
  writeSinger(dir, next);
  return next;
}

// A finished take (its file there, its status not yet "done": a final being filed) into the Storyboard and onto its
// lines, as Use this take does; the group's "New — compare" marks go.
export async function placeSingingTake(ws: Workspace, projectId: string, source: string, n: number): Promise<void> {
  const { dir } = songFolder(ws, projectId);
  const t = readPictures(dir).pictures[source]?.takes.find((x) => x.n === n);
  if (!t?.file || t.kind !== "lipsync" || !t.line || t.sync_ms === undefined) throw new Error("No such singing take.");
  const clip = await takeIntoStoryboard(ws, projectId, dir, source, t);
  placeTake(ws, projectId, t, clip);
  update(dir, source, (p) => {
    for (const x of p.takes) if (x.kind === "lipsync" && x.line === t.line && (x.through ?? x.line) === (t.through ?? t.line)) delete x.fresh;
  });
}

// "Trim to good part" (Takes QA): a new take of the good stretch; it takes the place of the take on its lines when that
// one is in use (else it waits, like any take, for Use this take).
export async function trimSingingTake(ws: Workspace, projectId: string, source: unknown, n: unknown): Promise<Take> {
  const c = await context(ws, projectId);
  const file = path.basename(String(source ?? ""));
  const { trimTake } = await import("./take-qa");
  const t = readPictures(c.dir).pictures[file]?.takes.find((x) => x.n === Number(n));
  const made = trimTake(c.dir, file, Number(n), (c.lines ?? []).map((l) => ({ number: l.number, sungEndMs: l.sungEndMs })));
  if (t && singingTakeInUse(ws, projectId, t)) await placeSingingTake(ws, projectId, file, made.n);
  else setTake(c.dir, file, made.n, { fresh: true });
  return made;
}

// Is this singing take on its lines now (its clip is the singing anchor there)?
export function singingTakeInUse(ws: Workspace, projectId: string, t: Take): boolean {
  return t.kind === "lipsync" && t.status === "done" && singingAnchorKeys(ws, projectId).has(inUseKey(t.clip && !t.sent ? { ...t, sent: t.clip } : t));
}

export async function runSinging(openWs: () => Workspace, projectId: string, jobsIn: SingJob[], o: { env?: NodeJS.ProcessEnv; transport?: SingTransport; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; face?: import("./characters/face").FaceTool } = {}): Promise<void> {
  let jobs = jobsIn;
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? sleepMs;
  let dir: string;
  let songFile: string;
  let voice: Voice;
  {
    const ws = openWs();
    try {
      dir = songFolder(ws, projectId).dir;
      const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()!;
      songFile = absPath(ws, p.audio_path!);
      voice = await voiceFor(ws, projectId, p);
    } finally {
      ws.close();
    }
  }
  let transport: SingTransport;
  try {
    transport = o.transport ?? singTransportFor(env);
  } catch (error) {
    for (const j of jobs) setTake(dir, j.source, j.n, { status: "failed", error: errorText(error), ended_at: new Date().toISOString(), pid: undefined });
    return;
  }
  // The dry vocal / the lead only, made once before any take that asks for it (the stem is only read). Without a stem,
  // or when it cannot be made, those takes fail in plain words and nothing is spent.
  const dry: Partial<Record<DryKind, string>> = {};
  for (const kind of ["dry", "lead"] as const) {
    const wants = jobs.filter((j) => dryKindOf(readPictures(dir).pictures[j.source]?.takes.find((x) => x.n === j.n)?.voice) === kind);
    if (!wants.length) continue;
    let why: string | null = null;
    if (voice.kind !== "stem") why = `${kind === "lead" ? "Lead only" : "The dry vocal"} needs your vocal stem (add it in Assets), or choose Lips follow: the vocal stem or the whole song`;
    else {
      try {
        dry[kind] = await ensureDereverbed(path.dirname(dir), voice.file, env, kind);
      } catch (error) {
        why = errorText(error);
      }
    }
    if (why) {
      for (const j of wants) setTake(dir, j.source, j.n, { status: "failed", error: `${why}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      jobs = jobs.filter((j) => !wants.includes(j));
    }
  }
  const uploads = new Map<string, Promise<string>>(); // one upload per picture or video
  await Promise.all(
    jobs.map(async (j) => {
      const t = readPictures(dir).pictures[j.source]?.takes.find((x) => x.n === j.n);
      if (!t || t.sync_ms === undefined || t.to_ms === undefined || !t.line) return;
      let id = t.request_id;
      const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-sing-"));
      try {
        setTake(dir, j.source, j.n, { status: "running", pid: process.pid, error: undefined });
        const got = path.join(tmp, "sings.mp4");
        if (t.parts && t.parts.length > 1 && !BOARD_VIDEO_FILE.test(j.source)) {
          // In parts (a long piece): each from the last frame of the one before, joined into one take.
          if (!uploads.has(j.source)) uploads.set(j.source, transport.upload(path.join(dir, j.source)));
          await singInParts({ dir, source: j.source, n: j.n, take: t, tmp, voice: voiceOfTake(t, voice, dry), songFile, transport, picture: uploads.get(j.source)!, sleep, pollMs: o.pollMs, timeoutMs: o.timeoutMs, onSent: (rid) => (id ??= rid) }, got);
        } else if (t.engine === "mv") {
          await singWithMv({ dir, source: j.source, n: j.n, take: t, tmp, voice: voiceOfTake(t, voice, dry), songFile, transport, uploads, sleep, pollMs: o.pollMs, timeoutMs: o.timeoutMs, onSent: (rid) => (id = rid), sentId: id }, got);
        } else {
          if (!id) {
            const src = path.join(dir, j.source);
            if (!uploads.has(j.source)) uploads.set(j.source, transport.upload(src));
            const voiceFile = path.join(tmp, "voice.wav");
            cutVoice(voiceOfTake(t, voice, dry), songFile, { fromMs: t.sync_ms, toMs: t.to_ms }, voiceFile, t.rests);
            let media: string;
            let audio: string;
            try {
              [media, audio] = await Promise.all([uploads.get(j.source)!, transport.upload(voiceFile)]);
            } catch (error) {
              throw Object.assign(new Error(`The picture or the voice could not be put online: ${errorText(error)}`), { unsent: true });
            }
            const sent = await transport.submit({ ...(BOARD_VIDEO_FILE.test(j.source) ? { video: media } : { image: media }), audio, prompt: t.style === SINGING_STYLE ? singingPrompt(promptOf(t), t.look, t.feel, t.feeling, t.feelingTo, !!t.rests) : (t.prompt ?? "") || undefined, resolution: isLipsyncResolution(t.resolution) ? t.resolution : LIPSYNC_RESOLUTION }); // never retried
            id = sent.id;
            setTake(dir, j.source, j.n, { request_id: id });
          }
          const t0 = Date.now();
          let url: string;
          for (;;) {
            const s = await transport.poll(id);
            if (s.status === "done") {
              url = s.url;
              break;
            }
            if (s.status === "failed") throw new Error(`WaveSpeed: ${s.error}`);
            if (Date.now() - t0 > (o.timeoutMs ?? TIMEOUT_MS * 3)) throw new Error("no answer within an hour: get its result later (free)");
            await sleep(o.pollMs ?? POLL_MS);
          }
          await transport.download(url, got);
          // The model's copy carries the vocal: only the picture is kept (the vocal never goes into any file of ours).
          makePlayable(got, false); // the voice removed; browser-ready H.264
        }
        const silent = got;
        const takesDir = path.join(dir, TAKES_DIR);
        mkdirSync(takesDir, { recursive: true });
        const name = uniqueFileName(takesDir, `${path.parse(j.source).name} sings ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}.mp4`);
        copyFileSync(silent, path.join(takesDir, name));
        setTake(dir, j.source, j.n, { file: `${TAKES_DIR}/${name}`, playable: true });
        const ws = openWs();
        try {
          // The group's first take goes into the Storyboard and onto its lines by itself only when NOTHING sings on those
          // lines yet (Paul, 28 Nov 2026: the user's picks are never replaced by the app).
          // Any singing anchor over the lines, from any clip (a take of this group, another picture's take, a music-video
          // shot), is Paul's pick: the new take never replaces it, it waits in Creation as "New — compare" until Paul
          // chooses it (Use this take).
          const taken = singingAnchorOver(ws, projectId, t.line!, t.through ?? t.line!);
          if (taken) {
            setTake(dir, j.source, j.n, { status: "done", fresh: true, ended_at: new Date().toISOString(), pid: undefined });
          } else {
            const done = readPictures(dir).pictures[j.source]!.takes.find((x) => x.n === j.n)!;
            const clip = await takeIntoStoryboard(ws, projectId, dir, j.source, done);
            placeTake(ws, projectId, done, clip);
            setTake(dir, j.source, j.n, { status: "done", ended_at: new Date().toISOString(), pid: undefined });
          }
        } finally {
          ws.close();
        }
        // Takes QA: the face checked frame by frame (local, free); a check that cannot run says why on the take.
        try {
          const { checkTake } = await import("./take-qa");
          const { cardFace } = await import("./characters/jobs");
          await checkTake(dir, j.source, j.n, o.face ?? cardFace(env));
        } catch {
          // the take is there either way
        }
      } catch (error) {
        if ((error as { made?: boolean }).made) {
          setTake(dir, j.source, j.n, { status: "done", error: `Made, but not placed: ${errorText(error)}. Send it to the Storyboard from Creation.`, ended_at: new Date().toISOString(), pid: undefined });
          return;
        }
        const unsent = !id || (error as { unsent?: boolean }).unsent;
        setTake(dir, j.source, j.n, { status: unsent ? "failed" : "interrupted", error: unsent ? `${errorText(error)}. Nothing was spent.` : `${errorText(error)} (sent: get its result later, free)`, ended_at: new Date().toISOString(), pid: undefined });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),
  );
}
