"use client";

import { AudioLines, FileAudio, FileText, ImageIcon, ListMusic, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AssetKind, SongAssets } from "@lyric/video/assets";
import type { ReplacedFile } from "@lyric/video/replaced-files";

import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const win = (rel: string) => rel.split("/").join("\\");
const ACCEPT: Record<AssetKind, string> = { song: ".wav,.mp3", lyrics: ".txt", cover: ".jpg,.jpeg,.png,.webp", hints: ".lrc", vocals: ".wav", backingVocals: ".wav" };
const ROLE_NAME: Record<string, string> = { lyrics: "the lyrics", vocals: "the vocal stem", backingVocals: "the backing vocals", notUsed: "not used" };
const base = (rel: string) => rel.split("/").pop() ?? rel;
const REPLACED_ROLE: Record<string, string> = { song: "the song file", lyrics: "the lyrics", vocals: "the vocal stem", backingVocals: "the backing vocals", cover: "the cover", hints: "the hints (tapped times)" };
// What a Replace changes, in plain words, before it happens.
function replaceWarning(kind: AssetKind, current: string, next: string): string {
  const kept = `The current one (${current}) is kept under Replaced files at the bottom of this page; Restore brings it back.`;
  if (kind === "song") return `Replace the song file with ${next}?\n\n${kept}\n\nVideos you already made keep their sound. New videos use ${next}; if the vocals moved in the new mix, check the lyric timing.`;
  if (kind === "lyrics") return `Replace the lyrics with ${next}?\n\n${kept}\n\nThe words are timed again at the next Make.`;
  if (kind === "vocals") return `Replace the vocal stem with ${next}?\n\n${kept}\n\nThe lyric timing runs again on the new stem.`;
  if (kind === "hints") return `Replace the tapped times (${current}) with ${next}?\n\n${kept}`;
  return `Replace ${current} with ${next}?\n\n${kept}`;
}

