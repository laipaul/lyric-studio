"use client";

// Lyrics Sync → Singer (21 Nov 2026, Paul's workflow): tick the lines where the singer shows, each with a picture or
// video from Creation; "Make singing clips" sends each line's vocal with it to WaveSpeed InfiniteTalk (cost first, your
// Creation cap). Each clip comes back into Creation, the Storyboard and onto its line, and Make plays it in time with
// the song. API: /api/songs/[id]/singer.
import { Check, Loader2, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SingerLine, SingerView } from "@lyric/video/singer";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;

export type Singer = {
  view: SingerView | null;
  cap: number;
  error: string | null;
  notice: { ok: boolean; text: string } | null;
  busy: boolean;
  setLine: (line: number, source: string | null) => Promise<void>;
  make: () => Promise<void>;
};

// `onMade`: called when singing clips finish (the Lyrics tab reloads its anchors).
export function useSinger(projectId: string, onMade: () => void): Singer {
  const [view, setView] = useState<SingerView | null>(null);
  const [cap, setCap] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api(`/api/songs/${projectId}/singer`, { cache: "no-store" });
      const d = (await r.json()) as { singer?: SingerView; cap?: number; error?: string };
      if (!r.ok || !d.singer) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setView(d.singer);
      if (d.cap) setCap(d.cap);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the singing lines, read once the tab is shown
    void load();
  }, [load]);
  const running = !!view?.lines?.some((l) => l.take?.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [running, load]);
  // A singing clip landed on its line: the Lyrics tab's anchors changed.
  const done = view?.lines?.filter((l) => l.take?.status === "done").map((l) => `${l.number}:${l.take!.n}`).join(",") ?? null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (done === null) return;
    if (seen.current !== null && seen.current !== done) onMade();
    seen.current = done;
  }, [done, onMade]);

  async function post(body: Record<string, unknown>) {
    const r = await api(`/api/songs/${projectId}/singer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json()) as { error?: string; usd?: number; seconds?: number; jobs?: unknown[] };
    if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
    return d;
  }
  return {
    view,
    cap,
    error,
    notice,
    busy,
    setLine: async (line, source) => {
      try {
        await post({ action: "line", line, source });
        await load();
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      }
    },
    make: async () => {
      setBusy(true);
      try {
        const d = await post({ action: "make" });
        setNotice({ ok: true, text: `${d.jobs?.length ?? 0} singing clip${d.jobs?.length === 1 ? "" : "s"} sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}). Each lands on its line by itself when it is ready (a few minutes each).` });
        await load();
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
  };
}

export function SingerBar({ singer }: { singer: Singer }) {
  const v = singer.view;
  if (singer.error) return <p className="text-destructive text-xs">{singer.error}</p>;
  if (!v?.lines) return null;
  const ticked = v.lines.filter((l) => l.source).length;
  const over = v.toMake.usd > singer.cap;
  return (
    <div data-singer className="bg-card/60 flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Mic className="text-brand size-4" />
        <span className="font-medium">Singer</span>
        <span className="text-muted-foreground" data-singer-summary>
          {ticked ? `${ticked} line${ticked === 1 ? "" : "s"} where the singer shows` : "Choose a picture or video in the Singer column on the lines where the singer shows."}
          {v.toMake.lines.length ? ` · to make: ${v.toMake.lines.length} (${v.toMake.seconds} s of voice, about ${money(v.toMake.usd)})` : ticked ? " · all made" : ""}
          {over ? ` · above your cap of ${money(singer.cap)} (Creation → Your defaults)` : ""}
        </span>
        {v.toMake.lines.length ? (
          <Button type="button" size="sm" data-singer-make disabled={singer.busy || !v.ready || over} onClick={() => void singer.make()} title={!v.ready ? "No WaveSpeed key yet" : over ? `Above your cap of ${money(singer.cap)}` : undefined}>
            {singer.busy ? <Loader2 className="animate-spin" /> : <Mic />} Make singing clips
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        Each line&apos;s voice is sent with its picture or video to WaveSpeed InfiniteTalk ({money(v.usdPerSecond)} per second). The clip comes back into Creation and your Storyboard, lands on its line and always plays in time with the song: Make cuts to it on the beat. The voice is {v.voice === "stem" ? "your vocal stem" : "the song itself (add your vocal stem in Assets for cleaner lips)"}.
      </p>
      {!v.ready ? (
        <p data-singer-nokey className="text-amber-200">
          No WaveSpeed key yet: nothing is sent. Add a line <code>{v.keyName}=…</code> with your own key to the file <code>D:\videomaker\.env</code> (not .env.example), then restart Lyric Studio.
        </p>
      ) : null}
      {singer.notice ? (
        <p data-singer-notice={singer.notice.ok ? "ok" : "error"} className={singer.notice.ok ? "text-emerald-200" : "text-red-200"}>
          {singer.notice.text}
        </p>
      ) : null}
    </div>
  );
}

// The Singer cell of one line: what it is sung from (a dropdown of Creation's pictures and videos) and its clip's state.
export function SingerCell({ singer, number }: { singer: Singer; number: number }) {
  const v = singer.view;
  const l: SingerLine | undefined = v?.lines?.find((x) => x.number === number);
  if (!v || !l) return null;
  const t = l.take;
  return (
    <div className="flex flex-col gap-1 text-[11px]" data-singer-line={number}>
      <select
        data-singer-source
        value={l.source ?? ""}
        onChange={(e) => void singer.setLine(number, e.target.value || null)}
        className={cn("bg-background max-w-40 rounded-md border px-1.5 py-0.5", l.source && "border-brand/60")}
        aria-label={`Singer on line ${number}`}
      >
        <option value="">—</option>
        {v.sources.map((s) => (
          <option key={s.file} value={s.file}>
            {s.file}
            {s.kind === "video" ? " (video)" : ""}
          </option>
        ))}
      </select>
      {l.source && t ? (
        <span data-singer-status={t.status} className={cn(t.status === "done" ? "text-emerald-300" : t.status === "running" ? "text-muted-foreground" : "text-amber-200")}>
          {t.status === "done" ? (
            <>
              <Check className="inline size-3" /> {l.needed ? "made for an earlier timing: make again" : "singing clip on this line"}
            </>
          ) : t.status === "running" ? (
            <>
              <Loader2 className="inline size-3 animate-spin" /> being made…
            </>
          ) : (
            t.error
          )}
        </span>
      ) : l.source ? (
        <span className="text-muted-foreground" data-singer-status="todo">
          {l.piece.seconds} s · about {money(l.piece.usd)}
        </span>
      ) : null}
      {!v.sources.length ? <span className="text-muted-foreground">Add pictures in Creation first</span> : null}
    </div>
  );
}
