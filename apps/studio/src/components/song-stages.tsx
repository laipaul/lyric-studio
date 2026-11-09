"use client";

import { Check, ChevronRight, Package } from "lucide-react";
import { createContext, useContext, useState } from "react";

import type { TodoItem } from "@lyric/video/song-stages";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { FEATURE, FeatureIcon, type Feature } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

// The four stages of a song (Prepare -> Shape -> Make -> Review & Post) over the existing tabs: a stage
// shows only its own tabs; the Prepare stage lists what still needs the user's ears or eyes.
// N1 (9 Nov 2026): every setting lives in the stage where it is looked for; the rail holds the four stages only
// (numbered) and each stage's sections are tabs inside it. Prepare = what the user provides (files, lyrics and
// timing with the tempo, the song's details and card texts, clips and collections); Shape = how the video is
// planned and looks; Make = what gets produced.
export const STAGES = [
  { id: "prepare", name: "Prepare", tabs: ["assets", "lyrics", "details", "clips"] },
  { id: "shape", name: "Shape", tabs: ["shape"] },
  { id: "make", name: "Make", tabs: ["generate"] },
  { id: "review", name: "Review & Post", tabs: ["videos", "post"] },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = { text: string; tone: "done" | "todo" | "blocked" | "muted" | "busy" };

const TAB_LABEL: Record<string, string> = { assets: "Files", lyrics: "Lyrics & timing", details: "Details", clips: "Clips", shape: "Shape", generate: "Make", videos: "Videos", post: "Post" };
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
export const SHAPE_PANELS = [
  { id: "look", label: "Look", icon: FEATURE.theme.icon, colour: FEATURE.theme.colour },
  { id: "part", label: "Part & ending", icon: FEATURE.auto.icon, colour: FEATURE.auto.colour },
  { id: "pace", label: "Pace", icon: FEATURE.auto.icon, colour: FEATURE.auto.colour },
  { id: "shots", label: "Shots", icon: FEATURE.clips.icon, colour: FEATURE.clips.colour },
] as const;
export type ShapePanelId = (typeof SHAPE_PANELS)[number]["id"] | "theme" | "text" | "analysis"; // analysis: the header's Analysis chip (2 Nov 2026)
// Old panel names (links from before N1) -> where that content is now.
export const OLD_SHAPE_PANELS: Record<string, ShapePanelId> = { clips: "shots", shot: "shots", auto: "part" };
type PanelState = { panel: ShapePanelId | null; setPanel: (p: ShapePanelId | null) => void };
const ShapePanel = createContext<PanelState>({ panel: null, setPanel: () => {} });
export const useShapePanel = () => useContext(ShapePanel);
// Make's tabs (N1): one form, three parts. Videos = the release pack, the song's platforms and Generate; Try other
// looks = another theme for one run, compare themes, picture versions; Options = the rarely needed ones.
export const MAKE_PARTS = [
  { id: "videos", label: "Videos" },
  { id: "looks", label: "Try other looks" },
  { id: "options", label: "Options" },
] as const;
export type MakePart = (typeof MAKE_PARTS)[number]["id"];
const MakePartCtx = createContext<{ part: MakePart; setPart: (p: MakePart) => void }>({ part: "videos", setPart: () => {} });
export const useMakePart = () => useContext(MakePartCtx);
// The video Shape shows (its platform), so a panel shows only the settings that apply to it (N1): title opening and
// ending for Reels / TikTok / Shorts, YouTube layout for YouTube. null: no video chosen yet (everything shows).
const VideoCtx = createContext<{ platform: string | null; setPlatform: (p: string | null) => void }>({ platform: null, setPlatform: () => {} });
export const useShapeVideo = () => useContext(VideoCtx);

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

// The feature icons (lib/feature-icons.tsx): one icon per step, the same everywhere.
const STAGE_ICON = { prepare: FEATURE.prepare.icon, shape: FEATURE.shape.icon, make: FEATURE.make.icon, review: FEATURE.review.icon } as const;
const TAB_ICON: Record<string, Feature> = { assets: "song", lyrics: "lyrics", details: "song", clips: "clips", shape: "shape", generate: "make", videos: "review", post: "post" };
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
  children,
}: {
  initialTab: string;
  initialPanel?: ShapePanelId | null; // ?panel= (e.g. the Themes page's Edit opens Shape → Theme)
  initialPart?: MakePart; // Make's tab (?part=)
  statuses: Record<StageId, StageStatus>;
  todo: TodoItem[];
  counts: Partial<Record<string, number>>; // a number next to a tab (Post: approved videos)
  children: React.ReactNode; // the TabsContent of every tab
}) {
  const [tab, setTab] = useState(initialTab);
  const [panel, setPanel] = useState<ShapePanelId | null>(initialPanel ?? null);
  const [part, setPart] = useState<MakePart>(initialPart ?? "videos");
  const [platform, setPlatform] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  const [themeNow, setThemeNow] = useState<ThemeNow | null>(null);
  // "theme X" (Analysis): Shape → Look, where the song's theme is shown and changed.
  const openTheme = () => {
    setTab("shape");
    setPanel("look");
  };
  const stage = stageOf(tab);
  const current = STAGES.find((s) => s.id === stage)!;
  return (
    <GoToTab.Provider value={setTab}>
      <ShapePanel.Provider value={{ panel, setPanel }}>
        <MakePartCtx.Provider value={{ part, setPart }}>
        <VideoCtx.Provider value={{ platform, setPlatform }}>
        <ThemeModeCtx.Provider value={setThemeMode}>
        <ThemeNowCtx.Provider value={setThemeNow}>
        <ThemeLookCtx.Provider value={{ themeNow, openTheme }}>
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
                    title={`${i + 1}. ${s.name}: ${statuses[s.id].text}`}
                    onClick={() => setTab(s.tabs[0])}
                    className={cn("relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-tight", stage === s.id ? "bg-brand/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                  >
                    <span data-stage-number className="text-muted-foreground absolute top-1 left-1.5 text-[10px] font-semibold tabular-nums">{i + 1}</span>
                    <Icon className="size-5" />
                    {s.id === "review" ? "Review" : s.name}
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
            {/* Review says it per platform in its own overview (1 Nov 2026), so no summary line there. */}
            {/* The stage's line. Not on Review (its own overview says it per platform, 1 Nov 2026) and not on Shape: there the
                header's Analysis chip holds it, with the Look · Content line (2 Nov 2026). */}
            {stage !== "review" && stage !== "shape" ? (
              <p className="text-muted-foreground text-xs" data-work-status>
                <span className="text-foreground font-medium">{current.name}</span> · <span className={TONE[statuses[stage].tone]}>{statuses[stage].text}</span>
              </p>
            ) : null}
            {stage === "prepare" ? (
              todo.length ? (
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
              ) : (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-4 py-3 text-sm" data-todo-done>
                  <Check className="size-4 text-emerald-300" /> Nothing to prepare: shape the video (optional) or go straight to
                  <button type="button" className="underline underline-offset-2" onClick={() => setTab("generate")}>
                    Make
                  </button>
                  .
                </p>
              )
            ) : null}

            {stage === "shape" ? (
              <div role="tablist" aria-label="Shape" data-shape-tabs className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center rounded-lg p-[3px]">
                {SHAPE_PANELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    data-shape-tab={m.id}
                    aria-selected={panel === m.id}
                    title={panel === m.id ? "Close the panel (the editor takes the whole width)" : undefined}
                    onClick={() => setPanel(panel === m.id ? null : m.id)}
                    className={cn("inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap", panel === m.id ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")}
                  >
                    <m.icon aria-hidden className={cn("size-3.5", m.colour)} />
                    {m.label}
                  </button>
                ))}
              </div>
            ) : stage === "make" ? (
              <div role="tablist" aria-label="Make" data-make-tabs className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center rounded-lg p-[3px]">
                {MAKE_PARTS.map((m) => (
                  <button key={m.id} type="button" role="tab" data-make-tab={m.id} aria-selected={part === m.id} onClick={() => setPart(m.id)} className={cn("inline-flex h-full items-center rounded-md px-3 text-sm font-medium whitespace-nowrap", part === m.id ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")}>
                    {m.label}
                  </button>
                ))}
              </div>
            ) : current.tabs.length > 1 ? (
              <TabsList>
                {current.tabs.map((t) => (
                  <TabsTrigger key={t} value={t} className="gap-1.5">
                    <FeatureIcon feature={TAB_ICON[t]} className="size-3.5" />
                    {TAB_LABEL[t]}
                    {counts[t] ? <span className="text-muted-foreground ml-1.5 tabular-nums">{counts[t]}</span> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            ) : null}
            {children}
          </div>
        </Tabs>
        </ThemeLookCtx.Provider>
        </ThemeNowCtx.Provider>
        </ThemeModeCtx.Provider>
        </VideoCtx.Provider>
        </MakePartCtx.Provider>
      </ShapePanel.Provider>
    </GoToTab.Provider>
  );
}

// Make's content that belongs to one of its tabs (the release pack and the song's platforms: Videos).
export function InMakePart({ part, children }: { part: MakePart; children: React.ReactNode }) {
  const now = useMakePart().part;
  return <div hidden={now !== part} className="flex flex-col gap-4" data-make-part={part}>{children}</div>;
}

// "Make release pack": one video per platform for the song's platforms, from its recipe and clips.
export function ReleasePack({
  projectId,
  platforms,
  fromRecipe,
  clipsNote,
  blocked,
}: {
  projectId: string;
  platforms: { name: string; label: string }[];
  fromRecipe: boolean; // the song's own list (song.json) vs every platform
  clipsNote: string; // "the song's 12 clips + wedding"
  blocked: string | null; // why it cannot be made yet (a blocking to-do)
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  async function make() {
    setBusy(true);
    setNotice(null);
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify({ platforms: platforms.map((p) => p.name), variations: 1 }));
    try {
      const res = await api("/api/runs", { method: "POST", body });
      const result = (await res.json()) as { error?: string; label?: string };
      if (!res.ok || result.error) throw new Error(result.error ?? `The studio answered ${res.status}`);
      setNotice({ ok: true, text: `Queued: ${result.label}. Follow it in Tasks (top right); the videos appear under Review & Post.` });
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-brand/30 bg-brand/5 flex flex-col gap-3 rounded-xl border p-5" data-release-pack>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display flex items-center gap-2 text-lg tracking-[0.08em]">
            <Package className="text-brand size-5" /> Make release pack
          </h2>
          <p className="text-muted-foreground text-sm" data-release-platforms>
            One video for each of {platforms.map((p) => p.label).join(" · ")}
            {fromRecipe ? " (this song's platforms)" : " (set the song's own platforms below, in What to make)"}, with {clipsNote}. The app makes every technical choice;
            you review the result.
          </p>
        </div>
        <Button size="lg" onClick={make} disabled={busy || !!blocked} data-make-release>
          <Package /> {busy ? "Queuing…" : "Make release pack"}
        </Button>
      </div>
      {blocked ? <p className="text-sm text-red-200">{blocked}</p> : null}
      {notice ? <p className={cn("text-sm", notice.ok ? "text-emerald-200" : "text-red-200")}>{notice.text}</p> : null}
    </div>
  );
}
