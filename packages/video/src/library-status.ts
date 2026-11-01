// Library cards (Step H): one colour system for every platform chip and one summary per song.
//   grey   none      not made yet (or every video discarded)
//   amber  review    made, not approved yet
//   green  ready     an approved video in the latest run (or, when that run kept none, in an older one)
//   red    error     the latest run failed;  stopped: it was stopped / interrupted (Resume makes the rest)
//   pulse  rendering
// Pure: the studio and the tests use it the same way.

export type ChipState = "none" | "rendering" | "ready" | "review" | "error" | "stopped";

export type ChipInput = {
  status: "PASS" | "WARN" | "FAILED" | "interrupted" | "Rendering" | "none"; // the latest run (QA-level)
  videos: number; // kept (not discarded) in the latest run
  approved: number; // approved, in any run (the number shown)
  approvedLatest: number; // approved, in the latest run: a new unreviewed render is "review" again
};

export function chipState(p: ChipInput): ChipState {
  if (p.status === "Rendering") return "rendering";
  if (p.approvedLatest > 0) return "ready";
  if (p.videos === 0 && p.approved > 0) return "ready"; // latest run all discarded: the older approval stands
  if (p.status === "FAILED") return "error";
  if (p.status === "interrupted") return "stopped";
  if (p.status === "none" || p.videos === 0) return "none";
  return "review";
}

// The number on a chip: approved videos when ready, else the kept videos; nothing when not made.
export function chipCount(p: ChipInput, state = chipState(p)): string {
  if (state === "ready") return String(p.approved);
  if (state === "review") return String(p.videos);
  if (state === "rendering") return "…";
  if (state === "error" || state === "stopped") return "!";
  return "—";
}

export const CHIP_TITLE: Record<ChipState, string> = {
  none: "not made yet",
  rendering: "rendering now",
  ready: "approved, ready to post",
  review: "made, waiting for your review",
  error: "the last run failed",
  stopped: "stopped before all videos were made: Resume makes the rest",
};

export type SongFilter = "all" | "none" | "review" | "errors" | "ready";
export const SONG_FILTERS: { id: SongFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "none", label: "No videos" },
  { id: "review", label: "Needs review" },
  { id: "errors", label: "Errors" },
  { id: "ready", label: "Ready" },
];

export type SongSummary = {
  total: number; // platforms shown on the card
  ready: number;
  review: number;
  errors: number; // error + stopped
  rendering: number;
  made: number; // anything but none
  action: "generate" | "fix" | "resume" | "review" | null; // the card's one button
  text: string; // "3/5 ready · 1 to review · 1 error"
  filters: SongFilter[]; // the filters this song appears under (besides "all")
};

export function songSummary(states: ChipState[]): SongSummary {
  const count = (s: ChipState) => states.filter((x) => x === s).length;
  const ready = count("ready");
  const review = count("review");
  const failed = count("error");
  const stopped = count("stopped");
  const rendering = count("rendering");
  const errors = failed + stopped;
  const made = states.length - count("none");
  const parts = [`${ready}/${states.length} ready`];
  if (review) parts.push(`${review} to review`);
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (rendering) parts.push(`${rendering} rendering`);
  const action: SongSummary["action"] = rendering ? null : failed ? "fix" : stopped ? "resume" : made === 0 ? "generate" : review ? "review" : null;
  const filters: SongFilter[] = [];
  if (made === 0) filters.push("none");
  if (review) filters.push("review");
  if (errors) filters.push("errors");
  if (ready && !review && !errors && !rendering) filters.push("ready");
  return { total: states.length, ready, review, errors, rendering, made, action, text: made === 0 && !rendering ? "No videos yet" : parts.join(" · "), filters };
}

export type SongSort = "last" | "title" | "added";
export const SONG_SORTS: { id: SongSort; label: string }[] = [
  { id: "last", label: "Last made" },
  { id: "title", label: "Title" },
  { id: "added", label: "Date added" },
];

export function sortSongs<T extends { title: string; createdAt: string; lastRun: string | null }>(songs: readonly T[], by: SongSort): T[] {
  const list = [...songs];
  if (by === "title") return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
  if (by === "added") return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.sort((a, b) => (b.lastRun ?? b.createdAt).localeCompare(a.lastRun ?? a.createdAt));
}
