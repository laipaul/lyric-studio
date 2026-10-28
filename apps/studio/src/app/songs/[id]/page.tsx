import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { project } from "@lyric/db";
import { approvedVideos, songRuns } from "@lyric/video/exports";
import { generatePanelData, platformLabels, platformState, songCard } from "@lyric/video/library";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { withWorkspace } from "@/lib/workspace";

// The song page: header, then tabs: Assets (the song folder's files and clips), Lyrics (every line's
// timing, what the viewer sees, nudges into hints.lrc, lyrics.txt), Style (the song's
// recipe: song.json with each setting's source, per platform, save / reset / lock), Generate (the
// worker makes the videos; progress in the Tasks menu; ?from=<run> starts it with that run's settings),
// Videos (exports grid, marks, compare, each run's settings next to the recipe) and Post (the approved
// videos with their captions and files). ?tab= opens a tab.
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
    return { song: songCard(ws, p, labels), runs, settings, approved: approvedVideos(runs), panel: generatePanelData(ws, p), preset, presetError };
  });
  if (!data) notFound();
  const { song, runs, settings, approved, panel, preset, presetError } = data;
  const tab = search.tab && TABS.includes(search.tab) ? search.tab : runs.length ? "videos" : "generate";
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
      <Tabs key={`${tab}:${search.from ?? ""}`} defaultValue={tab} className="gap-6">
        <TabsList>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
          <TabsTrigger value="storyboard">Storyboard</TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="post">
            Post{approved.length ? <span className="text-muted-foreground ml-1.5 tabular-nums">{approved.reduce((n, g) => n + g.videos.length, 0)}</span> : null}
          </TabsTrigger>
        </TabsList>
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
        <TabsContent value="generate">
          {presetError ? <p className="mb-4 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{presetError}</p> : null}
          <GeneratePanel key={preset?.folder ?? "recipe"} projectId={song.id} data={panel} open preset={preset} />
        </TabsContent>
        <TabsContent value="videos">
          <SongView projectId={song.id} songTitle={song.title} runs={runs} settings={settings} />
        </TabsContent>
        <TabsContent value="post">
          <PostTab projectId={song.id} songTitle={song.title} groups={approved} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
