// The two-layer timeline (Part A, 28 Nov 2026, decided with Paul): every song's edit as a pro editor's tracks.
//   A1 Song    the master, read only (never in this file: the song file is only ever read).
//   V1 Singer  singing segments, each locked to song time (a take's first frame at song second `sync`), always 1.00x,
//              never moved by any other edit (only its nudge, already in `sync`).
//   V2 B-roll  the story: the story line (its order), story clips pinned to a lyric line, B-roll over a stretch of the
//              song (Shape's "B-roll here"), and cut-aways over a singing segment. Where V2 has a clip it covers V1;
//              where V2 is empty over a singing segment, the singer shows through.
// Lyrics / text stay drawn on top of everything, as today (not a track here).
// The V2 → V1 change (Paul, 28 Nov 2026, twice): V1 is never moved, slowed, frozen, faded or stretched, so the soft
// entry and exit come from the B-roll side and from where the singer's cut is placed. ONE rule, defined below
// (V2_V1_CHANGE) and used by every place that needs it (anchors.ts cut placement, handles / compose for the dissolves,
// singer.ts for the MV Generator handles, music-video.ts and singer.ts for the skipped first frames):
//   lead-in  the singer enters ~0.4 s BEFORE the line's sung start (her breath in), still at song time and 1.00x; the
//            cut is placed on the beat that gives this, never before the footage starts (+ the skipped frames);
//   entry    the B-roll before plays on past the cut, on top, and dissolves OUT over the singer's first 0.4 s; the
//            dissolve ENDS on a beat when the footage allows (the singer's cut is then 0.4 s before that beat);
//   release  the singer stays ~0.3 s after the line's sung end (the note releases), and the B-roll after dissolves IN
//            over that release (it starts early, the cut after the release stays on the grid);
//   pop      the first 2 frames of every generated take are never shown (the clip's in-point moves, never its song time).
// For every singing source alike (InfiniteTalk, MV Generator, music-video shots). A source whose footage starts at the
// line (a music-video shot) has no breath to show: the B-roll fade alone softens it and the plan says so in plain words.
// The clip's own "comes in with: cut", the crisp style and an all-cuts variation still win. It is a rule of the change
// between the layers, worked out where the edit is drawn (anchors / compose / handles), never stored in the tracks.
//
// Part A changes nothing visible: the tracks are made from the song's existing edit (song.json "anchors", clips.json
// "order" and "inserts") by fromEdit, and turned back into exactly that edit by toEdit, which is what Make reads.
// toEdit(fromEdit(x)) gives x back (tested), and `pnpm tracks:check` proves on Paul's own songs that every video's
// render props are identical. Tracks are per song (V1 in song time is the same moment in every video); `videos` is
// room for a per-video V2 override (Part B; empty until then).
// Pure.
import type { AnchorSpec, AnchorTransition, HideSpec } from "./anchors";

export const TRACKS_VERSION = 1;

// The V2 → V1 change, defined once (ms unless it says frames; 30 fps frames come from `v2v1Frames`).
export const V2_V1_CHANGE = {
  leadInMs: 400, // the singer enters this long before the line's sung start
  releaseMs: 300, // ... and stays this long after the line's sung end
  entryFadeMs: 400, // the B-roll before dissolves out over the singer's lead-in (0.3 to 0.5 s)
  exitFadeMs: 300, // the B-roll after dissolves in over the singer's release
  skipFrames: 2, // the first frames of a generated take are never shown (some models "pop" there)
  mvHandleInMs: 400, // MV Generator: of the 1 s handle before the song range, this much is kept (the take starts earlier)
  mvHandleOutMs: 300, // ... and this much of the handle after it
} as const;
// The same in frames at `fps` (whole frames, never fewer than one).
export const v2v1Frames = (fps = 30) => {
  const f = (ms: number) => Math.max(1, Math.round((ms * fps) / 1000));
  return { leadIn: f(V2_V1_CHANGE.leadInMs), release: f(V2_V1_CHANGE.releaseMs), entryFade: f(V2_V1_CHANGE.entryFadeMs), exitFade: f(V2_V1_CHANGE.exitFadeMs), skip: V2_V1_CHANGE.skipFrames };
};

