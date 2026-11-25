// Prepare → Creation (G2, 21 Nov 2026; first called Pictures, decided with Paul: "pictures, then clips, then play with the order"). Paul makes
// clips from Midjourney pictures at random and finds the video by arranging them against the song; there is no story or
// shot list in this path. So:
//   - a picture board per song: <song folder>\pictures\ (his pictures under their own names);
//   - "Animate" on a picture sends it as image-to-video to WaveSpeed or Higgsfield (Seedance 2.5) with HIS key from
//     .env; the app chooses the length, size (the picture's own shape), resolution, a gentle-motion prompt and no sound;
//     Paul may add a few words of mood. Several takes at once (3 by default), so surprises happen;
//   - the cost is shown before anything is sent, and a press is refused above its cap;
//   - Pictures is a messy creation space, kept apart from the Storyboard (Paul, 21 Nov 2026): every take stays on the
//     board (pictures\takes\<picture> take N.mp4). Paul picks his favourites, takes or the pictures themselves, and
//     sends each with "Send to Storyboard": a copy joins the END of the song's clips (his order rule), marked as sent.
//   - Creation takes everything Paul makes, from anywhere (Paul, 21 Nov 2026: "I need flexibility"): pictures and
//     videos he adds by hand (Midjourney videos too, under their own names), takes made here through the APIs, and files
//     from a link (any outside source). They all sit together; each shows where it came from as a small label. Only a
//     picture can be animated; anything can be sent to the Storyboard.
// State: pictures\pictures.json (each picture's mood, what was sent, and its takes: service, request id, status, cost,
// the take's file, the clip it was sent as).
// A take whose studio stopped mid-way is "interrupted"; with a request id its result can still be fetched (free).
// The picture is never changed. Requests are never retried on submit (a retry could be billed twice).
// No rendering code is imported here, so the studio's server can use it.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { beat as beatTable, ffmpegBin, ffprobeBin, probeMedia, uniqueFileName, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { importSongClips, moveSongClipToEnd, REMOVED_DIR, restoreClipTo, restoreSongClip } from "./assets";
import { cleanLabel, isLineOnly, isOmitted, readClipEdits, setClipLabel, setClipLineOnly } from "./clip-edits";
import { download, errorText } from "./characters/fal";
import { processAlive } from "./jobs";
import { feelFor, filmLookFor } from "./film-looks";
import { realismRules, type Feel } from "./realism";
import { cleanFeeling, feelingWords } from "../feelings";
import { feelingForSlot } from "./section-feelings";
import { readRecipe } from "./recipe";
import { songPathsById } from "./song-folder";

export const PICTURES_DIR = "pictures";
export const PICTURES_FILE = "pictures.json";
export const TAKES_DIR = "takes";
export const PICTURE_FILE = /\.(jpe?g|png|webp)$/i;
export const BOARD_VIDEO_FILE = /\.(mp4|m4v|mov|webm)$/i;
export const BOARD_FILE = /\.(jpe?g|png|webp|mp4|m4v|mov|webm)$/i;
const MAX_LINK_BYTES = 1024 * 1024 * 1024; // a file from a link: at most 1 GB
export const TAKE_SECONDS = 5; // "Short" takes, and a song without beats yet; the services' minimum is 4
export const MIN_TAKE_SECONDS = 4; // Seedance 2.5 (Flash): any whole number of seconds from 4 to 30
export const MAX_TAKE_SECONDS = 30;
export const PHRASE_BARS = 4; // "Fit the song": a take as long as one musical phrase of this song (4 bars)
export type TakeLength = "song" | "short";
export const RESOLUTION = "720p";
export const DEFAULT_TAKES = 3;
export const MAX_TAKES = 6;
export const DEFAULT_CAP_USD = 10;
export const POLL_MS = 4000;
export const TIMEOUT_MS = 20 * 60 * 1000;
const UPLOAD_KEEP_MS = 5 * 24 * 3600 * 1000; // WaveSpeed keeps uploads 7 days: reused for 5

export type ServiceId = "wavespeed" | "higgsfield";
export type Quality = "draft" | "standard" | "best";
type Model = { label: string; path: string; usdPerSecond: number; priceNote: string; resolution?: string }; // resolution: asked of the service (else RESOLUTION)
export type Service = { id: ServiceId; label: string; keyName: string; models: Partial<Record<Quality, Model>> };

// Prices per second at 720p, without sound (WaveSpeed's model pages, 21 Nov 2026). Higgsfield's docs do not list
// Seedance 2.5's price: WaveSpeed's is used and marked as an estimate (see console.higgsfield.ai for the real one).
export const SERVICES: Record<ServiceId, Service> = {
  wavespeed: {
    id: "wavespeed",
    label: "WaveSpeed",
    keyName: "WAVESPEED_API_KEY",
    models: {
      // Draft (25 Nov 2026, Paul's draft test): a cheap 480p preview; "Make final" upscales the take Paul keeps (final.ts).
      draft: { label: "Draft (cheap preview)", path: "bytedance/seedance-2.5-flash/image-to-video", usdPerSecond: 0.108, priceNote: "WaveSpeed price list, 25 Nov 2026 (480p)", resolution: "480p" },
      standard: { label: "Seedance 2.5 Flash", path: "bytedance/seedance-2.5-flash/image-to-video", usdPerSecond: 0.216, priceNote: "WaveSpeed price list, 21 Nov 2026" },
      best: { label: "Seedance 2.5", path: "bytedance/seedance-2.5/image-to-video", usdPerSecond: 0.324, priceNote: "WaveSpeed price list, 21 Nov 2026" },
    },
  },
  higgsfield: {
    id: "higgsfield",
    label: "Higgsfield",
    keyName: "HIGGSFIELD_API_KEY",
    models: {
      best: { label: "Seedance 2.5", path: "bytedance/seedance-2.5/image-to-video", usdPerSecond: 0.324, priceNote: "estimate: Higgsfield does not publish this price in its docs" },
    },
  },
};

// Make with references (24 Nov 2026, Paul: "I need to provide to the video platform my character sheets in order to
// create the video with constant characters"): Seedance 2.5 reference-to-video on WaveSpeed takes the people's and the
// place's pictures (up to 30), named in the prompt as @Image 1, @Image 2 …, and makes the shot with them. Its request:
// { prompt, reference_images: [urls], aspect_ratio, resolution, duration (4-30 s), generate_audio } (WaveSpeed's v3 API,
// as public integrations call it; the exact price of this route is not published where we could read it: the 720p
// image-to-video price is used as the estimate).
export const REFERENCE_MODEL = { label: "Seedance 2.5 · with references", path: "bytedance/seedance-2.5/reference-to-video", usdPerSecond: 0.324, priceNote: "estimate: WaveSpeed's Seedance 2.5 720p price (21 Nov 2026); the reference route may differ" } as const;
export const MAX_REFERENCES = 30;

