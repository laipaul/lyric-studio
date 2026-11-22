"use client";

// Prepare → Creation: the song's Film look (22 Nov 2026). One dropdown: the camera, grain and grade words that the app
// adds to every Animate and singing take of this song, so all its clips look like one film. The looks themselves are
// made on the Film looks page (top menu). Takes already made keep the look they were sent with.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";

type View = { current: string | null; looks: { name: string; line: string; songs: number }[] };

export function FilmLookPicker({ projectId }: { projectId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (init?: RequestInit) => {
      try {
        const r = await api(`/api/songs/${projectId}/film-look`, init);
        const d = (await r.json()) as View & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        setView(d);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [projectId],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the song's look, read once it is shown
    void send();
  }, [send]);

  if (!view) return error ? <p className="text-xs text-red-300">{error}</p> : null;
  const current = view.looks.find((l) => l.name === view.current) ?? null;
  return (
    <div data-film-look className="bg-card/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2 text-xs">
      <label className="flex items-center gap-1.5 font-medium" title="The camera, grain and colour words the app adds to every clip it makes for this song, so they all look like one film.">
        <FeatureIcon feature="filmLook" className="size-3.5" /> Film look
        <select
          data-film-look-select
          value={view.current ?? ""}
          onChange={(e) => void send({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: e.target.value || null }) })}
          className="bg-background rounded-md border px-2 py-1 font-normal"
        >
          <option value="">None</option>
          {view.looks.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
              {l.line ? "" : " (no words yet)"}
            </option>
          ))}
        </select>
      </label>
      {current?.line ? (
        <span data-film-look-line className="text-muted-foreground min-w-0 flex-1 truncate" title={current.line}>
          {current.line}
        </span>
      ) : (
        <span className="text-muted-foreground min-w-0 flex-1 truncate">{view.looks.length ? "Every new clip of this song gets the same camera, grain and colour." : "No Film looks yet: make one from a still (ShotDeck, Midjourney or a photo)."}</span>
      )}
      <Link href="/film-looks" className="text-brand shrink-0 hover:underline" data-film-look-manage>
        {view.looks.length ? "Film looks" : "Make one"}
      </Link>
      {error ? <span className="w-full text-red-300">{error}</span> : null}
    </div>
  );
}
