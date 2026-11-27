"use client";

// "Cut while it plays" (27 Nov 2026, Paul: "build it now"; how music-video editors work with multicam): the song
// plays, the picture in use plays above it in time, and under it only the CURRENT moment's options (never the whole
// song: "I don't want a very crowded screen"). A click (or 1–9) puts one in and the song plays on. Two passes:
//   - Singer: each sung line, its singing takes (Lyrics Sync) and music-video shots, in time with the song; ★ the app's
//     pick (mv-best.ts);
//   - Story: each planned shot (Production), its takes and videos and the music-video shots that play then.
// Every click is a pick the app never replaces. Keys: space play / pause, 1–9 choose, ← → previous / next moment.
// Reads /api/songs/[id]/pictures, /mv-shots, /singer, /lyrics; the actions are the same as in Creation and Lyrics Sync.
import { Check, ChevronLeft, ChevronRight, Loader2, Pause, Play, Scissors, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PicturesView, PictureView } from "@lyric/video/animate";
import { clipTimeAt, momentAt, singerMoments, storyMoments, type Moment } from "@lyric/video/cut-while-playing";
import type { BestView } from "@lyric/video/mv-best";
import { mvShotsForPlanned } from "@lyric/video/music-video-shots";
import type { ProductionView } from "@lyric/video/shot-production";
import type { SingerView } from "@lyric/video/singer";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

