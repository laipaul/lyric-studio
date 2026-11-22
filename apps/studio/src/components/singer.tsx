"use client";

// Lyrics Sync → Singer (21 Nov 2026, Paul's workflow): tick the lines where the singer shows, each with a picture or
// video from Creation; "Make singing clips" sends each line's vocal with it to WaveSpeed InfiniteTalk (cost first, your
// Creation cap). The first take of a group (its picture, its lines) comes back into Creation, the Storyboard and onto its
// lines, and Make plays it in time with the song. Retake makes another take of the same group: it waits as "New — compare"
// (never replaces the take in use) until Paul chooses it with "Use this take" (21 Nov 2026). Every take plays with the
// song from its first frame. API: /api/songs/[id]/singer.
import { Check, Loader2, Mic, Pause, Play, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { GroupTake, SingerLine, SingerView } from "@lyric/video/singer";
import { takeWhen } from "@lyric/video/take-facts";

import { useGoToTab } from "@/components/song-stages";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;
const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

// The take being watched: its video (no sound) with the song from the take's first frame.
export type Playing = { source: string; n: number; video: string; fromS: number; title: string };

export type Singer = {
  view: SingerView | null;
  cap: number;
  error: string | null;
  notice: { ok: boolean; text: string } | null;
  busy: boolean;
  playing: Playing | null;
  setLine: (line: number, source: string | null) => Promise<void>;
  setScript: (line: number, script: string) => Promise<void>;
  setResolution: (resolution: string) => Promise<void>;
  make: () => Promise<void>;
  retake: (line: number) => Promise<void>;
  chooseTake: (source: string, t: GroupTake) => Promise<void>;
  play: (source: string, t: GroupTake | null) => void;
  panel: number | null; // the line whose takes show in the takes panel (opened by Make, Retake or Takes)
  showTakes: (line: number | null) => void;
  reload: () => Promise<void>; // read the singing lines again (the Lyrics tab changed an anchor: the take may no longer be in use)
};

// `onMade`: called when a take lands on (or is switched onto) its lines (the Lyrics tab reloads its anchors).
export function useSinger(projectId: string, onMade: () => void): Singer {
  const [view, setView] = useState<SingerView | null>(null);
  const [cap, setCap] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [panel, setPanel] = useState<number | null>(null);
  // A mood text still being saved (its box loses focus as Make or Retake is pressed): they wait for it, so the take is
  // sent with the words on screen and the "to make" count is right afterwards.
  const saving = useRef<Promise<void>>(Promise.resolve());
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
  const running = !!view?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [running, load]);
  // A take landed on its lines or was chosen: the Lyrics tab's anchors changed.
  const inUse = view?.lines?.flatMap((l) => l.takes.filter((t) => t.inUse).map((t) => `${l.number}:${t.n}`)).join(",") ?? null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (inUse === null) return;
    if (seen.current !== null && seen.current !== inUse) onMade();
    seen.current = inUse;
  }, [inUse, onMade]);

  async function post(body: Record<string, unknown>) {
    const r = await api(`/api/songs/${projectId}/singer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json()) as { error?: string; usd?: number; seconds?: number; jobs?: unknown[] };
    if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
    return d;
  }
  const attempt = async (what: () => Promise<void>) => {
    try {
      await what();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };
  return {
    view,
    cap,
    error,
    notice,
    busy,
    playing,
    panel,
    showTakes: setPanel,
    reload: load,
    setLine: (line, source) => attempt(async () => {
      await post({ action: "line", line, source });
      await load();
    }),
    setScript: (line, script) => {
      const p = attempt(async () => {
        await post({ action: "script", line, script });
        await load();
      });
      saving.current = saving.current.then(() => p);
      return p;
    },
    setResolution: (resolution) => attempt(async () => {
      await post({ action: "resolution", resolution });
      await load();
    }),
    make: async () => {
      setBusy(true);
      try {
        await saving.current;
        const first = view?.toMake.lines[0] ?? null;
        const d = await post({ action: "make" });
        if (first !== null) setPanel(first); // the takes panel follows the first take being made
        setNotice({ ok: true, text: `${d.jobs?.length ?? 0} singing clip${d.jobs?.length === 1 ? "" : "s"} sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}). The first take of each group lands on its lines by itself when it is ready (a few minutes each); follow it in Tasks.` });
        window.dispatchEvent(new Event("lyric-tasks-changed")); // the Tasks menu opens with it
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        await load();
        setBusy(false);
      }
    },
    retake: async (line) => {
      setBusy(true);
      try {
        await saving.current;
        const d = await post({ action: "retake", line });
        setPanel(line);
        setNotice({ ok: true, text: `Retake sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}). It arrives as “New — compare” under its lines; the take in use stays until you choose another.` });
        window.dispatchEvent(new Event("lyric-tasks-changed"));
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        await load();
        setBusy(false);
      }
    },
    chooseTake: (source, t) => attempt(async () => {
      await post({ action: "use", source, n: t.n });
      setNotice({ ok: true, text: `${t.label ?? `Take ${t.n}`} is now on ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`} (nothing was made again). The next video uses it.` });
      await load();
    }),
    play: (source, t) => {
      if (!t?.file || !view) return setPlaying(null);
      setPlaying({ source, n: t.n, video: fileUrl(`${view.folder}/${t.file}`), fromS: (t.sync_ms ?? 0) / 1000, title: `${t.label ?? `Take ${t.n}`} · ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` });
      if (t.fresh) void post({ action: "seen", source, n: t.n }).then(load).catch(() => undefined);
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
          {v.toMake.lines.length ? ` · to make: ${v.toMake.lines.length} take${v.toMake.lines.length === 1 ? "" : "s"} (${v.toMake.seconds} s of voice at ${v.resolution}, about ${money(v.toMake.usd)})` : ticked ? " · all made" : ""}
          {over ? ` · above your cap of ${money(singer.cap)} (Creation → Your defaults)` : ""}
        </span>
        {v.running ? (
          <span data-singer-running className="text-brand flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> {v.running} being made
          </span>
        ) : null}
        <label className="text-muted-foreground ml-auto flex items-center gap-1" title="The size InfiniteTalk makes the singing clips at (this video; takes already made keep theirs). 720p is sharper; 480p costs half.">
          Resolution
          <select data-singer-resolution value={v.resolution} onChange={(e) => void singer.setResolution(e.target.value)} className="bg-background rounded-md border px-1 py-0.5">
            <option value="720p">720p · $0.06/s</option>
            <option value="480p">480p · $0.03/s</option>
          </select>
        </label>
        {v.toMake.lines.length ? (
          <Button type="button" size="sm" data-singer-make disabled={singer.busy || !v.ready || over} onClick={() => void singer.make()} title={!v.ready ? "No WaveSpeed key yet" : over ? `Above your cap of ${money(singer.cap)}` : undefined}>
            {singer.busy ? <Loader2 className="animate-spin" /> : <Mic />} Make singing clips
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        Lines in a row with the same picture are sung in one continuous take. Each take&apos;s voice is sent with its picture or video to WaveSpeed InfiniteTalk at {v.resolution} ({money(v.usdPerSecond)} per second). The first take of a group comes back into Creation and your Storyboard, lands on its lines and always plays in time with the song: Make cuts to it on the beat. Retake makes another take of the same lines; it waits as “New — compare” until you choose it. The voice is {v.voice === "stem" ? "your vocal stem" : "the song itself (add your vocal stem in Assets for cleaner lips)"}.
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
      {singer.panel !== null ? <TakesPanel singer={singer} line={singer.panel} /> : null}
      {singer.playing && v.song ? <TakePlayer key={`${singer.playing.source}:${singer.playing.n}`} playing={singer.playing} song={fileUrl(v.song)} onClose={() => singer.play("", null)} /> : null}
    </div>
  );
}

// The takes panel (21 Nov 2026, Paul: "a pop up window when we press Make lipsync like what we see in Creation"):
// opened by Make singing clips, Retake or a line's Takes button, it shows the group's picture and every take as it is
// made (length, cost, when), ▶ to watch one with the song and Use this take, without leaving Lyrics Sync; Jump to
// Creation opens the picture's card there. Closes with ✕ or Esc.
function TakesPanel({ singer, line }: { singer: Singer; line: number }) {
  const { showTakes } = singer;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && showTakes(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [showTakes]);
  const v = singer.view;
  const l = v?.lines?.find((x) => x.number === line);
  const first = l?.run && l.run.first !== l.number ? v?.lines?.find((x) => x.number === l.run!.first) : l;
  if (!v || !first?.source) return null;
  const src = v.sources.find((s) => s.file === first.source);
  const lines = first.run && first.run.last > first.run.first ? `Lines ${first.run.first}-${first.run.last}` : `Line ${first.number}`;
  const running = first.takes.some((t) => t.status === "running");
  return (
    <div data-singer-panel={first.number} className="bg-popover fixed top-24 right-4 z-40 flex max-h-[70vh] w-80 flex-col gap-2 overflow-y-auto rounded-xl border p-3 text-[11px] shadow-2xl">
      <div className="flex items-center gap-2 text-xs">
        {src ? <SourceThumb s={src} big /> : null}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{lines} · singing takes</span>
          <span className="text-muted-foreground block truncate">{src?.label ?? first.source}</span>
        </span>
        <button type="button" onClick={() => showTakes(null)} className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Close" data-singer-panel-close>
          <X className="size-3.5" />
        </button>
      </div>
      {running ? (
        <span className="text-muted-foreground flex items-center gap-1" data-singer-panel-running>
          <Loader2 className="text-brand size-3 animate-spin" /> Being made at WaveSpeed: a few minutes. It shows here when it is ready.
        </span>
      ) : null}
      {first.takes.length ? <TakesList singer={singer} source={first.source} takes={first.takes} /> : <span className="text-muted-foreground">No take yet.</span>}
      <CreationNote source={first.source} running={false} />
    </div>
  );
}

// A take with the song: the take's video (no sound) and the song from the song second of the take's first frame, kept
// together, so the lips can be judged against the real song. The song file is only read (played).
function TakePlayer({ playing, song, onClose }: { playing: Playing; song: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const start = useCallback(() => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a) return;
    v.currentTime = 0;
    a.currentTime = playing.fromS;
    void Promise.all([v.play(), a.play()]).then(() => setOn(true)).catch(() => setOn(false));
  }, [playing.fromS]);
  const stop = () => {
    video.current?.pause();
    audio.current?.pause();
    setOn(false);
  };
  useEffect(() => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a) return;
    let ready = 0;
    const go = () => (ready += 1) === 2 && start();
    v.addEventListener("canplay", go, { once: true });
    a.addEventListener("canplay", go, { once: true });
    a.load();
    return () => {
      v.removeEventListener("canplay", go);
      a.removeEventListener("canplay", go);
      v.pause();
      a.pause();
    };
  }, [start]);
  return (
    <div data-singer-player className="bg-popover fixed right-4 bottom-24 z-40 flex w-72 flex-col gap-2 rounded-xl border p-2 shadow-2xl">
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium">{playing.title}</span>
        <button type="button" onClick={on ? stop : start} className="rounded-md border p-1" aria-label={on ? "Pause" : "Play from the start"} data-singer-player-toggle>
          {on ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Close" data-singer-player-close>
          <X className="size-3.5" />
        </button>
      </div>
      <video
        ref={video}
        src={playing.video}
        muted
        playsInline
        preload="auto"
        className="bg-muted max-h-96 w-full rounded-lg object-contain"
        onTimeUpdate={(e) => {
          // Keep the song on the picture: a drift above 80 ms is set right.
          const a = audio.current;
          const want = playing.fromS + e.currentTarget.currentTime;
          if (a && !a.paused && Math.abs(a.currentTime - want) > 0.08) a.currentTime = want;
        }}
        onEnded={stop}
      />
      <audio ref={audio} src={song} preload="auto" />
      <span className="text-muted-foreground text-[11px]">With the song from {Math.floor(playing.fromS / 60)}:{(playing.fromS % 60).toFixed(1).padStart(4, "0")}: the lips should sing what the song sings.</span>
    </div>
  );
}

