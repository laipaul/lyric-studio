import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { project } from "@lyric/db";
import { songRuns } from "@lyric/video/exports";
import { platformLabels, platformState, songCard } from "@lyric/video/library";
import { eq } from "drizzle-orm";

import { StatusBadge } from "@/components/status-badge";
import { SongView, type RunView } from "@/components/song-view";
import { withWorkspace } from "@/lib/workspace";

// The song page: header and every video made for it (exports grid, marks, compare, ready to post).
// The Generate panel and live progress arrive in Step 6.2b.
export default function SongPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading…</div>}>
      <Song params={params} />
    </Suspense>
  );
}

async function Song({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const data = withWorkspace((ws) => {
    const p = ws.db.select().from(project).where(eq(project.id, id)).get();
    if (!p) return null;
    const labels = platformLabels();
    const runs: RunView[] = songRuns(ws, p.id, Object.fromEntries(labels.map((l) => [l.name, l.label]))).map((r) => ({
      ...r,
      platforms: r.platforms.map((pr) => ({ ...pr, state: platformState(pr) })),
    }));
    return { song: songCard(ws, p, labels), runs };
  });
  if (!data) notFound();
  const { song, runs } = data;
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
                  <StatusBadge status={p.status} details={p.details} resumeCommand={p.resumeCommand} heading={`${p.label}: latest run`}>
                    <span>{p.label}</span>
                    <span className="ml-2 font-medium tabular-nums">{p.status === "interrupted" ? "!" : p.status === "Rendering" ? "…" : p.videos}</span>
                  </StatusBadge>
                </li>
              ))}
          </ul>
        </div>
      </div>
      <SongView projectId={song.id} songTitle={song.title} runs={runs} />
    </div>
  );
}
