"use client";

// "Pick a frame from a video" (Paul, 21 Nov 2026): drop a video, the app takes frames from it and puts the best faces
// first (the local face check: big, sharp, facing the camera, eyes open); click one and use it as a picture. The video
// itself is only read. Used on the Characters page (a card's picture, its second picture) and in Creation.
import { Check, Film, Loader2 } from "lucide-react";
import { useState } from "react";

import type { FramesResult } from "@lyric/video/characters";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
const VERDICT_STYLE: Record<string, string> = { Ready: "bg-emerald-500/80", "Usable with fix": "bg-amber-500/80", "Not suitable": "bg-red-500/80", "No face": "bg-black/70" };

export function FramePicker({ open, onOpenChange, onPick, use = "Use this frame" }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (file: File) => Promise<void> | void; use?: string }) {
  const [busy, setBusy] = useState<"frames" | "use" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FramesResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function take(video: File) {
    setBusy("frames");
    setError(null);
    setResult(null);
    setChosen(null);
    try {
      const form = new FormData();
      form.set("video", video);
      const r = await api("/api/frames", { method: "POST", body: form });
      const d = (await r.json()) as FramesResult & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setResult(d);
      setChosen(d.frames[0]?.url ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function useFrame() {
    const f = result?.frames.find((x) => x.url === chosen);
    if (!f || !result) return;
    setBusy("use");
    setError(null);
    try {
      const blob = await (await fetch(`/api/files/${f.url}`)).blob();
      const stem = result.video.replace(/\.[^.]+$/, "");
      await onPick(new File([blob], `${stem} frame ${clock(f.atMs).replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" }));
      onOpenChange(false);
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent data-frame-picker className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick a frame from a video</DialogTitle>
          <DialogDescription>Drop a video: the app takes frames from it and puts the best faces first (checked on this PC, for free). Your video is not changed.</DialogDescription>
        </DialogHeader>
        <label
          data-frame-drop
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void take(f);
          }}
          className={cn("hover:border-brand/60 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors", over && "border-brand bg-brand/10")}
        >
          <Film className="text-brand size-6 shrink-0" />
          <span>{result ? `${result.video}: click another video to start again` : "Drop a video here, or click to choose one (.mp4, .mov, .webm)"}</span>
          <input data-frame-video type="file" accept=".mp4,.m4v,.mov,.webm,.mkv,.avi,video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])} />
        </label>
        {busy === "frames" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" /> Taking frames and checking the faces… The first time, the face checks install themselves (about a minute).
          </p>
        ) : null}
        {error ? <p className="text-xs text-red-300" data-frame-error>{error}</p> : null}
        {result ? (
          <>
            <p className="text-muted-foreground text-xs" data-frame-note>
              {result.ranked ? "Best faces first." : result.note} Click a frame, then {use.toLowerCase()}.
            </p>
            <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" data-frame-grid>
              {result.frames.map((f, i) => (
                <button key={f.url} type="button" data-frame={f.url} onClick={() => setChosen(f.url)} onDoubleClick={() => (setChosen(f.url), void useFrame())} title={f.reasons.join(" · ") || undefined} className={cn("relative overflow-hidden rounded-md border-2", chosen === f.url ? "border-brand" : "border-transparent")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a frame served by /api/files */}
                  <img src={`/api/files/${f.url}`} alt="" className="aspect-[3/4] w-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px]">{clock(f.atMs)}</span>
                  {f.verdict ? <span className={cn("absolute right-1 bottom-1 rounded px-1 text-[10px] text-white", VERDICT_STYLE[f.verdict] ?? "bg-black/70")}>{result.ranked && i === 0 ? `Best · ${f.verdict}` : f.verdict}</span> : null}
                  {chosen === f.url ? <Check className="bg-brand absolute top-1 right-1 size-4 rounded-full p-0.5 text-white" /> : null}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button data-frame-use disabled={!chosen || !!busy} onClick={() => void useFrame()}>
                {busy === "use" ? <Loader2 className="animate-spin" /> : <Check />} {use}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
