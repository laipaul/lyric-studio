"use client";

import { Columns3, Loader2, Shuffle, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PlatformRun, RunInfo, VideoInfo } from "@lyric/video/exports";
import type { RunComparison } from "@lyric/video/run-settings";

import { CompareDialog } from "@/components/compare-dialog";
import { CopyButton } from "@/components/copy-button";
import { ReadyToPost } from "@/components/ready-to-post";
import { PlatformVerdict } from "@/components/assessment";
import { StatusBadge, type BadgeStatus } from "@/components/status-badge";
import { useReviewPlatform } from "@/components/song-stages";
import { VideoPlayerDialog } from "@/components/video-player";
import { VideoTile } from "@/components/video-tile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export type PlatformRunView = PlatformRun & { state: { status: BadgeStatus; details: string[] } };
export type RunView = Omit<RunInfo, "platforms"> & { platforms: PlatformRunView[] };
// A video being made or waiting in Tasks (Review's placeholder card, 11 Nov 2026).
export type MakingView = { runId: string; platform: string; label: string; status: "queued" | "running"; what: string };

const SHOW_EMPTY_KEY = "lyric-videos-show-empty-runs";

const when = (iso: string | null, folder: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : folder;

// Review (11 Nov 2026, the same layout as the other stages): one tab per platform that has videos (the stage header's
// tabs, song-stages.tsx), and here the chosen platform's videos: the approved ones first, then every other version
// newest first, each card with its run's date and time, its command and settings (folded) and "Use these settings";
// a video being made shows as a placeholder card; runs with nothing finished for this platform are behind "Show N
// empty runs". "Make another" sits in the tab's header. Marks, compare, post and the player work as before.
export function SongView({
  projectId,
  songTitle,
  runs,
  settings = {},
  making = [],
}: {
  projectId: string;
  songTitle: string;
  runs: RunView[];
  settings?: Record<string, RunComparison[]>;
  platforms?: { name: string; label: string }[]; // kept for callers; the tabs come from the videos made
  making?: MakingView[];
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, VideoInfo["mark"]>>({});
  const { platform: chosen } = useReviewPlatform();
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [posting, setPosting] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  useEffect(() => {
    try {
      setShowEmpty(localStorage.getItem(SHOW_EMPTY_KEY) === "1");
    } catch {
      // no browser storage: the default (hidden)
    }
  }, []);
  const toggleEmpty = () => {
    const next = !showEmpty;
    setShowEmpty(next);
    try {
      localStorage.setItem(SHOW_EMPTY_KEY, next ? "1" : "0");
    } catch {
      // not remembered
    }
  };

  const withMark = (v: VideoInfo): VideoInfo => ({ ...v, mark: marks[v.id] ?? v.mark });
  const allVideos = useMemo(() => runs.flatMap((r) => r.platforms.flatMap((p) => p.videos)).map(withMark), [runs, marks]); // eslint-disable-line react-hooks/exhaustive-deps
  // The platform shown: the tab chosen, else the first one with videos (or being made).
  const names = [...new Set([...runs.flatMap((r) => r.platforms.filter((p) => p.videos.length).map((p) => p.name)), ...making.map((m) => m.platform)])];
  const platform = chosen && (names.includes(chosen) || runs.some((r) => r.platforms.some((p) => p.name === chosen))) ? chosen : (names[0] ?? "");
  const discardedCount = allVideos.filter((v) => v.platform === platform && v.mark.status === "discarded").length;
  const visible = (v: VideoInfo) => v.platform === platform && (showDiscarded || v.mark.status !== "discarded") && (!favouritesOnly || v.mark.favourite);
  // While something is being made, look again now and then: its card becomes the video when it is done.
  useEffect(() => {
    if (!making.length) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [making.length, router]);

  // Marks: applied at once (marks = what the user clicked, which always wins over the page's data) and sent
  // to the server one after the other in click order. The page is refreshed once, after the last one has
  // settled, so no refresh made in between can bring back an older state. A failed save drops that video's
  // own change (back to what the server holds) and says so.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const pendingFor = useRef<Record<string, number>>({});
  const mark = (v: VideoInfo, change: { favourite?: boolean; status?: VideoInfo["mark"]["status"] }) => {
    setMarks((m) => ({ ...m, [v.id]: { ...(m[v.id] ?? v.mark), ...change } }));
    pending.current += 1;
    pendingFor.current[v.id] = (pendingFor.current[v.id] ?? 0) + 1;
    queue.current = queue.current.then(async () => {
      let saved: VideoInfo["mark"] | null = null;
      try {
        const r = await api("/api/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, video: v.id, ...change }) });
        const body = (await r.json()) as VideoInfo["mark"] & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "Could not save the mark");
        saved = { favourite: body.favourite, status: body.status };
      } catch (e) {
        setError((e as Error).message);
      }
      pending.current -= 1;
      pendingFor.current[v.id] -= 1;
      if (!pendingFor.current[v.id]) {
        if (saved) setMarks((m) => ({ ...m, [v.id]: saved! }));
        else setMarks((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== v.id)));
      }
      if (!pending.current) router.refresh(); // the Post tab lists the approved videos
    });
  };
  // This platform's runs: with its videos, and the ones with nothing finished for it (behind "Show N empty runs").
  const platformRuns = runs.map((run) => ({ run, p: run.platforms.find((x) => x.name === platform) })).filter((x): x is { run: RunView; p: PlatformRunView } => !!x.p);
  const emptyRuns = platformRuns.filter(({ p }) => !p.videos.length);
  const cards = platformRuns
    .flatMap(({ run, p }) => p.videos.map(withMark).filter(visible).map((v) => ({ v, run, p })))
    // Approved first, then every other version; each newest first.
    .sort((a, b) => Number(b.v.mark.status === "approved") - Number(a.v.mark.status === "approved") || b.v.createdAt.localeCompare(a.v.createdAt) || b.run.folder.localeCompare(a.run.folder));
  const label = platformRuns[0]?.p.label ?? making.find((m) => m.platform === platform)?.label ?? platform;
  const wide = platform === "youtube";
  const playing = playingId ? allVideos.find((v) => v.id === playingId) : null;
  const toggleCompare = (v: VideoInfo) =>
    setSelected((s) => (s.includes(v.id) ? s.filter((x) => x !== v.id) : s.length >= 3 ? [...s.slice(1), v.id] : [...s, v.id]));
  const compareVideos = selected.map((id) => allVideos.find((v) => v.id === id)).filter((v): v is VideoInfo => !!v);

  if (!runs.length && !making.length) {
    return <div className="text-muted-foreground flex h-48 items-center justify-center rounded-xl border border-dashed text-sm">No videos yet: choose the platforms in Make and press Generate.</div>;
  }

  return (
    <div className="flex flex-col gap-4 pb-24" data-review-platform={platform}>
      {/* The tab's header: the platform's verdict, Make another, the filters. */}
      <div className="flex flex-wrap items-center gap-3" data-review-header>
        <h2 className="font-display text-brand text-sm tracking-[0.14em] uppercase">{label}</h2>
        <PlatformVerdict videos={platformRuns.flatMap(({ p }) => p.videos.map(withMark)).filter((v) => v.mark.status !== "discarded")} />
        <MakeAnother projectId={projectId} runs={runs} platform={platform} onQueued={() => router.refresh()} />
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2 text-xs" data-review-filters>
          <Chip active={favouritesOnly} onClick={() => setFavouritesOnly((f) => !f)}>
            Favourites only
          </Chip>
          <Chip active={showDiscarded} onClick={() => setShowDiscarded((d) => !d)}>
            Show discarded <span className="opacity-60">{discardedCount}</span>
          </Chip>
        </div>
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <div className={cn("grid gap-4", wide ? "grid-cols-[repeat(auto-fill,minmax(360px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]")} data-review-cards>
        {/* A video being made (or waiting): a placeholder until it is there. */}
        {making
          .filter((m) => m.platform === platform)
          .map((m) => (
            <div key={`${m.runId}-${m.platform}`} data-making={m.runId} className={cn("bg-card/40 text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center text-sm", wide ? "aspect-video" : "aspect-[9/16] max-h-[420px]")}>
              {m.status === "running" ? <Loader2 className="text-brand size-5 animate-spin" /> : null}
              <span>
                {m.status === "running" ? "Making…" : "Waiting…"} {m.what}, see Tasks
              </span>
            </div>
          ))}
        {cards.map(({ v, run, p }) => (
          <div key={v.id} data-card data-run={run.folder} className="flex flex-col gap-1.5">
            <VideoTile
              projectId={projectId}
              strongest={p.strongest?.name === v.name ? p.strongest.why : null}
              onChanged={() => router.refresh()}
              video={v}
              wide={wide}
              selected={selected.includes(v.id)}
              onMark={(c) => mark(v, c)}
              onCompare={() => toggleCompare(v)}
              onPost={() => setPosting(v)}
              onPlay={() => setPlayingId(v.id)}
            />
            <RunLine projectId={projectId} run={run} p={p} settings={settings[run.folder]} />
          </div>
        ))}
      </div>
      {!cards.length && !making.some((m) => m.platform === platform) ? <p className="text-muted-foreground text-xs">No video to show with these filters.</p> : null}

      {emptyRuns.length ? (
        <button type="button" data-show-empty onClick={toggleEmpty} className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-2">
          {showEmpty ? "Hide empty runs" : `Show ${emptyRuns.length} empty run${emptyRuns.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {showEmpty && !favouritesOnly
        ? emptyRuns.map(({ run, p }) => (
            <div key={run.folder} data-run={run.folder} data-empty-run={run.folder} className="bg-card/40 flex flex-col gap-1 rounded-lg border border-dashed px-3 py-2 text-xs">
              <span className="text-muted-foreground">No finished videos in this run.</span>
              <RunLine projectId={projectId} run={run} p={p} settings={settings[run.folder]} />
            </div>
          ))
        : null}

      {selected.length ? (
        <div className="bg-popover fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-2xl">
          <span className="text-sm">{selected.length} selected (2-3 to compare)</span>
          <Button size="sm" disabled={selected.length < 2} onClick={() => setComparing(true)}>
            <Columns3 /> Compare
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} aria-label="Clear selection">
            <X />
          </Button>
        </div>
      ) : null}
      {comparing ? <CompareDialog videos={compareVideos} open onOpenChange={setComparing} /> : null}
      {playing ? (
        <VideoPlayerDialog
          key={playing.id}
          video={playing}
          onClose={() => setPlayingId(null)}
          onMark={(c) => mark(playing, c)}
          onPost={() => {
            setPlayingId(null);
            setPosting(playing);
          }}
        />
      ) : null}
      {posting ? <ReadyToPost key={posting.id} projectId={projectId} songTitle={songTitle} video={posting} onClose={() => setPosting(null)} /> : null}
    </div>
  );
}

// The next take of each platform: one more than the highest vN made for it in any run.
export function nextTakes(runs: readonly RunView[]): { name: string; label: string; take: number }[] {
  const out = new Map<string, { name: string; label: string; take: number }>();
  for (const r of runs)
    for (const p of r.platforms) {
      if (p.name === "canvas") continue; // the Canvas is one chosen loop, not takes
      const highest = Math.max(0, ...[...p.videos.map((v) => v.name), ...p.missing].map((n) => Number(/^v(\d+)$/.exec(n)?.[1] ?? 0)));
      const prev = out.get(p.name);
      out.set(p.name, { name: p.name, label: p.label, take: Math.max(prev?.take ?? 1, highest + 1) });
    }
  return [...out.values()];
}

// "Make another" in the tab's header: one more take of this platform (the next variation: its own seed and style, the
// song's recipe and clips; the Canvas is one chosen loop, so no takes). Queued in Tasks; its card shows at once.
function MakeAnother({ projectId, runs, platform, onQueued }: { projectId: string; runs: RunView[]; platform: string; onQueued: () => void }) {
  const t = nextTakes(runs).find((x) => x.name === platform);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!t) return null;
  async function take() {
    if (!t) return;
    setBusy(true);
    setNote(null);
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify({ platforms: [t.name], take: t.take }));
    try {
      const res = await api("/api/runs", { method: "POST", body });
      const result = (await res.json()) as { error?: string; label?: string };
      if (!res.ok || result.error) throw new Error(result.error ?? `The studio answered ${res.status}`);
      setNote(`Queued: ${result.label}.`);
      window.dispatchEvent(new Event("lyric-tasks-changed"));
      onQueued();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2" data-another-take>
      <Button size="sm" variant="outline" disabled={busy} data-take={t.name} onClick={() => void take()} title={`One more ${t.label} video (take ${t.take}: a different cut and look, same song and clips)`}>
        <Shuffle /> Make another
      </Button>
      {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
    </span>
  );
}

// Under each card: when its run was made (a small line, no longer a heading), and the run's command and settings
// (folded), with the run's state when it was interrupted or failed.
function RunLine({ projectId, run, p, settings }: { projectId: string; run: RunView; p: PlatformRunView; settings?: RunComparison[] }) {
  const mine = settings?.filter((x) => x.platform === p.name);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" data-card-run={run.folder}>
      <span>{when(run.time, run.folder)}</span>
      {p.state.status === "interrupted" || p.state.status === "FAILED" ? (
        <StatusBadge status={p.state.status} details={p.state.details} resumeCommand={p.state.status === "interrupted" ? run.resumeCommand : null} resume={p.state.status === "interrupted" ? { projectId, folder: run.folder } : null}>
          {p.state.status === "interrupted" ? "interrupted" : "failed"}
        </StatusBadge>
      ) : null}
      {run.command ? (
        <details className="w-full">
          <summary className="hover:text-foreground cursor-pointer">command</summary>
          <div className="mt-1 flex items-start gap-2">
            <code className="bg-muted rounded p-2 break-all">{run.command}</code>
            <CopyButton text={run.command} />
          </div>
        </details>
      ) : null}
      {settings?.length ? <RunSettings projectId={projectId} folder={run.folder} platforms={mine?.length ? mine : settings} /> : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors", active ? "border-brand/50 bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}

// What a run was made with, per platform, next to the recipe now (differences highlighted).
function RunSettings({ projectId, folder, platforms }: { projectId: string; folder: string; platforms: RunComparison[] }) {
  const differ = platforms.reduce((n, p) => n + p.rows.filter((r) => r.differs).length, 0);
  return (
    <details data-run-settings className="text-xs">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
        settings{differ ? <span className="text-amber-300"> · {differ} {differ === 1 ? "differs" : "differ"} from the recipe now</span> : " · as the recipe now"}
      </summary>
      <div className="bg-card mt-2 flex flex-col gap-3 rounded-lg border p-3">
        {platforms.map((p) => (
          <table key={p.platform} data-settings-platform={p.platform} className="w-full max-w-2xl text-left">
            <caption className="font-display text-brand mb-1 text-left text-[11px] tracking-[0.14em] uppercase">
              {p.label} · {p.videos} video{p.videos === 1 ? "" : "s"}
            </caption>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.key} data-setting={r.key} data-differs={r.differs || undefined}>
                  <td className="text-muted-foreground w-32 py-0.5 pr-3">{r.label}</td>
                  <td className={cn("py-0.5 pr-3", r.differs && "text-amber-200")}>{r.then}</td>
                  <td className="text-muted-foreground py-0.5">{r.differs ? `now: ${r.now}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        <Button size="sm" variant="secondary" className="w-fit" asChild>
          <Link href={`/songs/${projectId}?tab=generate&from=${encodeURIComponent(folder)}`} data-use-settings>
            <SlidersHorizontal /> Use these settings
          </Link>
        </Button>
      </div>
    </details>
  );
}
