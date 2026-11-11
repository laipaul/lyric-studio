import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { makeRun, project } from "@lyric/db";
import { approvedVideos, readyToApprove, songRuns } from "@lyric/video/exports";
import { generatePanelData, platformLabels, platformState, songCard } from "@lyric/video/library";
import { chipState } from "@lyric/video/library-status";
import { songTodo } from "@lyric/video/song-stages";
import { compareRunToRecipe, generatePresetFromRun, type GeneratePreset, type RunComparison } from "@lyric/video/run-settings";
import { and, eq, inArray } from "drizzle-orm";

import { AssetsTab } from "@/components/assets-tab";
import { GeneratePanel } from "@/components/generate-panel";
import { LyricsTab } from "@/components/lyrics-tab";
import { PostTab } from "@/components/post-tab";
import { StatusBadge } from "@/components/status-badge";
import { ShapePage } from "@/components/shape-page";
import { SongTitle } from "@/components/song-title";
import { SongView, type MakingView, type RunView } from "@/components/song-view";
import { SongStages, type ReviewPlatform, type MakePart, type ShapePanelId, type StageId, type StageStatus } from "@/components/song-stages";
import { SongSettings } from "@/components/shape-tools";
import { LinksField } from "@/components/song-links";

// ?panel= (Shape's tabs; SHAPE_PANELS in song-stages.tsx, a client module) and the panels from before N1: where
// their content is now (a panel that moved to another stage opens that stage's tab).
const SHAPE_PANEL_IDS = ["look", "part", "pace", "shots", "theme"];
const OLD_PANELS: Record<string, { tab: string; panel?: ShapePanelId }> = { clips: { tab: "shape", panel: "shots" }, shot: { tab: "shape", panel: "shots" }, auto: { tab: "shape", panel: "part" }, song: { tab: "details" }, make: { tab: "generate" } };
const MAKE_PARTS = ["videos", "looks"]; // ?part=options (before 11 Nov 2026) opens Make: Advanced is there now
import { TabsContent } from "@/components/ui/tabs";
import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

// The song page: header, then tabs: Assets (the song folder's files and clips), Lyrics (every line's
// timing, what the viewer sees, nudges into hints.lrc, lyrics.txt), Shape (one page: the planned video's
// viewer, the timeline and the clips, the song's recipe tools on the left), Generate (the
// worker makes the videos; progress in the Tasks menu; ?from=<run> starts it with that run's settings),
// Videos (exports grid, marks, compare, each run's settings next to the recipe) and Post (the approved
// videos with their captions and files). ?tab= opens a tab. The tabs are grouped in four stages
// (Prepare -> Shape -> Make -> Review & Post) with the Prepare to-do list and "Make release pack".
const TABS = ["assets", "lyrics", "details", "clips", "shape", "generate", "videos", "post"];
const OLD_TABS: Record<string, string> = { style: "shape", storyboard: "shape", audio: "assets", files: "assets", sync: "lyrics", texts: "details" }; // links from before Style and Storyboard became one Shape page (?tab=storyboard: still Shape; Prepare's Storyboard tab is ?tab=clips); audio / files: Prepare → Assets; sync / texts: Lyrics Sync / Texts (the ids stay lyrics / details)
type Search = Promise<{ tab?: string; from?: string; panel?: string; edit?: string; part?: string }>; // panel: a Shape panel to open (theme, clips, …); edit: a theme to open in the Theme editor

