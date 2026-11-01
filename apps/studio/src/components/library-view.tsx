"use client";

import { Music, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { RemovedSong, SongCard as Song } from "@lyric/video/library";
import { chipState, SONG_FILTERS, SONG_SORTS, songSummary, sortSongs, type SongFilter, type SongSort } from "@lyric/video/library-status";

import { NewSongDialog } from "@/components/new-song-dialog";
import { cardPlatforms, SongCard } from "@/components/song-card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

// The filters each song appears under ("Needs review", "Errors", ...), from its card's chips.
const filtersOf = (s: Song) => songSummary(cardPlatforms(s).map((p) => chipState(p))).filters;

export function LibraryView({ songs, artists, banner, removed = [] }: { songs: Song[]; artists: string[]; banner?: React.ReactNode; removed?: RemovedSong[] }) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<SongFilter>("all");
  const [sort, setSort] = useState<SongSort>("last");
  const counts = useMemo(() => {
    const out: Record<SongFilter, number> = { all: songs.length, none: 0, review: 0, errors: 0, ready: 0 };
    for (const s of songs) for (const f of filtersOf(s)) out[f] += 1;
    return out;
  }, [songs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = songs.filter((s) => (!q || [s.title, s.artist, s.ep ?? ""].some((t) => t.toLowerCase().includes(q))) && (filter === "all" || filtersOf(s).includes(filter)));
    return sortSongs(matching, sort);
  }, [songs, query, filter, sort]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl"><FeatureIcon feature="song" className="size-6" /> Library</h1>
          <p className="text-muted-foreground text-sm">
            {songs.length} song{songs.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input placeholder="Search songs, artists, EPs" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <NewSongDialog artists={artists} onDone={setNotice} />
        </div>
      </div>

      {songs.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
            {SONG_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                data-filter={f.id}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn("rounded-full border px-3 py-1 text-xs transition-colors", filter === f.id ? "border-brand bg-brand/15 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SongSort)} data-sort className="bg-background text-foreground rounded-md border px-2 py-1 text-xs">
              {SONG_SORTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {banner}
      {notice ? (
        <p role="status" className="border-brand/30 bg-brand/10 text-accent-foreground rounded-md border px-4 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      {songs.length === 0 ? (
        <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
          <Music className="text-brand size-8" />
          <p className="text-sm">No songs yet. Add your first one with “New song”.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{query.trim() ? `No song matches “${query}”` : "No song here"}{filter !== "all" ? ` under “${SONG_FILTERS.find((f) => f.id === filter)?.label}”` : ""}.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {shown.map((s) => (
            <SongCard key={s.id} song={s} />
          ))}
        </div>
      )}
      {removed.length ? <DeletedSongs removed={removed} /> : null}
    </div>
  );
}

// "Deleted songs (N)" under the cards, folded: each with Restore (its folder comes back from songs\_removed\).
function DeletedSongs({ removed }: { removed: RemovedSong[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function restore(id: string) {
    setError(null);
    const r = await api(`/api/songs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok || d.error) return setError(d.error ?? `The studio answered ${r.status}`);
    router.refresh();
  }
  return (
    <div data-deleted-songs className="flex flex-col gap-1 text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-muted-foreground hover:text-foreground self-start underline underline-offset-2">
        Deleted songs ({removed.length})
      </button>
      {open
        ? removed.map((s) => (
            <div key={s.id} className="flex items-center gap-3 pl-4">
              <span>
                {s.title} <span className="text-muted-foreground">· {s.artist}</span>
              </span>
              <button type="button" data-song-restore={s.title} onClick={() => void restore(s.id)} className="text-brand underline underline-offset-2">
                Restore
              </button>
            </div>
          ))
        : null}
      {error ? <p className="text-red-300">{error}</p> : null}
    </div>
  );
}
