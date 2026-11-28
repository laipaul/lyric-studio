"use client";

// Lyrics Sync → Singer (21 Nov 2026, Paul's workflow): tick the lines where the singer shows, each with a picture or
// video from Creation; "Make singing clips" sends each line's vocal with it to WaveSpeed InfiniteTalk (cost first, your
// Creation cap). The first take of a group (its picture, its lines) comes back into Creation, the Storyboard and onto its
// lines, and Make plays it in time with the song. Retake makes another take of the same group: it waits as "New — compare"
// (never replaces the take in use) until Paul chooses it with "Use this take" (21 Nov 2026). Every take plays with the
// song from its first frame. API: /api/songs/[id]/singer.
import { qaWords } from "@lyric/video/take-qa";
import { Check, Loader2, Lock, Mic, Pause, Play, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { GroupTake, SingerLine, SingerView } from "@lyric/video/singer";
import { takeFeeling, takeWhen } from "@lyric/video/take-facts";

import { useGoToTab } from "@/components/song-stages";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;
const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

// The take being watched: its video (no sound) with the song from the take's first frame.
// heard (26 Nov 2026, Paul: "display the actual lyrics she's singing, to check what the model thinks she should be
// singing"): the take's vocal piece (song ms) and where the voice sent to the model was silenced.
export type Playing = { source: string; n: number; video: string; fromS: number; title: string; heard?: { fromMs: number; toMs: number; rests: { fromMs: number; toMs: number }[] }; bad?: { fromS: number; toS: number; kind: string }[] };
export type LyricLine = { number: number; text: string; startMs: number; endMs: number };

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
  // The second engine (28 Nov 2026): per group InfiniteTalk or the MV Generator, its scene, the MV Generator's shape.
  setEngine: (line: number, engine: "infinitetalk" | "mv") => Promise<void>;
  setScene: (line: number, scene: string) => Promise<void>;
  setAspect: (aspect: "9:16" | "16:9") => Promise<void>;
  make: (draft?: boolean, lines?: number[]) => Promise<void>; // lines: only the groups that start on these lines
  retake: (line: number, draft?: boolean) => Promise<void>;
  // The lip-sync review (26 Nov 2026): a verdict, the free nudge, the audio per group, Make final.
  review: (source: string, t: GroupTake, verdict: "approved" | "redo" | null, reasons?: string[], note?: string) => Promise<void>;
  nudge: (source: string, t: GroupTake, ms: number) => Promise<void>;
  setVoice: (line: number, voice: "stem" | "song" | "dereverb" | "lead") => Promise<void>;
  prepareDry: (lead: boolean) => Promise<void>; // the dry vocal for lips (28 Nov 2026)
  makeFinal: (source: string, t: GroupTake) => Promise<void>;
  trim: (source: string, t: GroupTake) => Promise<void>;
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
  // Takes being made, or the dry vocal being prepared: the view follows by itself.
  const running = !!view?.running || view?.dryVocal?.dry === "making" || view?.dryVocal?.lead === "making";
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
    const d = (await r.json()) as { error?: string; usd?: number; seconds?: number; jobs?: unknown[]; lines?: number[]; notes?: string[] };
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
    setEngine: (line, engine) => attempt(async () => {
      await post({ action: "engine", line, engine });
      await load();
    }),
    setScene: (line, scene) => {
      const p = attempt(async () => {
        await post({ action: "scene", line, scene });
        await load();
      });
      saving.current = saving.current.then(() => p);
      return p;
    },
    setAspect: (aspect) => attempt(async () => {
      await post({ action: "aspect", aspect });
      await load();
    }),
    make: async (draft = false, lines) => {
      setBusy(true);
      try {
        await saving.current;
        const first = lines?.[0] ?? view?.toMake.lines[0] ?? null;
        const d = await post({ action: "make", draft, ...(lines ? { lines } : {}) });
        if (first !== null) setPanel(first); // the takes panel follows the first take being made
        const sent = d.lines?.length ? ` for line${d.lines.length === 1 ? "" : "s"} ${d.lines.join(", ")}` : "";
        setNotice({ ok: true, text: `${d.jobs?.length ?? 0} singing ${draft ? "draft" : "clip"}${d.jobs?.length === 1 ? "" : "s"}${sent} sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}${draft ? ", 480p" : ""}).${d.notes?.length ? ` ${d.notes.join(" ")}` : ""} The first take of each group lands on its lines by itself when it is ready (a few minutes each); follow it in Tasks.${draft ? " Then play each one with the song: ✓ Approve it, or Redo with what is wrong." : ""}` });
        window.dispatchEvent(new Event("lyric-tasks-changed")); // the Tasks menu opens with it
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        await load();
        setBusy(false);
      }
    },
    retake: async (line, draft = false) => {
      setBusy(true);
      try {
        await saving.current;
        const d = await post({ action: "retake", line, draft });
        setPanel(line);
        setNotice({ ok: true, text: `${draft ? "Draft retake" : "Retake"} sent to WaveSpeed (${d.seconds} s of voice, about ${money(d.usd ?? 0)}). It arrives as “New — compare” under its lines; the take in use stays until you choose another.` });
        window.dispatchEvent(new Event("lyric-tasks-changed"));
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        await load();
        setBusy(false);
      }
    },
    review: (source, t, verdict, reasons = [], note = "") => attempt(async () => {
      await post({ action: "review", source, n: t.n, verdict, reasons, note });
      await load();
    }),
    nudge: (source, t, ms) => attempt(async () => {
      await post({ action: "nudge", source, n: t.n, ms });
      await load();
      onMade(); // a take in use moved on its lines: the Lyrics tab's anchors changed
    }),
    setVoice: (line, voice) => attempt(async () => {
      await post({ action: "voice", line, voice });
      await load();
    }),
    prepareDry: (lead) => attempt(async () => {
      await post({ action: "prepare", lead });
      setNotice({ ok: true, text: `Making the dry vocal${lead ? " and the lead only" : ""} from your vocal stem, on this PC (about half a minute per minute of vocal${lead ? ", the lead only about a minute more" : ""}). It is used only to drive the lips, never in a video.` });
      await load();
    }),
    trim: (source, t) => attempt(async () => {
      await post({ action: "trim", source, n: t.n });
      setNotice({ ok: true, text: `A trimmed copy of ${t.label ?? `take ${t.n}`} keeps its good part (nothing deleted). It takes its place on the lines when that take was in use.` });
      await load();
      onMade();
    }),
    makeFinal: (source, t) => attempt(async () => {
      await post({ action: "final", source, n: t.n });
      setNotice({ ok: true, text: `Making the final of ${t.label ?? `take ${t.n}`}: the approved draft upscaled to 1080p (the same lips and expression), about ${money(Math.max(3, Math.ceil(t.seconds ?? ((t.to_ms ?? 0) - (t.sync_ms ?? 0)) / 1000)) * 0.04)}. It takes the draft's place on its lines when it is ready.` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
      await load();
    }),
    chooseTake: (source, t) => attempt(async () => {
      await post({ action: "use", source, n: t.n });
      setNotice({ ok: true, text: `${t.label ?? `Take ${t.n}`} is now on ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`} (nothing was made again). The next video uses it.` });
      await load();
    }),
    play: (source, t) => {
      if (!t?.file || !view) return setPlaying(null);
      setPlaying({ source, n: t.n, video: fileUrl(`${view.folder}/${t.file}`), fromS: ((t.sync_ms ?? 0) + (t.nudge_ms ?? 0)) / 1000, ...(t.sync_ms !== undefined && t.to_ms !== undefined ? { heard: { fromMs: t.sync_ms, toMs: t.to_ms, rests: t.rests ?? [] } } : {}), ...(t.qa?.segments.length ? { bad: t.qa.segments } : {}), title: `${t.label ?? `Take ${t.n}`} · ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` });
      if (t.fresh) void post({ action: "seen", source, n: t.n }).then(load).catch(() => undefined);
    },
  };
}

// panelExtra: more for a line's window (Lyrics Sync passes its music-video shots for that line).
export function SingerBar({ singer, lyrics = [], panelExtra }: { singer: Singer; lyrics?: LyricLine[]; panelExtra?: (line: number) => ReactNode }) {
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
          {ticked ? `${ticked} line${ticked === 1 ? "" : "s"} where the singer shows` : "Choose a picture or video in the Lip sync column on the lines where the singer shows."}
          {v.toMake.lines.length ? ` · to make: ${v.toMake.lines.length} take${v.toMake.lines.length === 1 ? "" : "s"} (${v.toMake.seconds} s of voice at ${v.resolution}, about ${money(v.toMake.usd)})` : ticked && !v.blocked.length ? " · all made" : ""}
          {v.blocked.length ? <span data-singer-blocked className="text-amber-200"> · not sent: {v.blocked.map((b) => b.note).join(" ")}</span> : null}
          {over ? ` · above your cap of ${money(singer.cap)} (Creation → Your defaults)` : ""}
        </span>
        {v.review.groups ? (
          <span data-singer-review className={cn(v.review.approved === v.review.groups ? "text-emerald-300" : "text-muted-foreground")} title="The lip-sync review: play each take with the song, ✓ Approve it or Redo with what is wrong; approved drafts become finals with Make final">
            · review: {v.review.approved} of {v.review.groups} approved{v.review.redo ? ` · ${v.review.redo} to redo` : ""}{v.review.notMade ? ` · ${v.review.notMade} not made` : ""}
          </span>
        ) : null}
        {v.running ? (
          <span data-singer-running className="text-brand flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> {v.running} being made
          </span>
        ) : null}
        <label className="text-muted-foreground ml-auto flex items-center gap-1" title="The size the singing clips are made at (takes already made keep theirs). 720p is sharper; 480p costs half. 1080p: the MV Generator only (InfiniteTalk makes 720p then).">
          Resolution
          <select data-singer-resolution value={v.resolution} onChange={(e) => void singer.setResolution(e.target.value)} className="bg-background rounded-md border px-1 py-0.5">
            <option value="1080p">1080p · $0.12/s (MV Generator)</option>
            <option value="720p">720p · $0.06/s</option>
            <option value="480p">480p · $0.03/s</option>
          </select>
        </label>
        {v.lines.some((l) => l.engine === "mv" && l.source) ? (
          <label className="text-muted-foreground flex items-center gap-1" title="The shape the MV Generator makes: the video's shape (9:16 for Reels, TikTok and Shorts; 16:9 for YouTube). A 16:9 take only plays in your 16:9 videos.">
            MV shape
            <select data-singer-aspect value={v.aspect} onChange={(e) => void singer.setAspect(e.target.value as "9:16" | "16:9")} className="bg-background rounded-md border px-1 py-0.5">
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
        ) : null}
        {v.toMake.lines.length ? (
          <Button type="button" size="sm" variant="outline" data-singer-make-drafts disabled={singer.busy || !v.ready || v.toMake.seconds * 0.03 > singer.cap} onClick={() => void singer.make(true)} title={`Drafts first (lip-sync review): 480p at $0.03/s, about ${money(Math.round(v.toMake.seconds * 3) / 100)}. Check each one with the song, then Make final on the approved ones.`}>
            <Mic /> Make drafts (480p)
          </Button>
        ) : null}
        {v.toMake.lines.length ? (
          <Button type="button" size="sm" data-singer-make disabled={singer.busy || !v.ready || over} onClick={() => void singer.make()} title={!v.ready ? "No WaveSpeed key yet" : over ? `Above your cap of ${money(singer.cap)}` : undefined}>
            {singer.busy ? <Loader2 className="animate-spin" /> : <Mic />} Make singing clips
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        Lines in a row with the same picture are sung in one continuous take. Each take&apos;s voice is sent with its picture or video to WaveSpeed InfiniteTalk ({money(v.usdPerSecond)} per second), or, when a group&apos;s Engine is MV Generator, with its picture to the Music Video Generator ({money(v.mvUsdPerSecond)} per second, with 1 s of extra voice before and after, cut off again). The first take of a group comes back into Creation and your Storyboard, lands on its lines and always plays in time with the song: Make cuts to it on the beat. Retake makes another take of the same lines; it waits as “New — compare” until you choose it. The voice is {v.voice === "stem" ? "your vocal stem" : "the song itself (add your vocal stem in Assets for cleaner lips)"}.
      </p>
      <DryVocalRow singer={singer} />
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
      {singer.panel !== null ? <TakesPanel singer={singer} line={singer.panel} extra={panelExtra?.(singer.panel)} /> : null}
      {singer.playing && v.song ? <TakePlayer key={`${singer.playing.source}:${singer.playing.n}`} playing={singer.playing} song={fileUrl(v.song)} lyrics={lyrics} onClose={() => singer.play("", null)} /> : null}
    </div>
  );
}

// The takes panel (21 Nov 2026, Paul: "a pop up window when we press Make lipsync like what we see in Creation"):
// opened by Make singing clips, Retake or a line's Takes button, it shows the group's picture and every take as it is
// made (length, cost, when), ▶ to watch one with the song and Use this take, without leaving Lyrics Sync; Jump to
// Creation opens the picture's card there. Closes with ✕ or Esc.
function TakesPanel({ singer, line, extra }: { singer: Singer; line: number; extra?: ReactNode }) {
  const { showTakes } = singer;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && showTakes(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [showTakes]);
  const v = singer.view;
  const l = v?.lines?.find((x) => x.number === line);
  const first = l?.run && l.run.first !== l.number ? v?.lines?.find((x) => x.number === l.run!.first) : l;
  if (!v || !first) return null;
  const src = first.source ? v.sources.find((s) => s.file === first.source) : undefined;
  const lines = first.run && first.run.last > first.run.first ? `Lines ${first.run.first}-${first.run.last}` : `Line ${first.number}`;
  const running = first.takes.some((t) => t.status === "running");
  return (
    <div data-singer-panel={first.number} className="bg-popover fixed top-24 right-4 z-40 flex max-h-[70vh] w-80 flex-col gap-2 overflow-y-auto rounded-xl border p-3 text-[11px] shadow-2xl">
      <div className="flex items-center gap-2 text-xs">
        {src ? <SourceThumb s={src} big /> : null}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{lines} · takes &amp; making</span>
          <span className="text-muted-foreground block truncate">{src?.label ?? first.source ?? "choose a picture"}</span>
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
      <MakingControls singer={singer} number={first.number} />
      {first.source && first.takes.length ? <TakesList singer={singer} source={first.source} takes={first.takes} /> : <span className="text-muted-foreground">No take yet.</span>}
      {extra}
      {first.source ? <CreationNote source={first.source} running={false} /> : null}
    </div>
  );
}

// A take with the song: the take's video (no sound) and the song from the song second of the take's first frame, kept
// together, so the lips can be judged against the real song. The song file is only read (played).
function TakePlayer({ playing, song, lyrics, onClose }: { playing: Playing; song: string; lyrics: LyricLine[]; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [videoS, setVideoS] = useState(0); // where the take is (seconds into the video)
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
          setVideoS(e.currentTarget.currentTime);
        }}
        onEnded={stop}
      />
      <audio ref={audio} src={song} preload="auto" />
      <HeardStrip playing={playing} lyrics={lyrics} videoS={videoS} />
      <span className="text-muted-foreground text-[11px]">With the song from {Math.floor(playing.fromS / 60)}:{(playing.fromS % 60).toFixed(1).padStart(4, "0")}: the lips should sing what the song sings.</span>
    </div>
  );
}

// The Singer cell of one line: what it is sung from (a dropdown of Creation's pictures and videos), the mood box, and on
// a group's first line its state, Retake and every take of the group to compare and choose from.
// The Singer cell of one line (28 Nov 2026, Paul: "we must see only the asset in use and click a button to see
// production history or workflow to get WaveSpeed to work"): what sings on this line, and one button that opens the
// line's window (Takes & making: the picture, what she does, the engine, Make / Retake, every take). Nothing else.
// sung: the line already shows the clip that sings on it (Lyrics Sync's card, any source): then only the button.
export function SingerCell({ singer, number, sung = false }: { singer: Singer; number: number; sung?: boolean }) {
  const v = singer.view;
  const l: SingerLine | undefined = v?.lines?.find((x) => x.number === number);
  if (!v || !l) return null;
  const inRun = !!l.run && l.run.last > l.run.first;
  const later = inRun && l.run!.first !== l.number;
  const first = later ? v.lines?.find((x) => x.number === l.run!.first) ?? l : l;
  const used = first.takes.find((x) => x.inUse) ?? null;
  const running = first.takes.some((x) => x.status === "running");
  const src = first.source ? v.sources.find((x) => x.file === first.source) : undefined;
  const open = () => singer.showTakes(first.number);
  const count = first.takes.length;
  return (
    <div className="flex flex-col gap-1 text-[11px]" data-singer-line={number}>
      {sung ? null : later ? (
        <span className="text-muted-foreground" data-singer-status="run">
          sung with line {l.run!.first}
        </span>
      ) : used ? (
        <div className="flex items-center gap-1.5" data-singer-in-use={used.n}>
          {src ? <SourceThumb s={src} /> : null}
          <span className="min-w-0 flex-1 truncate" title={`${src?.label ?? first.source} · ${used.label ?? `Take ${used.n}`}`}>
            <span className="font-medium">{used.label ?? `Take ${used.n}`}</span>
            <span className="text-muted-foreground"> · {src?.label ?? first.source}</span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-yellow-400/90 px-1 text-black" title="On its lines, locked to the song (1.00x, in time)">
            <Lock className="size-2.5" /> in time
          </span>
          <button type="button" data-singer-take-play onClick={() => singer.play(first.source!, singer.playing?.n === used.n ? null : used)} className="hover:bg-accent shrink-0 rounded border p-0.5" aria-label="Play the take with the song">
            {singer.playing?.n === used.n ? <Pause className="size-3" /> : <Play className="size-3" />}
          </button>
        </div>
      ) : running ? (
        <span className="text-muted-foreground flex items-center gap-1" data-singer-status="running">
          <Loader2 className="text-brand size-3 animate-spin" /> being made at WaveSpeed…
        </span>
      ) : first.source ? (
        <span className="text-muted-foreground" data-singer-status="none">
          no singing take yet
        </span>
      ) : null}
      {!later ? (
        <button type="button" data-singer-show-takes={number} onClick={open} className={cn("hover:bg-accent w-fit rounded border px-1.5 py-0.5", !first.source && !sung && "text-muted-foreground border-dashed")}>
          {first.source || sung ? <>Takes &amp; making{count ? ` (${count})` : ""}</> : "Add singer"}
        </button>
      ) : null}
    </div>
  );
}

function MakingControls({ singer, number }: { singer: Singer; number: number }) {
  const v = singer.view;
  const l: SingerLine | undefined = v?.lines?.find((x) => x.number === number);
  if (!v || !l) return null;
  const t = l.take;
  const inRun = !!l.run && l.run.last > l.run.first;
  const later = inRun && l.run!.first !== l.number; // a later line of a run: its take is made with the run's first line
  const lines = inRun ? `lines ${l.run!.first}-${l.run!.last}` : "this line";
  const used = l.takes.find((x) => x.inUse) ?? null;
  const madeBefore = l.needed && l.takes.some((x) => x.status === "done");
  // A group waiting for its take (on its first line): make just this one, or a draft of it first.
  const blocked = v.blocked.some((b) => b.line === number);
  const makeThis =
    l.source && !later && l.needed && !blocked && l.takes.every((x) => x.status !== "running") ? (
      <span className="flex flex-wrap items-center gap-1.5">
        <button type="button" data-singer-make-this={number} disabled={singer.busy || !v.ready || l.piece.usd > singer.cap} onClick={() => void singer.make(false, [number])} className="hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 disabled:opacity-50" title={!v.ready ? "No WaveSpeed key yet" : l.piece.usd > singer.cap ? `Above your cap of ${money(singer.cap)}` : `Makes only ${lines}: ${l.piece.seconds} s of voice · about ${money(l.piece.usd)}. The other lines wait.`}>
          <Mic className="size-3" /> Make this take
        </button>
        <button type="button" data-singer-make-this-draft={number} disabled={singer.busy || !v.ready || (l.draftUsd ?? 0) > singer.cap} onClick={() => void singer.make(true, [number])} className="hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 disabled:opacity-50" title={`A draft of ${lines} at 480p (about ${money(l.draftUsd ?? 0)}): check the lips and the expression cheaply, then Make final.`}>
          <Mic className="size-3" /> Make draft
        </button>
      </span>
    ) : null;
  return (
    <div className="flex flex-col gap-1 text-[11px]" data-singer-making={number}>
      <SourcePicker sources={v.sources} value={l.source} onChange={(src) => void singer.setLine(number, src)} line={number} />
      {l.source && !later && l.splitOf ? (
        <span className="text-muted-foreground" data-singer-split={number} title="Each take is at most 8 s and starts from your picture (a longer take drifts): the lines in a row are made as several takes, cut where a line ends">
          lines {l.splitOf.first}-{l.splitOf.last} in takes of at most 8 s: this one sings {l.run!.first === l.run!.last ? `line ${l.run!.first}` : `lines ${l.run!.first}-${l.run!.last}`}
        </span>
      ) : null}
      {l.source && !later ? <ScriptField key={l.script} line={number} value={l.script} onSave={(text) => singer.setScript(number, text)} /> : null}
      {l.source && !later ? (
        <label className="text-muted-foreground flex items-center gap-1" title="What drives the lips from the next take on: your vocal stem (clean voice), the stem de-reverbed (the echo removed: crisper syllables; made on this PC the first time, needs pnpm audio:setup --dereverb once) or the whole song (try it when the lips miss words)">
          Lips follow
          <select data-singer-voice={number} value={l.voice ?? "stem"} onChange={(e) => void singer.setVoice(number, e.target.value as "stem" | "song" | "dereverb" | "lead")} className="bg-background rounded border px-1 py-0">
            <option value="stem">the vocal stem</option>
            <option value="dereverb">the dry vocal (no reverb)</option>
            <option value="lead">the lead vocal only (dry)</option>
            <option value="song">the whole song</option>
          </select>
        </label>
      ) : null}
      {l.source && !later ? (
        <label className="text-muted-foreground flex items-center gap-1" title="What makes this group's next take: InfiniteTalk, or WaveSpeed's Music Video Generator (one picture, one continuous shot asked; a cut it adds anyway is said on the take). Earlier takes stay; your choice is remembered for this song.">
          Engine
          <select data-singer-engine={number} value={l.engine ?? "infinitetalk"} onChange={(e) => void singer.setEngine(number, e.target.value as "infinitetalk" | "mv")} className="bg-background rounded border px-1 py-0">
            <option value="infinitetalk">InfiniteTalk</option>
            <option value="mv">MV Generator</option>
          </select>
        </label>
      ) : null}
      {l.source && !later && l.engine === "mv" && !v.sources.some((s) => s.file === l.source && s.kind === "picture") ? (
        <span data-singer-mv-video={number} className="text-amber-200">
          The MV Generator needs a picture of the singer: choose a picture above, or InfiniteTalk.
        </span>
      ) : null}
      {l.source && !later && l.engine === "mv" ? <SceneField key={l.scene ?? ""} line={number} value={l.scene ?? ""} onSave={(text) => singer.setScene(number, text)} /> : null}
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
          {!l.needed && l.takes.some((x) => x.status === "done" || x.status === "running") ? (
            <button type="button" data-singer-retake-draft={number} disabled={singer.busy || !v.ready || (l.draftUsd ?? 0) > singer.cap} onClick={() => void singer.retake(number, true)} className="hover:bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 disabled:opacity-50" title={`A draft of the same lines at 480p (about ${money(l.draftUsd ?? 0)}): check the lips and the expression cheaply, then Make final.`}>
              <RefreshCw className="size-3" /> Retake draft
            </button>
          ) : null}
          {t && l.needed ? makeThis : null}
        </div>
      ) : l.source ? (
        <span className="text-muted-foreground" data-singer-status="todo">
          {inRun ? `lines ${l.run!.first}-${l.run!.last} in one take · ` : ""}
          {l.engine === "mv" ? "MV Generator · " : ""}
          {l.piece.seconds} s{l.piece.handles ? " with 1 s extra before and after" : ""} · {l.resolution ?? v.resolution} · about {money(l.piece.usd)}
          {l.piece.parts ? (
            <span data-singer-parts={l.piece.parts.length} title="A long piece of singing is made in parts of about 8 s (the lips stay in time better), each from the last frame of the one before, joined into one take">
              {" "}· in {l.piece.parts.length} parts of about {Math.round((l.piece.toMs - l.piece.fromMs) / l.piece.parts.length / 1000)} s
            </span>
          ) : null}
        </span>
      ) : null}
      {l.source && !t ? makeThis : null}
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
  // Which face the takes used: the group's picture (a take of a picture the line was sung from before does not show here once the picture is switched).
  const from = singer.view?.sources.find((x) => x.file === source)?.label?.trim() || source;
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
              {t.quality === "draft" ? <span data-singer-take-badge="draft" className="rounded bg-sky-400/15 px-1 text-sky-300">Draft</span> : null}
              {t.finalOf !== undefined ? <span data-singer-take-badge="final" className="rounded bg-violet-400/15 px-1 text-violet-300">Final</span> : null}
              {t.qa?.segments.length ? (
                <span data-singer-take-qa className="rounded bg-red-500/15 px-1 text-red-300" title={t.qa.segments.map((s) => `${s.kind} ${s.fromS.toFixed(1)}–${s.toS.toFixed(1)} s`).join(" · ")}>
                  {qaWords(t.qa)}
                </span>
              ) : t.qa && !t.qa.note ? (
                <span data-singer-take-qa-ok className="text-emerald-300/80" title="Face checked frame by frame against the picture: steady">face ✓</span>
              ) : null}
              {t.trimmedOf !== undefined ? <span className="text-muted-foreground" data-singer-take-trimmed>trimmed</span> : null}
              {t.engine === "mv" ? (
                <span data-singer-take-badge="mv" className="rounded bg-fuchsia-400/15 px-1 text-fuchsia-300" title="Made by WaveSpeed's Music Video Generator">
                  MV Generator
                </span>
              ) : null}
              {t.review?.verdict === "approved" ? <span data-singer-take-badge="approved" className="rounded bg-emerald-400/15 px-1 text-emerald-300">✓ Approved</span> : t.review?.verdict === "redo" ? <span data-singer-take-badge="redo" className="rounded bg-amber-400/15 px-1 text-amber-300">Redo</span> : null}
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
              {[takeWhen(t), t.status === "running" ? "being made…" : t.status === "done" || t.request_id ? `about ${money(t.cost_usd)}` : "nothing spent", t.resolution ?? "720p", takeFeeling(t), t.parts && t.parts.length > 1 ? `${t.parts.length} parts` : "", `from ${from}`].filter(Boolean).join(" · ")}
              {t.status === "failed" || t.status === "interrupted" ? <span className={t.status === "failed" ? "text-red-300" : "text-amber-300"}> · {t.error}</span> : null}
              {t.voice === "song" ? " · lips from the whole song" : t.voice === "dereverb" ? " · lips from the dry vocal" : t.voice === "lead" ? " · lips from the lead vocal only" : ""}
              {t.nudge_ms ? ` · placed ${t.nudge_ms > 0 ? "+" : ""}${(t.nudge_ms / 1000).toFixed(1)} s` : ""}
              {t.review?.verdict === "redo" && (t.review.reasons.length || t.review.note) ? <span className="text-amber-300"> · {[...t.review.reasons, t.review.note].filter(Boolean).join(", ")}</span> : null}
            </span>
            {t.warnings?.length ? (
              <ul data-singer-take-warnings className="pl-5 text-amber-300">
                {t.warnings.map((w) => (
                  <li key={w} data-singer-take-warning>
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
            {t.status === "done" && t.file ? <TakeReview singer={singer} source={source} t={t} final={takes.find((x) => x.finalOf === t.n) ?? null} /> : null}
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

// The dry vocal for lips (28 Nov 2026): made once per song from the vocal stem (the reverb removed; the lead only on
// request), on this PC, for Lips follow; never in a video.
function DryVocalRow({ singer }: { singer: Singer }) {
  const [lead, setLead] = useState(false);
  const d = singer.view?.dryVocal;
  if (!d) return null;
  const word = (s: "ready" | "making" | "none") => (s === "ready" ? "ready" : s === "making" ? "being made…" : "not made");
  const busy = d.dry === "making" || d.lead === "making";
  const todo = d.dry === "none" || (lead && d.lead === "none");
  return (
    <div data-singer-dry className="text-muted-foreground flex flex-wrap items-center gap-2" title="The voice that drives the lips, without the reverb (and without backing vocals for the lead only), so the mouth follows each syllable cleanly. Made on this PC from your vocal stem; never used in a video: the video always plays your song.">
      <span>Dry vocal for lips:</span>
      {!d.stem ? (
        <span data-singer-dry-state="no-stem">add your vocal stem in Assets first</span>
      ) : !d.installed ? (
        <span data-singer-dry-state="not-installed">
          not installed yet: run <code>pnpm audio:setup --dereverb</code> once
        </span>
      ) : (
        <>
          <span data-singer-dry-state={d.dry}>dry vocal {word(d.dry)}</span>
          <span data-singer-lead-state={d.lead}>· lead only {word(d.lead)}</span>
          {busy ? <Loader2 className="text-brand size-3 animate-spin" /> : null}
          <label className="flex items-center gap-1">
            <input type="checkbox" data-singer-dry-lead checked={lead} onChange={(e) => setLead(e.target.checked)} />
            also the lead only
          </label>
          <button type="button" data-singer-dry-prepare disabled={busy || !todo} onClick={() => void singer.prepareDry(lead)} className="hover:bg-accent rounded border px-1.5 py-0.5 disabled:opacity-50">
            Prepare dry vocal
          </button>
        </>
      )}
    </div>
  );
}

// The MV Generator's scene / mood of a group (saved with each take sent), after the fixed rules and the lip prompt.
function SceneField({ line, value, onSave }: { line: number; value: string; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  const save = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next !== value) void onSave(next);
  };
  return (
    <textarea
      rows={2}
      data-singer-scene={line}
      value={text}
      maxLength={300}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder="Scene and mood for the MV Generator (optional), e.g. soft morning light, quiet joy"
      title="Sent to the MV Generator after its fixed rules (the same woman, setting and light as the picture; one continuous shot) and the lip prompt. Used by the next take."
      className="bg-background w-56 resize-none rounded-md border px-1.5 py-0.5 leading-snug"
    />
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
        <span className={cn("truncate", !chosen && "text-muted-foreground")}>{chosen ? (chosen.label ?? chosen.file) : "— no lip-sync take made here"}</span>
      </button>
      {open ? (
        <div data-singer-picker={line} className="bg-popover absolute right-0 z-30 mt-1 flex max-h-80 w-64 flex-col gap-1 overflow-auto rounded-lg border p-1.5 shadow-lg">
          <span className="text-muted-foreground px-1 text-[11px] font-medium">Lip sync: who sings this line?</span>
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

// The review of one take (26 Nov 2026): ✓ Approve or Redo with what is wrong (the quick reasons of Lyrics Sync's check
// by ear), the free nudge when the lips are late or early, and Make final on an approved draft.
const REASONS = ["lips late", "lips early", "mouth too open", "mouth too closed", "wrong expression", "face drifts"];
function TakeReview({ singer, source, t, final }: { singer: Singer; source: string; t: GroupTake; final: GroupTake | null }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(t.review?.reasons ?? []);
  const [note, setNote] = useState(t.review?.note ?? "");
  const approved = t.review?.verdict === "approved";
  return (
    <div className="flex flex-col gap-1 pl-5" data-singer-review-take={t.n}>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" data-singer-approve={t.n} onClick={() => void singer.review(source, t, approved ? null : "approved")} className={cn("rounded border px-1 py-px", approved ? "border-emerald-400/60 text-emerald-300" : "hover:bg-accent")} title={approved ? "Approved: click again to take the mark off" : "The lips and the expression are right"}>
          ✓ {approved ? "Approved" : "Approve"}
        </button>
        <button type="button" data-singer-redo={t.n} onClick={() => setOpen(!open)} className="hover:bg-accent rounded border px-1 py-px" title="Say what is wrong, then Retake draft">
          Redo…
        </button>
        <span className="text-muted-foreground ml-1" title="Lips late or early: move the take on the song (free, nothing is made again)">nudge</span>
        <button type="button" data-singer-nudge-minus={t.n} onClick={() => void singer.nudge(source, t, -100)} className="hover:bg-accent rounded border px-1 py-px" title="The lips are late: place the take 0.1 s earlier">
          −0.1
        </button>
        <button type="button" data-singer-nudge-plus={t.n} onClick={() => void singer.nudge(source, t, 100)} className="hover:bg-accent rounded border px-1 py-px" title="The lips are early: place the take 0.1 s later">
          +0.1
        </button>
        {t.qa?.segments.length && (t.qa.good?.toS ?? 0) >= 0.5 && Math.min(...t.qa.segments.map((s) => s.fromS)) >= 0.5 ? (
          <button type="button" data-singer-trim={t.n} onClick={() => void singer.trim(source, t)} className="hover:bg-accent rounded border border-red-400/60 px-1 py-px text-red-300" title={`A new take that ends where the face goes wrong (${qaWords(t.qa)}); its start stays in time. Nothing is deleted.`}>
            Trim to good part
          </button>
        ) : null}
        {t.quality === "draft" && approved && !final ? (
          <button type="button" data-singer-final={t.n} onClick={() => void singer.makeFinal(source, t)} className="hover:bg-accent rounded border border-violet-400/60 px-1 py-px text-violet-300" title="Upscale this approved draft to 1080p: the same lips and expression (about $0.04 per second)">
            Make final
          </button>
        ) : null}
        {final ? <span className="text-muted-foreground" data-singer-final-of={t.n}>final: {final.status === "done" ? (final.inUse ? "in use" : "made") : final.status === "running" ? "being made…" : final.status}</span> : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-1 rounded border border-dashed p-1" data-singer-redo-box={t.n}>
          <div className="flex flex-wrap gap-1">
            {REASONS.map((r) => (
              <button key={r} type="button" data-singer-reason={r} onClick={() => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} className={cn("rounded border px-1 py-px", picked.includes(r) ? "border-amber-400/60 text-amber-300" : "hover:bg-accent")}>
                {r}
              </button>
            ))}
          </div>
          <input data-singer-redo-note={t.n} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="other (a few words)" className="bg-background rounded border px-1 py-0.5" />
          <div className="flex gap-1">
            <button type="button" data-singer-redo-save={t.n} onClick={() => void singer.review(source, t, "redo", picked, note).then(() => setOpen(false))} className="hover:bg-accent rounded border border-amber-400/60 px-1 py-px text-amber-300">
              Mark to redo
            </button>
            <span className="text-muted-foreground">then fix it: nudge, the mood or the line&apos;s direction, Lips follow; and Retake draft</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Under the take (26 Nov 2026): the words being sung now (the song's lyric line at this moment, the next one dimmed),
// and a strip of the take: coloured where the voice was sent to the model, grey where it was silenced, with each line's
// words at their time and the playhead. So a word the model never heard shows at once.
function HeardStrip({ playing, lyrics, videoS }: { playing: Playing; lyrics: LyricLine[]; videoS: number }) {
  const songMs = playing.fromS * 1000 + videoS * 1000; // what is heard now
  const current = lyrics.find((l) => songMs >= l.startMs - 150 && songMs < l.endMs) ?? null;
  const next = lyrics.find((l) => l.startMs > songMs) ?? null;
  const h = playing.heard;
  const span = h ? Math.max(1, h.toMs - h.fromMs) : 1;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - (h?.fromMs ?? 0)) / span) * 100))}%`;
  const inTake = h ? lyrics.filter((l) => l.endMs > h.fromMs && l.startMs < h.toMs) : [];
  return (
    <div className="flex flex-col gap-1" data-heard>
      <p className="min-h-8 text-center text-sm leading-snug" data-heard-line={current?.number ?? ""}>
        {current ? <span className="font-medium">{current.text}</span> : <span className="text-muted-foreground">(no line sung now)</span>}
        {next && (!current || next.number !== current.number) ? <span className="text-muted-foreground block text-[11px]">next: {next.text}</span> : null}
      </p>
      {h ? (
        <div className="flex flex-col gap-0.5">
          <div className="relative h-3 overflow-hidden rounded bg-sky-400/50" data-heard-strip title="What the model heard: blue = the voice sent, grey = silenced (it breathes there)">
            {h.rests.map((r) => (
              <div key={`${r.fromMs}`} className="absolute top-0 h-3 bg-zinc-600" style={{ left: pct(r.fromMs), width: `calc(${pct(r.toMs)} - ${pct(r.fromMs)})` }} data-heard-rest />
            ))}
            {(playing.bad ?? []).map((b) => (
              <div key={`b${b.fromS}`} className="absolute top-0 h-3 bg-red-500/80" style={{ left: pct(h.fromMs + b.fromS * 1000), width: `calc(${pct(h.fromMs + b.toS * 1000)} - ${pct(h.fromMs + b.fromS * 1000)})` }} title={`${b.kind} ${b.fromS.toFixed(1)}–${b.toS.toFixed(1)} s`} data-heard-bad />
            ))}
            <div className="absolute top-0 h-3 w-0.5 bg-white" style={{ left: pct(h.fromMs + videoS * 1000) }} />
          </div>
          <div className="text-muted-foreground relative h-4 text-[9px]">
            {inTake.map((l) => (
              <span key={l.number} className="absolute truncate" style={{ left: pct(Math.max(l.startMs, h.fromMs)), maxWidth: "45%" }} title={l.text} data-heard-word={l.number}>
                {l.number}. {l.text}
              </span>
            ))}
          </div>
          <span className="text-muted-foreground text-[10px]">Blue: the voice the model heard. Grey: silenced (it breathes). A word on grey was never heard.{playing.bad?.length ? " Red: the face goes wrong there." : ""}</span>
        </div>
      ) : null}
    </div>
  );
}
