"use client";

// A music video made elsewhere, on its Creation tile (27 Nov 2026, Paul: WaveSpeed's Music Video Generator made "the
// same bride singing in different scenes and camera angles"). "This is a music video of this song": the app finds where
// it sits in the song (its sound is the song) and its shots; Paul picks the shots he likes and each goes on its lines
// in time with the song (a singing take, like Lyrics Sync's), or to the Storyboard when it has no sung line.
import { Check, ChevronDown, ChevronRight, Clapperboard, ListChecks, Loader2, Music2, RefreshCw, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import type { PictureView } from "@lyric/video/animate";

import { shapeNote } from "@/components/mv-lines";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const linesName = (first: number, last: number) => (last > first ? `lines ${first}–${last}` : `line ${first}`);

export function MusicVideoPanel({ p, url, cap, post, reload, setNotice, play }: { p: PictureView; url: string; cap: number; post: (b: Record<string, unknown>) => Promise<unknown>; reload: () => Promise<void>; setNotice: (n: { ok: boolean; text: string }) => void; play: (url: string, title: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  // Folded by default (27 Nov 2026, Paul: "we don't need a visualizer on the upload screen"): the shots show next to each
  // planned shot (Production) and on each line (Lyrics Sync).
  const [showShots, setShowShots] = useState(false);
  const mv = p.mv;
  async function run(key: string, body: Record<string, unknown>, done: (r: unknown) => string) {
    setBusy(key);
    try {
      const r = await post({ ...body, file: p.file });
      setNotice({ ok: true, text: done(r) });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const check = () =>
    void run("check", { action: "mv-check" }, (r) => {
      const m = (r as { mv: { matched: boolean; shots: unknown[]; offsetMs: number } }).mv;
      return m.matched ? `Found in the song from ${clock(m.offsetMs)}: ${m.shots.length} shots. Pick the ones you like.` : "Its sound is not this song: it stays an ordinary video.";
    });

  if (!mv) {
    return (
      <button type="button" data-mv-check onClick={check} disabled={busy !== null} className="hover:bg-accent flex items-center gap-1.5 self-start rounded border px-1.5 py-1 text-[11px]" title="For a music video made elsewhere (e.g. WaveSpeed's Music Video Generator) from this song: the app finds where it sits in the song and its shots, so each shot can go on its lines in time">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Music2 className="size-3" />} {busy ? "Listening and finding its shots…" : "This is a music video of this song"}
      </button>
    );
  }
  if (!mv.matched) {
    return (
      <div data-mv-nomatch className="flex flex-col gap-1 text-[11px] text-amber-300">
        <span>Its sound is not this song (it matches {Math.round(Math.max(0, mv.score) * 100)}%), so its lips cannot be put in time. It stays an ordinary video: Send to Storyboard to use it as it is.</span>
        <button type="button" data-mv-check onClick={check} disabled={busy !== null} className="hover:bg-accent self-start rounded border px-1.5 py-0.5 text-foreground">
          Check again
        </button>
      </div>
    );
  }
  const reanalyse = () =>
    void run("reanalyse", { action: "mv-reanalyse" }, (r) => {
      const m = (r as { mv: { shots: unknown[] } }).mv;
      return `Looked again: ${m.shots.length} shot${m.shots.length === 1 ? "" : "s"}. Your takes and picks stay as they are.`;
    });
  const free = mv.shots.filter((s) => s.first !== null && !s.inUse).length;
  // Shots on their lines still below 1080p (no final yet): Make final on each (Video Upscaler Pro, $0.04 a second, at least 3 s).
  const toHd = mv.shots.filter((s) => s.first !== null && s.inUse && !s.hd);
  const hdUsd = toHd.reduce((sum, s) => sum + Math.max(3, Math.ceil((s.toMs - s.fromMs) / 1000)) * 0.04, 0);
  return (
    <div data-mv className="flex flex-col gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 p-1.5 text-[11px]">
      <span data-mv-summary className="text-sky-200" title={`Its sound matches the song ${(mv.score * 100).toFixed(1)}%, the same all along (drift ${mv.driftMs} ms)`}>
        <Clapperboard className="mr-1 inline size-3" />
        Music video · song {clock(mv.offsetMs)}–{clock(mv.offsetMs + mv.durationMs)} · {mv.shots.length} shots, {mv.singing} with singing{mv.usd !== null ? ` · about $${mv.usd.toFixed(2)} on WaveSpeed` : ""}
      </span>
      {shapeNote(mv.width, mv.height) ? (
        <span data-mv-shape className="text-amber-200/90">
          {shapeNote(mv.width, mv.height)}. For the other shape, make it again at {mv.width! > mv.height! ? "9:16" : "16:9"}.
        </span>
      ) : null}
      {mv.height !== null && mv.width !== null && Math.min(mv.height, mv.width) < 700 ? (
        <span data-mv-small className="text-muted-foreground">{mv.width}×{mv.height}: soft on a 1080p video. For a Reel, make it at 9:16 and 720p.</span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" data-mv-use-all disabled={busy !== null || free === 0} onClick={() => void run("all", { action: "mv-use-all" }, (r) => `${(r as { used: unknown[] }).used.length} singing shots are on their lines, in time with the song.`)} title="Every shot where she sings goes on its lines, locked to the song (you can still take any off in Lyrics Sync)">
          {busy === "all" ? <Loader2 className="animate-spin" /> : <ListChecks />} Use every singing shot
        </Button>
        <span className="text-muted-foreground">or pick the ones you like below</span>
      </span>
      {toHd.length ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" data-mv-final disabled={busy !== null || hdUsd > cap} onClick={() => void run("hd", { action: "mv-final", cap }, (r) => `${(r as { shots: number }).shots} shots are being made 1080p (about $${(r as { usd: number }).usd.toFixed(2)}): each takes its own place on its lines when it is ready.`)} title="WaveSpeed Video Upscaler Pro: the same shot, sharper, at 1080p; it replaces the shot on its lines, still in time">
            {busy === "hd" ? <Loader2 className="animate-spin" /> : <Sparkles />} Make the shots in use 1080p
          </Button>
          <span data-mv-final-cost className={cn(hdUsd > cap ? "text-amber-300" : "text-muted-foreground")}>
            {toHd.length} shot{toHd.length === 1 ? "" : "s"} · about ${hdUsd.toFixed(2)}
            {hdUsd > cap ? ` · above your cap of $${cap.toFixed(2)}` : ""}
          </span>
        </span>
      ) : null}
      <span className="text-muted-foreground">Its shots show next to each planned shot (Production) and on each line (Prepare → Lyrics Sync).</span>
      <button type="button" data-mv-reanalyse onClick={reanalyse} disabled={busy !== null} className="hover:text-foreground text-muted-foreground flex items-center gap-1 self-start" title="Looks for the video's shots again with the newest check; your takes and picks stay">
        {busy === "reanalyse" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Find its shots again
      </button>
      <button type="button" data-mv-show-shots onClick={() => setShowShots((v) => !v)} className="hover:text-foreground text-muted-foreground flex items-center gap-1 self-start">
        {showShots ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Show its shots ({mv.shots.length})
      </button>
      {showShots ? (
      <div className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
        {mv.shots.map((s) => (
          <div key={s.i} data-mv-shot={s.i} data-mv-lines={s.first ?? ""} className="flex items-center gap-1.5">
            <button type="button" onClick={() => play(`${url}#t=${(s.fromMs / 1000).toFixed(2)},${(s.toMs / 1000).toFixed(2)}`, `${p.label ?? p.file} · shot ${s.i + 1}`)} className="shrink-0" title="Watch this shot">
              <video src={`${url}#t=${((s.fromMs + s.toMs) / 2000).toFixed(2)}`} muted playsInline preload="metadata" className="bg-muted h-10 w-16 rounded object-cover" />
            </button>
            {/* Two lines: the shot and its time, then its lines and first words (readable in a narrow tile too). */}
            <span className="flex min-w-0 flex-1 flex-col leading-tight" title={s.text ?? undefined}>
              <span className="whitespace-nowrap">
                <b>Shot {s.i + 1}</b> · {clock(s.songFromMs)}–{clock(s.songToMs)}
              </span>
              <span className="line-clamp-2">{s.first !== null ? <>{linesName(s.first, s.last ?? s.first)}{s.text ? <span className="text-muted-foreground"> “{s.text}”</span> : null}</> : <span className="text-muted-foreground">no sung line</span>}</span>
            </span>
            {s.inUse ? (
              <span data-mv-shot-used className="flex shrink-0 items-center gap-1 text-emerald-300">
                <Check className="size-3" /> {s.first !== null ? "Synced on its lines" : "In Storyboard"}
                {s.hd ? <span data-mv-hd={s.hd} className={cn("rounded px-1", s.hd === "done" ? "bg-emerald-400/15" : "bg-sky-400/15 text-sky-200")}>{s.hd === "done" ? "1080p" : s.hd === "running" ? "1080p…" : "1080p: Get result below"}</span> : null}
              </span>
            ) : (
              <button
                type="button"
                data-mv-use={s.i}
                disabled={busy !== null}
                onClick={() => void run(`shot${s.i}`, { action: "mv-use", shot: s.i }, () => (s.first !== null ? `Shot ${s.i + 1} is on ${linesName(s.first, s.last ?? s.first)}, in time with the song.` : `Shot ${s.i + 1} is in your Storyboard (the end of your story line).`))}
                className={cn("hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5", busy === `shot${s.i}` && "opacity-60")}
                title={s.first !== null ? "This shot goes on its lines, locked to the song: her lips stay in time" : "No sung line in this shot: it goes to your Storyboard as a story clip"}
              >
                {busy === `shot${s.i}` ? <Loader2 className="size-3 animate-spin" /> : s.first !== null ? <Check className="size-3" /> : <Send className="size-3" />}
                {s.first !== null ? "Use on its lines" : "Send to Storyboard"}
              </button>
            )}
          </div>
        ))}
      </div>
      ) : null}
      {mv.earlier?.length ? (
        <span data-mv-earlier className="text-muted-foreground">
          From an earlier split of the video (they stay where they are): {mv.earlier.map((e) => `${e.label}${e.first !== null ? `, ${linesName(e.first, e.last ?? e.first)}` : ""}${e.inUse ? " (in use)" : ""}`).join("; ")}.
        </span>
      ) : null}
    </div>
  );
}
