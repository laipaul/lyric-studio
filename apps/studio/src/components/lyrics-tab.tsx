"use client";

import { AlertTriangle, Clapperboard, Ear, EyeOff, Pause, Play, RotateCcw, Save, Star, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clockTenths, linesInVideo } from "@lyric/video";
import type { AnchorClip, LyricsLine, LyricsView } from "@lyric/video/lyrics-view";
import { showsSinging } from "@lyric/video/song-style";

import { HidePreview } from "@/components/hide-preview";
import { CutWhilePlayingButton } from "@/components/cut-while-playing";
import { LineMvShots, MvLinesBar, useMvLines } from "@/components/mv-lines";
import { SingerBar, SingerCell, useSinger } from "@/components/singer";
import { SectionHeaderRow, SectionsBar, StartSectionButton, useSections } from "@/components/sections-ui";
import { useSongStyle } from "@/components/song-style";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

// The part of the song a short-form video uses (7 Nov 2026): the same plan the Shape page shows (the planner's
// dry run for v1), so it always matches the next video. YouTube (the whole song) and Canvas are left out.
type PartPlatform = { name: string; label: string };
type PartPlan = {
  platform: string;
  section: { startMs: number; endMs: number; reason: string };
  songStartMs: number;
  durationMs: number;
  lines: { number: number | null; startMs: number }[];
};
const PART_PLATFORMS = new Set(["reels", "tiktok", "shorts"]);

