"use client";

import { Music, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { SongCard as Song } from "@lyric/video/library";

import { NewSongDialog } from "@/components/new-song-dialog";
import { SongCard } from "@/components/song-card";
import { Input } from "@/components/ui/input";

export function LibraryView({ songs, artists }: { songs: Song[]; artists: string[] }) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? songs.filter((s) => [s.title, s.artist, s.ep ?? ""].some((t) => t.toLowerCase().includes(q))) : songs;
  }, [songs, query]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Library</h1>
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
        <p className="text-muted-foreground text-sm">No song matches “{query}”.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {shown.map((s) => (
            <SongCard key={s.id} song={s} />
          ))}
        </div>
      )}
    </div>
  );
}
