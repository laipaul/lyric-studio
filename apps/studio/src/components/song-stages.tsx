"use client";

import { Check, ChevronRight, Package } from "lucide-react";
import { useState } from "react";

import type { TodoItem } from "@lyric/video/song-stages";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// The four stages of a song (Prepare -> Shape -> Make -> Review & Post) over the existing tabs: a stage
// shows only its own tabs; the Prepare stage lists what still needs the user's ears or eyes.
export const STAGES = [
  { id: "prepare", name: "Prepare", tabs: ["assets", "lyrics"] },
  { id: "shape", name: "Shape", tabs: ["style", "storyboard"] },
  { id: "make", name: "Make", tabs: ["generate"] },
  { id: "review", name: "Review & Post", tabs: ["videos", "post"] },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = { text: string; tone: "done" | "todo" | "blocked" | "muted" | "busy" };

const TAB_LABEL: Record<string, string> = { assets: "Assets", lyrics: "Lyrics", style: "Style", storyboard: "Storyboard", generate: "Generate", videos: "Videos", post: "Post" };
const stageOf = (tab: string): StageId => STAGES.find((s) => (s.tabs as readonly string[]).includes(tab))?.id ?? "prepare";
const TONE: Record<StageStatus["tone"], string> = {
  done: "text-emerald-300",
  todo: "text-amber-200",
  blocked: "text-red-300",
  muted: "text-muted-foreground",
  busy: "text-brand animate-pulse",
};

export function SongStages({
  initialTab,
  statuses,
  todo,
  counts,
  children,
}: {
  initialTab: string;
  statuses: Record<StageId, StageStatus>;
  todo: TodoItem[];
  counts: Partial<Record<string, number>>; // a number next to a tab (Post: approved videos)
  children: React.ReactNode; // the TabsContent of every tab
}) {
  const [tab, setTab] = useState(initialTab);
  const stage = stageOf(tab);
  const current = STAGES.find((s) => s.id === stage)!;
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Stages" data-stages>
        {STAGES.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              data-stage={s.id}
              aria-current={stage === s.id ? "step" : undefined}
              onClick={() => setTab(s.tabs[0])}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors",
                stage === s.id ? "border-brand bg-brand/10" : "hover:border-brand/40 bg-card",
              )}
            >
              <span className="flex items-center gap-2 text-sm">
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums", statuses[s.id].tone === "done" ? "border-emerald-400/50 text-emerald-300" : "")}>
                  {statuses[s.id].tone === "done" ? <Check className="size-3" /> : i + 1}
                </span>
                {s.name}
              </span>
              <span className={cn("pl-7 text-xs", TONE[statuses[s.id].tone])} data-stage-status>
                {statuses[s.id].text}
              </span>
            </button>
          </li>
        ))}
      </ol>

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
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
              {counts[t] ? <span className="text-muted-foreground ml-1.5 tabular-nums">{counts[t]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      ) : null}
      {children}
    </Tabs>
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
            {fromRecipe ? " (this song's platforms)" : " (set the song's own platforms in Shape → Style)"}, with {clipsNote}. The app makes every technical choice;
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