// V1: one singing segment (a singing take or a music-video shot on its lines).
export type SingerSegment = {
  line: number; // the first lyric line it sings (Lyrics tab number)
  through?: number; // the last line, when it sings several in a row
  clip: string; // the clip in the song's clips (file name)
  sync: number; // song seconds of the clip's first frame (the nudge included)
  clipIn?: number; // seconds into the clip where it is used (rare on a singing clip; kept as it was)
  transition?: AnchorTransition; // as it was in song.json (a singing clip always cuts in; kept so nothing changes)
};
// V2: B-roll laid over a singing segment for a moment of it (formerly the take's "hide"): seconds of the take.
export type Cutaway = { over: { line: number; clip: string }; from: number; to: number; clip: string; clipIn?: number };
// V2: a story clip pinned to a lyric line (a story anchor).
export type PinnedClip = { line: number; clip: string; clipIn?: number; transition?: AnchorTransition };
// V2: B-roll over a stretch of the song (Shape's "B-roll here"), song seconds.
export type BrollInsert = { from: number; to: number; clip: string };

export type Tracks = {
  version: number;
  singer: SingerSegment[]; // V1, by song time
  broll: {
    story: string[]; // V2's story line: the clips in story order (clips.json "order", collection cards included)
    pinned: PinnedClip[]; // story clips on their lines
    inserts: BrollInsert[]; // over a stretch of the song
    cutaways: Cutaway[]; // over a singing segment
  };
  videos?: Record<string, { broll?: Partial<Tracks["broll"]> }>; // Part B: a video's own V2 (e.g. "reels-1")
  anchorOrder?: ("s" | "p")[]; // how singing segments (s) and pinned clips (p) were interleaved in song.json (kept exact)
  from?: string; // the fingerprint of the edit they were made from (fingerprint below)
};

// The edit Make reads today.
export type Edit = { anchors: AnchorSpec[]; order: string[]; inserts: BrollInsert[] };

const pick = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// The song's edit as tracks. A singing anchor (with "sync") is V1, its hides V2 cut-aways; every other anchor is a
// pinned story clip; the order and the inserts are V2. The anchors' own order is kept in `singer` / `pinned` order
// plus `seq` (so toEdit puts them back exactly as they were).
export function fromEdit(edit: Edit): Tracks {
  const singer: SingerSegment[] = [];
  const pinned: PinnedClip[] = [];
  const cutaways: Cutaway[] = [];
  const seq: ("s" | "p")[] = [];
  for (const a of edit.anchors) {
    if (a.sync !== undefined) {
      singer.push(pick({ line: a.line, through: a.through, clip: a.clip, sync: a.sync, clipIn: a.clipIn, transition: a.transition }));
      for (const h of a.hide ?? []) cutaways.push(pick({ over: { line: a.line, clip: a.clip }, from: h.from, to: h.to, clip: h.clip, clipIn: h.clipIn }));
      seq.push("s");
    } else {
      pinned.push(pick({ line: a.line, clip: a.clip, clipIn: a.clipIn, transition: a.transition }));
      seq.push("p");
    }
  }
  return { version: TRACKS_VERSION, singer, broll: { story: [...edit.order], pinned, inserts: edit.inserts.map((x) => ({ ...x })), cutaways }, anchorOrder: seq, from: fingerprint(edit) };
}

// The tracks as the edit Make reads (song.json anchors, clips.json order and inserts). anchorOrder: the anchors'
// original interleaving (from fromEdit); without it, the singing segments come first, then the pinned clips.
export function toEdit(t: Tracks): Edit {
  const seq = t.anchorOrder;
  const sing = t.singer.map((s): AnchorSpec => {
    const hide: HideSpec[] = t.broll.cutaways.filter((c) => c.over.line === s.line && c.over.clip === s.clip).map((c) => pick({ from: c.from, to: c.to, clip: c.clip, clipIn: c.clipIn }));
    return pick({ line: s.line, clip: s.clip, clipIn: s.clipIn, transition: s.transition, sync: s.sync, through: s.through, hide: hide.length ? hide : undefined });
  });
  const pins = t.broll.pinned.map((p): AnchorSpec => pick({ line: p.line, clip: p.clip, clipIn: p.clipIn, transition: p.transition }));
  let anchors: AnchorSpec[];
  if (seq && seq.length === sing.length + pins.length && seq.filter((x) => x === "s").length === sing.length) {
    let i = 0;
    let j = 0;
    anchors = seq.map((x) => (x === "s" ? sing[i++] : pins[j++]));
  } else anchors = [...sing, ...pins];
  return { anchors, order: [...t.broll.story], inserts: t.broll.inserts.map((x) => ({ ...x })) };
}

// A stable fingerprint of an edit (anchors with their keys in a fixed order, the order, the inserts): tracks made from
// an older edit are made again (song.json or clips.json changed by an older screen, or by hand).
export function fingerprint(edit: Edit): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  const s = JSON.stringify(norm(edit));
  let h = 2166136261; // FNV-1a, 32 bit: enough to tell two edits apart
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(16).padStart(8, "0")}:${s.length}`;
}
