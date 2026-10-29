"use client";

import { ArrowLeft, FolderOpen, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CollectionDetail, CollectionSummary } from "@lyric/video/collections";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
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

// The shared clip collections (workspace\collections\<name>\): one card each, and "New collection".
export function CollectionsList() {
  const [list, setList] = useState<CollectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const load = () => call<{ collections: CollectionSummary[] }>("/api/collections").then((d) => setList(d.collections)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    try {
      const d = await call<{ name: string }>("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      window.location.href = `/collections/${encodeURIComponent(d.name)}`;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-brand text-xl tracking-[0.14em] uppercase">Collections</h1>
          <p className="text-muted-foreground text-sm">Clips every song can use (tick them in a song&apos;s Generate tab). Each lives in a folder of your workspace.</p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="new collection name" className="w-52" data-new-collection />
          <Button type="submit" disabled={!name.trim()}>
            <Plus /> New collection
          </Button>
        </form>
      </div>
      {error ? <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">{error}</p> : null}
      {!list ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !list.length ? (
        <p className="text-muted-foreground text-sm">No collections yet. Create one, then drop your clips into it.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {list.map((c) => (
            <li key={c.name} data-collection={c.name}>
              <Link href={`/collections/${encodeURIComponent(c.name)}`} className="bg-card hover:border-brand/50 flex flex-col overflow-hidden rounded-xl border transition-colors">
                <div className="grid aspect-[16/9] grid-cols-4 gap-0.5 bg-black">
                  {c.thumbs.map((t) => (
                    // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                    <img key={t} src={`/api/files/${t}`} alt="" className="size-full object-cover" />
                  ))}
                </div>
                <div className="flex flex-col gap-1 p-3 text-sm">
                  <p className="font-display tracking-[0.1em] uppercase">{c.name}</p>
                  <p className="text-muted-foreground text-xs" data-counts>
                    {c.clips} clip{c.clips === 1 ? "" : "s"}
                    {c.photos ? ` (${c.photos} photo${c.photos === 1 ? "" : "s"})` : ""}
                    {c.durationMs ? ` · ${minutes(c.durationMs)}` : ""} · 9:16 can use {c.usable.vertical} · 16:9 can use {c.usable.horizontal}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{c.songs.length ? `Used by ${c.songs.map((s) => s.title).join(", ")}` : "Not used by a song yet"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
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
              <h1 className="font-display text-brand text-xl tracking-[0.14em] uppercase">{data.name}</h1>
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
                  "Not used by a song yet: tick it in a song's Generate tab."
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
