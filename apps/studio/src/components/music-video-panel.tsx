"use client";

// A music video made elsewhere, on its Creation tile (27 Nov 2026, Paul: WaveSpeed's Music Video Generator made "the
// same bride singing in different scenes and camera angles"). "This is a music video of this song": the app finds where
// it sits in the song (its sound is the song) and its shots; Paul picks the shots he likes and each goes on its lines
// in time with the song (a singing take, like Lyrics Sync's), or to the Storyboard when it has no sung line.
import { Check, Clapperboard, ListChecks, Loader2, Music2, Send } from "lucide-react";
import { useState } from "react";

import type { PictureView } from "@lyric/video/animate";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const linesName = (first: number, last: number) => (last > first ? `lines ${first}–${last}` : `line ${first}`);

export function MusicVideoPanel({ p, url, post, reload, setNotice, play }: { p: PictureView; url: string; post: (b: Record<string, unknown>) => Promise<unknown>; reload: () => Promise<void>; setNotice: (n: { ok: boolean; text: string }) => void; play: (url: string, title: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
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
  const free = mv.shots.filter((s) => s.first !== null && !s.inUse).length;
  return (
    <div data-mv className="flex flex-col gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 p-1.5 text-[11px]">
      <span data-mv-summary className="text-sky-200" title={`Its sound matches the song ${(mv.score * 100).toFixed(1)}%, the same all along (drift ${mv.driftMs} ms)`}>
        <Clapperboard className="mr-1 inline size-3" />
        Music video · song {clock(mv.offsetMs)}–{clock(mv.offsetMs + mv.durationMs)} · {mv.shots.length} shots, {mv.singing} with singing{mv.usd !== null ? ` · about $${mv.usd.toFixed(2)} on WaveSpeed` : ""}
      </span>
      {mv.height !== null && mv.width !== null && Math.min(mv.height, mv.width) < 700 ? (
        <span data-mv-small className="text-muted-foreground">{mv.width}×{mv.height}: soft on a 1080p video. For a Reel, make it at 9:16 and 720p.</span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" data-mv-use-all disabled={busy !== null || free === 0} onClick={() => void run("all", { action: "mv-use-all" }, (r) => `${(r as { used: unknown[] }).used.length} singing shots are on their lines, in time with the song.`)} title="Every shot where she sings goes on its lines, locked to the song (you can still take any off in Lyrics Sync)">
          {busy === "all" ? <Loader2 className="animate-spin" /> : <ListChecks />} Use every singing shot
        </Button>
        <span className="text-muted-foreground">or pick the ones you like:</span>
      </span>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
        {mv.shots.map((s) => (
          <div key={s.i} data-mv-shot={s.i} data-mv-lines={s.first ?? ""} className="flex items-center gap-1.5">
            <button type="button" onClick={() => play(`${url}#t=${(s.fromMs / 1000).toFixed(2)},${(s.toMs / 1000).toFixed(2)}`, `${p.label ?? p.file} · shot ${s.i + 1}`)} className="shrink-0" title="Watch this shot">
              <video src={`${url}#t=${((s.fromMs + s.toMs) / 2000).toFixed(2)}`} muted playsInline preload="metadata" className="bg-muted h-10 w-16 rounded object-cover" />
            </button>
            <span className="min-w-0 flex-1 truncate" title={s.text ?? undefined}>
              <b>Shot {s.i + 1}</b> · {clock(s.songFromMs)}–{clock(s.songToMs)} · {s.first !== null ? <>{linesName(s.first, s.last ?? s.first)}{s.text ? <span className="text-muted-foreground"> “{s.text}”</span> : null}</> : <span className="text-muted-foreground">no sung line</span>}
            </span>
            {s.inUse ? (
              <span data-mv-shot-used className="flex shrink-0 items-center gap-1 text-emerald-300">
                <Check className="size-3" /> {s.first !== null ? "On its lines" : "In Storyboard"}
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
    </div>
  );
}