export type TakeStatus = "running" | "done" | "failed" | "interrupted";
export type Take = {
  n: number;
  service: ServiceId;
  quality: Quality;
  model: string;
  status: TakeStatus;
  started_at: string;
  ended_at?: string;
  request_id?: string;
  poll_url?: string;
  cost_usd: number; // the estimate (the services bill what they bill)
  file?: string; // the finished video, in pictures\ ("takes/<picture> take N.mp4")
  sent?: string; // "Send to Storyboard": the clip it became in the song's clips folder
  kind?: "lipsync" | "references"; // references: made by reference-to-video from refFiles (Make with references); lipsync: a singing clip (Lyrics Sync → Singer): made from this picture or video and the vocal of one line
  line?: number; // lipsync: the lyric line (Lyrics tab number); with `through`: the first line of the run
  through?: number; // lipsync: the last line of a run of lines in a row sung from the same picture (one continuous take)
  sync_ms?: number; // lipsync: the song time of the take's first frame (the vocal piece started there)
  to_ms?: number; // lipsync: the song time where the vocal piece ended
  clip?: string; // (21 Nov 2026 first build: takes went to the clips by themselves; read as `sent`)
  error?: string;
  pid?: number;
  seconds?: number; // how long the take was asked to be (4 to 30 s; before 21 Nov 2026: 5)
  style?: number; // lipsync: 1 = sent with the singing cue (singer.ts SINGING_CUE)
  prompt?: string; // lipsync: the singer's little script sent with the voice (what the singer does)
  label?: string; // the user's short name for this take ("Bride smile"); shown instead of "Take N"
  cleared?: boolean; // hidden from the Tasks menu (Clear finished); the take itself stays
  playable?: boolean; // the file was checked (and if needed re-made) to play in the browser: H.264, yuv420p, fast start
  resolution?: string; // lipsync: the resolution asked of InfiniteTalk ("480p" | "720p"; before 21 Nov 2026 always 720p)
  parts?: { fromMs: number; toMs: number; request_id?: string }[]; // lipsync: made in parts (singer.ts singingParts), each its own request, joined
  filmLook?: string; // the song's Film look when the take was sent (film-looks.ts), its name
  look?: string; // and its line, as sent: a later change of the look remakes nothing
  finalOf?: number; // Make final (final.ts): this take is the upscaled final of draft take finalOf
  final?: number; // a Draft take: the number of its final
  feel?: Feel; // the realism rules it was sent with (realism.ts); absent on takes made before 25 Nov 2026 (old prompt)
  feeling?: string; // the feeling of its section when it was sent (feelings.ts): a later change remakes nothing
  rests?: { fromMs: number; toMs: number }[]; // lipsync: breathing room (singer.ts singingRests): where the voice sent was quieted, song ms
  feelingTo?: string; // and the one it turns to, when the take runs into a section that feels different
  fresh?: boolean; // lipsync: a later take of lines that already had a take in use: waits for Paul ("New — compare"), never placed by itself
  refFiles?: string[]; // references: the pictures sent, workspace-relative, in @Image order
  refNames?: string[]; // references: who / what each one is ("Jennifer · Wedding Dress", "Chapel")
  aspect?: "9:16" | "16:9"; // references: the shape asked for
  guideFile?: string; // references: the camera guide video sent as @Video 1 (workspace-relative), e.g. a Midjourney take
  guideName?: string; // and its name as shown on the shot
};
// removedTakes: takes put aside by Clean up / Remove (their files in pictures\takes\_removed\), with Restore; nothing is
// ever deleted. Every screen reads `takes` only, so they are out of sight; take numbers keep counting past them.
export type RemovedTake = Take & { removed_at: string };
// removed: the picture put aside (Creation ✕ → Put aside, 23 Nov 2026), its file moved to pictures\_removed\ (file:
// that path); the record stays, so Restore brings it back with its takes, mood and shot. Nothing is ever deleted.
export type PictureRecord = { removed?: { at: string; file: string }; slot?: string; label?: string; source?: string; mood?: string; feeling?: string; who?: string; takes: Take[]; removedTakes?: RemovedTake[]; upload?: { service: ServiceId; url: string; at: string }; sent?: string }; // sent: the picture itself sent to the Storyboard (its clip name)
export type PicturesFile = { _help?: string; pictures: Record<string, PictureRecord> };
// source: where it came from, a small label ("Added by you", "Midjourney", "From higgsfield.ai"). kind: only a picture can be animated.
// cleanable: the takes Clean up would put aside (failed, or not chosen: not in use, on no line, not playing in the
// Storyboard). removed: the takes put aside, newest first (Restore).
export type PictureView = { file: string; mjLink: string | null; slot: string | null; label: string | null; url: string; kind: "picture" | "video"; source: string; mood: string; feeling: string; sectionFeeling: string | null; who: string | null; cleanable: number[]; removed: { n: number; label: string; why: string; at: string }[]; takes: (Take & { inUse?: boolean; onLines?: string; songFromMs?: number; clipInS?: number; songWhy?: string })[]; width: number | null; height: number | null; sent: string | null };
// Paul's own defaults for Animate (Creation → Defaults), for every song: the service and model, how many takes, the cap.
export type CreationDefaults = { service: ServiceId; quality: Quality; takes: number; cap: number; length: TakeLength }; // length: "song" = one phrase of the song, "short" = 5 s
export const CREATION_FILE = "creation.json"; // in the workspace folder
const FACTORY: CreationDefaults = { service: "wavespeed", quality: "standard", takes: DEFAULT_TAKES, cap: DEFAULT_CAP_USD, length: "song" };

export function readCreationDefaults(wsDir: string): CreationDefaults {
  const file = path.join(wsDir, CREATION_FILE);
  if (!existsSync(file)) return { ...FACTORY };
  try {
    return checkDefaults(JSON.parse(readFileSync(file, "utf8")) as Partial<CreationDefaults>);
  } catch {
    return { ...FACTORY };
  }
}
function checkDefaults(raw: Partial<CreationDefaults>): CreationDefaults {
  const service: ServiceId = raw.service === "higgsfield" ? "higgsfield" : "wavespeed";
  const s = SERVICES[service];
  const quality: Quality = raw.quality && s.models[raw.quality] ? raw.quality : s.models.standard ? "standard" : "best";
  const takes = Number.isInteger(raw.takes) && raw.takes! >= 1 && raw.takes! <= MAX_TAKES ? raw.takes! : DEFAULT_TAKES;
  const cap = typeof raw.cap === "number" && raw.cap > 0 && raw.cap <= 1000 ? raw.cap : DEFAULT_CAP_USD;
  const length: TakeLength = raw.length === "short" ? "short" : "song";
  return { service, quality, takes, cap, length };
}

