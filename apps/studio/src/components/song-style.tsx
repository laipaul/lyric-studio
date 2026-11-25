"use client";

// Song style (22 Nov 2026, Paul's three levels): Prepare → Song Details → Song style, three clear choices. It only
// decides which tools the song shows (song-style.ts); changing it never removes anything. useSongStyle: the other
// tabs (Lyrics Sync, Creation) read it to show or hide their tools.
import { ArrowRight, Clapperboard, Mic, Scissors, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SONG_STYLES, SONG_STYLE_HINT, SONG_STYLE_LABEL, type SongStyle } from "@lyric/video/song-style";
import type { SongStyleView } from "@lyric/video/song-style-node";

import { useGoToTab } from "@/components/song-stages";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const SONG_STYLE_ICON: Record<SongStyle, LucideIcon> = { cut: Scissors, singing: Mic, film: Clapperboard };

// Other tabs hear a change made in Song Details without a reload.
const CHANGED = "lyric:song-style";

export function useSongStyle(projectId: string): SongStyleView | null {
  const [view, setView] = useState<SongStyleView | null>(null);
  const load = useCallback(() => {
    api(`/api/songs/${projectId}/style`, { cache: "no-store" })
      .then((r) => r.json() as Promise<SongStyleView & { error?: string }>)
      .then((d) => (d.error ? null : setView(d)))
      .catch(() => null);
  }, [projectId]);
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [load]);
  return view;
}

export function SongStyleBadge({ style, className }: { style: SongStyle; className?: string }) {
  const Icon = SONG_STYLE_ICON[style];
  return (
    <span data-song-style-badge={style} className={cn("flex shrink-0 items-center gap-1", className)} title={`Song style: ${SONG_STYLE_LABEL[style]} (Prepare → Song Details to change it)`}>
      <Icon className="size-3 shrink-0" /> {SONG_STYLE_LABEL[style]}
    </span>
  );
}

// The song style in every stage's header (23 Nov 2026, Paul: "then how do I know where I am?"): "Mini film" etc.,
// a click opens Prepare → Song Details, where it is set.
export function SongStyleChip({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const view = useSongStyle(projectId);
  if (!view) return null;
  const what = view.style === "film" ? "every video plays the whole song, except the Spotify Canvas, which stays a short loop" : view.style === "singing" ? "singing takes on their lines" : "short videos start at the chorus";
  return (
    <button type="button" onClick={onOpen} data-song-style-chip={view.style} className={cn("hover:bg-accent inline-flex items-center rounded px-1 align-middle", view.style === "film" ? "text-sky-300" : view.style === "singing" ? "text-violet-300" : "")} title={`Song style: ${SONG_STYLE_LABEL[view.style]}: ${what}. Click to change it (Prepare → Song Details).`}>
      <SongStyleBadge style={view.style} />
      {view.style === "film" ? <span className="text-muted-foreground ml-1">· whole song</span> : null}
    </button>
  );
}

export function SongStyleField({ projectId }: { projectId: string }) {
  const view = useSongStyle(projectId);
  const goTo = useGoToTab();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<SongStyleView | null>(null);
  const current = shown ?? view;

  async function pick(style: SongStyle) {
    setError(null);
    setBusy(true);
    try {
      const r = await api(`/api/songs/${projectId}/style`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style }) });
      const d = (await r.json()) as SongStyleView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setShown(d);
      window.dispatchEvent(new Event(CHANGED));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;
  return (
    <section data-song-style={current.style} className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">Song style</h3>
        <span className="text-muted-foreground text-xs">How you make this song. It only decides which tools show; you can change it at any time and nothing is lost.</span>
      </div>
      <div role="radiogroup" aria-label="Song style" className="grid gap-2 sm:grid-cols-3">
        {SONG_STYLES.map((s) => {
          const Icon = SONG_STYLE_ICON[s];
          const on = current.style === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => (on && current.chosen ? undefined : void pick(s))}
              data-song-style-option={s}
              className={cn("flex flex-col gap-1 rounded-md border px-3 py-2 text-left", on ? "border-brand bg-brand/10" : "hover:border-foreground/40")}
            >
              <span className={cn("flex items-center gap-1.5 font-medium", on ? "text-brand" : "")}>
                <Icon className="size-4" /> {SONG_STYLE_LABEL[s]}
              </span>
              <span className="text-muted-foreground text-xs">{SONG_STYLE_HINT[s]}</span>
            </button>
          );
        })}
      </div>
      {current.style === "cut" && current.singingLines > 0 ? (
        <p className="text-xs text-amber-200" data-song-style-note>
          This song still has {current.singingLines === 1 ? "a singing line" : `${current.singingLines} singing lines`}, and they play in its videos, so Lyrics Sync keeps showing the Lip sync column. Choose no singer there to take them out.
        </p>
      ) : null}
      {current.style === "singing" ? (
        // How to add the lip sync (25 Nov 2026, Paul: "not clear from there how I add the lipsync"): the three steps, one click.
        <div data-lipsync-how className="flex flex-col gap-1.5 rounded-md border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs">
          <span className="font-medium text-violet-200">How to add the lip sync</span>
          <ol className="text-muted-foreground list-decimal pl-4">
            <li>Have a picture of your singer in Creation (a close, front-facing face works best).</li>
            <li>In Lyrics Sync, column <b>Lip sync</b>: choose that picture on each line where the singer shows (lines in a row become one clip).</li>
            <li>Press <b>Make singing clips</b> in the bar above the lines: the cost shows first; each clip lands on its lines.</li>
          </ol>
          <button type="button" data-lipsync-open onClick={() => goTo("lyrics")} className="hover:bg-accent flex items-center gap-1 self-start rounded border px-2 py-0.5 text-foreground">
            Open Lyrics Sync → Lip sync <ArrowRight className="size-3" />
          </button>
        </div>
      ) : null}
      {!current.chosen ? <p className="text-muted-foreground text-xs" data-song-style-default>Not chosen yet: the studio uses {SONG_STYLE_LABEL[current.style]}, from what this song already has.</p> : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </section>
  );
}
