"use client";

import { ArrowLeft, Check, Disc3, Package, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { ChipState } from "@lyric/video/library-status";
import type { MakeAllPlan, ReleaseView } from "@lyric/video/releases";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Summary = { name: string; songs: number; ready: number; total: number; cover: string | null; titles: string[] };
type Candidate = { id: string; title: string; artist: string; ep: string | null; cover: string | null };
type ListData = { releases: Summary[]; removed: { file: string; name: string }[]; candidates: Candidate[] };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await api(url, { cache: "no-store", ...init });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
  return d;
}
const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const releaseUrl = (name: string) => `/api/releases/${encodeURIComponent(name)}`;
const duration = (s: number) => (s < 3600 ? `about ${Math.max(1, Math.round(s / 60))} min` : `about ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);

function Progress({ ready, total }: { ready: number; total: number }) {
  return (
    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
      <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${total ? Math.round((ready / total) * 100) : 0}%` }} />
    </div>
  );
}

// ---- the list --------------------------------------------------------------------------------------

export function ReleasesList() {
  const router = useRouter();
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () => call<ListData>("/api/releases").then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Releases</h1>
          <p className="text-muted-foreground text-sm">Songs you put out together (an EP, a batch): what is ready for each platform, and Make all for what is missing.</p>
        </div>
      </div>
      {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-200">{error}</p> : null}
      {!data ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5" data-releases-grid>
          {/* "New release" as the first tile, like Themes and Collections (1 Nov 2026, asked by the user). */}
          <li>
            <button type="button" onClick={() => setCreating(true)} data-new-release className="hover:border-brand/60 hover:text-foreground text-muted-foreground flex size-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors">
              <span className="border-brand/50 text-brand flex size-12 items-center justify-center rounded-full border">
                <Plus className="size-6" />
              </span>
              <span className="text-sm font-medium">New release</span>
              {!data.releases.length ? (
                <span className="flex items-center gap-1 px-6 text-center text-xs">
                  <Disc3 className="text-brand size-3.5 shrink-0" /> Group the songs you want to put out together.
                </span>
              ) : null}
            </button>
          </li>
          {data.releases.map((r) => (
            <li key={r.name} data-release={r.name}>
              <Link href={`/releases/${encodeURIComponent(r.name)}`} className="bg-card hover:border-brand/40 flex flex-col overflow-hidden rounded-xl border transition-colors">
                <div className="aspect-[16/9] overflow-hidden bg-gradient-to-br from-[#2a1820] via-[#141417] to-[#0b0b0d]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
                  {r.cover ? <img src={`/api/files/${r.cover}`} alt="" className="size-full object-cover" /> : null}
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <h2 className="font-display text-base tracking-[0.08em]">{r.name}</h2>
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {r.songs} song{r.songs === 1 ? "" : "s"}
                    {r.titles.length ? `: ${r.titles.join(", ")}` : ""}
                  </p>
                  <p className={cn("text-xs", r.total && r.ready === r.total ? "text-emerald-300" : "text-muted-foreground")} data-release-ready>
                    {r.ready} of {r.total} ready to post
                  </p>
                  <Progress ready={r.ready} total={r.total} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data?.removed.length ? (
        <details className="text-sm" data-removed-releases>
          <summary className="text-muted-foreground cursor-pointer">Removed releases ({data.removed.length}) · kept in releases\_removed\</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {data.removed.map((r) => (
              <li key={r.file} className="flex items-center gap-3 text-xs">
                <span>{r.name}</span>
                <Button size="sm" variant="ghost" data-restore-release={r.name} onClick={() => call("/api/releases", { method: "POST", ...json({ restore: r.file }) }).then(load).catch((e: Error) => setError(e.message))}>
                  <RotateCcw /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {data ? (
        <SongsDialog
          open={creating}
          title="New release"
          candidates={data.candidates}
          initialName=""
          initialSongs={[]}
          askName
          onClose={() => setCreating(false)}
          onSave={async (name, songs) => {
            const r = await call<{ name: string }>("/api/releases", { method: "POST", ...json({ name, songs }) });
            setCreating(false); // close it first: the list page stays alive in the background after navigating
            router.push(`/releases/${encodeURIComponent(r.name)}`);
          }}
        />
      ) : null}
    </div>
  );
}

// A name and the songs (ticked). "Pick an EP" ticks the songs that share that EP and fills in the name.
function SongsDialog({
  open,
  title,
  candidates,
  initialName,
  initialSongs,
  askName,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  candidates: Candidate[];
  initialName: string;
  initialSongs: string[];
  askName: boolean;
  onClose: () => void;
  onSave: (name: string, songs: string[]) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-songs-dialog>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Tick the songs of this release. Their videos and settings stay as they are.</DialogDescription>
        </DialogHeader>
        {open ? <SongsForm candidates={candidates} initialName={initialName} initialSongs={initialSongs} askName={askName} onClose={onClose} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SongsForm({ candidates, initialName, initialSongs, askName, onClose, onSave }: { candidates: Candidate[]; initialName: string; initialSongs: string[]; askName: boolean; onClose: () => void; onSave: (name: string, songs: string[]) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [songs, setSongs] = useState<string[]>(initialSongs);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const eps = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of candidates) if (c.ep) m.set(c.ep, [...(m.get(c.ep) ?? []), c.id]);
    return [...m.entries()];
  }, [candidates]);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave(name, songs);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {askName ? <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="release name (e.g. the EP's title)" data-release-name /> : null}
      {askName && eps.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Pick an EP:</span>
          {eps.map(([ep, ids]) => (
            <button key={ep} type="button" data-pick-ep={ep} onClick={() => (setSongs(ids), setName((n) => n || ep))} className="hover:border-brand/50 rounded-full border px-2.5 py-1">
              {ep} <span className="text-muted-foreground">{ids.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm">
              <input type="checkbox" data-song-choice={c.title} checked={songs.includes(c.id)} onChange={(e) => setSongs((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
              <span>{c.title}</span>
              <span className="text-muted-foreground text-xs">
                {c.artist}
                {c.ep ? ` · ${c.ep}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {songs.length} song{songs.length === 1 ? "" : "s"} ticked
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (askName && !name.trim())} data-save-release>
            {askName ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---- one release -----------------------------------------------------------------------------------

const CELL: Record<ChipState | "unused", { style: string; text: (c: { videos: number; approved: number }) => string; title: string }> = {
  ready: { style: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", text: (c) => `✓ ${c.approved}`, title: "approved, ready to post" },
  review: { style: "border-amber-400/30 bg-amber-400/10 text-amber-300", text: (c) => `${c.videos} to review`, title: "made, waiting for your review" },
  error: { style: "border-red-400/30 bg-red-400/10 text-red-300", text: () => "failed", title: "the last run failed: Make all makes it again" },
  stopped: { style: "border-red-400/30 bg-red-400/10 text-red-300", text: () => "stopped", title: "stopped before it was made: Make all makes it again" },
  rendering: { style: "border-brand/40 bg-brand/10 text-brand animate-pulse", text: () => "making…", title: "rendering now" },
  none: { style: "border-border text-muted-foreground/70", text: () => "—", title: "not made yet: Make all makes it" },
  unused: { style: "border-transparent text-muted-foreground/40", text: () => "·", title: "not a platform of this song (Style → platforms)" },
};

export function ReleaseDetail({ name }: { name: string }) {
  const router = useRouter();
  const [view, setView] = useState<ReleaseView | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"songs" | "rename" | "delete" | "make" | null>(null);
  const [plan, setPlan] = useState<MakeAllPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const url = releaseUrl(name);
  const load = () =>
    Promise.all([call<ReleaseView>(url), call<ListData>("/api/releases")])
      .then(([v, l]) => (setView(v), setCandidates(l.candidates)))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per release
  }, [name]);

  async function openMake() {
    setError(null);
    setPlan(null);
    setDialog("make");
    try {
      setPlan(await call<MakeAllPlan>(`${url}/make`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function makeAll() {
    setBusy(true);
    try {
      const r = await call<{ queued: { title: string; label: string }[] }>(`${url}/make`, { method: "POST" });
      setNotice(r.queued.length ? `Queued ${r.queued.length} song${r.queued.length === 1 ? "" : "s"}: ${r.queued.map((q) => `${q.title} (${q.label})`).join(", ")}. Follow them in Tasks; they render one at a time.` : "Nothing to make: every platform has a video.");
      setDialog(null);
      window.dispatchEvent(new Event("lyric-tasks-changed"));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8" data-release-view={name}>
      <Link href="/releases" className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Releases
      </Link>
      {error && dialog !== "make" ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-200">{error}</p> : null}
      {view ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-5">
              <div className="size-24 shrink-0 overflow-hidden rounded-xl border bg-gradient-to-br from-[#2a1820] to-[#0b0b0d]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
                {view.cover ? <img src={`/api/files/${view.cover}`} alt="" className="size-full object-cover" /> : null}
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl">{view.name}</h1>
                <p className={cn("text-sm", view.total && view.ready === view.total ? "text-emerald-300" : "text-muted-foreground")} data-release-summary>
                  {view.ready} of {view.total} ready to post · {view.rows.length} song{view.rows.length === 1 ? "" : "s"}
                </p>
                <div className="w-64">
                  <Progress ready={view.ready} total={view.total} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog("songs")} data-edit-songs>
                <Plus /> Songs
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog("rename")} data-rename-release>
                <Pencil /> Rename
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog("delete")} data-delete-release>
                <Trash2 /> Delete…
              </Button>
              <Button onClick={openMake} disabled={!view.rows.length} data-make-all>
                <Package /> Make all
              </Button>
            </div>
          </div>
          {notice ? (
            <p role="status" className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm">
              {notice}
            </p>
          ) : null}
          {view.missingSongs.length ? <p className="text-xs text-amber-200">{view.missingSongs.length} song(s) of this release are no longer in the Library: remove them with “Songs”.</p> : null}

          {view.rows.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm" data-release-grid>
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="px-4 py-2 font-normal">Song</th>
                    {view.platforms.map((p) => (
                      <th key={p.name} className="px-2 py-2 text-center font-normal">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.id} data-release-row={row.title} className="border-b last:border-b-0">
                      <td className="px-4 py-2">
                        <Link href={`/songs/${row.id}`} className="flex items-center gap-3 hover:underline">
                          <span className="size-9 shrink-0 overflow-hidden rounded bg-black/40">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files */}
                            {row.cover ? <img src={`/api/files/${row.cover}`} alt="" className="size-full object-cover" /> : null}
                          </span>
                          {row.title}
                        </Link>
                      </td>
                      {row.cells.map((c) => {
                        const look = CELL[c.state];
                        return (
                          <td key={c.platform} className="px-2 py-2 text-center">
                            {c.state === "unused" ? (
                              <span title={look.title} className={cn("inline-block px-2 text-xs", look.style)} data-cell={`${row.title}:${c.platform}`} data-state={c.state}>
                                {look.text(c)}
                              </span>
                            ) : (
                              <Link
                                href={`/songs/${row.id}?tab=${c.state === "none" ? "generate" : "videos"}`}
                                title={look.title}
                                data-cell={`${row.title}:${c.platform}`}
                                data-state={c.state}
                                className={cn("inline-block rounded-md border px-2 py-1 text-xs whitespace-nowrap", look.style)}
                              >
                                {look.text(c)}
                              </Link>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">No songs in this release yet: add them with “Songs”.</p>
          )}
          <p className="text-muted-foreground text-xs">✓ approved · to review · failed / stopped · — not made · “·” not a platform of that song. Click a cell to open the song.</p>
        </>
      ) : !error ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : null}

      {view ? (
        <SongsDialog
          open={dialog === "songs"}
          title={`Songs of “${view.name}”`}
          candidates={candidates}
          initialName={view.name}
          initialSongs={view.songs}
          askName={false}
          onClose={() => setDialog(null)}
          onSave={async (_n, songs) => {
            await call(url, { method: "PATCH", ...json({ songs }) });
            setDialog(null);
            await load();
          }}
        />
      ) : null}
      <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename “{name}”</DialogTitle>
            <DialogDescription>Only the release&apos;s name changes; its songs stay as they are.</DialogDescription>
          </DialogHeader>
          {dialog === "rename" ? <RenameForm initial={name} onCancel={() => setDialog(null)} onSave={async (to) => {
            const r = await call<{ name: string }>(url, { method: "PATCH", ...json({ name: to }) });
            setDialog(null);
            router.replace(`/releases/${encodeURIComponent(r.name)}`);
          }} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>The release moves to releases\_removed\ (you can restore it on the Releases page). Its songs and their videos are not touched.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button data-confirm-delete-release onClick={() => call(url, { method: "DELETE" }).then(() => (setDialog(null), router.replace("/releases"))).catch((e: Error) => setError(e.message))}>
              <Trash2 /> Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "make"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent data-make-all-dialog>
          <DialogHeader>
            <DialogTitle>Make all for “{name}”</DialogTitle>
            <DialogDescription>One video for every platform that has none yet (or whose last try failed), with each song&apos;s own recipe and clips. Videos waiting for review or approved are never made again.</DialogDescription>
          </DialogHeader>
          {error && dialog === "make" ? <p className="text-sm text-red-200">{error}</p> : null}
          {!plan ? (
            <p className="text-muted-foreground text-sm">Checking what is missing…</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              {plan.songs.length ? (
                <ul className="flex flex-col gap-1" data-make-plan>
                  {plan.songs.map((s) => (
                    <li key={s.id} data-plan-song={s.title}>
                      <span className="font-medium">{s.title}</span>
                      <span className="text-muted-foreground"> · {s.platforms.map((p) => p.label).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2" data-make-nothing>
                  <Check className="size-4 text-emerald-300" /> Nothing missing: every platform of every song has a video.
                </p>
              )}
              {plan.skipped.length ? (
                <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs" data-make-skipped>
                  <p className="mb-1">Not made yet (fix this first, then Make all again):</p>
                  <ul className="list-disc pl-5">
                    {plan.skipped.map((s) => (
                      <li key={s.id}>
                        <Link href={`/songs/${s.id}`} className="underline underline-offset-2">
                          {s.title}
                        </Link>
                        : {s.why}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plan.videos ? (
                <p className="text-muted-foreground" data-make-estimate>
                  {plan.videos} video{plan.videos === 1 ? "" : "s"}, {duration(plan.estimateS)}
                  {plan.estimateFrom === "history" ? " (from your past renders)" : " (a first guess: it learns from your renders)"}. They render one at a time; you can keep using the app,
                  or leave it running overnight.
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button onClick={makeAll} disabled={busy || !plan.videos} data-confirm-make-all>
                  <Package /> {busy ? "Queuing…" : `Make ${plan.videos} video${plan.videos === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RenameForm({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value).catch((err: Error) => setError(err.message));
      }}
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-release-new-name />
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!value.trim()} data-save-rename>
          Rename
        </Button>
      </div>
    </form>
  );
}
