"use client";

import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";

import type { VideoInfo } from "@lyric/video/exports";
import { videoTitle } from "@lyric/video/video-names";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { orderText, seconds } from "@/components/video-tile";
import { cn } from "@/lib/utils";

// 2-3 videos side by side with one play/pause and one timeline, and what differs between them.
// Mounted only while open, so it always starts at the beginning.
export function CompareDialog({ videos, open, onOpenChange }: { videos: VideoInfo[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  const all = () => refs.current.filter((v): v is HTMLVideoElement => !!v);
  const toggle = () => {
    if (playing) all().forEach((v) => v.pause());
    else {
      const t = all()[0]?.currentTime ?? 0;
      all().forEach((v) => {
        v.currentTime = Math.min(t, v.duration || t);
        v.play().catch(() => {});
      });
    }
    setPlaying(!playing);
  };
  const seek = (t: number) => {
    all().forEach((v) => (v.currentTime = Math.min(t, v.duration || t)));
    setTime(t);
  };
  // The first video leads; the others follow it when they drift.
  const follow = () => {
    const [lead, ...rest] = all();
    if (!lead) return;
    setTime(lead.currentTime);
    for (const v of rest) if (Math.abs(v.currentTime - lead.currentTime) > 0.15 && lead.currentTime < (v.duration || Infinity)) v.currentTime = lead.currentTime;
  };

  const rows: { label: string; value: (v: VideoInfo) => string }[] = [
    { label: "Platform", value: (v) => v.label },
    { label: "Run", value: (v) => v.run },
    { label: "Style", value: (v) => v.style },
    { label: "Order", value: orderText },
    { label: "Cinematic bars", value: (v) => (v.bars ? "yes" : "no") },
    { label: "Effects", value: (v) => (v.effects ? `${v.effects.verse} / ${v.effects.hook}` : "old fade") },
    { label: "Length", value: (v) => seconds(v.durationS) },
    { label: "Verdict", value: (v) => v.assessment.headline },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription>One play button and one timeline for all; differences are highlighted below.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-4">
          {videos.map((v, i) => (
            <div key={v.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <video
                ref={(el) => {
                  refs.current[i] = el;
                }}
                src={`/api/files/${v.mp4}`}
                poster={`/api/poster/${v.mp4}`}
                playsInline
                muted={i > 0}
                preload="auto"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration; // read now: the event is gone when the update runs
                  setLength((l) => Math.max(l, d || 0));
                }}
                onTimeUpdate={i === 0 ? follow : undefined}
                onEnded={() => i === 0 && setPlaying(false)}
                className={cn("max-h-[55vh] rounded-lg bg-black", v.platform === "youtube" ? "w-full" : "h-[55vh]")}
              />
              <span className="text-sm">
                {videoTitle(v, true).title}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="bg-primary text-primary-foreground rounded-full p-2">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <input type="range" min={0} max={length || 1} step={0.05} value={time} onChange={(e) => seek(Number(e.target.value))} className="accent-brand flex-1" aria-label="Timeline" />
          <span className="text-muted-foreground w-20 text-right text-xs tabular-nums">
            {seconds(time)} / {seconds(length)}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">Sound comes from the first video.</p>
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => {
              const values = videos.map(r.value);
              const differs = new Set(values).size > 1;
              return (
                <tr key={r.label} className="border-t">
                  <td className="text-muted-foreground py-1.5 pr-4">{r.label}</td>
                  {values.map((val, i) => (
                    <td key={i} className={cn("py-1.5 pr-4", differs && "text-brand font-medium")}>
                      {val}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
