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
import { AlertTriangle, Anchor, Blend, ChevronLeft, ChevronRight, Gauge, Loader2, Lock, Mic, MoveHorizontal, Pencil, Redo2, RefreshCw, Repeat, RotateCcw, Star, Type, Undo2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { clockTenths, type TimelineEdits, EFFECT_NAMES, effectTitle, followScrollLeft, LyricVideo, playheadLabel, revealScrollLeft, songTimeMs, timeTicks, patchLook, previewCard, previewTitleCard, readableWarning, titleCardMult, titleCardSize, TITLE_SIZE_RANGE, type CardOverrides, type TextCardProps, type CardStyle, type StoryShot, type TextCard } from "@lyric/video";
import type { StoryboardChoices, StoryboardClip, StoryboardView, TextboardData } from "@lyric/video/node";
import { tryName } from "@lyric/video/video-names";
import { layersOf, SOFT_CHANGE_MS, SOFT_EXIT_MS } from "@lyric/video";
import { ClipMenu } from "./clip-menu";
import { BrollHere } from "./shape-broll";
import { SongRange, SongTrackBehind, SongWindow, type SongWindowDrag } from "./soundtrack-window";
import { useTimelineEditing, ViewerFrame } from "./timeline-editing"; // types only (erased): the data comes from /api/songs/[id]/storyboard

import { AssessmentDetails, VERDICT_TEXT } from "@/components/assessment";
import { LookViewer, VIEWER_HEIGHT, VIEWER_MAX, VIEWER_MIN } from "@/components/look-preview";
import { PreviewPlayer } from "@/components/preview-player";
import type { ShapeLook } from "@/components/shape-tools";
import { useGoToTab, useSetShapeStatus, useShapePanel, useShapeVideo, useThemeLook } from "@/components/song-stages";
import { ThemeReachBadge } from "@/components/theme-reach-badge";
import { TransportBar } from "@/components/transport-bar";
import { Button } from "@/components/ui/button";
import { api, STORY_CHANNEL, STORY_ORDER_SAVED } from "@/lib/api";
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
const select = "bg-input/30 border-input h-7 rounded-md border px-1.5 text-xs";

// try: a Try other looks video (2e-1), opened from its own shot plan ("reels-1~theme-night-drive").
type Source = { kind: "plan"; platform: string; video: string; try?: string } | { kind: "run"; run: string; platform: string; video: string };

export function ShapeBoard({ projectId, tools, look, replan, onPlanned }: { projectId: string; tools: ReactNode; look: ShapeLook | null; replan: number; onPlanned: (replan: number) => void }) {
  const goTo = useGoToTab();
  const themeLook = useThemeLook();
  const { panel, setPanel, collapsed, setCollapsed } = useShapePanel();
  const [choices, setChoices] = useState<StoryboardChoices | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const { setPlatform } = useShapeVideo();
  useEffect(() => {
    setPlatform(source?.platform ?? null);
    return () => setPlatform(null);
  }, [source?.platform, setPlatform]);
  const [view, setView] = useState<StoryboardView | null>(null);
  // The singing slots of this video (26 Nov 2026, lipsync.ts): bands on the song track, suggestions only.
  const [slots, setSlots] = useState<{ key: string; label: string; fromMs: number; toMs: number; state: string; text: string }[]>([]);
  const slotKind = view ? (/^(youtube|film|film-wide)$/.test(view.platform.name) ? "full" : "short") : null;
  useEffect(() => {
    if (!slotKind) return;
    let live = true;
    void api(`/api/songs/${projectId}/singing?kind=${slotKind}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { matches?: { slot: { key: string; label: string; fromMs: number; toMs: number }; accepted: boolean; clip: string | null; full: boolean; text: string }[] }) => {
        if (live) setSlots((d.matches ?? []).map((m) => ({ key: m.slot.key, label: m.slot.label, fromMs: m.slot.fromMs, toMs: m.slot.toMs, state: m.accepted ? "accepted" : m.clip ? (m.full ? "suggested" : "partial") : "none", text: m.text })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, slotKind]);
  // The music's energy (Performance script, 26 Nov 2026; music-cues.ts): a band under the song track once the song was
  // listened to (Prepare → Production → Performance script), with its drops, builds and breakdowns. Display only.
  const [energy, setEnergy] = useState<{ blockMs: number; values: number[]; events: { type: string; at_ms: number }[] } | null>(null);
  useEffect(() => {
    let live = true;
    void api(`/api/songs/${projectId}/script`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { cues?: { block_s: number; energy: number[]; events: { type: string; at_ms: number }[] } | null }) => {
        if (live && d.cues?.energy?.length) setEnergy({ blockMs: (d.cues.block_s ?? 0.5) * 1000, values: d.cues.energy, events: d.cues.events ?? [] });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOMS[1]);
  const [selected, setSelected] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const player = useRef<PlayerRef>(null);
  // The Player instance now: the viewer is mounted again after some re-plans, and the playhead must follow the
  // new one (before 7 Nov 2026 it kept listening to the old one: the playhead and the time froze).
  const [playerInstance, setPlayerInstance] = useState<PlayerRef | null>(null);
  const playerRef = useCallback((p: PlayerRef | null) => {
    player.current = p;
    setPlayerInstance(p);
  }, []);
  // The viewer fills the screen's height that the rows above it and the timeline and command bar below leave (2 Nov 2026).
  const viewerBlock = useRef<HTMLDivElement>(null);
  const belowViewer = useRef<HTMLDivElement>(null);
  // "Follow playback": the timeline scrolls with the playhead while the preview plays (off by default).
  // Scrolling the timeline by hand pauses it until the next play.
  const [follow, setFollow] = useState(false);
  const [playing, setPlaying] = useState(false);
  // An effect pointed at or picked in Motion: its name moves in it over the paused frame; playing hides it
  // (the song then plays with the effect on the real lyrics) until another effect is pointed at or picked.
  const [demoSeen, setDemoSeen] = useState<string | null>(null);
  // Paused where no lyric line is on screen (e.g. back at the start), the picked effect's name comes back, so
  // the viewer never looks empty while choosing an effect (31 Oct 2026: it read as "the effects stopped working").
  const lyricOnScreen = !!view && view.props.lyrics.some((l) => frame >= (l.enterFrame ?? l.startFrame) && frame < l.endFrame);
  const demo = look?.demo && !playing && (look.demo.key !== demoSeen || !lyricOnScreen) ? look.demo : null;
  // A title / tagline / hook / end card on the paused frame: the effect's name gets a dark veil over the
  // whole frame so the two never read on top of each other (31 Oct 2026).
  const cardOnScreen = !!view && (view.props.textCards ?? []).some((c) => !c.off && frame >= c.startFrame && frame < c.endFrame);
  useEffect(() => {
    if (playing && look?.demo) setDemoSeen(look.demo.key);
  }, [playing, look?.demo]);
  // The transport bar's speed (the preview only: time to check the lyrics) and Loop on / off.
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const timeline = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(false); // the next scroll event is ours, not the user's
  const heldByUser = useRef(false);
  // Follow: half a view of empty space before 0:00 and after the end, so the playhead sits in the middle from
  // the very first frame to the last (as Pro Tools / Logic), never travelling to the middle first (7 Nov 2026).
  const [timelineW, setTimelineW] = useState(0);
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTimelineW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]); // the timeline exists once a plan is shown
  const [songDrag, setSongDrag] = useState<SongWindowDrag | null>(null); // the song window while dragged on the song track
  const [saving, setSaving] = useState(false);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const [dropShot, setDropShot] = useState<number | null>(null); // a clip dragged over this shot
  const [board, setBoard] = useState<TextboardData | null>(null);
  const [cardId, setCardId] = useState<string | null>(null); // the card in the card editor
  const [draft, setDraft] = useState<CardOverrides>({}); // its overrides while editing (live preview)
  const [notice, setNotice] = useState<string | null>(null);
  // A word fix that left the lyric timing stale (§3.5, N1): said plainly, with "Time the lyrics again" (never silently).
  const [stale, setStale] = useState<{ line: number; queued: string | null } | null>(null);
  async function timeAgain(line: number) {
    const r = await api(`/api/songs/${projectId}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retime" }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setStale({ line, queued: !r.ok || d.error ? (d.error ?? `The studio answered ${r.status}`) : "Queued: the lyrics are timed again on the vocal (follow it in Tasks); the video is planned again when it is done." });
    if (r.ok && !d.error) window.dispatchEvent(new Event("lyric-tasks-changed"));
  }
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
      // A title card (the song's, in Settings → Look) stays chosen across plans; a lyric line belongs to this plan.
      setCardId((id) => (id === "title" || id === "byline" || id === "tagline" ? id : null));
    }
    try {
      const swap = s.kind === "plan" && !s.try ? clipSet(set) : null;
      const q = new URLSearchParams({ platform: s.platform, video: s.video, ...(s.kind === "run" ? { run: s.run } : {}), ...(s.kind === "plan" && s.try ? { try: s.try } : {}), ...(swap ? { clips: swap } : {}) });
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

  // The story order was saved in Prepare → Storyboard while this page was opening (the save takes a moment): plan again
  // with it, keeping the selection and the playhead (one clip order, shown the same in both places).
  const latest = useRef({ source, show });
  latest.current = { source, show };
  // Also when the Storyboard changed in another tab, and whenever this page is shown again (back to this tab or
  // window): Shape always shows the saved Storyboard (Paul, 21 Nov 2026: "my Shape is not updated").
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (latest.current.source) void latest.current.show(latest.current.source, true);
      }, 250);
    };
    const shown = () => document.visibilityState === "visible" && again();
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STORY_CHANNEL);
      channel.onmessage = again;
    } catch {
      channel = null;
    }
    window.addEventListener(STORY_ORDER_SAVED, again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener(STORY_ORDER_SAVED, again);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", shown);
    };
  }, []);

  // "Use automatic" next to a typed length the app could not end cleanly near: the song's length and this
  // platform's own go back to Automatic; the page reloads so the tools show it too.
  async function switchToAutomaticLength(platform: string) {
    setSaving(true);
    setError(null);
    try {
      for (const body of [{ action: "reset", field: "length" }, { action: "reset", field: "length", platform }]) {
        const r = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = (await r.json()) as { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      }
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  // One storyboard edit (story order, clip edit, anchor), then the plan again.
  // The soundtrack window: this platform's part of the song (song.json perPlatform "section"), then plan again.
  async function setSection(section: string) {
    if (!source || source.kind !== "plan" || !view) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set", field: "section", platform: view.platform.name, value: section }) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await show(source, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function edit(body: Record<string, unknown>) {
    if (!source || source.kind !== "plan") return null;
    setSaving(true);
    setError(null);
    try {
      const r = await api(`/api/songs/${projectId}/storyboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { error?: string; before?: TimelineEdits; after?: TimelineEdits };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await show(source, true);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }
  // A lyric line's words fixed on its card: lyrics.txt gets them, the timing is kept; then the plan again.
  async function fixLine(number: number, text: string) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fix-line", number, text }) });
      const d = (await r.json()) as { changed?: boolean; timingKept?: boolean; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      const b = (await (await api(`/api/songs/${projectId}/textboard`, { cache: "no-store" })).json()) as TextboardData & { error?: string };
      if (!b.error) setBoard(b);
      setNotice(!d.changed ? "Nothing changed." : d.timingKept ? `Line ${number} fixed in the lyrics (every platform and the captions). The lyric timing is still valid: the line keeps its start and end. The old lyrics are in the Lyrics tab's earlier versions.` : `Line ${number} fixed in the lyrics (every platform and the captions).`);
      setStale(d.changed && !d.timingKept ? { line: number, queued: null } : null);
      if (source) await show(source, true);
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
    setPanel("text");
    setDraft(board?.cards.find((c) => c.id === id)?.overrides ?? {});
  };
  // A title card picked in Settings → Look (11 Nov 2026): its editor opens there, not in the Text panel.
  const pickTitleCard = (id: string | null) => {
    setCardId(id);
    setDraft(id ? (board?.cards.find((c) => c.id === id)?.overrides ?? {}) : {});
    if (id) {
      showTitleCard(id);
      window.dispatchEvent(new Event("lyric-look-advanced")); // its editor sits in Look → Advanced: unfolded
    }
  };
  // The viewer goes to the middle of the card's time on screen: past its fade in, before its fade out (11 Nov 2026).
  const showTitleCard = (id: string) => {
    const pc = view?.props.textCards?.find((c) => c.id === id && !c.off);
    if (!pc) return;
    const start = pc.startFrame ?? 0;
    const end = Number.isFinite(pc.endFrame) ? pc.endFrame : start + 60;
    const at = Math.max(0, Math.round((start + end) / 2));
    heldByUser.current = true;
    player.current?.pause();
    player.current?.seekTo(at);
    setFrame(at);
  };
  // A title card clicked in the viewer or on the timeline: Settings → Look with its editor.
  const openTitleCard = (id: string) => {
    setPanel("look");
    pickTitleCard(id);
  };
  // Song Details → "Tagline look…": Shape opens on Settings → Look with that card's editor (one ask, kept for the visit).
  useEffect(() => {
    if (!board) return;
    let asked: string | null = null;
    try {
      asked = window.sessionStorage.getItem("lyric-studio:open-title-card");
      if (asked) window.sessionStorage.removeItem("lyric-studio:open-title-card");
    } catch {
      asked = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a request left by another page, read once the board is here
    if (asked && board.cards.some((c) => c.id === asked)) pickTitleCard(asked);
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps
  // The same request while Shape is already on the page (Song Details' link switches the stage without a reload).
  const boardRef = useRef(board);
  boardRef.current = board;
  // Look → On-screen text changed a card's on / off (11 Nov 2026): the cards are read again and the video planned again.
  const replanRef = useRef<() => void>(() => {});
  replanRef.current = () => {
    void api(`/api/songs/${projectId}/textboard`, { cache: "no-store" })
      .then((r) => r.json() as Promise<TextboardData & { error?: string }>)
      .then((d) => {
        if (!d.error) setBoard(d);
        if (source) void show(source, true);
      })
      .catch(() => null);
  };
  useEffect(() => {
    const changed = () => replanRef.current();
    window.addEventListener("lyric-textboard-changed", changed);
    return () => window.removeEventListener("lyric-textboard-changed", changed);
  }, []);
  const showRef = useRef<(id: string) => void>(() => {});
  showRef.current = (id: string) => showTitleCard(id);
  const openTitleRef = useRef<(id: string) => void>(() => {});
  openTitleRef.current = (id: string) => openTitleCard(id);
  // The viewer (11 Nov 2026): a title card under the pointer is outlined; a click on it opens its settings in Look (and
  // does not play / pause the video). Read from the drawn composition (data-text-card), so it is exactly the card seen.
  useEffect(() => {
    const block = viewerBlock.current;
    if (!block) return;
    const cardAt = (t: EventTarget | null) => {
      const el = (t as Element | null)?.closest?.("[data-text-card]") as HTMLElement | null;
      return el && TITLE_CARD_IDS.has(el.getAttribute("data-text-card") ?? "") && !el.closest("[data-textboard-titles]") ? el : null;
    };
    let lit: HTMLElement | null = null;
    const over = (e: Event) => {
      const el = cardAt(e.target);
      if (el === lit) return;
      if (lit) {
        lit.style.outline = "";
        lit.style.cursor = "";
        lit.removeAttribute("data-card-hover");
      }
      lit = el;
      if (el) {
        el.style.outline = "3px dashed rgba(232, 163, 181, 0.95)";
        el.style.outlineOffset = "6px";
        el.style.cursor = "pointer";
        el.setAttribute("data-card-hover", "1");
      }
    };
    const click = (e: Event) => {
      const el = cardAt(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation(); // not the player's click (play / pause)
      openTitleRef.current(el.getAttribute("data-text-card")!);
    };
    block.addEventListener("mouseover", over);
    block.addEventListener("click", click, true);
    return () => {
      block.removeEventListener("mouseover", over);
      block.removeEventListener("click", click, true);
      if (lit) lit.style.outline = "";
    };
  }, [view?.editable]);
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const b = boardRef.current;
      if (!b?.cards.some((c) => c.id === id)) return; // not loaded yet: the stored request is read when it is
      try {
        window.sessionStorage.removeItem("lyric-studio:open-title-card");
      } catch {
        // nothing stored
      }
      setCardId(id);
      setDraft(b.cards.find((c) => c.id === id)?.overrides ?? {});
      showRef.current(id);
    };
    window.addEventListener("lyric-open-title-card", open);
    return () => window.removeEventListener("lyric-open-title-card", open);
  }, []);
  // Title cards are saved as they are changed (a moment after the last change) and the video is planned again, so the
  // viewer shows the change without a Save button.
  useEffect(() => {
    const c = board?.cards.find((x) => x.id === cardId);
    if (!c || c.type === "lyric" || JSON.stringify(draft) === JSON.stringify(c.overrides)) return;
    const t = setTimeout(() => void editText({ action: "card", id: c.id, overrides: draft }), 700);
    return () => clearTimeout(t);
  }, [draft, cardId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The preview follows the playhead.
  useEffect(() => {
    const p = playerInstance;
    if (!p) return;
    const sync = setTimeout(() => setFrame(p.getCurrentFrame()), 0); // a new viewer: where it stands now
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
      clearTimeout(sync);
      p.removeEventListener("frameupdate", update);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onStop);
      p.removeEventListener("ended", onStop);
    };
  }, [playerInstance]);

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
  const followPad = follow ? Math.round(timelineW / 2) : 0;
  // The song track shows the whole song (8 Nov 2026): the song before this video lies left of 0:00 and the rest
  // after its end, so the video's rows start `songPre` px in; `lead` = everything left of the video's 0:00.
  const songPre = view?.song ? Math.round((view.songStartMs / 1000) * zoom) : 0;
  const songPost = view?.song ? Math.max(0, Math.round(((view.song.durationMs - view.songStartMs - view.durationMs) / 1000) * zoom)) : 0;
  const lead = followPad + songPre;
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  // While following and playing: keep the playhead in the middle of the timeline.
  useEffect(() => {
    const el = timeline.current;
    if (!follow || !playing || heldByUser.current || !el) return;
    const target = followScrollLeft({ scrollLeft: el.scrollLeft, viewWidth: el.clientWidth, contentWidth: el.scrollWidth, playheadX: lead + (frame / 30) * zoom });
    if (target === null) return;
    autoScroll.current = true;
    el.scrollLeft = target;
  }, [follow, playing, frame, zoom, lead]);
  // Follow switched on (or the zoom or the part of the song changed): the playhead goes to the middle at once, also
  // while paused; without Follow it is brought into view (the song before the video would otherwise fill the view).
  useEffect(() => {
    const el = timeline.current;
    if (!el || (!follow && !songPre)) return;
    const o = { scrollLeft: el.scrollLeft, viewWidth: el.clientWidth, contentWidth: el.scrollWidth, playheadX: lead + (frameRef.current / 30) * zoom };
    // Follow: in the middle; without Follow (the song before the video takes room on the left): just in view.
    const target = follow ? (followPad ? followScrollLeft(o) : null) : revealScrollLeft(o);
    if (target === null) return;
    autoScroll.current = true;
    el.scrollLeft = target;
  }, [follow, zoom, followPad, songPre, lead]);
  // A JUMP of the playhead (start, end, Stop, Home / End, a bar or frame step, a click on the ruler, a lyric or a
  // clip, Undo / Redo, play from the end): the timeline scrolls so the playhead is in view, paused or playing
  // (8 Nov 2026; before, a jump while paused left the playhead off-screen). Detected centrally from the
  // Player's "seeked" event, so no jump site is missed. Follow on: the playhead goes to the middle, and a jump
  // is an explicit request, so it ends a hand-scroll hold (following resumes if the preview is playing).
  // Follow off: only brought into view (a small margin), no scroll when it already is. Playback's own frame
  // advances never fire "seeked".
  const jumpView = useRef({ follow, lead, zoom });
  useEffect(() => {
    jumpView.current = { follow, lead, zoom };
  }, [follow, lead, zoom]);
  useEffect(() => {
    const p = playerInstance;
    if (!p) return;
    const onSeeked = (e: { detail: { frame: number } }) => {
      const el = timeline.current;
      if (!el) return;
      const j = jumpView.current;
      const playheadX = j.lead + (e.detail.frame / 30) * j.zoom;
      const o = { scrollLeft: el.scrollLeft, viewWidth: el.clientWidth, contentWidth: el.scrollWidth, playheadX };
      if (j.follow) heldByUser.current = false;
      const target = j.follow ? followScrollLeft(o) : revealScrollLeft(o);
      if (target === null) return;
      autoScroll.current = true;
      el.scrollLeft = target;
    };
    p.addEventListener("seeked", onSeeked);
    return () => p.removeEventListener("seeked", onSeeked);
  }, [playerInstance]);
  const onTimelineScroll = () => {
    if (autoScroll.current) autoScroll.current = false;
    else if (playing) heldByUser.current = true; // the user scrolled: stop following until the next play
  };

  const card = board?.cards.find((c) => c.id === cardId) ?? null;
  // The cards' own looks the shown plan was made with (taken when a plan arrives): the live preview patches only what
  // the draft changes since, so a planned card (fitted into the safe area as the render does) is never overridden.
  const plannedWith = useMemo(() => Object.fromEntries((board?.cards ?? []).map((c) => [c.id, c.overrides])), [view]); // eslint-disable-line react-hooks/exhaustive-deps
  // The planned title card being edited, and the title's usual size (the editor's px scale, 12 Nov 2026).
  const plannedCard = card && card.type !== "lyric" ? (view?.props.textCards?.find((c) => c.id === card.id && !c.off) ?? null) : null;
  const titleBase = view?.props.textCards?.find((c) => c.id === "title")?.baseSize;
  // The live preview: the edited card's place, size, hold and effect on the planned props (a font
  // change shows after saving: it needs its font file). Title cards (12 Nov 2026): size, colour, transparency,
  // capitals and place at once, before the save and the plan that follows.
  const props = useMemo(() => {
    if (!view) return null;
    let lyrics = view.props.lyrics;
    let textCards = view.props.textCards;
    if (card && card.type !== "lyric" && textCards && view.props.lyricArea) {
      const was = (plannedWith[card.id] ?? {}) as Record<string, unknown>;
      const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k]))) as CardStyle;
      if (Object.keys(changed).length) textCards = previewTitleCard(textCards, card.id, changed, { area: view.props.lyricArea, frameHeight: view.props.format?.height ?? 1920 });
    }
    if (card?.type === "lyric" && view.props.lyricArea) {
      const own: CardOverrides = { ...draft };
      delete own.text;
      delete own.show;
      const style: CardStyle = { ...(board?.roles[card.isHook ? "hook" : "verse"] ?? {}), ...own };
      lyrics = previewCard(lyrics, card.id, style, { area: view.props.lyricArea, durationInFrames: view.props.durationInFrames });
    }
    const planned = { ...view.props, lyrics, ...(textCards ? { textCards } : {}), mediaBaseUrl: `/api/songs/${projectId}/storyboard/media` };
    // A look change not planned yet (or a pairing pointed at): patched in at once (plans only).
    return view.source === "plan" ? patchLook(planned, look?.patch ?? null, view.bars.map((ms) => Math.round((ms * 30) / 1000))) : planned;
  }, [view, projectId, card, draft, board, look?.patch, plannedWith]);
  // The selected title card (12 Nov 2026): outlined in the viewer while its toolbar is open; Esc, or a click in the
  // viewer away from it, closes it (that click does not play / pause).
  const selectedTitle = card && card.type !== "lyric" ? card.id : null;
  useEffect(() => {
    const block = viewerBlock.current;
    if (!block) return;
    for (const el of block.querySelectorAll<HTMLElement>("[data-card-selected]")) {
      if (el.getAttribute("data-text-card") === selectedTitle) continue;
      el.style.boxShadow = "";
      el.removeAttribute("data-card-selected");
    }
    if (!selectedTitle) return;
    const el = block.querySelector<HTMLElement>(`[data-viewer] [data-text-card='${selectedTitle}']`);
    if (el && !el.hasAttribute("data-card-selected")) {
      el.style.boxShadow = "0 0 0 3px rgba(232, 163, 181, 1)";
      el.setAttribute("data-card-selected", "1");
    }
  }, [selectedTitle, frame, props]);
  const closeTitleRef = useRef<() => void>(() => {});
  closeTitleRef.current = () => selectedTitle && pickTitleCard(null);
  useEffect(() => {
    if (!selectedTitle) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, select, textarea") && !t.closest("[data-card-toolbar]")) return;
      closeTitleRef.current();
    };
    const away = (e: Event) => {
      const t = e.target as Element | null;
      if (!t?.closest("[data-viewer]") || t.closest("[data-text-card]")) return;
      e.preventDefault();
      e.stopPropagation(); // closes the selection, not play / pause
      closeTitleRef.current();
    };
    const block = viewerBlock.current;
    window.addEventListener("keydown", key);
    block?.addEventListener("click", away, true);
    return () => {
      window.removeEventListener("keydown", key);
      block?.removeEventListener("click", away, true);
    };
  }, [selectedTitle]);
  const playFrom = (ms: number) => {
    const p = player.current;
    if (!p || !view) return;
    p.seekTo(Math.max(0, Math.min(view.props.durationInFrames - 1, Math.round((ms * 30) / 1000))));
    p.play();
  };

  const run = source?.kind === "run" ? choices?.runs.find((r) => r.folder === source.run) : null;
  const platforms = !choices ? [] : source?.kind === "run" ? (run?.platforms ?? []) : choices.platforms;
  const videos = platforms.find((p) => p.name === source?.platform)?.videos ?? [];
  // The stage line (N1 polish): "Shape · Reels v1 planned", "Shape · planning again…" or the past run shown.
  const setShapeStatus = useSetShapeStatus();
  const platformLabel = platforms.find((p) => p.name === source?.platform)?.label ?? source?.platform ?? "";
  const shapeStatus = !source ? null : saving || loading ? { text: `${platformLabel} ${source.video}: planning…`, tone: "busy" as const } : !view ? null : source.kind === "run" ? { text: `${platformLabel} ${source.video} of the run ${source.run.replace("_", " ").replace(/(\d{2})(\d{2})$/, "$1:$2")}`, tone: "muted" as const } : { text: `${platformLabel} ${source.video} planned`, tone: "done" as const };
  const shapeStatusKey = shapeStatus ? `${shapeStatus.tone}:${shapeStatus.text}` : "";
  useEffect(() => {
    setShapeStatus(shapeStatus);
  }, [shapeStatusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setShapeStatus(null), [setShapeStatus]);
  const width = view ? Math.ceil((view.durationMs / 1000) * zoom) : 0;
  const x = (ms: number) => (ms / 1000) * zoom;
  // The two-layer timeline, Part B1 (28 Nov 2026): the lanes from the planned shots (V1 Singer, V2 B-roll, what plays).
  const layers = view ? layersOf(view.shots) : null;
  const playhead = (frame * 1000) / 30;
  const titleLanes = titleCardLanes(view?.titleCards ?? [], x);
  // Roll (drag a cut) and slip (drag inside a shot), Undo / Redo: components/timeline-editing.tsx.
  // After an edit the viewer shows the edit point (Space plays from there).
  const showAt = useCallback((videoMs: number) => player.current?.seekTo(Math.max(0, Math.round((videoMs * 30) / 1000))), []);
  const tl = useTimelineEditing({ view, zoom, mediaUrl: `/api/songs/${projectId}/storyboard/media`, post: edit, onEdited: showAt, busy: saving || loading });
  // A clip picked on the timeline is shown in the viewer: its first frame (after the Shot panel has opened,
  // which resizes the viewer).
  // `picks` counts the clicks, so clicking the clip that is already selected shows it again (8 Nov 2026).
  const [picks, setPicks] = useState(0);
  const pickedStartMs = view && selected !== null ? (view.shots[selected]?.startMs ?? null) : null;
  useEffect(() => {
    if (pickedStartMs === null) return;
    const t = setTimeout(() => showAt(pickedStartMs), 50);
    return () => clearTimeout(t);
  }, [selected, picks, pickedStartMs, showAt]);
  // The timeline clock: the time in the video and in the song (as the Lyrics tab and check-start show it).
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const ticks = useMemo(() => (view ? timeTicks(view.durationMs, zoom) : []), [view, zoom]);
  const songStart = view?.songStartMs ?? 0;
  const both = (ms: number) => {
    const t = playheadLabel(ms, songStart);
    return t.song ? `${t.video} · song ${t.song}` : t.video;
  };
  const barFrames = useMemo(() => (view ? view.bars.map((ms) => Math.round((ms * 30) / 1000)) : []), [view]);
  const shot = view && selected !== null ? view.shots[selected] : null;
  const wide = !!props?.format && props.format.width > props.format.height;
  const viewerH = useViewerHeight(viewerBlock, belowViewer, `${view && props ? "plan" : look ? "look" : "none"}:${wide ? "wide" : "tall"}:${collapsed ? "" : panel}:${view?.slots.length ?? 0}`);
  // A clip dropped on a shot: anchored on the lyric line that starts in that shot; a shot without a line
  // starting in it (an intro, a break): the clip takes that shot's place in the story order.
  const dropOnShot = (s: StoryShot, clip: string) => {
    if (!view) return;
    const line = view.lines.find((l) => l.number !== null && l.startMs >= s.startMs && l.startMs < s.endMs);
    if (line?.number != null) void edit({ action: "anchor", line: line.number, clip });
    else {
      const at = view.clips.findIndex((c) => c.name === s.clip);
      if (at < 0 || s.clip === clip) return;
      const order = view.clips.map((c) => c.name).filter((n) => n !== clip);
      order.splice(Math.max(0, Math.min(order.length, at)), 0, clip);
      void edit({ action: "order", order });
    }
  };

  // The panel beside the rail: a clicked shot (its details, its ⋯ clip settings), the clips (the story order to
  // drag from), the text cards, or one of the recipe tools (ShapeTools, always mounted).
  // A clip's ⋯ menu (components/clip-menu.tsx): speed, how it comes in, best moment, Canvas, whole clip, Omit.
  const clipMenu = (s: StoryShot, variant: "icon" | "button", style?: React.CSSProperties) => {
    const c = view?.editable && source?.kind === "plan" ? view.clips.find((k) => k.name === s.clip) : undefined;
    if (!c) return null;
    return (
      <ClipMenu
        key={`menu-${s.index}`}
        shot={s}
        clip={c}
        playheadMs={playhead}
        busy={saving}
        variant={variant}
        style={style}
        onEdit={(e) => void edit({ action: "clip", clip: c.name, edit: e })}
        onCanvas={(at) => void edit(at === null ? { action: "canvas", clip: null } : { action: "canvas", clip: c.name, at })}
        onOmit={() => void edit({ action: "omit", clip: c.name, omit: true })}
      />
    );
  };
  // A clip clicked in the Clips panel: its first shot is selected and shown in the viewer (its ⋯ is on the timeline).
  const openClip = (name: string) => {
    const s = view?.shots.find((k) => k.clip === name);
    if (!s) return;
    setSelected(s.index);
    showAt(s.startMs);
  };
  // A tab's panel has no title of its own: the selected tab is its title (N1 polish). Text, Theme and Analysis open in
  // the same panel for a moment, with a title and × back to the tab.
  const panelTitle = panel === "analysis" ? "Analysis" : panel === "theme" ? "Theme" : panel === "text" ? "Text" : null;
  const closePanel = () => {
    if (panel === "shots") setSelected(null);
    setPanel(null);
  };
  // Settings → Look's "Title cards" (11 Nov 2026): the title, byline and tagline as chips, the chosen one's editor below
  // (the same CardEditor as a title card clicked on the timeline), drawn into ShapeTools' slot.
  const titleCardsSlot = useTitleCardsSlot();
  const titleCardList = (board?.cards ?? []).filter((c) => c.type === "title" || c.type === "byline" || c.type === "tagline");
  const titleCardsInLook =
    board && view?.editable ? (
      <div data-title-cards className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
        <p className="text-sm font-medium">
          Title, artist and credits <span className="text-muted-foreground text-[11px] font-normal">· their own look in this song, over the theme&apos;s (the words: On-screen text above)</span>
        </p>
        <ul className="flex flex-col gap-1.5">
          {titleCardList.map((c) => {
            const open = cardId === c.id && panel !== "text";
            return (
              <li key={c.id} data-title-card-row={c.id} data-open={open ? "1" : "0"} className={cn("rounded-md border px-2.5 py-2", open ? "border-brand bg-brand/10" : "hover:bg-accent/40")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={c.overrides.text ?? c.text}>
                      <span className="text-muted-foreground mr-1.5 text-[11px] uppercase">{TITLE_CARD_LABEL[c.type] ?? c.type}</span>
                      {(c.overrides.text ?? c.text) || <span className="text-muted-foreground italic">empty</span>}
                    </p>
                    <p data-title-card-summary className="text-muted-foreground truncate text-[11px]">
                      {titleCardSummary(c, view?.props.textCards?.find((p) => p.id === c.id && !p.off) ?? null, board.roles[c.type as "title"] ?? {})}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-title-card-edit={c.id}
                    aria-expanded={open}
                    onClick={() => pickTitleCard(open ? null : c.id)}
                    className={cn("shrink-0 rounded-md border px-2 py-0.5 text-xs", open ? "border-brand text-brand" : "hover:bg-accent")}
                  >
                    {open ? "Close" : "Edit ›"}
                  </button>
                </div>
                {open && card && card.id === c.id ? (
                  <div className="mt-2">
                    <CardEditor
                      key={`look-${card.id}`}
                      card={card}
                      role={board.roles[card.type as "title"] ?? {}}
                      draft={draft}
                      setDraft={setDraft}
                      busy={saving}
                      onSave={() => void editText({ action: "card", id: card.id, overrides: draft })}
                      onReset={() => {
                        setDraft({});
                        void editText({ action: "card", id: card.id, overrides: null });
                      }}
                      onClose={() => pickTitleCard(null)}
                      onFixLine={(n, t) => void fixLine(n, t)}
                      fonts={board.fonts ?? []}
                      titleFont={board.titleFont ?? ""}
                      artist={board.artist ?? "Life Lyrics"}
                      planned={plannedCard}
                      titleBase={titleBase}
                      frameWidth={view?.props.format?.width ?? 1080}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
          {!titleCardList.some((c) => c.type === "tagline") ? <li className="text-muted-foreground text-[11px]">no tagline yet (Prepare → Song Details)</li> : null}
        </ul>
      </div>
    ) : null;
  const panelBody =
    panel === "shots" ? (
      <div className="flex flex-col gap-4" data-shots-panel>
      <div data-selection className="flex flex-col gap-2">
        {view && shot ? (
          <ShotDetails
            shot={shot}
            editable={view.editable}
            menu={clipMenu(shot, "button")}
            onUnanchor={shot.anchor ? () => void edit({ action: "unanchor", line: shot.anchor!.line }) : undefined}
            onOmit={view.editable ? () => void edit({ action: "omit", clip: shot.clip, omit: true }) : undefined}
            onResetTimeline={view.editable && tl.edited(shot) ? () => void tl.save(tl.resetBody(shot)) : undefined}
            onClose={closePanel}
          />
        ) : (
          <p className="text-muted-foreground text-xs">Click a shot on the timeline.</p>
        )}
      </div>
      <div className="flex flex-col gap-3" data-clips-panel>
        {view?.editable && view.clips.length ? (
          <StoryStrip clips={view.clips.filter((c) => (c.role ?? "story") === "story")} busy={saving || loading} onOpen={openClip} onOmit={(clip, omit) => void edit({ action: "omit", clip, omit })} current={shot?.clip ?? null} />
        ) : (
          <p className="text-muted-foreground text-xs">{view && !view.editable ? "A past run: its clips cannot be changed." : "The clips show once the video is planned."}</p>
        )}
      </div>
      </div>
    ) : panel === "text" ? (
      <div className="flex flex-col gap-3" data-text-panel>
        <p className="text-muted-foreground text-xs">Click a lyric line or a title card on the timeline to fix its words or change its place, size, hold or effect.</p>
        {view?.editable && card ? (
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
            onFixLine={(n, t) => void fixLine(n, t)}
            fonts={board?.fonts ?? []}
            titleFont={board?.titleFont ?? ""}
            artist={board?.artist ?? "Life Lyrics"}
            planned={plannedCard}
            titleBase={titleBase}
            frameWidth={view?.props.format?.width ?? 1080}
          />
        ) : null}
        {view?.editable && board ? <TemplateBar board={board} busy={saving} onEdit={(b) => void editText(b)} onOpen={openCard} /> : null}
        {notice ? (
          <p className="text-xs text-emerald-300" role="status" data-textboard-notice>
            {notice}
          </p>
        ) : null}
        {stale ? (
          <div data-stale-timing={stale.line} className="flex flex-col gap-1.5 rounded-md border border-amber-300/40 bg-amber-300/10 px-2.5 py-2 text-xs text-amber-100">
            <p>
              The lyric timing is now <b>stale</b>: it was made for the old words of line {stale.line}. Time the lyrics again to fix it. Until then Shape
              cannot plan this video with the new words (it never times them itself); a video you make would time them again first (Tasks shows it).
            </p>
            {stale.queued ? (
              <p data-stale-queued>{stale.queued}</p>
            ) : (
              <button type="button" data-stale-retime onClick={() => void timeAgain(stale.line)} className="bg-brand text-brand-foreground self-start rounded-md px-3 py-1 font-medium">
                Time the lyrics again
              </button>
            )}
          </div>
        ) : null}
      </div>
    ) : null;

  const viewer =
    view && props ? (
      <div className="relative mx-auto max-w-full overflow-hidden rounded-xl border bg-black shadow-lg" style={{ height: viewerH ?? VIEWER_HEIGHT, aspectRatio: wide ? "16 / 9" : "9 / 16" }}
        data-viewer
        data-viewer-height={viewerH ?? undefined}
        data-patched={look?.patch && view.source === "plan" ? "1" : "0"}
        data-previewing-pair={look?.previewing ?? undefined}
        data-verse-family={props.style.font}
        data-hook-family={props.hookFont?.font ?? props.style.font}
        data-effect={props.lyricEffects?.verse.name}
        data-hook-effect={props.lyricEffects?.hook.name}
        data-accent={props.lyricEffects?.accent}
        data-grade={props.picture?.grade ?? "natural"}
        data-text-colour={props.colour}
      >
        <Player
          ref={playerRef}
          component={LyricVideo}
          inputProps={props}
          durationInFrames={props.durationInFrames}
          compositionWidth={props.format?.width ?? 1080}
          compositionHeight={props.format?.height ?? 1920}
          fps={30}
          clickToPlay
          playbackRate={rate}
          loop={loop}
          style={{ width: "100%", height: "100%" }}
        />
        <ViewerFrame frame={tl.viewerFrame} />
        {demo ? (
          <div data-effect-demo={demo.input.effect.name} data-demo-veil={cardOnScreen ? "card" : undefined} className="pointer-events-none absolute inset-0" style={{ background: cardOnScreen ? "rgba(10,10,12,0.86)" : "rgba(0,0,0,0.35)" }}>
            <PreviewPlayer input={demo.input} />
          </div>
        ) : null}
      </div>
    ) : look ? (
      <LookViewer input={look.fallback} caption={look.caption} previewing={look.previewing} height={viewerH} />
    ) : null;

  // The Analysis panel (2 Nov 2026, asked by the user: "group these infos into a single tag called Analysis, explained by
  // section"): opened by the Analysis chip in the song header. Kept in the page (hidden while another panel is open) so
  // its facts are always there to read.
  const verdictTone = view ? view.assessment.verdict : null;
  const lookSection = (
    <AnalysisSection title="Look & content">
      {themeLook.themeNow ? (
        <p data-look-content className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Look:</span>
          <button type="button" data-look-theme onClick={themeLook.openTheme} className="text-brand underline-offset-2 hover:underline">
            theme {themeLook.themeNow.name}
          </button>
          <ThemeReachBadge users={themeLook.themeNow.users} thisSong={themeLook.themeNow.song} />
          <span className="text-muted-foreground mx-1">·</span>
          <span className="text-muted-foreground">Content: this song (words, clips, card text)</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Content: this song (words, clips, card text)</p>
      )}
    </AnalysisSection>
  );
  const analysisBody =
    view && props ? (
      <div className="flex flex-col gap-4 text-xs">
        <AnalysisSection title="Verdict">
          <div data-storyboard-assessment>
            <AssessmentDetails a={view.assessment} limit={6} handled={false} />
          </div>
          <p className="text-muted-foreground text-[11px]">Predicted from the plan, before rendering.</p>
        </AnalysisSection>
        <AnalysisSection title="This video">
          <p className="text-muted-foreground" data-storyboard-summary>
            <span className="text-foreground font-medium">
              {view.platform.label} {view.video}
            </span>{" "}
            · {view.source === "plan" ? "planned now" : `run ${view.run}`} · {secs(view.durationMs)} ({clock(view.section.startMs)}–{clock(view.section.endMs)} in the song) · {Math.round(view.bpm)} BPM · {view.shots.length} shots
            {view.picture ? <span data-storyboard-picture> · pictures: {view.picture.replace(/\+/g, " + ").replace(/^song\b/, "the song's clips")}</span> : null}
          </p>
        </AnalysisSection>
        {lookSection}
        <AnalysisSection title="Length & ending">
          <p className="text-muted-foreground">{view.section.reason}</p>
          {view.decisions.map((d) => (
            <p key={d} className="text-xs text-sky-200" data-decision>
              {d}
              {d.startsWith("Length: you set") ? (
                <button type="button" data-use-automatic className="text-brand ml-2 underline" disabled={saving} onClick={() => void switchToAutomaticLength(view.platform.name)}>
                  Use automatic
                </button>
              ) : null}
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
        </AnalysisSection>
        {view.slots.length || view.anchorsOutside.length || view.anchorWarnings.length || view.notes.length ? (
          <AnalysisSection title="Clips & warnings">
            {view.slots.length ? (
              <p className="rounded-md border border-dashed border-amber-400/60 bg-amber-400/10 p-2 text-amber-100" data-slots>
                <Anchor className="mr-1 inline size-3" />
                Needs a clip (drag one from Clips onto the line): {view.slots.map((x) => `line ${x.line} "${x.text}" (was ${x.clip})`).join(" · ")}
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
          </AnalysisSection>
        ) : null}
        <AnalysisSection title="How to edit">
          <p className="text-muted-foreground" data-storyboard-hint>
            Click a shot to {view.editable ? "edit" : "see"} it · drag a clip from{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setPanel("shots")} data-open-clips>
              Shots
            </button>{" "}
            onto a shot or a lyric line · Shape&apos;s tabs (Look, Part &amp; ending, Pace, Shots) change how the video is planned and looks; the clips, words and tempo are in Prepare, the platforms in Make.
          </p>
        </AnalysisSection>
      </div>
    ) : (
      <div className="flex flex-col gap-4 text-xs">
        {lookSection}
        <p className="text-muted-foreground">No plan yet: the verdict, length and ending come with the first planned video.</p>
      </div>
    );
  // The song header's Analysis chip (a portal into its slot in songs/[id]/page.tsx), with "planning again…".
  const headerSlot = useSyncExternalStore(noSubscribe, findHeaderSlot, noHeaderSlot);
  const headerActions = headerSlot
    ? createPortal(
        <>
          {saving || loading ? (
            <span className="text-brand text-xs" data-replanning>
              <Loader2 className="mr-1 inline size-3 animate-spin" />
              planning again…
            </span>
          ) : null}
          <button
            type="button"
            data-analysis-chip
            data-verdict={verdictTone ?? undefined}
            aria-pressed={panel === "analysis"}
            onClick={() => setPanel(panel === "analysis" ? null : "analysis")}
            title={view ? `${VERDICT_TEXT[view.assessment.verdict]}: open the analysis` : "The analysis of the planned video"}
            className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", panel === "analysis" ? "border-brand text-brand" : "hover:border-foreground/40")}
          >
            <span className={cn("size-2 rounded-full", verdictTone === "ready" ? "bg-emerald-400" : verdictTone === "good" ? "bg-amber-300" : verdictTone === "not-ready" ? "bg-red-400" : "bg-muted-foreground")} aria-hidden />
            Analysis
          </button>
        </>,
        headerSlot,
      )
    : null;

  // Which video: the plan now (per platform and video) or a past run; Pictures; Plan again.
  const sourceControls = choices?.ready ? (
    <>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground sr-only text-xs">Show</span>
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
                <option value="plan" title="The plan now, as Make would make it">Plan now</option>
                {choices.runs.map((r) => (
                  <option key={r.folder} value={r.folder}>
                    Run {r.folder.replace("_", " ").replace(/(\d{2})(\d{2})$/, "$1:$2")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground sr-only text-xs">Platform</span>
              <select className={select} data-storyboard-platform value={source?.platform ?? ""} onChange={(e) => source && setSource({ ...source, platform: e.target.value, video: platforms.find((p) => p.name === e.target.value)?.videos[0] ?? "v1", ...(source.kind === "plan" ? { try: undefined } : {}) })}>
                {platforms.map((p) => (
                  <option key={p.name} value={p.name} {...("notInMake" in p && p.notInMake ? { "data-not-in-make": p.name, title: "Make does not make this one until you turn it on in Make → Make" } : {})}>
                    {p.label}
                    {"notInMake" in p && p.notInMake ? " · not selected in Make" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground sr-only text-xs">Video</span>
              <select
                className={select}
                data-storyboard-video
                value={source?.kind === "plan" && source.try ? `try:${source.try}` : (source?.video ?? "v1")}
                onChange={(e) => {
                  if (!source) return;
                  const t = e.target.value.startsWith("try:") ? (choices?.tries ?? []).find((x) => `try:${x.id}` === e.target.value) : undefined;
                  setSource(t && source.kind === "plan" ? { ...source, video: t.video, try: t.id } : source.kind === "plan" ? { kind: "plan", platform: source.platform, video: e.target.value } : { ...source, video: e.target.value });
                }}
              >
                {videos.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                {/* 2e-1: Try other looks videos, each from its own shot plan */}
                {source?.kind === "plan"
                  ? (choices?.tries ?? []).filter((t) => t.platform === source.platform).map((t) => (
                      <option key={t.id} value={`try:${t.id}`} data-storyboard-try={t.id}>
                        {tryName(t.label)} (based on {t.video})
                      </option>
                    ))
                  : null}
              </select>
            </label>
            {source?.kind === "plan" && !source.try && pictures ? (
              <details className="relative" data-pictures>
                <summary className={cn(select, "flex cursor-pointer items-center")}>Pictures: {clipSet(pictures) ? clipSet(pictures)!.replace(/\+/g, " + ").replace(/^song/, "the song's clips") : "as the recipe"}</summary>
                <div className="bg-popover absolute bottom-full z-10 mb-1 flex w-64 flex-col gap-1 rounded-md border p-2 text-xs shadow-lg">
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
            <Button size="icon" variant="outline" className="size-7" disabled={!source || loading} onClick={() => source && show(source)} data-storyboard-show title={loading ? "Planning…" : "Plan this video again"}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} <span className="sr-only">{loading ? "Planning…" : "Plan again"}</span>
            </Button>
    </>
  ) : null;

  return (
    <div data-storyboard data-shape className="flex min-w-0 items-start gap-4">
      {headerActions}
      {/* The panel beside the viewer (N1 polish): always the selected tab's content; it can only be collapsed (the button
          on its edge), and the tab stays selected while it is. */}
      {collapsed ? (
        <button type="button" data-panel-expand onClick={() => setCollapsed(false)} title="Show the panel" aria-label="show the panel" className="bg-card/40 text-muted-foreground hover:text-foreground sticky top-0 flex h-24 w-5 shrink-0 items-center justify-center rounded-md border">
          <ChevronRight className="size-4" />
        </button>
      ) : null}
      <div className={cn("sticky top-0 flex shrink-0 items-start", collapsed && "hidden")}>
      <aside
        data-shape-panel={collapsed ? "" : panel}
        data-shape-tools
        className="bg-card/40 flex max-h-[calc(100vh-8rem)] w-[clamp(320px,28vw,400px)] shrink-0 flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-l-lg border p-3 [&_input]:max-w-full [&_select]:max-w-full"
      >
        {panelTitle ? (
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-base font-semibold">{panelTitle}</h2>
            <button type="button" data-panel-close onClick={closePanel} aria-label="back to the tab" title="Back to the tab" className="text-muted-foreground hover:text-foreground rounded p-1">
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        {/* the Look bar (ShapeTools draws it here): the song's theme and Change, whatever panel is open */}
        <div data-look-bar-slot className="empty:hidden" />
        {panelBody}
        <div hidden={panel !== "analysis"} data-analysis-panel>
          {analysisBody}
        </div>
        {tools}
        {titleCardsSlot && titleCardsInLook ? createPortal(titleCardsInLook, titleCardsSlot) : null}
      </aside>
      <button type="button" data-panel-collapse onClick={() => setCollapsed(true)} title="Collapse the panel (the viewer gets the width)" aria-label="collapse the panel" className="bg-card/40 text-muted-foreground hover:text-foreground -ml-px flex h-24 w-5 shrink-0 items-center justify-center rounded-r-md border">
        <ChevronLeft className="size-4" />
      </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* which video, before there is a plan (with a plan these sit in the command bar under the timeline) */}
        {choices?.ready && !(view && props) ? <div className="flex flex-wrap items-center gap-3 text-sm">{sourceControls}</div> : null}
        {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

        {/* 1. the viewer */}
        <div ref={viewerBlock} className="flex flex-col items-center gap-2" data-viewer-block>
          {card && plannedCard && view && props ? (
            <TitleCardToolbar
              card={card}
              planned={props.textCards?.find((c) => c.id === card.id) ?? plannedCard}
              plannedSize={plannedCard}
              titleBase={titleBase}
              frameWidth={view.props.format?.width ?? 1080}
              draft={draft}
              setDraft={setDraft}
              fonts={board?.fonts ?? []}
              titleFont={board?.titleFont ?? ""}
              onClose={() => pickTitleCard(null)}
            />
          ) : null}
          {viewer}
          {view ? null : !choices ? (
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
          {!view ? (
            <Button size="sm" data-next-make onClick={() => goTo("generate")}>
              Next: Make <ChevronRight />
            </Button>
          ) : null}
        </div>

        {view && props ? (
          <>
            {/* 2. the soundtrack (bars, waveform, lyric lines) and 3. the shots, then 4. the command bar: measured, the viewer gets the rest */}
            <div ref={belowViewer} className="flex flex-col gap-3" data-below-viewer>
            <div className="flex rounded-lg border" data-timeline-frame>
            {/* The lanes' names in their own column (28 Nov 2026, Paul: they covered the clips and the lyrics); each row is
                exactly as tall as its lane in the timeline. */}
            <div className="bg-card/60 flex w-[70px] shrink-0 flex-col border-r text-[10px] leading-tight" data-lane-names>
              <div className="h-5 border-b" />
              {view.titleCards.length ? <div className="text-muted-foreground border-b px-1 pt-0.5" style={{ height: titleLanes.count > 1 ? titleLanes.count * TITLE_LANE_PX + 5 : 20 }}>Titles</div> : null}
              <LaneName name="Lyrics" className="h-8" />
              <LaneName name="Shots" note="singer: green outline" className="h-24" />
              <LaneName name="What plays" className="h-4" />
              <LaneName name="A1 Song" className="h-6" />
              {energy ? <div className="h-3 border-b" /> : null}
            </div>
            <div ref={timeline} onScroll={onTimelineScroll} className="min-w-0 flex-1 overflow-x-auto" data-storyboard-timeline>
              <div style={{ width: width + 16 + 2 * followPad + songPre + songPost, paddingLeft: lead, paddingRight: followPad + songPost }} data-follow-pad={followPad || undefined} data-song-pre={songPre || undefined}>
              <div
                className="relative"
                style={{ width: width + 16 }}
                onClick={(e) => playFrom(((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000)}
                onMouseMove={(e) => setHoverMs(Math.min(view.durationMs, Math.max(0, ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000)))}
                onMouseLeave={() => setHoverMs(null)}
              >
                {/* 1. the ruler (one line since 8 Nov 2026, asked by the user): minutes:seconds in the video at the top
                    (hover or the playhead bubble adds the song's time), the bars (the beat grid the cuts follow) as small pink
                    numbers on their own ticks at the bottom, the hook sections (choruses) shaded behind */}
                <div className="relative h-5 border-b text-[10px] leading-none" data-time-ruler title={`Time in the video${songStart > 0 ? ` (song time = video time + ${clockTenths(songStart)}, where this video starts in the song)` : " (= time in the song)"}; pink numbers: the bars (the beat grid the cuts follow).`}>
                  {view.hooks.map((h, i) => (
                    <div key={`h${i}`} className="bg-brand/15 absolute top-0 bottom-0" style={{ left: x(h.startMs), width: x(h.endMs - h.startMs) }} title="hook (chorus)" data-hook-section />
                  ))}
                  {ticks.map((t) => (
                    <div key={t.ms} className={cn("absolute top-0 border-l", t.label ? "h-2.5 border-white/30" : "h-1 border-white/15")} style={{ left: x(t.ms) }} data-time-tick={t.label ?? undefined}>
                      {t.label ? <span className="text-muted-foreground absolute top-0 left-1 tabular-nums">{t.label}</span> : null}
                    </div>
                  ))}
                  {view.bars.map((b, i) => (
                    <div key={`b${b}`} className="text-brand/90 absolute bottom-0 h-2 border-l border-brand/60 pl-0.5 text-[9px] leading-none" style={{ left: x(b) }} title={`bar ${i + 1} · ${both(b)}`} data-bar>
                      {i + 1}
                    </div>
                  ))}
                </div>
                {view.titleCards.length ? (
                  <div className="relative border-b" data-textboard-titles data-lanes={titleLanes.count} style={{ height: titleLanes.count > 1 ? titleLanes.count * TITLE_LANE_PX + 5 : 20 }}>
                    {view.titleCards.map((c, ci) => (
                      <button
                        type="button"
                        key={c.id}
                        data-text-card={c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (c.type === "hook" || c.type === "end") setPanel("theme"); // the theme's card: Edit theme → Cards
                          else if (view.editable && TITLE_CARD_IDS.has(c.id)) openTitleCard(c.id); // Settings → Look (11 Nov 2026)
                          else if (view.editable) openCard(c.id);
                        }}
                        className={cn("bg-brand/20 absolute overflow-hidden rounded border px-1 text-left text-[10px]", cardId === c.id && "ring-brand ring-2")}
                        data-lane={titleLanes.lane[ci]}
                        style={{ left: x(c.startMs), width: Math.max(8, x(c.endMs - c.startMs) - 2), top: titleLanes.count > 1 ? 2 + titleLanes.lane[ci] * TITLE_LANE_PX : 2, height: titleLanes.count > 1 ? TITLE_LANE_PX - 1 : 15, lineHeight: titleLanes.count > 1 ? `${TITLE_LANE_PX - 3}px` : undefined }}
                        title={`${CARD_TYPE_LABELS[c.type] ?? c.type}: ${c.text}${c.type === "hook" || c.type === "end" ? " (the theme's card: Edit theme → Cards)" : ""}`}
                      >
                        <Type className="mr-0.5 inline size-2.5" />
                        {CARD_TYPE_LABELS[c.type] ?? c.type}: {c.text}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="relative h-8 border-b" data-textboard-row>
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
                      title={`${l.number ? `line ${l.number}: ` : ""}${l.text}${l.slotWhy ? `\n${l.slotWhy}` : ""}\non screen ${clockTenths(l.startMs)}–${clockTenths(l.endMs)} in the video${songStart > 0 ? ` · ${clockTenths(songTimeMs(l.startMs, songStart))}–${clockTenths(songTimeMs(l.endMs, songStart))} in the song` : ""}${l.anchor ? ` · ⚓ ${l.anchor}` : ""}${l.slot ? ` · needs a clip (was ${l.slot})` : ""}${l.changed ? " · its own look" : ""}`}
                    >
                      {l.anchor ? <Anchor className="text-brand mr-0.5 inline size-3" aria-label="anchored" /> : null}
                      {l.slot ? <Anchor className="mr-0.5 inline size-3 text-amber-300" aria-label="slot" /> : null}
                      {l.slotWhy ? <span data-slot-why className="text-amber-200" title={l.slotWhy}>{/its shot is 16:9/.test(l.slotWhy) ? "16:9 shot: not in this video · " : "9:16 shot: not in this video · "}</span> : null}
                      {l.changed ? <Pencil className="mr-0.5 inline size-2.5 text-sky-300" aria-label="own look" /> : null}
                      {/* The line's number in front (28 Nov 2026, Paul: "L14: You're beautiful"), as in Lyrics Sync; never in the video. */}
                      {l.number ? <span className="text-muted-foreground mr-1 font-medium tabular-nums" data-line-no={l.number}>L{l.number}:</span> : null}
                      {l.text}
                    </div>
                  ))}
                </div>
                <div className="relative h-24 select-none border-b" data-shots-row data-lane="v2" onClickCapture={tl.onRowClickCapture}>
                  {!view.shots.length ? (
                    <div className="text-muted-foreground sticky left-2 inline-flex h-full max-w-xl items-center px-3 text-xs" data-no-shots>
                      {view.platform.name === "youtube" ? (
                        <span>
                          No clip shots: this YouTube video shows your cover art for the whole song (the cover layout). To build it from your clips instead, open{" "}
                          <button type="button" className="text-foreground underline underline-offset-2" onClick={(e) => { e.stopPropagation(); setPanel("look"); window.dispatchEvent(new Event("lyric-look-advanced")); }} data-open-song>
                            Look
                          </button>{" "}
                          and set the YouTube layout to clips.
                        </span>
                      ) : (
                        <span>No clip shots in this video.</span>
                      )}
                    </div>
                  ) : null}
                  {view.shots.map((s) => (
                    <ShotBlock
                      key={s.index}
                      shot={tl.shown(s)}
                      left={x(s.startMs)}
                      width={x(s.endMs - s.startMs)}
                      selected={selected === s.index}
                      slipped={tl.slipped(s)}
                      pending={tl.pendingShot(s.index)}
                      slippable={view.editable && s.kind === "video" && s.role !== "singing"}
                      onPointerDown={s.role === "singing" ? undefined : (e) => tl.onShotPointerDown(s, e)}
                      onSelect={() => {
                        setSelected(s.index);
                        setPicks((n) => n + 1);
                        setPanel("shots");
                      }}
                      dropTarget={dropShot === s.index || tl.liftOver === s.index}
                      lifted={tl.liftFrom === s.index}
                      editable={view.editable && source?.kind === "plan"}
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
                  {view.shots.map((s) => (x(s.endMs - s.startMs) >= 48 || selected === s.index ? clipMenu(s, "icon", { left: x(s.endMs) - 28, top: 6 }) : null))}
                  {tl.handles}
                  {tl.overlay}
                </div>
                {/* What plays: the layer the viewer sees, moment by moment, and the soft changes into and out of the singer. */}
                <div className="relative h-4 border-b" data-what-plays title="What plays: green = the singer (V1), blue = B-roll (V2), black with a red edge = nothing yet. The white fades: the B-roll fading out over the singer's first 0.4 s, and in over its last 0.4 s.">
                  {layers?.plays.map((p) => (
                    <div key={`${p.shot}${p.fromMs}`} data-plays={p.layer} className={cn("absolute top-0 bottom-0", p.layer === "singer" ? "bg-emerald-500" : p.layer === "broll" ? "bg-sky-500/70" : "border-y-2 border-red-500/80 bg-black")} style={{ left: x(p.fromMs), width: Math.max(1, x(p.toMs - p.fromMs)) }} />
                  ))}
                  {layers?.fades.map((f) => (
                    <div key={`${f.kind}${f.atMs}`} data-fade={f.kind} className={cn("absolute top-0 bottom-0", f.kind === "into-singer" ? "bg-gradient-to-r" : "bg-gradient-to-l", "from-white/90 to-transparent")} style={{ left: x(f.kind === "into-singer" ? f.atMs : f.atMs - SOFT_EXIT_MS), width: x(f.kind === "into-singer" ? SOFT_CHANGE_MS : SOFT_EXIT_MS) }} />
                  ))}
                </div>
                {/* the song track: the whole song (8 Nov 2026), this video's part as the pink window on it */}
                <div className="relative h-6 border-b" data-song-track data-soundtrack-track data-lane="a1">
                  {view.song ? <SongTrackBehind song={view.song} songStartMs={view.songStartMs} zoom={zoom} /> : null}
                  {slots.map((s) => (
                    // A singing slot (Storyboard → Singing): where a lip-sync shot belongs; display only.
                    <div
                      key={s.key}
                      data-singing-band={s.key}
                      data-singing-state={s.state}
                      title={`Singing · ${s.label}: ${s.text}`}
                      className={cn("pointer-events-none absolute top-0 h-1.5 rounded-sm", s.state === "accepted" ? "bg-sky-400/80" : s.state === "none" ? "bg-amber-400/60" : "bg-sky-400/40")}
                      style={{ left: ((s.fromMs - view.songStartMs) / 1000) * zoom, width: Math.max(2, ((s.toMs - s.fromMs) / 1000) * zoom) }}
                    />
                  ))}
                  <svg className="relative block h-6" viewBox={`0 0 ${view.waveform.peaks.length} 100`} preserveAspectRatio="none" style={{ width }} data-waveform>
                    {view.waveform.peaks.map((p, i) => (
                      <rect key={i} x={i} y={50 - p * 48} width={0.8} height={Math.max(1, p * 96)} className="fill-brand/60" />
                    ))}
                  </svg>
                  {view.song ? (
                    <SongWindow
                      song={view.song}
                      songStartMs={view.songStartMs}
                      durationMs={view.durationMs}
                      zoom={zoom}
                      editable={view.editable && source?.kind === "plan"}
                      busy={saving || loading}
                      onSet={(section) => void setSection(section)}
                      onDrag={setSongDrag}
                    />
                  ) : null}
                </div>
                {energy ? (
                  // The music's energy over the song (relative to the song itself: 0 = its calmest, 1 = its fullest).
                  <div className="relative h-3 border-b" data-energy-band title="The music's energy (Performance script: Analyse the music). Marks: drops, builds and breakdowns.">
                    <svg className="absolute inset-0 block h-3" style={{ width }} preserveAspectRatio="none" viewBox={`0 0 ${width} 100`}>
                      <polyline
                        fill="none"
                        className="stroke-amber-300/80"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        points={energy.values.map((e, i) => `${(((i * energy.blockMs) - view.songStartMs) / 1000) * zoom},${100 - e * 95}`).join(" ")}
                      />
                    </svg>
                    {energy.events
                      .filter((e) => ["drop", "build", "breakdown", "silence"].includes(e.type))
                      .map((e) => (
                        <div key={`${e.type}${e.at_ms}`} data-energy-event={e.type} title={`${e.type} at ${both(e.at_ms - view.songStartMs)}`} className={cn("pointer-events-none absolute top-0 h-3 border-l", e.type === "drop" ? "border-red-400" : e.type === "build" ? "border-amber-300 border-dashed" : "border-sky-300")} style={{ left: ((e.at_ms - view.songStartMs) / 1000) * zoom }} />
                      ))}
                  </div>
                ) : null}
                {hoverMs !== null && Math.abs(x(hoverMs) - x(playhead)) > 4 ? (
                  <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/30" style={{ left: x(hoverMs) }} data-hover-line>
                    <span className="bg-background/90 text-muted-foreground absolute top-0 left-1 rounded border px-1 text-[10px] whitespace-nowrap tabular-nums" data-hover-time>
                      {both(hoverMs)}
                    </span>
                  </div>
                ) : null}
                <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-white" style={{ left: x(playhead) }} data-playhead>
                  <span className={cn("absolute top-0 rounded bg-white px-1 text-[10px] font-medium whitespace-nowrap text-black tabular-nums", x(playhead) > width - 140 ? "right-1" : "left-1")} data-playhead-time>
                    {both(playhead)}
                  </span>
                </div>
              </div>
              </div>
            </div>
            </div>
            {/* 4. one command bar under the timeline: which video, the transport, follow / zoom (the verdict and Next are in the top line) */}
            <div className="bg-card/60 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2 py-1 text-xs" data-command-bar>
              <div className="flex items-center gap-2">{sourceControls}</div>
              <span className="bg-border hidden h-6 w-px sm:block" />
              <TransportBar player={player} frame={frame} playing={playing} songStartMs={songStart} durationInFrames={props.durationInFrames} barFrames={barFrames} rate={rate} onRate={setRate} loop={loop} onLoop={setLoop} />
              <span className="bg-border hidden h-6 w-px sm:block" />
              {source?.kind === "plan" ? (
                <>
                  <BrollHere view={view} playheadMs={playhead} busy={saving || loading} edit={edit} onDone={(text) => setNotice(text)} />
                  <span className="bg-border hidden h-6 w-px sm:block" />
                </>
              ) : null}
              {view.song ? (
                <>
                  <SongRange song={view.song} window={{ startMs: view.songStartMs, endMs: view.songStartMs + view.durationMs }} drag={songDrag} platformLabel={view.platform.label} editable={view.editable && source?.kind === "plan"} busy={saving || loading} onAutomatic={() => void setSection("auto")} />
                  <span className="bg-border hidden h-6 w-px sm:block" />
                </>
              ) : null}
              <div className="flex items-center gap-1 text-xs">
                {view.editable ? (
                  <span className="mr-2 flex items-center gap-1" data-timeline-undo>
                    <button type="button" disabled={!tl.canUndo || saving} onClick={() => void tl.undo()} className="rounded border px-1 disabled:opacity-40" title="Undo the last cut move or slip (Ctrl+Z)" aria-label="Undo">
                      <Undo2 className="size-3.5" />
                    </button>
                    <button type="button" disabled={!tl.canRedo || saving} onClick={() => void tl.redo()} className="rounded border px-1 disabled:opacity-40" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                      <Redo2 className="size-3.5" />
                    </button>
                  </span>
                ) : null}
                <label className="mr-2 flex cursor-pointer items-center gap-1.5" title="While the video plays, the timeline scrolls with the playhead. Scroll by hand to stop it until the next play.">
                  <input type="checkbox" checked={follow} onChange={toggleFollow} className="accent-brand" data-follow-playback />
                  Follow
                </label>
                Zoom
                {ZOOMS.map((z) => (
                  <button key={z} type="button" onClick={() => setZoom(z)} className={cn("rounded border px-1.5", zoom === z ? "border-brand text-brand" : "text-muted-foreground")}>
                    {z / 40}x
                  </button>
                ))}
              </div>
            </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// A lane's name in the column beside the timeline (as tall as its lane).
function LaneName({ name, note, className }: { name: string; note?: string; className: string }) {
  return (
    <div className={cn("flex flex-col justify-center overflow-hidden border-b px-1", className)} data-lane-label={name}>
      <span className="font-medium whitespace-nowrap text-white/85">{name}</span>
      {note ? <span className="text-muted-foreground whitespace-nowrap">{note}</span> : null}
    </div>
  );
}

function ShotBlock({
  shot: s,
  left,
  width,
  selected,
  slipped,
  pending,
  slippable,
  lifted,
  editable,
  onPointerDown,
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
  slipped?: boolean; // the user chose which part of the clip plays here (slip)
  pending?: boolean; // an edit of this shot is being saved and planned
  slippable?: boolean;
  lifted?: boolean; // picked up to be dropped on another shot (a swap)
  editable?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
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
      data-slipped={slipped || undefined}
      data-pending={pending || undefined}
      data-lifted={lifted || undefined}
      onPointerDown={onPointerDown}
      data-drop-target={dropTarget || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-warnings={s.warnings.length || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cn("absolute top-1 bottom-1 overflow-hidden rounded border text-left text-[10px] text-white", s.role === "singing" ? "border-2 border-emerald-400" : s.warnings.length ? "border-amber-400" : "border-white/20", (selected || dropTarget) && "ring-brand ring-2", lifted && "border-brand border-dashed opacity-40")}
      data-singer-shot={s.role === "singing" || undefined}
      style={{ left, width: Math.max(6, width - 2), backgroundColor: "#000", backgroundImage: s.thumb ? `url(/api/files/${s.thumb})` : undefined, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x", backgroundPosition: "left center" }}
      title={`${s.clip} · ${secs(s.endMs - s.startMs)}${slippable ? "\nDrag sideways to slip: another part of the clip in the same shot. Drag the line between two shots to move the cut." : ""}${editable ? "\nDrag it up to lift it, then onto another clip to swap the two." : ""}${s.warnings.length ? `\n${s.warnings.join("\n")}` : ""}`}
    >
      <div className="absolute top-0 right-0 left-0 flex flex-wrap gap-0.5 p-0.5 pr-6 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {/* What the viewer sees (27 Nov 2026): the singer, lips in time with the song, or B-roll. */}
        {s.role === "singing" ? (
          <span className="flex items-center gap-0.5 rounded bg-emerald-600/85 px-0.5" data-badge="singing" title="The singer (V1): locked to the song, always 1.00x, in time; it never moves when you edit the B-roll (the nudge in Lyrics Sync moves it)">
            <Lock className="size-2.5" /> Singer · in time
          </span>
        ) : s.role === "broll" ? (
          <span className="rounded bg-black/60 px-0.5" data-badge="broll">
            B-roll
          </span>
        ) : null}
        {s.anchor ? (
          <span className="bg-brand/80 flex items-center rounded px-0.5" data-badge="anchor">
            <Anchor className="size-2.5" />
            {s.anchor.line}
          </span>
        ) : null}
        {s.best ? <Star className="size-3 text-yellow-300" data-badge="best" aria-label="best moment" /> : null}
        {s.dissolve ? <Blend className="size-3 text-sky-300" data-badge="dissolve" aria-label="dissolve" /> : null}
        {s.dip ? <span className="size-2.5 rounded-full border border-white/70 bg-black" data-badge="dip" aria-label="dip to black" title="dip to black" /> : null}
        {slipped ? <MoveHorizontal className="text-brand size-3" data-badge="slip" aria-label="slipped by you" /> : null}
        {s.loop ? <Repeat className="size-3 text-emerald-300" data-badge="loop" aria-label="loop ending" /> : null}
        {s.speed < 1 ? (
          <span className="flex items-center rounded bg-black/60 px-0.5" data-badge="speed">
            <Gauge className="size-2.5" />
            {s.speed.toFixed(2)}x
          </span>
        ) : null}
        {s.warnings.length ? <AlertTriangle className="size-3 text-amber-300" data-badge="warning" /> : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-px leading-tight" data-shot-label>
        {s.index + 1} · {s.clip}
        <br />
        <span className="text-white/75">{secs(s.endMs - s.startMs)} · {s.inS.toFixed(1)}–{s.outS.toFixed(1)} s</span>
      </div>
    </button>
  );
}

function ShotDetails({ shot: s, editable, menu, onUnanchor, onOmit, onResetTimeline, onClose }: { shot: StoryShot; editable: boolean; menu: ReactNode; onUnanchor?: () => void; onOmit?: () => void; onResetTimeline?: () => void; onClose: () => void }) {
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
      {menu || onOmit || onResetTimeline ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {onResetTimeline ? (
            <button type="button" data-timeline-reset onClick={onResetTimeline} className="hover:bg-accent text-brand border-brand/50 flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" title="Your moved cuts at this shot's edges and the part of the clip you slipped go back to the app's choice">
              <RotateCcw className="size-3" /> Automatic cuts and clip start
            </button>
          ) : null}
          {menu}
          {onOmit ? (
            <button type="button" data-shot-omit onClick={onOmit} title="Leaves this clip out of the videos (it keeps its place in the story order; Use it again in the clips row) and plans the video again" className="hover:bg-accent rounded-md border px-2 py-0.5 text-xs">
              Omit this clip
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
      {editable && s.kind === "video" ? (
        <p className="text-muted-foreground mt-1" data-trim-hint>
          Trim on the timeline: drag the line between two clips to move the cut, drag inside the clip to play another part of it, the first and last clip also by their outer edges. Speed, how it comes in, best moment and the Canvas: the clip&apos;s ⋯.
        </p>
      ) : null}
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
// videos use them. The order itself is set in Prepare → Storyboard (11 Nov 2026: one place, collection clips
// included); here: drag a card onto a lyric line or a shot to put it there; click it to find it on the timeline.
function StoryStrip({ clips, busy, onOpen, onOmit, current }: { clips: StoryboardClip[]; busy: boolean; onOpen: (name: string) => void; onOmit: (name: string, omit: boolean) => void; current: string | null }) {
  const goToTab = useGoToTab();
  return (
    <div data-story-strip>
      <p className="text-muted-foreground mb-2 text-xs" data-story-strip-hint>
        The clips in your story order (every video follows it). Change the order in{" "}
        <button type="button" data-open-storyboard onClick={() => goToTab("clips")} className="text-foreground underline underline-offset-2">
          Prepare → Storyboard
        </button>
        . Drag one onto a shot or a lyric line to put it there; click one to find it on the timeline.
      </p>
      <ol className="grid grid-cols-2 gap-2">
        {clips.map((c, i) => (
          <li
            key={c.name}
            data-story-clip={c.name}
            data-story-index={i + 1}
            data-omit={c.omit ? "1" : "0"}
            draggable={!busy}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/x-lyric-clip", c.name);
              e.dataTransfer.effectAllowed = "move";
            }}
            className={cn("bg-card relative cursor-grab overflow-hidden rounded-lg border text-[11px]", current === c.name && "border-brand", c.omit && "border-dashed")}
          >
            <button type="button" onClick={() => onOpen(c.name)} className="block w-full text-left" title={`${c.name}: click to show it on the timeline`}>
              <div className={cn("aspect-video bg-black bg-cover bg-center", c.omit && "opacity-30 grayscale")} style={{ backgroundImage: c.thumb ? `url(/api/files/${c.thumb})` : undefined }} />
              <div className={cn("p-1", c.omit && "opacity-60")}>
                <p className="truncate font-medium">
                  {i + 1}. {c.name}
                </p>
                <p className="text-muted-foreground">
                  {c.omit ? "omitted" : `${c.shots} shot${c.shots === 1 ? "" : "s"}`}
                  {c.inS !== null || c.outS !== null ? " · ✂" : ""}
                  {c.speed !== null && c.speed < 1 ? ` · ${c.speed}x` : ""}
                  {c.bestFrom === "clip editor" ? " · ★ yours" : ""}
                </p>
                {c.transitionNotes?.length ? (
                  <p className="text-muted-foreground mt-0.5 text-[10px] leading-tight" data-story-transition>
                    {c.transitionNotes.map((t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}.`).join(" ")}
                  </p>
                ) : null}
                {c.notIn ? (
                  <p className="mt-0.5 text-[10px] leading-tight text-amber-200" data-story-notin>
                    {c.notIn.charAt(0).toUpperCase() + c.notIn.slice(1)}.
                  </p>
                ) : null}
              </div>
            </button>
            <button
              type="button"
              data-story-omit={c.name}
              aria-pressed={c.omit}
              disabled={busy}
              onClick={() => onOmit(c.name, !c.omit)}
              title={c.omit ? "Omitted: not in the videos. Click to use it again." : "Used in the videos. Click to leave it out (it keeps its place)."}
              className={cn("absolute top-0.5 left-0.5 rounded px-1 py-0.5 text-[10px] font-medium", c.omit ? "bg-amber-400/90 text-black" : "bg-black/60")}
            >
              {c.omit ? "Omit" : "Use"}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Title cards that are on screen together (title, byline, tagline start at the same moment) go in their own thin lanes,
// so their labels stay readable; the row grows with the lanes (one lane = the row as before).
const TITLE_LANE_PX = 14;
function titleCardLanes(cards: readonly { startMs: number; endMs: number }[], x: (ms: number) => number): { lane: number[]; count: number } {
  const ends: number[] = []; // the right edge (px) each lane is used up to
  const lane = cards.map(() => 0);
  cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startMs - b.c.startMs || a.i - b.i)
    .forEach(({ c, i }) => {
      const left = x(c.startMs);
      let k = ends.findIndex((e) => e <= left + 0.5);
      if (k < 0) k = ends.length;
      ends[k] = left + Math.max(8, x(c.endMs - c.startMs) - 2) + 2;
      lane[i] = k;
    });
  return { lane, count: Math.max(1, ends.length) };
}
// On screen (11 Nov 2026): the byline is "artist", the tagline "credits" (the files keep byline / tagline).
const CARD_TYPE_LABELS: Record<string, string> = { title: "title", byline: "artist", tagline: "credits", hook: "Hook card", end: "End card" };
const TITLE_CARD_LABEL: Record<string, string> = { title: "Title", byline: "Artist", tagline: "Credits" };
const POSITION_LABELS: Record<string, string> = { lyrics: "the lyric spot", "with-title": "under the title", top: "top", upper: "upper", centre: "centre", lower: "lower", "upper-third": "upper third (title opening)", "lower-third": "lower third (title opening)" };

// A card's own look: place, size, hold, effect (and, for title / byline / tagline, its text and whether
// it is shown). The preview shows lyric cards at once; Save keeps them in textboard.json.
function CardEditor({ card, role, draft, setDraft, busy, onSave, onReset, onClose, onFixLine, fonts, titleFont, artist, planned, titleBase, frameWidth }: {
  planned?: TextCardProps | null;
  titleBase?: number;
  frameWidth?: number;
  onFixLine: (number: number, text: string) => void;
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
  const goToTab = useGoToTab();
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
  const [words, setWords] = useState(card.text); // a lyric line's words (fixed in lyrics.txt, timing kept)
  useEffect(() => setWords(card.text), [card.text]);
  const wordsChanged = words.replace(/\s+/g, " ").trim() !== card.text && !!words.trim();
  return (
    <div className="bg-card rounded-lg border p-3 text-xs" data-card-editor={card.id}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-medium">
          {lyric ? `Line ${card.line}` : (TITLE_CARD_LABEL[card.type] ?? card.type)}: <span className="font-normal">&quot;{draft.text ?? card.text}&quot;</span>
        </p>
        {Object.keys(role).length ? <span className="text-muted-foreground">({lyric ? (card.isHook ? "hook" : "verse") : card.type} rule: {Object.entries(role).map(([k, v]) => `${k} ${String(v)}`).join(", ")})</span> : null}
        <button type="button" onClick={onClose} aria-label="close the card editor" className="text-muted-foreground hover:text-foreground ml-auto rounded p-1">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-2">
        {lyric && card.line !== undefined ? (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <span className="w-20">Text</span>
              <input
                data-line-text
                className={cn(field, "flex-1")}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && wordsChanged && !busy) onFixLine(card.line!, words);
                }}
              />
              <Button size="sm" variant="outline" data-line-fix disabled={busy || !wordsChanged} onClick={() => onFixLine(card.line!, words)}>
                Fix
              </Button>
            </label>
            <span className="text-muted-foreground pl-[5.5rem]">Fixes the words in the song&apos;s lyrics (every platform, the captions); the timing stays.</span>
          </div>
        ) : null}
        {!lyric ? (
          <>
            {/* 11 Nov 2026: the words are changed in one place, Prepare → Song Details (read-only here). */}
            <div className="flex items-center gap-2" data-card-text-readonly>
              <span className="w-20">Text</span>
              <span className="text-foreground min-w-0 flex-1 truncate" title={draft.text ?? card.text}>
                {(draft.text ?? card.text) || "(empty)"}
              </span>
              <button type="button" data-card-text-link onClick={() => goToTab("details")} className="text-muted-foreground hover:text-foreground shrink-0 underline underline-offset-2">
                change in Song Details
              </button>
            </div>
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
          {!lyric && planned ? (
            <SizeField planned={planned} titleBase={titleBase} frameWidth={frameWidth ?? 1080} mult={draft.size ?? role.size ?? 1} onMult={(m) => set("size", m)} />
          ) : (
            <>
              <input data-card-size type="range" min={0.5} max={lyric ? 2 : TITLE_SIZE_RANGE[1]} step={0.05} value={draft.size ?? role.size ?? 1} onChange={(e) => set("size", Number(e.target.value))} className="accent-brand flex-1" />
              <span className="w-10 tabular-nums">{(draft.size ?? role.size ?? 1).toFixed(2)}x</span>
            </>
          )}
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">Hold (s)</span>
          <input data-card-hold type="number" min={0} max={10} step={0.5} className={cn(field, "w-20")} value={draft.hold ?? ""} placeholder={lyric ? "as sung" : "as the platform"} onChange={(e) => set("hold", e.target.value === "" ? undefined : Number(e.target.value))} />
          <span className="text-muted-foreground">{lyric ? "at least this long after its last word (never into the next line)" : "on screen from the start"}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">Font</span>
          <select data-card-font className={field} value={draft.font ?? ""} onChange={(e) => set("font", e.target.value || undefined)}>
            <option value="">{role.font ? `the rule (${role.font})` : lyric ? "the theme's" : `the brand's title font (${titleFont})`}</option>
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
            <option value="">{role.effect ? `the rule (${role.effect})` : lyric ? "the theme's" : "fade (as before)"}</option>
            {EFFECT_NAMES.map((n) => (
              <option key={n} value={n}>
                {effectTitle(n)}
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
      {!lyric ? (
        // Title cards (11 Nov 2026): their own colour, transparency and capitals.
        <div className="mt-2 grid gap-2">
          <label className="flex items-center gap-2">
            <span className="w-20">Colour</span>
            <input data-card-colour type="color" value={draft.colour ?? (card.type === "title" ? "#E8A3B5" : "#FFFFFF")} onChange={(e) => set("colour", e.target.value.toUpperCase())} className="h-7 w-10 rounded border" />
            {draft.colour ? (
              <button type="button" data-card-colour-reset onClick={() => set("colour", undefined)} className="text-muted-foreground hover:text-foreground underline underline-offset-2">
                as the theme
              </button>
            ) : (
              <span className="text-muted-foreground">as the theme</span>
            )}
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Transparency</span>
            <input data-card-opacity type="range" min={0.2} max={1} step={0.05} value={draft.opacity ?? (card.type === "tagline" ? 0.8 : card.type === "byline" ? 0.85 : 1)} onChange={(e) => set("opacity", Number(e.target.value))} className="accent-brand flex-1" />
            <span className="w-10 tabular-nums">{Math.round((draft.opacity ?? (card.type === "tagline" ? 0.8 : card.type === "byline" ? 0.85 : 1)) * 100)}%</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Capitals</span>
            <select data-card-upper className={field} value={draft.upper === undefined ? "" : String(draft.upper)} onChange={(e) => set("upper", e.target.value === "" ? undefined : e.target.value === "true")}>
              <option value="">{card.type === "title" ? "as the platform (capitals)" : "as written"}</option>
              <option value="true">ALL CAPITALS</option>
              <option value="false">as written</option>
            </select>
          </label>
        </div>
      ) : null}
      <p className="text-muted-foreground mt-2">
        {lyric ? "The preview shows the change at once (its timing comes from the lyric alignment). " : "The viewer shows it at once and it is saved as you change it (a new font shows once saved). "}
        Places stay inside the platform&apos;s safe area.
      </p>
      <div className="mt-2 flex gap-2">
        {lyric ? (
          <Button size="sm" data-card-save disabled={busy || !changed} onClick={onSave}>
            {busy ? <Loader2 className="animate-spin" /> : null} Save and plan again
          </Button>
        ) : busy ? (
          <span data-card-saving className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="size-3.5 animate-spin" /> saving…
          </span>
        ) : null}
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
        Text layout{board.file ? "" : " (as the theme sets it)"}
        {board.template ? ` · "${board.template}"` : ""} · {board.cards.filter((c) => Object.keys(c.overrides).length).length} card(s) changed
      </span>
      {(["title", "byline", "tagline"] as const).map((t) => (
        <button key={t} type="button" data-open-card={t} onClick={() => onOpen(t)} className="hover:bg-accent rounded-md border px-2 py-0.5">
          <Type className="mr-1 inline size-3" />
          {t}
        </button>
      ))}
      <input data-template-name className={cn(field, "w-36")} value={name} placeholder="layout name" onChange={(e) => setName(e.target.value)} />
      <Button size="sm" variant="outline" data-template-save disabled={busy || !name.trim()} onClick={() => onEdit({ action: "save-template", name })}>
        Save this layout
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
            Use this layout
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">no saved text layouts for {board.artist} yet</span>
      )}
      {board.orphans.length ? (
        <span className="text-amber-200" data-textboard-orphans>
          Not used any more (their words changed): {board.orphans.map((o) => `${o.id} "${o.text}"`).join(", ")}
        </span>
      ) : null}
    </div>
  );
}

// The viewer's height: the screen's height minus what sits above the viewer (the song header, the stage line, the video's
// lines) and under it (the timeline and the command bar), measured, so a row added later never shrinks it unnoticed
// (2 Nov 2026: the fixed 36rem reserve had left the viewer at its 260 px minimum). A free margin stays under the command
// bar, so the transport is never at the very bottom of the screen. Between VIEWER_MIN and VIEWER_MAX; null until measured.
const BOTTOM_ROOM = 18; // 56 px until 2 Nov 2026 evening: the user asked for the bottom block about 1 cm lower
function useViewerHeight(block: RefObject<HTMLDivElement | null>, below: RefObject<HTMLDivElement | null>, layout: string): number | null {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = block.current;
      if (!el) return;
      // The top of the viewer on the page, not on the screen: scrolling must not change the size.
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const top = el.getBoundingClientRect().top + (scroller ? scroller.scrollTop : window.scrollY);
      const under = below.current ? below.current.getBoundingClientRect().height + 12 : 0; // + the gap between the rows
      const next = Math.max(VIEWER_MIN, Math.min(VIEWER_MAX, Math.floor(window.innerHeight - top - under - BOTTOM_ROOM)));
      setH((old) => (old !== null && Math.abs(old - next) < 2 ? old : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (below.current) ro.observe(below.current);
    if (block.current?.parentElement) ro.observe(block.current.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [block, below, layout]); // measured again when the rows change (a plan arrives, a panel opens) and on every resize
  return h;
}

// One section of the Analysis panel: a small heading and its facts.
function AnalysisSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5" data-analysis-section={title}>
      <h3 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{title}</h3>
      {children}
    </section>
  );
}

// The song header's slot for the Analysis chip: found in the page once rendered (none while the server renders).
const noSubscribe = () => () => {};
const findHeaderSlot = () => document.getElementById("song-header-actions");
const noHeaderSlot = () => null;

// The Look section's slot for the title cards (ShapeTools draws it; it comes and goes as Look opens and closes): watched,
// so the board draws its title-card editor there as soon as the slot is on the page.
function useTitleCardsSlot(): Element | null {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    const find = () => setSlot(document.querySelector("[data-title-cards-slot]"));
    find();
    const watch = new MutationObserver(find);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return slot;
}

const TITLE_CARD_IDS = new Set(["title", "byline", "tagline"]);
const TITLE_DEFAULT_PLACE: Record<string, string> = { title: "upper third", byline: "under the title", tagline: "under the title" };
// A title card's look in one line (Settings → Look → Title cards): font · colour / transparency · place · capitals, as
// the planned video draws it (or "not shown in this video").
function titleCardSummary(c: TextCard, drawn: { font: string; colour: string; opacity?: number; upper: boolean } | null, role: CardStyle): string {
  if (!drawn) return "not shown in this video";
  const position = c.overrides.position ?? role.position;
  const place = position ? (POSITION_LABELS[position] ?? position) : (TITLE_DEFAULT_PLACE[c.type] ?? "as the platform");
  return [drawn.font, `${drawn.colour.toUpperCase()} ${Math.round((drawn.opacity ?? 1) * 100)}%`, place, drawn.upper ? "CAPITALS" : "as written"].join(" · ");
}

// A title card's size as a number (12 Nov 2026, asked by the user): px at the video's size with − / + and typing, up to
// twice the title's usual size; stored as today's multiplier. Under the readable size: a warning, never a block.
function SizeField({ planned, titleBase, frameWidth, mult, onMult, compact = false }: { planned: TextCardProps; titleBase?: number; frameWidth: number; mult: number; onMult: (m: number) => void; compact?: boolean }) {
  const s = titleCardSize(planned, mult, titleBase);
  const [typed, setTyped] = useState<string | null>(null); // while typing; else the size itself
  const text = typed ?? String(s.px);
  const commit = (px: number) => {
    setTyped(null);
    if (!Number.isFinite(px) || px <= 0) return;
    const m = titleCardMult(px, s.base, s.max);
    if (m !== mult) onMult(m);
  };
  const warn = readableWarning(s.px, frameWidth);
  const btn = "hover:bg-accent flex size-6 items-center justify-center rounded-md border text-sm disabled:opacity-40";
  return (
    <span data-card-size-field className={cn("flex items-center gap-1", !compact && "flex-1 flex-wrap")}>
      <button type="button" data-card-size-minus className={btn} disabled={s.px <= s.min} onClick={() => commit(s.px - 2)} aria-label="Smaller">
        −
      </button>
      <input
        data-card-size-px
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => setTyped(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(Number(text));
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            commit(s.px + (e.key === "ArrowUp" ? 1 : -1));
          }
        }}
        className="bg-input/30 border-input h-6 w-12 rounded-md border px-1 text-center text-xs tabular-nums"
        aria-label="Size in px"
        title={`${s.min}-${s.max} px at the video's size (the usual ${s.base} px)`}
      />
      <button type="button" data-card-size-plus className={btn} disabled={s.px >= s.max} onClick={() => commit(s.px + 2)} aria-label="Larger">
        +
      </button>
      <span className="text-muted-foreground text-[11px]">px</span>
      {warn ? (
        compact ? (
          <AlertTriangle data-card-size-warn className="size-3.5 text-amber-300" aria-label={warn}>
            <title>{warn}</title>
          </AlertTriangle>
        ) : (
          <span data-card-size-warn className="text-[11px] text-amber-300">{warn}</span>
        )
      ) : !compact ? (
        <span className="text-muted-foreground text-[11px]">usual {s.base} px · up to {s.max}</span>
      ) : null}
    </span>
  );
}

// The floating toolbar above the video (12 Nov 2026, Canva-like): the selected title card's font, size, colour,
// transparency and capitals, the same draft as the editor in Look → Advanced (shown at once, saved as changed).
function TitleCardToolbar({ card, planned, plannedSize, titleBase, frameWidth, draft, setDraft, fonts, titleFont, onClose }: {
  card: TextCard;
  planned: TextCardProps; // as the viewer draws it now (colour, transparency, capitals)
  plannedSize: TextCardProps; // as planned (its usual size)
  titleBase?: number;
  frameWidth: number;
  draft: CardOverrides;
  setDraft: (d: CardOverrides) => void;
  fonts: string[];
  titleFont: string;
  onClose: () => void;
}) {
  const set = <K extends keyof CardOverrides>(k: K, v: CardOverrides[K] | undefined) => {
    const next = { ...draft };
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    setDraft(next);
  };
  const field = "bg-input/30 border-input h-7 rounded-md border px-1.5 text-xs";
  const opacity = draft.opacity ?? planned.opacity ?? 1;
  const upper = draft.upper ?? planned.upper;
  return (
    <div data-card-toolbar={card.id} className="bg-card flex max-w-full flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs shadow-lg">
      <span className="text-muted-foreground text-[11px] font-medium uppercase">{TITLE_CARD_LABEL[card.type] ?? card.type}</span>
      <select data-toolbar-font className={cn(field, "max-w-40")} value={draft.font ?? ""} onChange={(e) => set("font", e.target.value || undefined)} title="Font (shows once saved)">
        <option value="">{titleFont ? `${planned.font || titleFont} (theme)` : "the theme's"}</option>
        {fonts.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <SizeField compact planned={plannedSize} titleBase={titleBase} frameWidth={frameWidth} mult={draft.size ?? 1} onMult={(m) => set("size", m)} />
      <input data-toolbar-colour type="color" value={(draft.colour ?? planned.colour).slice(0, 7)} onChange={(e) => set("colour", e.target.value.toUpperCase())} className="h-7 w-8 rounded border" title="Colour" />
      <input data-toolbar-opacity type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => set("opacity", Number(e.target.value))} className="accent-brand w-20" title={`Transparency: ${Math.round(opacity * 100)}%`} />
      <button type="button" data-toolbar-upper aria-pressed={upper} onClick={() => set("upper", !upper)} className={cn("h-7 rounded-md border px-2 font-medium", upper ? "bg-brand/20 border-brand" : "hover:bg-accent")} title={upper ? "ALL CAPITALS: click for as written" : "As written: click for ALL CAPITALS"}>
        {upper ? "AA" : "Aa"}
      </button>
      <button type="button" data-toolbar-close onClick={onClose} className="hover:bg-accent rounded-md p-1" aria-label="Done (Esc)" title="Done (Esc)">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
