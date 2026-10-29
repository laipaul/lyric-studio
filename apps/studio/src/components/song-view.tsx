"use client";

import { Columns3, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { PlatformRun, RunInfo, VideoInfo } from "@lyric/video/exports";
import type { RunComparison } from "@lyric/video/run-settings";

import { CompareDialog } from "@/components/compare-dialog";
import { CopyButton } from "@/components/copy-button";
import { ReadyToPost } from "@/components/ready-to-post";
import { StatusBadge, type BadgeStatus } from "@/components/status-badge";
import { VideoTile } from "@/components/video-tile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export type PlatformRunView = PlatformRun & { state: { status: BadgeStatus; details: string[] } };
export type RunView = Omit<RunInfo, "platforms"> & { platforms: PlatformRunView[] };

const when = (iso: string | null, folder: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : folder;

// The song's exports: every run (also from the command line), newest first, grouped by platform; each
// run with its settings (from its manifests) next to the recipe as it is now, and "Use these settings".
export function SongView({ projectId, songTitle, runs, settings = {} }: { projectId: string; songTitle: string; runs: RunView[]; settings?: Record<string, RunComparison[]> }) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, VideoInfo["mark"]>>({});
  const [platform, setPlatform] = useState<string>("all");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [posting, setPosting] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withMark = (v: VideoInfo): VideoInfo => ({ ...v, mark: marks[v.id] ?? v.mark });
  const allVideos = useMemo(() => runs.flatMap((r) => r.platforms.flatMap((p) => p.videos)).map(withMark), [runs, marks]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = new Map<string, { label: string; n: number }>();
    for (const v of allVideos) if (v.mark.status !== "discarded") c.set(v.platform, { label: v.label, n: (c.get(v.platform)?.n ?? 0) + 1 });
    return c;
  }, [allVideos]);
  const discardedCount = allVideos.filter((v) => v.mark.status === "discarded").length;
  const visible = (v: VideoInfo) => (platform === "all" || v.platform === platform) && (showDiscarded || v.mark.status !== "discarded") && (!favouritesOnly || v.mark.favourite);

  const mark = async (v: VideoInfo, change: { favourite?: boolean; status?: VideoInfo["mark"]["status"] }) => {
    const before = withMark(v).mark;
    setMarks((m) => ({ ...m, [v.id]: { ...before, ...change } }));
    const r = await api("/api/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, video: v.id, ...change }) });
    if (!r.ok) {
      setMarks((m) => ({ ...m, [v.id]: before }));
      setError(((await r.json()) as { error?: string }).error ?? "Could not save the mark");
    } else router.refresh(); // the Post tab lists the approved videos
  };
  const toggleCompare = (v: VideoInfo) =>
    setSelected((s) => (s.includes(v.id) ? s.filter((x) => x !== v.id) : s.length >= 3 ? [...s.slice(1), v.id] : [...s, v.id]));
  const compareVideos = selected.map((id) => allVideos.find((v) => v.id === id)).filter((v): v is VideoInfo => !!v);

  if (!runs.length) {
    return <div className="text-muted-foreground flex h-48 items-center justify-center rounded-xl border border-dashed text-sm">No videos yet: choose the platforms in the Generate tab and press Generate.</div>;
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={platform === "all"} onClick={() => setPlatform("all")}>
          All <span className="opacity-60">{[...counts.values()].reduce((a, c) => a + c.n, 0)}</span>
        </Chip>
        {[...counts.entries()].map(([name, c]) => (
          <Chip key={name} active={platform === name} onClick={() => setPlatform(name)}>
            {c.label} <span className="opacity-60">{c.n}</span>
          </Chip>
        ))}
        <span className="mx-2 h-5 w-px bg-white/10" />
        <Chip active={favouritesOnly} onClick={() => setFavouritesOnly((f) => !f)}>
          Favourites only
        </Chip>
        <Chip active={showDiscarded} onClick={() => setShowDiscarded((d) => !d)}>
          Show discarded <span className="opacity-60">{discardedCount}</span>
        </Chip>
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      {[...runs].reverse().map((run) => {
        const groups = run.platforms.filter((p) => platform === "all" || p.name === platform);
        const shown = groups.map((p) => ({ p, videos: p.videos.map(withMark).filter(visible) })).filter((g) => g.videos.length || (!favouritesOnly && g.p.state.status !== "PASS" && g.p.state.status !== "WARN"));
        if (!shown.length) return null;
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
                  <StatusBadge
                    status={p.state.status}
                    details={p.state.details}
                    resumeCommand={p.state.status === "interrupted" ? run.resumeCommand : null}
                    resume={p.state.status === "interrupted" ? { projectId, folder: run.folder } : null}
                  >
                    {p.state.status === "interrupted" ? "interrupted" : p.state.status}
                  </StatusBadge>
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
      {posting ? <ReadyToPost key={posting.id} projectId={projectId} songTitle={songTitle} video={posting} onClose={() => setPosting(null)} /> : null}
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
        settings{differ ? <span className="text-amber-300"> · {differ} differ from the recipe now</span> : " · as the recipe now"}
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
