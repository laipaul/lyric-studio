"use client";

import { Check, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { VideoInfo } from "@lyric/video/exports";

import { PostPanel } from "@/components/ready-to-post";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Group = { platform: string; label: string; videos: VideoInfo[] };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The Post tab: only the approved videos (approve them in the Videos tab), per platform, each with its
// caption and hashtags (YouTube: title, description, tags), downloads and Open folder. Nothing is posted
// automatically: copy, download, then post it yourself.
export function PostTab({ projectId, songTitle, groups, offered = [] }: { projectId: string; songTitle: string; groups: Group[]; offered?: VideoInfo[] }) {
  const first = groups[0]?.videos[0]?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(first);
  const offer = offered.length ? <ReadyToApprove projectId={projectId} videos={offered} /> : null;

  if (!groups.length) {
    return (
      <div className="flex flex-col gap-6">
        {offer}
        <div data-post-empty className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center text-sm">
          <p>No approved videos yet.</p>
          <p className="text-xs">{offered.length ? "Approve one above, or" : "In the Videos tab,"} mark the videos you want to post as approved: they appear here with their captions and files.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-24">
      {offer}
      <p className="text-muted-foreground text-sm">Approved videos, ready to post. Copy the text and download the files, then post them yourself: nothing is posted from here.</p>
      {groups.map((g) => (
        <section key={g.platform} data-post-platform={g.platform} className="flex flex-col gap-3">
          <h2 className="font-display text-brand text-sm tracking-[0.14em] uppercase">
            {g.label} <span className="text-muted-foreground">· {g.videos.length}</span>
          </h2>
          <ul className="flex flex-col gap-3">
            {g.videos.map((v) => {
              const open = openId === v.id;
              return (
                <li key={v.id} data-post-video={v.id} className={cn("bg-card rounded-xl border", open && "border-brand/40")}>
                  <button type="button" onClick={() => setOpenId(open ? null : v.id)} aria-expanded={open} className="flex w-full items-center gap-4 p-3 text-left">
                    <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-black", v.platform === "youtube" ? "aspect-video w-32" : "aspect-[9/16] w-14")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local still frame served by /api/poster */}
                      <img src={`/api/poster/${v.mp4}`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">
                        {v.label} {v.name}
                        {v.mark.favourite ? <span className="text-brand"> ★</span> : null}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {when(v.createdAt)}
                        {v.durationS ? ` · ${Math.round(v.durationS)} s` : ""}
                        {v.effects ? ` · ${v.effects.verse} / ${v.effects.hook}` : ""}
                      </span>
                    </div>
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Send className="size-3.5" /> {open ? "Hide" : "Post"}
                    </span>
                  </button>
                  {open ? (
                    <div className="grid gap-4 border-t p-4 md:grid-cols-[minmax(0,240px)_1fr]">
                      <video
                        src={`/api/files/${v.mp4}`}
                        poster={`/api/poster/${v.mp4}`}
                        controls
                        playsInline
                        preload="none"
                        className={cn("w-full rounded-md bg-black", v.platform === "youtube" ? "aspect-video md:col-span-2 md:max-w-xl" : "aspect-[9/16]")}
                      />
                      <PostPanel key={v.id} projectId={projectId} songTitle={songTitle} video={v} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// "Ready to post — approve?": videos the app judged ✅ with nothing left to improve, not yet approved or
// discarded. One click approves (the take to post stays the user's choice: nothing is approved by itself).
function ReadyToApprove({ projectId, videos }: { projectId: string; videos: VideoInfo[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function approve(v: VideoInfo) {
    setBusy(v.id);
    try {
      await api("/api/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, video: v.id, status: "approved" }) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4" data-ready-to-approve>
      <div>
        <h2 className="text-sm font-medium text-emerald-200">Ready to post — approve?</h2>
        <p className="text-muted-foreground text-xs">The app found nothing to improve in these. Watch them in Videos if you like; approve the ones you want to post.</p>
      </div>
      <ul className="flex flex-wrap gap-3">
        {videos.map((v) => (
          <li key={v.id} data-offered={v.id} className="bg-card flex items-center gap-3 rounded-lg border p-2 pr-3">
            <div className={cn("relative shrink-0 overflow-hidden rounded bg-black", v.platform === "youtube" ? "aspect-video w-24" : "aspect-[9/16] w-10")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local still frame served by /api/poster */}
              <img src={`/api/poster/${v.mp4}`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            </div>
            <div className="flex flex-col text-xs">
              <span className="font-medium">
                {v.label} {v.name}
              </span>
              <span className="text-muted-foreground">{when(v.createdAt)}</span>
            </div>
            <Button size="sm" onClick={() => approve(v)} disabled={!!busy} data-approve={v.id}>
              <Check /> Approve
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
