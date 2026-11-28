// Story anchors (song.json "anchors": [{ line: 9, clip: "hands.mp4", clipIn?: 1.5, transition?: "dissolve" }]):
// a clip that lands on one lyric line (its number in the Lyrics tab: sung lines counted, blank lines
// not, as in check-start and hints.lrc; a repeated chorus line can land on another clip each time).
//   Cut:   on the downbeat at or just before the line's on-screen time (earlyCutFrames before it, as
//          every cut), held until at least the line's sung end; the next cut is the first regular cut
//          after that. Anchors win over the regular cut rate; regular cuts fill the gaps.
//   Never dropped silently: an anchor that cannot be placed (too close to another, too near the end of
//          the section) says why; anchors outside a platform's section are listed as such.
//   Dissolve: ~1 bar centred on the downbeat (less when a neighbouring shot is short).
//   Lip sync ("sync", 21 Nov 2026): a singing clip made for this moment of the song (Lyrics Sync → Singer): its first
//          frame belongs at song second `sync`. It cuts in on the downbeat (never before its footage starts), plays
//          at exactly normal speed from the frame that matches the song at the cut, always with a hard cut, and is
//          never used to fill other shots: the lips stay in time with the song. The V2 → V1 change (tracks.ts V2_V1_CHANGE,
//          28 Nov 2026): it cuts in ~0.4 s BEFORE the line's sung start when its footage allows (the singer's breath in), and the
//          B-roll before fades out over that, ending on a beat: the cut is then placed 0.4 s before a beat; the first 2 frames of
//          a generated take are never shown (never before footage + 2 frames); it stays ~0.3 s after the line's sung end. `through`: one continuous singing take
//          over lines `line`..`through` (lines in a row with the same singer picture): it stays on screen until the last
//          of them is sung.
// Pure: pnpm make, the preview and the Lyrics tab use the same rules.
import type { Beat } from "./beats";
import { cutPointAt, type CutPlan, type CutPoint } from "./cuts";
import { v2v1Frames } from "./tracks";

export type AnchorTransition = "cut" | "dissolve";
// hide (singing clips only, Paul 22 Nov 2026: "6 to 8 s the lips are not in sync"): moments of the take covered by another
// clip: from / to in seconds of the take, clip shown meanwhile (clipIn: from where in it). The song plays on; the singer
// comes back in time.
export type HideSpec = { from: number; to: number; clip: string; clipIn?: number };
export type AnchorSpec = { line: number; clip: string; clipIn?: number; transition?: AnchorTransition; sync?: number; through?: number; hide?: HideSpec[] }; // song.json (sync: song seconds of the clip's first frame; through: the last line a singing take covers)
export type GapOrder = "story" | "shuffle";

// An anchor whose clip was found; `lyric` is the line's index in the render's lyric list.
export type ResolvedHide = { fromMs: number; toMs: number; clipId: string; clipName: string; clipInMs: number | null }; // song ms
export type ResolvedAnchor = { line: number; text: string; lyric: number; clipId: string; clipName: string; clipInMs: number | null; transition: AnchorTransition; syncMs?: number | null; footageFrames?: number; throughLyric?: number | null; hides?: ResolvedHide[] }; // footageFrames: a singing clip's length in frames (its footage lasts from syncMs to syncMs + this) // throughLyric: a singing take over several lines, the last one's index

export type AnchorUse = {
  line: number;
  text: string;
  clip: string;
  used: boolean;
  shot: number | null; // 0-based shot index in the video
  at_ms: number | null; // song time where its shot starts
  transition: AnchorTransition;
  why: string | null; // not used: why; used: how (e.g. "on the beat at 0:41.5: the bar is taken by line 8")
  playback_rate?: number; // < 1: slowed to cover its line (QA WARN)
  lipsync?: boolean; // a singing clip locked to the song (always in time)
  lead_in_ms?: number; // a singing clip: how long before the line's sung start it is on screen (the breath in; V2 → V1 change)
};

