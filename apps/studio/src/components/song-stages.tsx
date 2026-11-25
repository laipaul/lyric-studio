"use client";

import { FolderOpen, ChevronRight, Clapperboard, Eye, Image as ImageIcon, Info, Send, SlidersHorizontal, SwatchBook, Type, Film, Loader2, type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

import type { TodoItem } from "@lyric/video/song-stages";

import { SongStyleChip } from "@/components/song-style";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FEATURE, FeatureIcon, PlatformMark } from "@/lib/feature-icons";
import { chooseReviewPlatform, OPEN_TAB_COOKIE, OPEN_TAB_MAX_AGE } from "@/lib/opening-tab";
import { cn } from "@/lib/utils";
import { openTasks, useRunningTakes } from "@/lib/tasks-state";

// The four stages of a song (Prepare -> Shape -> Make -> Review) over the existing tabs: a stage
// shows only its own tabs; the Prepare stage lists what still needs the user's ears or eyes.
// N1 (9 Nov 2026): every setting lives in the stage where it is looked for; the rail holds the four stages only
// (numbered) and each stage's sections are tabs inside it. Prepare = what the user provides (files, lyrics and
// timing with the tempo, the song's details and card texts, clips and collections); Shape = how the video is
// planned and looks; Make = what gets produced.
export const STAGES = [
  { id: "prepare", name: "Prepare", tabs: ["assets", "lyrics", "details", "clips", "production"] },
  { id: "shape", name: "Shape", tabs: ["shape"] },
  { id: "make", name: "Make", tabs: ["generate"] },
  { id: "review", name: "Review", tabs: ["videos", "post"] },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = { text: string; tone: "done" | "todo" | "blocked" | "muted" | "busy" };

// Prepare (11 Nov 2026): Assets · Lyrics Sync · Song Details · Storyboard; Creation (id "production"; 21 Nov 2026, first called Pictures: the creation space for pictures, videos and Animate, then the optional story tools). The ids stay ("assets", "lyrics", "details", "clips")
// so every old link opens the right tab; ?tab=storyboard still means Shape (links from before 31 Oct).
const TAB_LABEL: Record<string, string> = { assets: "Assets", lyrics: "Lyrics Sync", details: "Song Details", clips: "Storyboard", production: "Creation", shape: "Shape", generate: "Make", videos: "Videos", post: "Post" };
const stageOf = (tab: string): StageId => STAGES.find((s) => (s.tabs as readonly string[]).includes(tab))?.id ?? "prepare";
const TONE: Record<StageStatus["tone"], string> = {
  done: "text-emerald-300",
  todo: "text-amber-200",
  blocked: "text-red-300",
  muted: "text-muted-foreground",
  busy: "text-brand animate-pulse",
};

// Lets a tab move to another one ("Next: Make →" on the Shape page).
const GoToTab = createContext<(tab: string) => void>(() => {});
export const useGoToTab = () => useContext(GoToTab);

// Shape's tabs (N1): each opens one panel beside the viewer; a second click closes it (the editor takes the whole
// width). Look = the Look bar (theme, Change) and this song's look settings; Part & ending = which part of the song
// and how it ends; Pace = shot length, transitions, pace; Shots = the clips of the video and the shot clicked on the
// timeline. Not tabs: "text" (a lyric line or card clicked), "analysis" (the header's chip) and "theme" (the theme
// editor, opened from Look → Edit theme or the Themes page; it moves to Themes with or after 2i).
// 11 Nov 2026: two tabs, Settings | Shots. Settings = one scrolling panel: "Set by me" (what the user changed), then
// the sections Look (theme + Change, title opening, lyric readability), Part & ending and Pace, each folding (▸).
// "look" / "part" / "pace" (the tabs before) still open: Settings, with that section open and scrolled to.
export const SHAPE_PANELS = [
  { id: "settings", label: "Settings", icon: SlidersHorizontal, colour: "" },
  { id: "shots", label: "Shots", icon: Film, colour: FEATURE.clips.colour },
] as const;
export const SETTINGS_SECTIONS = ["look", "part", "pace"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (p: string | null | undefined): p is SettingsSection => SETTINGS_SECTIONS.some((s) => s === p);
export type ShapeTabId = (typeof SHAPE_PANELS)[number]["id"];
const isShapeTab = (p: string | null | undefined): p is ShapeTabId => SHAPE_PANELS.some((m) => m.id === p);
export type ShapePanelId = ShapeTabId | SettingsSection | "theme" | "text" | "analysis"; // analysis: the header's Analysis chip (2 Nov 2026)
// Old panel names (links from before N1) -> where that content is now.
export const OLD_SHAPE_PANELS: Record<string, ShapePanelId> = { clips: "shots", shot: "shots", auto: "part" };
// N1 polish (10 Nov 2026): one Shape tab is always selected and its panel always shows beside the viewer; the panel can
// only be collapsed (the button on its edge), never closed to "no tab". panel = what the panel shows: the tab, or for a
// moment Text (a lyric line or card clicked), Theme (the theme editor) or Analysis; setPanel(null) goes back to the tab.
// focus: a Settings section asked for (an old link, "Look: …" in Make): opened and scrolled to (n: each ask anew).
type PanelState = { panel: ShapePanelId; setPanel: (p: ShapePanelId | null) => void; tab: ShapeTabId; collapsed: boolean; setCollapsed: (c: boolean) => void; focus: { section: SettingsSection; n: number } | null };
const ShapePanel = createContext<PanelState>({ panel: "settings", setPanel: () => {}, tab: "settings", collapsed: false, setCollapsed: () => {}, focus: null });
export const useShapePanel = () => useContext(ShapePanel);
// Make's tabs (N1): one form, three parts. Videos = the release pack, the song's platforms and Generate; Try other
// looks = another theme for one run, compare themes, picture versions; Options = the rarely needed ones.
// Make's tabs (11 Nov 2026): Make (the song's platforms and versions) and Compare looks; each has its own button.
export const MAKE_PARTS = [
  { id: "videos", label: "Make", icon: Clapperboard },
  { id: "looks", label: "Compare looks", icon: SwatchBook },
] as const;
export type MakePart = (typeof MAKE_PARTS)[number]["id"];
const MakePartCtx = createContext<{ part: MakePart; setPart: (p: MakePart) => void }>({ part: "videos", setPart: () => {} });
export const useMakePart = () => useContext(MakePartCtx);
// The video Shape shows (its platform), so a panel shows only the settings that apply to it (N1): title opening and
// ending for Reels / TikTok / Shorts, YouTube layout for YouTube. null: no video chosen yet (everything shows).
const VideoCtx = createContext<{ platform: string | null; setPlatform: (p: string | null) => void }>({ platform: null, setPlatform: () => {} });
export const useShapeVideo = () => useContext(VideoCtx);
// Review's tabs (11 Nov 2026): one per platform with videos (or being made), then Post. The platform chosen; null: the first.
export type ReviewPlatform = { name: string; label: string; count: number };
const ReviewCtx = createContext<{ platform: string | null; setPlatform: (p: string) => void }>({ platform: null, setPlatform: () => {} });
export const useReviewPlatform = () => useContext(ReviewCtx);

// Theme editing mode (1 Nov 2026): while a theme is being edited the song page wears a pink frame and a
// banner "Editing theme X · changes reach …" with Done. The Theme panel (shape-tools) reports it here.
export type ThemeMode = { name: string; reach: string; shared: boolean; changed: boolean; done: () => void };
const ThemeModeCtx = createContext<(m: ThemeMode | null) => void>(() => {});
export const useSetThemeMode = () => useContext(ThemeModeCtx);
// The song's theme as the Theme panel knows it, for the "Look · Content" line at the top of Shape.
export type ThemeNow = { name: string; users: string[]; song: string };
const ThemeNowCtx = createContext<(t: ThemeNow | null) => void>(() => {});
export const useSetThemeNow = () => useContext(ThemeNowCtx);
// The same theme, read by the Shape page's Analysis panel (its "Look & content" section, 2 Nov 2026), with the way to open it.
const ThemeLookCtx = createContext<{ themeNow: ThemeNow | null; openTheme: () => void }>({ themeNow: null, openTheme: () => {} });
export const useThemeLook = () => useContext(ThemeLookCtx);
// Shape's status for the stage line ("Shape · Reels v1 planned"), reported by the Shape board; null: the page's own.
const ShapeStatusCtx = createContext<(s: StageStatus | null) => void>(() => {});
export const useSetShapeStatus = () => useContext(ShapeStatusCtx);

// The last tab of each stage, remembered in this browser (N1 polish): a stage opens on it, else on its first tab.
const LAST_TAB_KEY = (stage: StageId) => `lyric-studio:last-tab:${stage}`;
function lastTab(stage: StageId): string | null {
  try {
    return window.localStorage.getItem(LAST_TAB_KEY(stage));
  } catch {
    return null; // no browser storage: the first tab
  }
}
// The review platform is remembered per song (25 Nov 2026; before, one key for every song).
const REVIEW_KEY = (projectId?: string) => (projectId ? `lyric-studio:last-tab:review:${projectId}` : LAST_TAB_KEY("review"));
// The tab last used for this song, in a cookie, so the server opens the page on it with no flash (25 Nov 2026).
function rememberSongTab(projectId: string | undefined, tab: string) {
  if (!projectId) return;
  try {
    document.cookie = `${OPEN_TAB_COOKIE(projectId)}=${encodeURIComponent(tab)}; path=/; max-age=${OPEN_TAB_MAX_AGE}; SameSite=Lax`;
  } catch {
    // not remembered
  }
}
function rememberTab(stage: StageId, tab: string) {
  try {
    window.localStorage.setItem(LAST_TAB_KEY(stage), tab);
  } catch {
    // not remembered
  }
}

// The feature icons (lib/feature-icons.tsx): one icon per step, the same everywhere.
const STAGE_ICON = { prepare: FEATURE.prepare.icon, shape: FEATURE.shape.icon, make: FEATURE.make.icon, review: FEATURE.review.icon } as const;
// One distinct icon per tab (N1 polish): Assets, Lyrics Sync, Song Details and Storyboard each their own.
const TAB_ICON: Record<string, { icon: LucideIcon; colour: string }> = {
  assets: { icon: FolderOpen, colour: "" },
  lyrics: { icon: Type, colour: FEATURE.lyrics.colour },
  details: { icon: Info, colour: "" },
  clips: { icon: Film, colour: FEATURE.clips.colour },
  production: { icon: ImageIcon, colour: "" },
  videos: { icon: Eye, colour: "" },
  post: { icon: Send, colour: "" },
};
// The selected stage and tab, the same in all four stages (10 Nov 2026): the app's pink accent (as on the play button),
// never green or yellow (those mean ready / needs attention). Tabs: a pink underline and bold text; the others grey.
// Contrast on the dark theme: pink on the page 9.7:1, on the rail's pink tint 7.3:1; dimmed stage labels 4.9:1.
const TAB_LIST = "border-border flex h-9 w-fit items-stretch gap-1 border-b";
const TAB = "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors";
const TAB_ON = "border-brand text-foreground font-semibold";
const TAB_OFF = "text-muted-foreground hover:text-foreground border-transparent font-medium";
// shadcn's TabsTrigger (Prepare, Review) brought to the same look: no pill, no shadow, the underline instead.
const TRIGGER = cn(
  TAB,
  "h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent py-0 shadow-none",
  "text-muted-foreground hover:text-foreground dark:text-muted-foreground font-medium",
  "data-[state=active]:border-brand data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:shadow-none",
  "dark:data-[state=active]:border-brand dark:data-[state=active]:text-foreground dark:data-[state=active]:bg-transparent",
);

// The stages whose settings are saved as they change: said once, in the stage line (not in every panel).
const SAVED_AT_ONCE: readonly StageId[] = ["prepare", "shape", "make"];
const DOT: Record<StageStatus["tone"], string> = { done: "bg-emerald-400", todo: "bg-amber-300", blocked: "bg-red-400", muted: "bg-transparent", busy: "bg-brand animate-pulse" };

// The song page as a Canva-style workspace: a narrow icon rail on the left with the four stages (a dot
// for each stage's status; the status in words as its tooltip and at the top of the work area) and, under
// Shape when it is open, the Shape menus; the work area fills the rest. A stage with several tabs shows
// them at the top of its work area; Prepare lists what still needs the user's ears or eyes.
export function SongStages({
  initialTab,
  initialPanel,
  initialPart,
  statuses,
  todo,
  counts,
  reviewPlatforms = [],
  projectId,
  children,
}: {
  initialTab: string;
  initialPanel?: ShapePanelId | null; // ?panel= (e.g. the Themes page's Edit opens Shape → Theme)
  initialPart?: MakePart; // Make's tab (?part=)
  statuses: Record<StageId, StageStatus>;
  todo: TodoItem[];
  counts: Partial<Record<string, number>>; // a number next to a tab (Post: approved videos)
  reviewPlatforms?: ReviewPlatform[]; // Review's platform tabs (with videos, or being made), in the song's order
  projectId?: string; // the song (the running-task badge on Creation and Lyrics Sync)
  children: React.ReactNode; // the TabsContent of every tab
}) {
  const [tab, setTabRaw] = useState(initialTab);
  const setTabState = (t: string) => {
    setTabRaw(t);
    rememberSongTab(projectId, t); // every change of the active tab
  };
  const singing = useRunningTakes(projectId, "singing"); // singing clips being made for this song (the Tasks menu's list)
  // Shape: the tab (always one), what its panel shows for a moment (Text, Theme, Analysis) and whether it is collapsed.
  const [shapeTab, setShapeTab] = useState<ShapeTabId>(isShapeTab(initialPanel) ? initialPanel : "settings");
  const [overlay, setOverlay] = useState<ShapePanelId | null>(initialPanel && !isShapeTab(initialPanel) && !isSettingsSection(initialPanel) ? initialPanel : null);
  const [focus, setFocus] = useState<PanelState["focus"]>(isSettingsSection(initialPanel) ? { section: initialPanel, n: 1 } : null);
  const [collapsed, setCollapsed] = useState(false);
  const [part, setPartState] = useState<MakePart>(initialPart ?? "videos");
  const [platform, setPlatform] = useState<string | null>(null);
  const [reviewPlatform, setReviewPlatformState] = useState<string | null>(null); // clicked now: always shown
  const [reviewRemembered, setReviewRemembered] = useState<string | null>(null); // from this song's last visit
  const setReviewPlatform = (p: string) => {
    setReviewPlatformState(p);
    try {
      window.localStorage.setItem(REVIEW_KEY(projectId), `videos:${p}`);
    } catch {
      // not remembered
    }
  };
  // A remembered platform with no videos left does not show an empty page: the first platform with videos does.
  const reviewShown = reviewPlatforms.find((r) => r.name === reviewPlatform)?.name ?? chooseReviewPlatform(reviewRemembered, reviewPlatforms);
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  const [themeNow, setThemeNow] = useState<ThemeNow | null>(null);
  const [shapeStatus, setShapeStatus] = useState<StageStatus | null>(null);
  const stage = stageOf(tab);
  const current = STAGES.find((s) => s.id === stage)!;
  // Remember the tab chosen in each stage (Shape: its tab; Make: its part).
  const setTab = (t: string) => {
    setTabState(t);
    if (stageOf(t) !== "shape" && stageOf(t) !== "make") rememberTab(stageOf(t), t);
  };
  const setPart = (p: MakePart) => {
    setPartState(p);
    rememberTab("make", p);
  };
  const setPanel = (p: ShapePanelId | null) => {
    setCollapsed(false);
    if (p === null) return setOverlay(null); // back to the tab
    if (isSettingsSection(p)) {
      const section = p;
      setFocus((f) => ({ section, n: (f?.n ?? 0) + 1 }));
      p = "settings";
    }
    if (isShapeTab(p)) {
      setShapeTab(p);
      setOverlay(null);
      rememberTab("shape", p);
    } else setOverlay(p);
  };
  const panel: ShapePanelId = overlay ?? shapeTab;
  // A stage opened without a tab in the link: its last tab (read after the first paint: browser storage only).
  useEffect(() => {
    const shapeLast = lastTab("shape");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read after hydration on purpose
    if (!initialPanel && isShapeTab(shapeLast)) setShapeTab(shapeLast);
    else if (!initialPanel && isSettingsSection(shapeLast)) setShapeTab("settings"); // remembered before Settings | Shots
    const makeLast = lastTab("make");
    if (!initialPart && MAKE_PARTS.some((m) => m.id === makeLast)) setPartState(makeLast as MakePart);
    let reviewLast: string | null = null;
    try {
      reviewLast = window.localStorage.getItem(REVIEW_KEY(projectId));
    } catch {
      // no browser storage
    }
    if (reviewLast?.startsWith("videos:")) setReviewRemembered(reviewLast.slice(7));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openStage = (s: (typeof STAGES)[number]) => {
    const last = s.id === "review" ? (lastTab(s.id)?.replace(/^videos:.*/, "videos") ?? null) : lastTab(s.id);
    setTabState(last && (s.tabs as readonly string[]).includes(last) ? last : s.tabs[0]);
  };
  // "theme X" (Analysis): Shape → Look, where the song's theme is shown and changed.
  const openTheme = () => {
    setTabState("shape");
    setPanel("look");
  };
  const status = stage === "shape" && shapeStatus ? shapeStatus : statuses[stage];
  return (
    <GoToTab.Provider value={setTab}>
      <ShapePanel.Provider value={{ panel, setPanel, tab: shapeTab, collapsed, setCollapsed, focus }}>
        <MakePartCtx.Provider value={{ part, setPart }}>
        <ReviewCtx.Provider value={{ platform: reviewShown, setPlatform: setReviewPlatform }}>
        <VideoCtx.Provider value={{ platform, setPlatform }}>
        <ThemeModeCtx.Provider value={setThemeMode}>
        <ThemeNowCtx.Provider value={setThemeNow}>
        <ThemeLookCtx.Provider value={{ themeNow, openTheme }}>
        <ShapeStatusCtx.Provider value={setShapeStatus}>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-row gap-0">
          <nav aria-label="Stages" data-stages data-rail className="bg-card/40 sticky top-0 flex max-h-[calc(100vh-3.5rem)] w-[76px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r px-1.5 py-2">
            {STAGES.map((s, i) => {
              const Icon = STAGE_ICON[s.id];
              return (
                <div key={s.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    data-stage={s.id}
                    aria-current={stage === s.id ? "step" : undefined}
                    title={`${i + 1}. ${s.name}: ${(s.id === "shape" && shapeStatus ? shapeStatus : statuses[s.id]).text}`}
                    onClick={() => openStage(s)}
                    className={cn(
                      "relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-tight",
                      stage === s.id
                        ? "bg-brand/15 text-brand font-semibold before:bg-brand before:absolute before:inset-y-1.5 before:-left-1.5 before:w-1 before:rounded-r"
                        : "text-muted-foreground/80 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span data-stage-number className="text-muted-foreground absolute top-1 left-1.5 text-[10px] font-semibold tabular-nums">{i + 1}</span>
                    <Icon className={cn("size-5", stage === s.id && "text-brand")} />
                    {s.name}
                    <span className={cn("absolute top-1.5 right-2 size-2 rounded-full", DOT[statuses[s.id].tone])} aria-hidden />
                    <span data-stage-status className="sr-only">
                      {statuses[s.id].text}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>

          <div className={cn("flex min-w-0 flex-1 flex-col gap-4 px-4 py-3", stage !== "shape" && "max-w-7xl", themeMode && "ring-brand rounded-lg ring-2 ring-inset")} data-work-area data-theme-mode={themeMode ? themeMode.name : undefined}>
            {/* The same header on every stage (N1 polish): the stage's tabs (one always selected, each with its own icon) and,
                on the same row, "<Stage> · <status>" and once per stage that every change is saved at once. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-stage-header>
            {stage === "shape" ? (
              <div role="tablist" aria-label="Shape" data-shape-tabs className={TAB_LIST}>
                {SHAPE_PANELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    data-shape-tab={m.id}
                    aria-selected={shapeTab === m.id}
                    onClick={() => setPanel(m.id)}
                    className={cn(TAB, shapeTab === m.id ? TAB_ON : TAB_OFF)}
                  >
                    <m.icon aria-hidden className={cn("size-3.5", m.colour)} />
                    {m.label}
                  </button>
                ))}
              </div>
            ) : stage === "review" ? (
              // Review: one tab per platform with videos (count = the ones not discarded), then Post.
              <div role="tablist" aria-label="Review" data-review-tabs className={TAB_LIST}>
                {(reviewPlatforms.length ? reviewPlatforms : [{ name: "", label: "Videos", count: 0 }]).map((r) => {
                  const on = tab === "videos" && (r.name === "" || reviewShown === r.name);
                  return (
                    <button key={r.name || "videos"} type="button" role="tab" data-review-tab={r.name || "videos"} aria-selected={on} onClick={() => (setTab("videos"), r.name && setReviewPlatform(r.name))} className={cn(TAB, on ? TAB_ON : TAB_OFF)}>
                      {r.name ? <PlatformMark platform={r.name} /> : <Eye aria-hidden className="size-3.5" />}
                      {r.label}
                      {r.count ? <span className="text-muted-foreground tabular-nums">{r.count}</span> : null}
                    </button>
                  );
                })}
                <button type="button" role="tab" data-review-tab="post" aria-selected={tab === "post"} onClick={() => setTab("post")} className={cn(TAB, tab === "post" ? TAB_ON : TAB_OFF)}>
                  <Send aria-hidden className="size-3.5" />
                  Post
                  {counts.post ? <span className="text-muted-foreground tabular-nums">{counts.post}</span> : null}
                </button>
              </div>
            ) : stage === "make" ? (
              <div role="tablist" aria-label="Make" data-make-tabs className={TAB_LIST}>
                {MAKE_PARTS.map((m) => (
                  <button key={m.id} type="button" role="tab" data-make-tab={m.id} aria-selected={part === m.id} onClick={() => setPart(m.id)} className={cn(TAB, part === m.id ? TAB_ON : TAB_OFF)}>
                    <m.icon aria-hidden className="size-3.5" />
                    {m.label}
                  </button>
                ))}
              </div>
            ) : (
              <TabsList className={cn(TAB_LIST, "bg-transparent rounded-none p-0 justify-start")}>
                {current.tabs.map((t) => {
                  const { icon: Icon, colour } = TAB_ICON[t];
                  return (
                    <TabsTrigger key={t} value={t} className={TRIGGER} data-stage-tab={t}>
                      <Icon aria-hidden className={cn("size-3.5", colour)} />
                      {TAB_LABEL[t]}
                      {counts[t] ? <span className="text-muted-foreground ml-1.5 tabular-nums">{counts[t]}</span> : null}
                      {singing && (t === "lyrics" || t === "production") ? <RunningBadge count={singing} /> : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            )}
              <p className="text-muted-foreground ml-auto flex flex-col items-end text-right text-xs" data-work-status={stage}>
                {/* The stage line is the page's title: a size up from the rest (10 Nov 2026). */}
                <span className="text-sm leading-5">
                  <span className="text-foreground text-base leading-5 font-semibold">{current.name}</span> ·{" "}
                  {projectId ? (
                    <>
                      <SongStyleChip projectId={projectId} onOpen={() => setTab("details")} /> ·{" "}
                    </>
                  ) : null}
                  <span className={TONE[status.tone]}>{status.text}</span>
                </span>
                {SAVED_AT_ONCE.includes(stage) ? <span data-saved-at-once>Every change is saved for this song at once.</span> : null}
              </p>
            </div>
            {/* A banner only when something needs the user's attention: the theme being edited, Prepare's to-do list. */}
            {themeMode ? (
              <div data-theme-banner className="border-brand/50 bg-brand/15 sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm backdrop-blur">
                <FeatureIcon feature="theme" />
                <span className="min-w-0 flex-1">
                  <b>Editing theme {themeMode.name}</b>
                  <span className={cn("ml-2 text-xs", themeMode.shared ? "text-amber-200" : "text-muted-foreground")}>{themeMode.reach}</span>
                </span>
                {themeMode.changed ? <span className="text-xs text-amber-300">not saved yet</span> : null}
                <button type="button" data-theme-done onClick={themeMode.done} className="bg-brand text-brand-foreground rounded-md px-3 py-1 text-xs font-medium">
                  {themeMode.changed ? "Save and done" : "Done"}
                </button>
              </div>
            ) : null}
            {stage === "prepare" && todo.length ? (
              <ul className="flex flex-col gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3" data-todo>
                {todo.map((t) => (
                  <li key={t.id} data-todo-item={t.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className={cn(t.blocking ? "text-red-200" : "")}>{t.text}</span>
                    <Button size="sm" variant="outline" onClick={() => setTab(t.tab)}>
                      {t.action} <ChevronRight />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {children}
          </div>
        </Tabs>
        </ShapeStatusCtx.Provider>
        </ThemeLookCtx.Provider>
        </ThemeNowCtx.Provider>
        </ThemeModeCtx.Provider>
        </VideoCtx.Provider>
        </ReviewCtx.Provider>
        </MakePartCtx.Provider>
      </ShapePanel.Provider>
    </GoToTab.Provider>
  );
}

// "2 ⟳" on a tab while singing clips are being made; a click opens the Tasks menu (and does not switch the tab).
function RunningBadge({ count }: { count: number }) {
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openTasks();
  };
  return (
    <span
      role="link"
      tabIndex={0}
      data-running-badge={count}
      title={`${count} singing clip${count === 1 ? "" : "s"} being made: open Tasks`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(e)}
      className="bg-brand/15 text-brand ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-medium tabular-nums"
    >
      <Loader2 aria-hidden className="size-3 animate-spin" />
      {count}
    </span>
  );
}
