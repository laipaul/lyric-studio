import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { project } from "@lyric/db";
import { approvedVideos, readyToApprove, songRuns } from "@lyric/video/exports";
import { generatePanelData, platformLabels, platformState, songCard } from "@lyric/video/library";
import { chipState } from "@lyric/video/library-status";
import { RELEASE_PLATFORMS, songTodo } from "@lyric/video/song-stages";
import { compareRunToRecipe, generatePresetFromRun, type GeneratePreset, type RunComparison } from "@lyric/video/run-settings";
import { eq } from "drizzle-orm";

import { AssetsTab } from "@/components/assets-tab";
import { GeneratePanel } from "@/components/generate-panel";
import { LyricsTab } from "@/components/lyrics-tab";
import { PostTab } from "@/components/post-tab";
import { StatusBadge } from "@/components/status-badge";
import { StoryboardTab } from "@/components/storyboard-tab";
import { StyleTab } from "@/components/style-tab";
import { SongView, type RunView } from "@/components/song-view";
import { ReleasePack, SongStages, type StageId, type StageStatus } from "@/components/song-stages";
import { TabsContent } from "@/components/ui/tabs";
import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

// The song page: header, then tabs: Assets (the song folder's files and clips), Lyrics (every line's
// timing, what the viewer sees, nudges into hints.lrc, lyrics.txt), Style (the song's
// recipe: song.json with each setting's source, per platform, save / reset / lock), Generate (the
// worker makes the videos; progress in the Tasks menu; ?from=<run> starts it with that run's settings),
// Videos (exports grid, marks, compare, each run's settings next to the recipe) and Post (the approved
// videos with their captions and files). ?tab= opens a tab. The tabs are grouped in four stages
// (Prepare -> Shape -> Make -> Review & Post) with the Prepare to-do list and "Make release pack".
const TABS = ["assets", "lyrics", "style", "storyboard", "generate", "videos", "post"];
type Search = Promise<{ tab?: string; from?: string }>;

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
    return { song: songCard(ws, p, labels), runs, settings, approved: approvedVideos(runs), offered: readyToApprove(runs), panel: generatePanelData(ws, p), preset, presetError };
  });
  if (!data) notFound();
  const { song, runs, settings, approved, offered, panel, preset, presetError } = data;
  const todo = await withWorkspaceAsync((ws) => songTodo(ws, id)).catch(() => []);
  const blocking = todo.find((t) => t.blocking) ?? null;
  // Where the page opens: ?tab=; a song with videos: Review; before the first video: what still needs doing
  // (Prepare), else Make. (Prepare's status stays visible in the stage bar either way.)
  const tab = search.tab && TABS.includes(search.tab) ? search.tab : runs.length ? "videos" : todo.length ? (blocking ?? todo[0]).tab : "generate";

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
  // The release pack: the song's own platforms, else every platform you post to.
  const labels = Object.fromEntries(panel.platforms.map((p) => [p.name, p.label]));
  const releaseNames = (song.wanted ?? RELEASE_PLATFORMS).filter((n) => labels[n]);
  const clipsNote =
    [panel.songClips ? `the song's ${panel.songClips} clip${panel.songClips === 1 ? "" : "s"}` : null, panel.chosen.length ? `the ${panel.chosen.join(" + ")} collection${panel.chosen.length === 1 ? "" : "s"}` : null]
      .filter(Boolean)
      .join(" and ") || "no clips yet";
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-8">
      <Link href="/" className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Library
      </Link>
      <div className="flex flex-wrap items-center gap-6">
        <div className="size-32 shrink-0 overflow-hidden rounded-xl border bg-gradient-to-br from-[#2a1820] to-[#0b0b0d]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
          {song.cover ? <img src={`/api/files/${song.cover}`} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-3xl">{song.title}</h1>
            <p className="text-muted-foreground">
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
        </div>
      </div>
      <SongStages key={`${tab}:${search.from ?? ""}`} initialTab={tab} statuses={statuses} todo={todo} counts={{ post: approved.reduce((n, g) => n + g.videos.length, 0) + offered.length }}>
        <TabsContent value="assets">
          <AssetsTab projectId={song.id} />
        </TabsContent>
        <TabsContent value="lyrics">
          <LyricsTab projectId={song.id} />
        </TabsContent>
        <TabsContent value="style">
          <StyleTab projectId={song.id} />
        </TabsContent>
        <TabsContent value="storyboard">
          <StoryboardTab projectId={song.id} />
        </TabsContent>
        {/* Kept mounted (hidden when inactive) so what was chosen here (platforms, collections, effects...) survives a trip to another stage. */}
        <TabsContent value="generate" forceMount className="data-[state=inactive]:hidden">
          <div className="flex flex-col gap-4">
            {!preset ? (
              <ReleasePack
                projectId={song.id}
                platforms={releaseNames.map((n) => ({ name: n, label: labels[n] }))}
                fromRecipe={!!song.wanted}
                clipsNote={clipsNote}
                blocked={blocking ? `First: ${blocking.text}` : null}
              />
            ) : null}
            {presetError ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{presetError}</p> : null}
            {!preset ? <p className="text-muted-foreground text-xs">More options (platforms, videos per platform, effects, section, compare fonts or pictures):</p> : null}
            <GeneratePanel key={preset?.folder ?? "recipe"} projectId={song.id} data={panel} open={!!preset} preset={preset} />
          </div>
        </TabsContent>
        <TabsContent value="videos">
          <SongView projectId={song.id} songTitle={song.title} runs={runs} settings={settings} />
        </TabsContent>
        <TabsContent value="post">
          <PostTab projectId={song.id} songTitle={song.title} groups={approved} offered={offered} />
        </TabsContent>
      </SongStages>
    </div>
  );
}
