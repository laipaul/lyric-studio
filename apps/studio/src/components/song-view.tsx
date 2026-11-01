"use client";

import { Columns3, Shuffle, SlidersHorizontal, X } from "lucide-react";
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
import { VideoPlayerDialog } from "@/components/video-player";
import { VideoTile } from "@/components/video-tile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export type PlatformRunView = PlatformRun & { state: { status: BadgeStatus; details: string[] } };
export type RunView = Omit<RunInfo, "platforms"> & { platforms: PlatformRunView[] };

const SHOW_EMPTY_KEY = "lyric-videos-show-empty-runs";

const when = (iso: string | null, folder: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : folder;

// The song's exports: every run (also from the command line), newest first, grouped by platform; each
// run with its settings (from its manifests) next to the recipe as it is now, and "Use these settings".
export function SongView({
  projectId,
  songTitle,
  runs,
  settings = {},
  platforms = [],
}: {
  projectId: string;
  songTitle: string;
  runs: RunView[];
  settings?: Record<string, RunComparison[]>;
  platforms?: { name: string; label: string }[]; // the platforms this song is made for (shown even before their first video)
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, VideoInfo["mark"]>>({});
  const [platform, setPlatform] = useState<string>("all");
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
  const counts = useMemo(() => {
    const c = new Map<string, { label: string; n: number }>();
    for (const v of allVideos) if (v.mark.status !== "discarded") c.set(v.platform, { label: v.label, n: (c.get(v.platform)?.n ?? 0) + 1 });
    return c;
  }, [allVideos]);
  const discardedCount = allVideos.filter((v) => v.mark.status === "discarded").length;
  const visible = (v: VideoInfo) => (platform === "all" || v.platform === platform) && (showDiscarded || v.mark.status !== "discarded") && (!favouritesOnly || v.mark.favourite);

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
  const emptyRuns = runs.filter((r) => r.platforms.some((p) => !p.videos.length)).length;
  const playing = playingId ? allVideos.find((v) => v.id === playingId) : null;
  const toggleCompare = (v: VideoInfo) =>
    setSelected((s) => (s.includes(v.id) ? s.filter((x) => x !== v.id) : s.length >= 3 ? [...s.slice(1), v.id] : [...s, v.id]));
  const compareVideos = selected.map((id) => allVideos.find((v) => v.id === id)).filter((v): v is VideoInfo => !!v);

  if (!runs.length) {
    return <div className="text-muted-foreground flex h-48 items-center justify-center rounded-xl border border-dashed text-sm">No videos yet: choose the platforms in the Generate tab and press Generate.</div>;
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PlatformOverview projectId={projectId} runs={runs} videos={allVideos} wanted={platforms} active={platform} onPick={(name) => setPlatform((p) => (p === name ? "all" : name))} />
      <div className="flex flex-wrap items-center gap-2 text-xs" data-review-filters>
        <span className="text-muted-foreground">
          {platform === "all" ? (
            "Showing every platform, newest first"
          ) : (
            <>
              Showing {counts.get(platform)?.label ?? platform} only ·{" "}
              <button type="button" data-show-all className="hover:text-foreground underline underline-offset-2" onClick={() => setPlatform("all")}>
                show all
              </button>
            </>
          )}
        </span>
        <span className="flex-1" />
        <Chip active={favouritesOnly} onClick={() => setFavouritesOnly((f) => !f)}>
          Favourites only
        </Chip>
        <Chip active={showDiscarded} onClick={() => setShowDiscarded((d) => !d)}>
          Show discarded <span className="opacity-60">{discardedCount}</span>
        </Chip>
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      {emptyRuns ? (
        <button type="button" data-show-empty onClick={toggleEmpty} className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-2">
          {showEmpty ? "Hide empty runs" : `Show ${emptyRuns} empty run${emptyRuns === 1 ? "" : "s"}`}
        </button>
      ) : null}

      {[...runs].reverse().map((run) => {
        const groups = run.platforms.filter((p) => platform === "all" || p.name === platform);
        // A group with no finished video is hidden (with the whole run when none of its groups has one).
        const shown = groups.map((p) => ({ p, videos: p.videos.map(withMark).filter(visible) })).filter((g) => (g.p.videos.length ? g.videos.length : showEmpty && !favouritesOnly));
        if (!shown.length || (!showEmpty && !run.platforms.some((p) => p.videos.length))) return null;
        return (
          <section key={run.folder} data-run={run.folder} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 border-b pb-2">
              <h2 className="text-lg">{when(run.time, run.folder)}</h2>
              {run.command ? (
                <details className="text-muted-foreground text-xs">
                  <summary className="cursor-pointer">command</summary>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="bg-muted rounded p-2 break-all">{run.command}</code>
                    <CopyButton text={run.command} />
                  </div>
                </details>
              ) : null}
              {settings[run.folder]?.length ? <RunSettings projectId={projectId} folder={run.folder} platforms={settings[run.folder]} /> : null}
            </div>
            {shown.map(({ p, videos }) => (
              <div key={p.name} data-platform-group={p.name} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-brand text-sm tracking-[0.14em] uppercase">{p.label}</h3>
                  <PlatformVerdict videos={p.videos.filter((v) => withMark(v).mark.status !== "discarded")} />
                  {p.state.status === "interrupted" || p.state.status === "FAILED" ? (
                    <StatusBadge
                      status={p.state.status}
                      details={p.state.details}
                      resumeCommand={p.state.status === "interrupted" ? run.resumeCommand : null}
                      resume={p.state.status === "interrupted" ? { projectId, folder: run.folder } : null}
                    >
                      {p.state.status === "interrupted" ? "interrupted" : "failed"}
                    </StatusBadge>
                  ) : null}
                </div>
                {videos.length ? (
                  <div className={cn("grid gap-4", p.name === "youtube" ? "grid-cols-[repeat(auto-fill,minmax(360px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]")}>
                    {videos.map((v) => (
                      <VideoTile
                        key={v.id}
                        projectId={projectId}
                        strongest={p.strongest?.name === v.name ? p.strongest.why : null}
                        onChanged={() => router.refresh()}
                        video={v}
                        wide={p.name === "youtube"}
                        selected={selected.includes(v.id)}
                        onMark={(c) => mark(v, c)}
                        onCompare={() => toggleCompare(v)}
                        onPost={() => setPosting(v)}
                        onPlay={() => setPlayingId(v.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">No finished videos in this run.</p>
                )}
              </div>
            ))}
          </section>
        );
      })}

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

// The top of Review (1 Nov 2026): one card per platform, saying what has been made for it so far
// (versions, approved, still to check, the latest date) with "Make another" for one more take (the next
// variation: its own seed and style, the song's recipe and clips; the Canvas is one chosen loop, so no
// takes). A platform of the song with nothing made yet says so, with a link to Make. Clicking a card shows
// only that platform below; clicking it again shows all.
function PlatformOverview({
  projectId,
  runs,
  videos,
  wanted,
  active,
  onPick,
}: {
  projectId: string;
  runs: RunView[];
  videos: VideoInfo[];
  wanted: { name: string; label: string }[];
  active: string;
  onPick: (name: string) => void;
}) {
  const takes = new Map(nextTakes(runs).map((t) => [t.name, t]));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cards = new Map<string, { name: string; label: string; made: number; approved: number; toCheck: number; latest: string | null }>();
  for (const w of wanted) cards.set(w.name, { name: w.name, label: w.label, made: 0, approved: 0, toCheck: 0, latest: null });
  for (const r of runs) for (const p of r.platforms) if (!cards.has(p.name)) cards.set(p.name, { name: p.name, label: p.label, made: 0, approved: 0, toCheck: 0, latest: null });
  for (const v of videos) {
    const c = cards.get(v.platform);
    if (!c || v.mark.status === "discarded") continue;
    c.made += 1;
    if (v.mark.status === "approved") c.approved += 1;
    else c.toCheck += 1;
    if (!c.latest || v.createdAt > c.latest) c.latest = v.createdAt;
  }
  async function take(t: { name: string; label: string; take: number }) {
    setBusy(t.name);
    setNote(null);
    const body = new FormData();
    body.set("projectId", projectId);
    body.set("request", JSON.stringify({ platforms: [t.name], take: t.take }));
    try {
      const res = await api("/api/runs", { method: "POST", body });
      const result = (await res.json()) as { error?: string; label?: string };
      if (!res.ok || result.error) throw new Error(result.error ?? `The studio answered ${res.status}`);
      setNote(`Queued: ${result.label}. It appears here when it is made (see Tasks).`);
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div className="flex flex-col gap-2" data-platform-overview data-another-take>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
        {[...cards.values()].map((c) => {
          const t = takes.get(c.name);
          const on = active === c.name;
          return (
            <div
              key={c.name}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              data-platform-card={c.name}
              onClick={() => c.made && onPick(c.name)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && c.made && onPick(c.name)}
              title={c.made ? (on ? "Show every platform" : `Show only ${c.label}`) : undefined}
              className={cn(
                "bg-card flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
                c.made ? "hover:border-brand/40 cursor-pointer" : "border-dashed",
                on && "border-brand/60 bg-brand/10",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-brand text-sm tracking-[0.14em] uppercase">{c.label}</span>
                {c.latest ? <span className="text-muted-foreground text-[11px]">latest {day(c.latest)}</span> : null}
              </div>
              {c.made ? (
                <p className="text-sm" data-platform-summary>
                  {c.made} version{c.made === 1 ? "" : "s"}
                  {c.approved ? <span className="text-emerald-300"> · {c.approved} approved</span> : null}
                  {c.toCheck ? <span className="text-amber-200"> · {c.toCheck} to check</span> : null}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-platform-summary>
                  Nothing made yet
                </p>
              )}
              <div className="flex items-center gap-2">
                {c.made && t ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    data-take={c.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      void take(t);
                    }}
                    title={`One more ${c.label} video (take ${t.take}: a different cut and look, same song and clips)`}
                  >
                    <Shuffle /> Make another
                  </Button>
                ) : null}
                {!c.made ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/songs/${projectId}?tab=generate`} data-make-platform={c.name} onClick={(e) => e.stopPropagation()}>
                      Make
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
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