export type AnchorPlan = {
  plan: CutPlan; // the regular cuts with the anchor cuts merged in
  shots: Map<number, ResolvedAnchor>; // shot index -> anchor
  uses: AnchorUse[];
  conflicts: string[]; // QA WARN, naming the lines
  notes: string[];
  // Singing shots that end at their footage end (song frames of those cuts) and which of them the next B-roll shot covers by
  // starting there itself (the regular cut after the singer's old end is gone: the same clip, entering earlier). The others
  // (`footCuts` without `joined`) leave a shot of their own, which the caller fills (compose.ts).
  footCuts?: number[];
  joined?: number[];
};

export const SINGER_HOLD_MAX_FRAMES = 6; // a singer may hold its last frame this long (0.2 s) when the next singer follows right after
export const ANCHOR_REPEAT_MS = 8000; // the same clip anchored twice this close: the repeat is visible
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const lineName = (a: { line: number; text: string }) => `line ${a.line} "${a.text}"`;

export type AnchorLine = { startFrame: number; endFrame: number; sungEndFrame?: number; stampFrame?: number }; // section-relative (lyricFrames); stampFrame: its first sung word

// Places the anchors in a section's cut plan. `beats`: the song's beats (downbeat offset applied);
// `lines[a.lyric]`: each anchored line's on-screen frames relative to the section.
export function planAnchors(
  plan: CutPlan,
  beats: readonly Beat[],
  anchors: readonly ResolvedAnchor[],
  lines: readonly AnchorLine[],
  // singerFade: the soft entry is on (a singing clip is cut in 0.4 s before a beat, so the B-roll fade ends on it); noFade:
  // the singing clips whose own choice says cut (clip ids): their cut stays on the beat.
  // keepFoot: footage-end cuts (song frames) whose following regular cut stays: no merging into the next B-roll shot (compose.ts asks
  // for that when the next clip has no footage to enter earlier).
  o: { earlyCutFrames?: number; minShotFrames?: number; singerFade?: boolean; noFade?: ReadonlySet<string>; keepFoot?: ReadonlySet<number> } = {},
): AnchorPlan {
  const fps = plan.fps;
  const early = o.earlyCutFrames ?? 2;
  const minShot = o.minShotFrames ?? Math.ceil(0.8 * fps);
  const start = plan.start_frame;
  const end = plan.end_frame;
  const msOf = (frame: number) => Math.round((frame * 1000) / fps);
  const uses: AnchorUse[] = [];
  const conflicts: string[] = [];
  const notes: string[] = [];
  const base = (a: ResolvedAnchor) => ({ line: a.line, text: a.text, clip: a.clipName, transition: a.syncMs != null ? ("cut" as const) : a.transition, ...(a.syncMs != null ? { lipsync: true } : {}) });

  const F = v2v1Frames(fps);
  type Placed = { a: ResolvedAnchor; cut: CutPoint | null; frame: number; hold: number; release: number; use: AnchorUse; sungAt: number };
  const placed: Placed[] = [];
  const byTime = [...anchors].sort((x, y) => (lines[x.lyric]?.startFrame ?? 0) - (lines[y.lyric]?.startFrame ?? 0) || x.line - y.line);
  for (const a of byTime) {
    const l = lines[a.lyric];
    const last = (a.throughLyric != null ? lines[a.throughLyric] : undefined) ?? l; // a singing take over several lines: held until the last
    const duration = end - start;
    if (!l || l.startFrame >= duration || last.endFrame <= 0) {
      uses.push({ ...base(a), used: false, shot: null, at_ms: null, why: "outside this section" });
      continue;
    }
    const appear = start + Math.max(0, l.startFrame);
    // A singing clip has no footage before its first frame: no cut before it (song frames).
    // (and its first frames are never shown: a generated take may "pop" there.)
    const sing = a.syncMs != null;
    const footage = sing ? Math.ceil((a.syncMs! * fps) / 1000) + F.skip : -Infinity;
    const hold = start + Math.max(last.sungEndFrame ?? last.endFrame, Math.max(0, l.startFrame) + 1);
    const release = sing ? F.release : 0; // the note releases: the singer stays this long after the line's sung end
    const prev = placed.at(-1);
    const after = prev ? prev.frame + minShot : start + minShot;
    // The soft entry: the singer's cut sits one fade before the beat, so the B-roll's dissolve out ends ON the beat. (Not after
    // another singing clip: nothing of either is faded, and the singer never loses screen time to the fade.)
    const prevSings = prev?.a.syncMs != null;
    const fade = sing && o.singerFade && !o.noFade?.has(a.clipId) && !prevSings ? F.entryFade : 0;
    const sungAt = l.stampFrame !== undefined ? start + l.stampFrame : appear;
    const leadLimit = Math.min(appear, sungAt - F.leadIn); // the latest cut that still shows the breath in
    // Candidate cuts at or before the line's on-screen time: downbeats first, then (only when the bar is
    // taken by the previous anchor) any beat.
    const cutAt = (i: number): CutPoint => cutPointAt(beats, i, fps, early);
    const candidates = (downbeatsOnly: boolean, limit = appear) =>
      beats
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => !downbeatsOnly || b.is_downbeat)
        .map(({ i }) => cutAt(i))
        .filter((c) => c.frame <= limit && c.frame >= footage)
        .reverse();
    const bar = candidates(true)[0];
    let cut: CutPoint | null = null;
    let how: string | null = null;
    const singerLate = a.syncMs != null && !bar && !(start >= footage) ? beats.map((_, i) => cutAt(i)).find((c) => c.frame >= footage && c.frame >= after) : undefined;
    if (singerLate) {
      cut = singerLate; // the singing clip starts after the downbeat: the first beat with footage
      how = `on the beat at ${clock(singerLate.beat_time_ms)}: the singing clip starts there`;
    } else if (!prev && (!bar || bar.frame < start + minShot) && start >= footage) {
      cut = null; // the first shot of the video
      how = "from the first frame";
    } else if (bar && bar.frame >= after) {
      cut = bar;
    } else {
      const beat = candidates(false).find((c) => c.frame >= after);
      if (beat && prev) {
        cut = beat;
        how = `on the beat at ${clock(beat.beat_time_ms)}: the bar is taken by line ${prev.a.line}`;
        conflicts.push(`${lineName(a)} and line ${prev.a.line} are too close (one bar): ${lineName(a)} cuts in on the beat at ${clock(beat.beat_time_ms)} instead of the downbeat`);
      } else {
        const by = prev ? `too close to line ${prev.a.line} (anchored at ${clock(msOf(prev.frame))}): no beat left for it` : "too close to the start of this section";
        uses.push({ ...base(a), used: false, shot: null, at_ms: null, why: by });
        conflicts.push(`${lineName(a)} (${a.clipName}) is not shown: ${by}`);
        continue;
      }
    }
    if (sing && cut) {
      // The cut as it always was (the downbeat at or before the line, else the first beat with footage). Then, in this order, and
      // only ever EARLIER (the singer never loses screen time to the lead-in rule):
      //  1. lead-in: when that leaves under 0.4 s before the sung start, the latest earlier beat that gives it (footage allowing);
      //  2. the soft entry: one fade before the beat, so the B-roll's dissolve ends on the beat (footage allowing);
      //  3. after another singing clip: when that clip's footage ends before this cut (it would hold its last frame), this one
      //     cuts in as soon as its own footage allows (never before the other's last frame), in time, off the beat if need be.
      if (sungAt - cut.frame < F.leadIn) {
        const e = candidates(true, leadLimit)[0] ?? candidates(false, leadLimit)[0];
        if (e && e.frame >= after && e.frame < cut.frame) cut = e;
      }
      if (fade) {
        const shifted = Math.round((cut.beat_time_ms * fps) / 1000) - fade;
        if (shifted >= footage && shifted >= after && shifted < cut.frame) cut = { ...cut, frame: shifted, time_ms: msOf(shifted) };
      }
      const prevEnd = prevSings && prev!.a.footageFrames !== undefined ? Math.round((prev!.a.syncMs! * fps) / 1000) + prev!.a.footageFrames : undefined;
      if (prevEnd !== undefined && prevEnd < cut.frame && appear - prev!.hold <= Math.round(1.5 * fps)) { // (its line follows the other's directly: within 1.5 s of its sung end)
        const soonest = Math.max(footage, prevEnd, after);
        if (soonest < cut.frame) {
          cut = { ...cut, frame: soonest, time_ms: msOf(soonest) };
          how = `right after line ${prev!.a.line}'s singing clip ends (${clock(msOf(prevEnd))}), as soon as this clip has footage`;
        }
      }
    }
    const frame = cut ? cut.frame : start;
    if (frame > end - minShot) {
      const why = "too close to the end of this section";
      uses.push({ ...base(a), used: false, shot: null, at_ms: null, why });
      conflicts.push(`${lineName(a)} (${a.clipName}) is not shown: ${why}`);
      continue;
    }
    if (prev && prev.hold > frame) {
      conflicts.push(`line ${prev.a.line} "${prev.a.text}" (${prev.a.clipName}) cannot stay until its line ends (${clock(msOf(prev.hold))}): ${lineName(a)} cuts in at ${clock(msOf(frame))}`);
    }
    const use: AnchorUse = { ...base(a), used: true, shot: null, at_ms: msOf(frame), why: how };
    if (sing) {
      // What the viewer gets before the line: the breath in. A take whose footage starts at the line has none to show.
      const lead = Math.max(0, sungAt - frame);
      use.lead_in_ms = msOf(lead);
      if (lead < F.leadIn - 1 && prevSings) {
        notes.push(`line ${a.line}: follows line ${prev!.a.line}'s singing clip directly: this clip cuts in as soon as its own footage starts (${(lead / fps).toFixed(1)} s before the line is sung), the one before plays on until its footage ends, both in time with the song`);
      } else if (lead < F.leadIn - 1) {
        const prevLine = lines[a.lyric - 1];
        const midPhrase = !!prevLine && prevLine.sungEndFrame !== undefined && start + prevLine.sungEndFrame > frame;
        notes.push(`line ${a.line}: no breath to show before the line (the singing clip's footage starts ${(lead / fps).toFixed(1)} s before it is sung${midPhrase ? `, while line ${a.line - 1} is still being sung` : ""}): the clip before fades out over its first ${(F.entryFade / fps).toFixed(1)} s`);
      }
    }
    uses.push(use);
    placed.push({ a, cut, frame, hold: Math.max(hold, frame + minShot), release, use, sungAt });
  }

  // The same clip anchored twice close together.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const x = placed[i];
      const y = placed[j];
      if (x.a.clipId === y.a.clipId && msOf(y.frame - x.frame) < ANCHOR_REPEAT_MS) {
        conflicts.push(`lines ${x.a.line} and ${y.a.line} both land on ${x.a.clipName}, ${((y.frame - x.frame) / fps).toFixed(1)} s apart: the repeat is visible`);
      }
    }
  }

  // Regular cuts inside an anchored shot (or too close before it) give way; an anchor's shot lasts until
  // the first regular cut after its line ends (or the next anchor).
  let regular = plan.cuts.filter((c) => !placed.some((p) => c.frame > p.frame - minShot && c.frame < p.hold + p.release));
  // Hidden moments of a singing take: away to the cover clip on the beat at or before the moment, back to the singer on
  // the beat at or after it (the singer's frame is the song's: the lips are in time again). Within the take's shot.
  const hideCuts: { cut: CutPoint; a: ResolvedAnchor }[] = [];
  for (const p of placed) {
    if (p.a.syncMs == null || !p.a.hides?.length) continue;
    const next = placed.find((q) => q.frame > p.frame)?.frame ?? end;
    const last = Math.min(next, Math.max(p.hold + p.release, ...plan.cuts.filter((c) => c.frame >= p.hold + p.release).slice(0, 1).map((c) => c.frame)));
    let earliest = p.frame + minShot;
    const beatCuts = beats.map((_, i) => cutPointAt(beats, i, fps, early));
    for (const h of p.a.hides) {
      const from = Math.round((h.fromMs * fps) / 1000);
      const to = Math.round((h.toMs * fps) / 1000);
      const span = `${clock(h.fromMs - p.a.syncMs)}–${clock(h.toMs - p.a.syncMs)} of the take`;
      if (to <= p.frame || from >= last) {
        notes.push(`line ${p.a.line}: ${span} is outside this video's part of the take: nothing to hide`);
        continue;
      }
      const away = [...beatCuts].reverse().find((c) => c.frame <= from && c.frame >= earliest) ?? beatCuts.find((c) => c.frame >= earliest && c.frame < to);
      if (!away || away.frame > last - minShot) {
        conflicts.push(`line ${p.a.line}: ${span} cannot be hidden: too close to the start of the singing shot (or to another hidden moment)`);
        continue;
      }
      const back = beatCuts.find((c) => c.frame >= Math.max(to - early, away.frame + minShot)); // (cuts come `early` frames before their beat)
      const cover: ResolvedAnchor = { line: p.a.line, text: p.a.text, lyric: p.a.lyric, clipId: h.clipId, clipName: h.clipName, clipInMs: h.clipInMs, transition: "cut" };
      hideCuts.push({ cut: away, a: cover });
      if (back && back.frame <= last - minShot) {
        hideCuts.push({ cut: back, a: p.a });
        earliest = back.frame + minShot;
        notes.push(`line ${p.a.line}: ${span} hidden by ${h.clipName} (${clock(away.time_ms)}–${clock(back.time_ms)}); the singer comes back in time`);
      } else {
        earliest = last;
        notes.push(`line ${p.a.line}: ${span} hidden by ${h.clipName} from ${clock(away.time_ms)} to the end of the singing shot`);
      }
    }
  }
  // A singing shot never plays past its own footage (Paul, 28 Nov 2026: "the end of this singing video freezes"): when the
  // next cut would come after the clip's last frame, the shot ends where the footage ends instead (the next shot, the story
  // order's next B-roll, takes the rest, and dissolves in over the singer's last 0.3 s). Preferably on the latest beat at or
  // before the footage end that still covers the line's sung end plus its release; else exactly at the footage end, off the
  // beat. A footage that ends before the sung end says what would fix it (a longer take); no frame is held either way.
  const beatCuts = beats.map((_, i) => cutPointAt(beats, i, fps, early));
  const footCuts: CutPoint[] = [];
  const joinAt = new Set<number>(); // regular cuts that go: the B-roll shot after them starts at the singer's footage end instead
  const joined: number[] = [];
  const allFrames = [...regular.map((c) => c.frame), ...placed.map((p) => p.frame), ...hideCuts.map((h) => h.cut.frame)].sort((x, y) => x - y);
  for (const p of placed) {
    if (p.a.syncMs == null || p.a.footageFrames === undefined) continue;
    const footEnd = Math.round((p.a.syncMs * fps) / 1000) + p.a.footageFrames;
    const segments = [p.frame, ...hideCuts.filter((h) => h.a === p.a).map((h) => h.cut.frame)];
    for (const s of segments) {
      const natural = allFrames.find((f) => f > s) ?? end;
      if (natural <= footEnd || s >= footEnd) continue;
      // The next singing clip follows within HOLD_MAX_FRAMES of this one's last frame (e.g. two shots of one music video on
      // consecutive lines, trimmed apart): no flash of B-roll between two singers; this one holds its last frame until the
      // next singer's cut (at most 0.2 s), with a note.
      const nextSinger = placed.find((q) => q.frame === natural && q.a.syncMs != null);
      if (nextSinger && natural - footEnd <= SINGER_HOLD_MAX_FRAMES) {
        notes.push(`line ${p.a.line}: line ${nextSinger.a.line}'s singing clip starts ${((natural - footEnd) / fps).toFixed(1)} s after this one's last frame: that frame is held until then, both in time with the song`);
        continue;
      }
      const need = Math.max(p.hold + p.release, s + minShot);
      const onBeat = beatCuts.filter((c) => c.frame <= footEnd && c.frame >= need).at(-1);
      const frame = onBeat ? onBeat.frame : Math.max(footEnd, s + 1);
      const mid = beatCuts.find((c) => c.frame === frame);
      footCuts.push(mid ?? { frame, time_ms: msOf(frame), beat_index: 0, beat_time_ms: msOf(frame), bar: 0, beat_in_bar: 0 });
      // The time this frees belongs to the B-roll that follows (Paul, 28 Nov 2026: the story order and where his clips fall on the
      // lyrics are his): that shot enters at the footage end, the same clip, so every later clip stays on its line.
      if (natural < end && frame < natural && !o.keepFoot?.has(frame) && !hideCuts.some((h) => h.cut.frame === natural)) {
        const next = placed.find((q) => q.frame === natural);
        if (!next && regular.some((c) => c.frame === natural)) {
          joinAt.add(natural);
          joined.push(frame);
        } else if (next && next.a.syncMs == null) {
          // The next shot is a story anchor (Paul, 28 Nov 2026: "line 17: the next clip in my order is Worried Girl, anchored on
          // line 19"): that clip starts at the footage end instead (an anchor may start before its line), so no other clip fills
          // the time and none after it moves. It keeps its line: it still holds until that line is sung.
          const was = next.frame;
          next.frame = frame;
          next.cut = mid ?? { frame, time_ms: msOf(frame), beat_index: 0, beat_time_ms: msOf(frame), bar: 0, beat_in_bar: 0 };
          next.use.at_ms = msOf(frame);
          next.use.why = `${next.use.why ? `${next.use.why}; ` : ""}starts ${((was - frame) / fps).toFixed(1)} s early, at ${clock(msOf(frame))}, where line ${p.a.line}'s singing clip ends: no other clip of your story fills that time`;
          joined.push(frame);
        }
      }
      const covered = footEnd - p.sungAt;
      if (!onBeat && footEnd < p.hold) {
        notes.push(`line ${p.a.line}: the singing clip covers only ${(Math.max(0, covered) / fps).toFixed(1)} s of the ${((p.hold - p.sungAt) / fps).toFixed(1)} s line: a longer take or another shot would cover the whole line (the picture goes on with the next clip instead of freezing)`);
      }
    }
  }
  if (footCuts.length) {
    // The next shot after such a cut is no sliver: a regular cut right behind it gives way.
    regular = regular.filter((c) => !footCuts.some((f) => c.frame > f.frame && c.frame < f.frame + minShot) && !joinAt.has(c.frame));
  }
  const cuts = [...regular, ...placed.flatMap((p) => (p.cut ? [p.cut] : [])), ...hideCuts.map((h) => h.cut), ...footCuts].sort((x, y) => x.frame - y.frame);
  const merged = cuts.filter((c, i) => i === 0 || c.frame !== cuts[i - 1].frame);
  const bounds = [start, ...merged.map((c) => c.frame)];
  const shots = new Map<number, ResolvedAnchor>();
  for (const p of placed) {
    const index = bounds.indexOf(p.frame);
    p.use.shot = index;
    shots.set(index, p.a);
  }
  for (const h of hideCuts) shots.set(bounds.indexOf(h.cut.frame), h.a);
  const outside = uses.filter((u) => !u.used && u.why === "outside this section");
  if (outside.length) notes.push(`not in this section: ${outside.map((u) => `line ${u.line} (${u.clip})`).join(", ")}`);
  return { plan: { ...plan, cuts: merged }, shots, uses: uses.sort((x, y) => x.line - y.line), conflicts, notes, footCuts: footCuts.map((c) => c.frame), joined };
}