// The Singer cell of one line: what it is sung from (a dropdown of Creation's pictures and videos), the mood box, and on
// a group's first line its state, Retake and every take of the group to compare and choose from.
export function SingerCell({ singer, number }: { singer: Singer; number: number }) {
  const v = singer.view;
  const l: SingerLine | undefined = v?.lines?.find((x) => x.number === number);
  if (!v || !l) return null;
  const t = l.take;
  const inRun = !!l.run && l.run.last > l.run.first;
  const later = inRun && l.run!.first !== l.number; // a later line of a run: its take is made with the run's first line
  const lines = inRun ? `lines ${l.run!.first}-${l.run!.last}` : "this line";
  const used = l.takes.find((x) => x.inUse) ?? null;
  const madeBefore = l.needed && l.takes.some((x) => x.status === "done");
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span data-singer-status={madeBefore ? "remake" : used ? "done" : t.status} className={cn(used && !madeBefore ? "text-emerald-300" : t.status === "running" ? "text-muted-foreground" : t.status === "done" ? "text-muted-foreground" : "text-amber-200")}>
            {madeBefore ? (
              "made before (an earlier timing or the talking style): make again to sing"
            ) : used ? (
              <>
                <Check className="inline size-3" /> singing clip on {lines}
              </>
            ) : t.status === "running" ? (
              <>
                <Loader2 className="inline size-3 animate-spin" /> being made…
              </>
            ) : t.status === "done" ? (
              "no take on the line now: choose one below"
            ) : (
              t.error
            )}
          </span>
          {!l.needed && l.takes.some((x) => x.status === "done" || x.status === "running") ? (
            <button type="button" data-singer-retake={number} disabled={singer.busy || !v.ready || l.piece.usd > singer.cap} onClick={() => void singer.retake(number)} className="hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 disabled:opacity-50" title={`The same picture and piece of the vocal again, with the mood text and resolution of now (${v.resolution}): ${l.piece.seconds} s${l.piece.parts ? ` in ${l.piece.parts.length} parts of about ${Math.round((l.piece.toMs - l.piece.fromMs) / l.piece.parts.length / 1000)} s` : ""} · about ${money(l.piece.usd)}. Earlier takes stay.`}>
              <RefreshCw className="size-3" /> Retake
            </button>
          ) : null}
          {l.takes.length ? (
            <button type="button" data-singer-show-takes={number} onClick={() => singer.showTakes(number)} className="hover:bg-accent rounded border px-1.5 py-0.5">
              Takes
            </button>
          ) : null}
        </div>
      ) : l.source ? (
        <span className="text-muted-foreground" data-singer-status="todo">
          {inRun ? `lines ${l.run!.first}-${l.run!.last} in one take · ` : ""}
          {l.piece.seconds} s · {v.resolution} · about {money(l.piece.usd)}
          {l.piece.parts ? (
            <span data-singer-parts={l.piece.parts.length} title="A long piece of singing is made in parts of about 8 s (the lips stay in time better), each from the last frame of the one before, joined into one take">
              {" "}· in {l.piece.parts.length} parts of about {Math.round((l.piece.toMs - l.piece.fromMs) / l.piece.parts.length / 1000)} s
            </span>
          ) : null}
        </span>
      ) : null}
      {l.source && l.takes.length ? <TakesList singer={singer} source={l.source} takes={l.takes} /> : null}
      {l.source && !later && l.takes.length ? <CreationNote source={l.source} running={l.takes.some((x) => x.status === "running")} /> : null}
      {!v.sources.length ? <span className="text-muted-foreground">Add pictures in Creation first</span> : null}
    </div>
  );
}

