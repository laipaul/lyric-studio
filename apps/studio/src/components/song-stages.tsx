"use client";

import { Check, ChevronRight, ListChecks, Package } from "lucide-react";
import { createContext, useContext, useState } from "react";

import type { TodoItem } from "@lyric/video/song-stages";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { FEATURE, FeatureIcon, type Feature } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

// The four stages of a song (Prepare -> Shape -> Make -> Review & Post) over the existing tabs: a stage
// shows only its own tabs; the Prepare stage lists what still needs the user's ears or eyes.
export const STAGES = [
  { id: "prepare", name: "Prepare", tabs: ["assets", "lyrics"] },
  { id: "shape", name: "Shape", tabs: ["shape"] },
  { id: "make", name: "Make", tabs: ["generate"] },
  { id: "review", name: "Review & Post", tabs: ["videos", "post"] },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = { text: string; tone: "done" | "todo" | "blocked" | "muted" | "busy" };

const TAB_LABEL: Record<string, string> = { assets: "Assets", lyrics: "Lyrics", shape: "Shape", generate: "Generate", videos: "Videos", post: "Post" };
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

// The Shape page's menus in the left rail (Canva style): each opens one panel beside the rail; a second
// click closes it. Theme holds the whole look (fonts, effects, colour: a song points to its theme, 31 Oct
// 2026). "shot" opens by clicking a shot on the timeline, "text" by clicking a text card (no rail icons).
export const SHAPE_PANELS = [
  { id: "clips", label: "Clips", icon: FEATURE.clips.icon, colour: FEATURE.clips.colour },
  { id: "song", label: "This song", icon: FEATURE.song.icon, colour: FEATURE.song.colour },
  { id: "make", label: "To make", icon: ListChecks, colour: "" },
  { id: "auto", label: "Automatic", icon: FEATURE.auto.icon, colour: FEATURE.auto.colour },
  // The Look group (1 Nov 2026): Theme sits apart at the bottom of the rail, in pink, so the song's own
  // things and the shared look are never confused.
  { id: "theme", label: "Theme", icon: FEATURE.theme.icon, colour: FEATURE.theme.colour },
] as const;
export type ShapePanelId = (typeof SHAPE_PANELS)[number]["id"] | "shot" | "text";
type PanelState = { panel: ShapePanelId | null; setPanel: (p: ShapePanelId | null) => void };
const ShapePanel = createContext<PanelState>({ panel: null, setPanel: () => {} });
export const useShapePanel = () => useContext(ShapePanel);

// Theme editing mode (1 Nov 2026): while a theme is being edited the song page wears a pink frame and a
// banner "Editing theme X · changes reach …" with Done. The Theme panel (shape-tools) reports it here.
export type ThemeMode = { name: string; reach: string; shared: boolean; changed: boolean; done: () => void };
const ThemeModeCtx = createContext<(m: ThemeMode | null) => void>(() => {});
export const useSetThemeMode = () => useContext(ThemeModeCtx);

// The feature icons (lib/feature-icons.tsx): one icon per step, the same everywhere.
const STAGE_ICON = { prepare: FEATURE.prepare.icon, shape: FEATURE.shape.icon, make: FEATURE.make.icon, review: FEATURE.review.icon } as const;
const TAB_ICON: Record<string, Feature> = { assets: "song", lyrics: "lyrics", shape: "shape", generate: "make", videos: "review", post: "post" };
const DOT: Record<StageStatus["tone"], string> = { done: "bg-emerald-400", todo: "bg-amber-300", blocked: "bg-red-400", muted: "bg-transparent", busy: "bg-brand animate-pulse" };

// The song page as a Canva-style workspace: a narrow icon rail on the left with the four stages (a dot
// for each stage's status; the status in words as its tooltip and at the top of the work area) and, under
// Shape when it is open, the Shape menus; the work area fills the rest. A stage with several tabs shows
// them at the top of its work area; Prepare lists what still needs the user's ears or eyes.
export function SongStages({
  initialTab,
  initialPanel,
  statuses,
  todo,
  counts,
  children,
}: {
  initialTab: string;
  initialPanel?: ShapePanelId | null; // ?panel= (e.g. the Themes page's Edit opens Shape → Theme)
  statuses: Record<StageId, StageStatus>;
  todo: TodoItem[];
  counts: Partial<Record<string, number>>; // a number next to a tab (Post: approved videos)
  children: React.ReactNode; // the TabsContent of every tab
}) {
  const [tab, setTab] = useState(initialTab);
  const [panel, setPanel] = useState<ShapePanelId | null>(initialPanel ?? null);
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  // The rail's Theme: always opens on the choice ("This song uses …", Edit theme); an editor with no
  // change yet closes, one with unsaved changes stays (the frame and banner say so).
  const openTheme = () => {
    if (panel === "theme" && stage === "shape") return setPanel(null);
    if (themeMode && !themeMode.changed) themeMode.done();
    setTab("shape");
    setPanel("theme");
  };
  const stage = stageOf(tab);
  const current = STAGES.find((s) => s.id === stage)!;
  return (
    <GoToTab.Provider value={setTab}>
      <ShapePanel.Provider value={{ panel, setPanel }}>
        <ThemeModeCtx.Provider value={setThemeMode}>
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
                    <Icon className="size-5" />
                    {s.id === "review" ? "Review" : s.name}
                    <span className={cn("absolute top-1.5 right-2 size-2 rounded-full", DOT[statuses[s.id].tone])} aria-hidden />
                    <span data-stage-status className="sr-only">
                      {statuses[s.id].text}
                    </span>
                  </button>
                  {s.id === "shape" && stage === "shape" ? (
                    <div className="mb-1 flex flex-col gap-0.5 border-y py-1" data-shape-menus>
                      {SHAPE_PANELS.filter((m) => m.id !== "theme").map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          data-rail-item={m.id}
                          aria-pressed={panel === m.id}
                          onClick={() => setPanel(panel === m.id ? null : m.id)}
                          className={cn("flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] leading-tight", panel === m.id ? "bg-brand/25 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                        >
                          <m.icon aria-hidden data-feature-icon={m.id} className={cn("size-4", m.colour)} />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div data-rail-group="look" className="mt-1 flex flex-col gap-0.5 border-t pt-1.5">
              <span className="text-muted-foreground text-center text-[9px] font-semibold tracking-[0.16em] uppercase">Look</span>
              <button
                type="button"
                data-rail-item="theme"
                aria-pressed={panel === "theme" && stage === "shape"}
                onClick={openTheme}
                title="The song's look: its theme (shared with other songs that use it)"
                className={cn("text-brand flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] leading-tight", panel === "theme" && stage === "shape" ? "bg-brand/25" : "hover:bg-brand/10")}
              >
                <FeatureIcon feature="theme" />
                Theme
              </button>
            </div>
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
            <p className="text-muted-foreground text-xs" data-work-status>
              <span className="text-foreground font-medium">{current.name}</span> · <span className={TONE[statuses[stage].tone]}>{statuses[stage].text}</span>
            </p>
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

            {current.tabs.length > 1 ? (
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
        </ThemeModeCtx.Provider>
      </ShapePanel.Provider>
    </GoToTab.Provider>
  );
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
            {fromRecipe ? " (this song's platforms)" : " (set the song's own platforms in Shape → What to make)"}, with {clipsNote}. The app makes every technical choice;
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
