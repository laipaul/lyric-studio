"use client";

import { AlertTriangle, Clapperboard, Ear, Pause, Play, RotateCcw, Save, Star, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import type { AnchorClip, LyricsLine, LyricsView } from "@lyric/video/lyrics-view";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, "0")}`;
const clockD = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`; // m:ss.d
const signed = (ms: number) => `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(1)} s`;
const NUDGES = [-500, -100, 100, 500];
const PREVIEW_MS = 3_000;
const PRE_ROLL_MS = 1_000;
// The words of lyrics.txt (as the alignment sees them: no hook markers, blank lines or punctuation).
const wordsOf = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim().replace(/^\*\s+/, "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

type Pending = Map<number, number | null>; // line number -> new start (null = back to the alignment / check)

// The Lyrics tab: every line with its time stamp, where it starts now, what the viewer sees, confidence
// and the vocal-start check's verdict (flagged lines highlighted). Nudge a line (−0.5 / −0.1 / +0.1 /
// +0.5 s), listen (▶ 3 s from just before it), Save: hand-set lines go into hints.lrc and the next make
// uses them, keeping the stored alignment. "Lands on": a story anchor per line (a clip from the song's
// own clips and its collections; saved in song.json at once). Below: lyrics.txt itself, with label /
// title / credit lines flagged.
export function LyricsTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<LyricsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(new Map());
  const [history, setHistory] = useState<Pending[]>([]);
  const [onlyReview, setOnlyReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null); // the line whose "lands on" picker is open
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);

  async function load() {
    try {
      const r = await api(`/api/songs/${projectId}/lyrics`, { cache: "no-store" });
      const d = (await r.json()) as LyricsView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/lyrics`, { cache: "no-store" })
      .then((r) => r.json() as Promise<LyricsView & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const change = (update: (p: Pending) => void) => {
    setHistory((h) => [...h, pending]);
    const next = new Map(pending);
    update(next);
    setPending(next);
  };
  const startOf = (l: LyricsLine) => (pending.has(l.number) ? (pending.get(l.number) ?? l.alignedMs) : l.startMs);
  const nudge = (l: LyricsLine, delta: number) => change((p) => p.set(l.number, Math.max(0, Math.round(startOf(l) + delta))));
  // "Use 1:04.0": the likely start as a nudge, saved at once (with any other unsaved changes).
  const takeLikely = (l: LyricsLine) => {
    if (l.likelyStartMs === null) return;
    const next = new Map(pending).set(l.number, l.likelyStartMs);
    setHistory((h) => [...h, pending]);
    setPending(next);
    void save(next);
  };
  const reset = (l: LyricsLine) => change((p) => (l.source === "hand" ? p.set(l.number, null) : p.delete(l.number)));

  function play(l: LyricsLine) {
    const a = audio.current;
    if (!a) return;
    if (playing === l.number) {
      a.pause();
      setPlaying(null);
      return;
    }
    const from = Math.max(0, startOf(l) - PRE_ROLL_MS);
    a.currentTime = from / 1000;
    stopAt.current = (from + PRE_ROLL_MS + PREVIEW_MS) / 1000;
    void a.play().catch((e: Error) => setNotice({ ok: false, text: `Could not play the song: ${e.message}` }));
    setPlaying(l.number);
  }

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await r.json()) as Record<string, unknown> & { error?: string };
      if (!r.ok || result.error) throw new Error(result.error ?? `The studio answered ${r.status}`);
      return result;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function markByEar(l: LyricsLine, checked: boolean) {
    const result = await post({ action: "ear", number: l.number, checked });
    if (!result) return;
    setNotice({ ok: true, text: checked ? `Line ${l.number} checked by ear: QA no longer warns about its timing (until the alignment or its time changes).` : `Line ${l.number}: "checked by ear" taken off.` });
    await load();
  }

  async function save(from: Pending = pending) {
    const changes = [...from.entries()].map(([number, ms]) => ({ number, ms }));
    const result = await post({ action: "times", changes });
    if (!result) return;
    setPending(new Map());
    setHistory([]);
    setNotice({ ok: true, text: `Saved to hints.lrc (${result.handSet} line(s) set by hand). The next video uses them; the stored alignment is kept. Make the video again to see it.` });
    await load();
  }

  // Every hand-set start back to the timing (the vocal stem's when it is used), Undo of a reset, or closing its notice.
  async function resetAll(action: "reset-all" | "undo-reset" | "dismiss-reset") {
    const result = await post({ action });
    if (!result) return;
    setPending(new Map());
    setHistory([]);
    if (action === "undo-reset") setNotice({ ok: true, text: `${result.count} hand-set start(s) are back. They now count as your corrections on top of the ${data?.voice === "stem" ? "vocal stem's " : ""}timing.` });
    await load();
  }

  type Anchor = LyricsView["anchors"]["list"][number];
  async function saveAnchor(line: number, anchor: Anchor | null, gapOrder?: "story" | "shuffle" | null) {
    const list = (data?.anchors.list ?? []).filter((a) => a.line !== line);
    if (anchor) list.push(anchor);
    const result = await post({ action: "anchors", anchors: list, ...(gapOrder !== undefined ? { gapOrder } : {}) });
    if (!result) return;
    setPicking(null);
    setNotice({
      ok: true,
      text: gapOrder !== undefined ? `Gap order: ${gapOrder ?? "default"} (saved to song.json).` : anchor ? `Line ${line} lands on ${anchor.clip}${anchor.transition === "dissolve" ? " (dissolve)" : ""}: saved to song.json. The next video uses it.` : `Line ${line}: anchor removed (song.json).`,
    });
    await load();
  }

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const review = (l: LyricsLine) => ((!!l.flagged || l.lowConfidence) && !l.checkedByEar) || l.checkLapsed || l.source === "hand" || pending.has(l.number);
  const shown = onlyReview ? lines.filter(review) : lines;
  const counts = useMemo(
    () => ({ flagged: lines.filter((l) => l.flagged && !l.checkedByEar).length, ear: lines.filter((l) => l.checkedByEar).length, low: lines.filter((l) => l.lowConfidence && !l.checkedByEar).length, hand: lines.filter((l) => l.source === "hand").length, moved: lines.filter((l) => l.source === "vocal-start check").length }),
    [lines],
  );

  if (error) return <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading the lyrics…</p>;

  return (
    <div className="flex flex-col gap-8 pb-24" data-lyrics-tab>
      {data.song ? (
        <audio
          ref={audio}
          src={`/api/files/${data.song}`}
          preload="none"
          onTimeUpdate={(e) => {
            if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
              e.currentTarget.pause();
              stopAt.current = null;
              setPlaying(null);
            }
          }}
          onPause={() => setPlaying(null)}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        {data.lines ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span data-lyrics-summary>
                {lines.length} lines · <span className={counts.flagged ? "text-amber-300" : ""}>{counts.flagged} flagged for review</span> · {counts.low} low confidence · {counts.ear} checked by ear · {counts.moved} moved by the vocal-start check · {counts.hand} set by hand
              </span>
              {counts.hand && !pending.size ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resetAll("reset-all")}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
                  title="Every line set by hand goes back to the timing; the old hints.lrc is kept in .studio\replaced\ and Undo brings them back"
                  data-reset-all
                >
                  <RotateCcw className="size-3" /> Reset all to the {data.voice === "stem" ? "vocal stem's" : "app's"} timing
                </button>
              ) : null}
              <button type="button" onClick={() => setOnlyReview((o) => !o)} className={cn("rounded-full border px-3 py-1 text-xs", onlyReview ? "border-brand/50 bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")} data-only-review>
                {onlyReview ? "Showing lines to review" : "Show only lines to review"}
              </button>
            </div>
            {data.handReset ? (
              <div data-hand-reset className="border-brand/40 bg-brand/10 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1">
                  {data.handReset.why === "before-stem"
                    ? `${data.handReset.count} start(s) you set by hand before the vocal stem was added were reset: every line now follows the stem's timing. Set a line again by hand where your ear disagrees.`
                    : `${data.handReset.count} hand-set start(s) were reset: every line follows the ${data.voice === "stem" ? "vocal stem's " : ""}timing.`}{" "}
                  The old ones are kept in .studio\replaced\{data.handReset.backup}.
                </span>
                <button type="button" disabled={busy} onClick={() => void resetAll("undo-reset")} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs" data-undo-reset>
                  <Undo2 className="size-3" /> Undo
                </button>
                <button type="button" disabled={busy} onClick={() => void resetAll("dismiss-reset")} className="text-muted-foreground hover:text-foreground rounded-md px-1 py-1" aria-label="Close" data-dismiss-reset>
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span>Story anchors: {data.anchors.list.length} line(s) land on a chosen clip.</span>
              <span>The other shots follow the song&apos;s clip order (Assets or Shape) in every video.</span>
              {!data.anchors.clips.length ? <span className="text-amber-200">No clips to choose from: add clips in the Assets tab or choose a collection in Generate.</span> : null}
            </div>
            {!data.checkRan ? <p className="text-muted-foreground text-xs">The vocal-start check runs when a video is made (Generate, or pnpm make); its verdicts show here after the next video.</p> : null}
            <div className="max-h-[calc(100vh-12rem)] overflow-auto rounded-xl border" data-lines-scroll>
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">#</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">Line</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">Stamp</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">Starts</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">On screen</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">Confidence</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal">Adjust</th>
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal whitespace-nowrap min-w-36">Lands on</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const start = startOf(l);
                    const delta = start - l.startMs; // unsaved change: the screen times shift with it
                    const changed = pending.has(l.number);
                    const anchor = data.anchors.list.find((a) => a.line === l.number) ?? null;
                    const anchorClip = anchor ? data.anchors.clips.find((c) => c.name.toLowerCase() === anchor.clip.toLowerCase()) : undefined;
                    const problems = data.anchors.problems.filter((p) => p.line === l.number);
                    return (
                      <Fragment key={l.number}>
                      <tr
                        data-line={l.number}
                        data-flagged={l.flagged && !l.checkedByEar ? "true" : undefined}
                        data-checked-by-ear={l.checkedByEar ? "true" : undefined}
                        className={cn("border-b align-top last:border-b-0", l.flagged && !l.checkedByEar && "bg-amber-400/5", changed && "bg-brand/5")}
                      >
                        <td className="text-muted-foreground px-3 py-2 tabular-nums">{l.number}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {l.isHook ? <Star className="text-brand size-3.5 shrink-0" aria-label="hook" /> : null}
                            <span>{l.text}</span>
                          </div>
                          {l.flagged ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-amber-200" data-flag-reason>
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span title={l.flagged} data-flag-why>{l.flagReason ?? "Flagged for review. Listen with ▶."}</span>
                            </p>
                          ) : null}
                          {l.source === "vocal-start check" && l.check ? <p className="text-muted-foreground mt-1 text-xs">Moved by the vocal-start check: {l.check.why}</p> : null}
                          {l.checkedByEar ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-300" data-ear-status>
                              <Ear className="size-3" /> Checked by ear on {new Date(l.checkedByEar).toLocaleDateString()}: its timing warnings are cleared in QA
                            </p>
                          ) : l.checkLapsed ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-amber-200" data-ear-lapsed>
                              <Ear className="size-3" /> Checked by ear before, but its time changed since: check it again
                            </p>
                          ) : null}
                          {(l.flagged || l.lowConfidence || l.checkedByEar || l.checkLapsed) && !changed ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => markByEar(l, !l.checkedByEar)}
                              className={cn("mt-1.5 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]", l.checkedByEar ? "border-emerald-400/40 text-emerald-300" : "text-muted-foreground hover:text-foreground")}
                              title={l.checkedByEar ? "Take the mark off (its QA warnings come back)" : "You listened and this line's timing is right: QA stops warning about it until the alignment or its time changes"}
                              data-ear={l.checkedByEar ? "on" : "off"}
                            >
                              <Ear className="size-3" /> {l.checkedByEar ? "Checked by ear ✓" : "Checked by ear"}
                            </button>
                          ) : null}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 tabular-nums">{clock(l.alignedMs)}</td>
                        <td className="px-3 py-2 tabular-nums" data-start>
                          {clock(start)}
                          {changed ? <span className="text-brand ml-1 text-xs">(not saved)</span> : l.source === "hand" ? <span className="text-brand ml-1 text-xs">set by hand</span> : l.source === "vocal-start check" ? <span className="text-muted-foreground ml-1 text-xs">({signed(l.startMs - l.alignedMs)})</span> : null}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums" data-screen>
                          {l.screen.fadeInMs !== null ? <div>fades in {clock(l.screen.fadeInMs + delta)}</div> : null}
                          <div className="text-foreground">readable {clock(l.screen.readableMs + delta)}</div>
                          <div>leaves {clock(l.screen.leaveMs + (changed ? delta : 0))}</div>
                        </td>
                        <td className={cn("px-3 py-2 tabular-nums", l.lowConfidence && "text-amber-300")}>{l.confidence === null ? "–" : l.confidence.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {NUDGES.map((d) => (
                              <button key={d} type="button" disabled={busy} onClick={() => nudge(l, d)} className="hover:border-foreground/30 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums" data-nudge={d}>
                                {d > 0 ? "+" : "−"}
                                {Math.abs(d) / 1000}
                              </button>
                            ))}
                            <button type="button" onClick={() => play(l)} className="text-muted-foreground hover:text-foreground ml-1 rounded-md border px-1.5 py-0.5" aria-label={`Play line ${l.number}`} data-play>
                              {playing === l.number ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                            </button>
                            {l.flagged && !l.checkedByEar && l.likelyStartMs !== null && !changed ? (
                              <button type="button" disabled={busy} onClick={() => takeLikely(l)} className="border-brand/50 bg-brand/10 text-brand hover:bg-brand/20 rounded-md border px-2 py-0.5 text-[11px] tabular-nums whitespace-nowrap" title="Two signals agree on this start; the earlier one is used (a line a little early is better than late). Saves at once." data-use-likely>
                                Use {clockD(l.likelyStartMs)}
                              </button>
                            ) : null}
                            {changed || l.source === "hand" ? (
                              <button type="button" onClick={() => reset(l)} className="text-muted-foreground hover:text-foreground rounded-md border px-1.5 py-0.5" aria-label={`Reset line ${l.number}`} title={l.source === "hand" ? (data.voice === "stem" ? "Back to the vocal stem's timing (removes the hand-set time)" : "Back to the alignment (removes the hand-set time)") : "Undo the change on this line"} data-reset>
                                <RotateCcw className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="min-w-36 px-3 py-2" data-anchor-cell>
                          {anchor ? (
                            <div className="flex items-center gap-2" data-anchor={anchor.clip}>
                              <Thumb clip={anchorClip} />
                              <div className="min-w-0 text-xs">
                                <div className="truncate">{anchor.clip}</div>
                                <div className="text-muted-foreground">
                                  {anchor.transition === "dissolve" ? "dissolve" : "cut"}
                                  {anchor.clipIn ? ` · from ${anchor.clipIn} s` : ""}
                                </div>
                              </div>
                              <button type="button" disabled={busy} onClick={() => saveAnchor(l.number, null)} className="text-muted-foreground hover:text-foreground rounded-md border p-0.5" aria-label={`Remove the anchor on line ${l.number}`} data-anchor-remove>
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ) : null}
                          <button type="button" disabled={busy} onClick={() => setPicking(picking === l.number ? null : l.number)} className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] whitespace-nowrap" data-anchor-pick>
                            <Clapperboard className="size-3" /> {anchor ? "Change" : "Choose a clip"}
                          </button>
                          {problems.map((p) => (
                            <p key={p.problem} className="mt-1 flex items-start gap-1 text-[11px] text-amber-200" data-anchor-problem>
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {p.problem}
                            </p>
                          ))}
                        </td>
                      </tr>
                      {picking === l.number ? (
                        <tr className="bg-muted/30 border-b" data-anchor-picker>
                          <td colSpan={8} className="px-3 py-3">
                            <AnchorPicker line={l} clips={data.anchors.clips} current={anchor} busy={busy} onSave={(a) => saveAnchor(l.number, a)} onCancel={() => setPicking(null)} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-popover sticky bottom-4 z-20 flex flex-wrap items-center justify-end gap-3 rounded-lg border p-3 shadow-xl">
              <span className="text-muted-foreground mr-auto text-xs">▶ plays 3 s from 1 s before the line. Saving writes the changed lines to hints.lrc as set by hand; the stored alignment is kept.</span>
              <Button size="sm" variant="ghost" disabled={!history.length || busy} onClick={() => (setPending(history[history.length - 1]), setHistory((h) => h.slice(0, -1)))} data-undo>
                <Undo2 /> Undo
              </Button>
              <Button size="sm" disabled={!pending.size || busy} onClick={() => save()} data-save-times>
                <Save /> {busy ? "Saving…" : `Save ${pending.size || ""} change${pending.size === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm" data-no-alignment>
            {data.why}
          </p>
        )}
        {notice ? (
          <p role="status" className={cn("rounded-md border p-3 text-sm", notice.ok ? "border-brand/30 bg-brand/10" : "border-red-400/30 bg-red-400/10 text-red-200")}>
            {notice.text}
          </p>
        ) : null}
      </section>

      <LyricsText key={data.lyricsText} data={data} onSaved={load} post={post} busy={busy} setNotice={setNotice} />
    </div>
  );
}

function Thumb({ clip }: { clip: AnchorClip | undefined }) {
  return (
    <div className="bg-muted flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded">
      {clip?.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
        <img src={`/api/files/${clip.thumb}`} alt="" className="size-full object-cover" />
      ) : (
        <Clapperboard className="text-muted-foreground size-3.5" />
      )}
    </div>
  );
}

// "Lands on" for one line: the clips (song's own first, then each collection), where in the clip it
// starts (clipIn, seconds) and cut or dissolve.
function AnchorPicker({
  line,
  clips,
  current,
  busy,
  onSave,
  onCancel,
}: {
  line: LyricsLine;
  clips: AnchorClip[];
  current: LyricsView["anchors"]["list"][number] | null;
  busy: boolean;
  onSave: (a: LyricsView["anchors"]["list"][number]) => void;
  onCancel: () => void;
}) {
  const [clip, setClip] = useState(current?.clip ?? "");
  const [clipIn, setClipIn] = useState(current?.clipIn ? String(current.clipIn) : "");
  const [transition, setTransition] = useState<"cut" | "dissolve">(current?.transition ?? "cut");
  const groups = [...new Set(clips.map((c) => c.from))];
  const chosen = clips.find((c) => c.name === clip);
  const lineMs = (line.sungEndMs ?? line.screen.leaveMs) - line.screen.readableMs;
  const left = chosen && chosen.kind === "video" ? chosen.durationMs - (Number(clipIn) || 0) * 1000 : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs">
        Line {line.number} &quot;{line.text}&quot; lands on a clip: it cuts in on the downbeat at or just before the line ({(lineMs / 1000).toFixed(1)} s on screen) and stays until the line ends.
      </p>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px]">{g === "song" ? "This song's clips" : `Collection ${g}`}</span>
          <div className="flex flex-wrap gap-2">
            {clips
              .filter((c) => c.from === g)
              .map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setClip(c.name)}
                  className={cn("flex w-20 flex-col items-center gap-1 rounded-md border p-1 text-[10px]", clip === c.name ? "border-brand bg-brand/10" : "hover:border-foreground/30")}
                  title={`${c.name} · ${c.kind === "photo" ? "photo" : `${(c.durationMs / 1000).toFixed(1)} s`} · ${c.orientation}`}
                  data-anchor-clip={c.name}
                >
                  <div className="bg-muted h-24 w-full overflow-hidden rounded">
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                      <img src={`/api/files/${c.thumb}`} alt="" className="size-full object-cover" />
                    ) : null}
                  </div>
                  <span className="w-full truncate">{c.name}</span>
                  <span className="text-muted-foreground">{c.kind === "photo" ? "photo" : `${(c.durationMs / 1000).toFixed(1)} s`}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          Start in the clip at
          <input type="number" min={0} step={0.1} value={clipIn} onChange={(e) => setClipIn(e.target.value)} placeholder="0" className="bg-background w-16 rounded-md border px-1.5 py-0.5" data-anchor-clipin />
          s
        </label>
        <label className="flex items-center gap-1">
          Transition
          <select value={transition} onChange={(e) => setTransition(e.target.value === "dissolve" ? "dissolve" : "cut")} className="bg-background rounded-md border px-1.5 py-0.5" data-anchor-transition>
            <option value="cut">cut (on the downbeat)</option>
            <option value="dissolve">dissolve (~1 bar)</option>
          </select>
        </label>
        {left !== null && left < lineMs ? (
          <span className="flex items-center gap-1 text-amber-200" data-anchor-short>
            <AlertTriangle className="size-3" /> {chosen!.name} has {(Math.max(0, left) / 1000).toFixed(1)} s from there: it will be slowed to cover the line (QA warns)
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!clip || busy}
            onClick={() => onSave({ line: line.number, clip, ...(Number(clipIn) > 0 ? { clipIn: Number(clipIn) } : {}), ...(transition === "dissolve" ? { transition } : {}) })}
            data-anchor-save
          >
            <Save /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// lyrics.txt itself: edit (the old one is kept), label / title / credit lines flagged, earlier versions back.
function LyricsText({
  data,
  onSaved,
  post,
  busy,
  setNotice,
}: {
  data: LyricsView;
  onSaved: () => Promise<void>;
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  busy: boolean;
  setNotice: (n: { ok: boolean; text: string } | null) => void;
}) {
  const [text, setText] = useState(data.lyricsText);
  const [confirm, setConfirm] = useState(false);
  const story = data.instrumental; // story.txt: re-timed by the app on the next video, never aligned
  const fileName = story ? "story.txt" : "lyrics.txt";
  const wordsChange = !story && wordsOf(text) !== wordsOf(data.lyricsText);
  const changed = text.replace(/\r\n/g, "\n").trimEnd() !== data.lyricsText.replace(/\r\n/g, "\n").trimEnd();
  const labels = data.labels.filter((f) => text.split(/\r?\n/)[f.line - 1]?.trim().replace(/^\*\s+/, "") === f.text);

  async function save() {
    if (wordsChange && !confirm) {
      setConfirm(true);
      return;
    }
    const r = await post({ action: "text", text });
    setConfirm(false);
    if (!r) return;
    // The page shows the saved state first, then says so (a click right after the message finds it settled).
    await onSaved();
    if (story) {
      setNotice({ ok: true, text: "story.txt saved (the old one is in .studio\\replaced\\). The next video times the sentences again on the music." });
      return;
    }
    setNotice({ ok: true, text: r.realign ? "lyrics.txt saved (the old one is in .studio\\replaced\\). The words changed: the next video aligns the lyrics again." : "lyrics.txt saved (the old one is in .studio\\replaced\\). Only hook markers or blank lines changed: the stored alignment is kept." });
  }

  async function restore(file: string) {
    const r = await post({ action: "restore", file });
    if (!r) return;
    await onSaved();
    setNotice({ ok: true, text: `Earlier ${fileName} restored (the current one was kept).${r.realign ? " The next video aligns the lyrics for these words (or reuses an alignment made for them before)." : ""}` });
  }

  const removeLabels = () =>
    setText(
      text
        .split(/\r?\n/)
        .filter((_, i) => !labels.some((f) => f.line === i + 1))
        .join("\n"),
    );

  return (
    <section className="flex flex-col gap-3" data-lyrics-text>
      <h2 className="font-display text-brand text-sm tracking-[0.14em] uppercase">{fileName}</h2>
      {labels.length ? (
        <div className="flex flex-col gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" data-label-flags>
          <p className="font-medium">These lines look like labels, not sung words (they would be timed and shown as lyrics):</p>
          <ul className="list-disc pl-5 text-xs">
            {labels.map((f) => (
              <li key={f.line}>
                line {f.line} “{f.text}”: {f.why}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-1 w-fit" onClick={removeLabels} data-remove-labels>
            Remove {labels.length === 1 ? "this line" : "these lines"} from the text
          </Button>
        </div>
      ) : null}
      <textarea value={text} onChange={(e) => (setText(e.target.value), setConfirm(false))} rows={Math.min(30, Math.max(10, text.split("\n").length + 1))} className="bg-input/30 border-input rounded-md border p-3 font-mono text-sm" spellCheck={false} data-lyrics-editor />
      <p className="text-muted-foreground text-xs">
        {story
          ? "An instrumental's story: one sentence per line, a blank line is a pause. The app times the sentences on the music; nudge one in the list above when you want it elsewhere."
          : "“* ” at the start of a line marks a hook. Changing hook markers or blank lines keeps the timing; changing words aligns the song again on the next video."}
      </p>
      {confirm ? (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" data-realign-warning>
          The words change: the next video aligns the lyrics again (a few minutes; needs the AI packages), and hand-set times of changed lines are ignored. The old lyrics.txt is kept and can be restored below. Press Save again to go ahead.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!changed || busy} onClick={save} data-save-text>
          <Save /> {confirm ? "Save anyway" : `Save ${fileName}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={!changed || busy} onClick={() => (setText(data.lyricsText), setConfirm(false))}>
          Discard changes
        </Button>
      </div>
      {data.replaced.length ? (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Earlier versions ({data.replaced.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {data.replaced.map((r) => (
              <li key={r.file} className="flex items-center gap-3 text-xs">
                <span className="tabular-nums">{new Date(r.at).toLocaleString()}</span>
                <span className="text-muted-foreground">{r.lines} lines</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => restore(r.file)} data-restore={r.file}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
