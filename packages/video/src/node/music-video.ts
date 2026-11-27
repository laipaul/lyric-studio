// A music video made elsewhere, in Creation (27 Nov 2026, Paul: WaveSpeed's Music Video Generator made "the same bride
// singing in different scenes and camera angles", lips in time with the song). "This is a music video of this song":
//   1. its sound is matched against the song file (both only read): where in the song it starts, to the sample;
//   2. its shots are found (FFmpeg's scene score; the generator's short crossfades);
//   3. each shot shows the lines it carries; "Use on its lines" cuts that shot out (without sound) as a singing take
//      of the video and places it on its lines locked to the song, exactly like a Lyrics Sync singing take (anchors with
//      "sync"); a shot with no sung line goes to the Storyboard as a story clip.
// Saved in pictures.json on the video (mv: MusicVideoRecord); each shot used is a take (mvShot = its number).
// The video's own sound is never kept in any take, clip or output: the video's audio stays the song, as always.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { ffmpegBin, probeMedia, uniqueFileName, type Workspace } from "@lyric/db";

import { detectCuts, findInSong, linesOfShot, MATCH_MIN, DRIFT_MAX_MS, MV_MODEL, mvResolution, mvUsd, shotPiece, shotsFromCuts, type MusicVideoRecord, type MvView } from "../music-video";
import { BOARD_VIDEO_FILE, nextTakeN, readPictures, sendToStoryboard, songFolder, TAKES_DIR, update, type PicturesView, type Take } from "./animate";
import { placeSingingTake, singerContext, singingTakeInUse } from "./singer";

export const MV_RATE = 8000; // Hz: enough to line two copies of the same recording up to 1/8000 s

// Mono samples of a file's sound (FFmpeg decodes; the file is only read).
export function decodeMono(file: string, rate = MV_RATE): Float32Array {
  const buf = execFileSync(ffmpegBin(), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30, windowsHide: true });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// FFmpeg's scene-change score of every frame (small frames: quick).
export function sceneScores(file: string): { t: number; score: number }[] {
  const r = spawnSync(ffmpegBin(), ["-v", "error", "-i", file, "-an", "-vf", "scale=160:90,select='gte(scene,0)',metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true });
  if (r.status !== 0) throw new Error(`FFmpeg could not read the video's frames: ${(r.stderr || "").trim().slice(0, 200)}`);
  const out: { t: number; score: number }[] = [];
  let t: number | null = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    const pt = /pts_time:([\d.]+)/.exec(line);
    if (pt) t = Number(pt[1]);
    const sc = /scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) {
      out.push({ t, score: Number(sc[1]) });
      t = null;
    }
  }
  return out;
}

// "This is a music video of this song": matched, its shots found, saved on the video. Read-only on the song.
export async function analyseMusicVideo(ws: Workspace, projectId: string, file: unknown): Promise<MusicVideoRecord> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  if (!name || !BOARD_VIDEO_FILE.test(name) || !existsSync(path.join(dir, name))) throw new Error(`No video ${String(file)} in this song's Creation space.`);
  const c = await singerContext(ws, projectId);
  if (!existsSync(c.songFile)) throw new Error("The song file is missing from the song folder.");
  const info = await probeMedia(path.join(dir, name));
  if (!info.hasAudio) throw new Error("This video has no sound, so the app cannot tell where it sits in the song. Use the video WaveSpeed gave you as it came (with its sound).");
  const found = findInSong(decodeMono(path.join(dir, name)), decodeMono(c.songFile), MV_RATE);
  const matched = found.score >= MATCH_MIN && found.driftMs <= DRIFT_MAX_MS;
  const shots = matched ? shotsFromCuts(detectCuts(sceneScores(path.join(dir, name))), info.durationMs) : [];
  const rec: MusicVideoRecord = { at: new Date().toISOString(), matched, score: found.score, offsetMs: found.offsetMs, driftMs: found.driftMs, durationMs: info.durationMs, width: info.width, height: info.height, usd: mvUsd(info.durationMs, info.height, info.width), shots };
  update(dir, name, (p) => {
    p.mv = rec;
    if (!p.source) p.source = "WaveSpeed music video";
  });
  return rec;
}

// The video's shots with their lines and takes, for Creation.
export async function withMusicVideos(ws: Workspace, projectId: string, view: PicturesView): Promise<PicturesView> {
  const { dir } = songFolder(ws, projectId);
  const all = readPictures(dir).pictures;
  if (!view.pictures.some((p) => all[p.file]?.mv)) return view;
  const lines = (await singerContext(ws, projectId).catch(() => null))?.lines ?? [];
  return {
    ...view,
    pictures: view.pictures.map((p) => {
      const rec = all[p.file];
      return rec?.mv ? { ...p, mv: mvView(ws, projectId, rec.mv, rec.takes, lines) } : p;
    }),
  };
}