// How long a take is (whole seconds): "song" = one musical phrase of this song (4 bars at its tempo, rounded up), so a
// take covers a phrase and the beat cuts have room; "short" or no beats yet = 5 s. Always 4 to 30 s.
export function phraseSeconds(downbeats: readonly number[]): number | null {
  const gaps = downbeats.slice(1).map((d, i) => d - downbeats[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (gaps.length < 2) return null;
  const bar = gaps[Math.floor(gaps.length / 2)];
  return Math.min(MAX_TAKE_SECONDS, Math.max(MIN_TAKE_SECONDS, Math.ceil((bar * PHRASE_BARS) / 1000 - 0.05)));
}
function songPhraseSeconds(ws: Workspace, projectId: string): number | null {
  // The bar length does not depend on which beat starts a bar (the downbeat offset): the stored downbeats are enough.
  const downbeats = ws.db.select().from(beatTable).where(eq(beatTable.project_id, projectId)).all().filter((b) => b.is_downbeat).map((b) => b.time_ms).sort((a, b) => a - b);
  return phraseSeconds(downbeats);
}
export function songTakeSeconds(ws: Workspace, projectId: string, length: TakeLength): number {
  return length === "short" ? TAKE_SECONDS : (songPhraseSeconds(ws, projectId) ?? TAKE_SECONDS);
}
export function saveCreationDefaults(wsDir: string, raw: unknown): CreationDefaults {
  if (!raw || typeof raw !== "object") throw new Error("The defaults must be an object.");
  const d = checkDefaults(raw as Partial<CreationDefaults>);
  writeFileSync(path.join(wsDir, CREATION_FILE), `${JSON.stringify({ _help: "Your defaults for Creation → Animate (every song): service, quality (standard / best), takes, cap (US$ per Animate), length (song = one phrase of the song, short = 5 s).", ...d }, null, 2)}\n`);
  return d;
}

// song (with songStarts, singer.ts): the song file, so a take plays with the song from the second its first frame belongs to.
export type PicturesView = {
  removedPictures: { file: string; label: string | null; at: string; slot: string | null }[]; // put aside (✕), newest first: Restore
  song?: string | null;
  defaults: CreationDefaults;
  pictures: PictureView[];
  services: { id: ServiceId; label: string; ready: boolean; keyName: string; qualities: { id: Quality; label: string; usdPerSecond: number; priceNote: string }[] }[];
  takeSeconds: number; // this song's take length (your default length: one phrase of the song, or 5 s)
  phraseSeconds: number | null; // one phrase of this song (null: no beats yet)
  defaultTakes: number;
  maxTakes: number;
  defaultCap: number;
  spentUsd: number; // estimates of the takes sent for this song
};

const HELP =
  "This song's pictures (Prepare → Pictures) and the clips animated from them: per picture, the mood words and every take " +
  "(service, request id, status, the estimated cost, the take's file in takes\\, the clip it was sent to the Storyboard as). Written by the app.";

// ---------------------------------------------------------------- put aside / restore a picture (23 Nov 2026)

export const REMOVED_PICTURES_DIR = "_removed";

// ✕ → Put aside: the picture (or video) leaves Creation; its file goes to pictures\_removed\, its record (takes, mood,
// shot) stays for Restore. A picture with a take being made is refused. Its clips already in the Storyboard stay.
export function removePicture(ws: Workspace, projectId: string, file: unknown): { file: string } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !BOARD_FILE.test(name) || !existsSync(path.join(dir, name))) throw new Error(`No ${String(file)} in this song's Creation space.`);
  const rec = readPictures(dir).pictures[name];
  if (rec?.takes.some((t) => t.status === "running")) throw new Error(`${name} has a take being made: wait for it, then put the picture aside.`);
  const into = path.join(dir, REMOVED_PICTURES_DIR);
  mkdirSync(into, { recursive: true });
  const ext = path.extname(name);
  let target = name;
  for (let n = 2; existsSync(path.join(into, target)); n++) target = `${path.basename(name, ext)} (${n})${ext}`;
  renameSync(path.join(dir, name), path.join(into, target));
  update(dir, name, (p) => void (p.removed = { at: new Date().toISOString(), file: `${REMOVED_PICTURES_DIR}/${target}` }));
  return { file: name };
}

// Restore: the picture comes back under its own name, with its takes, mood and shot.
export function restorePicture(ws: Workspace, projectId: string, file: unknown): { file: string } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  if (!rec?.removed || !existsSync(path.join(dir, rec.removed.file))) throw new Error(`${name} is not among the pictures put aside.`);
  if (existsSync(path.join(dir, name))) throw new Error(`A picture called ${name} is in Creation already: rename that one first.`);
  renameSync(path.join(dir, rec.removed.file), path.join(dir, name));
  update(dir, name, (p) => void delete p.removed);
  return { file: name };
}

// ---------------------------------------------------------------- files

export function songFolder(ws: Workspace, projectId: string): { root: string; dir: string } {
  const paths = songPathsById(ws, projectId);
  if (paths.legacy) throw new Error("This song has no folder yet: run the migration first (pnpm songs:migrate).");
  return { root: paths.root, dir: path.join(paths.root, PICTURES_DIR) };
}

export function readPictures(dir: string): PicturesFile {
  const file = path.join(dir, PICTURES_FILE);
  if (!existsSync(file)) return { pictures: {} };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PicturesFile;
    return { pictures: raw.pictures && typeof raw.pictures === "object" ? raw.pictures : {} };
  } catch {
    return { pictures: {} };
  }
}
function writePictures(dir: string, f: PicturesFile): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, PICTURES_FILE), `${JSON.stringify({ _help: HELP, pictures: f.pictures }, null, 2)}\n`);
}
// Read, change and write in one go (synchronous: the takes running at the same time never overwrite each other).
export function update(dir: string, file: string, change: (p: PictureRecord) => void): PictureRecord {
  const all = readPictures(dir);
  const rec = all.pictures[file] ?? { takes: [] };
  change(rec);
  all.pictures[file] = rec;
  writePictures(dir, all);
  return rec;
}
export function setTake(dir: string, file: string, n: number, patch: Partial<Take>): void {
  update(dir, file, (p) => {
    const t = p.takes.find((x) => x.n === n);
    if (t) Object.assign(t, patch);
  });
}

// Where a file added by hand came from, guessed from its name: Midjourney's downloads end with the job's id
// ("user_words_<uuid>_0.png", or "...<uuid>.mp4"); anything else is "Added by you".
const MJ_NAME = /(midjourney|_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_\d+)?\.\w+$)/i;
// "Open in Midjourney" (23 Nov 2026): a Midjourney download keeps its job id (and the image or video number) in its
// name, e.g. "…_5813efa3-57ba-409f-8aa1-09b60e1b9c83_1.mp4": the link to that exact result on midjourney.com. Pure.
export function midjourneyLink(name: string): string | null {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_(\d+))?(?:\s*\(\d+\))?\.\w+$/i.exec(name);
  if (!m) return null;
  return `https://www.midjourney.com/jobs/${m[1].toLowerCase()}${m[2] !== undefined ? `?index=${m[2]}` : ""}`;
}

export function sourceLabel(name: string, from?: string): string {
  if (from) return from;
  return MJ_NAME.test(name) ? "Midjourney" : "Added by you";
}

// Pictures and videos dropped on the board: copied into pictures\ under their own names (a free name when one is taken;
// the same content twice is not copied again). `from`: the source label for all of them (a link's site).
export async function addPictures(ws: Workspace, projectId: string, files: readonly { file: string; name: string }[], from?: string): Promise<{ added: string[]; skipped: { name: string; reason: string }[] }> {
  const { dir } = songFolder(ws, projectId);
  mkdirSync(dir, { recursive: true });
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const existing = readdirSync(dir).filter((f) => BOARD_FILE.test(f));
  for (const f of files) {
    const name = path.basename(f.name);
    if (!BOARD_FILE.test(name)) {
      skipped.push({ name, reason: "not a picture or video (.jpg, .png, .webp, .mp4, .mov, .webm)" });
      continue;
    }
    const video = BOARD_VIDEO_FILE.test(name);
    const info = await probeMedia(f.file).catch(() => null);
    if (!info?.width || !info.height || (video && !info.hasVideo)) {
      skipped.push({ name, reason: video ? "no video found in the file" : "no picture found in the file" });
      continue;
    }
    const bytes = readFileSync(f.file);
    const same = existing.find((e) => statSync(path.join(dir, e)).size === bytes.length && readFileSync(path.join(dir, e)).equals(bytes));
    if (same) {
      skipped.push({ name, reason: `already on the board as ${same}` });
      continue;
    }
    const target = uniqueFileName(dir, name);
    copyFileSync(f.file, path.join(dir, target));
    existing.push(target);
    added.push(target);
    const source = sourceLabel(name, from);
    update(dir, target, (p) => {
      p.source = source;
    });
  }
  return { added, skipped };
}

