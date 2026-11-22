"use client";

// The Film looks page (22 Nov 2026, Paul: "the global look is correct like the Theme"). A Film look is one camera,
// grain and grade for every clip of a song: a reference still (a ShotDeck screenshot with its data block, a Midjourney
// frame or a photo) and one look line. "Write it from the still" lets the app write the line and the Midjourney words
// (Gemini, on Paul's key), so no camera words are needed from him; he can still change the words. A song picks its
// look in Prepare → Creation. Saving a look other songs use asks: "Update all N songs" or "Save as new".
import { ImagePlus, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FilmLooksPage } from "@lyric/video/film-looks";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

type Look = FilmLooksPage["looks"][number];
const fileUrl = (rel: string, v: number) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}?v=${v}`;
const field = "bg-input/30 border-input w-full rounded-md border px-2 py-1.5 text-sm";

export function FilmLooksView() {
  const [data, setData] = useState<FilmLooksPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [stamp, setStamp] = useState(0); // a new still shows at once

  async function send(url: string, init?: RequestInit): Promise<boolean> {
    setError(null);
    try {
      const r = await api(url, { cache: "no-store", ...init });
      const d = (await r.json()) as FilmLooksPage & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  const act = (body: Record<string, unknown>) => send("/api/film-looks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function still(name: string, file: File) {
    const form = new FormData();
    form.set("name", name);
    form.set("file", file);
    if (await send("/api/film-looks/still", { method: "POST", body: form })) setStamp((n) => n + 1);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's data, read once
    void send("/api/film-looks");
  }, []);

  if (!data) return <p className={cn("p-6 text-sm", error ? "text-red-300" : "text-muted-foreground")}>{error ?? "Loading the Film looks…"}</p>;

  return (
    <div data-film-looks-page className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display flex items-center gap-2 text-2xl">
          <FeatureIcon feature="filmLook" className="size-6" /> Film looks
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          A Film look keeps every clip of a song looking like one film: the same camera, grain and colour. Drop in a still you love, let the app write the words, then pick the look for a song in <b>Prepare → Creation</b>. Every new Animate and singing clip of that song gets it.
        </p>
      </div>
      {error ? <p data-film-looks-error className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
        {newName === null ? (
          <button type="button" data-film-look-new onClick={() => setNewName("")} className="text-muted-foreground hover:text-foreground hover:border-brand flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm">
            <Plus className="size-6" /> New film look
          </button>
        ) : (
          <form
            data-film-look-create
            className="bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ action: "create", name: newName })) setNewName(null);
            }}
          >
            <span className="font-medium">New film look</span>
            <input autoFocus data-film-look-new-name aria-label="Film look name" placeholder="Name it (e.g. Warm wedding film)" className={field} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <p className="text-muted-foreground text-xs">Next you drop in a still, and the app writes the words.</p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!newName.trim()}>
                Create
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewName(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {data.looks.map((l) => (
          <LookCard key={l.name} look={l} stamp={stamp} writer={data.writer} act={act} onStill={(f) => void still(l.name, f)} />
        ))}
      </div>

      {data.removed.length ? (
        <div className="text-sm">
          <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline" onClick={() => setShowRemoved((x) => !x)} data-film-looks-removed-toggle>
            {showRemoved ? "Hide" : "Show"} deleted Film looks ({data.removed.length})
          </button>
          {showRemoved ? (
            <ul className="mt-2 flex flex-col gap-1">
              {data.removed.map((r) => (
                <li key={r.folder} className="flex items-center gap-2 text-xs" data-film-look-removed={r.name}>
                  <span>{r.name}</span>
                  {r.removedAt ? <span className="text-muted-foreground">deleted {new Date(r.removedAt).toLocaleString()}</span> : null}
                  <Button size="sm" variant="secondary" onClick={() => void act({ action: "restore", folder: r.folder })}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LookCard({ look, stamp, writer, act, onStill }: { look: Look; stamp: number; writer: FilmLooksPage["writer"]; act: (b: Record<string, unknown>) => Promise<boolean>; onStill: (f: File) => void }) {
  const [name, setName] = useState(look.name);
  const [line, setLine] = useState(look.line);
  const [mj, setMj] = useState(look.midjourney);
  const [writing, setWriting] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The words from the server once they change there (written from the still, saved).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the saved look
    setName(look.name);
    setLine(look.line);
    setMj(look.midjourney);
  }, [look.name, look.line, look.midjourney]);

  const changed = name.trim() !== look.name || line.trim() !== look.line || mj.trim() !== look.midjourney;
  const songs = look.songs.length;
  const save = (scope: "all" | "new") => act({ action: "save", name: look.name, newName: name, line, midjourney: mj, scope });

  return (
    <div data-film-look-card={look.name} className="bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div
        data-film-look-still
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onStill(f);
        }}
        className={cn("bg-muted/30 relative flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-md border", over && "border-brand")}
        title="Drop a still here, or click to choose one (a ShotDeck screenshot with its data block works best)"
      >
        {look.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local file
          <img src={fileUrl(look.stillUrl, stamp)} alt={`${look.name} still`} className="size-full object-contain" />
        ) : (
          <span className="text-muted-foreground flex flex-col items-center gap-1 px-4 text-center text-xs">
            <ImagePlus className="size-6" /> Drop a still here: a ShotDeck screenshot with its data block, a Midjourney frame or a photo
          </span>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && onStill(e.target.files[0])} />
      </div>

      <input data-film-look-name aria-label="Name" className={cn(field, "font-medium")} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">The look (added to every clip)</span>
        <Button
          size="sm"
          variant="secondary"
          data-film-look-write
          disabled={!look.stillUrl || !writer.ready || writing}
          title={!look.stillUrl ? "Drop a still first" : writer.ready ? `The app writes the words from the still: ${writer.how}` : writer.how}
          onClick={async () => {
            setWriting(true);
            await act({ action: "write", name: look.name });
            setWriting(false);
          }}
        >
          {writing ? <Loader2 className="animate-spin" /> : <Sparkles />} {look.line ? "Write again" : "Write it from the still"}
        </Button>
      </div>
      <textarea data-film-look-line aria-label="The look" rows={3} className={field} placeholder={look.stillUrl ? "Press “Write it from the still”, or type a few words" : "Drop a still, or type a few words (e.g. warm 35mm film, soft light)"} value={line} onChange={(e) => setLine(e.target.value)} />
      {!writer.ready ? <p className="text-muted-foreground text-xs">{writer.how}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">For Midjourney (so your pictures start in this look)</span>
        {mj ? <CopyButton text={mj} label="Copy" /> : null}
      </div>
      <textarea data-film-look-midjourney aria-label="For Midjourney" rows={2} className={field} value={mj} onChange={(e) => setMj(e.target.value)} />

      <p className="text-muted-foreground text-xs" data-film-look-songs>
        {songs ? `Used by ${look.songs.map((s) => s.title).join(", ")}` : "Not used by a song yet"}
      </p>
      <div className="flex flex-wrap gap-2">
        {changed ? (
          <>
            <Button size="sm" data-film-look-save onClick={() => void save("all")}>
              {songs > 1 ? `Update all ${songs} songs` : "Save"}
            </Button>
            {songs ? (
              <Button size="sm" variant="secondary" data-film-look-save-new onClick={() => void save("new")}>
                Save as new
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(look.name);
                setLine(look.line);
                setMj(look.midjourney);
              }}
            >
              Cancel
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto" data-film-look-delete title={songs ? "Pick another Film look for its songs first" : "Delete (you can restore it)"} disabled={songs > 0} onClick={() => void act({ action: "remove", name: look.name })}>
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}
