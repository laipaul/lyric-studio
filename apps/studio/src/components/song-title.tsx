"use client";

// The song page header's title: the pencil (or the title) opens Prepare → Details, where the title is changed (N1: one
// place; the song's folder follows the new title). The ⋯ menu next to it: "Delete song" (asks first; the whole song
// folder moves to songs\_removed\, and the Library's "Deleted songs" brings it back).
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RowMenu } from "@/components/row-menu";
import { api } from "@/lib/api";

export function SongTitle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = title; // changed in Prepare → Details → Title (the page is refreshed)
  // N1: the title is changed in one place, Prepare → Details (title and card texts); the header shows it and goes there.
  const edit = () => router.push(`/songs/${id}?tab=details`);
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
        <h1 data-song-title className="cursor-pointer truncate text-xl leading-tight" title="Change the title: Prepare → Details" onClick={edit}>
          {shown}
        </h1>
        <button type="button" data-song-title-edit aria-label="Change the title (Prepare → Details)" title="Change the title (Prepare → Details)" onClick={edit} className="text-muted-foreground hover:text-foreground rounded p-1">
          <Pencil className="size-3.5" />
        </button>
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
