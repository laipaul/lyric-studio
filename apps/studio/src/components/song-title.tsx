"use client";

// The song page header's title: click the pencil (or the title) to change it; Enter saves, Escape cancels.
// The song's folder follows the new title. The ⋯ menu next to it: "Delete song" (asks first; the whole song
// folder moves to songs\_removed\, and the Library's "Deleted songs" brings it back).
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RowMenu } from "@/components/row-menu";
import { api } from "@/lib/api";

export function SongTitle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(title);
  useEffect(() => setShown(title), [title]); // changed elsewhere too (Shape → This song → Card text → Title)

  async function save(next: string) {
    setEditing(null);
    const clean = next.trim();
    if (!clean || clean === shown) return;
    setError(null);
    const r = await api(`/api/songs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: clean }) });
    const d = (await r.json().catch(() => ({}))) as { title?: string; error?: string };
    if (!r.ok || d.error) return setError(d.error ?? `The studio answered ${r.status}`);
    setShown(d.title ?? clean);
    router.refresh();
  }
  async function remove() {
    setError(null);
    const r = await api(`/api/songs/${id}`, { method: "DELETE" });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok || d.error) return setError(d.error ?? `The studio answered ${r.status}`);
    router.push("/"); // the Library ("Deleted songs" at the bottom brings it back)
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1">
        {editing !== null ? (
          <input
            autoFocus
            data-song-title-input
            aria-label="Song title"
            className="bg-input/30 border-input h-8 min-w-64 rounded-md border px-2 text-lg"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(editing);
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => void save(editing)}
          />
        ) : (
          <h1 data-song-title className="cursor-text truncate text-xl leading-tight" title="Click to change the title" onClick={() => setEditing(shown)}>
            {shown}
          </h1>
        )}
        {editing === null ? (
          <button type="button" data-song-title-edit aria-label="Change the title" title="Change the title" onClick={() => setEditing(shown)} className="text-muted-foreground hover:text-foreground rounded p-1">
            <Pencil className="size-3.5" />
          </button>
        ) : null}
        <RowMenu label="this song" menuId="song" items={[{ key: "delete", label: "Delete song…", onSelect: () => setAsking(true), attrs: { "data-song-delete": true } }]} />
      </div>
      {asking ? (
        <p data-song-delete-ask className="flex flex-wrap items-center gap-2 text-xs">
          Delete “{shown}”? Its folder (song, lyrics, clips, videos) moves to songs\_removed\ — nothing is lost, and the Library can restore it.
          <button type="button" data-song-delete-yes onClick={() => void remove()} className="rounded bg-red-500/80 px-2 py-0.5 text-white">
            Delete
          </button>
          <button type="button" onClick={() => setAsking(false)} className="text-muted-foreground underline underline-offset-2">
            Cancel
          </button>
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