// A dissolve into shot `index`: `before` frames over the previous shot, `after` frames into this one
// (about one bar centred on the cut; at most half of either shot; `after` only if the previous clip has
// frames left to keep playing).
export function dissolveFrames(barFrames: number, previousShot: number, thisShot: number, previousFramesLeft: number): { before: number; after: number } {
  const half = Math.floor(barFrames / 2);
  const after = Math.max(0, Math.min(half, Math.floor(thisShot / 2), previousFramesLeft));
  const before = Math.max(0, Math.min(barFrames - after, Math.floor(previousShot / 2)));
  return { before, after };
}

// Song-level checks for the Lyrics tab (and printed by pnpm make): what will clash before any section is
// chosen. `lines`: every line by its lyrics.txt number with its on-screen start and sung end (song ms).
export function anchorProblems(
  anchors: readonly AnchorSpec[],
  lines: ReadonlyMap<number, { text: string; shownMs: number; sungEndMs: number }>,
  clips: ReadonlyMap<string, number | null>, // clip name (lower case) -> duration ms (null: a photo)
  downbeats: readonly number[], // song ms
  minShotMs = 800,
): { line: number; problem: string }[] {
  const out: { line: number; problem: string }[] = [];
  const barOf = (ms: number) => downbeats.filter((d) => d <= ms).at(-1) ?? 0;
  const seen = new Map<number, AnchorSpec>();
  const sorted = [...anchors].sort((a, b) => (lines.get(a.line)?.shownMs ?? 0) - (lines.get(b.line)?.shownMs ?? 0));
  let previous: { a: AnchorSpec; bar: number } | null = null;
  for (const a of sorted) {
    if (seen.has(a.line)) out.push({ line: a.line, problem: `line ${a.line} is anchored twice` });
    seen.set(a.line, a);
    const l = lines.get(a.line);
    if (!l) {
      out.push({ line: a.line, problem: `line ${a.line} is not a sung line of this song` });
      continue;
    }
    const key = a.clip.toLowerCase();
    if (!clips.has(key)) out.push({ line: a.line, problem: `${a.clip} is not in the song's clips or its collections` });
    const length = clips.get(key);
    const lineMs = l.sungEndMs - l.shownMs;
    if (a.sync !== undefined && length !== null && length !== undefined) {
      // A singing clip: it must have footage from the cut (the downbeat before the line) to the line's sung end.
      const from = a.sync * 1000;
      const to = from + length;
      const cutAt = barOf(l.shownMs);
      if (from > l.shownMs) out.push({ line: a.line, problem: `the singing clip ${a.clip} starts ${((from - l.shownMs) / 1000).toFixed(1)} s after line ${a.line} shows: make it again (it starts too late)` });
      else if (downbeats.length && from > cutAt + 1) out.push({ line: a.line, problem: `the singing clip ${a.clip} starts after the downbeat before line ${a.line}: it cuts in a little later, on a beat` });
      const lastLine = (a.through !== undefined ? lines.get(a.through) : undefined) ?? l;
      const lastN = a.through !== undefined && lines.has(a.through) ? a.through : a.line;
      if (to < lastLine.sungEndMs) out.push({ line: a.line, problem: `the singing clip ${a.clip} ends ${((lastLine.sungEndMs - to) / 1000).toFixed(1)} s before line ${lastN} is sung: the picture goes on with the next clip instead (a longer take or another shot would cover the whole line)` });
    } else if (length !== null && length !== undefined) {
      const left = length - (a.clipIn ?? 0) * 1000;
      if (left < lineMs) {
        out.push({ line: a.line, problem: `${a.clip} has ${(Math.max(0, left) / 1000).toFixed(1)} s${a.clipIn ? ` from ${a.clipIn} s` : ""}, line ${a.line} lasts ${(lineMs / 1000).toFixed(1)} s: it will be slowed to ${Math.max(0.5, left / lineMs).toFixed(2)}x${left / lineMs < 0.5 ? " and its last frame held" : ""}` });
      }
    }
    const bar = barOf(l.shownMs);
    if (previous) {
      const p = lines.get(previous.a.line)!;
      if ((downbeats.length && bar === previous.bar) || l.shownMs - p.shownMs < minShotMs) { // (no beats analysed yet: only the spacing)
        out.push({ line: a.line, problem: `line ${a.line} and line ${previous.a.line} land on the same bar: line ${a.line} will cut in on a beat instead${l.shownMs - barOf(p.shownMs) < minShotMs ? " (or not at all: too close)" : ""}` });
      }
      if (previous.a.clip.toLowerCase() === key && l.shownMs - p.shownMs < ANCHOR_REPEAT_MS) {
        out.push({ line: a.line, problem: `lines ${previous.a.line} and ${a.line} both land on ${a.clip}, ${((l.shownMs - p.shownMs) / 1000).toFixed(1)} s apart: the repeat is visible` });
      }
    }
    previous = { a, bar };
  }
  return out;
}

