// Best shot for each line across music videos (27 Nov 2026, Paul: "yes"). Several music videos of the same stretch of
// the song (WaveSpeed's Music Video Generator, from other pictures or words) give each sung line several shots. The
// app picks, for each line, the shot that serves it best, in plain words, and Paul can swap any line to another shot.
// What counts (only what the app already measures; how good the lips look is not measured):
//   - the face: the face check (Takes QA) of the shot, no bad stretch while its lines are sung, and how close the face
//     stays to the picture it was made from;
//   - the whole line in one shot (the generator did not cut before the line is sung to its end), with room before
//     and after;
//   - its size (a 1080p final over 720p over 480p) and how well the video's sound matches the song;
//   - variety: the next line from another video when it is as good, so the angles change.
// Lines Paul set himself (a Lyrics Sync take, a story anchor, a music-video shot he picked by hand) are never touched.
// Pure: the node side (node/mv-best.ts) gathers the candidates.

export type BestLine = { number: number; text: string; shownMs: number; sungEndMs: number };
export type BestCandidate = {
  video: string; // the music video's file in Creation
  label: string; // its name on screen
  shot: number; // 0-based in its mv.shots
  first: number;
  last: number;
  songFromMs: number; // the shot on screen, song time
  songToMs: number;
  resolution: "480p" | "720p" | "1080p";
  match: number; // the video's sound against the song, 0-1
  faceBadMs: number | null; // ms of a bad face (Takes QA) while its lines are sung; null: not checked
  sim: number | null; // the face's median likeness to the picture it was made from (SFace cosine); null: not checked
  take: number | null; // its take (the shot cut out), once cut
  inUse: boolean; // on its lines now
};
export type ScoredCandidate = BestCandidate & { score: number; reasons: string[] };
export type BestRow = {
  first: number;
  last: number;
  text: string;
  pick: ScoredCandidate | null; // null: a line Paul set himself (locked)
  others: ScoredCandidate[]; // the other shots for its first line, best first
  locked: "own" | "hand" | null; // own: a take or clip Paul set on it; hand: a music-video shot he picked
};

export const VARIETY_PENALTY = 1.5; // the same video as the line before costs this much
export const ROOM_MS = 1000; // room before and after the line counts up to this

const RES_POINTS = { "1080p": 2, "720p": 1, "480p": 0 } as const;

// A candidate's score and its plain words (the strongest reasons first).
export function scoreCandidate(c: BestCandidate, lines: readonly BestLine[]): ScoredCandidate {
  const firstLine = lines.find((l) => l.number === c.first);
  const lastLine = lines.find((l) => l.number === c.last);
  const reasons: string[] = [];
  let score = 0;
  if (c.faceBadMs !== null) {
    if (c.faceBadMs > 0) {
      score -= 10;
      reasons.push("the face goes wrong while she sings");
    } else {
      score += 3;
      reasons.push("same face all along");
    }
  }
  if (c.sim !== null && c.sim >= 0.5) {
    score += 1;
    reasons.push("close to your picture");
  }
  const whole = !!lastLine && lastLine.sungEndMs <= c.songToMs;
  if (whole) {
    score += 3;
    reasons.push(c.last > c.first ? "the lines in one shot" : "the whole line in one shot");
  } else {
    score -= 2;
    reasons.push("its cut comes before the line ends");
  }
  const before = firstLine ? firstLine.shownMs - c.songFromMs : 0;
  const after = lastLine ? c.songToMs - lastLine.sungEndMs : 0;
  const room = Math.max(0, Math.min(before, after, ROOM_MS));
  score += (2 * room) / ROOM_MS;
  if (room >= ROOM_MS / 2) reasons.push("room before and after");
  score += RES_POINTS[c.resolution];
  if (c.resolution === "1080p") reasons.push("1080p");
  if (c.match < 0.95) score -= 1;
  return { ...c, score: Math.round(score * 100) / 100, reasons };
}

const better = (a: ScoredCandidate, b: ScoredCandidate) => b.score - a.score || a.video.localeCompare(b.video) || a.shot - b.shot;

// The plan: line by line, the best shot whose lines are all free (not locked, not taken by a shot picked before it),
// with the variety rule against the shot picked just before. Deterministic (ties: the video's name, then the shot).
export function pickBestShots(lines: readonly BestLine[], candidates: readonly BestCandidate[], locked: ReadonlyMap<number, "own" | "hand">): BestRow[] {
  const sorted = [...lines].sort((a, b) => a.number - b.number);
  const numbers = new Set(sorted.map((l) => l.number));
  const scored = candidates.map((c) => scoreCandidate(c, sorted));
  const taken = new Set<number>(locked.keys());
  const rows: BestRow[] = [];
  let prev: ScoredCandidate | null = null;
  const textOf = (n: number) => sorted.find((l) => l.number === n)?.text ?? "";
  for (const l of sorted) {
    const n = l.number;
    const lock = locked.get(n);
    if (lock) {
      if (scored.some((c) => c.first <= n && n <= c.last)) {
        const others = scored.filter((c) => c.first <= n && n <= c.last).sort(better);
        const last = rows[rows.length - 1];
        if (last && last.pick === null && last.locked === lock && last.last === n - 1) last.last = n;
        else rows.push({ first: n, last: n, text: textOf(n), pick: null, others, locked: lock });
      }
      prev = null;
      continue;
    }
    if (taken.has(n)) continue;
    const free = (c: ScoredCandidate) => {
      for (let k = c.first; k <= c.last; k++) if (numbers.has(k) && taken.has(k)) return false;
      return true;
    };
    const options = scored.filter((c) => c.first <= n && n <= c.last && free(c));
    if (!options.length) continue;
    const p: ScoredCandidate | null = prev;
    const adjusted: ScoredCandidate[] = options
      .map((c): ScoredCandidate => (p && c.video === p.video ? { ...c, score: Math.round((c.score - VARIETY_PENALTY) * 100) / 100 } : { ...c, reasons: p && c.video !== p.video && options.some((o) => o.video === p.video) ? [...c.reasons, "another video than the line before"] : c.reasons }))
      .sort(better);
    const pick: ScoredCandidate = adjusted[0];
    for (let k = pick.first; k <= pick.last; k++) taken.add(k);
    rows.push({ first: pick.first, last: pick.last, text: textOf(pick.first), pick, others: adjusted.slice(1), locked: null });
    prev = pick;
  }
  return rows;
}

// Bad-face ms (Takes QA segments, in seconds of the take) while the lines are sung (song ms); the take starts at syncMs.
export function faceBadWhileSung(segments: readonly { fromS: number; toS: number }[], syncMs: number, lines: readonly { shownMs: number; sungEndMs: number }[]): number {
  let bad = 0;
  for (const s of segments) {
    const a = syncMs + s.fromS * 1000;
    const b = syncMs + s.toS * 1000;
    for (const l of lines) bad += Math.max(0, Math.min(b, l.sungEndMs) - Math.max(a, l.shownMs));
  }
  return Math.round(bad);
}
