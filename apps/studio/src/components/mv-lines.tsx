"use client";

// Lyrics Sync: the music-video shots on each line (27 Nov 2026, Paul: "I should see each video next to each shot planned
// and also on the lip-sync screen"). Each sung line shows the shots of every music video found in the song that carry
// it: ★ the app's pick (mv-best.ts: the face, the whole line in one shot, room, size, variety), ✓ the one in use, and
// "Use on this line" (a hand pick the app never replaces). On top: "Use the best for every line" (every shot cut out
// and face-checked on this PC, free; lines Paul set himself stay). Data: /api/songs/[id]/mv-shots; actions on
// /api/songs/[id]/pictures.
import { ChevronDown, ChevronRight, Clapperboard, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { BestView } from "@lyric/video/mv-best";

import { MvShotStrip, type MvStripShot } from "@/components/mv-shot-strip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const SHOWN = 3; // shots shown per line before "more"

export type MvLines = {
  best: BestView | null;
  busy: string | null;
  notice: { ok: boolean; text: string } | null;
  playing: { url: string; title: string } | null;
  setPlaying: (p: { url: string; title: string } | null) => void;
  useBest: () => Promise<void>;
  pick: (s: MvStripShot) => Promise<void>;
  reload: () => Promise<void>;
};

export function useMvLines(projectId: string, onPlaced: () => void): MvLines {
  const [best, setBest] = useState<BestView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await api(`/api/songs/${projectId}/mv-shots`, { cache: "no-store" });
      const d = (await r.json()) as { best?: BestView | null };
      setBest(d.best ?? null);
    } catch {
      // the music-video shots are extra: Lyrics Sync works without them
    }
  }, [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once the tab is shown
    void reload();
  }, [reload]);
  async function post(key: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    setBusy(key);
    try {
      const r = await api(`/api/songs/${projectId}/pictures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as Record<string, unknown> & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setNotice({ ok: true, text: done(d) });
      await reload();
      onPlaced();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return {
    best,
    busy,
    notice,
    playing,
    setPlaying,
    reload,
    useBest: () => post("best", { action: "mv-best" }, (d) => `${Number(d.placed ?? 0)} lines got their best shot${Number(d.kept ?? 0) ? `, ${Number(d.kept)} already had it` : ""}. Lines you set yourself stayed as they were.`),
    pick: (s) => {
      const at = s.key.lastIndexOf("#");
      return post(s.key, { action: "mv-best-pick", file: s.key.slice(0, at), shot: Number(s.key.slice(at + 1)) }, () => `${s.title} is on its lines, in time with the song. The app will not replace your pick.`);
    },
  };
}

// The bar above the lines: the music videos found, Use the best for every line, the player.
export function MvLinesBar({ mv }: { mv: MvLines }) {
  const b = mv.best;
  if (!b) return null;
  return (
    <div data-mv-lines className="flex flex-col gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sky-200">
          <Clapperboard className="mr-1 inline size-3.5" />
          From your {b.videos.length === 1 ? "music video" : `${b.videos.length} music videos`}: each line shows its shots (★ the app&apos;s pick).
        </span>
        <Button type="button" size="sm" variant="outline" data-mv-best-use disabled={mv.busy !== null} onClick={() => void mv.useBest()} title="Every singing shot is cut out and its face checked (on this PC, free), then the best one goes on each line, in time with the song. Lines you set yourself stay as they are.">
          {mv.busy === "best" ? <Loader2 className="animate-spin" /> : <Sparkles />} {mv.busy === "best" ? "Cutting and checking the shots…" : "Use the best for every line"}
        </Button>
        {b.unchecked ? <span className="text-muted-foreground" data-mv-best-note>{b.unchecked} shots to cut and check first (on this PC, free)</span> : null}
      </div>
      {mv.notice ? <p data-mv-lines-notice={mv.notice.ok ? "ok" : "error"} className={mv.notice.ok ? "text-emerald-200" : "text-red-200"}>{mv.notice.text}</p> : null}
      <Dialog open={!!mv.playing} onOpenChange={(o) => !o && mv.setPlaying(null)}>
        <DialogContent className="w-[min(40rem,95vw)] max-w-none">
          <DialogHeader>
            <DialogTitle>{mv.playing?.title}</DialogTitle>
          </DialogHeader>
          {mv.playing ? <video src={mv.playing.url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// One line's shots: the app's pick first, then the others by score.
export function LineMvShots({ mv, line }: { mv: MvLines; line: number }) {
  const [more, setMore] = useState(false);
  const b = mv.best;
  if (!b) return null;
  const pickOf = b.rows.find((r) => r.first <= line && line <= r.last)?.pick ?? null;
  const here = b.candidates.filter((c) => c.first <= line && line <= c.last);
  if (!here.length) return null;
  const isPick = (c: (typeof here)[number]) => !!pickOf && pickOf.video === c.video && pickOf.shot === c.shot;
  const sorted = [...here].sort((x, y) => Number(isPick(y)) - Number(isPick(x)) || Number(y.inUse) - Number(x.inUse) || y.score - x.score);
  const video = (file: string) => b.videos.find((v) => v.file === file);
  const shots: MvStripShot[] = sorted.flatMap((c) => {
    const v = video(c.video);
    if (!v) return [];
    const fromS = Math.max(0, (c.songFromMs - v.offsetMs) / 1000);
    return [
      {
        key: `${c.video}#${c.shot}`,
        url: fileUrl(v.url),
        fromS,
        toS: Math.max(fromS, (c.songToMs - v.offsetMs) / 1000),
        title: `${c.label} · shot ${c.shot + 1}`,
        sub: `${clock(c.songFromMs)}–${clock(c.songToMs)}${c.last > c.first ? ` · lines ${c.first}–${c.last}` : ""}${c.reasons.length ? ` · ${c.reasons.join(", ")}` : ""}`,
        inUse: c.inUse,
        best: isPick(c) && here.length > 1,
        hd: c.resolution === "1080p",
      },
    ];
  });
  const locked = b.locked[line] === "own" ? "your own take is on this line" : b.locked[line] === "hand" ? "your pick" : null;
  return (
    <div className="mt-1 flex flex-col gap-0.5" data-mv-line={line}>
      <MvShotStrip shots={more ? shots : shots.slice(0, SHOWN)} action="Use on this line" busy={mv.busy} onUse={(s) => void mv.pick(s)} play={(url, title) => mv.setPlaying({ url, title })} locked={locked} compact />
      {shots.length > SHOWN ? (
        <button type="button" onClick={() => setMore((m) => !m)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-[11px]" data-mv-line-more>
          {more ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {more ? "Fewer" : `${shots.length - SHOWN} more`}
        </button>
      ) : null}
    </div>
  );
}
