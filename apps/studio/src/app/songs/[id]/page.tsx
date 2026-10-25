import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { project } from "@lyric/db";
import { songCard } from "@lyric/video/library";
import { eq } from "drizzle-orm";

import { withWorkspace } from "@/lib/workspace";

// The song page. Generate, exports and the "ready to post" panel arrive in Step 6.2.
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
  const song = withWorkspace((ws) => {
    const p = ws.db.select().from(project).where(eq(project.id, id)).get();
    return p ? songCard(ws, p) : null;
  });
  if (!song) notFound();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <Link href="/" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Library
      </Link>
      <div className="flex items-center gap-6">
        <div className="size-32 shrink-0 overflow-hidden rounded-xl border bg-gradient-to-br from-[#2a1820] to-[#0b0b0d]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
          {song.cover ? <img src={`/api/files/${song.cover}`} alt="" className="size-full object-cover" /> : null}
        </div>
        <div>
          <h1 className="text-3xl">{song.title}</h1>
          <p className="text-muted-foreground">
            {song.artist}
            {song.ep ? ` · ${song.ep}` : ""}
          </p>
        </div>
      </div>
      <div className="text-muted-foreground flex h-48 items-center justify-center rounded-xl border border-dashed text-sm">
        Generate, exports and “ready to post” arrive in Step 6.2.
      </div>
    </div>
  );
}
