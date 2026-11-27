"use client";

// "Make a music video" (27 Nov 2026, Paul: "go"): Paul picks the singer's pictures and a few words; the app sends the
// stretch of the song (his latest Reel's section by default) to WaveSpeed's Music Video Generator, cost first and under
// his cap, and files the video in Creation, already found in the song and split into shots (music-video.ts).
import { Clapperboard, Loader2 } from "lucide-react";
import { useState } from "react";

import type { MvMakeOptions } from "@lyric/video/music-video";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const PLATFORM: Record<string, string> = { reels: "Reel", tiktok: "TikTok", shorts: "Shorts" };

export function MakeMusicVideo({ opts, pictures, cap, post, reload, setNotice }: { opts: MvMakeOptions; pictures: { file: string; url: string; label: string | null }[]; cap: number; post: (b: Record<string, unknown>) => Promise<unknown>; reload: () => Promise<void>; setNotice: (n: { ok: boolean; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [kind, setKind] = useState<"latest" | "whole" | "lines">(opts.latest ? "latest" : opts.chorus ? "lines" : "whole");
  const [first, setFirst] = useState(opts.chorus?.first ?? opts.lines[0]?.number ?? 1);
  const [last, setLast] = useState(opts.chorus?.last ?? opts.lines.at(-1)?.number ?? 1);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  // The cost from the stretch's length (for lines the server snaps the stretch to bars: shown per second).
  const approxMs = kind === "whole" ? opts.durationMs : kind === "latest" && opts.latest ? opts.latest.toMs - opts.latest.fromMs : null;
  const seconds = approxMs !== null ? Math.max(3, Math.ceil(approxMs / 1000)) : null;
  const usd = seconds !== null ? seconds * opts.usdPerSecond[resolution] : null;
  const over = usd !== null && usd > cap;
  async function make() {
    setBusy(true);
    try {
      const r = (await post({ action: "mv-make", pictures: chosen, section: kind === "lines" ? { kind, first, last } : { kind }, aspect, resolution, words, cap })) as { take: { cost_usd: number; seconds: number } };
      setNotice({ ok: true, text: `Sent to WaveSpeed: ${r.take.seconds} s of the song at ${resolution}, about $${r.take.cost_usd.toFixed(2)}. It takes about 3-6 minutes per minute of song (the Tasks menu shows it); it lands here in Creation, already split into shots.` });
      setOpen(false);
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <button type="button" data-mv-make-open onClick={() => setOpen(true)} className="hover:bg-accent flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-xs" title="WaveSpeed's Music Video Generator: your singer singing this song in several scenes and camera angles, lips in time">
        <Clapperboard className="size-3.5" /> Make a music video…
      </button>
    );
  }
  return (
    <div data-mv-make className="bg-card/40 flex flex-col gap-2 rounded-lg border border-sky-500/30 p-2 text-xs">
      <span className="font-medium">Make a music video (WaveSpeed)</span>
      <span className="text-muted-foreground">Your singer, singing this stretch of the song in several scenes and camera angles, lips in time. It comes back here, already split into shots you can put on their lines.</span>
      <div className="flex flex-col gap-1">
        <span>Pictures of the singer (1 to 3, clear and facing the camera, all the same person):</span>
        <div className="flex flex-wrap gap-1.5">
          {pictures.map((p) => {
            const on = chosen.includes(p.file);
            return (
              <button key={p.file} type="button" data-mv-make-picture={p.file} aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== p.file) : chosen.length < 3 ? [...chosen, p.file] : chosen)} className={cn("rounded border-2 p-0.5", on ? "border-sky-400" : "border-transparent opacity-70 hover:opacity-100")} title={p.label ?? p.file}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local picture served by /api/files */}
                <img src={p.url} alt={p.label ?? p.file} className="h-14 w-11 rounded object-cover" />
              </button>
            );
          })}
          {!pictures.length ? <span className="text-muted-foreground">Add a picture of the singer to Creation first.</span> : null}
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-1.5">
        Stretch of the song
        <select data-mv-make-section value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="bg-background rounded-md border px-1.5 py-1">
          {opts.latest ? (
            <option value="latest">
              Your {PLATFORM[opts.latest.platform] ?? opts.latest.platform}&apos;s section ({clock(opts.latest.fromMs)}–{clock(opts.latest.toMs)})
            </option>
          ) : null}
          {opts.lines.length ? <option value="lines">These lines…</option> : null}
          <option value="whole">Whole song ({clock(opts.durationMs)})</option>
        </select>
        {kind === "lines" ? (
          <>
            from
            <select data-mv-make-first value={first} onChange={(e) => { const v = Number(e.target.value); setFirst(v); if (last < v) setLast(v); }} className="bg-background max-w-48 rounded-md border px-1.5 py-1">
              {opts.lines.map((l) => (
                <option key={l.number} value={l.number}>
                  {l.number}. {l.text}
                </option>
              ))}
            </select>
            to
            <select data-mv-make-last value={last} onChange={(e) => setLast(Number(e.target.value))} className="bg-background max-w-48 rounded-md border px-1.5 py-1">
              {opts.lines.filter((l) => l.number >= first).map((l) => (
                <option key={l.number} value={l.number}>
                  {l.number}. {l.text}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </label>
      <span className="flex flex-wrap items-center gap-1.5">
        <select data-mv-make-aspect value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} className="bg-background rounded-md border px-1.5 py-1" aria-label="Shape">
          <option value="9:16">9:16 (Reels, TikTok, Shorts)</option>
          <option value="16:9">16:9 (YouTube)</option>
        </select>
        <select data-mv-make-resolution value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)} className="bg-background rounded-md border px-1.5 py-1" aria-label="Resolution">
          <option value="720p">720p (${opts.usdPerSecond["720p"].toFixed(2)} a second)</option>
          <option value="480p">480p, a cheap try (${opts.usdPerSecond["480p"].toFixed(2)} a second)</option>
        </select>
      </span>
      <textarea data-mv-make-words value={words} onChange={(e) => setWords(e.target.value)} maxLength={2000} rows={3} placeholder="The scenes in your words (optional), e.g. the bride sings in a quiet bridal room, then in a golden-hour garden… Your Film look and “the same person, no microphone” are added." className="bg-background rounded-md border px-2 py-1" />
      <span className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" data-mv-make-send disabled={busy || !chosen.length || !opts.ready || over} onClick={() => void make()} title={!opts.ready ? "No WaveSpeed key yet" : !chosen.length ? "Pick a picture of the singer" : over ? `Above your cap of $${cap.toFixed(2)}` : undefined}>
          {busy ? <Loader2 className="animate-spin" /> : <Clapperboard />} Make music video
        </Button>
        <span data-mv-make-cost className={cn(over ? "text-amber-300" : "text-muted-foreground")}>
          {usd !== null ? `${seconds} s · about $${usd.toFixed(2)}` : `about $${opts.usdPerSecond[resolution].toFixed(2)} a second of song (from the bar before the first line to a bar after the last)`}
          {over ? ` · above your cap of $${cap.toFixed(2)}` : ""}
          {!opts.ready ? " · no WaveSpeed key yet" : ""}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground ml-auto">
          Close
        </button>
      </span>
    </div>
  );
}
