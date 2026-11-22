"use client";

import { AlertTriangle, Eye, RotateCw, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { SongCard as Song } from "@lyric/video/library";
import { CHIP_TITLE, chipCount, chipState, songSummary, type ChipState } from "@lyric/video/library-status";

import { SongStyleBadge } from "@/components/song-style";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { FeatureIcon, PlatformMark } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

const minutes = (ms: number | null) => (ms ? `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}` : null);
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// One colour system everywhere on the card (Step H): grey not made, amber to review, green approved,
// red failed / stopped.
const CHIP_STYLE: Record<ChipState, string> = {
  none: "border-border text-muted-foreground/60",
  rendering: "border-brand/40 bg-brand/10 text-brand animate-pulse",
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  review: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  error: "border-red-400/30 bg-red-400/10 text-red-300",
  stopped: "border-red-400/30 bg-red-400/10 text-red-300",
};

// The platforms a card shows: the song's own platforms (song.json "platforms") plus any it already has
// videos for; without its own list every platform, except "Standard" while the song has none of it.
export function cardPlatforms(song: Song) {
  const wanted = song.wanted;
  return song.platforms
    .map((p) => ({ ...p, state: chipState(p) }))
    .filter((p) => (wanted ? wanted.includes(p.name) || p.state !== "none" : p.name !== "standard" || p.state !== "none"));
}

export function SongCard({ song }: { song: Song }) {
  const length = minutes(song.durationMs);
  const platforms = cardPlatforms(song);
  const summary = songSummary(platforms.map((p) => p.state));
  const href = `/songs/${song.id}`;
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const stopped = platforms.find((p) => p.state === "stopped" && p.resumeFolder);

  async function resume() {
    if (!stopped?.resumeFolder) return;
    setResumeNote("Queuing…");
    const r = await api("/api/runs/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: song.id, folder: stopped.resumeFolder }) });
    const body = (await r.json()) as { error?: string };
    setResumeNote(r.ok ? "Queued: see Tasks." : (body.error ?? "Could not resume"));
    if (r.ok) window.dispatchEvent(new Event("lyric-tasks-changed"));
  }

  const action =
    summary.action === "generate" ? (
      <Link href={`${href}?tab=generate`} className={ACTION} data-card-action="generate">
        <Sparkles className="size-3.5" /> Generate
      </Link>
    ) : summary.action === "fix" ? (
      <Link href={`${href}?tab=videos`} className={cn(ACTION, "border-red-400/40 text-red-200")} data-card-action="fix">
        <Wrench className="size-3.5" /> Fix
      </Link>
    ) : summary.action === "resume" ? (
      stopped ? (
        <button type="button" onClick={resume} disabled={!!resumeNote} className={cn(ACTION, "border-red-400/40 text-red-200")} data-card-action="resume">
          <RotateCw className="size-3.5" /> {resumeNote ?? "Resume"}
        </button>
      ) : (
        <Link href={`${href}?tab=videos`} className={cn(ACTION, "border-red-400/40 text-red-200")} data-card-action="fix">
          <Wrench className="size-3.5" /> Fix
        </Link>
      )
    ) : summary.action === "review" ? (
      <Link href={`${href}?tab=videos`} className={cn(ACTION, "border-amber-400/40 text-amber-200")} data-card-action="review">
        <Eye className="size-3.5" /> Review
      </Link>
    ) : null;

  return (
    <div data-song={song.title} data-filters={summary.filters.join(" ")} className="group bg-card hover:border-brand/40 flex flex-col rounded-xl border transition-colors">
      <Link href={href} className="relative block aspect-square overflow-hidden rounded-t-xl bg-gradient-to-br from-[#2a1820] via-[#141417] to-[#0b0b0d]" tabIndex={-1}>
        {song.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files
          <img src={`/api/files/${song.cover}`} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-center justify-center p-6 text-center">
            <span className="font-display text-brand text-2xl leading-snug tracking-[0.12em] uppercase">{song.title}</span>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Link href={href} className="min-w-0">
          <h2 className="line-clamp-2 text-base leading-snug" title={song.title}>
            {song.title}
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {song.artist}
            {song.ep ? ` · ${song.ep}` : ""}
            {length ? ` · ${length}` : ""}
          </p>
          {/* Song style (song-style.ts), always named: Paul's three levels; then the theme and Film look. */}
          {song.songStyle ? (
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[11px]">
              <SongStyleBadge style={song.songStyle} className={song.songStyle === "film" ? "text-sky-300" : song.songStyle === "singing" ? "text-violet-300" : ""} />
              {song.theme || song.filmLook ? <span aria-hidden>·</span> : null}
              {song.theme ? (
                <span data-card-theme={song.theme} className="flex min-w-0 items-center gap-1 truncate" title={`Theme: ${song.theme} (Shape → Theme to change it)`}>
                  <FeatureIcon feature="theme" className="size-3 shrink-0" /> <span className="truncate">{song.theme}</span>
                </span>
              ) : null}
              {song.filmLook ? (
                <span data-card-film-look={song.filmLook} className="flex min-w-0 items-center gap-1 truncate" title={`Film look: ${song.filmLook} (Prepare → Creation to change it)`}>
                  {song.theme ? <span aria-hidden>·</span> : null}
                  <FeatureIcon feature="filmLook" className="size-3 shrink-0" /> <span className="truncate">{song.filmLook}</span>
                </span>
              ) : null}
            </p>
          ) : null}
        </Link>
        <p className={cn("text-xs", summary.errors ? "text-red-300" : summary.review ? "text-amber-200" : summary.ready ? "text-emerald-300" : "text-muted-foreground")} data-summary>
          {summary.text}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Videos per platform">
          {platforms.map((p) => {
            const chip = (
              <>
                <PlatformMark platform={p.name} />
                <span>{p.label}</span>
                <span className="font-medium tabular-nums">{chipCount(p, p.state)}</span>
              </>
            );
            return (
              <li key={p.name} data-platform={p.name} data-state={p.state}>
                {p.state === "error" || p.state === "stopped" ? (
                  <StatusBadge
                    status={p.state === "error" ? "FAILED" : "interrupted"}
                    details={p.details}
                    resumeCommand={p.resumeCommand}
                    resume={p.resumeFolder ? { projectId: song.id, folder: p.resumeFolder } : null}
                    heading={`${p.label}: ${CHIP_TITLE[p.state]}`}
                    className={cn("gap-1.5 whitespace-nowrap", CHIP_STYLE[p.state])}
                  >
                    {chip}
                  </StatusBadge>
                ) : (
                  <span title={`${p.label}: ${CHIP_TITLE[p.state]}${p.state === "review" ? ` (${p.videos} video${p.videos === 1 ? "" : "s"})` : p.state === "ready" ? ` (${p.approved} approved)` : ""}`} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] whitespace-nowrap", CHIP_STYLE[p.state])}>
                    {chip}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {song.sameCover.length ? (
          <p className="flex items-center gap-1 text-[11px] text-amber-200" data-same-cover title="Two songs with the same cover look alike in the Library and on your profile.">
            <AlertTriangle className="size-3 shrink-0" /> Same cover as {song.sameCover.join(", ")}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-[11px]">{song.lastRun ? `Last made ${when(song.lastRun)}` : `Added ${when(song.createdAt)}`}</p>
          {action}
        </div>
      </div>
    </div>
  );
}

const ACTION = "border-border hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap";