function mvView(ws: Workspace, projectId: string, mv: MusicVideoRecord, takes: readonly Take[], lines: readonly { number: number; text: string; shownMs: number }[]): MvView {
  const shots = mv.shots.map((s, i) => {
    const l = linesOfShot(s, mv.offsetMs, lines);
    const t = [...takes].reverse().find((x) => x.mvShot === i && x.status === "done");
    const sent = t ? (t.sent ?? t.clip ?? null) : null;
    return {
      ...s,
      i,
      songFromMs: Math.round(s.fromMs + mv.offsetMs),
      songToMs: Math.round(s.toMs + mv.offsetMs),
      first: l?.first ?? null,
      last: l?.last ?? null,
      text: l ? (lines.find((x) => x.number === l.first)?.text ?? null) : null,
      take: t?.n ?? null,
      inUse: !!t && (t.kind === "lipsync" ? singingTakeInUse(ws, projectId, t) : !!sent),
      sent,
    };
  });
  return { ...mv, shots, singing: shots.filter((s) => s.first !== null).length };
}

// "Use on its lines" (a shot that carries sung lines): cut out as a singing take of the video and placed on its lines,
// locked to the song. A shot without a sung line: Send to Storyboard (a story clip). A shot cut before stays one take.
export async function useMusicVideoShot(ws: Workspace, projectId: string, file: unknown, shot: unknown): Promise<{ n: number; placed: "lines" | "storyboard"; first: number | null; last: number | null; clip: string }> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const rec = readPictures(dir).pictures[name];
  const mv = rec?.mv;
  if (!mv?.matched) throw new Error("Check it first: This is a music video of this song.");
  const i = Number(shot);
  const s = mv.shots[i];
  if (!s) throw new Error("No such shot.");
  const c = await singerContext(ws, projectId);
  const l = linesOfShot(s, mv.offsetMs, c.lines ?? []);
  const lastLine = l ? (c.lines ?? []).find((x) => x.number === l.last) : undefined;
  const piece = shotPiece(s, mv.offsetMs, mv.durationMs, lastLine ? lastLine.sungEndMs : null);
  let t = rec.takes.find((x) => x.mvShot === i && x.status === "done" && x.file && existsSync(path.join(dir, x.file)));
  if (!t) {
    mkdirSync(path.join(dir, TAKES_DIR), { recursive: true });
    const base = name.replace(/\.[^.]+$/, "");
    const out = uniqueFileName(path.join(dir, TAKES_DIR), `${base} shot ${i + 1}.mp4`);
    // Cut exactly (re-encoded), without its sound: the video's audio stays the song.
    execFileSync(ffmpegBin(), ["-y", "-v", "error", "-ss", (piece.fromMs / 1000).toFixed(3), "-i", path.join(dir, name), "-t", ((piece.toMs - piece.fromMs) / 1000).toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(dir, TAKES_DIR, out)], { windowsHide: true });
    const now = new Date().toISOString();
    update(dir, name, (p) => {
      const take: Take = {
        n: nextTakeN(p),
        service: "wavespeed",
        quality: "standard",
        model: MV_MODEL,
        status: "done",
        started_at: now,
        ended_at: now,
        cost_usd: 0, // the video's cost is on the video (mv.usd), once
        file: `${TAKES_DIR}/${out}`,
        seconds: Math.round((piece.toMs - piece.fromMs) / 100) / 10,
        label: `Shot ${i + 1}`,
        playable: true,
        mvShot: i,
        resolution: mvResolution(mv.height, mv.width),
        ...(l ? { kind: "lipsync" as const, line: l.first, ...(l.last > l.first ? { through: l.last } : {}), sync_ms: Math.round(mv.offsetMs + piece.fromMs), to_ms: Math.round(mv.offsetMs + piece.toMs), voice: "song" as const } : {}),
      };
      p.takes.push(take);
      t = take;
    });
  }
  const take = t!;
  if (take.kind === "lipsync") {
    await placeSingingTake(ws, projectId, name, take.n);
    const placed = readPictures(dir).pictures[name]?.takes.find((x) => x.n === take.n);
    return { n: take.n, placed: "lines", first: take.line ?? null, last: take.through ?? take.line ?? null, clip: placed?.sent ?? "" };
  }
  const r = await sendToStoryboard(ws, projectId, name, take.n);
  return { n: take.n, placed: "storyboard", first: null, last: null, clip: r.clip };
}

// "Use every singing shot": each shot that carries sung lines, on its lines.
export async function useAllMusicVideoShots(ws: Workspace, projectId: string, file: unknown): Promise<{ used: number[] }> {
  const { dir } = songFolder(ws, projectId);
  const name = path.basename(String(file ?? ""));
  const mv = readPictures(dir).pictures[name]?.mv;
  if (!mv?.matched) throw new Error("Check it first: This is a music video of this song.");
  const lines = (await singerContext(ws, projectId)).lines ?? [];
  const used: number[] = [];
  for (let i = 0; i < mv.shots.length; i++) {
    if (!linesOfShot(mv.shots[i], mv.offsetMs, lines)) continue;
    await useMusicVideoShot(ws, projectId, name, i);
    used.push(i);
  }
  return { used };
}

// The face check (Takes QA, local and free) of each singing shot used that has none yet. Never throws.
export async function checkMusicVideoShots(openWs: () => Workspace, projectId: string, file: string): Promise<void> {
  try {
    const ws = openWs();
    const { dir } = songFolder(ws, projectId);
    const { checkTake } = await import("./take-qa");
    const { cardFace } = await import("./characters/jobs");
    const face = cardFace();
    for (const t of readPictures(dir).pictures[file]?.takes ?? []) if (t.mvShot !== undefined && t.kind === "lipsync" && t.status === "done" && !t.qa) await checkTake(dir, file, t.n, face);
  } catch {
    // the check is extra: the shots are placed already
  }
}
