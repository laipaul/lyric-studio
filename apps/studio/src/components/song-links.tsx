"use client";

import { Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { detectService, LINK_GROUPS, LINK_SERVICES, linkLabel, linkService, normaliseUrl, type SongLink } from "@lyric/video/song-links";

import { CopyButton } from "@/components/copy-button";
import { PickedChip, SearchPicker } from "@/components/search-picker";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const SERVICE_ITEMS = LINK_SERVICES.map((s) => ({ id: s.id, label: s.label, tags: [s.group], note: s.group }));

type LinksData = { links: SongLink[]; postLinks: Record<string, string[]> };

const put = (projectId: string, links: SongLink[]) =>
  api(`/api/songs/${projectId}/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links }) });

// The service of one link: a searchable picker (the list is long: stores, smart links, social pages).
function ServicePicker({ value, onPick, name }: { value: string; onPick: (id: string) => void; name: string }) {
  return (
    <SearchPicker
      items={SERVICE_ITEMS}
      selected={[value]}
      onPick={onPick}
      max={1}
      filters={LINK_GROUPS}
      name={name}
      placeholder="Search services…"
      trigger={<span className="min-w-28 text-left">{linkService(value)?.label ?? "Pick a service"} ▾</span>}
    />
  );
}

// Prepare → Texts (N1; was the Assets tab): where people can hear the song and find the artist (song.json "links"). Paste a link and
// the app names its service; change it with the picker. Saved at once; the posting texts use them.
export function LinksField({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<SongLink[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api(`/api/songs/${projectId}/links`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: LinksData) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, [projectId]);

  const save = async (next: SongLink[]) => {
    setError(null);
    setSaved(false);
    const r = await put(projectId, next);
    const body = (await r.json().catch(() => ({}))) as Partial<LinksData> & { error?: string };
    if (!r.ok || body.error) return setError(body.error ?? "Could not save the links");
    setLinks(body.links ?? next);
    setSaved(true);
  };

  const add = async (text: string = draft) => {
    const url = normaliseUrl(text);
    if (!url) return setError(text.trim() ? `"${text.trim()}" is not a web address` : null);
    if (links?.some((l) => l.url === url)) return setError("That link is already in the list");
    const service = detectService(url) ?? "website";
    setDraft("");
    await save([...(links ?? []), { service, url }]);
  };

  if (links === null) return null;
  const change = (i: number, patch: Partial<SongLink>) => links.map((l, j) => (j === i ? { ...l, ...patch } : l));

  return (
    <section className="bg-card flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm" data-links>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <Link2 className="size-4" /> Links
        </span>
        <span className="text-muted-foreground text-xs">
          {saved ? "saved · " : ""}where to hear the song and find the artist: the Post panel puts them in the captions and the YouTube description
        </span>
      </div>
      {links.length ? (
        <ul className="flex flex-col gap-1.5">
          {links.map((l, i) => (
            <li key={`${i}-${l.service}`} className="flex flex-wrap items-center gap-2" data-link-row={l.service}>
              <ServicePicker value={l.service} name={`link-service-${i}`} onPick={(id) => void save(change(i, { service: id, ...(id === "other" ? {} : { label: undefined }) }))} />
              {l.service === "other" ? (
                <input
                  data-link-label
                  defaultValue={l.label ?? ""}
                  maxLength={40}
                  placeholder="name (e.g. Merch)"
                  className="bg-input/30 border-input h-8 w-32 rounded-md border px-2 text-sm"
                  onBlur={(e) => e.target.value.trim() !== (l.label ?? "") && void save(change(i, { label: e.target.value.trim() || undefined }))}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              ) : null}
              <input
                data-link-url
                defaultValue={l.url}
                className="bg-input/30 border-input h-8 min-w-60 flex-1 rounded-md border px-2 text-sm"
                onBlur={(e) => {
                  const url = normaliseUrl(e.target.value);
                  if (!url) {
                    setError(`"${e.target.value.trim()}" is not a web address`);
                    e.target.value = l.url;
                  } else if (url !== l.url) void save(change(i, { url }));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <CopyButton text={l.url} label="Copy" />
              <button type="button" aria-label="Remove link" data-link-remove onClick={() => void save(links.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground rounded-md p-1.5">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-link-new
          value={draft}
          placeholder="Paste a link (Spotify, Apple Music, Feature.fm, Instagram, your website…)"
          className="bg-input/30 border-input h-8 min-w-60 flex-1 rounded-md border px-2 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!draft.trim() && normaliseUrl(text)) {
              e.preventDefault();
              void add(text);
            }
          }}
        />
        <button type="button" data-link-add onClick={() => void add()} disabled={!draft.trim()} className="hover:bg-accent flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50">
          <Plus className="size-3.5" /> Add link
        </button>
      </div>
      {error ? <p className="text-xs text-amber-300">{error}</p> : null}
    </section>
  );
}

// Post panel: the song's links picked for this post (chips; + to add one, × to leave one out), each with a
// copy button for pasting while posting (e.g. the bio, a story's link sticker). The caption / YouTube
// description follow the pick, which is kept per platform. No links yet: a pointer to Prepare → Texts.
export function PostLinks({
  projectId,
  platform,
  all,
  picked,
  own,
  onChange,
}: {
  projectId: string;
  platform: string;
  all: SongLink[];
  picked: string[];
  own: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pick = async (urls: string[] | null) => {
    setBusy(true);
    await api(`/api/songs/${projectId}/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, urls }) });
    setBusy(false);
    onChange();
  };
  if (!all.length)
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs" data-post-links-none>
        No links for this song yet (Spotify, Apple Music, a smart link, your website…).{" "}
        <a href={`/songs/${projectId}?tab=details`} className="text-foreground underline">
          Add them in Prepare → Texts
        </a>
      </p>
    );
  const items = all.map((l) => ({ id: l.url, label: `${linkLabel(l)} · ${l.url}` }));
  const chosen = picked.map((u) => all.find((l) => l.url === u)).filter((l): l is SongLink => !!l);
  return (
    <section className={cn("flex flex-col gap-1.5", busy && "opacity-60")} data-post-links>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Links for this post</h3>
        <div className="flex items-center gap-2">
          {own ? (
            <button type="button" className="text-muted-foreground text-xs underline" data-post-links-reset onClick={() => void pick(null)}>
              Back to the usual ones
            </button>
          ) : null}
          <SearchPicker
            items={items}
            selected={picked}
            onPick={(u) => void pick(picked.includes(u) ? picked.filter((x) => x !== u) : [...picked, u])}
            name="post-links"
            placeholder="Search the song's links…"
            trigger={
              <span className="flex items-center gap-1">
                <Plus className="size-3.5" /> Add a link
              </span>
            }
          />
        </div>
      </div>
      {chosen.length ? (
        <ul className="flex flex-col gap-1">
          {chosen.map((l) => (
            <li key={l.url} className="flex items-center gap-2" data-post-link={l.service}>
              <PickedChip name="post-link" id={l.url} onRemove={() => void pick(picked.filter((u) => u !== l.url))}>
                <span className="font-medium">{linkLabel(l)}</span>
              </PickedChip>
              <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{l.url}</code>
              <CopyButton text={l.url} label="Copy" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">No link in this post. Add one with “Add a link”.</p>
      )}
      <p className="text-muted-foreground text-[11px]">
        {platform === "youtube" ? "These go into the description." : "Links in Reels, TikTok and Shorts captions are not clickable: paste the link in your bio, a story link sticker or a pinned comment."}
      </p>
    </section>
  );
}
