"use client";

// Music-video shots where Paul works (27 Nov 2026, Paul: "once I loaded the music video, I should see each video next to
// each shot planned and also on the lip-sync screen"): a strip of shots (a thumbnail to watch, the video's name, why)
// with one button each. Used next to each planned shot (Production: "Use for this shot") and on each line (Lyrics Sync:
// "Use on this line").
import { Check, Clapperboard, Loader2, Lock, Star } from "lucide-react";

import { cn } from "@/lib/utils";

export type MvStripShot = {
  key: string;
  url: string; // the music video's file (/api/files/…)
  fromS: number; // the shot in the video (seconds)
  toS: number;
  title: string; // "Music video 0:54–2:15 · shot 3"
  sub: string; // its time and lines, or why the app picks it
  inUse: boolean;
  best?: boolean; // the app's pick for this line
  hd?: boolean;
  note?: string | null; // e.g. "16:9: plays in your 16:9 videos (YouTube, Film 16:9) only"
  usedWord?: string; // what "in use" means here (default "Synced": on its line, in time with the song)
};

// compact: the button under the words (a narrow column, Lyrics Sync).
export function MvShotStrip({
  shots,
  action,
  busy,
  onUse,
  play,
  locked,
  compact,
}: {
  shots: MvStripShot[];
  action: string;
  busy: string | null;
  onUse: (s: MvStripShot) => void;
  play: (url: string, title: string) => void;
  locked?: string | null;
  compact?: boolean;
}) {
  if (!shots.length) return null;
  const use = (s: MvStripShot) =>
    s.inUse ? (
      <span
        data-mv-strip-used
        className="flex shrink-0 items-center gap-1 text-emerald-300"
      >
        <Check className="size-3" /> {s.usedWord ?? "Synced"}
      </span>
    ) : (
      <button
        type="button"
        data-mv-strip-use={s.key}
        disabled={busy !== null}
        onClick={() => onUse(s)}
        className={cn(
          "hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5",
          busy === s.key && "opacity-60",
        )}
      >
        {busy === s.key ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Check className="size-3" />
        )}{" "}
        {action}
      </button>
    );
  return (
    <div
      data-mv-strip
      className="flex flex-col gap-1 rounded-md border border-sky-500/25 bg-sky-500/5 p-1.5 text-[11px]"
    >
      <span className="flex items-center gap-1 text-sky-200">
        <Clapperboard className="size-3" /> From your music videos
        {locked ? (
          <span
            className="text-muted-foreground ml-1 flex items-center gap-1"
            data-mv-strip-locked
          >
            <Lock className="size-3" /> {locked}
          </span>
        ) : null}
      </span>
      <div className="flex flex-col gap-1">
        {shots.map((s) => (
          <div
            key={s.key}
            data-mv-strip-shot={s.key}
            className="flex items-center gap-1.5"
          >
            <button
              type="button"
              onClick={() =>
                play(
                  `${s.url}#t=${s.fromS.toFixed(2)},${s.toS.toFixed(2)}`,
                  s.title,
                )
              }
              className="shrink-0"
              title="Watch this shot"
            >
              <video
                src={`${s.url}#t=${((s.fromS + s.toS) / 2).toFixed(2)}`}
                muted
                playsInline
                preload="metadata"
                className="bg-muted h-10 w-16 rounded object-cover"
              />
            </button>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate">
                {s.best ? (
                  <Star
                    className="mr-0.5 inline size-3 fill-amber-300 text-amber-300"
                    aria-label="The app's pick"
                  />
                ) : null}
                <b>{s.title}</b>
                {s.hd ? (
                  <span className="ml-1 rounded bg-emerald-400/15 px-1">
                    1080p
                  </span>
                ) : null}
              </span>
              <span
                className="text-muted-foreground line-clamp-2"
                title={s.sub}
              >
                {s.sub}
              </span>
              {s.note ? (
                <span data-mv-strip-note className="text-amber-200/90" title={s.note}>
                  {s.note}
                </span>
              ) : null}
              {compact ? <span className="mt-0.5 flex">{use(s)}</span> : null}
            </span>
            {compact ? null : use(s)}
          </div>
        ))}
      </div>
    </div>
  );
}