// The Lyrics tab: every line with its time stamp, where it starts now, what the viewer sees, confidence
// and the vocal-start check's verdict (flagged lines highlighted). Nudge a line (−0.5 / −0.1 / +0.1 /
// +0.5 s), listen (▶ 3 s from just before it), Save: hand-set lines go into hints.lrc and the next make
// uses them, keeping the stored alignment. "Lands on": a story anchor per line (a clip from the song's
// own clips and its collections; saved in song.json at once). Below: lyrics.txt itself, with label /
// title / credit lines flagged.
export function LyricsTab({ projectId }: { projectId: string }) {
  const router = useRouter(); // the page's Prepare to-do list ("N lines to check by ear") is read again after a change
  const [data, setData] = useState<LyricsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(new Map());
  const [history, setHistory] = useState<Pending[]>([]);
  const [onlyReview, setOnlyReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null); // the line whose "lands on" picker is open
  const [hiding, setHiding] = useState<number | null>(null); // the singing line whose "Hide a moment" picker is open
  const [previewing, setPreviewing] = useState<number | null>(null); // the singing line whose hidden moments play
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  // Which part of the song the Reel (TikTok, Shorts) uses: planned like the Shape page, after the lines load.
  const [partPlatforms, setPartPlatforms] = useState<PartPlatform[] | null>(null);
  const [partOf, setPartOf] = useState<string | null>(null);
  const [partRound, setPartRound] = useState(0); // planned again after a save (a start set by hand can move the Reel)
  // The last plan received, with the request it answers ("reels:0"): loading while it answers another one.
  const [partResult, setPartResult] = useState<{ key: string; plan: PartPlan | null; error: string | null } | null>(null);
  const partKey = partOf ? `${partOf}:${partRound}` : null;
  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/storyboard`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ platforms?: PartPlatform[]; ready?: boolean; error?: string }>)
      .then((d) => {
        if (!alive) return;
        const list = d.ready ? (d.platforms ?? []).filter((p) => PART_PLATFORMS.has(p.name)) : [];
        setPartPlatforms(list);
        setPartOf((now) => now ?? list[0]?.name ?? null);
      })
      .catch(() => alive && setPartPlatforms([]));
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!partOf || !partKey) return;
    let alive = true;
    api(`/api/songs/${projectId}/storyboard?platform=${encodeURIComponent(partOf)}&video=v1`, { cache: "no-store" })
      .then((r) => r.json() as Promise<PartPlan & { platform: { name: string }; error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) return setPartResult({ key: partKey, plan: null, error: d.error });
        setPartResult({ key: partKey, plan: { platform: partOf, section: d.section, songStartMs: d.songStartMs ?? d.section.startMs, durationMs: d.durationMs, lines: d.lines }, error: null });
      })
      .catch((e: Error) => alive && setPartResult({ key: partKey, plan: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [projectId, partOf, partKey]);
  const partState = { loading: !!partKey && partResult?.key !== partKey, error: partResult?.key === partKey ? partResult.error : null };
  const part = partResult?.key === partKey ? partResult.plan : null;
  const inPart = useMemo(() => (part && part.platform === partOf ? linesInVideo(part.lines) : null), [part, partOf]);
  const partLabel = partPlatforms?.find((p) => p.name === partOf)?.label ?? "Reels";

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

  // Singing lines (Singer column): when their clips land, the anchors change.
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadAnchors = useCallback(() => void loadRef.current(), []);
  const singer = useSinger(projectId, reloadAnchors);
  // The music-video shots on each line (mv-lines.tsx): a shot placed changes the anchors and the singing lines.
  const mvLines = useMvLines(projectId, () => (reloadAnchors(), void singer.reload()));
  // Song style (song-style.ts): Who sings shows for Add lip sync and Mini film, and on any song that has singing lines.
  const style = useSongStyle(projectId);
  // The song's sections (sections-ui.tsx), above the lines and as a row before each section: for every song style since
  // 26 Nov 2026 (the Persona's section map and the Performance script use them on Reels too; before, Mini film only).
  const withSections = !!style;
  const sections = useSections(projectId, withSections);

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
    router.refresh(); // the "lines to check by ear" banner and Prepare's status follow at once
  }

  async function save(from: Pending = pending) {
    setPartRound((n) => n + 1);
    const changes = [...from.entries()].map(([number, ms]) => ({ number, ms }));
    const result = await post({ action: "times", changes });
    if (!result) return;
    setPending(new Map());
    setHistory([]);
    const skipped = (result.skipped ?? []) as { line: number; text: string; why: string }[];
    const dropped = (result.dropped ?? []) as string[];
    const extra = `${skipped.map((k) => ` Line ${k.line} "${k.text}" is NOT used: ${k.why}.`).join("")}${dropped.map((d) => ` ${d}.`).join("")}`;
    setNotice({ ok: !skipped.length, text: `Saved to hints.lrc (${result.handSet} line(s) set by hand). The next video uses them; the stored alignment is kept. Make the video again to see it.${extra}` });
    await load();
    router.refresh(); // a line set by hand leaves the "to check by ear" banner
  }

  // Every hand-set start back to the timing (the vocal stem's when it is used), Undo of a reset, or closing its notice.
  async function resetAll(action: "reset-all" | "undo-reset" | "dismiss-reset") {
    setPartRound((n) => n + 1);
    const result = await post({ action });
    if (!result) return;
    setPending(new Map());
    setHistory([]);
    if (action === "undo-reset") setNotice({ ok: true, text: `${result.count} hand-set start(s) are back. They now count as your corrections on top of the ${data?.voice === "stem" ? "vocal stem's " : ""}timing.` });
    await load();
  }

  type Anchor = LyricsView["anchors"]["list"][number];
  async function saveAnchor(line: number, anchor: Anchor | null, gapOrder?: "story" | "shuffle" | null) {
    // A plain clip on a line a singing clip covers takes the singer off its whole group: ask first, in plain words.
    const singing = anchor && anchor.sync === undefined ? (data?.anchors.list ?? []).find((a) => a.sync !== undefined && a.line <= line && line <= (a.through ?? a.line)) : undefined;
    if (singing) {
      const through = singing.through ?? singing.line;
      const covered = through > singing.line ? `lines ${singing.line}-${through}` : `line ${singing.line}`;
      const ok = window.confirm(
        `Line ${line} is sung by a singing clip on ${covered}. Showing this clip removes the singer from ${covered} (the singing clip is set to Omit; it stays in Creation, and "Use this take" in Lip sync brings it back). Continue?`,
      );
      if (!ok) return; // the picker stays open
    }
    // A Creation take not in the Storyboard yet: sent first (it joins the end of the story line), then placed.
    const wanted = anchor?.clip;
    const take = wanted ? data?.anchors.clips.find((c) => c.name === wanted && c.take && !c.take.sent)?.take : undefined;
    if (anchor && take) {
      const clip = await sendTake(anchor.clip);
      if (!clip) return;
      anchor = { ...anchor, clip };
    }
    const list = (data?.anchors.list ?? []).filter((a) => a.line !== line && a !== singing);
    if (anchor) list.push(anchor);
    const result = await post({ action: "anchors", anchors: list, ...(gapOrder !== undefined ? { gapOrder } : {}) });
    if (!result) return;
    setPicking(null);
    setNotice({
      ok: true,
      text: gapOrder !== undefined ? `Gap order: ${gapOrder ?? "default"} (saved to song.json).` : anchor ? `Line ${line} lands on ${(take ? data?.anchors.clips.find((c) => c.take?.picture === take.picture && c.take.n === take.n)?.label : null) ?? anchor.clip}${anchor.transition === "dissolve" ? " (dissolve)" : ""}: saved to song.json. The next video uses it.` : `Line ${line}: anchor removed (song.json).`,
    });
    await load();
    // The server may have taken the singer off this line's group: "Who sings" must say so too (its in-use change calls
    // reloadAnchors once more; that load changes nothing, so it stops there).
    await singer.reload();
  }

  // The clip a picker choice stands for: a Creation take not in the Storyboard yet is sent there first (null: it failed).
  async function sendTake(name: string): Promise<string | null> {
    const take = data?.anchors.clips.find((c) => c.name === name && c.take && !c.take.sent)?.take;
    if (!take) return name;
    try {
      const r = await api(`/api/songs/${projectId}/pictures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", file: take.picture, n: take.n, forLine: true }) });
      const d = (await r.json()) as { clip?: string; error?: string };
      if (!r.ok || !d.clip) throw new Error(d.error ?? `The studio answered ${r.status}`);
      return d.clip;
    } catch (e) {
      setNotice({ ok: false, text: `The take could not be sent to the Storyboard: ${(e as Error).message}` });
      return null;
    }
  }

  // Hide a moment of a singing take (Paul, 22 Nov 2026): seconds of the take covered by another clip; the song plays on
  // and the singer comes back in time. Saved on the singing anchor (song.json "hide"); k: remove that one.
  async function saveHide(line: number, h: { from: number; to: number; clip: string; clipIn?: number } | { remove: number }) {
    const singing = (data?.anchors.list ?? []).find((a) => a.sync !== undefined && a.line === line);
    if (!singing) return;
    let hide = [...(singing.hide ?? [])];
    if ("remove" in h) hide.splice(h.remove, 1);
    else {
      if (hide.some((x) => h.from < x.to && x.from < h.to)) return setNotice({ ok: false, text: `${h.from}–${h.to} s overlaps a moment already hidden on line ${line}: remove that one first.` });
      const clip = await sendTake(h.clip);
      if (!clip) return;
      hide = [...hide, { ...h, clip }].sort((x, y) => x.from - y.from);
    }
    const next = { ...singing, hide: hide.length ? hide : undefined };
    const list = (data?.anchors.list ?? []).map((a) => (a === singing ? next : a));
    const result = await post({ action: "anchors", anchors: list });
    if (!result) return;
    setHiding(null);
    setNotice({ ok: true, text: "remove" in h ? `Line ${line}: that moment shows the singer again.` : `Line ${line}: ${h.from}–${h.to} s of the singing take is hidden by ${data?.anchors.clips.find((c) => c.name === h.clip)?.label ?? h.clip}. The video cuts away and back on the beats nearest these times; the song plays on and the singer comes back in time. The next video uses it.` });
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
  const withSinging = showsSinging(style?.style ?? "singing", data.anchors.list.filter((x) => x.sync !== undefined).length);

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
              <span>The other shots follow the song&apos;s clip order (Prepare → Storyboard) in every video.</span>
              {!data.anchors.clips.length ? <span className="text-amber-200">No clips to choose from: add clips and photos or a collection in Prepare → Storyboard.</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-cut-bar>
              <CutWhilePlayingButton projectId={projectId} onChanged={() => (reloadAnchors(), void singer.reload(), void mvLines.reload())} />
              <span className="text-muted-foreground text-xs">Play the song and pick what shows, moment by moment (singer, then story).</span>
            </div>
            <MvLinesBar mv={mvLines} />
            {withSections ? <SectionsBar sections={sections} startMs={(n) => data.lines?.find((x) => x.number === n)?.startMs ?? null} /> : null}
            {withSinging ? <SingerBar singer={singer} lyrics={(data.lines ?? []).flatMap((l) => (l.startMs === null || l.startMs === undefined ? [] : [{ number: l.number, text: l.text, startMs: l.startMs, endMs: l.sungEndMs ?? l.startMs + 3000 }]))} /> : (
              <p className="text-muted-foreground text-xs" data-singing-off>The Lip sync column is hidden: this song&apos;s style is Cut to the song. Choose Add lip sync in Song Details to put the singer on lines.</p>
            )}
            {partPlatforms?.length ? (
              <div className="bg-card/60 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" data-reel-part title={part?.section.reason ?? undefined}>
                <span className="text-muted-foreground">Part of the song in</span>
                {partPlatforms.map((p) => (
                  <button key={p.name} type="button" onClick={() => setPartOf(p.name)} className={cn("rounded border px-1.5", partOf === p.name ? "border-brand text-brand" : "text-muted-foreground hover:text-foreground")} data-reel-part-platform={p.name}>
                    {p.label}
                  </button>
                ))}
                <span className="tabular-nums" data-reel-part-range>
                  {partState.loading
                    ? `planning where the ${partLabel} video starts…`
                    : partState.error
                      ? <span className="text-amber-200">{partState.error}</span>
                      : part && part.platform === partOf
                        ? <>
                            <span className="text-foreground">{clockTenths(part.songStartMs)} – {clockTenths(part.songStartMs + part.durationMs)}</span> of the song ({Math.round(part.durationMs / 1000)} s
                            {inPart?.first !== null && inPart?.first !== undefined ? `, from line ${inPart.first}` : ""}). Time in the video = time in the song − {clockTenths(part.songStartMs)}.
                          </>
                        : null}
                </span>
                <span className="text-muted-foreground">The next {partLabel} video, as planned now (Shape shows the same plan).</span>
              </div>
            ) : null}
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
                    {withSinging ? <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal whitespace-nowrap" title="Who sings this line, lips in time with the song: a lip-sync take made here from a picture or video (InfiniteTalk), or a shot of your music video">Singing (lips in time)</th> : null}
                    <th className="bg-background sticky top-0 z-10 border-b px-3 py-2 font-normal whitespace-nowrap min-w-36" title="The story clip (B-roll) on the line when nobody sings it; on a singing line, the B-roll it cuts away to">{withSinging ? "B-roll (no singing)" : "Shows clip"}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const start = startOf(l);
                    const delta = start - l.startMs; // unsaved change: the screen times shift with it
                    const changed = pending.has(l.number);
                    const anchor = data.anchors.list.find((a) => a.line === l.number) ?? null;
                    // A later line of a singing take over several lines (the take sits on its first line).
                    const sungWith = anchor ? null : (data.anchors.list.find((a) => a.sync !== undefined && a.line < l.number && l.number <= (a.through ?? a.line)) ?? null);
                    const anchorClip = anchor ? data.anchors.clips.find((c) => c.name.toLowerCase() === anchor.clip.toLowerCase()) : undefined;
                    const problems = data.anchors.problems.filter((p) => p.line === l.number);
                    // The clip on the line (27 Nov 2026, Paul: "only 2 parts: singing clip and no singing, the B-roll"): a singing clip shows in
                    // the singing column, a story clip (B-roll) in the B-roll column.
                    const anchorBlock = (
anchor ? (
                            <div className="flex max-w-56 min-w-0 items-center gap-2" data-anchor={anchor.clip}>
                              <Thumb clip={anchorClip} />
                              <div className="min-w-0 text-xs">
                                <div className="truncate" title={anchor.clip}>{anchorClip?.label ?? anchor.clip}</div>
                                <div className="text-muted-foreground">
                                  {anchor.sync !== undefined ? "singing · in time with the song" : anchor.transition === "dissolve" ? "dissolve" : "cut"}
                                  {anchor.clipIn ? ` · from ${anchor.clipIn} s` : ""}
                                </div>
                              </div>
                              <button type="button" disabled={busy} onClick={() => saveAnchor(l.number, null)} className="text-muted-foreground hover:text-foreground shrink-0 rounded-md border p-0.5" aria-label={`Remove the anchor on line ${l.number}`} title={anchor.sync !== undefined ? "Take this singing clip off the line (it is set to Omit and stays in Creation and the Storyboard). Lip sync stays as it is: to stop the singer here, choose — no singer in Lip sync." : undefined} data-anchor-remove>
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ) : null
                    );
                    const sectionHere = withSections ? (sections.view?.sections.find((x) => x.line === l.number) ?? null) : null;
                    return (
                      <Fragment key={l.number}>
                      {sectionHere ? <SectionHeaderRow section={sectionHere} sections={sections} colSpan={withSinging ? 9 : 8} /> : null}
                      <tr
                        data-line={l.number}
                        data-flagged={l.flagged && !l.checkedByEar ? "true" : undefined}
                        data-checked-by-ear={l.checkedByEar ? "true" : undefined}
                        data-in-reel={inPart ? (inPart.at.has(l.number) ? "true" : "false") : undefined}
                        className={cn("group border-b align-top last:border-b-0", l.flagged && !l.checkedByEar && "bg-amber-400/5", changed && "bg-brand/5", inPart && !inPart.at.has(l.number) && "opacity-55", inPart?.first === l.number && "border-t-brand border-t-2")}
                      >
                        <td className="text-muted-foreground px-3 py-2 tabular-nums">
                          {withSections && !sectionHere && sections.view ? (
                            <span className="flex items-center gap-0.5">
                              {l.number}
                              <StartSectionButton line={l.number} sections={sections} />
                            </span>
                          ) : (
                            l.number
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {l.isHook ? <Star className="text-brand size-3.5 shrink-0" aria-label="hook" /> : null}
                            <span>{l.text}</span>
                          </div>
                          {inPart?.first === l.number ? (
                            <p className="text-brand mt-1 text-xs" data-reel-starts-here>
                              The {partLabel} video starts here: at {clockTenths(part!.songStartMs)} in the song; this line is readable {clockTenths(Math.max(0, inPart.at.get(l.number)!))} into the video
                            </p>
                          ) : null}
                          {l.flagged ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-amber-200" data-flag-reason>
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span title={l.flagged} data-flag-why>{l.flagReason ?? "Flagged for review. Listen with ▶."}</span>
                            </p>
                          ) : null}
                          {l.handPushed ? (
                            <p className="text-muted-foreground mt-1 text-xs" data-hand-pushed>
                              Moved after line {l.handPushed.because}, which you set by hand: it started at {clockTenths(l.handPushed.fromMs)}, before that line.
                            </p>
                          ) : null}
                          {l.handSkipped ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-amber-200" data-hand-skipped>
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span>The start you set ({clockTenths(l.handSkipped.ms)}) is not used: {l.handSkipped.why}.</span>
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
                          {inPart ? (
                            inPart.at.has(l.number) ? (
                              <div className="text-brand mt-0.5" data-reel-time title={`Readable at this time in the ${partLabel} video (the Shape page's clock)`}>
                                in the {partLabel} {clockTenths(inPart.at.get(l.number)!)}
                              </div>
                            ) : (
                              <div className="mt-0.5" data-reel-time="none">not in the {partLabel}</div>
                            )
                          ) : null}
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
                        {withSinging ? (
                          <td className="px-3 py-2" data-singer-cell>
                            {anchor?.sync !== undefined ? <div className="mb-1">{anchorBlock}</div> : null}
                            <SingerCell singer={singer} number={l.number} />
                            {/* Music-video shots sing too: they belong with the lip sync (27 Nov 2026, Paul: "are we not mixing two things"). */}
                            <LineMvShots mv={mvLines} line={l.number} />
                          </td>
                        ) : null}
                        <td className="w-60 max-w-60 min-w-36 px-3 py-2" data-anchor-cell>
                          {withSinging && anchor?.sync !== undefined ? null : anchorBlock}
                          {anchor && anchor.sync !== undefined ? (
                            <div className="mt-1 flex flex-col gap-0.5 text-[11px]" data-hides={anchor.hide?.length ?? 0}>
                              {withSinging ? <span className="text-muted-foreground" data-broll-singer>The singer is on this line{anchor.hide?.length ? "; B-roll cuts away:" : "."}</span> : null}
                              {(anchor.hide ?? []).map((h, k) => (
                                <div key={`${h.from}-${h.to}`} className="flex items-center gap-1" data-hide={`${h.from}-${h.to}`}>
                                  <span className="min-w-0 flex-1 truncate" title={`${h.from}–${h.to} s of the take: ${h.clip} shows meanwhile`}>
                                    {h.from}–{h.to} s of the take: B-roll {data.anchors.clips.find((c) => c.name.toLowerCase() === h.clip.toLowerCase())?.label ?? h.clip}
                                  </span>
                                  <button type="button" disabled={busy} onClick={() => void saveHide(l.number, { remove: k })} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5" aria-label={`Show the singer again at ${h.from}–${h.to} s`} data-hide-remove>
                                    <X className="size-3" />
                                  </button>
                                </div>
                              ))}
                              <div className="flex gap-1">
                                <button type="button" disabled={busy} onClick={() => setHiding(l.number)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md border px-2 py-0.5 whitespace-nowrap" title="A few seconds of B-roll inside the singing take (a reaction, a detail, or where the lips are off): the song plays on and the singer comes back in time" data-hide-add>
                                  <EyeOff className="size-3" /> Cut away to B-roll
                                </button>
                                {anchor.hide?.length ? (
                                  <button type="button" onClick={() => setPreviewing(previewing === l.number ? null : l.number)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md border px-2 py-0.5" title="Plays the take with the song, the hidden moments covered" data-hide-preview>
                                    <Play className="size-3" /> Preview
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          {sungWith ? (
                            <div className="text-muted-foreground text-[11px]" data-anchor-continues={sungWith.line}>
                              {withSinging ? `The singer from line ${sungWith.line} continues here (one take): B-roll cut-aways are set on line ${sungWith.line}.` : `the singer from line ${sungWith.line} continues (one take)`}
                            </div>
                          ) : null}
                          {withSinging ? null : <LineMvShots mv={mvLines} line={l.number} />}
                          <button type="button" disabled={busy} onClick={() => setPicking(picking === l.number ? null : l.number)} className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] whitespace-nowrap" data-anchor-pick>
                            <Clapperboard className="size-3" /> {!withSinging ? (anchor ? "Change" : "Show a clip") : anchor?.sync !== undefined || sungWith ? "B-roll instead of the singer…" : anchor ? "Change B-roll" : "Add B-roll"}
                          </button>
                          {problems.map((p) => (
                            <p key={p.problem} className="mt-1 flex items-start gap-1 text-[11px] text-amber-200" data-anchor-problem>
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {p.problem}
                            </p>
                          ))}
                        </td>
                      </tr>
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

      {/* The picker sits in a dialog, so its clips are always fully in view (the table scrolls on its own). */}
      <Dialog open={picking !== null || hiding !== null} onOpenChange={(o) => !o && (setPicking(null), setHiding(null))}>
        <DialogContent className="w-[min(64rem,95vw)] max-w-none" data-anchor-picker>
          {(() => {
            const pl = lines.find((x) => x.number === (hiding ?? picking));
            if (!pl) return null;
            const current = data.anchors.list.find((a) => a.line === pl.number) ?? null;
            if (hiding !== null && current?.sync !== undefined) {
              const takeClip = data.anchors.clips.find((c) => c.name.toLowerCase() === current.clip.toLowerCase());
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>Hide a moment of the singing take on line {pl.number}</DialogTitle>
                    <DialogDescription>Where the lips are off: another clip shows meanwhile. The song plays on and the singer comes back in time.</DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[80vh] overflow-auto pr-1">
                    <AnchorPicker line={pl} clips={data.anchors.clips} current={null} busy={busy} hide={{ takeS: takeClip ? takeClip.durationMs / 1000 : null }} onSave={(a, m) => m && void saveHide(pl.number, { from: m.from, to: m.to, clip: a.clip, ...(a.clipIn ? { clipIn: a.clipIn } : {}) })} onCancel={() => setHiding(null)} />
                  </div>
                </>
              );
            }
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Show a clip on line {pl.number}</DialogTitle>
                  <DialogDescription>Pick one of the clips below; the app cuts it in on the beat.</DialogDescription>
                </DialogHeader>
                <div className="max-h-[80vh] overflow-auto pr-1">
                  <AnchorPicker line={pl} clips={data.anchors.clips} current={current} busy={busy} onSave={(a) => saveAnchor(pl.number, a)} onCancel={() => setPicking(null)} />
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {previewing !== null
        ? (() => {
            const a = data.anchors.list.find((x) => x.line === previewing && x.sync !== undefined);
            const takeClip = a ? data.anchors.clips.find((c) => c.name.toLowerCase() === a.clip.toLowerCase()) : undefined;
            if (!a?.hide?.length || !takeClip?.video || !data.song) return null;
            const covers = a.hide.map((h) => ({ fromS: h.from, toS: h.to, clipInS: h.clipIn ?? 0, video: data.anchors.clips.find((c) => c.name.toLowerCase() === h.clip.toLowerCase())?.video ?? null }));
            return <HidePreview key={previewing} title={`Line ${previewing}: the take with its hidden moments`} take={takeClip.video} song={data.song} syncS={a.sync!} hides={covers} onClose={() => setPreviewing(null)} />;
          })()
        : null}

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
  hide,
}: {
  line: LyricsLine;
  clips: AnchorClip[];
  current: LyricsView["anchors"]["list"][number] | null;
  busy: boolean;
  onSave: (a: LyricsView["anchors"]["list"][number], moment?: { from: number; to: number }) => void;
  onCancel: () => void;
  hide?: { takeS: number | null }; // "Hide a moment": from / to in seconds of the singing take (its length when known)
}) {
  const [clip, setClip] = useState(current?.clip ?? "");
  const [clipIn, setClipIn] = useState(current?.clipIn ? String(current.clipIn) : "");
  const [transition, setTransition] = useState<"cut" | "dissolve">(current?.transition ?? "cut");
  // Creation's takes first (as takes), then the song's other clips, then each collection; singing takes are never offered
  // here (they belong on their own lines: Who sings → Use this take).
  const groups = [...new Set(clips.map((c) => c.from))].filter((g) => g !== "singing").sort((a, b) => (a === "creation" ? -1 : b === "creation" ? 1 : a === "song" ? -1 : b === "song" ? 1 : 0));
  const chosen = clips.find((c) => c.name === clip);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const moment = hide && from !== "" && to !== "" && Number(to) > Number(from) && Number(from) >= 0 && (hide.takeS === null || Number(from) < hide.takeS) ? { from: Math.round(Number(from) * 10) / 10, to: Math.round(Math.min(Number(to), hide.takeS ?? Infinity) * 10) / 10 } : null;
  const lineMs = moment ? (moment.to - moment.from) * 1000 : (line.sungEndMs ?? line.screen.leaveMs) - line.screen.readableMs;
  const left = chosen && chosen.kind === "video" ? chosen.durationMs - (Number(clipIn) || 0) * 1000 : null;
  const save = (name: string) => {
    if (!name || busy || (hide && !moment)) return;
    onSave({ line: line.number, clip: name, ...(Number(clipIn) > 0 ? { clipIn: Number(clipIn) } : {}), ...(transition === "dissolve" && !hide ? { transition } : {}) }, moment ?? undefined);
  };
  return (
    <div className="flex flex-col gap-3">
      {hide ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-hide-times>
          <strong>Hide from</strong>
          <input type="number" min={0} step={0.1} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="6" className="bg-background w-16 rounded-md border px-1.5 py-0.5" data-hide-from />
          <strong>to</strong>
          <input type="number" min={0} step={0.1} value={to} onChange={(e) => setTo(e.target.value)} placeholder="8" className="bg-background w-16 rounded-md border px-1.5 py-0.5" data-hide-to />
          <span>s of the take{hide.takeS ? ` (it lasts ${hide.takeS.toFixed(1)} s)` : ""}: the seconds the take&apos;s own player shows. Then pick the clip that shows meanwhile.</span>
        </div>
      ) : null}
      <p className="text-xs" hidden={!!hide}>
        <strong>Show this clip on line {line.number} (no singing).</strong> Line {line.number} &quot;{line.text}&quot; lands on a clip: it cuts in on the downbeat at or just before the line ({(lineMs / 1000).toFixed(1)} s on screen) and stays until the line ends.
      </p>
      <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b py-2 text-xs" data-anchor-controls>
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
            <AlertTriangle className="size-3" /> {chosen!.label ?? chosen!.name} has {(Math.max(0, left) / 1000).toFixed(1)} s from there: it will be slowed to cover the line (QA warns)
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!clip || busy || (!!hide && !moment)}
            onClick={() => save(clip)}
            data-anchor-save
          >
            <Save /> {chosen ? `Save: ${chosen.label ?? chosen.name}` : "Save"}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-[11px]">Click a clip, then Save (or double-click it).</p>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px]" data-anchor-group={g}>
            {g === "creation" ? "From Creation: your takes (a take not in the Storyboard yet is sent there when you save)" : g === "song" ? (groups.includes("creation") ? "Your other clips" : "This song's clips") : `Collection ${g}`}
          </span>
          <div className="flex flex-wrap gap-2">
            {clips
              .filter((c) => c.from === g)
              .map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setClip(c.name)}
                  onDoubleClick={() => save(c.name)}
                  className={cn("flex w-20 flex-col items-center gap-1 rounded-md border p-1 text-[10px]", clip === c.name ? "border-brand bg-brand/10" : "hover:border-foreground/30")}
                  title={`${c.label ? `${c.label} (${c.name})` : c.name} · ${c.kind === "photo" ? "photo" : `${(c.durationMs / 1000).toFixed(1)} s`} · ${c.orientation}`}
                  data-anchor-clip={c.name}
                >
                  <div className="bg-muted h-24 w-full overflow-hidden rounded">
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                      <img src={`/api/files/${c.thumb}`} alt="" className="size-full object-cover" />
                    ) : c.video ? (
                      // A take not in the Storyboard yet: its own file (plays on hover)
                      <video src={`/api/files/${c.video.split("/").map(encodeURIComponent).join("/")}#t=0.1`} muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={(e) => e.currentTarget.pause()} className="size-full object-cover" />
                    ) : null}
                  </div>
                  {c.take && c.label ? (
                    <>
                      <span className="w-full truncate font-semibold" data-anchor-take={`${c.take.picture}#${c.take.n}`}>{c.label.split(" · ").at(-1)}</span>
                      <span className="text-muted-foreground w-full truncate">{c.label.split(" · ").slice(0, -1).join(" · ")}</span>
                    </>
                  ) : (
                    <span className="w-full truncate">{c.label ?? c.name}</span>
                  )}
                  <span className="text-muted-foreground">{c.kind === "photo" ? "photo" : `${(c.durationMs / 1000).toFixed(1)} s`}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
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
          The words change: the next video aligns the lyrics again (a few minutes; needs the AI packages), and hand-set times of changed lines are ignored. The old lyrics.txt is kept: Restore it in Prepare → Assets → Replaced files. Press Save again to go ahead.
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
    </section>
  );
}
