"use client";

// Sections in Lyrics Sync (22 Nov 2026, Mini film step 2; sections.ts): a bar with the song's sections in order (the
// app's suggestion until one is changed or kept), a header row above each section's first line (its kind, a dropdown,
// and ✕ to join it to the one before), and "Start a section here" on every other line. Every change saves the whole
// list at once (song.json "sections"); "Back to the suggestion" forgets the saved list.
import { ListTree, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { clockTenths } from "@lyric/video";
import { SECTION_KINDS, SECTION_KIND_LABEL, type NamedSection, type SectionKind, type SongSection } from "@lyric/video/sections";
import type { SectionsView } from "@lyric/video/song-sections";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Sections = {
  view: SectionsView | null;
  busy: boolean;
  error: string | null;
  save: (list: SongSection[] | null) => Promise<void>;
  setKind: (line: number, kind: SectionKind) => void;
  start: (line: number) => void;
  join: (line: number) => void;
};

export function useSections(projectId: string, on: boolean): Sections {
  const [view, setView] = useState<SectionsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    api(`/api/songs/${projectId}/sections`, { cache: "no-store" })
      .then((r) => r.json() as Promise<SectionsView & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setView(d)))
      .catch(() => alive && setError("Could not load the sections"));
    return () => {
      alive = false;
    };
  }, [projectId, on]);
  const save = useCallback(
    async (list: SongSection[] | null) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api(`/api/songs/${projectId}/sections`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections: list }) });
        const d = (await r.json()) as SectionsView & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        setView(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );
  const list = (): SongSection[] => (view?.sections ?? []).map(({ line, kind }) => ({ line, kind }));
  return {
    view,
    busy,
    error,
    save,
    setKind: (line, kind) => void save(list().map((s) => (s.line === line ? { line, kind } : s))),
    start: (line) => void save([...list(), { line, kind: "verse" as SectionKind }].sort((a, b) => a.line - b.line)),
    join: (line) => void save(list().filter((s) => s.line !== line)),
  };
}

const KIND_COLOUR: Record<SectionKind, string> = {
  intro: "text-muted-foreground",
  verse: "text-sky-300",
  "pre-chorus": "text-teal-300",
  chorus: "text-brand",
  bridge: "text-violet-300",
  outro: "text-muted-foreground",
};

export function SectionsBar({ sections, startMs }: { sections: Sections; startMs: (line: number) => number | null }) {
  const { view, busy, error } = sections;
  if (!view) return error ? <p className="text-xs text-red-300">{error}</p> : null;
  return (
    <div data-sections={view.saved ? "saved" : "suggested"} className="bg-card/60 flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium">
          <ListTree className="size-3.5" /> Sections
        </span>
        <span className="text-muted-foreground">
          {view.saved
            ? "Yours: change a kind on its row, start a section on any line, or ✕ to join it to the one before."
            : "Suggested from the blank lines, the repeats and the hooks of your lyrics. Change any of them, or keep them as they are."}
        </span>
        {!view.saved && view.sections.length ? (
          <button type="button" disabled={busy} onClick={() => void sections.save(view.sections.map(({ line, kind }) => ({ line, kind })))} className="border-brand text-brand rounded-md border px-2 py-0.5" data-sections-keep>
            Keep these
          </button>
        ) : null}
        {view.saved ? (
          <button type="button" disabled={busy} onClick={() => void sections.save(null)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md border px-2 py-0.5" data-sections-reset>
            <RotateCcw className="size-3" /> Back to the suggestion
          </button>
        ) : null}
      </div>
      {view.sections.length ? (
        <ol className="flex flex-wrap gap-1.5" data-sections-list>
          {view.sections.map((s) => {
            const ms = startMs(s.line);
            return (
              <li key={s.line} data-section-chip={s.kind} className="rounded-md border px-2 py-0.5">
                <span className={cn("font-medium", KIND_COLOUR[s.kind])}>{s.name}</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  {ms !== null ? clockTenths(ms) : null} · {s.line === s.lastLine ? `line ${s.line}` : `lines ${s.line}–${s.lastLine}`}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground">No lyrics yet to make sections from.</p>
      )}
      {error ? <p className="text-red-300">{error}</p> : null}
    </div>
  );
}

// The row above a section's first line.
export function SectionHeaderRow({ section, sections, colSpan }: { section: NamedSection; sections: Sections; colSpan: number }) {
  return (
    <tr data-section-row={section.line} className="bg-muted/30 border-b">
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("font-medium", KIND_COLOUR[section.kind])} data-section-name>
            {section.name}
          </span>
          <select
            aria-label={`Kind of section at line ${section.line}`}
            value={section.kind}
            disabled={sections.busy}
            onChange={(e) => sections.setKind(section.line, e.target.value as SectionKind)}
            className="bg-background rounded border px-1 py-0.5"
            data-section-kind
          >
            {SECTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {SECTION_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">{section.line === section.lastLine ? `line ${section.line}` : `lines ${section.line}–${section.lastLine}`}</span>
          {section.line !== 1 ? (
            <button type="button" disabled={sections.busy} onClick={() => sections.join(section.line)} className="text-muted-foreground hover:text-foreground ml-auto rounded p-0.5" aria-label={`Join ${section.name} to the section before`} title="Join this section to the one before" data-section-join>
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function StartSectionButton({ line, sections }: { line: number; sections: Sections }) {
  return (
    <button type="button" disabled={sections.busy} onClick={() => sections.start(line)} className="text-muted-foreground hover:text-foreground invisible rounded p-0.5 group-hover:visible focus:visible" aria-label={`Start a section on line ${line}`} title="Start a section on this line" data-section-start={line}>
      <Plus className="size-3" />
    </button>
  );
}
