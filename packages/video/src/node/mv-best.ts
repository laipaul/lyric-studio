// Best shot for each line across music videos (27 Nov 2026): the candidates of every music video of the song, the
// lines Paul set himself, the plan (src/mv-best.ts) and "Use the best for every line". Nothing is sent anywhere:
// every shot is cut out of videos already in Creation and checked locally (Takes QA), then placed like any singing take.
import { existsSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import { linesOfShot, mvResolution } from "../music-video";
import { faceBadWhileSung, pickBestShots, scoreCandidate, type BestCandidate, type BestLine, type BestRow, type ScoredCandidate } from "../mv-best";
import { readPictures, setTake, songFolder, type Take } from "./animate";
import { clearOverlapping, cutShotTake, mvRefPicture } from "./music-video";
import { readRecipe } from "./recipe";
import { placeSingingTake, singerContext, singingTakeInUse } from "./singer";
import { songPathsById } from "./song-folder";

export type BestView = {
  videos: { file: string; label: string; url: string; offsetMs: number }[]; // the music videos found in the song (url: pictures/<file>, for /api/files)
  rows: BestRow[];
  candidates: ScoredCandidate[]; // every singing shot of every music video, scored (Lyrics Sync shows each line's)
  locked: Record<number, "own" | "hand">; // the lines Paul set himself
  unchecked: number; // candidates not cut out or face-checked yet (Use the best does it first, locally)
  toPlace: number; // picks not on their lines yet
};

type Gathered = { lines: BestLine[]; candidates: BestCandidate[]; locked: Map<number, "own" | "hand">; videos: BestView["videos"]; unchecked: number };

async function gather(ws: Workspace, projectId: string): Promise<Gathered | null> {
  const { dir } = songFolder(ws, projectId);
  const all = readPictures(dir).pictures;
  const videos = Object.entries(all).filter(([, r]) => r.mv?.matched && r.mv.shots.length);
  if (!videos.length) return null;
  const c = await singerContext(ws, projectId).catch(() => null);
  const lines: BestLine[] = (c?.lines ?? []).map((l) => ({ number: l.number, text: l.text, shownMs: l.shownMs, sungEndMs: l.sungEndMs }));
  if (!lines.length) return null;
  const candidates: BestCandidate[] = [];
  const mvClips = new Map<string, Take>();
  let unchecked = 0;
  for (const [file, rec] of videos) {
    const mv = rec.mv!;
    for (const t of rec.takes) if (t.mvShot !== undefined && t.sent) mvClips.set(t.sent.toLowerCase(), t);
    mv.shots.forEach((s, i) => {
      const l = linesOfShot(s, mv.offsetMs, lines);
      if (!l) return;
      const mine = rec.takes.filter((t) => t.mvShot === i && t.kind === "lipsync" && t.status === "done" && t.file && existsSync(path.join(dir, t.file)));
      const draft = mine.find((t) => t.finalOf === undefined);
      const final = [...mine].reverse().find((t) => t.finalOf !== undefined);
      const take = final ?? draft;
      const qa = take?.qa && !take.qa.note ? take.qa : draft?.qa && !draft.qa.note ? draft.qa : null;
      if (!take || !take.qa) unchecked++;
      const sung = lines.filter((x) => x.number >= l.first && x.number <= l.last);
      candidates.push({
        video: file,
        label: rec.label ?? file.replace(/\.[^.]+$/, ""),
        shot: i,
        first: l.first,
        last: l.last,
        songFromMs: Math.round(s.fromMs + mv.offsetMs),
        songToMs: Math.round(s.toMs + mv.offsetMs),
        resolution: final ? "1080p" : mvResolution(mv.height, mv.width),
        match: mv.score,
        faceBadMs: qa && take?.sync_ms !== undefined ? faceBadWhileSung(qa.segments, take.sync_ms, sung) : null,
        sim: qa?.sim ?? null,
        take: take?.n ?? null,
        inUse: mine.some((t) => singingTakeInUse(ws, projectId, t)),
      });
    });
  }
  // The lines Paul set himself: a singing take on its lines (Lyrics Sync) or a music-video shot he picked. A story clip
  // shown on a line (no singing) gives way to the best singing shot (27 Nov 2026, Paul: "Yes, replace them"); it stays
  // in the Storyboard.
  const locked = new Map<number, "own" | "hand">();
  for (const a of readRecipe(songPathsById(ws, projectId).recipe).anchors ?? []) {
    const t = mvClips.get(a.clip.toLowerCase());
    if (t && !t.handPicked) continue;
    if (!t && a.sync === undefined) continue;
    for (let n = a.line; n <= (a.through ?? a.line); n++) locked.set(n, t ? "hand" : "own");
  }
  return { lines, candidates, locked, videos: videos.map(([file, r]) => ({ file, label: r.label ?? file.replace(/\.[^.]+$/, ""), url: `${path.relative(ws.dir, dir).split(path.sep).join("/")}/${file}`, offsetMs: r.mv!.offsetMs })), unchecked };
}

// The plan for Creation's "Best shot for each line" (null: no music video found in the song, or no timed lines).
export async function bestShotsView(ws: Workspace, projectId: string): Promise<BestView | null> {
  const g = await gather(ws, projectId);
  if (!g) return null;
  const rows = pickBestShots(g.lines, g.candidates, g.locked);
  return { videos: g.videos, rows, candidates: g.candidates.map((c) => scoreCandidate(c, g.lines)), locked: Object.fromEntries(g.locked), unchecked: g.unchecked, toPlace: rows.filter((r) => r.pick && !r.pick.inUse).length };
}

// "Use the best for every line": every singing shot cut out and face-checked (local, free), then the best of each line
// placed on its lines (in time with the song). Lines Paul set himself stay as they are.
export async function useBestShots(ws: Workspace, projectId: string, face?: import("./characters/face").FaceTool): Promise<{ placed: number; kept: number; rows: number }> {
  const { dir } = songFolder(ws, projectId);
  const g = await gather(ws, projectId);
  if (!g) throw new Error("No music video of this song in Creation yet (or the lyrics are not timed).");
  const { checkTake } = await import("./take-qa");
  const tool = face ?? (await import("./characters/jobs")).cardFace();
  for (const v of g.videos) {
    const ref = mvRefPicture(dir, v.file) ?? undefined;
    for (const c of g.candidates.filter((x) => x.video === v.file)) {
      const t = await cutShotTake(ws, projectId, v.file, c.shot);
      const draft = t.finalOf !== undefined ? readPictures(dir).pictures[v.file]?.takes.find((x) => x.n === t.finalOf) : t;
      if (draft && !draft.qa) await checkTake(dir, v.file, draft.n, tool, ref);
    }
  }
  const view = await bestShotsView(ws, projectId);
  let placed = 0;
  let kept = 0;
  for (const r of view?.rows ?? []) {
    const p = r.pick;
    if (!p || p.take === null) continue;
    if (p.inUse) {
      kept++;
      continue;
    }
    clearOverlapping(ws, projectId, p.first);
    await placeSingingTake(ws, projectId, p.video, p.take);
    setTake(dir, p.video, p.take, { handPicked: undefined });
    placed++;
  }
  return { placed, kept, rows: view?.rows.length ?? 0 };
}