// How many anchors a section keeps (their line on screen and sung to its end inside the section).
export function anchorsInside(
  anchors: readonly { line: number; shownMs: number; sungEndMs: number }[],
  startMs: number,
  endMs: number,
): { kept: number; total: number; missing: number[] } {
  const missing = anchors.filter((a) => a.shownMs < startMs - 100 || a.sungEndMs > endMs).map((a) => a.line);
  return { kept: anchors.length - missing.length, total: anchors.length, missing };
}

// song.json "anchors" and "gapOrder", checked; every problem named.
export function checkAnchors(raw: unknown): { anchors: AnchorSpec[]; problems: string[] } {
  const problems: string[] = [];
  const anchors: AnchorSpec[] = [];
  if (!Array.isArray(raw)) return { anchors, problems: ['anchors must be a list like [{ "line": 9, "clip": "hands.mp4" }]'] };
  raw.forEach((x, i) => {
    const a = x as Record<string, unknown>;
    const at = `anchors[${i}]`;
    if (!a || typeof a !== "object") return problems.push(`${at} must be like { "line": 9, "clip": "hands.mp4" }`);
    if (!Number.isInteger(a.line) || (a.line as number) < 1) return problems.push(`${at}: line must be a line number (1, 2, ...)`);
    if (typeof a.clip !== "string" || !a.clip.trim()) return problems.push(`${at}: clip must be a clip file name`);
    if (a.clipIn !== undefined && (typeof a.clipIn !== "number" || !Number.isFinite(a.clipIn) || a.clipIn < 0)) return problems.push(`${at}: clipIn must be seconds into the clip (0 or more)`);
    if (a.transition !== undefined && a.transition !== "cut" && a.transition !== "dissolve") return problems.push(`${at}: transition must be "cut" or "dissolve"`);
    if (a.sync !== undefined && (typeof a.sync !== "number" || !Number.isFinite(a.sync) || a.sync < 0)) return problems.push(`${at}: sync must be the song second of the singing clip's first frame (0 or more)`);
    if (a.through !== undefined && (!Number.isInteger(a.through) || (a.through as number) < (a.line as number))) return problems.push(`${at}: through must be the last line the singing clip covers (${a.line} or later)`);
    let hide: HideSpec[] | undefined;
    if (a.hide !== undefined) {
      if (a.sync === undefined) return problems.push(`${at}: hide is only for a singing clip (with sync)`);
      if (!Array.isArray(a.hide)) return problems.push(`${at}: hide must be a list like [{ "from": 6, "to": 8, "clip": "rain.mp4" }]`);
      hide = [];
      for (const [k, h] of (a.hide as Record<string, unknown>[]).entries()) {
        const ok = h && typeof h === "object" && typeof h.from === "number" && typeof h.to === "number" && Number.isFinite(h.from) && Number.isFinite(h.to) && h.from >= 0 && h.to > h.from && typeof h.clip === "string" && !!h.clip.trim() && (h.clipIn === undefined || (typeof h.clipIn === "number" && Number.isFinite(h.clipIn) && h.clipIn >= 0));
        if (!ok) return problems.push(`${at}.hide[${k}]: from and to are seconds of the take (to after from), clip a clip file name`);
        hide.push({ from: h.from as number, to: h.to as number, clip: (h.clip as string).trim(), ...(h.clipIn !== undefined ? { clipIn: h.clipIn as number } : {}) });
      }
      hide.sort((x, y) => x.from - y.from);
      if (hide.some((h, k) => k > 0 && h.from < hide![k - 1].to)) return problems.push(`${at}: two hidden moments overlap`);
    }
    anchors.push({ line: a.line as number, clip: (a.clip as string).trim(), ...(a.clipIn !== undefined ? { clipIn: a.clipIn as number } : {}), ...(a.transition ? { transition: a.transition as AnchorTransition } : {}), ...(a.sync !== undefined ? { sync: a.sync as number } : {}), ...(a.through !== undefined && (a.through as number) > (a.line as number) ? { through: a.through as number } : {}), ...(hide?.length ? { hide } : {}) });
  });
  return { anchors, problems };
}