// Once a group has a take (21 Nov 2026, Paul: "not easy to remember at first"): a note that its takes are also in
// Creation, with a link that opens Creation and scrolls to the picture card they were made from.
function CreationNote({ source, running }: { source: string; running: boolean }) {
  const goTo = useGoToTab();
  const open = () => {
    goTo("production");
    const until = Date.now() + 4000; // Creation loads its pictures after it opens
    const find = () => {
      const card = document.querySelector(`[data-picture="${CSS.escape(source)}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (Date.now() < until) setTimeout(find, 150);
    };
    setTimeout(find, 0);
  };
  return (
    <span className="text-muted-foreground" data-singer-creation-note>
      {running ? "Take being made. " : ""}
      <button type="button" data-singer-to-creation onClick={open} className="text-brand hover:underline">
        Jump to Creation
      </button>{" "}
      to see and pick your takes.
    </span>
  );
}

// Every take of a group, newest first: ▶ plays it with the song; "Use this take" puts it on the lines at once.
function TakesList({ singer, source, takes }: { singer: Singer; source: string; takes: GroupTake[] }) {
  return (
    <ul data-singer-takes className="mt-0.5 flex w-52 flex-col gap-1 border-l pl-1.5">
      {[...takes].reverse().map((t) => {
        const on = singer.playing?.source === source && singer.playing.n === t.n;
        return (
          <li key={t.n} data-singer-take={t.n} data-singer-take-state={t.inUse ? "in-use" : t.fresh ? "new" : t.status} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              {t.status === "done" && t.file ? (
                <button type="button" data-singer-take-play onClick={() => singer.play(source, on ? null : t)} className="hover:bg-accent shrink-0 rounded border p-0.5" aria-label={`Play take ${t.n} with the song`} title="Plays the take with the song from its first frame">
                  {on ? <Pause className="size-3" /> : <Play className="size-3" />}
                </button>
              ) : t.status === "running" ? (
                <Loader2 className="text-brand size-3.5 shrink-0 animate-spin" />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <span className="truncate font-medium">{t.label ?? `Take ${t.n}`}</span>
              {t.inUse ? (
                <span data-singer-take-badge="in-use" className="rounded bg-emerald-400/15 px-1 text-emerald-300">In use</span>
              ) : t.fresh ? (
                <span data-singer-take-badge="new" className="bg-brand/15 text-brand rounded px-1">New — compare</span>
              ) : null}
              {t.status === "done" && !t.inUse ? (
                <button type="button" data-singer-take-use onClick={() => void singer.chooseTake(source, t)} className="hover:bg-accent ml-auto shrink-0 rounded border px-1 py-px whitespace-nowrap" title="Put this take on its lines now (nothing is made again)">
                  Use this take
                </button>
              ) : null}
            </div>
            <span className="text-muted-foreground pl-5" data-singer-take-facts>
              {[takeWhen(t), t.status === "running" ? "being made…" : t.status === "done" || t.request_id ? `about ${money(t.cost_usd)}` : "nothing spent", t.resolution ?? "720p", t.parts && t.parts.length > 1 ? `${t.parts.length} parts` : ""].filter(Boolean).join(" · ")}
              {t.status === "failed" || t.status === "interrupted" ? <span className={t.status === "failed" ? "text-red-300" : "text-amber-300"}> · {t.error}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// The block's little script: what the singer does while singing ("turns to the sea, soft smile"), sent with the voice.
function ScriptField({ line, value, onSave }: { line: number; value: string; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  const save = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next !== value) void onSave(next);
  };
  const area = useRef<HTMLTextAreaElement>(null);
  // Grow with the text so a long mood is shown whole; an empty one stays a single row.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <div className="flex w-56 flex-col gap-0.5">
      <textarea
        ref={area}
        rows={1}
        data-singer-script={line}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder="Mood (optional)"
        title="Sent to InfiniteTalk as its prompt, after the singing cue. A new mood is used by the next Retake."
        className="bg-background w-56 resize-none overflow-hidden rounded-md border px-1.5 py-0.5 leading-snug"
      />
      <span data-singer-mood-hint className="text-muted-foreground text-[10px] leading-tight">
        {MOOD_HINT}
      </span>
    </div>
  );
}

// Under the mood box: the words go to InfiniteTalk as its prompt, and it only shapes the picture.
export const MOOD_HINT = "Describe the face and mouth, not the voice — e.g. singing clearly, precise lip shapes, gentle head sway.";

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
