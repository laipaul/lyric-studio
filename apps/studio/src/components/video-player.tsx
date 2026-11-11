"use client";

import { Check, Send, Trash2, Undo2 } from "lucide-react";

import type { VideoInfo } from "@lyric/video/exports";
import { videoTitle } from "@lyric/video/video-names";

import { VERDICT_TEXT } from "@/components/assessment";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// One video to simply watch: native controls, with sound (the tile only plays muted on hover).
// 9:16 sized to fit the dialog (`maxVh` = its height as a share of the window), 16:9 for YouTube.
export function VideoPlayer({ video, maxVh = 60, className }: { video: VideoInfo; maxVh?: number; className?: string }) {
  const wide = video.platform === "youtube";
  return (
    <video
      data-player
      src={`/api/files/${video.mp4}`}
      poster={`/api/poster/${video.mp4}`}
      controls
      playsInline
      preload="metadata"
      style={wide ? { maxHeight: `${maxVh}vh` } : { height: `${maxVh}vh` }}
      className={cn("mx-auto max-w-full rounded-lg bg-black", wide ? "aspect-video w-full" : "aspect-[9/16]", className)}
    />
  );
}

// Click on a tile's picture: the video with controls and sound, its verdict, and Approve / Discard / Post.
// Mounted only while open (so it starts at the beginning); Esc closes it.
export function VideoPlayerDialog({
  video,
  onClose,
  onMark,
  onPost,
}: {
  video: VideoInfo;
  onClose: () => void;
  onMark: (change: { favourite?: boolean; status?: VideoInfo["mark"]["status"] }) => void;
  onPost: () => void;
}) {
  const { mark, assessment: a } = video;
  const discarded = mark.status === "discarded";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-player-dialog={video.id}>
        <DialogHeader>
          <DialogTitle>
            {videoTitle(video, true).title}
          </DialogTitle>
          <DialogDescription data-player-verdict={a.verdict}>
            {VERDICT_TEXT[a.verdict]}
            {a.points.length ? ` · ${a.headline.replace(/^[^—]*—\s*/, "")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <VideoPlayer video={video} maxVh={60} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mark.status === "approved" ? "default" : "secondary"} onClick={() => onMark({ status: mark.status === "approved" ? "generated" : "approved" })}>
            <Check /> {mark.status === "approved" ? "Approved" : "Approve"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onMark({ status: discarded ? "generated" : "discarded" })}>
            {discarded ? <Undo2 /> : <Trash2 />} {discarded ? "Restore" : "Discard"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onPost}>
            <Send /> Post
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
