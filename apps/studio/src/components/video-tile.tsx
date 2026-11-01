"use client";

import { Check, Columns3, MessageSquareHeart, Send, Star, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";

import type { VideoInfo } from "@lyric/video/exports";

import { VerdictBadge } from "@/components/assessment";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

export const seconds = (s: number | null) => (s === null ? "" : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s.toFixed(1)} s`);
export const orderText = (v: VideoInfo) => (v.order === "story" ? "story" : `shuffle ${v.seed}`);

// One finished video: its still frame (it plays muted on hover), QA badge with reasons, settings, and
// the marks: favourite, approved, discarded (hidden), compare, ready to post.
export function VideoTile({
  projectId,
  strongest,
  onChanged,
  video,
  wide,
  selected,
  onMark,
  onCompare,
  onPost,
  onPlay,
}: {
  projectId: string;
  strongest: string | null; // why this is the strongest of its platform's videos
  onChanged: () => void;
  video: VideoInfo;
  wide: boolean;
  selected: boolean;
  onMark: (change: { favourite?: boolean; status?: VideoInfo["mark"]["status"] }) => void;
  onCompare: () => void;
  onPost: () => void;
  onPlay: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { mark, qa } = video;
  const discarded = mark.status === "discarded";
  const qaDetails = qa.problems.map((p) => `${p.check}${p.details.length ? `: ${p.details.join("; ")}` : ""}`);
  return (
    <div
      data-video={video.id}
      data-mark={mark.status}
      className={cn("bg-card group flex flex-col rounded-xl border transition-colors", selected && "border-brand ring-brand/40 ring-2", discarded && "opacity-50", mark.status === "approved" && !selected && "border-emerald-400/40")}
    >
      <div
        data-tile-picture
        onClick={onPlay}
        className={cn("relative cursor-pointer overflow-hidden rounded-t-xl bg-black", wide ? "aspect-video" : "aspect-[9/16]")}
        onMouseEnter={() => ref.current?.play().catch(() => {})}
        onMouseLeave={() => {
          if (ref.current) {
            ref.current.pause();
            ref.current.currentTime = 0;
          }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a frame made by FFmpeg on this PC */}
        <img src={`/api/poster/${video.mp4}`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        <video ref={ref} src={`/api/files/${video.mp4}`} muted loop playsInline preload="none" className="absolute inset-0 size-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
          <VerdictBadge a={video.assessment} technical={qaDetails.length ? qaDetails : ["QA: every check passed"]} heading={`${video.label} ${video.name}`} />
          {strongest ? (
            <span className="bg-brand/80 mt-1 block w-fit rounded px-1.5 py-0.5 text-[10px] text-white" title={`Strongest: ${strongest}`} data-strongest>
              ★ strongest
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={mark.favourite ? "Remove from favourites" : "Add to favourites"}
          onClick={(e) => {
            e.stopPropagation();
            onMark({ favourite: !mark.favourite });
          }}
          className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 backdrop-blur-sm"
        >
          <Star className={cn("size-4", mark.favourite ? "fill-brand text-brand" : "text-white/80")} />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">
            {video.label} {video.name}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">{seconds(video.durationS)}</span>
        </div>
        {video.theme ? <span data-video-theme={video.theme} className="text-brand flex items-center gap-1 text-[11px]"><FeatureIcon feature="theme" className="size-3" />{video.theme}</span> : null}
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {[video.style, orderText(video), video.bars ? "bars" : null, video.layout && video.layout !== "vertical" ? video.layout : null, video.effects ? `${video.effects.verse} / ${video.effects.hook}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <TileButton active={mark.status === "approved"} onClick={() => onMark({ status: mark.status === "approved" ? "generated" : "approved" })} label={mark.status === "approved" ? "Approved" : "Approve"}>
            <Check />
          </TileButton>
          <TileButton active={discarded} onClick={() => onMark({ status: discarded ? "generated" : "discarded" })} label={discarded ? "Restore" : "Discard"}>
            {discarded ? <Undo2 /> : <Trash2 />}
          </TileButton>
          <TileButton active={selected} onClick={onCompare} label="Compare">
            <Columns3 />
          </TileButton>
          <TileButton active={false} onClick={onPost} label="Post">
            <Send />
          </TileButton>
        </div>
        <Reactions projectId={projectId} video={video} onChanged={onChanged} />
      </div>
    </div>
  );
}

function TileButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors [&_svg]:size-3.5",
        active ? "border-brand/50 bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground hover:border-foreground/30",
      )}
    >
      {children}
      {label}
    </button>
  );
}

// Reactions (Step C): a keyword under the video; the app says what it would change for the next run
// ("Next run: …"), then applies it to this song or to all the artist's songs.
type Plan = { label: string; text: string; scopes: ("song" | "artist")[]; none?: string };
function Reactions({ projectId, video, onChanged }: { projectId: string; video: VideoInfo; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; plan: Plan } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await api(`/api/songs/${projectId}/reaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video: video.id, ...body }) });
    const out = (await r.json()) as Record<string, unknown> & { error?: string };
    setBusy(false);
    if (!r.ok) {
      setError(out.error ?? "Could not do that");
      return null;
    }
    return out;
  };
  const choose = async (id: string) => {
    setDone(null);
    const plan = (await post({ reaction: id })) as Plan | null;
    if (plan) setChosen({ id, plan });
  };
  const apply = async (scope: "song" | "artist") => {
    if (!chosen) return;
    const out = (await post({ reaction: chosen.id, scope, apply: true })) as { applied?: string } | null;
    if (!out) return;
    setDone(`Done for ${out.applied}. ${chosen.plan.text.replace(/^Next run: /, "Next run: ")} (Shape → the setting's ⋯ → Back to the inherited value undoes it.)`);
    setChosen(null);
    onChanged();
  };
  if (!video.reactions.length) return null;
  return (
    <div className="text-[11px]" data-reactions>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground flex items-center gap-1" data-reactions-toggle>
        <MessageSquareHeart className="size-3.5" /> React
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1">
            {video.reactions.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => void choose(r.id)}
                data-reaction={r.id}
                className={cn("rounded-full border px-2 py-0.5", chosen?.id === r.id ? "border-brand bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")}
              >
                {r.label}
              </button>
            ))}
          </div>
          {chosen ? (
            <div className="bg-muted/40 rounded-md p-2" data-reaction-plan>
              {chosen.plan.none ? (
                <p className="text-muted-foreground">Nothing to change: {chosen.plan.none}.</p>
              ) : (
                <>
                  <p>{chosen.plan.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button type="button" disabled={busy} onClick={() => void apply("song")} className="border-brand/50 bg-brand/15 text-brand rounded-md border px-2 py-0.5" data-reaction-apply="song">
                      This song
                    </button>
                    {chosen.plan.scopes.includes("artist") ? (
                      <button type="button" disabled={busy} onClick={() => void apply("artist")} className="rounded-md border px-2 py-0.5" data-reaction-apply="artist">
                        All my songs
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setChosen(null)} className="text-muted-foreground px-1">
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          {done ? <p className="text-emerald-300" data-reaction-done>{done}</p> : null}
          {error ? <p className="text-red-300">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