export default function SongPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading…</div>}>
      <Song params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Song({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  await connection();
  const { id } = await params;
  const search = await searchParams;
  const data = withWorkspace((ws) => {
    const p = ws.db.select().from(project).where(eq(project.id, id)).get();
    if (!p) return null;
    const labels = platformLabels();
    const runs: RunView[] = songRuns(ws, p.id, Object.fromEntries(labels.map((l) => [l.name, l.label]))).map((r) => ({
      ...r,
      platforms: r.platforms.map((pr) => ({ ...pr, state: platformState(pr) })),
    }));
    // Each run's settings next to the recipe now (a run whose manifests cannot be read shows none).
    const settings: Record<string, RunComparison[]> = {};
    for (const r of runs) {
      try {
        settings[r.folder] = compareRunToRecipe(ws, p.id, r.folder);
      } catch {
        // an unreadable run: no settings block
      }
    }
    let preset: GeneratePreset | null = null;
    let presetError: string | null = null;
    if (search.from) {
      try {
        preset = generatePresetFromRun(ws, p.id, search.from);
      } catch (error) {
        presetError = (error as Error).message;
      }
    }
    // Review's placeholder cards: what is being made (or waiting) for this song, per platform (lyric timing runs aside).
    const labelOf = Object.fromEntries(labels.map((l) => [l.name, l.label]));
    const making: MakingView[] = ws.db
      .select()
      .from(makeRun)
      .where(and(eq(makeRun.project_id, p.id), inArray(makeRun.status, ["queued", "running"])))
      .all()
      .flatMap((r) => {
        const o = (r.options_json ?? {}) as { platforms?: string; take?: number; variations?: number; variationsBy?: Record<string, number>; lyricsOnly?: boolean; pictures?: string; themes?: string[]; theme?: string; pairings?: string };
        if (o.lyricsOnly || !o.platforms) return [];
        const what = (name: string) => {
          if (o.take) return `take ${o.take}`;
          if (o.theme) return `try: theme ${o.theme}`;
          if (o.pictures || o.pairings) return "the looks to compare";
          const n = o.variationsBy?.[name] ?? o.variations ?? 1;
          return `${n} new ${name === "canvas" ? "loop" : "video"}${n === 1 ? "" : "s"}`;
        };
        return o.platforms.split(",").filter(Boolean).map((name) => ({ runId: r.id, platform: name, label: labelOf[name] ?? name, status: r.status as "queued" | "running", what: what(name) }));
      });
    return { song: songCard(ws, p, labels), runs, settings, approved: approvedVideos(runs), offered: readyToApprove(runs), panel: generatePanelData(ws, p), preset, presetError, making };
  });
  if (!data) notFound();
  const { song, runs, settings, approved, offered, panel, preset, presetError, making } = data;
  // Compare looks' baseline: the platforms that already have one of the song's own videos (not a try).
  const ownMade = [...new Set(runs.flatMap((r) => r.platforms.filter((pr) => pr.videos.some((v) => !v.try && v.mark.status !== "discarded")).map((pr) => pr.name)))];
  // Review's tabs: every platform with videos (count: those not discarded) or being made, the song's own order first.
  const reviewPlatforms: ReviewPlatform[] = (() => {
    const found = new Map<string, ReviewPlatform>();
    for (const r of runs) for (const pr of r.platforms) if (pr.videos.length) {
      const c = found.get(pr.name) ?? { name: pr.name, label: pr.label, count: 0 };
      c.count += pr.videos.filter((v) => v.mark.status !== "discarded").length;
      found.set(pr.name, c);
    }
    for (const m of making) if (!found.has(m.platform)) found.set(m.platform, { name: m.platform, label: m.label, count: 0 });
    const order = [...(song.wanted ?? []), "reels", "tiktok", "shorts", "youtube", "canvas", "standard"];
    return [...found.values()].sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  })();
  const todo = await withWorkspaceAsync((ws) => songTodo(ws, id)).catch(() => []);
  const blocking = todo.find((t) => t.blocking) ?? null;
  // Where the page opens: ?tab=; a song with videos: Review; before the first video: what still needs doing
  // (Prepare), else Make. (Prepare's status stays visible in the stage bar either way.)
  const old = search.panel ? OLD_PANELS[search.panel] : undefined;
  const asked = old && (!search.tab || OLD_TABS[search.tab] === "shape" || search.tab === "shape") ? old.tab : search.tab ? (OLD_TABS[search.tab] ?? search.tab) : undefined;
  const askedPanel: ShapePanelId | null = old?.panel ?? (SHAPE_PANEL_IDS.includes(search.panel ?? "") ? (search.panel as ShapePanelId) : null);
  const tab = asked && TABS.includes(asked) ? asked : runs.length ? "videos" : todo.length ? (blocking ?? todo[0]).tab : "generate";

  // Each stage's status line.
  const chips = song.platforms.map((p) => ({ ...p, state: chipState(p) }));
  const made = runs.reduce((n, r) => n + r.platforms.reduce((m, p) => m + p.videos.filter((v) => v.mark.status !== "discarded").length, 0), 0); // every kept video, all runs
  const toReview = chips.reduce((n, p) => n + (p.state === "review" ? p.videos : 0), 0);
  const approvedCount = chips.reduce((n, p) => n + p.approved, 0);
  const rendering = chips.some((p) => p.state === "rendering");
  const statuses: Record<StageId, StageStatus> = {
    prepare: blocking ? { text: `${todo.length} to do`, tone: "blocked" } : todo.length ? { text: `${todo.length} to check`, tone: "todo" } : { text: "Ready", tone: "done" },
    shape: { text: "Optional: clip order, anchors, look", tone: "muted" },
    make: rendering ? { text: "Rendering…", tone: "busy" } : made ? { text: `${made} video${made === 1 ? "" : "s"} made`, tone: "done" } : { text: "No videos yet", tone: "muted" },
    review: !made ? { text: "Nothing to review yet", tone: "muted" } : toReview ? { text: `${toReview} to review · ${approvedCount} approved`, tone: "todo" } : { text: `${approvedCount} approved`, tone: approvedCount ? "done" : "muted" },
  };
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* A slim header: cover, title, artist and the platform counts on one line (the work area gets the rest). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2" data-song-header>
        <Link href="/" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm" title="Library">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="size-11 shrink-0 overflow-hidden rounded-md border bg-gradient-to-br from-[#2a1820] to-[#0b0b0d]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
          {song.cover ? <img src={`/api/files/${song.cover}`} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0">
          <SongTitle key={song.title} id={song.id} title={song.title} />
          <p className="text-muted-foreground truncate text-xs">
            {song.artist}
            {song.ep ? ` · ${song.ep}` : ""}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {song.platforms
            .filter((p) => p.status !== "none")
            .map((p) => (
              <li key={p.name}>
                <StatusBadge status={p.status} details={p.details} resumeCommand={p.resumeCommand} resume={p.resumeFolder ? { projectId: song.id, folder: p.resumeFolder } : null} heading={`${p.label}: latest run`}>
                  <span>{p.label}</span>
                  <span className="ml-2 font-medium tabular-nums">{p.status === "interrupted" ? "!" : p.status === "Rendering" ? "…" : p.videos}</span>
                </StatusBadge>
              </li>
            ))}
        </ul>
        {/* The Shape page puts its Analysis chip and Next: Make here (2 Nov 2026; shape-board.tsx, a portal). */}
        <div id="song-header-actions" data-song-header-actions className="ml-auto flex items-center gap-2" />
      </div>
      <SongStages key={`${search.tab ?? ""}:${search.panel ?? ""}:${search.part ?? ""}:${search.from ?? ""}`} initialTab={tab} initialPanel={tab === "shape" ? askedPanel : null} initialPart={MAKE_PARTS.includes(search.part ?? "") ? (search.part as MakePart) : undefined} statuses={statuses} todo={todo} counts={{ post: approved.reduce((n, g) => n + g.videos.length, 0) + offered.length }} reviewPlatforms={reviewPlatforms}>
        {/* Prepare (11 Nov 2026): Assets = the files the user provides (song, vocal stem, lyrics file, backing vocals, cover);
            Lyrics Sync = tempo, Time the lyrics again, hints and the lyric lines; Texts = title and card texts, EP, links;
            Storyboard = the clips and photos in story order. */}
        <TabsContent value="assets">
          <AssetsTab projectId={song.id} part="files" />
        </TabsContent>
        <TabsContent value="lyrics">
          <div className="flex flex-col gap-4">
            <SongSettings projectId={song.id} only="timing" />
            <AssetsTab projectId={song.id} part="hints" />
            <LyricsTab projectId={song.id} />
          </div>
        </TabsContent>
        <TabsContent value="details">
          <div className="flex max-w-3xl flex-col gap-4">
            <SongSettings projectId={song.id} only="details" />
            <LinksField projectId={song.id} />
          </div>
        </TabsContent>
        <TabsContent value="clips">
          <div className="flex flex-col gap-4">
            <AssetsTab projectId={song.id} part="clips" />
            <SongSettings projectId={song.id} only="collections" />
          </div>
        </TabsContent>
        <TabsContent value="shape">
          <ShapePage projectId={song.id} />
        </TabsContent>
        {/* Kept mounted (hidden when inactive) so what was chosen here (platforms, collections, effects...) survives a trip to another stage. */}
        <TabsContent value="generate" forceMount className="data-[state=inactive]:hidden">
          <div className="flex flex-col gap-4">
            {presetError ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{presetError}</p> : null}
            <GeneratePanel key={preset?.folder ?? "recipe"} projectId={song.id} data={panel} preset={preset} blocked={blocking ? `First: ${blocking.text}` : null} ownMade={ownMade} />
          </div>
        </TabsContent>
        <TabsContent value="videos">
          <SongView projectId={song.id} songTitle={song.title} runs={runs} settings={settings} making={making} />
        </TabsContent>
        <TabsContent value="post">
          <PostTab projectId={song.id} songTitle={song.title} groups={approved} offered={offered} />
        </TabsContent>
      </SongStages>
    </div>
  );
}
