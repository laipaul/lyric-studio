"use client";

// Preview of a singing take with its hidden moments (Lyrics Sync → Hide a moment, 22 Nov 2026): the take (no sound of its
// own) with the song from the take's first frame, and during each hidden moment the cover clip over it (from its own
// start point). It starts 3 s before the first moment. The video itself cuts on the nearest beats; this shows the idea
// right here, without going to Shape. The song file is only played.
import { Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Cover = { fromS: number; toS: number; clipInS: number; video: string | null };
const url = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function HidePreview({ title, take, song, syncS, hides, onClose }: { title: string; take: string; song: string; syncS: number; hides: Cover[]; onClose: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const covers = useRef<(HTMLVideoElement | null)[]>([]);
  const [on, setOn] = useState(false);
  const [showing, setShowing] = useState<number | null>(null);
  const startS = Math.max(0, (hides[0]?.fromS ?? 0) - 3);
  const play = () => {
    const vid = v.current;
    const audio = a.current;
    if (!vid || !audio) return;
    vid.currentTime = startS;
    audio.currentTime = syncS + startS;
    void Promise.all([vid.play(), audio.play()]).then(() => setOn(true)).catch(() => setOn(false));
  };
  const stop = () => {
    v.current?.pause();
    a.current?.pause();
    for (const c of covers.current) c?.pause();
    setOn(false);
  };
  useEffect(() => () => stop(), []); // stop on close
  return (
    <div data-hide-player className="bg-popover fixed right-4 bottom-24 z-40 flex w-72 flex-col gap-2 rounded-xl border p-2 shadow-2xl">
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <button type="button" onClick={on ? stop : play} className="rounded-md border p-1" aria-label={on ? "Pause" : "Play"} data-hide-player-toggle>
          {on ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="relative">
        <video
          ref={v}
          src={url(take)}
          muted
          playsInline
          preload="auto"
          className="bg-muted max-h-96 w-full rounded-lg object-contain"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            const audio = a.current;
            if (audio && !audio.paused && Math.abs(audio.currentTime - (syncS + t)) > 0.08) audio.currentTime = syncS + t;
            const k = hides.findIndex((h) => h.fromS <= t && t < h.toS && h.video);
            if (k !== showing) {
              covers.current.forEach((c, i) => {
                if (!c) return;
                if (i === k) {
                  c.currentTime = hides[i].clipInS + (t - hides[i].fromS);
                  void c.play().catch(() => undefined);
                } else c.pause();
              });
              setShowing(k < 0 ? null : k);
            }
          }}
          onEnded={stop}
        />
        {hides.map((h, i) =>
          h.video ? (
            <video key={i} ref={(el) => void (covers.current[i] = el)} src={url(h.video)} muted playsInline preload="auto" data-hide-cover={i} className={`absolute inset-0 h-full w-full rounded-lg object-cover ${showing === i ? "opacity-100" : "opacity-0"}`} />
          ) : null,
        )}
      </div>
      <audio ref={a} src={url(song)} preload="auto" />
      <span className="text-muted-foreground text-[11px]" data-hide-player-why>
        {showing !== null ? `Hidden: ${hides[showing].fromS}–${hides[showing].toS} s of the take` : `From ${startS.toFixed(1)} s of the take, with the song`}. The video cuts on the nearest beats.
      </span>
    </div>
  );
}
