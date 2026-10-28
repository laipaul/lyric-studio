"use client";

// The song page's Storyboard (stage 1, read-only): a video's cut plan without rendering it (the same
// planner Generate renders with) or a past run's. Rows: the waveform with bars and hook sections, the
// lyric lines at their on-screen times (⚓ anchored), the shots as blocks with their badges and warnings.
// Click anywhere on the timeline: the low-res preview plays from there.
import { Player, type PlayerRef } from "@remotion/player";
import { AlertTriangle, Anchor, Blend, Gauge, Loader2, Repeat, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LyricVideo, type StoryShot } from "@lyric/video";
import type { StoryboardChoices, StoryboardView } from "@lyric/video/node"; // types only (erased): the data comes from /api/songs/[id]/storyboard

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const ZOOMS = [40, 80, 160]; // pixels per second
const select = "bg-input/30 border-input h-8 rounded-md border px-2 text-sm";

type Source = { kind: "plan"; platform: string; video: string } | { kind: "run"; run: string; platform: string; video: string };

export function StoryboardTab({ projectId }: { projectId: string }) {
  const [choices, setChoices] = useState<StoryboardChoices | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [view, setView] = useState<StoryboardView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOMS[1]);
  const [selected, setSelected] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const player = useRef<PlayerRef>(null);

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/storyboard`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StoryboardChoices & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) return setError(d.error);
        setChoices(d);
        const first = d.platforms[0];
        if (first) setSource({ kind: "plan", platform: first.name, video: first.videos[0] ?? "v1" });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function show(s: Source) {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const q = new URLSearchParams({ platform: s.platform, video: s.video, ...(s.kind === "run" ? { run: s.run } : {}) });
      const r = await api(`/api/songs/${projectId}/storyboard?${q}`, { cache: "no-store" });
      const d = (await r.json()) as StoryboardView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setView(d);
      setFrame(0);
    } catch (e) {
      setError((e as Error).message);
      setView(null);
    } finally {
      setLoading(false);
    }
  }

  // The preview follows the playhead.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const update = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", update);
    return () => p.removeEventListener("frameupdate", update);
  }, [view]);

  const props = useMemo(() => (view ? { ...view.props, mediaBaseUrl: `/api/songs/${projectId}/storyboard/media` } : null), [view, projectId]);
  const playFrom = (ms: number) => {
    const p = player.current;
    if (!p || !view) return;
    p.seekTo(Math.max(0, Math.min(view.props.durationInFrames - 1, Math.round((ms * 30) / 1000))));
    p.play();
  };

  if (error && !choices) return <p className="text-sm text-red-300">{error}</p>;
  if (!choices) return <p className="text-muted-foreground text-sm">Loading the storyboard…</p>;
  if (!choices.ready) return <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">{choices.why}</p>;

  const run = source?.kind === "run" ? choices.runs.find((r) => r.folder === source.run) : null;
  const platforms = source?.kind === "run" ? (run?.platforms ?? []) : choices.platforms;
  const videos = platforms.find((p) => p.name === source?.platform)?.videos ?? [];
  const width = view ? Math.ceil((view.durationMs / 1000) * zoom) : 0;
  const x = (ms: number) => (ms / 1000) * zoom;
  const playhead = (frame * 1000) / 30;
  const shot = view && selected !== null ? view.shots[selected] : null;

  return (
    <div data-storyboard className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        The cut plan as Generate would make it (nothing is rendered), or a past run&apos;s. Read-only for now: shots, lines and anchors as planned; click the timeline to play from there.
      </p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Show</span>
          <select
            className={select}
            data-storyboard-source
            value={source?.kind === "run" ? source.run : "plan"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "plan") setSource({ kind: "plan", platform: choices.platforms[0]?.name ?? "reels", video: "v1" });
              else {
                const r = choices.runs.find((x) => x.folder === v)!;
                setSource({ kind: "run", run: v, platform: r.platforms[0].name, video: r.platforms[0].videos[0] });
              }
            }}
          >
            <option value="plan">The plan now (as Generate would make it)</option>
            {choices.runs.map((r) => (
              <option key={r.folder} value={r.folder}>
                Run {r.folder.replace("_", " ").replace(/(\d{2})(\d{2})$/, "$1:$2")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Platform</span>
          <select className={select} data-storyboard-platform value={source?.platform ?? ""} onChange={(e) => source && setSource({ ...source, platform: e.target.value, video: platforms.find((p) => p.name === e.target.value)?.videos[0] ?? "v1" })}>
            {platforms.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Video</span>
          <select className={select} data-storyboard-video value={source?.video ?? "v1"} onChange={(e) => source && setSource({ ...source, video: e.target.value })}>
            {videos.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={!source || loading} onClick={() => source && show(source)} data-storyboard-show>
          {loading ? <Loader2 className="animate-spin" /> : null} {loading ? "Planning…" : "Show"}
        </Button>
        {view ? (
          <div className="ml-auto flex items-center gap-1 text-xs">
            Zoom
            {ZOOMS.map((z) => (
              <button key={z} type="button" onClick={() => setZoom(z)} className={cn("rounded border px-1.5", zoom === z ? "border-brand text-brand" : "text-muted-foreground")}>
                {z / 40}x
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      {view && props ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-sm" data-storyboard-summary>
              <span className="font-medium">
                {view.platform.label} {view.video}
              </span>{" "}
              · {view.source === "plan" ? "planned now" : `run ${view.run}`} · {view.settings} · {secs(view.durationMs)} ({clock(view.section.startMs)}–{clock(view.section.endMs)} in the song) · {Math.round(view.bpm)} BPM · {view.shots.length} shots
            </p>
            <p className="text-muted-foreground mb-3 text-xs">{view.section.reason}</p>
            <div className="overflow-x-auto rounded-lg border" data-storyboard-timeline>
              <div className="relative" style={{ width: width + 16 }} onClick={(e) => playFrom(((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000)}>
                {/* bars and hook sections */}
                <div className="relative h-6 border-b text-[10px]">
                  {view.hooks.map((h, i) => (
                    <div key={i} className="bg-brand/15 absolute top-0 bottom-0" style={{ left: x(h.startMs), width: x(h.endMs - h.startMs) }} title="hook (chorus)" data-hook-section />
                  ))}
                  {view.bars.map((b, i) => (
                    <div key={b} className="text-muted-foreground absolute top-0 h-full border-l border-white/20 pl-0.5" style={{ left: x(b) }} data-bar>
                      {i + 1}
                    </div>
                  ))}
                </div>
                {/* waveform */}
                <svg className="block h-14 w-full border-b" viewBox={`0 0 ${view.waveform.peaks.length} 100`} preserveAspectRatio="none" style={{ width }} data-waveform>
                  {view.waveform.peaks.map((p, i) => (
                    <rect key={i} x={i} y={50 - p * 48} width={0.8} height={Math.max(1, p * 96)} className="fill-brand/60" />
                  ))}
                </svg>
                {/* lyric lines */}
                <div className="relative h-12 border-b">
                  {view.lines.map((l, i) => (
                    <div
                      key={i}
                      data-story-line={l.number ?? ""}
                      data-anchored={l.anchor ?? undefined}
                      className={cn("absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-[11px] leading-tight", l.isHook ? "border-brand/50 bg-brand/10" : "bg-muted/40")}
                      style={{ left: x(l.startMs), width: Math.max(4, x(l.endMs - l.startMs) - 2) }}
                      title={`${l.number ? `line ${l.number}: ` : ""}${l.text} (${clock(l.startMs)}–${clock(l.endMs)})${l.anchor ? ` · ⚓ ${l.anchor}` : ""}`}
                    >
                      {l.anchor ? <Anchor className="text-brand mr-0.5 inline size-3" aria-label="anchored" /> : null}
                      {l.text}
                    </div>
                  ))}
                </div>
                {/* shots */}
                <div className="relative h-24">
                  {view.shots.map((s) => (
                    <ShotBlock key={s.index} shot={s} left={x(s.startMs)} width={x(s.endMs - s.startMs)} selected={selected === s.index} onSelect={() => setSelected(s.index)} />
                  ))}
                </div>
                <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white" style={{ left: x(playhead) }} data-playhead />
              </div>
            </div>
            {shot ? <ShotDetails shot={shot} /> : <p className="text-muted-foreground mt-2 text-xs">Click a shot for its details.</p>}
            {view.anchorsOutside.length ? (
              <p className="text-muted-foreground mt-3 text-xs" data-anchors-outside>
                <Anchor className="mr-1 inline size-3" />
                Not in this section: {view.anchorsOutside.map((a) => `line ${a.line} "${a.text}" → ${a.clip}`).join(" · ")}
              </p>
            ) : null}
            {[...view.anchorWarnings, ...view.notes].length ? (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-amber-200" data-storyboard-warnings>
                {[...view.anchorWarnings, ...view.notes].map((w) => (
                  <li key={w} className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="w-full shrink-0 lg:w-64">
            <div className={cn("overflow-hidden rounded-xl border bg-black", props.format && props.format.width > props.format.height ? "aspect-video" : "aspect-[9/16]")}>
              <Player
                ref={player}
                component={LyricVideo}
                inputProps={props}
                durationInFrames={props.durationInFrames}
                compositionWidth={props.format?.width ?? 1080}
                compositionHeight={props.format?.height ?? 1920}
                fps={30}
                controls
                style={{ width: "100%", height: "100%" }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-[11px]">Low-res preview of the same composition; {clock(playhead)}.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShotBlock({ shot: s, left, width, selected, onSelect }: { shot: StoryShot; left: number; width: number; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-shot={s.index + 1}
      data-warnings={s.warnings.length || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cn("absolute top-1 bottom-1 overflow-hidden rounded border text-left text-[10px] text-white", s.warnings.length ? "border-amber-400" : "border-white/20", selected && "ring-brand ring-2")}
      style={{ left, width: Math.max(6, width - 2), backgroundImage: s.thumb ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.65)), url(/api/files/${s.thumb})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}
      title={`${s.clip} · ${secs(s.endMs - s.startMs)}${s.warnings.length ? `\n${s.warnings.join("\n")}` : ""}`}
    >
      <div className="flex flex-wrap gap-0.5 p-0.5">
        {s.anchor ? (
          <span className="bg-brand/80 flex items-center rounded px-0.5" data-badge="anchor">
            <Anchor className="size-2.5" />
            {s.anchor.line}
          </span>
        ) : null}
        {s.best ? <Star className="size-3 text-yellow-300" data-badge="best" aria-label="best moment" /> : null}
        {s.dissolve ? <Blend className="size-3 text-sky-300" data-badge="dissolve" aria-label="dissolve" /> : null}
        {s.loop ? <Repeat className="size-3 text-emerald-300" data-badge="loop" aria-label="loop ending" /> : null}
        {s.speed < 1 ? (
          <span className="flex items-center rounded bg-black/60 px-0.5" data-badge="speed">
            <Gauge className="size-2.5" />
            {s.speed.toFixed(2)}x
          </span>
        ) : null}
        {s.warnings.length ? <AlertTriangle className="size-3 text-amber-300" data-badge="warning" /> : null}
      </div>
      <div className="absolute right-0.5 bottom-0.5 left-0.5 truncate">
        {s.index + 1} · {s.clip}
        <br />
        {secs(s.endMs - s.startMs)} · {s.inS.toFixed(1)}–{s.outS.toFixed(1)} s
      </div>
    </button>
  );
}

function ShotDetails({ shot: s }: { shot: StoryShot }) {
  return (
    <div className="bg-card mt-2 rounded-lg border p-3 text-xs" data-shot-details={s.index + 1}>
      <p className="mb-1 text-sm font-medium">
        Shot {s.index + 1}: {s.clip}
      </p>
      <p>
        {clock(s.startMs)}–{clock(s.endMs)} in the video ({secs(s.endMs - s.startMs)}), cut at {clock(s.songMs)} in the song · in {s.inS.toFixed(2)} s → out {s.outS.toFixed(2)} s of the clip ·{" "}
        {s.kind === "photo" ? "photo (slow move)" : `speed ${s.speed.toFixed(2)}x`}
        {s.dissolve ? " · dissolves in" : ""}
      </p>
      {s.anchor ? (
        <p className="text-brand mt-1">
          ⚓ anchored on line {s.anchor.line} &quot;{s.anchor.text}&quot;
        </p>
      ) : null}
      {s.best ? <p className="mt-1 text-yellow-200">★ shows the clip&apos;s best moment</p> : null}
      {s.loop ? <p className="mt-1 text-emerald-300">↻ the loop ending: the frames just before shot 1, so the video loops seamlessly</p> : null}
      {s.warnings.map((w) => (
        <p key={w} className="mt-1 flex items-start gap-1 text-amber-200">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
}
