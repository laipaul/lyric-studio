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
  setScript: (line: number, script: string) => Promise<void>;
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
    setScript: async (line, script) => {
      try {
        await post({ action: "script", line, script });
        await load();
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      }
    },
    make: async () => {
      setBusy(true);
      try {
        const d = await post({ action: "make" });
        setNotice({ ok: true, text: `${d.jobs?.length ?? 0} singing clip${d.jobs?.length === 1 ? "" : "s"} sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}). Each lands on its line by itself when it is ready (a few minutes each); follow it in Tasks.` });
        window.dispatchEvent(new Event("lyric-tasks-changed")); // the Tasks menu opens with it
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
          {ticked ? `${ticked} line${ticked === 1 ? "" : "s"} where the singer shows` : "Choose a picture or video in the Who sings column on the lines where the singer shows."}
          {v.toMake.lines.length ? ` · to make: ${v.toMake.lines.length} take${v.toMake.lines.length === 1 ? "" : "s"} (${v.toMake.seconds} s of voice, about ${money(v.toMake.usd)})` : ticked ? " · all made" : ""}
          {over ? ` · above your cap of ${money(singer.cap)} (Creation → Your defaults)` : ""}
        </span>
        {v.toMake.lines.length ? (
          <Button type="button" size="sm" data-singer-make disabled={singer.busy || !v.ready || over} onClick={() => void singer.make()} title={!v.ready ? "No WaveSpeed key yet" : over ? `Above your cap of ${money(singer.cap)}` : undefined}>
            {singer.busy ? <Loader2 className="animate-spin" /> : <Mic />} Make singing clips
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        Lines in a row with the same picture are sung in one continuous take. Each take&apos;s voice is sent with its picture or video to WaveSpeed InfiniteTalk ({money(v.usdPerSecond)} per second). The clip comes back into Creation and your Storyboard, lands on its line and always plays in time with the song: Make cuts to it on the beat. The voice is {v.voice === "stem" ? "your vocal stem" : "the song itself (add your vocal stem in Assets for cleaner lips)"}.
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
  const inRun = !!l.run && l.run.last > l.run.first;
  const later = inRun && l.run!.first !== l.number; // a later line of a run: its take is made with the run's first line
  return (
    <div className="flex flex-col gap-1 text-[11px]" data-singer-line={number}>
      <SourcePicker sources={v.sources} value={l.source} onChange={(src) => void singer.setLine(number, src)} line={number} />
      {l.source && !later ? <ScriptField key={l.script} line={number} value={l.script} onSave={(text) => singer.setScript(number, text)} /> : null}
      {l.source && later ? (
        <span className="text-muted-foreground" data-singer-status="run">
          sung with line {l.run!.first} take
          {t?.status === "done" && !l.needed ? " · made" : ""}
        </span>
      ) : l.source && t ? (
        <span data-singer-status={t.status} className={cn(t.status === "done" ? "text-emerald-300" : t.status === "running" ? "text-muted-foreground" : "text-amber-200")}>
          {t.status === "done" ? (
            <>
              <Check className="inline size-3" /> {l.needed ? "made for an earlier timing: make again" : inRun ? `singing clip on lines ${l.run!.first}-${l.run!.last}` : "singing clip on this line"}
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
          {inRun ? `lines ${l.run!.first}-${l.run!.last} in one take · ` : ""}
          {l.piece.seconds} s · about {money(l.piece.usd)}
        </span>
      ) : null}
      {!v.sources.length ? <span className="text-muted-foreground">Add pictures in Creation first</span> : null}
    </div>
  );
}

// The block's little script: what the singer does while singing ("turns to the sea, soft smile"), sent with the voice.
function ScriptField({ line, value, onSave }: { line: number; value: string; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  const save = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next !== value) void onSave(next);
  };
  return (
    <input
      data-singer-script={line}
      value={text}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      placeholder="What the singer does (optional)"
      title="A few words sent with the voice: expression and pose, e.g. turns to the sea, soft smile"
      className="bg-background w-44 rounded-md border px-1.5 py-0.5"
    />
  );
}

// What a line is sung from: a small picker with a thumbnail and the short name of every picture and video in Creation
// (searchable when the list grows).
function SourcePicker({ sources, value, onChange, line }: { sources: SingerView["sources"]; value: string | null; onChange: (file: string | null) => void; line: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const chosen = sources.find((s) => s.file === value) ?? null;
  const shown = sources.filter((s) => !q.trim() || `${s.label ?? ""} ${s.file}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={box} className="relative">
      <button type="button" data-singer-source={line} aria-label={`Singer on line ${line}`} onClick={() => setOpen(!open)} className={cn("bg-background flex w-44 items-center gap-1.5 rounded-md border px-1 py-0.5 text-left", chosen && "border-brand/60")} title={chosen ? chosen.file : "Choose what the singer is sung from"}>
        {chosen ? <SourceThumb s={chosen} /> : null}
        <span className={cn("truncate", !chosen && "text-muted-foreground")}>{chosen ? (chosen.label ?? chosen.file) : "— no singer"}</span>
      </button>
      {open ? (
        <div data-singer-picker={line} className="bg-popover absolute right-0 z-30 mt-1 flex max-h-80 w-64 flex-col gap-1 overflow-auto rounded-lg border p-1.5 shadow-lg">
          <span className="text-muted-foreground px-1 text-[11px] font-medium">Who sings this line? (lip-sync)</span>
          {sources.length > 6 ? <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="bg-background rounded-md border px-2 py-1 text-xs" data-singer-search /> : null}
          {value ? (
            <button type="button" data-singer-option="" onClick={() => { onChange(null); setOpen(false); }} className="hover:bg-accent rounded px-2 py-1 text-left text-xs">
              — no singer on this line
            </button>
          ) : null}
          {shown.map((s) => (
            <button key={s.file} type="button" data-singer-option={s.file} onClick={() => { onChange(s.file); setOpen(false); }} title={s.file} className={cn("hover:bg-accent flex items-center gap-2 rounded px-1 py-1 text-left text-xs", s.file === value && "bg-brand/10")}>
              <SourceThumb s={s} big />
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.label ?? s.file}</span>
                {s.label ? <span className="text-muted-foreground block truncate text-[10px]">{s.file}</span> : null}
                {s.kind === "video" ? <span className="text-muted-foreground text-[10px]">video</span> : null}
              </span>
            </button>
          ))}
          {!shown.length ? <span className="text-muted-foreground px-2 py-1 text-xs">Nothing with that name.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceThumb({ s, big }: { s: SingerView["sources"][number]; big?: boolean }) {
  const url = `/api/files/${s.url.split("/").map(encodeURIComponent).join("/")}`;
  const size = big ? "size-10" : "size-5";
  return s.kind === "video" ? (
    <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className={cn("bg-muted shrink-0 rounded object-cover", size)} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a local picture served by /api/files
    <img src={url} alt="" className={cn("bg-muted shrink-0 rounded object-cover", size)} />
  );
}
