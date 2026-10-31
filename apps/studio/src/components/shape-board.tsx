"use client";

// The Shape page (shape-page.tsx) around a video's plan: the tools column on the left (the selected shot,
// clip or text card above the recipe tools) and, in the middle, the viewer on top, then the soundtrack
// (bars, waveform, lyric lines), the shots and the clips used. The plan is the storyboard: a video's cut plan without rendering it (the same planner Generate renders
// with) or a past run's. Rows: the waveform with bars and hook sections, the lyric lines at their
// on-screen times (⚓ anchored), the shots as blocks with their badges and warnings. Click anywhere on
// the timeline: the low-res preview plays from there. Stage 2 (plans only): drag clips in the story
// strip into order (clips.json), drag a clip onto a lyric line (an anchor), click a shot or a clip to
// edit it (in / out, speed, best moment); every change plans again. The Textboard row: the song's text
// cards (title, byline, tagline, every lyric line); click one to change its place, size, hold and
// effect with a live preview (saved in textboard.json), save the design as a template or apply one.
// Pictures: the same textboard over another clip set; an anchor whose clip is missing is a slot.
import { Player, type PlayerRef } from "@remotion/player";
import { AlertTriangle, Anchor, Blend, ChevronLeft, ChevronRight, Gauge, Loader2, Pencil, Repeat, Scissors, Star, Type, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EFFECT_NAMES, followScrollLeft, LyricVideo, patchLook, previewCard, type CardOverrides, type CardStyle, type StoryShot, type TextCard } from "@lyric/video";
import type { StoryboardChoices, StoryboardClip, StoryboardView, TextboardData } from "@lyric/video/node"; // types only (erased): the data comes from /api/songs/[id]/storyboard

