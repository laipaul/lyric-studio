"use client";

import { ArrowLeft, FolderOpen, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CollectionDetail, CollectionSummary, RemovedCollection } from "@lyric/video/collections";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const minutes = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : seconds(ms));
const win = (p: string) => p.split("/").join("\\");

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await api(url, { cache: "no-store", ...init });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
  return d;
}
const openFolder = (collection: string) => void api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collection }) });

type Dialogue = { kind: "new" } | { kind: "rename"; c: CollectionSummary } | { kind: "remove"; c: CollectionSummary } | null;

// The shared clip collections (workspace\collections\<name>\): one card each with a ⋯ menu (Rename, Open
// folder, Delete), the "New collection" tile first in the grid, and the removed ones (collections\_removed\) with Restore.
export function CollectionsList() {
  const [list, setList] = useState<CollectionSummary[] | null>(null);
  const [removed, setRemoved] = useState<RemovedCollection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const load = () =>
    call<{ collections: CollectionSummary[]; removed: RemovedCollection[] }>("/api/collections")
      .then((d) => (setList(d.collections), setRemoved(d.removed ?? [])))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function act(work: () => Promise<string | null>) {
    setError(null);
    setNotice(null);
    try {
      const text = await work();
      setDialogue(null);
      if (text) setNotice(text);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const create = (name: string) =>
    act(async () => {
      const d = await call<{ name: string }>("/api/collections", { method: "POST", ...json({ name }) });
      window.location.href = `/collections/${encodeURIComponent(d.name)}`;
      return null;
    });
  const rename = (c: CollectionSummary, to: string) =>
    act(async () => {
      const d = await call<{ name: string }>(`/api/collections/${encodeURIComponent(c.name)}`, { method: "PATCH", ...json({ rename: to }) });
      return d.name === c.name ? null : `“${c.name}” is now “${d.name}”${c.songs.length ? ` (${songCount(c.songs.length)} follow the new name)` : ""}.`;
    });
  const remove = (c: CollectionSummary) =>
    act(async () => {
      await call(`/api/collections/${encodeURIComponent(c.name)}?whole=1`, { method: "DELETE" });
      return `“${c.name}” moved to collections\\_removed\\ (nothing deleted; Restore below brings it back).`;
    });
  const restore = (r: RemovedCollection) =>
    act(async () => {
      const d = await call<{ name: string }>("/api/collections", { method: "POST", ...json({ restore: r.folder }) });
      return `“${d.name}” is back. Add it to a song in Prepare → Storyboard to use it.`;
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-brand flex items-center gap-2 text-xl tracking-[0.14em] uppercase"><FeatureIcon feature="collection" className="size-5" /> Collections</h1>
          <p className="text-muted-foreground text-sm">Clips every song can use: add a collection to a song in Prepare → Storyboard. Each lives in a folder of your workspace.</p>
        </div>
      </div>
      {error && !dialogue ? <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">{error}</p> : null}
      {notice ? (
        <p role="status" className="border-brand/30 bg-brand/10 rounded-md border px-4 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      {!list ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4" data-collections-grid>
          {/* "New collection" as the first tile, like the Themes page (1 Nov 2026, asked by the user). */}
          <li>
            <button type="button" data-new-collection-tile onClick={() => setDialogue({ kind: "new" })} className="hover:border-brand/60 hover:text-foreground text-muted-foreground flex size-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors">
              <span className="border-brand/50 text-brand flex size-12 items-center justify-center rounded-full border">
                <Plus className="size-6" />
              </span>
              <span className="text-sm font-medium">New collection</span>
              {!list.length ? <span className="text-xs">Create one, then drop your clips into it.</span> : null}
            </button>
          </li>
          {list.map((c) => (
            <CollectionCard key={c.name} c={c} onRename={() => setDialogue({ kind: "rename", c })} onRemove={() => setDialogue({ kind: "remove", c })} />
          ))}
        </ul>
      )}
      {removed.length ? (
        <details className="text-sm" data-removed-collections>
          <summary className="text-muted-foreground cursor-pointer">Removed collections ({removed.length}) · kept in collections\_removed\</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {removed.map((r) => (
              <li key={r.folder} className="flex items-center gap-3 text-xs" data-removed-collection={r.name}>
                <span>{r.name}</span>
                {r.removedAt ? <span className="text-muted-foreground">removed {new Date(r.removedAt).toLocaleString()}</span> : null}
                <Button size="sm" variant="ghost" onClick={() => restore(r)} data-restore-collection={r.name}>
                  <RotateCcw /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <CollectionDialogue dialogue={dialogue} error={error} onClose={() => (setDialogue(null), setError(null))} onCreate={create} onRename={rename} onRemove={remove} />
    </div>
  );
}

const songCount = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

function CollectionCard({ c, onRename, onRemove }: { c: CollectionSummary; onRename: () => void; onRemove: () => void }) {
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const href = `/collections/${encodeURIComponent(c.name)}`;
  // What each format can use: amber when it cannot use every clip of the collection.
  const usable = (label: string, n: number, title: string) => (
    <span
      title={title}
      className={cn("rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums", n < c.clips ? "border-amber-400/40 text-amber-200" : "text-muted-foreground border-border")}
    >
      {label} · {n}
    </span>
  );
  return (
    <li data-collection={c.name} className="bg-card hover:border-brand/50 relative flex flex-col overflow-hidden rounded-xl border transition-colors">
      <Link href={href} className="flex flex-col">
        {c.thumbs.length ? (
          <div className="grid aspect-[16/9] grid-cols-4 gap-0.5 bg-black">
            {c.thumbs.map((t) => (
              // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
              <img key={t} src={`/api/files/${t}`} alt="" className="size-full object-cover" />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground flex aspect-[16/9] flex-col items-center justify-center gap-2 border-b border-dashed bg-black/40 text-sm" data-empty-collection>
            <Upload className="size-5" />
            Add clips
          </div>
        )}
      </Link>
      <div className="flex flex-col gap-1.5 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="font-display tracking-[0.1em] uppercase">
            {c.name}
          </Link>
          <div ref={box} className="relative -mt-1 -mr-1">
            <button type="button" aria-label={`More for ${c.name}`} data-collection-menu={c.name} onClick={() => setMenu((m) => !m)} className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md p-1">
              <MoreHorizontal className="size-4" />
            </button>
            {menu ? (
              <div role="menu" className="bg-popover absolute top-7 right-0 z-20 flex w-40 flex-col rounded-md border p-1 text-sm shadow-lg">
                <MenuItem onClick={() => (setMenu(false), onRename())} data-rename>
                  <Pencil className="size-3.5" /> Rename
                </MenuItem>
                <MenuItem onClick={() => (setMenu(false), openFolder(c.name))}>
                  <FolderOpen className="size-3.5" /> Open folder
                </MenuItem>
                <MenuItem onClick={() => (setMenu(false), onRemove())} data-delete className="text-amber-200">
                  <Trash2 className="size-3.5" /> Delete…
                </MenuItem>
              </div>
            ) : null}
          </div>
        </div>
        <p className="text-muted-foreground text-xs" data-counts>
          {c.clips} clip{c.clips === 1 ? "" : "s"}
          {c.photos ? ` (${c.photos} photo${c.photos === 1 ? "" : "s"})` : ""}
          {c.durationMs ? ` · ${minutes(c.durationMs)}` : ""}
        </p>
        {c.clips ? (
          <div className="flex gap-1.5" data-usable-chips>
            {usable("9:16", c.usable.vertical, `Reels, TikTok, Shorts and Canvas can use ${c.usable.vertical} of ${c.clips} clips (vertical and square ones)`)}
            {usable("16:9", c.usable.horizontal, `YouTube can use ${c.usable.horizontal} of ${c.clips} clips (horizontal and square ones)`)}
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs" title={c.songs.map((s) => s.title).join("\n")} data-used-by>
          {c.songs.length ? `Used by ${songCount(c.songs.length)}` : "Not used by a song yet"}
        </p>
        {c.sameAs ? (
          <p className="text-xs text-amber-200" data-same-as>
            Same clips as “{c.sameAs}”
          </p>
        ) : null}
      </div>
    </li>
  );
}

function MenuItem({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" role="menuitem" className={cn("hover:bg-accent flex items-center gap-2 rounded px-2 py-1.5 text-left", className)} {...props} />;
}

// New / Rename (a name) and Delete (a confirmation naming the songs that use it).
function CollectionDialogue({
  dialogue,
  error,
  onClose,
  onCreate,
  onRename,
  onRemove,
}: {
  dialogue: Dialogue;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (c: CollectionSummary, to: string) => void;
  onRemove: (c: CollectionSummary) => void;
}) {
  const title = dialogue?.kind === "new" ? "New collection" : dialogue?.kind === "rename" ? `Rename “${dialogue.c.name}”` : dialogue ? `Delete “${dialogue.c.name}”?` : "";
  return (
    <Dialog open={!!dialogue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-collection-dialogue={dialogue?.kind}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {dialogue?.kind === "new"
              ? "An empty folder in your workspace; drop clips into it next."
              : dialogue?.kind === "rename"
                ? `The folder is renamed${dialogue.c.songs.length ? ` and ${songCount(dialogue.c.songs.length)} using it follow the new name` : ""}. Nothing else changes.`
                : dialogue
                  ? "The folder moves to collections\\_removed\\ — nothing is deleted, and you can restore it from this page."
                  : ""}
          </DialogDescription>
        </DialogHeader>
        {dialogue?.kind === "remove" ? (
          <div className="flex flex-col gap-3 text-sm">
            {dialogue.c.songs.length ? (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2" data-delete-songs>
                <p>These songs use it and will stop using it (their own clips and other collections stay):</p>
                <ul className="mt-1 list-disc pl-5">
                  {dialogue.c.songs.map((s) => (
                    <li key={s.id}>{s.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? <p className="text-amber-200">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => onRemove(dialogue.c)} data-confirm-delete>
                <Trash2 /> Delete
              </Button>
            </div>
          </div>
        ) : dialogue ? (
          <NameForm
            key={dialogue.kind === "rename" ? `rename:${dialogue.c.name}` : "new"}
            initial={dialogue.kind === "rename" ? dialogue.c.name : ""}
            action={dialogue.kind === "new" ? "Create" : "Rename"}
            error={error}
            onCancel={onClose}
            onSubmit={(name) => (dialogue.kind === "new" ? onCreate(name) : onRename(dialogue.c, name))}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ initial, action, error, onCancel, onSubmit }: { initial: string; action: string; error: string | null; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name);
      }}
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="collection name" data-collection-name />
      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()} data-save-name>
          {action}
        </Button>
      </div>
    </form>
  );
}

// One collection: its clips as a grid (hover plays them), drop or "Add clips" to copy clips in, Remove
// moves a clip to _removed\ (never deleted), Restore brings it back; Open folder shows it in Explorer.
export function CollectionView({ name }: { name: string }) {
  const [data, setData] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = `/api/collections/${encodeURIComponent(name)}`;
  const load = () => call<CollectionDetail>(url).then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per collection
  }, [name]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await work() });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const add = (files: FileList | File[]) =>
    [...files].length &&
    run(async () => {
      const body = new FormData();
      for (const f of files) body.append("clips", f);
      const r = await call<{ added: string[]; duplicates: { name: string; sameAs: string }[]; skipped: { name: string; reason: string }[] }>(url, { method: "POST", body });
      return [
        r.added.length ? `Added ${r.added.length}: ${r.added.join(", ")}.` : "",
        ...r.duplicates.map((d) => `${d.name} is already here (${d.sameAs}).`),
        ...r.skipped.map((s) => `${s.name} skipped: ${s.reason}.`),
      ]
        .filter(Boolean)
        .join(" ") || "Nothing added.";
    });
  const remove = (clip: string) => run(async () => (await call(`${url}?clip=${encodeURIComponent(clip)}`, { method: "DELETE" }), `${clip} moved to _removed\\ (nothing deleted; Restore brings it back).`));
  const restore = (clip: string) =>
    run(async () => (await call(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: clip }) }), `${clip} is back in the collection.`));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6" data-collection-view={name}>
      <Link href="/collections" className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Collections
      </Link>
      {error ? <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">{error}</p> : null}
      {data ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-brand flex items-center gap-2 text-xl tracking-[0.14em] uppercase"><FeatureIcon feature="collection" className="size-5" /> {data.name}</h1>
              <p className="text-muted-foreground text-xs" data-usable>
                {data.clips} clip{data.clips === 1 ? "" : "s"}
                {data.durationMs ? ` · ${minutes(data.durationMs)} of video` : ""} · 9:16 platforms can use {data.usable.vertical} · YouTube (16:9) can use {data.usable.horizontal} · {win(data.folder)}
              </p>
              <p className="text-muted-foreground text-xs" data-used-by>
                {data.songs.length ? (
                  <>
                    Used by{" "}
                    {data.songs.map((s, i) => (
                      <span key={s.id}>
                        {i ? ", " : ""}
                        <Link href={`/songs/${s.id}`} className="hover:text-foreground underline underline-offset-2">
                          {s.title}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  "Not used by a song yet: add it to a song in Prepare → Storyboard."
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => openFolder(data.name)}>
                <FolderOpen /> Open folder
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                <Upload /> Add clips
              </Button>
              <input ref={input} type="file" multiple accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.jpg,.jpeg,.png,.webp" className="hidden" data-clip-input onChange={(e) => e.target.files && add(e.target.files)} />
            </div>
          </div>
          <div
            data-dropzone
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer.files);
            }}
            className={cn("rounded-xl border border-dashed p-4 transition-colors", dragging ? "border-brand bg-brand/10" : "border-border")}
          >
            {data.list.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {data.list.map((c) => (
                  <ClipCard key={c.name} clip={c} folder={data.folder} busy={busy} onRemove={() => remove(c.name)} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">Drop videos and photos here (or “Add clips”). They are copied into this collection&apos;s folder.</p>
            )}
          </div>
          {data.removed.length ? (
            <details className="text-sm" data-removed>
              <summary className="text-muted-foreground cursor-pointer">Removed ({data.removed.length}) · kept in {win(data.folder)}\_removed\</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {data.removed.map((r) => (
                  <li key={r} className="flex items-center gap-3 text-xs">
                    <span>{r}</span>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => restore(r)} data-restore={r}>
                      <RotateCcw /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {notice ? (
            <p role="status" className={cn("rounded-md border px-4 py-2 text-sm", notice.ok ? "border-brand/30 bg-brand/10" : "border-amber-400/30 bg-amber-400/10 text-amber-100")}>
              {notice.text}
            </p>
          ) : null}
        </>
      ) : !error ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : null}
    </div>
  );
}

function ClipCard({ clip: c, folder, busy, onRemove }: { clip: CollectionDetail["list"][number]; folder: string; busy: boolean; onRemove: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <li data-clip={c.name} className="bg-card flex flex-col overflow-hidden rounded-lg border">
      <div
        className="group relative aspect-[9/12] bg-black"
        onMouseEnter={() => video.current?.play().catch(() => {})}
        onMouseLeave={() => {
          if (video.current) {
            video.current.pause();
            video.current.currentTime = 0;
          }
        }}
      >
        {c.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
          <img src={`/api/files/${c.thumb}`} alt="" className="absolute inset-0 size-full object-contain" />
        ) : null}
        {c.kind === "video" ? (
          <video ref={video} src={`/api/files/${[...folder.split("/"), c.name].map(encodeURIComponent).join("/")}`} muted loop playsInline preload="none" className="absolute inset-0 size-full object-contain opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
        <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">{c.orientation}</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2 text-xs">
        <p className="truncate font-medium" title={c.name}>
          {c.name}
        </p>
        <p className="text-muted-foreground">
          {c.kind === "photo" ? "photo" : seconds(c.durationMs)} · {c.width}×{c.height}
        </p>
        {c.duplicateOf ? <p className="text-amber-300">same content as {c.duplicateOf} (used once)</p> : null}
        <button type="button" data-remove={c.name} disabled={busy} onClick={onRemove} className="text-muted-foreground hover:text-foreground mt-1 flex w-fit items-center gap-1">
          <Trash2 className="size-3" /> Remove
        </button>
      </div>
    </li>
  );
}
