"use client";

import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { detectService, LINK_GROUPS, LINK_SERVICES, linkLabel, linkService, normaliseUrl, type SongLink } from "@lyric/video/song-links";

import { CopyButton } from "@/components/copy-button";
import { PickedChip, SearchPicker } from "@/components/search-picker";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const SERVICE_ITEMS = LINK_SERVICES.map((s) => ({ id: s.id, label: s.label, tags: [s.group], note: s.group }));

type LinksData = { links: SongLink[]; postLinks: Record<string, string[]> };

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

// A link shown readably: "open.spotify.com/track/abc" (no https://, no trailing slash).
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

type Change =
  | { op: "add"; url: string }
  | { op: "update"; url: string; patch: { service?: string; url?: string; label?: string | null } }
  | { op: "remove"; url: string }
  | { op: "restore"; link: SongLink; index: number; picks?: string[] };

// Prepare → Song Details (N1; was the Assets tab): where people can hear the song and find the artist (song.json "links"). Paste a link and
// the app names its service from the address (the picker is only for corrections). Each change goes to the server as ONE change
// (add, edit, remove, restore) that it applies to the list in song.json, one after the other: a link added never replaces another,
// even with a stale page or quick clicks. Rows show the link; ✎ opens that row only. A removed link can be brought back with Undo.
export function LinksField({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<SongLink[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<{ url: string; service: string; label: string; newUrl: string } | null>(null);
  const [undo, setUndo] = useState<{ link: SongLink; index: number; picks: string[] } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api(`/api/songs/${projectId}/links`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: LinksData) => setLinks(d.links ?? []))
      .catch(() => setLinks((l) => l ?? []));
    return () => clearTimeout(undoTimer.current);
  }, [projectId]);

  // One change at a time, in the order made; the answer is the whole list as saved. Resolves to the answer, or null on an error.
  const send = (change: Change): Promise<(LinksData & { removedPicks?: string[] }) | null> => {
    const run = async () => {
      setError(null);
      setSaved(false);
      try {
        const r = await api(`/api/songs/${projectId}/links`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
        const body = (await r.json().catch(() => ({}))) as Partial<LinksData> & { error?: string; removedPicks?: string[] };
        if (!r.ok || body.error || !body.links) {
          setError(body.error ?? "Could not save the links");
          return null;
        }
        setLinks(body.links);
        setSaved(true);
        return body as LinksData & { removedPicks?: string[] };
      } catch {
        setError("Could not save the links");
        return null;
      }
    };
    const next = queue.current.then(run, run);
    queue.current = next;
    return next;
  };

  const add = async (text: string = draft) => {
    const url = normaliseUrl(text);
    if (!url) return setError(text.trim() ? `"${text.trim()}" is not a web address` : null);
    if (links?.some((l) => l.url === url)) return setError("That link is already in the list");
    setDraft("");
    const done = await send({ op: "add", url });
    if (!done) setDraft(text);
  };

  const remove = async (l: SongLink, index: number) => {
    const done = await send({ op: "remove", url: l.url });
    if (!done) return;
    setEditing(null);
    setUndo({ link: l, index, picks: done.removedPicks ?? [] });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 20000);
  };

  const restore = async () => {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    clearTimeout(undoTimer.current);
    await send({ op: "restore", link: u.link, index: u.index, picks: u.picks });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const url = normaliseUrl(editing.newUrl);
    if (!url) return setError(`"${editing.newUrl.trim()}" is not a web address`);
    const done = await send({ op: "update", url: editing.url, patch: { service: editing.service, url, label: editing.service === "other" ? editing.label : null } });
    if (done) setEditing(null);
  };

  if (links === null) return null;

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
          {links.map((l, i) =>
            editing?.url === l.url ? (
              <li key={l.url} className="flex flex-wrap items-center gap-2" data-link-row={l.service} data-link-editing>
                <ServicePicker value={editing.service} name={`link-service-${i}`} onPick={(id) => setEditing({ ...editing, service: id })} />
                {editing.service === "other" ? (
                  <input
                    data-link-label
                    value={editing.label}
                    maxLength={40}
                    placeholder="name (e.g. Merch)"
                    className="bg-input/30 border-input h-8 w-32 rounded-md border px-2 text-sm"
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  />
                ) : null}
                <input
                  data-link-url
                  autoFocus
                  value={editing.newUrl}
                  className="bg-input/30 border-input h-8 min-w-60 flex-1 rounded-md border px-2 text-sm"
                  onChange={(e) => {
                    const v = e.target.value;
                    // A pasted address names its service again, unless the user already corrected the service by hand.
                    const auto = detectService(editing.newUrl) ?? "website";
                    setEditing({ ...editing, newUrl: v, service: editing.service === auto ? (detectService(v) ?? editing.service) : editing.service });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button type="button" data-link-save onClick={() => void saveEdit()} className="hover:bg-accent rounded-md border px-2.5 py-1 text-xs">
                  Save
                </button>
                <button
                  type="button"
                  data-link-cancel
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1 text-xs"
                >
                  Cancel
                </button>
              </li>
            ) : (
              <li key={l.url} className="flex flex-wrap items-center gap-2" data-link-row={l.service}>
                <span className="min-w-28 font-medium" data-link-service>
                  {linkLabel(l)}
                </span>
                <a href={l.url} target="_blank" rel="noreferrer" title={l.url} data-link-shown className="text-muted-foreground hover:text-foreground min-w-0 flex-1 truncate text-sm">
                  {shortUrl(l.url)}
                </a>
                <CopyButton text={l.url} label="Copy" />
                <button
                  type="button"
                  aria-label="Edit link"
                  data-link-edit
                  onClick={() => {
                    setError(null);
                    setEditing({ url: l.url, service: l.service, label: l.label ?? "", newUrl: l.url });
                  }}
                  className="text-muted-foreground hover:text-foreground rounded-md p-1.5"
                >
                  <Pencil className="size-4" />
                </button>
                <button type="button" aria-label="Remove link" data-link-remove onClick={() => void remove(l, i)} className="text-muted-foreground hover:text-foreground rounded-md p-1.5">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {undo ? (
        <p className="bg-muted/40 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs" data-link-removed>
          Removed {linkLabel(undo.link)}.
          <button type="button" data-link-undo onClick={() => void restore()} className="text-foreground underline">
            Undo
          </button>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-link-new
          value={draft}
          placeholder="Paste a link (Spotify, Apple Music, Feature.fm, Instagram, your website…): the service is recognised"
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
// description follow the pick, which is kept per platform. No links yet: a pointer to Prepare → Song Details.
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
          Add them in Prepare → Song Details
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