// The song's files: song, vocal stem, backing vocals, lyrics, cover, hints.lrc (each under the user's own
// file name; the roles are linked in .studio\files.json) and its own clips (drop videos and photos;
// Remove moves a clip to clips\_removed\, nothing is deleted), shown in the song's clip order: drag to
// reorder (clips.json, the one sequence Shape and Make use; new clips go at the end). Files put into the folder by hand that
// the app cannot place are asked about once: "What is this file?".
// N1: Prepare → Files (part "files": the song's files, slots, replaced files) and Prepare → Clips (part "clips": the
// song's own clips, their order, Use / Omit, removed clips). The tagline and links are in Prepare → Details.
export function AssetsTab({ projectId, part = "files" }: { projectId: string; part?: "files" | "clips" }) {
  const [data, setData] = useState<SongAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const clipInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [replaced, setReplaced] = useState<ReplacedFile[]>([]);

  async function loadReplaced() {
    const r = await api(`/api/songs/${projectId}/replaced`, { cache: "no-store" }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { files?: ReplacedFile[] } | null;
    setReplaced(d?.files ?? []);
  }

  async function reload() {
    void loadReplaced();
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
    api(`/api/songs/${projectId}/replaced`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ files?: ReplacedFile[] }>)
      .then((d) => alive && setReplaced(d.files ?? []))
      .catch(() => {});
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

  async function replace(kind: AssetKind, file: File | undefined, input?: HTMLInputElement) {
    if (input) input.value = ""; // the same file can be picked again after Cancel
    if (!file) return;
    // Say what changes before anything is replaced (1 Nov 2026): the current file is kept, never deleted.
    const current = currentName(kind);
    if (current && !window.confirm(replaceWarning(kind, current, file.name))) return;
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    if (kind === "vocals") {
      // Checked against the song at once; the lyric timing runs again on it (Tasks menu).
      const r = (await send(body)) as { status: "lined-up" | "rejected"; message: string; retimed: boolean } | null;
      if (r) setNotice({ ok: r.status === "lined-up", text: `${r.message}${r.retimed ? (r.status === "lined-up" ? " The lyric timing runs again on it now (see Tasks): every line follows the stem; your taps (hints.lrc) are kept, and starts you set by hand before the stem are reset once (Undo in the Lyrics tab)." : "") : ""}` });
      return;
    }
    if (await send(body)) setNotice({ ok: true, text: `${file.name} is now the song's ${kind === "song" ? "song file" : kind === "lyrics" ? (data?.instrumental ? "story.txt" : "lyrics") : kind === "hints" ? "hints.lrc" : kind === "backingVocals" ? "backing vocals (kept for reference, not used for timing)" : "cover"}${current ? ` (the previous one, ${current}, is under Replaced files below)` : ""}.` });
  }

  // The file in use now for a kind (null: none yet, nothing is replaced).
  function currentName(kind: AssetKind): string | null {
    if (!data) return null;
    if (kind === "song") return data.song?.name ?? null;
    if (kind === "lyrics") return data.lyrics ? base(data.lyrics.file) : null;
    if (kind === "vocals") return data.vocals?.name ?? null;
    if (kind === "backingVocals") return data.backingVocals ? base(data.backingVocals) : null;
    if (kind === "cover") return data.cover ? base(data.cover) : null;
    return data.hints ? base(data.hints.file) : null;
  }

  async function restoreFile(f: ReplacedFile) {
    const what = REPLACED_ROLE[f.role ?? ""] ?? "the file";
    const now = f.role ? currentName(f.role === "hints" ? "hints" : f.role) : null;
    if (!window.confirm(`Make ${f.original} ${what} again?${now ? ` The one in use now (${now}) is kept under Replaced files.` : ""}${f.role === "song" || f.role === "lyrics" || f.role === "vocals" ? " New videos use it; videos already made stay as they are." : ""}`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/replaced`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: f.file }) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await reload();
      router.refresh();
      setNotice({ ok: true, text: `${f.original} is ${what} again.${f.role === "vocals" ? " The lyric timing runs again on it (see Tasks)." : ""}` });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function restoreClip(name: string) {
    const body = new FormData();
    body.set("kind", "restoreClip");
    body.set("name", name);
    const r = (await send(body)) as { restored: string } | null;
    if (r) setNotice({ ok: true, text: `${name} is back in the song's clips${base(r.restored) !== name ? ` as ${base(r.restored)}` : ""}.` });
  }

  // "What is this file?": a file put into the song folder by hand gets its role (or "Not used").
  async function assign(name: string, role: string) {
    const current = role === "lyrics" || role === "vocals" || role === "backingVocals" ? currentName(role) : null;
    if (current && !window.confirm(`Use ${name} as ${ROLE_NAME[role]} instead of ${current}?\n\n${current} is kept under Replaced files; Restore brings it back.`)) return;
    const body = new FormData();
    body.set("kind", "assign");
    body.set("name", name);
    body.set("role", role);
    if (await send(body)) setNotice({ ok: true, text: role === "notUsed" ? `${name} stays in the folder and is not used.` : `${name} is now ${ROLE_NAME[role]}${role === "vocals" ? ": checked against the song; the lyric timing runs again on it (see Tasks)" : ""}.` });
  }

  async function openFolder() {
    const r = await api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
    const d = (await r.json()) as { error?: string; folder?: string };
    setNotice(r.ok ? { ok: true, text: `Opened ${d.folder} in Explorer.` } : { ok: false, text: d.error ?? "Could not open the folder." });
  }

  // Drag and drop: the song's clips in a new order (clips.json). Shape shows and Make uses this sequence.
  const CLIP_DRAG = "application/x-lyric-song-clip";
  const [dragClip, setDragClip] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<string | null>(null); // the clip whose story note is being written (its card does not drag meanwhile)
  const [overClip, setOverClip] = useState<string | null>(null);
  async function saveOrder(names: string[], done: string) {
    if (!data) return;
    const before = data;
    setData({ ...data, clips: names.map((n) => data.clips.find((c) => c.name === n)!) });
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: names }) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setNotice({ ok: true, text: done });
      router.refresh();
    } catch (e) {
      setData(before);
      setNotice({ ok: false, text: `The order was not saved: ${(e as Error).message}` });
    }
  }
  // For clips already named in order (01_..., 02_...): one click puts them in file-name order.
  function sortByName() {
    if (!data) return;
    if (!window.confirm("Put the clips in file-name order? This replaces the order you dragged.")) return;
    const names = data.clips.map((c) => c.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    void saveOrder(names, "The clips are in file-name order. Shape and Make use this order.");
  }
  // Use / Omit (the same switch as Shape → Clips): an omitted clip keeps its place, Make leaves it out.
  async function setOmit(name: string, omit: boolean) {
    if (!data) return;
    const before = data;
    setData({ ...data, clips: data.clips.map((c) => (c.name === name ? { ...c, omit } : c)) });
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ omit: { name, omit } }) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setNotice({ ok: true, text: omit ? `${name} is omitted: it keeps its place but the videos leave it out.` : `${name} is used again.` });
      router.refresh();
    } catch (e) {
      setData(before);
      setNotice({ ok: false, text: `Not saved: ${(e as Error).message}` });
    }
  }
  async function moveClip(name: string, onto: string) {
    if (!data || name === onto) return;
    const names = data.clips.map((c) => c.name);
    const from = names.indexOf(name);
    const to = names.indexOf(onto);
    if (from < 0 || to < 0) return;
    names.splice(from, 1);
    names.splice(to, 0, name); // takes the place of the clip it was dropped on
    await saveOrder(names, `${name} is now clip ${to + 1}. Shape and Make use this order.`);
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

  const fileRow = (kind: AssetKind, icon: React.ReactNode, title: string, value: React.ReactNode, warning?: React.ReactNode, button = "Replace…") => (
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
        {button}
        <input type="file" accept={ACCEPT[kind]} className="hidden" data-replace={kind} onChange={(e) => replace(kind, e.target.files?.[0], e.target)} />
      </label>
    </li>
  );

  return (
    <div data-assets={part} className="flex flex-col gap-6">
      {part === "files" ? (
      <>
      <p className="text-muted-foreground text-xs">
        Song folder:{" "}
        <button type="button" data-open-folder title="Open in Explorer" onClick={openFolder} className="text-foreground hover:text-brand underline decoration-dotted underline-offset-2">
          {data.folderPath ?? win(data.folder)}
        </button>
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {fileRow("song", <FileAudio className="size-5" />, "Song", data.song ? `${data.song.name}${data.song.durationMs ? ` · ${clock(data.song.durationMs)}` : ""}${data.song.bpm ? ` · ${Math.round(data.song.bpm)} BPM` : ""}` : "missing")}
        {data.instrumental
          ? null
          : fileRow(
              "vocals",
              <AudioLines className="size-5" />,
              "Vocal stem",
              data.vocals
                ? `${data.vocals.name} · ${data.vocals.status === "lined-up" ? `used for lyric timing${data.vocals.offsetMs !== null && Math.abs(data.vocals.offsetMs) >= 50 ? ` (lined up: ${(Math.abs(data.vocals.offsetMs) / 1000).toFixed(1)} s offset, from trimming)` : " (lined up)"}` : data.vocals.status === "rejected" ? "not used: the app separates the vocals itself" : "not checked yet"}`
                : "none: the app separates the vocals itself. Add the vocal stem (a WAV, any name) for better lyric timing.",
              data.vocals?.status === "rejected" ? data.vocals.message : undefined,
              data.vocals ? "Replace…" : "Add…",
            )}
        {data.instrumental
          ? null
          : fileRow("backingVocals", <AudioLines className="size-5" />, "Backing vocals", data.backingVocals ? `${base(data.backingVocals)} · kept with the song, not used for timing` : "none (optional)", undefined, data.backingVocals ? "Replace…" : "Add…")}
        {data.instrumental
          ? fileRow("lyrics", <FileText className="size-5" />, "Story (instrumental)", data.lyrics?.lines ? `story.txt · ${data.lyrics.lines} sentence${data.lyrics.lines === 1 ? "" : "s"}, timed by the app` : "no story: music only (Replace adds a story.txt)")
          : fileRow("lyrics", <FileText className="size-5" />, "Lyrics", data.lyrics ? `${base(data.lyrics.file)} · ${data.lyrics.lines} lines` : "no lyrics yet (a .txt, any name)")}
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

      {data.unassigned.length ? (
        <section data-unassigned className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-4">
          <h2 className="text-sm font-medium">What is this file?</h2>
          <p className="text-muted-foreground text-xs">Found in the song folder. Tell the app once; the file keeps its name and place.</p>
          <ul className="flex flex-col gap-2">
            {data.unassigned.map((f) => {
              const roles = f.kind === "text" ? ["lyrics", "notUsed"] : ["vocals", "backingVocals", "notUsed"];
              const label: Record<string, string> = { lyrics: data.lyrics ? "Lyrics (replaces the current ones)" : "Lyrics", vocals: data.vocals ? "Vocal stem (replaces the current one)" : "Vocal stem", backingVocals: data.backingVocals ? "Backing vocals (replaces the current ones)" : "Backing vocals", notUsed: "Not used" };
              return (
                <li key={f.name} data-unassigned-file={f.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {roles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      disabled={busy}
                      data-assign={role}
                      onClick={() => void assign(f.name, role)}
                      className={cn("rounded-md border px-2 py-1 text-xs", role === f.guess ? "border-brand/50 bg-brand/15 text-brand" : "hover:bg-accent")}
                    >
                      {label[role]}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      </>
      ) : null}
      {part === "clips" ? (
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display flex items-center gap-2 text-base tracking-[0.12em] uppercase"><FeatureIcon feature="clips" /> Clips</h2>
            <p data-usable className="text-muted-foreground text-xs">
              {data.clips.length} in this song&apos;s clips folder · 9:16 platforms can use {data.usable.vertical} · YouTube (16:9) can use {data.usable.horizontal}
              {" "}· shared collections: below
            </p>
            {data.clips.length > 1 ? <p data-order-hint className="text-muted-foreground text-xs">
                Drag the clips into the order you want: Shape shows the same order and every video follows it. Omit leaves a clip out of the videos (it keeps its place). New clips go at the end, by file name.{" "}
                <button type="button" data-sort-by-name disabled={busy} onClick={sortByName} className="hover:text-foreground underline underline-offset-2">
                  Sort by file name
                </button>
              </p> : null}
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => clipInput.current?.click()}>
            <Upload /> Add clips
          </Button>
          <input ref={clipInput} type="file" multiple accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.jpg,.jpeg,.png,.webp" className="hidden" data-clip-input onChange={(e) => e.target.files && addClips(e.target.files)} />
        </div>
        <div
          data-dropzone
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return; // a clip being moved, not files
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(false);
            addClips(e.dataTransfer.files);
          }}
          className={cn("rounded-xl border border-dashed p-4 transition-colors", dragging ? "border-brand bg-brand/10" : "border-border")}
        >
          {data.clips.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {data.clips.map((c, i) => (
                <li
                  key={c.name}
                  data-clip={c.name}
                  data-position={i + 1}
                  draggable={!busy && noteOpen !== c.name}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CLIP_DRAG, c.name);
                    e.dataTransfer.effectAllowed = "move";
                    setDragClip(c.name);
                  }}
                  onDragEnd={() => {
                    setDragClip(null);
                    setOverClip(null);
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(CLIP_DRAG)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overClip !== c.name) setOverClip(c.name);
                  }}
                  onDrop={(e) => {
                    const name = e.dataTransfer.getData(CLIP_DRAG);
                    if (!name) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragClip(null);
                    setOverClip(null);
                    void moveClip(name, c.name);
                  }}
                  data-omit={c.omit ? "1" : "0"}
                  className={cn("bg-card flex cursor-grab flex-col overflow-hidden rounded-lg border active:cursor-grabbing", c.omit && "border-dashed", dragClip === c.name && "opacity-40", overClip === c.name && dragClip !== c.name && "border-brand ring-brand ring-2")}
                >
                  <div className="relative aspect-[9/12] bg-black">
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                      <img src={`/api/files/${c.thumb}`} alt="" draggable={false} className={cn("size-full object-contain", c.omit && "opacity-30 grayscale")} />
                    ) : null}
                    <span data-order-number className="bg-brand text-brand-foreground absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
                    <span className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">{c.orientation}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 p-2 text-xs">
                    <p className="truncate font-medium" title={c.name}>
                      {c.name}
                    </p>
                    <p className="text-muted-foreground">
                      {c.kind === "photo" ? "photo" : seconds(c.durationMs)} · {c.width}×{c.height}
                    </p>
                    {c.duplicateOf ? <p className="text-amber-300">same content as {c.duplicateOf}</p> : null}
                    <div data-use-omit={c.name} role="group" aria-label={`Use or omit ${c.name}`} className="mt-1 flex w-fit overflow-hidden rounded-md border text-[11px]">
                      <button type="button" data-use={c.name} aria-pressed={!c.omit} disabled={busy} onClick={() => c.omit && void setOmit(c.name, false)} className={cn("px-2 py-0.5", !c.omit ? "bg-brand/20 text-brand" : "hover:bg-accent")}>
                        Use
                      </button>
                      <button type="button" data-omit-button={c.name} aria-pressed={!!c.omit} disabled={busy} onClick={() => !c.omit && void setOmit(c.name, true)} className={cn("border-l px-2 py-0.5", c.omit ? "bg-amber-400/20 text-amber-200" : "hover:bg-accent")}>
                        Omit
                      </button>
                    </div>
                    <button type="button" data-remove={c.name} disabled={busy} onClick={() => remove(c.name)} className="text-muted-foreground hover:text-foreground mt-1 flex w-fit items-center gap-1">
                      <Trash2 className="size-3" /> Remove
                    </button>
                    <ClipNoteField
                      projectId={projectId}
                      clip={c.name}
                      note={c.note ?? null}
                      editing={noteOpen === c.name}
                      onEditing={(on) => setNoteOpen(on ? c.name : null)}
                      onSaved={(note) => setData((d) => (d ? { ...d, clips: d.clips.map((x) => (x.hash === c.hash ? { ...x, note } : x)) } : d))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">Drop videos and photos here (or “Add clips”). They are copied into this song&apos;s clips folder.</p>
          )}
        </div>
        {data.removed.length ? (
          <details data-removed-clips className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">Removed clips ({data.removed.length}) · kept in clips\_removed\</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {data.removed.map((name) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <button type="button" data-restore-clip={name} disabled={busy} onClick={() => void restoreClip(name)} className="hover:text-foreground underline-offset-2 hover:underline">
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      ) : null}

      {part === "files" && replaced.length ? (
        <details data-replaced-files className="bg-card rounded-lg border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Replaced files ({replaced.length}) <span className="text-muted-foreground text-xs font-normal">· every file you replaced is kept; Restore brings one back</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {replaced.map((f) => (
              <li key={f.file} data-replaced={f.file} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate" title={f.file}>
                  {f.original} <span className="text-muted-foreground">· {f.role ? `was ${REPLACED_ROLE[f.role]}` : "kept copy"} · replaced {new Date(f.at).toLocaleString()}</span>
                </span>
                {f.role ? (
                  <button type="button" data-restore-replaced={f.file} disabled={busy} onClick={() => void restoreFile(f)} className="border-input hover:bg-accent rounded-md border px-2 py-1">
                    Restore
                  </button>
                ) : (
                  <span className="text-muted-foreground">in the song folder (.studio\replaced\)</span>
                )}
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
    </div>
  );
}

// A clip's story note (Prepare → Clips, 9 Nov 2026): the clip's role in the story line, for the user only (the app never
// reads it; it is not shown in Shape). One line ending in "…" when longer; a click opens a small box on the card that
// saves as you type (no Save button); clicking outside or Esc closes it again; clearing the text deletes the note.
function ClipNoteField({ projectId, clip, note, editing, onEditing, onSaved }: { projectId: string; clip: string; note: string | null; editing: boolean; onEditing: (on: boolean) => void; onSaved: (note: string | null) => void }) {
  const [text, setText] = useState(note ?? "");
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sent = useRef(note ?? ""); // what the studio has
  const latest = useRef(text);
  async function save(value: string) {
    clearTimeout(timer.current);
    if (value === sent.current) return;
    const before = sent.current;
    sent.current = value;
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: { name: clip, text: value } }) });
      const d = (await r.json()) as { note?: string | null; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setFailed(null);
      onSaved(d.note ?? null);
    } catch (e) {
      sent.current = before;
      setFailed(`Note not saved: ${(e as Error).message}`);
    }
  }
  // Leaving the page (another tab) while typing: what was typed is still saved.
  useEffect(() => () => void (latest.current !== sent.current && save(latest.current)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = () => {
    setText(note ?? "");
    latest.current = note ?? "";
    onEditing(true);
  };
  if (!editing)
    return (
      <div className="mt-1 min-w-0">
        {note ? (
          <button type="button" data-clip-note={clip} onClick={open} title={note} className="text-foreground/80 hover:text-foreground block w-full truncate text-left text-[11px] italic">
            {note.replace(/\s+/g, " ")}
          </button>
        ) : (
          <button type="button" data-clip-note-add={clip} onClick={open} className="text-muted-foreground/60 hover:text-muted-foreground text-[11px]">
            + Add a note
          </button>
        )}
        {failed ? <p className="text-[10px] text-red-300">{failed}</p> : null}
      </div>
    );
  return (
    <div className="mt-1 min-w-0">
      <textarea
        autoFocus
        data-clip-note-input={clip}
        aria-label={`Story note for ${clip}`}
        rows={3}
        maxLength={2000}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        placeholder="Its role in the story (for you only)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => void save(v), 500);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        onBlur={() => {
          void save(latest.current);
          onEditing(false);
        }}
        className="bg-input/30 border-input w-full resize-y rounded-md border px-1.5 py-1 text-[11px] leading-snug"
      />
      {failed ? <p className="text-[10px] text-red-300">{failed}</p> : null}
    </div>
  );
}
