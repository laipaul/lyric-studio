"use client";

import { Check, Columns3, Send, Star, Trash2, Undo2 } from "lucide-react";
import { useRef } from "react";

import type { VideoInfo } from "@lyric/video/exports";

import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export const seconds = (s: number | null) => (s === null ? "" : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s.toFixed(1)} s`);
export const orderText = (v: VideoInfo) => (v.order === "story" ? "story" : `shuffle ${v.seed}`);

// One finished video: its still frame (it plays muted on hover), QA badge with reasons, settings, and
// the marks: favourite, approved, discarded (hidden), compare, ready to post.
export function VideoTile({
  video,
  wide,
  selected,
  onMark,
  onCompare,
  onPost,
}: {
  video: VideoInfo;
  wide: boolean;
  selected: boolean;
  onMark: (change: { favourite?: boolean; status?: VideoInfo["mark"]["status"] }) => void;
  onCompare: () => void;
  onPost: () => void;
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
        className={cn("relative overflow-hidden rounded-t-xl bg-black", wide ? "aspect-video" : "aspect-[9/16]")}
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
        <div className="absolute top-2 left-2">
          <StatusBadge status={qa.status === "WARN" ? "WARN" : "PASS"} details={qaDetails} heading={`${video.label} ${video.name}: QA ${qa.status === "WARN" ? "warnings" : "passed"}`}>
            {qa.status === "WARN" ? "WARN" : "PASS"}
          </StatusBadge>
        </div>
        <button
          type="button"
          aria-label={mark.favourite ? "Remove from favourites" : "Add to favourites"}
          onClick={() => onMark({ favourite: !mark.favourite })}
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
