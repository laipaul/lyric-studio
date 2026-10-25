import Link from "next/link";

import type { PlatformStatus, SongCard as Song } from "@lyric/video/library";

import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<PlatformStatus, string> = {
  PASS: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  WARN: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  FAILED: "border-red-400/30 bg-red-400/10 text-red-300",
  Rendering: "border-brand/40 bg-brand/10 text-brand animate-pulse",
  none: "border-border text-muted-foreground/60",
};

const minutes = (ms: number | null) => (ms ? `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}` : null);
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function SongCard({ song }: { song: Song }) {
  const length = minutes(song.durationMs);
  return (
    <Link
      href={`/songs/${song.id}`}
      data-song={song.title}
      className="group bg-card hover:border-brand/40 flex flex-col overflow-hidden rounded-xl border transition-colors"
    >
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-[#2a1820] via-[#141417] to-[#0b0b0d]">
        {song.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files
          <img src={`/api/files/${song.cover}`} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-center justify-center p-6 text-center">
            <span className="font-display text-brand text-2xl leading-snug tracking-[0.12em] uppercase">{song.title}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base">{song.title}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {song.artist}
            {song.ep ? ` · ${song.ep}` : ""}
            {length ? ` · ${length}` : ""}
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-1.5" aria-label="Videos per platform">
          {song.platforms.map((p) => (
            <li
              key={p.name}
              data-platform={p.name}
              data-status={p.status}
              title={p.status === "none" ? `${p.label}: not made yet` : `${p.label}: ${p.videos} video(s), ${p.status} (${p.runs} run${p.runs === 1 ? "" : "s"})`}
              className={cn("flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-[11px]", STATUS_STYLE[p.status])}
            >
              <span className="truncate">{p.label}</span>
              <span className="font-medium tabular-nums">{p.status === "none" ? "—" : p.status === "Rendering" ? "…" : p.videos}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-auto text-[11px]">{song.lastRun ? `Last made ${when(song.lastRun)}` : `Added ${when(song.createdAt)} · no videos yet`}</p>
      </div>
    </Link>
  );
}