// "Add from a link" (any outside source: a Midjourney, Higgsfield or WaveSpeed download link, a shared file): the file
// is downloaded once and added like a dropped one, labelled with the site it came from.
export async function addFromLink(ws: Workspace, projectId: string, link: unknown, f: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<{ added: string[]; skipped: { name: string; reason: string }[] }> {
  let url: URL;
  try {
    url = new URL(String(link ?? "").trim());
  } catch {
    throw new Error("Paste a full link, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Paste a full link, starting with https://");
  const host = url.hostname.replace(/^www\./, "");
  const res = await f(url.toString());
  if (!res.ok) throw new Error(`${host} answered ${res.status}: the link may have expired or need a sign-in. Download the file and drop it here instead.`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : type.includes("jpeg") || type.includes("jpg") ? ".jpg" : type.includes("quicktime") ? ".mov" : type.includes("webm") ? ".webm" : type.includes("mp4") ? ".mp4" : "";
  let name = decodeURIComponent(path.posix.basename(url.pathname)).replace(/[^\w.\- ()]/g, "_") || "download";
  if (!BOARD_FILE.test(name)) {
    if (!ext) throw new Error(`The link does not lead to a picture or video (${type || "unknown type"}): open it, download the file and drop it here.`);
    name = `${name.replace(/\.[^.]*$/, "")}${ext}`;
  }
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_LINK_BYTES) throw new Error("That file is over 1 GB: download it and drop it here instead.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_LINK_BYTES) throw new Error("That file is over 1 GB: download it and drop it here instead.");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-link-"));
  try {
    const file = path.join(tmp, name);
    writeFileSync(file, bytes);
    return await addPictures(ws, projectId, [{ file, name }], /midjourney/i.test(host) ? "Midjourney" : `From ${host}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Feeling (feelings.ts) chosen on the picture itself: wins over its shot's section; "" or null: back to the section's.
export function setPictureFeeling(ws: Workspace, projectId: string, file: string, feeling: unknown): string {
  const { dir } = songFolder(ws, projectId);
  if (!existsSync(path.join(dir, path.basename(file)))) throw new Error(`No picture ${file} on this song's board.`);
  const f = cleanFeeling(feeling);
  update(dir, path.basename(file), (p) => {
    p.feeling = f;
  });
  return f ?? "";
}

export function setMood(ws: Workspace, projectId: string, file: string, mood: unknown): string {
  const { dir } = songFolder(ws, projectId);
  if (!existsSync(path.join(dir, path.basename(file)))) throw new Error(`No picture ${file} on this song's board.`);
  const text = String(mood ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  update(dir, path.basename(file), (p) => {
    p.mood = text || undefined;
  });
  return text;
}

// Takes left "running" by a studio that stopped are interrupted (their result may still be fetched).
export function markInterrupted(dir: string, isAlive: (pid: number) => boolean): void {
  const all = readPictures(dir);
  let changed = false;
  for (const rec of Object.values(all.pictures))
    for (const t of rec.takes)
      if (t.status === "running" && (!t.pid || (t.pid !== process.pid && !isAlive(t.pid)))) {
        t.status = "interrupted";
        t.error = t.request_id ? "The studio stopped while this take was being made: get its result (free)." : "The studio stopped before this take was sent: nothing was spent.";
        changed = true;
      }
  if (changed) writePictures(dir, all);
}

export function keyFor(service: ServiceId, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[SERVICES[service].keyName]?.trim() || null;
}

export async function picturesView(ws: Workspace, projectId: string, env: NodeJS.ProcessEnv = process.env, isAlive: (pid: number) => boolean = processAlive): Promise<PicturesView> {
  const { dir } = songFolder(ws, projectId);
  if (existsSync(dir)) {
    markInterrupted(dir, isAlive);
    repairTakes(dir);
  }
  const all = readPictures(dir);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => BOARD_FILE.test(f) && statSync(path.join(dir, f)).isFile()) : [];
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const rel = path.relative(ws.dir, dir).split(path.sep).join("/");
  const recipeFile = songPathsById(ws, projectId).recipe;
  const songAnchors = recipeFile ? (readRecipe(recipeFile).anchors ?? []) : [];
  const use = takeUse(ws, projectId);
  const singingAnchors = new Set(songAnchors.filter((a) => a.sync !== undefined).map((a) => `${a.line}:${a.through ?? a.line}:${a.clip.toLowerCase()}`));
  // Where a take shows now (Paul, 21 Nov 2026: the card said only "In Storyboard"): "line 15", "lines 15-16", "lines 3, 9".
  const onLines = (clip: string | undefined): string | undefined => {
    const at = clip ? songAnchors.filter((a) => a.clip.toLowerCase() === clip.toLowerCase()).map((a) => (a.through && a.through > a.line ? `${a.line}-${a.through}` : String(a.line))) : [];
    return at.length ? `${at.length > 1 || at[0].includes("-") ? "lines" : "line"} ${at.join(", ")}` : undefined;
  };
  // A clip sent to the Storyboard that is no longer in the song's clips (the user removed it) counts as not sent.
  const clipsDir = songPathsById(ws, projectId).clips;
  const stillThere = (c: string | undefined) => !!c && !!clipsDir && existsSync(path.join(clipsDir, c));
  const pictures: PictureView[] = [];
  for (const f of files) {
    const info = await probeMedia(path.join(dir, f)).catch(() => null);
    const rec = all.pictures[f];
    // A singing take is "in use" while its clip is the singing anchor on its lines (song.json).
    const takes = (rec?.takes ?? []).map((t) => (t.clip && !t.sent ? { ...t, sent: t.clip } : t)).map((t) => (t.kind !== "lipsync" && t.sent && !stillThere(t.sent) ? { ...t, sent: undefined } : t)).map((t) => (t.kind === "lipsync" ? { ...t, inUse: !!t.sent && singingAnchors.has(`${t.line}:${t.through ?? t.line}:${t.sent.toLowerCase()}`) } : { ...t, onLines: onLines(t.sent) }));
    const cleanable = (rec?.takes ?? []).filter((t) => use.cleanable(t)).map((t) => t.n);
    const removed = [...(rec?.removedTakes ?? [])].sort((a, b) => b.removed_at.localeCompare(a.removed_at)).map((t) => ({ n: t.n, label: t.label ?? `Take ${t.n}`, why: t.kind === "lipsync" ? `lip sync, ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` : t.status === "failed" ? "failed" : t.model, at: t.removed_at }));
    pictures.push({ file: f, mjLink: midjourneyLink(f), slot: rec?.slot ?? null, label: rec?.label ?? null, url: `${rel}/${f}`, kind: PICTURE_FILE.test(f) ? "picture" : "video", source: sourceLabel(f, rec?.source), mood: rec?.mood ?? "", feeling: rec?.feeling ?? "", who: rec?.who ?? null, sectionFeeling: feelingForSlot(ws, projectId, rec?.slot).feeling ?? null, cleanable, removed, takes, width: info?.width ?? null, height: info?.height ?? null, sent: stillThere(rec?.sent) ? rec!.sent! : null });
  }
  const stub = !!env.LYRIC_GENERATE_STUB;
  const removedPictures = Object.entries(all.pictures)
    .filter(([, r]) => r.removed && existsSync(path.join(dir, r.removed.file)))
    .map(([f, r]) => ({ file: f, label: r.label ?? null, at: r.removed!.at, slot: r.slot ?? null }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return {
    removedPictures,
    defaults: readCreationDefaults(ws.dir),
    pictures,
    services: (Object.values(SERVICES) as Service[]).map((s) => ({
      id: s.id,
      label: s.label,
      keyName: s.keyName,
      ready: stub || !!keyFor(s.id, env),
      qualities: (Object.entries(s.models) as [Quality, Model][]).map(([id, m]) => ({ id, label: m.label, usdPerSecond: m.usdPerSecond, priceNote: m.priceNote })),
    })),
    takeSeconds: songTakeSeconds(ws, projectId, readCreationDefaults(ws.dir).length),
    phraseSeconds: songPhraseSeconds(ws, projectId),
    defaultTakes: DEFAULT_TAKES,
    maxTakes: MAX_TAKES,
    defaultCap: DEFAULT_CAP_USD,
    spentUsd: Math.round(Object.values(all.pictures).flatMap((p) => [...p.takes, ...(p.removedTakes ?? [])]).filter((t) => t.request_id && t.status !== "failed").reduce((s, t) => s + t.cost_usd, 0) * 100) / 100,
  };
}

// A take as the services send it may not play in a browser (another codec, 10-bit colour, the index at the end): it is
// re-written once as H.264 / yuv420p with the index first (a plain copy when the picture is already H.264 yuv420p).
// `keepSound` false: the sound is left out. The file is replaced in place.
export function makePlayable(file: string, keepSound = true): void {
  let codec = "";
  let pix = "";
  try {
    const out = execFileSync(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", file], { encoding: "utf8" });
    [codec, pix] = out.trim().split(",");
  } catch {
    // unreadable: re-encoded below
  }
  const tmp = `${file}.playable.mp4`;
  const copy = codec === "h264" && pix === "yuv420p";
  execFileSync(ffmpegBin(), [
    "-y", "-v", "error", "-i", file, "-map", "0:v:0", ...(keepSound ? ["-map", "0:a?"] : []),
    ...(copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p"]),
    ...(keepSound ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart", tmp,
  ]);
  renameSync(tmp, file);
}

// Takes downloaded before makePlayable existed (21 Nov 2026): made playable once when the board is read.
function repairTakes(dir: string): void {
  const all = readPictures(dir);
  for (const [name, rec] of Object.entries(all.pictures))
    for (const t of rec.takes)
      if (t.status === "done" && t.file && !t.playable && existsSync(path.join(dir, t.file))) {
        try {
          makePlayable(path.join(dir, t.file), t.kind !== "lipsync");
          setTake(dir, name, t.n, { playable: true });
        } catch {
          // left as it is; the file can still be opened from the song folder
        }
      }
}

// ---------------------------------------------------------------- the request

// The app's prompt: gentle, natural motion that keeps the picture as it is; the realism rules of the take's feel
// (realism.ts); the song's Film look line (film-looks.ts), so every clip shares one camera, grain and grade; Paul's
// mood words, if any, at the end. The feeling of the shot's section (feelings.ts) follows the realism rules.
export function motionPrompt(mood?: string, look?: string, feel?: Feel, feeling?: string, feelingTo?: string): string {
  const base =
    "Bring this picture to life with gentle, natural motion: a light breeze, hair and fabric moving softly, small natural movements of the people, " +
    "soft shifts in the light, and a slow, subtle camera drift. Keep the people, faces, clothes, colours, light and composition exactly as in the picture. " +
    "One continuous shot, no cuts, no text, no subtitles, no logos.";
  const l = look?.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const m = mood?.replace(/\s+/g, " ").trim();
  const fw = feelingWords(feeling, feelingTo);
  return `${base}${feel ? ` ${realismRules(feel)}` : ""}${fw ? ` ${fw}.` : ""}${l ? ` Film look, the same in every shot: ${l}.` : ""}${m ? ` Mood: ${m}.` : ""}`;
}

export type Estimate = { takes: number; seconds: number; usdPerTake: number; usd: number; model: string; priceNote: string };
export function estimate(service: ServiceId, quality: Quality, takes: number, seconds = TAKE_SECONDS): Estimate {
  const s = SERVICES[service];
  const m = s.models[quality] ?? s.models.best!;
  const usdPerTake = Math.round(m.usdPerSecond * seconds * 100) / 100;
  return { takes, seconds, usdPerTake, usd: Math.round(usdPerTake * takes * 100) / 100, model: m.label, priceNote: m.priceNote };
}

// One service's calls. `download` writes the finished video to a file.
export type Transport = {
  upload: (file: string) => Promise<string>; // a public URL of the picture
  submit: (imageUrl: string, prompt: string, seconds?: number) => Promise<{ id: string; pollUrl?: string }>;
  // Reference-to-video (WaveSpeed only): the pictures' public URLs in @Image order.
  submitRefs?: (imageUrls: string[], prompt: string, seconds: number, aspect: "9:16" | "16:9", videoUrls?: string[]) => Promise<{ id: string; pollUrl?: string }>;
  poll: (id: string, pollUrl?: string) => Promise<{ status: "running" } | { status: "done"; url: string } | { status: "failed"; error: string }>;
  download: (url: string, file: string) => Promise<void>;
};

export const WAVESPEED = "https://api.wavespeed.ai/api/v3";
const HIGGSFIELD = "https://api.higgsfield.ai";
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".wav": "audio/wav", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

export async function json(r: Response, what: string): Promise<Record<string, unknown>> {
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  if (!r.ok) {
    const msg = (body.message ?? body.detail ?? body.error ?? text.slice(0, 200)) as unknown;
    const hint = r.status === 401 || r.status === 403 ? " (check the key in D:\\videomaker\\.env)" : r.status === 402 ? " (top up your balance on the service)" : "";
    throw new Error(`${what}: HTTP ${r.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}${hint}`);
  }
  return body;
}
export const data = (b: Record<string, unknown>) => ((b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>);

// WaveSpeed's direct upload: a ticket, then the bytes PUT to it; the picture's public URL lives 7 days.
export async function waveSpeedUpload(key: string, file: string, f: typeof fetch): Promise<string> {
  const bytes = readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const ticket = data(await json(await f(`${WAVESPEED}/media/uploads`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ filename: `${/\.(wav)$/.test(ext) ? "voice" : /\.(mp4|m4v|mov|webm)$/.test(ext) ? "video" : "picture"}${ext}`, size: bytes.length, content_type: MIME[ext] ?? "image/jpeg" }) }), "WaveSpeed upload"));
  const up = ticket.upload as { method?: string; url?: string; headers?: Record<string, string> } | undefined;
  const url = ticket.download_url;
  if (!up?.url || typeof url !== "string") throw new Error("WaveSpeed upload: no upload address in the answer");
  const put = await f(up.url, { method: up.method ?? "PUT", headers: up.headers ?? {}, body: bytes });
  if (!put.ok) throw new Error(`WaveSpeed upload: HTTP ${put.status} when sending the file`);
  return url;
}

export function waveSpeedTransport(key: string, model: string, f: typeof fetch = (...a) => globalThis.fetch(...a), resolution: string = RESOLUTION): Transport {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    upload: (file) => waveSpeedUpload(key, file, f),
    submit: async (image, prompt, seconds = TAKE_SECONDS) => {
      const b = data(await json(await f(`${WAVESPEED}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ image, prompt, duration: seconds, resolution, generate_audio: false, output_format: "mp4" }) }), "WaveSpeed"));
      if (typeof b.id !== "string") throw new Error("WaveSpeed: no request id in the answer");
      return { id: b.id };
    },
    submitRefs: async (images, prompt, seconds, aspect, videos = []) => {
      const b = data(await json(await f(`${WAVESPEED}/${REFERENCE_MODEL.path}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prompt, reference_images: images, ...(videos.length ? { reference_videos: videos } : {}), aspect_ratio: aspect, resolution: RESOLUTION, duration: seconds, generate_audio: false }) }), "WaveSpeed"));
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

// Higgsfield takes the picture only as a public URL (no upload of its own): it goes up through WaveSpeed's upload
// when that key is there, else fal's storage (FAL_KEY).
export function higgsfieldTransport(key: string, model: string, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = (...a) => globalThis.fetch(...a)): Transport {
  const auth = { Authorization: `Key ${key}` };
  return {
    upload: async (file) => {
      const ws = keyFor("wavespeed", env);
      if (ws) return waveSpeedUpload(ws, file, f);
      const fal = env.FAL_KEY?.trim();
      if (!fal) throw new Error("Higgsfield needs the picture online first: add WAVESPEED_API_KEY or FAL_KEY to D:\\videomaker\\.env (used only to put the picture online).");
      const { createFalClient } = await import("@fal-ai/client");
      const client = createFalClient({ credentials: fal, suppressLocalCredentialsWarning: true });
      return client.storage.upload(new Blob([readFileSync(file)], { type: MIME[path.extname(file).toLowerCase()] ?? "image/jpeg" }));
    },
    submit: async (image, prompt, seconds = TAKE_SECONDS) => {
      const b = await json(await f(`${HIGGSFIELD}/${model}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ image_url: image, prompt, duration: seconds, resolution: RESOLUTION, generate_audio: false }) }), "Higgsfield");
      if (typeof b.request_id !== "string") throw new Error("Higgsfield: no request id in the answer");
      return { id: b.request_id, pollUrl: typeof b.status_url === "string" ? b.status_url : undefined };
    },
    poll: async (id, pollUrl) => {
      const r = await f(pollUrl ?? `${HIGGSFIELD}/requests/${encodeURIComponent(id)}/status`, { headers: auth });
      if (r.status === 429 || r.status >= 500) return { status: "running" };
      const b = await json(r, "Higgsfield");
      const s = String(b.status ?? "");
      if (s === "completed") {
        const url = (b.video as { url?: string } | undefined)?.url;
        return url ? { status: "done", url } : { status: "failed", error: "finished without a video" };
      }
      if (s === "nsfw") return { status: "failed", error: "Higgsfield's content check refused this picture or result" };
      if (s === "failed" || s === "canceled") return { status: "failed", error: String(b.error || s) };
      return { status: "running" };
    },
    download: (url, file) => download(url, file, writeFileSync, undefined, f),
  };
}

// The browser tests' and the cloud's stand-in (LYRIC_GENERATE_STUB=1): a 5 s clip made from the picture by FFmpeg,
// nothing sent anywhere. LYRIC_GENERATE_STUB=fail makes every take fail.
export function stubTransport(mode: string): Transport {
  const pictures = new Map<string, string>();
  const lengths = new Map<string, number>(); // picture url -> the asked length (s)
  let n = 0;
  return {
    upload: async (file) => {
      const url = `stub://${++n}`;
      pictures.set(url, file);
      return url;
    },
    submit: async (image, _prompt, seconds = TAKE_SECONDS) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      lengths.set(image, seconds);
      return { id: `stub-${image.slice(7)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, pollUrl: image };
    },
    submitRefs: async (images, _prompt, seconds) => {
      if (mode === "fail") throw new Error("stand-in: the service refused the request");
      lengths.set(images[0], seconds);
      return { id: `stub-refs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, pollUrl: images[0] };
    },
    poll: async (_id, pollUrl) => ({ status: "done", url: pollUrl ?? "" }),
    download: async (url, file) => {
      const picture = pictures.get(url);
      if (!picture) throw new Error("stand-in: unknown picture");
      execFileSync(ffmpegBin(), ["-y", "-v", "error", "-loop", "1", "-i", picture, "-t", String(lengths.get(url) ?? TAKE_SECONDS), "-r", "30", "-vf", `scale=trunc(iw/2)*2:trunc(ih/2)*2,noise=alls=12:allf=t:all_seed=${Math.floor(Math.random() * 1e6)},format=yuv420p`, "-c:v", "libx264", "-preset", "ultrafast", file]);
    },
  };
}

export function transportFor(service: ServiceId, quality: Quality, env: NodeJS.ProcessEnv = process.env): Transport {
  if (env.LYRIC_GENERATE_STUB) return stubTransport(env.LYRIC_GENERATE_STUB);
  const key = keyFor(service, env);
  const s = SERVICES[service];
  if (!key) throw new Error(`No ${s.keyName} in .env: add a line ${s.keyName}=<your key from ${service === "wavespeed" ? "wavespeed.ai → API keys" : 'open.higgsfield.ai → API keys, written as "key id:key secret"'}> to D:\\videomaker\\.env, then restart Lyric Studio.`);
  const m = s.models[quality] ?? s.models.best!;
  return service === "wavespeed" ? waveSpeedTransport(key, m.path, undefined, m.resolution) : higgsfieldTransport(key, m.path, env);
}

// ---------------------------------------------------------------- animate

export type AnimateOptions = { service: ServiceId; quality?: Quality; takes?: number; capUsd?: number; seconds?: number }; // seconds: this song's take length unless given

// Checks a press of Animate and records its takes as running; returns them (the caller starts runTakes without waiting).
export function startAnimate(ws: Workspace, projectId: string, file: string, o: AnimateOptions, env: NodeJS.ProcessEnv = process.env): { takes: Take[]; estimate: Estimate } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (BOARD_VIDEO_FILE.test(name)) throw new Error(`${name} is already a video: only a picture can be animated. Send it to the Storyboard as it is.`);
  if (!name || !existsSync(path.join(dir, name)) || !PICTURE_FILE.test(name)) throw new Error(`No picture ${file} on this song's board.`);
  if (!(o.service in SERVICES)) throw new Error("Choose WaveSpeed or Higgsfield.");
  const s = SERVICES[o.service];
  const quality: Quality = o.quality && s.models[o.quality] ? o.quality : s.models.standard ? "standard" : "best";
  const takes = Math.round(Number(o.takes ?? DEFAULT_TAKES));
  if (!Number.isFinite(takes) || takes < 1 || takes > MAX_TAKES) throw new Error(`Make 1 to ${MAX_TAKES} takes at a time.`);
  if (!env.LYRIC_GENERATE_STUB && !keyFor(o.service, env)) transportFor(o.service, quality, env); // throws the plain-words message
  const wanted = Math.round(Number(o.seconds ?? songTakeSeconds(ws, projectId, readCreationDefaults(ws.dir).length)));
  const seconds = Number.isFinite(wanted) ? Math.min(MAX_TAKE_SECONDS, Math.max(MIN_TAKE_SECONDS, wanted)) : TAKE_SECONDS;
  const e = estimate(o.service, quality, takes, seconds);
  const cap = Number(o.capUsd ?? DEFAULT_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Set a spending cap above $0.");
  if (e.usd > cap) throw new Error(`${takes} takes of ${seconds} s cost about $${e.usd.toFixed(2)}, above your cap of $${cap.toFixed(2)}: make fewer takes or raise the cap. Nothing was sent.`);
  const now = new Date().toISOString();
  let made: Take[] = [];
  const look = filmLookFor(ws, projectId);
  const feel = feelFor(ws, projectId);
  const rec = readPictures(dir).pictures[name];
  const feeling = rec?.feeling ? { feeling: rec.feeling } : feelingForSlot(ws, projectId, rec?.slot); // its own choice, else its shot's section; a loose picture: none
  update(dir, name, (p) => {
    const first = nextTakeN(p);
    made = Array.from({ length: takes }, (_, i) => ({ n: first + i, service: o.service, quality, model: e.model, status: "running" as const, started_at: now, cost_usd: e.usdPerTake, seconds, ...(look ? { filmLook: look.name, look: look.line } : {}), feel, ...feeling, pid: process.pid }));
    p.takes.push(...made);
  });
  return { takes: made, estimate: e };
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Makes the takes (in parallel): the picture online once, each request sent once, its result polled, downloaded and
// put at the end of the song's clips. `resume`: takes that already have a request id are only polled and fetched.
export async function runTakes(openWs: () => Workspace, projectId: string, file: string, ns: number[], o: { env?: NodeJS.ProcessEnv; transport?: Transport; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? sleepMs;
  const ws = openWs();
  let dir: string;
  const wsDir = ws.dir;
  try {
    dir = songFolder(ws, projectId).dir;
  } finally {
    ws.close();
  }
  const picture = path.join(dir, file);
  const rec = readPictures(dir).pictures[file];
  const takes = (rec?.takes ?? []).filter((t) => ns.includes(t.n));
  if (!takes.length) return;
  const { service, quality } = takes[0];
  let transport: Transport;
  try {
    transport = o.transport ?? transportFor(service, quality, env);
  } catch (error) {
    for (const t of takes) setTake(dir, file, t.n, { status: "failed", error: errorText(error), ended_at: new Date().toISOString(), pid: undefined });
    return;
  }
  // Make with references: every reference picture online once (in @Image order), shared by the takes.
  const refTakes = takes.filter((t) => t.kind === "references" && !t.request_id);
  let refUrls: string[] | null = null;
  let guideUrls: string[] = []; // the camera guide video (@Video 1), when the takes have one
  if (refTakes.length) {
    try {
      if (!transport.submitRefs) throw new Error(`${SERVICES[service].label} cannot make a take with references`);
      refUrls = [];
      for (const f of refTakes[0].refFiles ?? []) refUrls.push(await transport.upload(path.join(wsDir, f)));
      if (!refUrls.length) throw new Error("no reference picture");
      if (refTakes[0].guideFile) guideUrls = [await transport.upload(path.join(wsDir, refTakes[0].guideFile))];
    } catch (error) {
      refUrls = null;
      for (const t of refTakes) setTake(dir, file, t.n, { status: "failed", error: `The reference pictures could not be put online: ${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
    }
  }
  // The picture's public URL: made once and reused while the service keeps it.
  let imageUrl: string | null = null;
  const needsUpload = takes.some((t) => !t.request_id && t.kind !== "references");
  if (needsUpload) {
    const known = readPictures(dir).pictures[file]?.upload;
    if (known && known.service === service && Date.now() - Date.parse(known.at) < UPLOAD_KEEP_MS && !env.LYRIC_GENERATE_STUB && !o.transport) imageUrl = known.url;
    else {
      try {
        imageUrl = await transport.upload(picture);
        const url = imageUrl;
        update(dir, file, (p) => {
          p.upload = { service, url, at: new Date().toISOString() };
        });
      } catch (error) {
        for (const t of takes.filter((x) => !x.request_id)) setTake(dir, file, t.n, { status: "failed", error: `The picture could not be put online: ${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      }
    }
  }
  const mood = readPictures(dir).pictures[file]?.mood;
  await Promise.all(
    takes.map(async (t) => {
      let id = t.request_id;
      let pollUrl = t.poll_url;
      // A take already marked failed above (its picture could not be put online) stays failed.
      if (readPictures(dir).pictures[file]?.takes.find((x) => x.n === t.n)?.status === "failed") return;
      try {
        setTake(dir, file, t.n, { status: "running", pid: process.pid, error: undefined });
        if (!id && t.kind === "references") {
          if (!refUrls || !transport.submitRefs) return;
          const sent = await transport.submitRefs(refUrls, t.prompt ?? "", t.seconds ?? TAKE_SECONDS, t.aspect ?? "9:16", t.guideFile ? guideUrls : []); // never retried: billed once
          id = sent.id;
          pollUrl = sent.pollUrl;
          setTake(dir, file, t.n, { request_id: id, poll_url: pollUrl });
        }
        if (!id) {
          if (!imageUrl) return;
          const sent = await transport.submit(imageUrl, motionPrompt(mood, t.look, t.feel, t.feeling, t.feelingTo), t.seconds ?? TAKE_SECONDS); // never retried: a retry could be billed twice
          id = sent.id;
          pollUrl = sent.pollUrl;
          setTake(dir, file, t.n, { request_id: id, poll_url: pollUrl });
        }
        const t0 = Date.now();
        let url: string | null = null;
        for (;;) {
          const s = await transport.poll(id, pollUrl);
          if (s.status === "done") {
            url = s.url;
            break;
          }
          if (s.status === "failed") throw new Error(`${SERVICES[service].label}: ${s.error}`);
          if (Date.now() - t0 > (o.timeoutMs ?? TIMEOUT_MS)) throw new Error(`no answer within ${Math.round((o.timeoutMs ?? TIMEOUT_MS) / 60000)} min: get its result later (free)`);
          await sleep(o.pollMs ?? POLL_MS);
        }
        // The take stays on the board (pictures\takes\): Paul sends the ones he likes to the Storyboard himself.
        const tmp = mkdtempSync(path.join(os.tmpdir(), "lyric-take-"));
        try {
          const out = path.join(tmp, "take.mp4");
          await transport.download(url, out);
          makePlayable(out, false); // the takes have no sound (generate_audio false); browser-ready H.264
          const takesDir = path.join(dir, TAKES_DIR);
          mkdirSync(takesDir, { recursive: true });
          const name = uniqueFileName(takesDir, `${path.parse(file).name} take ${t.n}.mp4`);
          copyFileSync(out, path.join(takesDir, name));
          setTake(dir, file, t.n, { status: "done", file: `${TAKES_DIR}/${name}`, playable: true, ended_at: new Date().toISOString(), pid: undefined });
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      } catch (error) {
        setTake(dir, file, t.n, { status: id ? "interrupted" : "failed", error: id ? `${errorText(error)} (sent: get its result later, free)` : `${errorText(error)}. Nothing was spent.`, ended_at: new Date().toISOString(), pid: undefined });
      }
    }),
  );
}

// "Get result": takes that were sent (they have a request id) but did not come back; only polled and fetched (free).
export function startResume(ws: Workspace, projectId: string, file: string, n: number): Take {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(file);
  const t = readPictures(dir).pictures[name]?.takes.find((x) => x.n === n);
  if (!t) throw new Error("No such take.");
  if (t.status === "running") throw new Error("This take is still being made.");
  if (!t.request_id) throw new Error("This take was never sent: animate the picture again.");
  if (t.status === "done") throw new Error("This take is already finished.");
  setTake(dir, name, n, { status: "running", pid: process.pid, error: undefined });
  return t;
}

// The short name an item carries to the Storyboard: its own, else (a take) the picture's name with "take N" or
// "sings line N"; null: none (the file name shows).
export function itemLabel(rec: PictureRecord | undefined, n?: number | null): string | null {
  if (n === undefined || n === null) return rec?.label ?? null;
  const t = rec?.takes.find((x) => x.n === n);
  if (t?.label) return t.label;
  if (!rec?.label) return null;
  return t?.kind === "lipsync" ? `${rec.label} sings ${t.through && t.through > (t.line ?? 0) ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` : `${rec.label} take ${n}`;
}

// Rename (Creation): a short name for a picture, video (n null) or take (n), shown instead of the file name; the file
// keeps its name. What was already sent to the Storyboard is renamed there too.
export function setItemLabel(ws: Workspace, projectId: string, file: string, n: number | null | undefined, label: unknown): string | null {
  const { root, dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !existsSync(path.join(dir, name))) throw new Error(`No ${file} in this song's Creation space.`);
  const text = cleanLabel(label);
  const rec = update(dir, name, (p) => {
    if (n === undefined || n === null) p.label = text || undefined;
    else {
      const t = p.takes.find((x) => x.n === n);
      if (!t) throw new Error("No such take.");
      t.label = text || undefined;
    }
  });
  // Rename in the Storyboard what carries this name there (the item itself, and its takes that follow the picture's name).
  const rename = (clip: string | undefined, next: string | null) => {
    if (clip) setClipLabel(root, clip, next ?? "");
  };
  if (n === undefined || n === null) {
    rename(rec.sent, rec.label ?? null);
    for (const t of rec.takes) if (!t.label) rename(t.sent ?? t.clip, itemLabel(rec, t.n));
  } else {
    const t = rec.takes.find((x) => x.n === n)!;
    rename(t.sent ?? t.clip, itemLabel(rec, n));
  }
  return text || null;
}

// "Send to Storyboard": a picture or one of its finished takes is copied into the song's clips and joins the END of the
// story line (like any dropped clip; Paul orders it there). The board keeps its own copy, marked as sent.
// forLine (Lyrics Sync picked a take for a line or as a hidden moment's cover): the copy is marked lineOnly in clips.json and
// does not join the story line: it stays in Creation as far as the Storyboard goes. A later normal Send makes it a story
// moment (end of the order). A sent clip that is no longer in clips\ counts as not sent: it is put back from clips\_removed\
// when it is there, else copied again.
export async function sendToStoryboard(ws: Workspace, projectId: string, file: string, n?: number | null, options: { forLine?: boolean } = {}): Promise<{ clip: string; already: boolean }> {
  const { dir, root } = songFolder(ws, projectId);
  const clipsDir = songPathsById(ws, projectId).clips;
  const forLine = options.forLine === true;
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  if (!name || !existsSync(path.join(dir, name)) || !BOARD_FILE.test(name)) throw new Error(`No ${file} in this song's Creation space.`);
  const here = (c: string) => !!clipsDir && existsSync(path.join(clipsDir, c));
  const markSent = (clip: string) =>
    update(dir, name, (p) => {
      if (n === undefined || n === null) p.sent = clip;
      else {
        const t = p.takes.find((x) => x.n === n);
        if (t) t.sent = clip;
      }
    });
  // A clip that was only for a line, sent from Creation now: a story moment at the END of the order.
  const joinStory = (clip: string): { clip: string; already: boolean } => {
    if (!forLine && isLineOnly(readClipEdits(root), clip)) {
      setClipLineOnly(root, clip, false);
      moveSongClipToEnd(ws, projectId, clip);
      return { clip, already: false };
    }
    return { clip, already: true };
  };
  let source: string;
  let as: string;
  let known: string | undefined;
  if (n === undefined || n === null) {
    known = rec?.sent;
    source = path.join(dir, name);
    as = name;
  } else {
    const t = rec?.takes.find((x) => x.n === n);
    if (!t) throw new Error("No such take.");
    known = t.sent ?? t.clip;
    if (!known || !here(known)) {
      if (t.status !== "done" || !t.file || !existsSync(path.join(dir, t.file))) throw new Error("This take is not finished yet.");
    }
    source = path.join(dir, t.file ?? "");
    as = path.basename(t.file ?? "");
  }
  if (known && here(known)) return joinStory(known);
  // Sent before, but the clip is gone from clips\: put it back from clips\_removed\ when it is there (no duplicate).
  if (known && clipsDir && existsSync(path.join(clipsDir, REMOVED_DIR, known))) {
    let clip: string;
    if (forLine) clip = path.basename(restoreClipTo(ws, clipsDir, known));
    else clip = path.basename(restoreSongClip(ws, projectId, known));
    if (forLine) setClipLineOnly(root, clip, true);
    else if (isLineOnly(readClipEdits(root), clip)) setClipLineOnly(root, clip, false);
    markSent(clip);
    return { clip, already: false };
  }
  const r = await importSongClips(ws, projectId, [{ file: source, name: as }], { inOrder: !forLine });
  const clip = r.added[0] ?? r.duplicates[0]?.sameAs;
  if (!clip) throw new Error(r.skipped[0]?.reason ?? "It could not be added to the Storyboard.");
  // Its short name goes with it (the Storyboard and the pickers show it).
  const label = itemLabel(rec, n);
  if (label && r.added.length) setClipLabel(root, clip, label);
  if (forLine && r.added.length) setClipLineOnly(root, clip, true);
  markSent(clip);
  if (!r.added.length) return joinStory(clip);
  return { clip, already: false };
}

// ---------------------------------------------------------------- Clean up (Paul, 21 Nov 2026: "a cleanup button for the takes")

// The next take number of a picture: past every take, the removed ones too (a restored take never meets a new one).
export const nextTakeN = (p: PictureRecord) => [...p.takes, ...(p.removedTakes ?? [])].reduce((m, t) => Math.max(m, t.n), 0) + 1;

// What a take is used for now: a singing take in use (its clip is the singing anchor on its lines), a take shown on a
// line, a clip set to Omit in the Storyboard. cleanable: a take Clean up may put aside: failed; stopped before it was
// sent (nothing to collect); or finished and not chosen: a singing take not in use (never sent, or its clip on Omit:
// it never plays), an Animate take never sent to the Storyboard. Never: running, collectable (Get result), in use, on
// a line, or a clip that plays in the Storyboard.
export function takeUse(ws: Workspace, projectId: string): { cleanable: (t: Take) => boolean } {
  const { root } = songFolder(ws, projectId);
  const recipeFile = songPathsById(ws, projectId).recipe;
  const anchors = recipeFile ? (readRecipe(recipeFile).anchors ?? []) : [];
  const edits = readClipEdits(root);
  const onALine = (clip: string) => anchors.some((a) => a.clip.toLowerCase() === clip.toLowerCase());
  return {
    cleanable: (t) => {
      if (t.status === "running") return false;
      if (t.status === "failed") return true;
      if (t.status === "interrupted") return !t.request_id;
      const sent = t.sent ?? t.clip;
      if (!sent) return true;
      if (onALine(sent)) return false;
      return t.kind === "lipsync" && isOmitted(edits, sent);
    },
  };
}

// Clean up (ns null: every take Clean up may put aside) or Remove one take (ns [n]): the takes move to removedTakes and
// their files to pictures\takes\_removed\. A take that is in use, on a line, playing in the Storyboard, being made or
// still collectable is refused in plain words. Its Storyboard clip, if any (on Omit), stays as it is.
export function removeTakes(ws: Workspace, projectId: string, file: unknown, ns: number[] | null): { removed: number[] } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  if (!rec) throw new Error(`No ${name} in this song's Creation space.`);
  const use = takeUse(ws, projectId);
  const wanted = ns ?? rec.takes.filter((t) => use.cleanable(t)).map((t) => t.n);
  for (const n of wanted) {
    const t = rec.takes.find((x) => x.n === n);
    if (!t) throw new Error(`No take ${n} of ${name}.`);
    if (!use.cleanable(t)) throw new Error(`${t.label ?? `Take ${n}`} is ${t.status === "running" ? "being made" : t.status === "interrupted" ? "still to collect (Get result)" : "in use, on a line or in your Storyboard"}: it stays.`);
  }
  const removedDir = path.join(dir, TAKES_DIR, "_removed");
  const now = new Date().toISOString();
  update(dir, name, (p) => {
    for (const n of wanted) {
      const i = p.takes.findIndex((x) => x.n === n);
      if (i < 0) continue;
      const [t] = p.takes.splice(i, 1);
      let moved = t.file;
      if (t.file && existsSync(path.join(dir, t.file))) {
        mkdirSync(removedDir, { recursive: true });
        const target = uniqueFileName(removedDir, path.basename(t.file));
        renameSync(path.join(dir, t.file), path.join(removedDir, target));
        moved = `${TAKES_DIR}/_removed/${target}`;
      }
      (p.removedTakes ??= []).push({ ...t, ...(moved ? { file: moved } : {}), removed_at: now, cleared: true });
    }
  });
  return { removed: wanted };
}

// Restore: the take is back on its card (its file back in pictures\takes\), as it was.
export function restoreTake(ws: Workspace, projectId: string, file: unknown, n: unknown): { restored: number } {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const num = Number(n);
  const t = readPictures(dir).pictures[name]?.removedTakes?.find((x) => x.n === num);
  if (!t) throw new Error(`No removed take ${n} of ${name}.`);
  update(dir, name, (p) => {
    p.removedTakes = (p.removedTakes ?? []).filter((x) => x.n !== num);
    if (!p.removedTakes.length) delete p.removedTakes;
    const { removed_at: _gone, ...back } = t;
    void _gone;
    if (t.file && existsSync(path.join(dir, t.file))) {
      const target = uniqueFileName(path.join(dir, TAKES_DIR), path.basename(t.file));
      renameSync(path.join(dir, t.file), path.join(dir, TAKES_DIR, target));
      back.file = `${TAKES_DIR}/${target}`;
    }
    p.takes.push(back);
    p.takes.sort((a, b) => a.n - b.n);
  });
  return { restored: num };
}