import { AssessmentDetails, VerdictBadge } from "@/components/assessment";
import { LookViewer } from "@/components/look-preview";
import type { ShapeLook } from "@/components/shape-tools";
import { useGoToTab } from "@/components/song-stages";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const ZOOMS = [40, 80, 160]; // pixels per second
const FOLLOW_KEY = "lyric-studio:storyboard-follow"; // "Follow playback", remembered in this browser only
const readFollow = () => {
  try {
    return window.localStorage.getItem(FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
};
const select = "bg-input/30 border-input h-8 rounded-md border px-2 text-sm";

type Source = { kind: "plan"; platform: string; video: string } | { kind: "run"; run: string; platform: string; video: string };

export function ShapeBoard({ projectId, tools, look, replan, onPlanned }: { projectId: string; tools: ReactNode; look: ShapeLook | null; replan: number; onPlanned: (replan: number) => void }) {
  const goTo = useGoToTab();
  const [choices, setChoices] = useState<StoryboardChoices | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [view, setView] = useState<StoryboardView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOMS[1]);
  const [selected, setSelected] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const player = useRef<PlayerRef>(null);
  // "Follow playback": the timeline scrolls with the playhead while the preview plays (off by default).
  // Scrolling the timeline by hand pauses it until the next play.
  const [follow, setFollow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timeline = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(false); // the next scroll event is ours, not the user's
  const heldByUser = useRef(false);
  const [editing, setEditing] = useState<string | null>(null); // the clip in the clip editor
  const [saving, setSaving] = useState(false);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const [dropShot, setDropShot] = useState<number | null>(null); // a clip dragged over this shot
  const [board, setBoard] = useState<TextboardData | null>(null);
  const [cardId, setCardId] = useState<string | null>(null); // the card in the card editor
  const [draft, setDraft] = useState<CardOverrides>({}); // its overrides while editing (live preview)
  const [notice, setNotice] = useState<string | null>(null);
  const [pictures, setPictures] = useState<{ songClips: boolean; collections: string[] } | null>(null); // the clip set planned

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/storyboard`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StoryboardChoices & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) return setError(d.error);
        setChoices(d);
        setPictures(d.pictures.recipe);
        const first = d.platforms[0];
        if (first) setSource({ kind: "plan", platform: first.name, video: first.videos[0] ?? "v1" });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/textboard`, { cache: "no-store" })
      .then((r) => r.json() as Promise<TextboardData & { error?: string }>)
      .then((d) => alive && !d.error && setBoard(d))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [projectId]);
  // The picture swap: a clip set other than the recipe's ("song+wedding", "city"), else null.
  const clipSet = (p: typeof pictures) => {
    if (!p || !choices) return null;
    const same = p.songClips === choices.pictures.recipe.songClips && [...p.collections].sort().join(",") === [...choices.pictures.recipe.collections].sort().join(",");
    return same ? null : [...(p.songClips ? ["song"] : []), ...p.collections].join("+") || null;
  };

  // One plan at a time (each is its own planner process): a request while one runs waits, and only the
  // latest waiting one runs after it.
  const planning = useRef(false);
  const waiting = useRef<(() => void) | null>(null);
  async function show(s: Source, keep = false, set = pictures) {
    if (planning.current) {
      waiting.current = () => void show(s, keep, set);
      return;
    }
    planning.current = true;
    const forChange = replan; // the recipe change this plan includes
    setLoading(true);
    setError(null);
    if (!keep) {
      setSelected(null);
      setEditing(null);
      setCardId(null);
    }
    try {
      const swap = s.kind === "plan" ? clipSet(set) : null;
      const q = new URLSearchParams({ platform: s.platform, video: s.video, ...(s.kind === "run" ? { run: s.run } : {}), ...(swap ? { clips: swap } : {}) });
      const r = await api(`/api/songs/${projectId}/storyboard?${q}`, { cache: "no-store" });
      const d = (await r.json()) as StoryboardView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setView(d);
      if (!keep) setFrame(0);
      onPlanned(forChange);
    } catch (e) {
      setError((e as Error).message);
      if (!keep) setView(null); // planning again failed: the last plan stays on screen
    } finally {
      setLoading(false);
      planning.current = false;
      const next = waiting.current;
      waiting.current = null;
      next?.();
    }
  }

  // The plan shows as soon as a platform / video is chosen (and on opening the page).
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => void show(source));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planned again only when the source changes
  }, [source]);
  // A recipe change (the tools column): plan again, keeping the selection and the playhead.
  useEffect(() => {
    if (!replan || source?.kind !== "plan") return;
    const t = setTimeout(() => void show(source, true));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the recipe changed
  }, [replan]);

  // One storyboard edit (story order, clip edit, anchor), then the plan again.
  async function edit(body: Record<string, unknown>) {
    if (!source || source.kind !== "plan") return;
    setSaving(true);
    setError(null);
    try {
      const r = await api(`/api/songs/${projectId}/storyboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await show(source, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  // One textboard edit (a card, a template), then the plan again.
  async function editText(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/textboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { data?: TextboardData; message?: string; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      if (d.data) setBoard(d.data);
      setNotice(d.message ?? null);
      if (source) await show(source, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const openCard = (id: string) => {
    setCardId(id);
    setDraft(board?.cards.find((c) => c.id === id)?.overrides ?? {});
  };
  const moveClip = (name: string, to: number) => {
    if (!view) return;
    const order = view.clips.map((c) => c.name).filter((n) => n !== name);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, name);
    void edit({ action: "order", order });
  };

  // The preview follows the playhead.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const update = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => {
      heldByUser.current = false;
      setPlaying(true);
    };
    const onStop = () => setPlaying(false);
    p.addEventListener("frameupdate", update);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onStop);
    p.addEventListener("ended", onStop);
    return () => {
      p.removeEventListener("frameupdate", update);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onStop);
      p.removeEventListener("ended", onStop);
    };
  }, [view]);

  useEffect(() => setFollow(readFollow()), []);
  const toggleFollow = () => {
    const next = !follow;
    setFollow(next);
    heldByUser.current = false;
    try {
      window.localStorage.setItem(FOLLOW_KEY, next ? "1" : "0");
    } catch {
      // not remembered (private window): the toggle still works for this visit
    }
  };
  // While following and playing: keep the playhead a third from the timeline's left edge.
  useEffect(() => {
    const el = timeline.current;
    if (!follow || !playing || heldByUser.current || !el) return;
    const target = followScrollLeft({ scrollLeft: el.scrollLeft, viewWidth: el.clientWidth, contentWidth: el.scrollWidth, playheadX: (frame / 30) * zoom });
    if (target === null) return;
    autoScroll.current = true;
    el.scrollLeft = target;
  }, [follow, playing, frame, zoom]);
  const onTimelineScroll = () => {
    if (autoScroll.current) autoScroll.current = false;
    else if (playing) heldByUser.current = true; // the user scrolled: stop following until the next play
  };

  const card = board?.cards.find((c) => c.id === cardId) ?? null;
  // The live preview: the edited card's place, size, hold and effect on the planned props (a font
  // change shows after saving: it needs its font file).
  const props = useMemo(() => {
    if (!view) return null;
    let lyrics = view.props.lyrics;
    if (card?.type === "lyric" && view.props.lyricArea) {
      const own: CardOverrides = { ...draft };
      delete own.text;
      delete own.show;
      const style: CardStyle = { ...(board?.roles[card.isHook ? "hook" : "verse"] ?? {}), ...own };
      lyrics = previewCard(lyrics, card.id, style, { area: view.props.lyricArea, durationInFrames: view.props.durationInFrames });
    }
    const planned = { ...view.props, lyrics, mediaBaseUrl: `/api/songs/${projectId}/storyboard/media` };
    // A look change not planned yet (or a pairing pointed at): patched in at once (plans only).
    return view.source === "plan" ? patchLook(planned, look?.patch ?? null, view.bars.map((ms) => Math.round((ms * 30) / 1000))) : planned;
  }, [view, projectId, card, draft, board, look?.patch]);
  const playFrom = (ms: number) => {
    const p = player.current;
    if (!p || !view) return;
    p.seekTo(Math.max(0, Math.min(view.props.durationInFrames - 1, Math.round((ms * 30) / 1000))));
    p.play();
  };

  const run = source?.kind === "run" ? choices?.runs.find((r) => r.folder === source.run) : null;
  const platforms = !choices ? [] : source?.kind === "run" ? (run?.platforms ?? []) : choices.platforms;
  const videos = platforms.find((p) => p.name === source?.platform)?.videos ?? [];
  const width = view ? Math.ceil((view.durationMs / 1000) * zoom) : 0;
  const x = (ms: number) => (ms / 1000) * zoom;
  const playhead = (frame * 1000) / 30;
  const shot = view && selected !== null ? view.shots[selected] : null;
  const wide = !!props?.format && props.format.width > props.format.height;
  // A clip dropped on a shot: anchored on the lyric line that starts in that shot; a shot without a line
  // starting in it (an intro, a break): the clip takes that shot's place in the story order.
  const dropOnShot = (s: StoryShot, clip: string) => {
    if (!view) return;
    const line = view.lines.find((l) => l.number !== null && l.startMs >= s.startMs && l.startMs < s.endMs);
    if (line?.number != null) void edit({ action: "anchor", line: line.number, clip });
    else {
      const at = view.clips.findIndex((c) => c.name === s.clip);
      if (at >= 0 && s.clip !== clip) moveClip(clip, at);
    }
  };

  // The left column: what is selected on the timeline (shot, clip, text card), then the recipe tools.
  const selection =
    view && (shot || (view.editable && (editing || card))) ? (
      <div data-selection className="flex flex-col gap-2">
        {shot ? (
          <ShotDetails
            shot={shot}
            editable={view.editable}
            onEdit={() => setEditing(view.clips.find((c) => c.name === shot.clip)?.name ?? null)}
            onUnanchor={shot.anchor ? () => void edit({ action: "unanchor", line: shot.anchor!.line }) : undefined}
            onMisfit={view.editable ? () => moveClip(shot.clip, view.clips.length) : undefined}
            onClose={() => setSelected(null)}
          />
        ) : null}
        {view.editable && editing ? (
          <ClipEditor
            key={editing}
            clip={view.clips.find((c) => c.name === editing)!}
            mediaUrl={`/api/songs/${projectId}/storyboard/media`}
            busy={saving}
            onSave={(e) => void edit({ action: "clip", clip: editing, edit: e })}
            onClose={() => setEditing(null)}
            onCanvas={(at) => void edit(at === null ? { action: "canvas", clip: null } : { action: "canvas", clip: editing, at })}
          />
        ) : null}
        {view.editable && card ? (
          <CardEditor
            key={card.id}
            card={card}
            role={board?.roles[card.type === "lyric" ? (card.isHook ? "hook" : "verse") : (card.type as "title")] ?? {}}
            draft={draft}
            setDraft={setDraft}
            busy={saving}
            onSave={() => void editText({ action: "card", id: card.id, overrides: draft })}
            onReset={() => {
              setDraft({});
              void editText({ action: "card", id: card.id, overrides: null });
            }}
            onClose={() => setCardId(null)}
            fonts={board?.fonts ?? []}
            titleFont={board?.titleFont ?? ""}
            artist={board?.artist ?? "Life Lyrics"}
          />
        ) : null}
      </div>
    ) : null;

  const viewer =
    view && props ? (
      <div className={cn("mx-auto overflow-hidden rounded-xl border bg-black shadow-lg", wide ? "aspect-video w-full max-w-[860px]" : "aspect-[9/16]")} style={wide ? undefined : { height: "min(62vh, 640px)" }}
        data-viewer
        data-patched={look?.patch && view.source === "plan" ? "1" : "0"}
        data-previewing-pair={look?.previewing ?? undefined}
        data-verse-family={props.style.font}
        data-hook-family={props.hookFont?.font ?? props.style.font}
        data-effect={props.lyricEffects?.verse.name}
        data-hook-effect={props.lyricEffects?.hook.name}
        data-accent={props.lyricEffects?.accent}
      >
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
    ) : look ? (
      <LookViewer input={look.fallback} caption={look.caption} previewing={look.previewing} />
    ) : null;

  return (
    <div data-storyboard data-shape className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
      <aside data-shape-tools className="order-last flex min-w-0 flex-col gap-4 lg:order-none lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
        {selection}
        {tools}
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        {/* which video: the plan now (per platform and video) or a past run */}
        {choices?.ready ? (
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
                <option value="plan">The plan now (as Make would make it)</option>
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
            {source?.kind === "plan" && pictures ? (
              <details className="relative" data-pictures>
                <summary className={cn(select, "flex cursor-pointer items-center")}>Pictures: {clipSet(pictures) ? clipSet(pictures)!.replace(/\+/g, " + ").replace(/^song/, "the song's clips") : "as the recipe"}</summary>
                <div className="bg-popover absolute z-10 mt-1 flex w-64 flex-col gap-1 rounded-md border p-2 text-xs shadow-lg">
                  <p className="text-muted-foreground">The same textboard over other clips (this plan only; anchors whose clip is missing become slots).</p>
                  {choices.pictures.songClips ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" data-picture="song" checked={pictures.songClips} onChange={(e) => setPictures({ ...pictures, songClips: e.target.checked })} /> the song&apos;s own clips
                    </label>
                  ) : null}
                  {choices.pictures.collections.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" data-picture={c} checked={pictures.collections.includes(c)} onChange={(e) => setPictures({ ...pictures, collections: e.target.checked ? [...pictures.collections, c] : pictures.collections.filter((x) => x !== c) })} /> {c}
                    </label>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      data-pictures-plan
                      disabled={loading || (!pictures.songClips && !pictures.collections.length)}
                      onClick={(e) => {
                        const box = e.currentTarget.closest("details");
                        if (box) box.open = false;
                        if (source) void show(source);
                      }}
                    >
                      Plan with these
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPictures(choices.pictures.recipe)}>
                      Recipe&apos;s
                    </Button>
                  </div>
                </div>
              </details>
            ) : null}
            <Button size="sm" variant="outline" disabled={!source || loading} onClick={() => source && show(source)} data-storyboard-show title="Plan this video again">
              {loading ? <Loader2 className="animate-spin" /> : null} {loading ? "Planning…" : "Plan again"}
            </Button>
          </div>
        ) : null}
        {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

        {/* 1. the viewer */}
        <div className="flex flex-col items-center gap-2" data-viewer-block>
          {viewer}
          {view ? (
            <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs" data-storyboard-summary>
              <span className="font-medium">
                {view.platform.label} {view.video}
              </span>
              <span className="text-muted-foreground">
                {view.source === "plan" ? "planned now" : `run ${view.run}`} · {secs(view.durationMs)} ({clock(view.section.startMs)}–{clock(view.section.endMs)} in the song) · {Math.round(view.bpm)} BPM · {view.shots.length} shots · {clock(playhead)}
                {view.picture ? <span data-storyboard-picture> · pictures: {view.picture.replace(/\+/g, " + ").replace(/^song\b/, "the song's clips")}</span> : null}
              </span>
              {saving || loading ? (
                <span className="text-brand" data-replanning>
                  <Loader2 className="mr-1 inline size-3 animate-spin" />
                  planning again…
                </span>
              ) : null}
              <VerdictBadge a={view.assessment} heading="Predicted before rendering" />
            </div>
          ) : !choices ? (
            <p className="text-muted-foreground text-sm">Loading the plan…</p>
          ) : !choices.ready ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm" data-storyboard-why>
              {choices.why}
            </p>
          ) : loading ? (
            <p className="text-muted-foreground text-sm">
              <Loader2 className="mr-1 inline size-3 animate-spin" /> Planning the video…
            </p>
          ) : null}
          <Button data-next-make onClick={() => goTo("generate")} className="mt-1">
            Next: Make <ChevronRight />
          </Button>
        </div>

        {view && props ? (
          <>
            <div className="flex flex-wrap items-center justify-end gap-1 text-xs">
              <label className="mr-3 flex cursor-pointer items-center gap-1.5" title="While the video plays, the timeline scrolls with the playhead. Scroll by hand to stop it until the next play.">
                <input type="checkbox" checked={follow} onChange={toggleFollow} className="accent-brand" data-follow-playback />
                Follow playback
              </label>
              Zoom
              {ZOOMS.map((z) => (
                <button key={z} type="button" onClick={() => setZoom(z)} className={cn("rounded border px-1.5", zoom === z ? "border-brand text-brand" : "text-muted-foreground")}>
                  {z / 40}x
                </button>
              ))}
            </div>
            {/* 2. the soundtrack (bars, waveform, lyric lines) and 3. the shots */}
            <div ref={timeline} onScroll={onTimelineScroll} className="-mt-2 overflow-x-auto rounded-lg border" data-storyboard-timeline>
              <div className="relative" style={{ width: width + 16 }} onClick={(e) => playFrom(((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000)}>
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
                <svg className="block h-16 w-full border-b" viewBox={`0 0 ${view.waveform.peaks.length} 100`} preserveAspectRatio="none" style={{ width }} data-waveform>
                  {view.waveform.peaks.map((p, i) => (
                    <rect key={i} x={i} y={50 - p * 48} width={0.8} height={Math.max(1, p * 96)} className="fill-brand/60" />
                  ))}
                </svg>
                {view.titleCards.length ? (
                  <div className="relative h-6 border-b" data-textboard-titles>
                    {view.titleCards.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        data-text-card={c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (view.editable) openCard(c.id);
                        }}
                        className={cn("bg-brand/20 absolute overflow-hidden rounded border px-1 text-left text-[10px]", cardId === c.id && "ring-brand ring-2")}
                        style={{ left: x(c.startMs), width: Math.max(8, x(c.endMs - c.startMs) - 2), top: 2, height: 18 }}
                        title={`${c.type}: ${c.text}`}
                      >
                        <Type className="mr-0.5 inline size-2.5" />
                        {c.type}: {c.text}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="relative h-12 border-b" data-textboard-row>
                  {view.lines.map((l, i) => (
                    <div
                      key={i}
                      data-story-line={l.number ?? ""}
                      data-anchored={l.anchor ?? undefined}
                      onDragOver={(e) => {
                        if (!view.editable || l.number === null || !e.dataTransfer.types.includes("text/x-lyric-clip")) return;
                        e.preventDefault();
                        setDropLine(l.number);
                      }}
                      onDragLeave={() => setDropLine(null)}
                      onDrop={(e) => {
                        const clip = e.dataTransfer.getData("text/x-lyric-clip");
                        setDropLine(null);
                        if (clip && l.number !== null) void edit({ action: "anchor", line: l.number, clip });
                      }}
                      data-card={l.card ?? undefined}
                      data-changed={l.changed || undefined}
                      data-needs-clip={l.slot ?? undefined}
                      onClick={(e) => {
                        if (!view.editable || !l.card) return; // a past run: the timeline plays from here
                        e.stopPropagation();
                        openCard(l.card);
                        player.current?.seekTo(Math.round((l.startMs * 30) / 1000));
                      }}
                      className={cn(
                        "absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-[11px] leading-tight",
                        view.editable && l.card && "cursor-pointer",
                        l.isHook ? "border-brand/50 bg-brand/10" : "bg-muted/40",
                        l.changed && "border-sky-400/70",
                        l.slot && "border-2 border-dashed border-amber-400 bg-amber-400/15",
                        (dropLine !== null && dropLine === l.number) || (cardId !== null && cardId === l.card) ? "ring-brand ring-2" : "",
                      )}
                      style={{ left: x(l.startMs), width: Math.max(4, x(l.endMs - l.startMs) - 2) }}
                      title={`${l.number ? `line ${l.number}: ` : ""}${l.text} (${clock(l.startMs)}–${clock(l.endMs)})${l.anchor ? ` · ⚓ ${l.anchor}` : ""}${l.slot ? ` · needs a clip (was ${l.slot})` : ""}${l.changed ? " · its own look" : ""}`}
                    >
                      {l.anchor ? <Anchor className="text-brand mr-0.5 inline size-3" aria-label="anchored" /> : null}
                      {l.slot ? <Anchor className="mr-0.5 inline size-3 text-amber-300" aria-label="slot" /> : null}
                      {l.changed ? <Pencil className="mr-0.5 inline size-2.5 text-sky-300" aria-label="own look" /> : null}
                      {l.text}
                    </div>
                  ))}
                </div>
                <div className="relative h-24" data-shots-row>
                  {view.shots.map((s) => (
                    <ShotBlock
                      key={s.index}
                      shot={s}
                      left={x(s.startMs)}
                      width={x(s.endMs - s.startMs)}
                      selected={selected === s.index}
                      onSelect={() => setSelected(s.index)}
                      dropTarget={dropShot === s.index}
                      onDragOver={
                        view.editable
                          ? (e) => {
                              if (!e.dataTransfer.types.includes("text/x-lyric-clip")) return;
                              e.preventDefault();
                              setDropShot(s.index);
                            }
                          : undefined
                      }
                      onDragLeave={() => setDropShot(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropShot(null);
                        const clip = e.dataTransfer.getData("text/x-lyric-clip");
                        if (clip && view.editable) dropOnShot(s, clip);
                      }}
                    />
                  ))}
                </div>
                <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white" style={{ left: x(playhead) }} data-playhead />
              </div>
            </div>
            {!shot ? <p className="text-muted-foreground -mt-2 text-xs">Click a shot for its details on the left{view.editable ? " (and to edit its clip)" : ""}. Drag a clip from the row below onto a shot or a lyric line to put it there.</p> : null}
            {view.slots.length ? (
              <p className="rounded-md border border-dashed border-amber-400/60 bg-amber-400/10 p-2 text-xs text-amber-100" data-slots>
                <Anchor className="mr-1 inline size-3" />
                Needs a clip (drag one from the clips below onto the line): {view.slots.map((x) => `line ${x.line} "${x.text}" (was ${x.clip})`).join(" · ")}
              </p>
            ) : null}
            {/* 4. the clips used, in the story order */}
            {view.editable && view.clips.length ? <StoryStrip clips={view.clips} busy={saving || loading} onMove={moveClip} onOpen={setEditing} editing={editing} /> : null}

            {/* the plan's details (to be slimmed in U2b) */}
            <div className="flex flex-col gap-2 border-t pt-3" data-plan-details>
              <div className="bg-card/60 rounded-lg border p-2" data-storyboard-assessment>
                <AssessmentDetails a={view.assessment} limit={4} handled={false} />
              </div>
              <p className="text-muted-foreground text-xs">{view.section.reason}</p>
              {view.decisions.map((d) => (
                <p key={d} className="text-xs text-sky-200" data-decision>
                  {d}
                </p>
              ))}
              {view.loop?.ending ? (
                <p className="text-xs text-sky-200" data-ending>
                  {view.loop.ending}
                </p>
              ) : null}
              {view.loop && !view.loop.ok ? (
                <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-100" data-loop-warn>
                  <p className="flex items-start gap-1 font-medium">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> WARN Loop flows: the end does not flow back into the start ({view.loop.problems.join("; ")})
                  </p>
                  {view.loopSuggestions.length ? (
                    <p className="mt-1" data-loop-suggestions>
                      Target lengths that loop better from this start (Automatic → Target length, on the left, or Make):{" "}
                      {view.loopSuggestions.map((x) => `${Math.round(x.lengthS)} s (ends ${x.end}${x.line ? ` after ${x.line}` : ""}: ${x.fit})`).join(" · ")}
                    </p>
                  ) : view.source === "plan" ? (
                    <p className="mt-1">No other clean line end within 0.5–1.5x the target loops better from this start: try another section.</p>
                  ) : null}
                </div>
              ) : view.loop ? (
                <p className="text-xs text-emerald-300" data-loop-ok>
                  ↻ Loop flows: the end flows back into the start.
                </p>
              ) : null}
              {view.editable && board ? <TemplateBar board={board} busy={saving} onEdit={(b) => void editText(b)} onOpen={openCard} /> : null}
              {notice ? (
                <p className="text-xs text-emerald-300" role="status" data-textboard-notice>
                  {notice}
                </p>
              ) : null}
              {view.anchorsOutside.length ? (
                <p className="text-muted-foreground text-xs" data-anchors-outside>
                  <Anchor className="mr-1 inline size-3" />
                  Not in this section: {view.anchorsOutside.map((a) => `line ${a.line} "${a.text}" → ${a.clip}`).join(" · ")}
                </p>
              ) : null}
              {[...view.anchorWarnings, ...view.notes].length ? (
                <ul className="flex flex-col gap-1 text-xs text-amber-200" data-storyboard-warnings>
                  {[...view.anchorWarnings, ...view.notes].map((w) => (
                    <li key={w} className="flex items-start gap-1">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ShotBlock({
  shot: s,
  left,
  width,
  selected,
  onSelect,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  shot: StoryShot;
  left: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  dropTarget: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      data-shot={s.index + 1}
      data-drop-target={dropTarget || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-warnings={s.warnings.length || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cn("absolute top-1 bottom-1 overflow-hidden rounded border text-left text-[10px] text-white", s.warnings.length ? "border-amber-400" : "border-white/20", (selected || dropTarget) && "ring-brand ring-2")}
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
        {s.dip ? <span className="size-2.5 rounded-full border border-white/70 bg-black" data-badge="dip" aria-label="dip to black" title="dip to black" /> : null}
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

function ShotDetails({ shot: s, editable, onEdit, onUnanchor, onMisfit, onClose }: { shot: StoryShot; editable: boolean; onEdit: () => void; onUnanchor?: () => void; onMisfit?: () => void; onClose: () => void }) {
  return (
    <div className="bg-card border-brand/40 rounded-lg border p-3 text-xs" data-shot-details={s.index + 1}>
      <div className="mb-1 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium break-words">
          Shot {s.index + 1}: {s.clip}
        </p>
        <button type="button" onClick={onClose} aria-label="close the shot details" className="text-muted-foreground hover:text-foreground rounded p-1">
          <X className="size-4" />
        </button>
      </div>
      {(editable && s.kind === "video") || onMisfit ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {editable && s.kind === "video" ? (
            <button type="button" data-edit-clip onClick={onEdit} className="hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
              <Scissors className="size-3" /> Edit clip (in / out, speed, best moment)
            </button>
          ) : null}
          {onMisfit ? (
            <button type="button" data-misfit onClick={onMisfit} title="Moves this clip to the end of the story order, so it comes in later; drag it in the clips row to place it exactly" className="hover:bg-accent rounded-md border px-2 py-0.5 text-xs">
              this clip doesn&apos;t fit here
            </button>
          ) : null}
        </div>
      ) : null}
      <p>
        {clock(s.startMs)}–{clock(s.endMs)} in the video ({secs(s.endMs - s.startMs)}), cut at {clock(s.songMs)} in the song · in {s.inS.toFixed(2)} s → out {s.outS.toFixed(2)} s of the clip ·{" "}
        {s.kind === "photo" ? "photo (slow move)" : `speed ${s.speed.toFixed(2)}x`}
        {s.dissolve ? " · dissolves in" : ""}
        {s.dip ? " · dips to black into it" : ""}
      </p>
      {s.anchor ? (
        <p className="text-brand mt-1">
          ⚓ anchored on line {s.anchor.line} &quot;{s.anchor.text}&quot;
          {editable && onUnanchor ? (
            <button type="button" data-unanchor={s.anchor.line} onClick={onUnanchor} className="text-muted-foreground hover:text-foreground ml-2 underline">
              remove the anchor
            </button>
          ) : null}
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

// The story order: every clip of the run (the song's own and the collections') in the order story
// videos use them. Drag a card onto another to put it there (or use the arrows); drag a card onto a
// lyric line to anchor it on that line; click it to edit it.
function StoryStrip({ clips, busy, onMove, onOpen, editing }: { clips: StoryboardClip[]; busy: boolean; onMove: (name: string, to: number) => void; onOpen: (name: string) => void; editing: string | null }) {
  const [over, setOver] = useState<number | null>(null);
  return (
    <div data-story-strip>
      <p className="mb-1 text-sm font-medium">Clips used</p>
      <p className="text-muted-foreground mb-1 text-xs">
        In story order{clips.some((c) => c.ranked) ? " (clips.json)" : " (file names: drag to change it)"} · each clip once before any repeats · drag a clip onto a shot or a lyric line above to put it there
      </p>
      <ol className="flex gap-2 overflow-x-auto pb-2">
        {clips.map((c, i) => (
          <li
            key={c.name}
            data-story-clip={c.name}
            data-story-index={i + 1}
            draggable={!busy}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/x-lyric-clip", c.name);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/x-lyric-clip")) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const name = e.dataTransfer.getData("text/x-lyric-clip");
              if (name && name !== c.name) onMove(name, i);
            }}
            className={cn("bg-card relative w-32 shrink-0 cursor-grab overflow-hidden rounded-lg border text-[11px]", over === i && "ring-brand ring-2", editing === c.name && "border-brand")}
          >
            <button type="button" onClick={() => onOpen(c.name)} className="block w-full text-left" title={`${c.name}: click to edit`}>
              <div className="aspect-video bg-black bg-cover bg-center" style={{ backgroundImage: c.thumb ? `url(/api/files/${c.thumb})` : undefined }} />
              <div className="p-1">
                <p className="truncate font-medium">
                  {i + 1}. {c.name}
                </p>
                <p className="text-muted-foreground">
                  {c.shots} shot{c.shots === 1 ? "" : "s"}
                  {c.inS !== null || c.outS !== null ? " · ✂" : ""}
                  {c.speed !== null && c.speed < 1 ? ` · ${c.speed}x` : ""}
                  {c.bestFrom === "clip editor" ? " · ★ yours" : ""}
                </p>
              </div>
            </button>
            <div className="absolute top-0.5 right-0.5 flex gap-0.5">
              <button type="button" aria-label={`move ${c.name} earlier`} data-move-earlier={c.name} disabled={busy || i === 0} onClick={() => onMove(c.name, i - 1)} className="rounded bg-black/60 p-0.5 disabled:opacity-30">
                <ChevronLeft className="size-3" />
              </button>
              <button type="button" aria-label={`move ${c.name} later`} data-move-later={c.name} disabled={busy || i === clips.length - 1} onClick={() => onMove(c.name, i + 1)} className="rounded bg-black/60 p-0.5 disabled:opacity-30">
                <ChevronRight className="size-3" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The clip editor: the part of the clip used (in / out), its speed (slow motion, 0.5-1x) and its best
// moment (a story video's first shot of this clip is centred on it; yours always wins over the automatic
// one). Set each from the clip playing, or type the seconds.
function ClipEditor({ clip, mediaUrl, busy, onSave, onClose, onCanvas }: { clip: StoryboardClip; mediaUrl: string; busy: boolean; onSave: (e: { in?: number; out?: number; speed?: number; best?: number; transition?: "cut" | "dissolve" } | null) => void; onClose: () => void; onCanvas: (at: number | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const total = clip.durationMs / 1000;
  const [inS, setIn] = useState(clip.inS === null ? "" : String(clip.inS));
  const [outS, setOut] = useState(clip.outS === null ? "" : String(clip.outS));
  const [speed, setSpeed] = useState(clip.speed === null ? "1" : String(clip.speed));
  const [best, setBest] = useState(clip.bestFrom === "clip editor" && clip.bestS !== null ? String(clip.bestS) : "");
  const [transition, setTransition] = useState<string>(clip.transition ?? "");
  const here = () => String(Math.round((video.current?.currentTime ?? 0) * 100) / 100);
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const problem = (() => {
    const a = num(inS);
    const b = num(outS);
    if ([a, b, num(best)].some((x) => x !== undefined && (!Number.isFinite(x) || x < 0 || x > total + 0.05))) return `Times must be within the clip (0–${total.toFixed(1)} s).`;
    if (a !== undefined && b !== undefined && b <= a) return "Out must be after in.";
    return null;
  })();
  const save = () => {
    const s = Number(speed);
    onSave({ ...(num(inS) !== undefined ? { in: num(inS) } : {}), ...(num(outS) !== undefined ? { out: num(outS) } : {}), ...(s < 1 ? { speed: s } : {}), ...(num(best) !== undefined ? { best: num(best) } : {}), ...(transition === "cut" || transition === "dissolve" ? { transition } : {}) });
  };
  const field = "bg-input/30 border-input h-7 w-20 rounded-md border px-2 text-xs";
  const setHere = "hover:bg-accent rounded-md border px-2 py-0.5";
  return (
    <div className="bg-card rounded-lg border p-3 text-xs" data-clip-editor={clip.name}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-medium">Clip editor: {clip.name}</p>
        <span className="text-muted-foreground">{total.toFixed(1)} s</span>
        <button type="button" onClick={onClose} aria-label="close the clip editor" className="text-muted-foreground hover:text-foreground ml-auto rounded p-1">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <video ref={video} src={`${mediaUrl}/${clip.src}`} controls muted preload="metadata" className="aspect-video w-full max-w-sm rounded bg-black object-contain" data-clip-video />
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <span className="w-24">In (s)</span>
            <input data-clip-in className={field} value={inS} placeholder="0" onChange={(e) => setIn(e.target.value)} />
            <button type="button" className={setHere} onClick={() => setIn(here())}>
              set here
            </button>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24">Out (s)</span>
            <input data-clip-out className={field} value={outS} placeholder={total.toFixed(1)} onChange={(e) => setOut(e.target.value)} />
            <button type="button" className={setHere} onClick={() => setOut(here())}>
              set here
            </button>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24">Speed</span>
            <select data-clip-speed className={cn(field, "w-24")} value={speed} onChange={(e) => setSpeed(e.target.value)}>
              {["1", "0.9", "0.8", "0.75", "0.7", "0.6", "0.5"].map((v) => (
                <option key={v} value={v}>
                  {v === "1" ? "1x (normal)" : `${v}x`}
                </option>
              ))}
            </select>
            {Number(speed) < 0.75 ? <span className="text-amber-300">below 0.75x the motion may look choppy</span> : null}
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24">Best moment (s)</span>
            <input data-clip-best className={field} value={best} placeholder={clip.autoBestS !== null ? `auto ${clip.autoBestS}` : "auto"} onChange={(e) => setBest(e.target.value)} />
            <button type="button" className={setHere} data-clip-best-here onClick={() => setBest(here())}>
              set here
            </button>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24">Comes in with</span>
            <select data-clip-transition className={cn(field, "w-40")} value={transition} onChange={(e) => setTransition(e.target.value)}>
              <option value="">auto (the app chooses)</option>
              <option value="cut">a cut</option>
              <option value="dissolve">a dissolve</option>
            </select>
          </label>
          <p className="text-muted-foreground">
            ★ {best ? `yours: ${best} s` : clip.autoBestS !== null ? `automatic: ${clip.autoBestS} s (the strongest 2 s by motion, colour and contrast)` : "no clear best moment found"}. A story video&apos;s first shot of this clip is centred on it; yours always wins.
          </p>
          {clip.kind === "video" ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2" data-canvas-choice>
              <span className="w-24">Spotify Canvas</span>
              {clip.canvas ? (
                <>
                  <span className="text-emerald-300">chosen{clip.canvas.at !== null ? ` from ${clip.canvas.at} s` : ""}</span>
                  <button type="button" className={setHere} data-canvas-unset disabled={busy} onClick={() => onCanvas(null)}>
                    let the app choose
                  </button>
                </>
              ) : (
                <button type="button" className={setHere} data-canvas-use disabled={busy} onClick={() => onCanvas(Number(here()))} title="The Canvas loops this clip from the moment the player shows (the app picks the loop length and slows it a little if needed)">
                  Use for Canvas (from here)
                </button>
              )}
            </div>
          ) : null}
          {problem ? <p className="text-amber-300">{problem}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" data-clip-save disabled={busy || !!problem} onClick={save}>
              {busy ? <Loader2 className="animate-spin" /> : null} Save and plan again
            </Button>
            <Button size="sm" variant="outline" data-clip-reset disabled={busy} onClick={() => onSave(null)}>
              Whole clip, automatic
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const POSITION_LABELS: Record<string, string> = { lyrics: "the lyric spot", "with-title": "under the title", top: "top", upper: "upper", centre: "centre", lower: "lower", "upper-third": "upper third (title opening)", "lower-third": "lower third (title opening)" };

// A card's own look: place, size, hold, effect (and, for title / byline / tagline, its text and whether
// it is shown). The preview shows lyric cards at once; Save keeps them in textboard.json.
function CardEditor({ card, role, draft, setDraft, busy, onSave, onReset, onClose, fonts, titleFont, artist }: {
  fonts: string[];
  titleFont: string;
  artist: string;
  card: TextCard;
  role: CardStyle;
  draft: CardOverrides;
  setDraft: (d: CardOverrides) => void;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const set = <K extends keyof CardOverrides>(k: K, v: CardOverrides[K] | undefined) => {
    const next = { ...draft };
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    setDraft(next);
  };
  const lyric = card.type === "lyric";
  const positions = lyric ? ["lyrics", "upper", "centre", "lower"] : card.type === "title" ? ["top", "upper-third", "upper", "centre", "lower"] : ["with-title", "top", "upper-third", "upper", "centre", "lower", "lower-third"];
  const [brandNote, setBrandNote] = useState<string | null>(null);
  const useForBrand = async () => {
    if (!draft.font) return;
    if (!window.confirm(`Use ${draft.font} as the title font of every ${artist} song (brand.json: title cards, YouTube titles, thumbnails)?`)) return;
    const r = await fetch("/api/brand/title-font", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artist, family: draft.font }) });
    const out = (await r.json()) as { family?: string; error?: string };
    setBrandNote(r.ok ? `${out.family} is now the ${artist} title font (brand.json).` : (out.error ?? "Could not save it"));
  };
  const [effectName, intensity = "balanced"] = (draft.effect ?? "").split(":");
  const field = "bg-input/30 border-input h-7 rounded-md border px-2 text-xs";
  const changed = JSON.stringify(draft) !== JSON.stringify(card.overrides);
  return (
    <div className="bg-card rounded-lg border p-3 text-xs" data-card-editor={card.id}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-medium">
          {lyric ? `Line ${card.line}` : card.type[0].toUpperCase() + card.type.slice(1)}: <span className="font-normal">&quot;{draft.text ?? card.text}&quot;</span>
        </p>
        {Object.keys(role).length ? <span className="text-muted-foreground">({lyric ? (card.isHook ? "hook" : "verse") : card.type} rule: {Object.entries(role).map(([k, v]) => `${k} ${String(v)}`).join(", ")})</span> : null}
        <button type="button" onClick={onClose} aria-label="close the card editor" className="text-muted-foreground hover:text-foreground ml-auto rounded p-1">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-2">
        {!lyric ? (
          <>
            <label className="flex items-center gap-2">
              <span className="w-20">Text</span>
              <input data-card-text className={cn(field, "flex-1")} value={draft.text ?? ""} placeholder={card.text || "(empty)"} onChange={(e) => set("text", e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20">Shown</span>
              <select data-card-show className={field} value={draft.show === undefined ? "" : String(draft.show)} onChange={(e) => set("show", e.target.value === "" ? undefined : e.target.value === "true")}>
                <option value="">as the platform (YouTube: title + artist; Reels, TikTok, Shorts: with the title opening)</option>
                <option value="true">yes, on every platform</option>
                <option value="false">no</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="flex items-center gap-2">
          <span className="w-20">Place</span>
          <select data-card-position className={field} value={draft.position ?? ""} onChange={(e) => set("position", (e.target.value || undefined) as CardOverrides["position"])}>
            <option value="">{role.position ? `the rule (${POSITION_LABELS[role.position]})` : lyric ? "the lyric spot" : "as the platform"}</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">Size</span>
          <input data-card-size type="range" min={0.5} max={2} step={0.05} value={draft.size ?? role.size ?? 1} onChange={(e) => set("size", Number(e.target.value))} className="accent-brand flex-1" />
          <span className="w-10 tabular-nums">{(draft.size ?? role.size ?? 1).toFixed(2)}x</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">Hold (s)</span>
          <input data-card-hold type="number" min={0} max={10} step={0.5} className={cn(field, "w-20")} value={draft.hold ?? ""} placeholder={lyric ? "as sung" : "as the platform"} onChange={(e) => set("hold", e.target.value === "" ? undefined : Number(e.target.value))} />
          <span className="text-muted-foreground">{lyric ? "at least this long after its last word (never into the next line)" : "on screen from the start"}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">Font</span>
          <select data-card-font className={field} value={draft.font ?? ""} onChange={(e) => set("font", e.target.value || undefined)}>
            <option value="">{role.font ? `the rule (${role.font})` : lyric ? "the recipe's" : `the brand's title font (${titleFont})`}</option>
            {fonts.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          {card.type === "title" && draft.font && draft.font !== titleFont ? (
            <button type="button" data-brand-title-font onClick={() => void useForBrand()} className="hover:bg-accent rounded-md border px-2 py-0.5">
              Use as the brand&apos;s title font
            </button>
          ) : null}
        </label>
        {brandNote ? <p className="text-emerald-300" data-brand-title-font-note>{brandNote}</p> : null}
        <label className="flex items-center gap-2">
          <span className="w-20">Effect</span>
          <select data-card-effect className={field} value={effectName} onChange={(e) => set("effect", e.target.value ? (intensity === "balanced" ? e.target.value : `${e.target.value}:${intensity}`) : undefined)}>
            <option value="">{role.effect ? `the rule (${role.effect})` : lyric ? "the recipe's" : "fade (as before)"}</option>
            {EFFECT_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {effectName ? (
            <select className={field} value={intensity} onChange={(e) => set("effect", e.target.value === "balanced" ? effectName : `${effectName}:${e.target.value}`)}>
              {["subtle", "balanced", "expressive"].map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          ) : null}
        </label>
      </div>
      <p className="text-muted-foreground mt-2">
        {lyric ? "The preview shows the change at once (its timing comes from the lyric alignment). " : "Title cards change in the preview after saving. "}
        Places stay inside the platform&apos;s safe area.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" data-card-save disabled={busy || !changed} onClick={onSave}>
          {busy ? <Loader2 className="animate-spin" /> : null} Save and plan again
        </Button>
        <Button size="sm" variant="outline" data-card-reset disabled={busy || !Object.keys(card.overrides).length} onClick={onReset}>
          Reset this card
        </Button>
      </div>
    </div>
  );
}

// Save the textboard's design (without the words) as a template for this artist, or apply one.
function TemplateBar({ board, busy, onEdit, onOpen }: { board: TextboardData; busy: boolean; onEdit: (body: Record<string, unknown>) => void; onOpen: (id: string) => void }) {
  const [name, setName] = useState(board.template ?? "");
  const [picked, setApply] = useState("");
  const apply = board.templates.includes(picked) ? picked : (board.templates[0] ?? ""); // the first one until another is picked
  const field = "bg-input/30 border-input h-7 rounded-md border px-2 text-xs";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-template-bar>
      <span className="text-muted-foreground">
        Textboard{board.file ? "" : " (the brand's defaults)"}
        {board.template ? ` · template "${board.template}"` : ""} · {board.cards.filter((c) => Object.keys(c.overrides).length).length} card(s) changed
      </span>
      {(["title", "byline", "tagline"] as const).map((t) => (
        <button key={t} type="button" data-open-card={t} onClick={() => onOpen(t)} className="hover:bg-accent rounded-md border px-2 py-0.5">
          <Type className="mr-1 inline size-3" />
          {t}
        </button>
      ))}
      <input data-template-name className={cn(field, "w-36")} value={name} placeholder="template name" onChange={(e) => setName(e.target.value)} />
      <Button size="sm" variant="outline" data-template-save disabled={busy || !name.trim()} onClick={() => onEdit({ action: "save-template", name })}>
        Save as template
      </Button>
      {board.templates.length ? (
        <>
          <select data-template-apply className={field} value={apply} onChange={(e) => setApply(e.target.value)}>
            {board.templates.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" data-template-apply-button disabled={busy || !apply} onClick={() => onEdit({ action: "apply-template", name: apply })}>
            Apply template
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">no templates for {board.artist} yet</span>
      )}
      {board.orphans.length ? (
        <span className="text-amber-200" data-textboard-orphans>
          Not used any more (their words changed): {board.orphans.map((o) => `${o.id} "${o.text}"`).join(", ")}
        </span>
      ) : null}
    </div>
  );
}
