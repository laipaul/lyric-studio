"use client";

import { AudioLines, ChevronDown, Clapperboard, FileAudio, FileJson, FileText, FolderOpen, ImageIcon, Library, ListMusic, MapPin, MoreHorizontal, Shuffle, Trash2, Upload, UserRound } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AssetKind, SongAssets } from "@lyric/video/assets";
import type { ReplacedFile } from "@lyric/video/replaced-files";
import type { StoryItem } from "@lyric/video/story-line";

import { CollectionPicker } from "@/components/collection-picker";
import { ShotListImport } from "@/components/shotlist-import";

import { NameField } from "@/components/name-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const win = (rel: string) => rel.split("/").join("\\");
const ACCEPT: Record<AssetKind, string> = { song: ".wav,.mp3", lyrics: ".txt", cover: ".jpg,.jpeg,.png,.webp", hints: ".lrc", vocals: ".wav", backingVocals: ".wav" };
const ROLE_NAME: Record<string, string> = { lyrics: "the lyrics", vocals: "the vocal stem", backingVocals: "the backing vocals", notUsed: "not used" };
const base = (rel: string) => rel.split("/").pop() ?? rel;
const REPLACED_ROLE: Record<string, string> = { song: "the song file", lyrics: "the lyrics", vocals: "the vocal stem", backingVocals: "the backing vocals", cover: "the cover", hints: "the hints (tapped times)", shotlist: "the shot list", bible: "the story bible" };
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
// N1: one part per Prepare tab. "clips" = Prepare → Storyboard (the song's own clips and photos, their story order,
// notes, Use / Omit, removed clips). Each part lists only its own replaced files. The tagline and links are in Prepare → Song Details.
// Prepare (11 Nov 2026): "files" = Prepare → Assets, every file the user provides (Song, Vocal stem and Lyrics together,
// ready for the 2c slots; then Hints (tapped times), backing vocals and the cover), the files to place and the one
// Replaced files list (every kind, hints too).
export type AssetsPart = "files" | "clips";
const PART_KINDS: Record<Exclude<AssetsPart, "clips">, readonly string[]> = { files: ["song", "vocals", "lyrics", "hints", "backingVocals", "cover"] };
// story: the story line (Prepare → Storyboard, 11 Nov 2026): the song's own clips, clips picked from a shared
// collection and "the app picks" cards, in order (story-line.ts).
type AssetsData = SongAssets & { story: StoryItem[] };
export function AssetsTab({ projectId, part = "files" }: { projectId: string; part?: AssetsPart }) {
  const [data, setData] = useState<AssetsData | null>(null);
  const [picker, setPicker] = useState(false);
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
      const d = (await r.json()) as AssetsData & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/assets`, { cache: "no-store" })
      .then((r) => r.json() as Promise<AssetsData & { error?: string }>)
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

  // Planned slots ("No picture yet" cards from a shot list) leave the Storyboard; the shot list is kept in Replaced files.
  async function removeSlots(ids: string[] | "all") {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/shotlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remove: ids }) });
      const d = (await r.json()) as { removed?: number; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await reload();
      void loadReplaced();
      router.refresh();
      setNotice({ ok: true, text: `${d.removed} planned slot${d.removed === 1 ? "" : "s"} removed from the Storyboard. Your shot list is kept under Replaced files (Restore brings ${d.removed === 1 ? "it" : "them"} back).` });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

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
    const now = f.role && f.role !== "shotlist" && f.role !== "bible" ? currentName(f.role) : f.role === "shotlist" ? "shotlist.json" : f.role === "bible" ? "bible.md" : null;
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
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [shotlistOpen, setShotlistOpen] = useState(false); // Import shot list (C2) // the clip whose story note is being written (its card does not drag meanwhile)
  const [overClip, setOverClip] = useState<string | null>(null);
  async function saveOrder(keys: string[], done: string) {
    if (!data) return;
    const before = data;
    setData({ ...data, story: keys.map((k) => data.story.find((i) => i.key === k)!) });
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ story: keys }) });
      const d = (await r.json()) as { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setNotice({ ok: true, text: done });
      router.refresh();
      // Shape may already be open: api() tells it (and Shape in other tabs) to plan again with the saved order.
    } catch (e) {
      setData(before);
      setNotice({ ok: false, text: `The order was not saved: ${(e as Error).message}` });
    }
  }
  // For clips already named in order (01_..., 02_...): one click puts them in file-name order.
  function sortByName() {
    if (!data) return;
    if (!window.confirm("Put the clips in file-name order? This replaces the order you dragged. Collection cards (the app picks) go at the end.")) return;
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const keys = [...data.story.filter((i) => i.clip).map((i) => i.key).sort(byName), ...data.story.filter((i) => i.card || i.slot).map((i) => i.key)];
    void saveOrder(keys, "The clips are in file-name order. Shape and Make use this order.");
  }
  // Use / Omit (the same switch as Shape → Clips): an omitted clip keeps its place, Make leaves it out.
  async function setOmit(name: string, omit: boolean) {
    if (!data) return;
    const before = data;
    setData({ ...data, clips: data.clips.map((c) => (c.name === name ? { ...c, omit } : c)), story: data.story.map((i) => (i.clip && i.key === name ? { ...i, clip: { ...i.clip, omit } } : i)) });
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
    const keys = data.story.map((i) => i.key);
    const from = keys.indexOf(name);
    const to = keys.indexOf(onto);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, name); // takes the place of the card it was dropped on
    const moved = data.story[from];
    const label = moved.card ? `${moved.card.collection} (the app picks)` : moved.slot ? `Slot ${moved.slot.id}` : name;
    await saveOrder(keys, `${label} is now number ${to + 1} in your story line. Shape and Make use this order.`);
  }

  // A collection clip or card: out of this song's story line only (it stays in its collection).
  async function removeFromStory(item: StoryItem) {
    const collection = item.card?.collection ?? item.clip?.collection ?? "";
    const what = item.card ? `${collection} (the app picks)` : item.key;
    if (!window.confirm(`Take ${what} out of this song's story line? It stays in the collection ${collection}.`)) return;
    if (await send(null, "DELETE", `?story=${encodeURIComponent(item.key)}`)) setNotice({ ok: true, text: `${what} is out of this song's story line (still in ${collection}).` });
  }
  // "From a collection…": the picked clips (and the app's pick) join the end of the story line.
  async function addFromCollection(collection: string, clips: string[], whole: boolean): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ add: { collection, clips, whole } }) });
      const d = (await r.json()) as { added?: string[]; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      await reload();
      router.refresh();
      const n = clips.length;
      setNotice({ ok: true, text: `Added from ${collection}: ${[n ? `${n} clip${n === 1 ? "" : "s"}` : "", whole ? "the app picks from the whole collection" : ""].filter(Boolean).join(" and ")}, at the end of your story line. Drag to place them.` });
      return true;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
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

  // What this part shows: its own file kinds, the files to place and every replaced file (all in Assets).
  const kinds = part === "clips" ? [] : PART_KINDS[part];
  const has = (kind: string) => kinds.includes(kind);
  const fromCollections = (data.story ?? []).filter((i) => i.clip?.collection || i.card).length; // collection clips and cards in the story line
  const unassigned = (part === "files" ? data.unassigned : []);
  const ownReplaced = part === "files" ? replaced : [];
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
      {part !== "clips" ? (
      <>
      {part === "files" ? (
      <p className="text-muted-foreground text-xs">
        Song folder:{" "}
        <button type="button" data-open-folder title="Open in Explorer" onClick={openFolder} className="text-foreground hover:text-brand underline decoration-dotted underline-offset-2">
          {data.folderPath ?? win(data.folder)}
        </button>
      </p>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {!has("song") ? null : fileRow("song", <FileAudio className="size-5" />, "Song", data.song ? `${data.song.name}${data.song.durationMs ? ` · ${clock(data.song.durationMs)}` : ""}${data.song.bpm ? ` · ${Math.round(data.song.bpm)} BPM` : ""}` : "missing")}
        {data.instrumental || !has("vocals")
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
        {!has("lyrics") ? null : data.instrumental
          ? fileRow("lyrics", <FileText className="size-5" />, "Story (instrumental)", data.lyrics?.lines ? `story.txt · ${data.lyrics.lines} sentence${data.lyrics.lines === 1 ? "" : "s"}, timed by the app` : "no story: music only (Replace adds a story.txt)")
          : fileRow("lyrics", <FileText className="size-5" />, "Lyrics", data.lyrics ? `${base(data.lyrics.file)} · ${data.lyrics.lines} lines` : "no lyrics yet (a .txt, any name)")}
        {!has("hints") ? null : fileRow(
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
        {data.instrumental || !has("backingVocals")
          ? null
          : fileRow("backingVocals", <AudioLines className="size-5" />, "Backing vocals", data.backingVocals ? `${base(data.backingVocals)} · kept with the song, not used for timing` : "none (optional)", undefined, data.backingVocals ? "Replace…" : "Add…")}
        {!has("cover") ? null : fileRow(
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
      </ul>

      {unassigned.length ? (
        <section data-unassigned className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-4">
          <h2 className="text-sm font-medium">What is this file?</h2>
          <p className="text-muted-foreground text-xs">Found in the song folder. Tell the app once; the file keeps its name and place.</p>
          <ul className="flex flex-col gap-2">
            {unassigned.map((f) => {
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
            {/* The Storyboard tab's one line (10 Nov 2026): what this tab is for. */}
            <p data-story-line className="text-sm">Your story line: drag to set the order.</p>
            <p data-usable className="text-muted-foreground text-xs">
              {data.clips.filter((c) => (c.role ?? "story") === "story").length} in this song&apos;s clips folder · 9:16 platforms can use {data.usable.vertical} · YouTube (16:9) can use {data.usable.horizontal}
              {fromCollections ? ` · ${fromCollections} from shared collections` : ""}
            </p>
            {data.singing?.length ? (
              <p data-singing-lines className="text-muted-foreground text-xs">
                Singing on {data.singing.length > 1 || data.singing[0].through > data.singing[0].line ? "lines" : "line"} {data.singing.map((s) => (s.through > s.line ? `${s.line}–${s.through}` : String(s.line))).join(", ")}: set in Lyrics Sync
              </p>
            ) : null}
            {data.story.length > 1 ? <p data-order-hint className="text-muted-foreground text-xs">
                Drag the clips into the order you want: Shape shows the same order and every video follows it. Omit leaves a clip out of the videos (it keeps its place). New clips go at the end.{" "}
                <button type="button" data-sort-by-name disabled={busy} onClick={sortByName} className="hover:text-foreground underline underline-offset-2">
                  Sort by file name
                </button>
              </p> : null}
          </div>
          {/* Add clips & photos (11 Nov 2026): from the computer (copied into the song's clips folder) or from a shared collection. */}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy} data-add-clips>
                <Upload /> Add clips &amp; photos <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="bg-popover text-popover-foreground z-50 min-w-52 rounded-md border p-1 text-sm shadow-lg">
                <DropdownMenu.Item data-add-from-computer onSelect={() => clipInput.current?.click()} className="hover:bg-accent focus:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none select-none">
                  <FolderOpen className="size-4" /> From my computer
                </DropdownMenu.Item>
                <DropdownMenu.Item data-add-from-collection onSelect={() => setPicker(true)} className="hover:bg-accent focus:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none select-none">
                  <Library className="size-4" /> From a collection…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {data?.story.some((i) => i.slot) ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} data-remove-all-slots onClick={() => void removeSlots("all")} title="Every “No picture yet” card leaves the Storyboard; your shot list is kept under Replaced files (Restore brings it back)">
              <Trash2 /> Remove all planned slots
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={busy} data-import-shotlist onClick={() => setShotlistOpen(true)} title="Your shot list (.json) becomes planned slots in the story line">
            <FileJson /> Import shot list
          </Button>
          <ShotListImport
            projectId={projectId}
            open={shotlistOpen}
            onOpenChange={setShotlistOpen}
            onImported={(text) => {
              void reload();
              setNotice({ ok: true, text });
            }}
          />
          <input ref={clipInput} type="file" multiple accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.jpg,.jpeg,.png,.webp" className="hidden" data-clip-input onChange={(e) => e.target.files && addClips(e.target.files)} />
          <CollectionPicker
            open={picker}
            onOpenChange={setPicker}
            inStory={(collection, clip) => data.story.some((i) => i.clip?.collection === collection && i.key.toLowerCase() === clip.toLowerCase())}
            cards={data.story.flatMap((i) => (i.card ? [i.card.collection] : []))}
            onAdd={addFromCollection}
          />
        </div>
        <StoryIdeaField projectId={projectId} idea={data.storyIdea ?? null} />
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
          {data.story.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{/* the cards of a row share one height; Use / Omit sit on one line at the bottom (11 Nov 2026) */}
              {data.story.map((item, i) => {
                const c = item.clip;
                const k = item.key;
                const dragProps = {
                  draggable: !busy && noteOpen !== k,
                  onDragStart: (e: React.DragEvent) => {
                    e.dataTransfer.setData(CLIP_DRAG, k);
                    e.dataTransfer.effectAllowed = "move";
                    setDragClip(k);
                  },
                  onDragEnd: () => {
                    setDragClip(null);
                    setOverClip(null);
                  },
                  onDragOver: (e: React.DragEvent) => {
                    if (!e.dataTransfer.types.includes(CLIP_DRAG)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overClip !== k) setOverClip(k);
                  },
                  onDrop: (e: React.DragEvent) => {
                    const name = e.dataTransfer.getData(CLIP_DRAG);
                    if (!name) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragClip(null);
                    setOverClip(null);
                    void moveClip(name, k);
                  },
                };
                const frame = cn("bg-card flex cursor-grab flex-col overflow-hidden rounded-lg border active:cursor-grabbing", dragClip === k && "opacity-40", overClip === k && dragClip !== k && "border-brand ring-brand ring-2");
                const number = <span data-order-number className="bg-brand text-brand-foreground absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>;
                if (item.card) {
                  // "Flowers · app picks · N clips": the app plays that collection's other clips at this place.
                  const card = item.card;
                  return (
                    <li key={k} data-story-card={card.collection} data-position={i + 1} {...dragProps} className={cn(frame, "border-dashed")}>
                      <div className="relative grid aspect-[9/16] grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-black">
                        {card.thumbs.map((t) => (
                          // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                          <img key={t} src={`/api/files/${t}`} alt="" draggable={false} className="size-full min-h-0 object-cover opacity-80" />
                        ))}
                        {number}
                        <span className="absolute inset-x-0 bottom-1.5 mx-auto flex w-fit items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px]">
                          <Shuffle className="size-3" /> app picks
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 p-2 text-xs">
                        <p className="flex items-center gap-1 truncate font-medium">
                          <Library className="text-brand size-3 shrink-0" /> {card.collection}
                        </p>
                        <p data-card-count className="text-muted-foreground">
                          {card.collection} · app picks · {card.clips} clip{card.clips === 1 ? "" : "s"}
                        </p>
                        <div className="flex justify-end">
                          <CardMenu id={k} details={[`${card.clips} clip${card.clips === 1 ? "" : "s"} from ${card.collection}: the app picks which play here`]} action={{ label: "Remove from this song", attr: { "data-remove-story": k }, run: () => void removeFromStory(item), title: `Out of this song only: the collection ${card.collection} keeps its clips` }} disabled={busy} />
                        </div>
                      </div>
                    </li>
                  );
                }
                if (item.slot) {
                  // A planned slot from the shot list (C2): its picture is made later (C3); Make skips it until then.
                  const sl = item.slot;
                  const cardImg = (x: { id: string | null; thumb: string | null }) => (x.id && x.thumb ? `/api/cards/${x.id}/file/${x.thumb.split("/").map(encodeURIComponent).join("/")}` : null);
                  const faces = [...sl.cast, ...(sl.place ? [sl.place] : [])];
                  const unlocked = faces.filter((x) => !x.locked).map((x) => (x.id ? `${x.name} (not locked yet)` : `${x.name} (no card any more)`));
                  return (
                    <li key={k} data-story-slot={sl.id} data-position={i + 1} {...dragProps} className={cn(frame, "border-brand/50 border-dashed")} title={sl.shows}>
                      <div data-slot-frame className="relative grid aspect-[9/16] grid-cols-2 gap-px overflow-hidden bg-black/60">
                        {faces.length ? (
                          faces.map((x) => {
                            const src = cardImg(x);
                            return src ? (
                              // eslint-disable-next-line @next/next/no-img-element -- a card picture served by /api/cards
                              <img key={`${x.name}`} src={src} alt={x.name} title={x.name} draggable={false} className={cn("size-full min-h-0 object-cover opacity-60", faces.length === 1 && "col-span-2")} />
                            ) : (
                              <span key={x.name} className={cn("text-muted-foreground flex items-center justify-center p-1 text-center text-[10px]", faces.length === 1 && "col-span-2")}>
                                {x.name}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-muted-foreground col-span-2 flex items-center justify-center text-[10px]">no card</span>
                        )}
                        {number}
                        <span data-slot-badge className="absolute inset-x-0 bottom-1.5 mx-auto flex w-fit items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px]">
                          <Clapperboard className="text-brand size-3" /> No picture yet
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 text-xs">
                        <p data-slot-shows className="line-clamp-3 text-sm leading-snug font-medium">
                          {sl.shows}
                        </p>
                        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span data-slot-shot className="bg-brand/15 text-brand rounded px-1">{sl.shot}</span>
                          {sl.cast.length ? (
                            <span className="flex items-center gap-0.5">
                              <UserRound className="size-3" /> {sl.cast.map((x) => x.name).join(", ")}
                            </span>
                          ) : null}
                          {sl.place ? (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="size-3" /> {sl.place.name}
                            </span>
                          ) : null}
                        </p>
                        {sl.line !== null ? (
                          <p data-slot-line className="text-muted-foreground truncate" title={sl.lineText ?? undefined}>
                            line {sl.line}{sl.lineText ? `: “${sl.lineText}”` : ""}
                          </p>
                        ) : null}
                        {unlocked.length ? (
                          <p data-slot-warning className="text-amber-400">
                            {unlocked.join(", ")}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-muted-foreground truncate">{sl.tag ? `#${sl.tag}` : ""}</span>
                          <CardMenu
                            id={k}
                            details={[
                              `Slot ${sl.id} (from your shot list)`,
                              `Shows: ${sl.shows}`,
                              ...(sl.outfit ? [`Outfit for this slot: ${sl.outfit}`] : []),
                              `Animate with: ${sl.animateWith}${sl.animateIsDefault ? ` (the default for a ${sl.shot})` : ""}`,
                              "Its picture is made later from the characters and scene; until then the videos skip it. Change it in your shot list file and import it again.",
                            ]}
                            disabled={busy}
                            action={{ label: "Remove this planned slot", attr: { "data-remove-slot": sl.id }, title: "It leaves the Storyboard; your shot list is kept under Replaced files (Restore brings it back)", run: () => void removeSlots([sl.id]) }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                }
                if (!c) return null;
                return (
                  <li key={k} data-clip={c.name} data-collection-clip={c.collection} data-position={i + 1} data-omit={c.omit ? "1" : "0"} title={c.name} {...dragProps} className={cn(frame, c.omit && "border-dashed")}>
                    {/* One 9:16 frame for every card (the vertical videos' shape), filled by the picture: it shows about what a
                        Reel / TikTok / Short shows of the clip (they crop it the same way). */}
                    <div data-clip-frame className="relative aspect-[9/16] overflow-hidden bg-black">
                      {c.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local thumbnail served by /api/files
                        <img src={`/api/files/${c.thumb}`} alt="" draggable={false} className={cn("absolute inset-0 size-full object-cover", c.omit && "opacity-30 grayscale")} />
                      ) : null}
                      {number}
                      {c.collection ? (
                        <span data-collection-badge={c.collection} title={`From the collection ${c.collection}`} className="border-brand/40 absolute bottom-1.5 left-1.5 flex max-w-[85%] items-center gap-1 truncate rounded border bg-black/75 px-1.5 py-0.5 text-[10px]">
                          <Library className="text-brand size-3 shrink-0" /> {c.collection}
                        </span>
                      ) : null}
                    </div>
                    {/* The card reads as a story (11 Nov 2026): the note is its title; the file name, duration, size and Remove sit
                        in its ⋯ menu; a warning shows only when something is wrong. */}
                    <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                      {item.shot ? (
                        // A clip that fills a shot of the shot list keeps that shot's story (Creation → Production, "Use for shot").
                        <div data-clip-shot={item.shot.id} className="flex flex-col gap-1">
                          <p className="line-clamp-3 text-sm leading-snug font-medium" title={item.shot.shows}>
                            {item.shot.shows}
                          </p>
                          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="rounded bg-emerald-400/15 px-1 text-emerald-300">Shot {item.shot.number}</span>
                            <span className="bg-brand/15 text-brand rounded px-1">{item.shot.shot}</span>
                            {item.shot.cast.length ? (
                              <span className="flex items-center gap-0.5">
                                <UserRound className="size-3" /> {item.shot.cast.map((x) => x.name).join(", ")}
                              </span>
                            ) : null}
                            {item.shot.place ? (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="size-3" /> {item.shot.place.name}
                              </span>
                            ) : null}
                          </p>
                          {item.shot.line !== null ? (
                            <p data-clip-shot-line className="text-muted-foreground truncate" title={item.shot.lineText ?? undefined}>
                              line {item.shot.line}
                              {item.shot.lineText ? `: “${item.shot.lineText}”` : ""}
                            </p>
                          ) : null}
                          {item.shot.tag ? <p className="text-muted-foreground">#{item.shot.tag}</p> : null}
                        </div>
                      ) : null}
                      {!c.collection ? (
                        <NameField
                          id={c.name}
                          name={c.label ?? null}
                          file={c.name}
                          className="text-[11px]"
                          onSave={async (label) => {
                            const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: { name: c.name, label } }) });
                            const d = (await r.json()) as { label?: string | null; error?: string };
                            if (!r.ok || d.error) return;
                            const next = d.label ?? null;
                            setData((x) => (x ? { ...x, clips: x.clips.map((y) => (y.name === c.name ? { ...y, label: next } : y)), story: x.story.map((y) => (y.key === k && y.clip ? { ...y, clip: { ...y.clip, label: next } } : y)) } : x));
                          }}
                        />
                      ) : null}
                      <ClipNoteField
                        projectId={projectId}
                        clip={c.name}
                        note={c.note ?? null}
                        editing={noteOpen === k}
                        onEditing={(on) => setNoteOpen(on ? k : null)}
                        onSaved={(note) => setData((d) => (d ? { ...d, clips: d.clips.map((x) => (x.name === c.name && !c.collection ? { ...x, note } : x)), story: d.story.map((x) => (x.key === k && x.clip ? { ...x, clip: { ...x.clip, note } } : x)) } : d))}
                      />
                      {clipProblem(c) ? (
                        <p data-clip-warning={c.name} className="text-[11px] text-amber-300">
                          {clipProblem(c)}
                        </p>
                      ) : null}
                      {c.transitions?.length ? (
                        // What the app changed so a dissolve with this clip never freezes a frame (22 Nov 2026): calm, for information only.
                        <p data-clip-transitions={c.name} title={c.transitions.join("\n")} className="text-muted-foreground text-[10px] leading-snug">
                          {c.transitions.slice(0, 2).map((t) => (
                            <span key={t} className="block">
                              {t}
                            </span>
                          ))}
                          {c.transitions.length > 2 ? <span className="block">and {c.transitions.length - 2} more</span> : null}
                        </p>
                      ) : null}
                      <div data-card-actions className="mt-auto flex items-center justify-between gap-1 pt-0.5">
                        <div data-use-omit={c.name} role="group" aria-label={`Use or omit ${c.name}`} className="flex w-fit overflow-hidden rounded-md border text-[11px]">
                          <button type="button" data-use={c.name} aria-pressed={!c.omit} disabled={busy} onClick={() => c.omit && void setOmit(c.name, false)} className={cn("px-2 py-0.5", !c.omit ? "bg-brand/20 text-brand" : "hover:bg-accent")}>
                            Use
                          </button>
                          <button type="button" data-omit-button={c.name} aria-pressed={!!c.omit} disabled={busy} onClick={() => !c.omit && void setOmit(c.name, true)} className={cn("border-l px-2 py-0.5", c.omit ? "bg-amber-400/20 text-amber-200" : "hover:bg-accent")}>
                            Omit
                          </button>
                        </div>
                        <CardMenu
                          id={c.name}
                          details={[c.name, `${c.kind === "photo" ? "photo" : seconds(c.durationMs)} · ${c.width}×${c.height} · ${c.orientation}`, ...(c.collection ? [`from the collection ${c.collection}`] : [])]}
                          action={
                            c.collection
                              ? { label: "Remove from this song", attr: { "data-remove-story": c.name }, run: () => void removeFromStory(item), title: `Out of this song only: it stays in ${c.collection}` }
                              : { label: "Remove", attr: { "data-remove": c.name }, run: () => void remove(c.name), title: "Moves the file to clips\\_removed\\ (never deleted)" }
                          }
                          disabled={busy}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">Drop videos and photos here, or “Add clips &amp; photos”: from your computer (copied into this song&apos;s clips folder) or from a collection.</p>
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

      {part !== "clips" && ownReplaced.length ? (
        <details data-replaced-files className="bg-card rounded-lg border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Replaced files ({ownReplaced.length}) <span className="text-muted-foreground text-xs font-normal">· every file you replaced is kept; Restore brings one back</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {ownReplaced.map((f) => (
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
          <button type="button" data-clip-note={clip} onClick={open} title={`${note}\n\n${clip}`} className="text-foreground hover:text-brand line-clamp-2 w-full text-left text-sm leading-snug font-medium">
            {note.replace(/\s+/g, " ")}
          </button>
        ) : (
          <button type="button" data-clip-note-add={clip} onClick={open} title={clip} className="text-muted-foreground/70 hover:text-foreground block w-full text-left text-sm leading-snug">
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
        className="bg-input/30 border-input w-full resize-y rounded-md border px-1.5 py-1 text-sm leading-snug"
      />
      {failed ? <p className="text-[10px] text-red-300">{failed}</p> : null}
    </div>
  );
}

// A problem worth a word on the card (11 Nov 2026): the same content twice, or a picture smaller than the videos'
// frame (its short side under 720 px: 544×720 is blown up about twice on a 1080-wide video).
function clipProblem(c: { duplicateOf: string | null; width: number; height: number }): string | null {
  if (c.duplicateOf) return `same content as ${c.duplicateOf}`;
  if (c.width && c.height && Math.min(c.width, c.height) < 720) return `low resolution (${c.width}×${c.height})`;
  return null;
}

// A card's ⋯ menu: its technical details (file name, duration, size) and Remove.
function CardMenu({ id, details, action, disabled }: { id: string; details: string[]; action?: { label: string; attr: Record<string, string>; run: () => void; title: string }; disabled: boolean }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-card-menu={id} aria-label={`More for ${id}`} title="Details and Remove" disabled={disabled} className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1">
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="bg-popover text-popover-foreground z-50 max-w-72 min-w-52 rounded-md border p-1 text-xs shadow-lg">
          {details.map((d, i) => (
            <p key={d} data-card-detail className={cn("px-2 py-1 break-all", i === 0 ? "text-foreground font-medium" : "text-muted-foreground")}>
              {d}
            </p>
          ))}
          {action ? (
            <>
              <DropdownMenu.Separator className="bg-border my-1 h-px" />
              <DropdownMenu.Item {...action.attr} title={action.title} onSelect={action.run} className="hover:bg-accent focus:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none select-none">
                <Trash2 className="size-3.5" /> {action.label}
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Prepare → Storyboard → Story idea (11 Nov 2026): one sentence for the whole video, saved per song (with the notes,
// .studio\\clip-notes.json). For the user only: the app never reads it to plan. Saved as typed (after a pause) and on leaving.
function StoryIdeaField({ projectId, idea }: { projectId: string; idea: string | null }) {
  const [text, setText] = useState(idea ?? "");
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const sent = useRef(idea ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function save(value: string) {
    clearTimeout(timer.current);
    if (value.trim() === sent.current.trim()) return;
    sent.current = value;
    try {
      const r = await api(`/api/songs/${projectId}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyIdea: value }) });
      const d = (await r.json()) as { error?: string };
      setState(!r.ok || d.error ? "error" : "saved");
    } catch {
      setState("error");
    }
  }
  return (
    <label className="flex flex-col gap-1" data-story-idea>
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        Story idea <span className="opacity-70">· one sentence for the whole video, for you only</span>
        {state === "saved" ? <span className="text-emerald-300">✓ Saved</span> : state === "error" ? <span className="text-red-300">Not saved</span> : null}
      </span>
      <input
        data-story-idea-input
        value={text}
        maxLength={300}
        placeholder="e.g. Two people find each other again in a rainy Paris night."
        onChange={(e) => {
          setText(e.target.value);
          setState("idle");
          clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => void save(v), 700);
        }}
        onBlur={() => void save(text)}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="bg-input/30 border-input h-9 rounded-md border px-3 text-base italic"
      />
    </label>
  );
}
