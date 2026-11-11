"use client";

// Prepare → Song Details → Tags (11 Nov 2026): the song's hashtags as a ranked list of chips (drag to reorder; keep
// as many as you like), the brand's tags in it ("from your brand", added to every song), suggestions as grey chips
// (one click adds them, they turn pink) and, per platform, the top ones its post uses (Instagram / Facebook 5, ...).
// Saved in song.json "tags"; the brand's tags and starter set in brand.json (song-tags.ts, node/song-links.ts).
import { GripVertical, Plus, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";

import { YOUTUBE_TAGS_CHARS, hashtags, youtubeTagsField } from "@lyric/video/song-tags";
import type { SongTagsView } from "@lyric/video/song-links-node";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const FROM: Record<string, string> = { artist: "the artist", title: "the title", EP: "the EP", language: "the lyrics' language", starter: "your brand's starter set" };
const DRAG = "application/x-lyric-tag";

export function TagsField({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SongTagsView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [brandOpen, setBrandOpen] = useState(false); // Edit brand tags (the artist's, for every song)

  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/tags`, { cache: "no-store" })
      .then((r) => r.json() as Promise<SongTagsView & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setData(d)))
      .catch(() => alive && setError("Could not load the tags"));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // The whole ranked list (the brand's tags where they stand) is saved; the answer is the list as kept.
  async function save(tags: string[], brand?: { tags?: string[]; starters?: string[] }) {
    setError(null);
    setSaved(false);
    try {
      const r = await api(`/api/songs/${projectId}/tags`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brand ? { brand } : { tags }) });
      const d = (await r.json()) as SongTagsView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d);
      setSaved(true);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  if (!data) return error ? <p className="text-sm text-red-300">{error}</p> : null;
  const list = data.tags.map((t) => t.tag);
  const add = async (more: string[]) => (more.length ? save([...list, ...more]) : false);
  const remove = (tag: string) => void save(list.filter((t) => t !== tag));
  const move = (tag: string, onto: string) => {
    if (tag === onto) return;
    const next = list.filter((t) => t !== tag);
    next.splice(next.indexOf(onto) + (list.indexOf(tag) < list.indexOf(onto) ? 1 : 0), 0, tag);
    void save(next);
  };
  const youtubeTags = youtubeTagsField(list);

  return (
    <section data-tags className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 font-medium">
          <Tag className="size-4" /> Tags
        </h3>
        <p className="text-muted-foreground text-xs">Your hashtags in order of importance: each post uses the top ones (below). Drag to reorder.</p>
        {saved ? <span className="ml-auto text-xs text-emerald-300">✓ Saved</span> : null}
      </div>

      <ol className="flex flex-wrap gap-1.5" data-tag-list>
        {data.tags.map((t, i) => (
          <li
            key={t.tag}
            data-tag={t.tag}
            data-tag-brand={t.brand ? "1" : undefined}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG, t.tag)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG)) return;
              e.preventDefault();
              setOver(t.tag);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const tag = e.dataTransfer.getData(DRAG);
              if (tag) move(tag, t.tag);
            }}
            title={t.brand ? "From your brand: added to every song of this artist (change it in brand.json)" : undefined}
            className={cn(
              "flex cursor-grab items-center gap-1 rounded-full border px-2 py-0.5 text-xs active:cursor-grabbing",
              t.brand ? "border-brand/60 text-brand" : "border-brand/40 bg-brand/15 text-brand",
              over === t.tag && "ring-brand ring-2",
            )}
          >
            <GripVertical className="size-3 opacity-50" />
            <span className="text-muted-foreground tabular-nums">{i + 1}</span> #{t.tag}
            {t.brand ? (
              <span className="text-muted-foreground text-[10px]">from your brand</span>
            ) : (
              <button type="button" data-tag-remove={t.tag} aria-label={`Remove #${t.tag}`} onClick={() => remove(t.tag)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
        <li className="flex items-center">
          <button type="button" data-brand-edit aria-expanded={brandOpen} onClick={() => setBrandOpen((o) => !o)} className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
            {brandOpen ? "Close brand tags" : "Edit brand tags"}
          </button>
        </li>
      </ol>
      {brandOpen ? (
        // The artist's own: saved for every song of this artist (Pômé has her own set).
        <div data-brand-editor className="border-brand/40 bg-brand/5 flex flex-col gap-3 rounded-md border p-3">
          <p className="text-xs">
            <span className="font-medium">Brand tags</span> <span className="text-muted-foreground">· saved for every song of this artist</span>
          </p>
          <ChipRow name="brand" tags={data.brand.tags} onChange={(tags) => save([], { tags })} placeholder="e.g. lifelyricsstudio" />
          <p className="text-xs">
            <span className="font-medium">Starter set</span> <span className="text-muted-foreground">· genre and mood suggestions offered on every song</span>
          </p>
          <ChipRow name="starters" tags={data.brand.starters} onChange={(starters) => save([], { starters })} placeholder="e.g. emotional pop" />
          <button type="button" data-brand-done onClick={() => setBrandOpen(false)} className="bg-brand text-brand-foreground self-start rounded-md px-3 py-1 text-xs font-medium">
            Done
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          data-tag-new
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void add([draft]).then((ok) => ok && setDraft(""));
          }}
          placeholder="Add a tag, e.g. emotional pop → #emotionalpop (commas for several)"
          className="bg-input/30 border-input h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
        />
        <button type="button" data-tag-add onClick={() => void add([draft]).then((ok) => ok && setDraft(""))} disabled={!draft.trim()} className="hover:bg-accent flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50">
          <Plus className="size-3.5" /> Add
        </button>
      </div>

      {data.suggestions.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">Suggestions (click to add or take out):</p>
          <ul className="flex flex-wrap gap-1.5" data-tag-suggestions>
            {data.suggestions.map((s) => (
              <li key={s.tag}>
                <button
                  type="button"
                  data-tag-suggestion={s.tag}
                  aria-pressed={s.added}
                  title={`From ${FROM[s.from] ?? s.from}`}
                  onClick={() => (s.added ? remove(s.tag) : void add([s.tag]))}
                  className={cn("rounded-full border px-2 py-0.5 text-xs", s.added ? "border-brand/40 bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground border-dashed")}
                >
                  {s.added ? "" : "+ "}#{s.tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5 border-t pt-2 text-xs" data-tag-previews>
        {data.previews.map((p) =>
          p.platform === "youtube" ? (
            <p key={p.platform} data-tag-preview={p.platform} className="text-muted-foreground">
              <span className="text-foreground">YouTube</span> shows {hashtags(p.uses) || "none"} above the title · its Tags box: {youtubeTags.split(", ").filter(Boolean).length} tag(s), {youtubeTags.length}/{YOUTUBE_TAGS_CHARS} characters
            </p>
          ) : (
            <p key={p.platform} data-tag-preview={p.platform} className="text-muted-foreground">
              <span className="text-foreground">{p.label}</span> uses: {hashtags(p.uses) || "none"}
              {list.length > p.limit ? <span className="opacity-70"> (top {p.limit})</span> : null}
            </p>
          ),
        )}
      </div>

      <p className="text-muted-foreground text-[11px]" data-brand-tags>
        From your brand (every song of this artist): {hashtags(data.brand.tags) || "none"}
        {data.brand.set ? "" : " (the artist's name)"} · kept in{" "}
        <span className="font-mono" title={data.brand.file}>
          {data.brand.file.split(/[\\/]/).slice(-3).join("\\")}
        </span>
      </p>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </section>
  );
}

// One editable row of chips (the brand tags, the starter set): × takes one out, drag reorders, typing adds (cleaned
// by the server). Every change is saved at once.
function ChipRow({ name, tags, onChange, placeholder }: { name: string; tags: string[]; onChange: (tags: string[]) => Promise<boolean>; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const drag = `application/x-lyric-${name}`;
  const add = () => draft.trim() && void onChange([...tags, draft]).then((ok) => ok && setDraft(""));
  return (
    <div className="flex flex-col gap-1.5" data-chip-row={name}>
      <ul className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <li
            key={t}
            data-chip={t}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(drag, t)}
            onDragOver={(e) => e.dataTransfer.types.includes(drag) && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData(drag);
              if (!from || from === t) return;
              const next = tags.filter((x) => x !== from);
              next.splice(next.indexOf(t) + (tags.indexOf(from) < tags.indexOf(t) ? 1 : 0), 0, from);
              void onChange(next);
            }}
            className="border-brand/40 bg-brand/15 text-brand flex cursor-grab items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            #{t}
            <button type="button" data-chip-remove={t} aria-label={`Remove #${t}`} onClick={() => void onChange(tags.filter((x) => x !== t))} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </li>
        ))}
        {!tags.length ? <li className="text-muted-foreground text-xs">none</li> : null}
      </ul>
      <div className="flex items-center gap-2">
        <input data-chip-new={name} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder={placeholder} className="bg-input/30 border-input h-7 min-w-0 flex-1 rounded-md border px-2 text-xs" />
        <button type="button" data-chip-add={name} onClick={add} disabled={!draft.trim()} className="hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs disabled:opacity-50">
          <Plus className="size-3" /> Add
        </button>
      </div>
    </div>
  );
}
