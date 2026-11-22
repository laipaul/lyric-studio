"use client";

// Prepare → Creation (tab id "production"). G2 (21 Nov 2026, Paul's picture-first flow): the picture board comes first
// (pictures-board.tsx); the G1 story tools below are optional and folded away.
// G1 (21 Nov 2026): what this song's clips are made from.
// 1 Cast (optional): character and scene cards linked from the shared library (Characters page), never copied.
// 2 Story bible (optional): the song's own, or its EP's (shared by the EP's songs).
// 3 Ask Claude: one click copies the Song brief (lyrics with times, sizes, cast, bible, the shot list format) for
//   Joey's Story Bible Builder and Shotcaller skills; Claude's answer is pasted back: a shot list goes to the
//   shot list check and import, other text can become the story bible.
// 4 Shot list: the planned slots in the Storyboard (C2). The clips are made from them in the next steps.
// Nothing here costs anything: no AI service is called.
import { BookOpen, Check, ClipboardPaste, Copy, Download, ExternalLink, FileJson, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CastCard, ProductionData } from "@lyric/video/production";

import { PicturesBoard } from "@/components/pictures-board";
import { PickedChip, SearchPicker } from "@/components/search-picker";
import { ShotListImport } from "@/components/shotlist-import";
import { useGoToTab } from "@/components/song-stages";
import { useSongStyle } from "@/components/song-style";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const cardUrl = (c: Pick<CastCard, "id" | "thumbnail" | "updated_at">) => `/api/cards/${c.id}/file/${c.thumbnail.split("/").map(encodeURIComponent).join("/")}?t=${encodeURIComponent(c.updated_at)}`;
type Notice = { ok: boolean; text: string } | null;
type Pasted = { kind: "shotlist"; json: string; slots: number } | { kind: "bible"; text: string } | { kind: "empty" };