type Pass = "singer" | "story";
type Option = {
  key: string;
  title: string;
  sub: string;
  url: string; // the video
  startSongMs: number | null; // the song time of its first frame (locked to the song), else null
  thumbS: number;
  inUse: boolean;
  best: boolean;
  choose: { to: "pictures" | "singer"; body: Record<string, unknown> };
};
type Data = { board: PicturesView; production: ProductionView | null; best: BestView | null; singer: SingerView | null; lines: { number: number; text: string; startMs: number | null; sungEndMs: number | null }[] };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await api(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function CutWhilePlayingButton({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" data-cut-open onClick={() => setOpen(true)} title="Play the song and pick, moment by moment, what shows: like a music-video editor's multicam. Only the moment playing shows its options.">
        <Scissors /> Cut while it plays
      </Button>
      {open ? <CutWhilePlaying projectId={projectId} onClose={() => (setOpen(false), onChanged())} /> : null}
    </>
  );
}

function CutWhilePlaying({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [pass, setPass] = useState<Pass>("singer");
  const [songMs, setSongMs] = useState(0);
  const [songLength, setSongLength] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const preview = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    const [pics, mv, singer, lyrics] = await Promise.all([
      getJson<{ board: PicturesView; production: ProductionView | null }>(`/api/songs/${projectId}/pictures`),
      getJson<{ best: BestView | null }>(`/api/songs/${projectId}/mv-shots`),
      getJson<{ singer?: SingerView }>(`/api/songs/${projectId}/singer`),
      getJson<{ lines?: { number: number; text: string; startMs: number | null; sungEndMs: number | null }[] }>(`/api/songs/${projectId}/lyrics`),
    ]);
    if (!pics) return setNotice({ ok: false, text: "The song's pictures and takes could not be read." });
    setData({ board: pics.board, production: pics.production, best: mv?.best ?? null, singer: singer?.singer ?? null, lines: lyrics?.lines ?? [] });
  }, [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once when it opens
    void load();
  }, [load]);

  const moments: Moment[] = useMemo(() => {
    if (!data) return [];
    return pass === "singer" ? singerMoments(data.lines, songLength) : storyMoments(data.production?.shots ?? []);
  }, [data, pass, songLength]);
  const at = momentAt(moments, songMs);
  const moment = at >= 0 ? moments[at] : null;
  const picturesDir = useMemo(() => {
    const p = data?.board.pictures[0];
    return p ? p.url.slice(0, p.url.lastIndexOf("/")) : null;
  }, [data]);

  const options: Option[] = useMemo(() => {
    if (!data || !moment) return [];
    const out: Option[] = [];
    const mvVideos = data.board.pictures.filter((p) => p.mv?.matched);
    if (pass === "singer" && moment.line !== null) {
      const n = moment.line;
      // Singing takes of the line (Lyrics Sync): on the first line of their run.
      const group = data.singer?.lines?.find((l) => l.run && l.run.first <= n && n <= l.run.last && l.number === l.run.first) ?? data.singer?.lines?.find((l) => l.number === n);
      for (const t of group?.takes ?? []) {
        if (t.status !== "done" || !t.file || !group?.source || !picturesDir || t.sync_ms === undefined) continue;
        out.push({ key: `sing:${group.source}#${t.n}`, title: t.label ?? `Singing take ${t.n}`, sub: `${group.source.replace(/\.[^.]+$/, "")} · lip sync`, url: fileUrl(`${picturesDir}/${t.file}`), startSongMs: t.sync_ms + (t.nudge_ms ?? 0), thumbS: 0.5, inUse: t.inUse, best: false, choose: { to: "singer", body: { action: "use", source: group.source, n: t.n } } });
      }
      // Music-video shots of the line, the app's pick first.
      const best = data.best;
      const pick = best?.rows.find((r) => r.first <= n && n <= r.last)?.pick ?? null;
      for (const c of (best?.candidates ?? []).filter((c) => c.first <= n && n <= c.last).sort((a, b) => b.score - a.score)) {
        const v = best!.videos.find((x) => x.file === c.video);
        if (!v) continue;
        out.push({
          key: `mv:${c.video}#${c.shot}`,
          title: `${c.label} · shot ${c.shot + 1}`,
          sub: c.reasons.join(", "),
          url: fileUrl(v.url),
          startSongMs: v.offsetMs,
          thumbS: Math.max(0, ((c.songFromMs + c.songToMs) / 2 - v.offsetMs) / 1000),
          inUse: c.inUse,
          best: !!pick && pick.video === c.video && pick.shot === c.shot && (best?.candidates.filter((x) => x.first <= n && n <= x.last).length ?? 0) > 1,
          choose: { to: "pictures", body: { action: "mv-best-pick", file: c.video, shot: c.shot } },
        });
      }
    }
    if (pass === "story" && moment.slot) {
      const shot = data.production?.shots.find((s) => s.id === moment.slot);
      if (shot) {
        for (const p of data.board.pictures.filter((q) => q.slot === shot.id && !q.mv)) {
          if (p.kind === "video") out.push(storyOption(p, null, fileUrl(p.url), shot.id, same(p.sent, shot.filled), p.label ?? p.file, `Your video · ${p.source}`));
          for (const t of p.takes) if (t.status === "done" && t.file && t.mvShot === undefined && picturesDir) out.push(storyOption(p, t.n, fileUrl(`${picturesDir}/${t.file}`), shot.id, same(t.sent, shot.filled), t.label ?? `${p.label ?? p.file} · take ${t.n}`, t.model ?? "take"));
        }
        for (const p of mvVideos)
          for (const m of mvShotsForPlanned(shot, p.mv!.shots))
            out.push({ key: `mvslot:${p.file}#${m.i}`, title: `${p.label ?? p.file.replace(/\.[^.]+$/, "")} · shot ${m.i + 1}`, sub: m.first !== null ? `sings line ${m.first}` : "music video, no singing", url: fileUrl(p.url), startSongMs: p.mv!.offsetMs, thumbS: (m.fromMs + m.toMs) / 2000, inUse: same(m.sent, shot.filled), best: false, choose: { to: "pictures", body: { action: "mv-use-slot", file: p.file, shot: m.i, slot: shot.id } } });
      }
    }
    return out.slice(0, 9);
  }, [data, moment, pass, picturesDir]);
  const inUse = options.find((o) => o.inUse) ?? null;

  // The picture in use follows the song (a clip locked to the song exactly; another from the moment's start).
  useEffect(() => {
    const v = preview.current;
    if (!v || !inUse || !moment) return;
    const want = clipTimeAt(songMs, inUse.startSongMs, moment.fromMs, Number.isFinite(v.duration) ? v.duration : null);
    if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [songMs, inUse, moment, playing]);

  const choose = useCallback(
    async (o: Option) => {
      if (o.inUse || busy) return;
      setBusy(o.key);
      try {
        const r = await api(`/api/songs/${projectId}/${o.choose.to}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o.choose.body) });
        const d = (await r.json()) as { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        setNotice({ ok: true, text: `${moment?.label}: ${o.title}.` });
        await load();
      } catch (e) {
        setNotice({ ok: false, text: (e as Error).message });
      } finally {
        setBusy(null);
      }
    },
    [busy, load, moment, projectId],
  );
  const seek = useCallback(
    (i: number) => {
      const m = moments[Math.max(0, Math.min(moments.length - 1, i))];
      if (!m || !audio.current) return;
      audio.current.currentTime = m.fromMs / 1000;
      setSongMs(m.fromMs);
    },
    [moments],
  );
  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") seek(at + 1);
      else if (e.key === "ArrowLeft") seek(songMs - (moment?.fromMs ?? 0) > 1500 ? at : at - 1);
      else if (/^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) void choose(options[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at, choose, moment, options, seek, songMs, toggle]);

  const song = data?.board.song ? fileUrl(data.board.song) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-cut className="flex max-h-[95vh] w-[min(64rem,96vw)] max-w-none flex-col gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-4" /> Cut while it plays
          </DialogTitle>
          <DialogDescription>Play the song and click what should show; it plays on. Keys: space play / pause, 1–9 choose, ← → moments.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(["singer", "story"] as const).map((p) => (
            <button key={p} type="button" data-cut-pass={p} aria-pressed={pass === p} onClick={() => setPass(p)} className={cn("rounded-md border px-2 py-1", pass === p ? "border-brand bg-brand/15" : "hover:bg-accent")}>
              {p === "singer" ? "Singer: the sung lines" : "Story: the planned shots"}
            </button>
          ))}
          {!data ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : null}
        </div>
        {data && !moments.length ? (
          <p className="text-muted-foreground text-sm" data-cut-empty>
            {pass === "singer" ? "No timed lines yet: time the lyrics first (Lyrics Sync)." : "No planned shots with a time on the song: make a shot list (Story room) first."}
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="bg-muted relative aspect-[9/16] max-h-[55vh] w-full justify-self-center overflow-hidden rounded-lg" data-cut-preview>
            {inUse ? <video ref={preview} key={inUse.key} src={inUse.url} muted playsInline preload="auto" className="size-full object-contain" /> : <span className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm">Nothing in use for this moment yet: pick one on the right.</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2" data-cut-moment={moment?.key ?? ""}>
              <Button type="button" size="icon" variant="outline" onClick={() => seek(at - 1)} aria-label="Previous moment">
                <ChevronLeft />
              </Button>
              <Button type="button" size="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-cut-play>
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button type="button" size="icon" variant="outline" onClick={() => seek(at + 1)} aria-label="Next moment">
                <ChevronRight />
              </Button>
              <span className="min-w-0 flex-1 text-sm">
                <b>{moment?.label ?? "—"}</b> <span className="text-muted-foreground tabular-nums">{clock(songMs)}</span>
                {moment?.text ? <span className="text-muted-foreground block truncate">“{moment.text}”</span> : null}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {at + 1} / {moments.length}
              </span>
            </div>
            {song ? <audio ref={audio} src={song} preload="auto" onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setSongLength(e.currentTarget.duration * 1000)} onTimeUpdate={(e) => setSongMs(e.currentTarget.currentTime * 1000)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="hidden" /> : null}
            <input type="range" min={0} max={songLength ?? 0} value={songMs} onChange={(e) => audio.current && ((audio.current.currentTime = Number(e.target.value) / 1000), setSongMs(Number(e.target.value)))} className="w-full" aria-label="Where in the song" />
            {moment && !options.length ? <p className="text-muted-foreground text-xs" data-cut-none>Nothing to choose for this moment yet{pass === "singer" ? " (no singing take or music-video shot on this line)" : " (no take or video for this planned shot)"}.</p> : null}
            <div className="grid grid-cols-3 gap-2" data-cut-options>
              {options.map((o, i) => (
                <button key={o.key} type="button" data-cut-option={o.key} disabled={busy !== null} onClick={() => void choose(o)} className={cn("relative flex flex-col gap-1 rounded-md border p-1 text-left text-[11px]", o.inUse ? "border-emerald-400 bg-emerald-400/10" : "hover:border-brand/60")} title={o.sub}>
                  <video src={`${o.url}#t=${o.thumbS.toFixed(2)}`} muted playsInline preload="metadata" className="bg-muted aspect-video w-full rounded object-cover" />
                  <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1 font-semibold">{i + 1}</span>
                  {o.best ? <Star className="absolute top-1.5 right-1.5 size-3.5 fill-amber-300 text-amber-300" aria-label="The app's pick" /> : null}
                  <span className="truncate font-medium">{o.title}</span>
                  <span className="text-muted-foreground line-clamp-2">{o.sub}</span>
                  {o.inUse ? (
                    <span className="flex items-center gap-1 text-emerald-300" data-cut-used>
                      <Check className="size-3" /> In use
                    </span>
                  ) : busy === o.key ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                </button>
              ))}
            </div>
            {notice ? <p className={cn("text-xs", notice.ok ? "text-emerald-200" : "text-red-200")} data-cut-notice>{notice.text}</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function storyOption(p: PictureView, n: number | null, url: string, slot: string, inUse: boolean, title: string, sub: string): Option {
  return { key: `story:${p.file}#${n ?? "file"}`, title, sub, url, startSongMs: null, thumbS: 0.5, inUse, best: false, choose: { to: "pictures", body: { action: "use-shot", file: p.file, n, slot } } };
}
