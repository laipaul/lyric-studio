"use client";

import { FileAudio, FileText, ImageIcon, ListMusic, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AssetKind, SongAssets } from "@lyric/video/assets";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const win = (rel: string) => rel.split("/").join("\\");
const ACCEPT: Record<AssetKind, string> = { song: ".wav,.mp3", lyrics: ".txt", cover: ".jpg,.jpeg,.png,.webp", hints: ".lrc" };

// The song's files: song, lyrics.txt, cover, hints.lrc and its own clips (drop videos and photos;
// Remove moves a clip to clips\_removed\, nothing is deleted).
export function AssetsTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SongAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const clipInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function reload() {
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { cache: "no-store" });
      const d = (await r.json()) as SongAssets & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/assets`, { cache: "no-store" })
      .then((r) => r.json() as Promise<SongAssets & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function send(body: FormData | null, method = "POST", query = ""): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/assets${query}`, { method, body });
      const result = (await r.json()) as Record<string, unknown> & { error?: string };
      if (!r.ok || result.error) throw new Error(result.error ?? `The studio answered ${r.status}`);
      await reload();
      router.refresh(); // the Generate tab counts the song's clips too
      return result;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addClips(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const body = new FormData();
    body.set("kind", "clips");
    for (const f of list) body.append("clips", f);
    const r = (await send(body)) as { added: string[]; duplicates: { name: string; sameAs: string }[]; skipped: { name: string; reason: string }[] } | null;
    if (!r) return;
    const parts = [
      r.added.length ? `Added ${r.added.length} clip${r.added.length === 1 ? "" : "s"}${r.added.some((n, i) => n !== list[i]?.name) ? ` (${r.added.join(", ")})` : ""}.` : "",
      ...r.duplicates.map((d) => `${d.name} is already here as ${d.sameAs} (same content): not added again.`),
      ...r.skipped.map((s) => `${s.name}: ${s.reason}.`),
    ].filter(Boolean);
    setNotice({ ok: !r.duplicates.length && !r.skipped.length, text: parts.join(" ") || "Nothing added." });
  }

  async function replace(kind: AssetKind, file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    if (await send(body)) setNotice({ ok: true, text: `${file.name} is now the song's ${kind === "song" ? "song file" : kind === "lyrics" ? "lyrics.txt" : kind === "hints" ? "hints.lrc" : "cover"}${kind === "cover" ? "" : " (the previous one is kept in .studio\\replaced\\)"}.` });
  }

  async function openFolder() {
    const r = await api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
    const d = (await r.json()) as { error?: string; folder?: string };
    setNotice(r.ok ? { ok: true, text: `Opened ${d.folder} in Explorer.` } : { ok: false, text: d.error ?? "Could not open the folder." });
  }

  async function remove(name: string) {
    if (!window.confirm(`Move ${name} to clips\\_removed\\? It is not deleted; you can put it back from that folder.`)) return;
    const r = (await send(null, "DELETE", `?name=${encodeURIComponent(name)}`)) as { movedTo: string } | null;
    if (r) setNotice({ ok: true, text: `${name} moved to ${win(r.movedTo)}.` });
  }

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading the song&apos;s files…</p>;
  if (!data.folder) {
    return (
      <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
        This song still uses the old folders. Use “Migrate” on the Library page (or pnpm songs:migrate --apply) to give it its own folder; then its files show here.
      </p>
    );
  }

  const fileRow = (kind: AssetKind, icon: React.ReactNode, title: string, value: React.ReactNode, warning?: React.ReactNode) => (
    <li data-asset={kind} className={cn("bg-card flex items-center gap-3 rounded-lg border px-4 py-3", warning && "border-amber-400/40")}>
      <span className="text-brand">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground truncate text-xs">{value}</p>
        {warning ? (
          <p data-warning={kind} className="mt-1 text-xs text-amber-300">
            {warning}
          </p>
        ) : null}
      </div>
      <label className={cn("border-input hover:bg-accent cursor-pointer rounded-md border px-3 py-1.5 text-xs", busy && "pointer-events-none opacity-50")}>
        Replace…
        <input type="file" accept={ACCEPT[kind]} className="hidden" data-replace={kind} onChange={(e) => replace(kind, e.target.files?.[0])} />
      </label>
    </li>
  );

  return (
    <div data-assets className="flex flex-col gap-6">
      <p className="text-muted-foreground text-xs">
        Song folder:{" "}
        <button type="button" data-open-folder title="Open in Explorer" onClick={openFolder} className="text-foreground hover:text-brand underline decoration-dotted underline-offset-2">
          {data.folderPath ?? win(data.folder)}
        </button>
      </p>
      <TaglineField projectId={projectId} />
      <ul className="grid gap-3 md:grid-cols-2">
        {fileRow("song", <FileAudio className="size-5" />, "Song", data.song ? `${data.song.name}${data.song.durationMs ? ` · ${clock(data.song.durationMs)}` : ""}${data.song.bpm ? ` · ${Math.round(data.song.bpm)} BPM` : ""}` : "missing")}
        {fileRow("lyrics", <FileText className="size-5" />, "Lyrics", data.lyrics ? `lyrics.txt · ${data.lyrics.lines} lines` : "no lyrics.txt yet")}
        {fileRow(
          "cover",
          data.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local file served by /api/files
            <img src={`/api/files/${data.cover}`} alt="" className="size-10 rounded object-cover" />
          ) : (
            <ImageIcon className="size-5" />
          ),
          "Cover",
          data.cover ? win(data.cover.slice(data.folder.length + 1)) : "none (YouTube uses stills or clips)",
        )}
        {fileRow(
          "hints",
          <ListMusic className="size-5" />,
          "Hints (tapped times)",
          data.hints
            ? `hints.lrc · ${data.hints.timed} timed line${data.hints.timed === 1 ? "" : "s"}${data.hints.marks ? ` + ${data.hints.marks} end mark${data.hints.marks === 1 ? "" : "s"} (where the singing stops)` : ""}${data.hints.untapped ? ` · ${data.hints.untapped} lyric line${data.hints.untapped === 1 ? "" : "s"} not tapped (the aligner times them)` : ""}`
            : "none (optional)",
          data.hints?.orphans.length
            ? `${data.hints.orphans.length} tapped line${data.hints.orphans.length === 1 ? " matches" : "s match"} no line of lyrics.txt (left from an older version?): ${data.hints.orphans.map((o) => `“${o}”`).join(", ")}. Replace hints.lrc, or fix the line in lyrics.txt.`
            : undefined,
        )}
      </ul>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-base tracking-[0.12em] uppercase">Clips</h2>
            <p data-usable className="text-muted-foreground text-xs">
              {data.clips.length} in this song&apos;s clips folder · 9:16 platforms can use {data.usable.vertical} · YouTube (16:9) can use {data.usable.horizontal}
              {" "}· shared collections are chosen in Generate
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => clipInput.current?.click()}>
            <Upload /> Add clips
          </Button>
          <input ref={clipInput} type="file" multiple accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.jpg,.jpeg,.png,.webp" className="hidden" data-clip-input onChange={(e) => e.target.files && addClips(e.target.files)} />
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
            addClips(e.dataTransfer.files);
          }}
          className={cn("rounded-xl border border-dashed p-4 transition-colors", dragging ? "border-brand bg-brand/10" : "border-border")}
        >
          {data.clips.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {data.clips.map((c) => (
                <li key={c.name} data-clip={c.name} className="bg-card flex flex-col overflow-hidden rounded-lg border">
                  <div className="relative aspect-[9/12] bg-black">
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                      <img src={`/api/files/${c.thumb}`} alt="" className="size-full object-contain" />
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
                    {c.duplicateOf ? <p className="text-amber-300">same content as {c.duplicateOf}</p> : null}
                    <button type="button" data-remove={c.name} disabled={busy} onClick={() => remove(c.name)} className="text-muted-foreground hover:text-foreground mt-1 flex w-fit items-center gap-1">
                      <Trash2 className="size-3" /> Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">Drop videos and photos here (or “Add clips”). They are copied into this song&apos;s clips folder.</p>
          )}
        </div>
        {data.removed.length ? (
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">Removed ({data.removed.length}) · kept in clips\_removed\</summary>
            <p className="mt-1">{data.removed.join(", ")}</p>
          </details>
        ) : null}
      </section>
      {notice ? (
        <p role="status" className={cn("rounded-md border px-4 py-2 text-sm", notice.ok ? "border-brand/30 bg-brand/10" : "border-amber-400/30 bg-amber-400/10 text-amber-100")}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}

// The song's tagline (song.json "tagline"): a short line under the title in the title opening (Style tab:
// Title opening on). Empty: none. Never taken from the EP.
function TaglineField({ projectId }: { projectId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/songs/${projectId}/recipe`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { fields?: { field: string; value: unknown }[] }) => {
        const v = String(d.fields?.find((f) => f.field === "tagline")?.value ?? "");
        setValue(v);
        setSaved(v);
      })
      .catch(() => setValue(""));
  }, [projectId]);
  const save = async () => {
    if (value === null || value === saved) return;
    const body = value.trim() ? { action: "set", field: "tagline", value: value.trim() } : { action: "reset", field: "tagline" };
    const r = await api(`/api/songs/${projectId}/recipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setSaved(value.trim());
  };
  if (value === null) return null;
  return (
    <label className="bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm" data-tagline>
      <span className="font-medium">Tagline</span>
      <input
        data-tagline-input
        className="bg-input/30 border-input h-8 min-w-60 flex-1 rounded-md border px-2 text-sm"
        value={value}
        maxLength={120}
        placeholder="a short line under the title (empty: none)"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="text-muted-foreground text-xs">{saved === value && value ? "saved · " : ""}shown in the title opening (Style tab → Title opening: on)</span>
    </label>
  );
}