function Section({ n, title, optional, icon: Icon, children, id }: { n: number; title: string; optional?: boolean; icon: typeof Users; children: React.ReactNode; id: string }) {
  return (
    <section data-production-section={id} className="bg-card/40 flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-muted text-muted-foreground flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums">{n}</span>
        <Icon className="text-brand size-4" />
        {title}
        {optional ? <span className="text-muted-foreground text-xs font-normal">optional</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function ProductionTab({ projectId }: { projectId: string }) {
  const goTo = useGoToTab();
  const film = useSongStyle(projectId)?.style === "film"; // Mini film: the story tools open (song-style.ts)
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [bible, setBible] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState<Pasted | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [preset, setPreset] = useState<{ name: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/songs/${projectId}/production`);
      const d = (await r.json()) as { production?: ProductionData; error?: string };
      if (!r.ok || !d.production) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setData(d.production);
      setBible(d.production.bible.text);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab's data, loaded once it is shown
    void load();
  }, [load]);

  async function post<T>(body: Record<string, unknown>): Promise<T> {
    const r = await api(`/api/songs/${projectId}/production`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json()) as T & { error?: string };
    if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
    return d;
  }
  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    try {
      const text = await work();
      if (text) setNotice({ ok: true, text });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>;

  const castIds = data.cast.map((c) => c.id);
  const setCast = (ids: string[], text: string) => run(async () => (await post({ action: "cast", ids }), text));
  const toggle = (id: string) => {
    const c = data.library.find((x) => x.id === id);
    if (castIds.includes(id)) void setCast(castIds.filter((x) => x !== id), `${c?.name ?? "The card"} is out of this song's cast (it stays in your library).`);
    else void setCast([...castIds, id], `${c?.name ?? "The card"} is in this song's cast.`);
  };
  const libraryItems = [...data.library]
    .sort((a, b) => Number(castIds.includes(b.id)) - Number(castIds.includes(a.id)) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, label: c.name, tags: [c.kind === "character" ? "Characters" : "Scenes", ...(c.locked ? ["Locked"] : [])] }));
  const castNames = data.cast.filter((c): c is CastCard => !c.missing).map((c) => c.name.toLowerCase());
  const notInCast = (data.shotlist?.usesCast ?? []).filter((n) => !castNames.includes(n.toLowerCase()));
  const bibleChanged = bible.trim() !== data.bible.text.trim();

  async function copyBrief() {
    setBusy(true);
    try {
      const { brief } = await post<{ brief: string }>({ action: "brief" });
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setNotice({ ok: true, text: "The Song brief is copied. Paste it into Claude (with the Shotcaller skill), then paste Claude's answer below." });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function saveBriefFile() {
    try {
      const { brief } = await post<{ brief: string }>({ action: "brief" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([brief], { type: "text/markdown" }));
      a.download = `${data!.title} - song brief.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  async function readPaste(text: string) {
    setPaste(text);
    setPasted(null);
    if (!text.trim()) return;
    try {
      const d = await post<{ pasted: Pasted }>({ action: "paste", text });
      setPasted(d.pasted);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div data-production className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">Your creation space: drop pictures and videos from anywhere, animate the pictures you like, then send your favourites to the Storyboard. No story needed.</p>
      <PicturesBoard projectId={projectId} />
      <details data-story-tools className="max-w-4xl" open={film || undefined}>
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">{film ? "Story tools (Mini film): cast, story bible, Song brief for Claude, shot list" : "Story tools (optional): cast, story bible, Song brief for Claude, shot list"}</summary>
        <div className="mt-3 flex flex-col gap-4">
      {notice ? (
        <p data-production-notice={notice.ok ? "ok" : "error"} className={cn("rounded-md border p-2 text-sm", notice.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200")}>
          {notice.text}
        </p>
      ) : null}

      <Section n={1} id="cast" title="Cast" optional icon={Users}>
        <p className="text-muted-foreground text-xs">Characters and places from your library (the Characters page). They are linked, not copied: when you lock a new version of a card, every song that uses it gets it.</p>
        <div className="flex flex-wrap items-center gap-1.5" data-cast>
          {data.cast.map((c) =>
            c.missing ? (
              <PickedChip key={c.id} name="cast" id={c.id} onRemove={() => void setCast(castIds.filter((x) => x !== c.id), "The missing card is out of the cast.")}>
                <span className="text-amber-300">{c.name}</span>
              </PickedChip>
            ) : (
              <PickedChip key={c.id} name="cast" id={c.id} onRemove={() => toggle(c.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cardUrl(c)} alt="" className="size-6 rounded-full object-cover" />
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">{c.kind === "character" ? "character" : "scene"}</span>
                {!c.locked ? <span className="text-amber-300" title="Lock it on the Characters page before its clips are made">not locked</span> : null}
                {c.looks.length > 1 ? (
                  <select
                    data-cast-look={c.id}
                    value={c.look}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => void run(async () => (await post({ action: "look", card: c.id, look: e.target.value }), `${c.name} wears "${c.looks.find((l) => l.id === e.target.value)?.name}" in this song.`))}
                    className="bg-background rounded border px-1 py-0.5 text-xs"
                    title="Which look of the wardrobe this character wears in this song"
                  >
                    {c.looks.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.locked ? "" : " (not locked)"}
                      </option>
                    ))}
                  </select>
                ) : null}
              </PickedChip>
            ),
          )}
          <SearchPicker
            name="cast"
            items={libraryItems}
            selected={castIds}
            onPick={toggle}
            filters={["Characters", "Scenes", "Locked"]}
            tiles
            placeholder="Search your characters and scenes…"
            disabled={busy || !data.library.length}
            trigger={
              <>
                <Plus className="size-3.5" /> {data.library.length ? "Add from your library" : "Your library is empty"}
              </>
            }
            render={(c, picked) => (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cardUrl(c)} alt="" className="aspect-[3/4] w-full rounded object-cover" />
                <span className="flex items-center justify-between gap-1 px-0.5 text-xs">
                  <span className="truncate font-medium">{c.name}</span>
                  {picked ? <Check className="text-brand size-3.5 shrink-0" /> : null}
                </span>
                <span className="text-muted-foreground px-0.5 text-[10px]">
                  {c.kind === "character" ? "Character" : "Scene"}
                  {c.locked ? " · locked" : " · draft"}
                </span>
              </>
            )}
          />
          <Link href="/characters" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline underline-offset-2">
            Make a new character <ExternalLink className="size-3" />
          </Link>
        </div>
        {notInCast.length ? (
          <p className="text-xs text-amber-300" data-cast-missing>
            The shot list also uses {notInCast.join(", ")}.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                const ids = data.library.filter((c) => notInCast.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.id);
                void setCast([...castIds, ...ids.filter((x) => !castIds.includes(x))], "The shot list's characters and places are in the cast.");
              }}
            >
              Add to the cast
            </button>
          </p>
        ) : null}
      </Section>

      <Section n={2} id="bible" title="Story bible" optional icon={BookOpen}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2">
            Bible
            <select
              data-bible-source
              value={data.bible.source}
              disabled={busy || bibleChanged}
              title={bibleChanged ? "Save or undo your changes first" : undefined}
              onChange={(e) => void run(async () => (await post({ action: "bibleSource", source: e.target.value }), e.target.value === "ep" ? `This song uses the EP "${data.ep}" bible.` : "This song uses its own bible."))}
              className="bg-background rounded-md border px-2 py-1"
            >
              <option value="song">This song&apos;s own</option>
              {data.bible.epAvailable ? <option value="ep">The EP &quot;{data.ep}&quot; (shared)</option> : null}
            </select>
          </label>
          {data.bible.source === "ep" ? <span className="text-muted-foreground">{data.bible.songs.length ? `Also used by ${data.bible.songs.join(", ")}.` : "No other song of the EP uses it yet."}</span> : null}
          {!data.bible.epAvailable ? <span className="text-muted-foreground">Give the song an EP in Song Details to share one bible across the EP.</span> : null}
        </div>
        <textarea
          data-bible-text
          value={bible}
          onChange={(e) => setBible(e.target.value)}
          rows={bible ? Math.min(18, Math.max(6, bible.split("\n").length + 1)) : 4}
          placeholder="The world, the characters, the tone and the rules every clip follows. Paste the bible Claude wrote with the Story Bible Builder skill, or write your own."
          className="bg-background min-h-24 w-full rounded-md border p-2 font-mono text-xs leading-relaxed"
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy || !bibleChanged} data-bible-save onClick={() => void run(async () => ((await post<{ changed: boolean }>({ action: "bible", text: bible })).changed ? "The story bible is saved. The earlier text is under Assets → Replaced files." : null))}>
            Save bible
          </Button>
          {bibleChanged ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setBible(data.bible.text)}>
              Undo changes
            </Button>
          ) : null}
        </div>
      </Section>

      <Section n={3} id="brief" title="Ask Claude for the shot list" icon={ClipboardPaste}>
        <p className="text-muted-foreground text-xs">
          The Song brief has what Claude needs: the lyrics with their times{data.timed ? "" : " (not timed yet: Lyrics Sync)"}, the picture size ({data.sizes.map((s) => `${s.ratio} for ${s.platforms.join(", ")}`).join("; ") || "9:16"}), your cast and bible, and the exact shot list format. Paste it into Claude with the Shotcaller skill (and Story Bible Builder for a new story).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} data-copy-brief onClick={() => void copyBrief()}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy Song brief"}
          </Button>
          <Button type="button" size="sm" variant="outline" data-save-brief onClick={() => void saveBriefFile()}>
            <Download /> Save as file
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          Paste Claude&apos;s answer here
          <textarea
            data-paste-answer
            value={paste}
            onChange={(e) => void readPaste(e.target.value)}
            onDrop={(e) => {
              const f = e.dataTransfer.files[0];
              if (!f) return;
              e.preventDefault();
              void f.text().then(readPaste);
            }}
            rows={4}
            placeholder="Paste (or drop a .json / .md file): a shot list goes to the check and import, any other text can become the story bible."
            className="bg-background w-full rounded-md border p-2 font-mono text-xs"
          />
        </label>
        {pasted?.kind === "shotlist" ? (
          <div data-pasted="shotlist" className="flex flex-wrap items-center gap-2 text-sm">
            <FileJson className="text-brand size-4" /> A shot list with {pasted.slots} slot{pasted.slots === 1 ? "" : "s"}.
            <Button
              type="button"
              size="sm"
              data-pasted-check
              onClick={() => {
                setPreset({ name: "shot list from Claude", text: pasted.json });
                setImportOpen(true);
              }}
            >
              Check and import
            </Button>
          </div>
        ) : pasted?.kind === "bible" ? (
          <div data-pasted="bible" className="flex flex-wrap items-center gap-2 text-sm">
            <BookOpen className="text-brand size-4" /> Text, not a shot list ({pasted.text.split(/\s+/).length} words).
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-pasted-bible
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (data.bible.text.trim() && !window.confirm("Replace the story bible with this text? The current one is kept under Assets → Replaced files.")) return null;
                  await post({ action: "bible", text: pasted.text });
                  setPaste("");
                  setPasted(null);
                  return "The pasted text is now the story bible.";
                })
              }
            >
              Use as the story bible
            </Button>
            <span className="text-muted-foreground text-xs">Looking for a shot list? Ask Claude for &quot;only the shot list as JSON&quot;.</span>
          </div>
        ) : null}
      </Section>

      <Section n={4} id="shotlist" title="Shot list" icon={FileJson}>
        {data.shotlist ? (
          <p className="text-sm" data-shotlist-state>
            <b>{data.shotlist.slots} slot{data.shotlist.slots === 1 ? "" : "s"}</b> in your Storyboard, imported {new Date(data.shotlist.imported_at).toLocaleString()} from {data.shotlist.source}. Their clips are made from them in the next step.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm" data-shotlist-state>
            No shot list yet. Paste Claude&apos;s answer above, or import a shot list file.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-production-import
            onClick={() => {
              setPreset(null);
              setImportOpen(true);
            }}
          >
            <FileJson /> Import shot list file
          </Button>
          {data.shotlist ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => goTo("clips")}>
              Open Storyboard
            </Button>
          ) : null}
        </div>
      </Section>
        </div>
      </details>

      <ShotListImport
        projectId={projectId}
        open={importOpen}
        preset={preset}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) setPreset(null);
        }}
        onImported={(text) => {
          setNotice({ ok: true, text });
          setPaste("");
          setPasted(null);
          void load();
        }}
      />
    </div>
  );
}
