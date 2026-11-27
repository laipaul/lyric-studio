"use client";

// Prepare → Creation (G2, 21 Nov 2026; first called Pictures): Paul's messy creation space, apart from the Storyboard.
// Everything he makes sits here together, from anywhere: pictures and videos he adds by hand (Midjourney videos too,
// under their own names), files from a link (any outside source), and takes animated here: Animate sends a picture as
// image-to-video to WaveSpeed or Higgsfield (his own key). The app chooses the length, size, motion and sound (none);
// Paul may add a few words of mood. His own defaults (model, takes, cap) apply to every song; each picture can override
// them. The cost shows before sending and a press above the cap is refused. Each item shows where it came from. Paul
// sends his favourites with "Send to Storyboard" (the end of his story line, marked ✓).
import { Check, Copy, Film, Heart, ImagePlus, Link2, Loader2, Play, RotateCw, Send, Sparkles, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { CreationDefaults, PictureView, PicturesView as BoardView, Quality, ServiceId, Take } from "@lyric/video/animate";

// characters: "Who is this" (picture-character.ts); faceUsdPerSecond: Animate with a character's face sheet.
type PicturesView = BoardView & { characters?: { id: string; name: string }[]; faceUsdPerSecond?: number; mvMake?: MvMakeOptions | null };
import type { ProductionShot, ProductionView } from "@lyric/video/shot-production";
import type { MvMakeOptions } from "@lyric/video/music-video";

import { MakeMusicVideo } from "@/components/make-music-video";
import { MusicVideoPanel } from "@/components/music-video-panel";
import { NameField } from "@/components/name-field";
import { useGoToTab } from "@/components/song-stages";
import { takeDetails, takeFacts, takeKind, takeTag } from "@lyric/video/take-facts";
import { TAKE } from "@lyric/video";

import { CharacterPicker } from "@/components/character-picker";
import { FilmLookPicker } from "@/components/film-look-picker";
import { FramePicker } from "@/components/frame-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FeelingSelect } from "@/components/sections-ui";
import { WithSong } from "@/components/with-song";

const money = (usd: number) => `$${usd.toFixed(2)}`;
type Svc = PicturesView["services"][number];
// One dropdown for service and model together ("WaveSpeed · Seedance 2.5 Flash"): value "<service>:<quality>".
const modelOptions = (services: Svc[]) => services.flatMap((s) => s.qualities.map((q) => ({ value: `${s.id}:${q.id}`, label: `${s.label} · ${q.label}${s.ready ? "" : " (no key yet)"}` })));
const splitModel = (v: string) => v.split(":") as [ServiceId, Quality];
const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

// part (C3 Part 1, 22 Nov 2026): "all" = the board as before (songs without a shot list); "settings" = the Film look and
// the defaults only (Creation → Story room); "production" = the shot list's items with their pictures and takes, then
// the loose pictures (Creation → Production).
export function PicturesBoard({ projectId, part = "all" }: { projectId: string; part?: "all" | "settings" | "production" }) {
  const goTo = useGoToTab();
  const [board, setBoard] = useState<PicturesView | null>(null);
  const [production, setProduction] = useState<ProductionView | null>(null);
  const [comparing, setComparing] = useState<string | null>(null); // Compare: the shot whose candidates play together
  const [favOnly, setFavOnly] = useState(false); // ♥ only (25 Nov 2026): just Paul's favourites, pictures and takes
  const [guides, setGuides] = useState<Record<string, string>>({}); // Make with references: each shot's camera guide
  const [acting, setActing] = useState<Record<string, boolean>>({}); // Make with references: the acting direction per shot (on by default)
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [cap, setCap] = useState<string>("");
  // A take or video in the big player; a take with its place in the song (take: played with the song when it has one).
  type Playing = { url: string; title: string; take?: { fromS: number | null; clipInS: number; why: string | null } };
  const [playing, setPlaying] = useState<Playing | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/songs/${projectId}/pictures`);
      const d = (await r.json()) as { board?: PicturesView; production?: ProductionView | null; error?: string };
      if (!r.ok || !d.board) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setBoard(d.board);
      setProduction(d.production ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the board's data, read once it is shown
    void load();
  }, [load]);
  // While takes are being made, the board follows them.
  const running = !!board?.pictures.some((p) => p.takes.some((t) => t.status === "running"));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  function added(d: { added?: string[]; skipped?: { name: string; reason: string }[]; placed?: Record<string, number>; onShot?: { file: string; fresh: boolean }[]; shot?: number | null }) {
    // 25 Nov 2026: a file already in Creation, dropped on a shot, is now on that shot: not a failure.
    const already = (d.onShot ?? []).filter((o) => !o.fresh);
    if (already.length) {
      const text = `${already.map((o) => o.file).join(", ")} ${already.length > 1 ? "were" : "was"} already in Creation: ${already.length > 1 ? "they are" : "it is"} now on shot ${d.shot ?? "?"}.${d.added?.length ? ` ${d.added.length} new file${d.added.length === 1 ? "" : "s"} added.` : ""}`;
      setNotice({ ok: true, text });
      return;
    }
    const skipped = d.skipped?.length ? ` Skipped: ${d.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : "";
    // Bulk drop by shot: where each file named after a shot went, and how many stay loose.
    const placed = Object.entries(d.placed ?? {});
    const loose = (d.added?.length ?? 0) - placed.length;
    const where = placed.length ? ` ${placed.map(([f, n]) => `${f} → shot ${n}`).join(", ")}${loose > 0 ? `; ${loose} loose` : ""}.` : "";
    setNotice({ ok: !!d.added?.length, text: `${d.added?.length ?? 0} file${d.added?.length === 1 ? "" : "s"} added.${where}${skipped}` });
  }
  const [frames, setFrames] = useState(false);
  const [people, setPeople] = useState(false);
  async function add(files: FileList | File[] | null | undefined, slot?: string) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setAdding(true);
    try {
      const form = new FormData();
      for (const f of list) form.append("pictures", f);
      if (slot) form.append("slot", slot);
      const r = await api(`/api/songs/${projectId}/pictures`, { method: "POST", body: form });
      const d = (await r.json()) as { added?: string[]; skipped?: { name: string; reason: string }[]; placed?: Record<string, number>; onShot?: { file: string; fresh: boolean }[]; shot?: number | null; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      added(d);
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  }
  async function post(body: Record<string, unknown>) {
    const r = await api(`/api/songs/${projectId}/pictures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json()) as { error?: string };
    if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
    return d;
  }
  async function addLink() {
    if (!link.trim()) return;
    setAdding(true);
    try {
      added((await post({ action: "link", url: link })) as { added?: string[]; skipped?: { name: string; reason: string }[] });
      setLink("");
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  }
  async function saveDefaults(change: Partial<CreationDefaults>) {
    if (!board) return;
    try {
      const d = (await post({ action: "defaults", defaults: { ...board.defaults, ...change } })) as { defaults: CreationDefaults };
      setBoard({ ...board, defaults: d.defaults, ...(change.length ? { takeSeconds: d.defaults.length === "short" ? 5 : (board.phraseSeconds ?? 5) } : {}) });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!board) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const defaults = board.defaults;
  const defSvc = board.services.find((s) => s.id === defaults.service) ?? board.services[0];
  const models = modelOptions(board.services);

  const settings = part !== "production";
  const shots = part === "production" ? (production?.shots ?? []) : [];
  const loose = part === "production" ? board.pictures.filter((p) => !p.slot || !shots.some((s) => s.id === p.slot)) : board.pictures;
  async function useShot(file: string, n: number | null, shot: ProductionShot) {
    try {
      const d = (await post({ action: "use-shot", file, n, slot: shot.id })) as { clip: string; line: number | null; note: string | null; replaced: string | null };
      setNotice({ ok: true, text: `Shot ${shot.number} is filled${d.line !== null && !d.note ? ` and shows on line ${d.line}` : ""}.${d.replaced ? " The take it had before is set to Omit (still in the Storyboard)." : ""}${d.note ? ` ${d.note}` : ""}` });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  // ♥ (25 Nov 2026): mark or unmark a picture (n null) or a take as a favourite; only a mark, nothing is sent.
  async function favourite(file: string, n: number | null, on: boolean) {
    try {
      await post({ action: "fav", file, n, on });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  const favCount = board.pictures.reduce((k, p) => k + (p.fav ? 1 : 0) + p.takes.filter((t) => t.fav).length, 0);
  const hasFav = (p: PictureView) => p.fav || p.takes.some((t) => t.fav);
  // Compare: every candidate of a shot (its videos, its finished takes, its pictures as stills).
  const candidatesOf = (shot: ProductionShot): Candidate[] => {
    const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
    // A video dropped on the shot that is a copy of a take made here (e.g. the draft test's takes): that take's tag.
    const takeOfFile = (name: string) => {
      for (const q of board.pictures) for (const t of q.takes) if (t.file && same(t.file.split("/").pop(), name)) return t;
      return null;
    };
    const ownTag = (p: PictureView) => {
      const t = p.kind === "video" ? takeOfFile(p.file) : null;
      return t ? { tag: takeTag(t), details: takeDetails(t) } : { tag: p.kind === "video" ? `Your video · ${p.source}` : `Picture · ${p.source}` };
    };
    return board.pictures
      .filter((p) => p.slot === shot.id)
      .flatMap((p): Candidate[] => [
        ...(p.source === "Character references" ? [] : [{ key: p.file, label: p.label ?? p.file, url: fileUrl(p.url), kind: p.kind, used: same(p.sent, shot.filled), use: () => void useShot(p.file, null, shot), fav: p.fav, onFav: () => void favourite(p.file, null, !p.fav), ...ownTag(p) }]),
        ...p.takes
          .filter((t) => t.status === "done" && t.kind !== "lipsync" && (t.file || t.clip))
          .map((t): Candidate => ({
            key: `${p.file}#${t.n}`,
            label: p.label ?? p.file,
            tag: takeTag(t),
            details: takeDetails(t),
            url: t.file ? fileUrl(p.url.replace(/[^/]+$/, t.file)) : fileUrl(p.url.replace(/pictures\/[^/]+$/, `clips/${t.clip}`)),
            kind: "video",
            used: same(t.sent, shot.filled),
            use: () => void useShot(p.file, t.n, shot),
            fav: !!t.fav,
            onFav: () => void favourite(p.file, t.n, !t.fav),
          })),
      ]);
  };
  const comparedShot = comparing ? shots.find((s) => s.id === comparing) ?? null : null;
  // The look a person wears in one shot (its prompt, reference picture and Storyboard card follow).
  // Make with references (24 Nov 2026): the shot sent with its people's and place's pictures (Seedance reference-to-video).
  // The camera guide of each shot (24 Nov 2026): one of its videos (a Midjourney take), sent as @Video 1 with the pictures.
  const guidesOf = (shot: ProductionShot): { value: string; label: string }[] =>
    board.pictures
      .filter((p) => p.slot === shot.id && p.source !== "Character references")
      .flatMap((p) => [
        ...(p.kind === "video" ? [{ value: p.file, label: p.label ?? p.file }] : []),
        ...p.takes.filter((t) => t.status === "done" && t.file && t.kind !== "lipsync").map((t) => ({ value: t.file!, label: `${p.label ?? p.file} · ${t.label ?? `Take ${t.n}`}` })),
      ]);
  const guideOf = (shot: ProductionShot) => guides[shot.id] ?? guidesOf(shot)[0]?.value ?? "";
  // The acting direction (Persona + performance script, 26 Nov 2026): on by default; untick on a shot to make one take
  // without it and compare.
  const actingOf = (shot: ProductionShot) => acting[shot.id] ?? true;
  async function makeWithReferences(shot: ProductionShot, shape: "9:16" | "16:9") {
    const guide = guideOf(shot);
    const withActing = actingOf(shot);
    const seconds = shot.span ? Math.min(30, Math.max(4, Math.ceil((shot.span.endMs - shot.span.startMs) / 1000))) : 5;
    const usd = Math.round(0.324 * seconds * defaults.takes * 100) / 100;
    const who = shot.refs.map((r) => r.name).join(", ");
    if (!window.confirm(`Make ${defaults.takes} take${defaults.takes === 1 ? "" : "s"} of shot ${shot.number} (${shape}, ${seconds} s) with references (${who})${guide ? `, following the camera of ${guide}` : ""}, ${withActing ? "WITH the acting direction (persona + performance script)" : "WITHOUT the acting direction (to compare)"}, on WaveSpeed, Seedance 2.5? About $${usd.toFixed(2)} (estimate).`)) return;
    try {
      const d = (await post({ action: "references", slot: shot.id, shape, seconds, acting: withActing, ...(guide ? { guide } : {}) })) as { takes: { n: number }[]; references: string[]; estimate: { usd: number }; guide?: string; note?: string; acting?: boolean };
      setNotice({ ok: true, text: `Shot ${shot.number}: ${d.takes.length} take${d.takes.length === 1 ? "" : "s"} sent with ${d.references.join(", ")}${d.guide ? `, following the camera of ${d.guide}` : ""}, ${d.acting ? "with the acting direction" : "without the acting direction"} (about $${d.estimate.usd.toFixed(2)}). They appear on the shot when ready (Tasks menu).${d.note ? ` ${d.note}` : ""}` });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  // The place of a shot, or of every shot in its section (24 Nov 2026): a scene card of the cast, or none.
  async function setPlace(shot: ProductionShot, scene: string, whole: boolean) {
    const ids = whole ? shots.filter((x) => x.section === shot.section).map((x) => x.id) : [shot.id];
    try {
      const d = (await post({ action: "shot-scene", slots: ids, scene: scene || null })) as { changed: number };
      setNotice({ ok: true, text: whole ? `${shot.section}: ${d.changed} shot${d.changed === 1 ? "" : "s"} now ${scene ? `in ${scene}` : "without a place"}.` : `Shot ${shot.number}: ${scene ? `in ${scene}` : "no place"}. Its prompt, Omni Reference and Make with references follow.` });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  async function setLook(shot: ProductionShot, character: string, look: string) {
    try {
      await post({ action: "shot-look", slot: shot.id, character, look });
      setNotice({ ok: true, text: `Shot ${shot.number}: ${character} wears ${look}. Its prompt, reference picture and Storyboard card follow.` });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  async function attach(file: string, shot: ProductionShot) {
    try {
      await post({ action: "shot", file, slot: shot.id });
      setNotice({ ok: true, text: `${file} now belongs to shot ${shot.number}.` });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div data-pictures={part} className="flex flex-col gap-3">
      {settings ? <FilmLookPicker projectId={projectId} /> : null}
      {settings ? (
      <div data-creation-defaults className="bg-card/40 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-2 text-xs">
        <span className="font-medium">Your defaults (every song)</span>
        <label className="flex items-center gap-1.5">
          Model
          <select
            data-animate-service
            value={`${defaults.service}:${defaults.quality}`}
            onChange={(e) => {
              const [service, quality] = splitModel(e.target.value);
              void saveDefaults({ service, quality });
            }}
            className="bg-background rounded-md border px-2 py-1"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Takes
          <select data-default-takes value={defaults.takes} onChange={(e) => void saveDefaults({ takes: Number(e.target.value) })} className="bg-background rounded-md border px-2 py-1">
            {Array.from({ length: board.maxTakes }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="How long each take is. Fit the song: one musical phrase of this song (4 bars at its tempo), so a take covers a phrase and the cuts have room.">
          Length
          <select data-default-length value={defaults.length} onChange={(e) => void saveDefaults({ length: e.target.value === "short" ? "short" : "song" })} className="bg-background rounded-md border px-2 py-1">
            <option value="song">Fit the song{board.phraseSeconds ? ` (one phrase, ${board.phraseSeconds} s here)` : " (5 s until the beats are found)"}</option>
            <option value="short">Short (5 s)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="An Animate that would cost more than this is refused before anything is sent.">
          Spending cap per Animate $
          <input
            data-animate-cap
            type="number"
            min={1}
            step={1}
            value={cap || String(defaults.cap)}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => {
              if (Number(cap) > 0 && Number(cap) !== defaults.cap) void saveDefaults({ cap: Number(cap) });
              setCap("");
            }}
            className="bg-background w-16 rounded-md border px-2 py-1"
          />
        </label>
        <span className="text-muted-foreground" data-animate-spent>
          Sent for this song so far: about {money(board.spentUsd)}
        </span>
      </div>
      ) : (
        <p data-production-defaults className="text-muted-foreground text-xs">
          Animate with {defSvc.label} · {defSvc.qualities.find((x) => x.id === defaults.quality)?.label ?? defaults.quality} · {defaults.takes} take{defaults.takes === 1 ? "" : "s"} · cap {money(defaults.cap)} · sent for this song so far about {money(board.spentUsd)} (change them in Story room).
        </p>
      )}
      {!defSvc.ready ? (
        <p data-animate-nokey className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">
          No {defSvc.label} key yet: Animate with {defSvc.label} stays off and nothing is sent. Adding your own pictures and videos works without a key. To animate here, add a line <code>{defSvc.keyName}=…</code> with your own key to the file{" "}
          <code>D:\videomaker\.env</code> (not <code>.env.example</code>, which comes from GitHub)
          {defSvc.id === "higgsfield" ? ' (from open.higgsfield.ai, written as "key id:key secret")' : " (from wavespeed.ai → API keys)"}, then restart Lyric Studio. You pay {defSvc.label} directly.
        </p>
      ) : null}
      {board.mvMake ? <MakeMusicVideo opts={board.mvMake} pictures={board.pictures.filter((p) => p.kind === "picture" && p.source !== "Character references").map((p) => ({ file: p.file, url: fileUrl(p.url), label: p.label }))} cap={defaults.cap} post={post} reload={load} setNotice={setNotice} /> : null}
      {part === "settings" && notice ? (
        <p data-pictures-notice={notice.ok ? "ok" : "error"} className={cn("rounded-md border p-2 text-sm", notice.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200")}>
          {notice.text}
        </p>
      ) : null}
      {part === "settings" ? null : (
      <>
      {notice ? (
        <p data-pictures-notice={notice.ok ? "ok" : "error"} className={cn("rounded-md border p-2 text-sm", notice.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200")}>
          {notice.text}
        </p>
      ) : null}

      {favCount || favOnly ? (
        <button type="button" data-fav-only={favOnly ? "on" : "off"} aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)} className={cn("flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-xs", favOnly ? "border-brand bg-brand/15 text-foreground" : "hover:bg-accent")} title="Show only the pictures and takes you marked ♥ (click again for everything)">
          <Heart className={cn("size-3.5", favOnly ? "fill-brand text-brand" : "text-brand")} /> {favOnly ? `Showing your ${favCount} favourite${favCount === 1 ? "" : "s"} · show all` : `Favourites only (${favCount})`}
        </button>
      ) : null}
      {shots.length ? (
        <ShotItems
          shots={shots}
          pictures={board.pictures}
          loose={loose}
          adding={adding}
          onDrop={(files, s) => void add(files, s.id)}
          onAttach={(file, s) => void attach(file, s)}
          onCompare={(s) => setComparing(s.id)}
          onLook={(s, character, look) => void setLook(s, character, look)}
          onReferences={(s, shape) => void makeWithReferences(s, shape)}
          places={production?.places ?? []}
          onPlace={(s, scene, whole) => void setPlace(s, scene, whole)}
          guidesFor={(s) => ({ options: guidesOf(s), value: guideOf(s), set: (v: string) => setGuides((g) => ({ ...g, [s.id]: v })) })}
          actingFor={(s) => ({ value: actingOf(s), set: (v: boolean) => setActing((a) => ({ ...a, [s.id]: v })) })}
          projectId={projectId}
          compareCount={(s) => candidatesOf(s).length}
          tile={(p, s) => (favOnly && !hasFav(p) ? null : <PictureTile key={p.file} projectId={projectId} p={p} favOnly={favOnly} onFav={(n, on) => void favourite(p.file, n, on)} board={board} post={post} reload={load} setNotice={setNotice} play={(url, title, take) => setPlaying({ url, title, take })} shot={s} useShot={(n) => void useShot(p.file, n, s)} openCompare={candidatesOf(s).length >= 2 ? () => setComparing(s.id) : undefined} />)}
        />
      ) : null}
      {comparedShot ? <ShotCompare key={comparedShot.id} shot={comparedShot} candidates={candidatesOf(comparedShot)} song={board.song ? fileUrl(board.song) : null} onClose={() => setComparing(null)} /> : null}
      {shots.length ? (
        <h3 data-loose-heading className="mt-2 text-sm font-semibold">
          Loose pictures <span className="text-muted-foreground font-normal">· not in a shot: inspiration, extra B-roll, or drop one on a shot above</span>
        </h3>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {loose.filter((p) => !favOnly || hasFav(p)).map((p) => (
          <PictureTile key={p.file} projectId={projectId} p={p} favOnly={favOnly} onFav={(n, on) => void favourite(p.file, n, on)} board={board} post={post} reload={load} setNotice={setNotice} play={(url, title, take) => setPlaying({ url, title, take })} />
        ))}
        <div className="flex min-h-48 flex-col gap-2">
          <button
            type="button"
            data-pictures-drop
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void add(e.dataTransfer.files);
            }}
            className={cn("flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm transition-colors", over ? "border-brand bg-brand/10" : "hover:border-brand/60")}
          >
            {adding ? <Loader2 className="text-brand size-6 animate-spin" /> : <ImagePlus className="text-brand size-6" />}
            <span>Drop pictures or videos here</span>
            <span className="text-muted-foreground text-xs">From Midjourney or anywhere: .jpg, .png, .webp, .mp4, .mov, .webm. They keep their own names.</span>
          </button>
          <form
            className="flex items-center gap-1 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              void addLink();
            }}
          >
            <Link2 className="text-muted-foreground size-4 shrink-0" />
            <input data-pictures-link value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link to a picture or video" className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1" />
            <Button type="submit" size="sm" variant="outline" disabled={adding || !link.trim()} data-pictures-link-add>
              Add
            </Button>
          </form>
          <Button type="button" size="sm" variant="ghost" disabled={adding} onClick={() => setFrames(true)} data-pictures-frame title="A still from one of your videos, the best faces first">
            <Film /> Pick a frame from a video
          </Button>
          <FramePicker open={frames} onOpenChange={setFrames} onPick={(f) => add([f])} use="Add to Creation" />
          <Button type="button" size="sm" variant="ghost" disabled={adding} onClick={() => setPeople(true)} data-pictures-character title="One of your characters, in one of their looks (the Wardrobe)">
            <UserRound /> From a character
          </Button>
          <CharacterPicker open={people} onOpenChange={setPeople} onPick={(f) => add([f])} />
        </div>
      </div>
      {board.removedPictures?.length ? (
        <details data-pictures-removed={board.removedPictures.length} className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Put-aside pictures ({board.removedPictures.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {board.removedPictures.map((r) => (
              <li key={r.file} className="flex items-center gap-2" data-picture-removed={r.file}>
                <span className="min-w-0 flex-1 truncate">{r.label ?? r.file}</span>
                <button
                  type="button"
                  data-picture-restore={r.file}
                  onClick={() =>
                    void post({ action: "restore-picture", file: r.file })
                      .then(() => (setNotice({ ok: true, text: `${r.label ?? r.file} is back${r.slot ? " on its shot" : ""}.` }), load()))
                      .catch((e: Error) => setNotice({ ok: false, text: e.message }))
                  }
                  className="hover:bg-accent text-foreground shrink-0 rounded border px-1.5 py-0.5"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.m4v,.mov,.webm,image/*,video/*" className="hidden" data-pictures-input onChange={(e) => void add(e.target.files)} />
      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent data-take-player className="w-[min(40rem,95vw)] max-w-none">
          <DialogHeader>
            <DialogTitle>{playing?.title}</DialogTitle>
            <DialogDescription>{playing?.take ? "Takes are made without sound: here the song plays with it from the second it belongs to." : "Takes are made without sound: your song is added when the video is made."}</DialogDescription>
          </DialogHeader>
          {playing?.take ? (
            <WithSong key={playing.url} video={playing.url} song={board.song ? `/api/files/${board.song.split("/").map(encodeURIComponent).join("/")}` : null} fromS={playing.take.fromS} clipInS={playing.take.clipInS} why={playing.take.why} />
          ) : playing ? (
            <video key={playing.url} src={playing.url} controls autoPlay loop playsInline className="bg-muted max-h-[70vh] w-full rounded object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
      {board.pictures.some((p) => p.sent || p.takes.some((t) => t.sent)) ? (
        <p className="text-muted-foreground text-xs">
          What you send joins the end of your story line.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => goTo("clips")}>
            Arrange it in Storyboard
          </button>{" "}
          or{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => goTo("shape")}>
            in Shape with the song playing
          </button>
          .
        </p>
      ) : null}
      </>
      )}
    </div>
  );
}

// The shot list's items (C3 Part 1), grouped by the song's sections in story order: each with its number, line, people
// and what happens, its pictures (and their takes), and a drop zone for its picture.
function ShotItems({
  shots,
  pictures,
  loose,
  adding,
  onDrop,
  onAttach,
  onCompare,
  compareCount,
  onLook,
  onReferences,
  guidesFor,
  actingFor,
  projectId,
  places,
  onPlace,
  tile,
}: {
  actingFor: (s: ProductionShot) => { value: boolean; set: (v: boolean) => void };
  projectId: string;
  places: string[];
  onPlace: (s: ProductionShot, scene: string, whole: boolean) => void;
  guidesFor: (s: ProductionShot) => Guides;
  onLook: (s: ProductionShot, character: string, look: string) => void;
  onReferences: (s: ProductionShot, shape: "9:16" | "16:9") => void;
  onCompare: (s: ProductionShot) => void;
  compareCount: (s: ProductionShot) => number;
  shots: ProductionShot[];
  pictures: PictureView[];
  loose: PictureView[];
  adding: boolean;
  onDrop: (files: FileList, s: ProductionShot) => void;
  onAttach: (file: string, s: ProductionShot) => void;
  tile: (p: PictureView, s: ProductionShot) => ReactNode;
}) {
  const filled = shots.filter((s) => s.filled).length;
  // Sections in story order (a name that comes back, e.g. a second chorus, is its own group again).
  const groups: { name: string; shots: ProductionShot[] }[] = [];
  for (const s of shots) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.section) last.shots.push(s);
    else groups.push({ name: s.section, shots: [s] });
  }
  return (
    <div data-shots className="flex flex-col gap-4">
      <p data-shots-progress className="text-sm">
        <span className="font-medium">
          {filled} of {shots.length} shots filled
        </span>{" "}
        <span className="text-muted-foreground">· drop each shot&apos;s picture on it, Animate, then “Use for shot” puts the take in its place in the story, on its line.</span>
      </p>
      {groups.map((g, gi) => (
        <section key={`${g.name}-${gi}`} data-shot-section={g.name} className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{g.name}</h3>
          {g.shots.map((s) => (
            <ShotRow key={s.id} s={s} pictures={pictures.filter((p) => p.slot === s.id)} loose={loose} adding={adding} onDrop={onDrop} onAttach={onAttach} tile={tile} onCompare={() => onCompare(s)} candidates={compareCount(s)} onLook={(character, look) => onLook(s, character, look)} onReferences={(shape) => onReferences(s, shape)} acting={actingFor(s)} projectId={projectId} guides={guidesFor(s)} places={places} onPlace={(scene, whole) => onPlace(s, scene, whole)} />
          ))}
        </section>
      ))}
    </div>
  );
}

// How long the shot lasts on the song (23 Nov 2026): the length its take must have. Longer than one take or only a
// flash: said in amber, with the creative fix.
function ShotLength({ span }: { span: { startMs: number; endMs: number } }) {
  const ms = span.endMs - span.startMs;
  const s1 = (x: number) => `${(x / 1000).toFixed(1)} s`;
  const clock = (x: number) => `${Math.floor(x / 60_000)}:${((x % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
  const long = ms > TAKE.maxMs;
  const short = ms < TAKE.minMs;
  return (
    <span data-shot-length={Math.round(ms)} className={long || short ? "text-amber-300" : ""} title={`On the song ${clock(span.startMs)}–${clock(span.endMs)}`}>
      {` · ${clock(span.startMs)} · `}
      <b className="font-medium">{long ? `needs ${s1(ms)}: extend the take, or add a shot after it` : short ? `only ${s1(ms)}: join it with a neighbour` : `needs a ${s1(ms)} take`}</b>
    </span>
  );
}

type Guides = { options: { value: string; label: string }[]; value: string; set: (v: string) => void };
function ShotRow({ s, pictures, loose, adding, onDrop, onAttach, tile, onCompare, candidates, onLook, onReferences, acting, projectId, guides, places, onPlace }: { s: ProductionShot; pictures: PictureView[]; loose: PictureView[]; adding: boolean; onDrop: (files: FileList, s: ProductionShot) => void; onAttach: (file: string, s: ProductionShot) => void; tile: (p: PictureView, s: ProductionShot) => ReactNode; onCompare: () => void; candidates: number; onLook: (character: string, look: string) => void; onReferences: (shape: "9:16" | "16:9") => void; acting: { value: boolean; set: (v: boolean) => void }; projectId: string; guides: Guides; places: string[]; onPlace: (scene: string, whole: boolean) => void }) {
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState<"tall" | "wide" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const film = s.promptWide !== undefined; // a Mini film: two films (9:16 for Instagram, 16:9 for YouTube)
  // Copy prompt (C3 Part 2a): the shot's Midjourney first-frame prompt, written by the app (src/shot-prompt.ts).
  async function copyPrompt(which: "tall" | "wide" = "tall") {
    const text = which === "wide" ? (s.promptWide ?? s.prompt) : s.prompt;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 2500);
  }
  return (
    <div data-shot={s.id} data-shot-number={s.number} data-shot-state={s.filled ? "filled" : pictures.length ? "picture" : "empty"} className={cn("bg-card/40 flex flex-col gap-2 rounded-lg border p-3", s.filled && "border-emerald-400/30")}>
      <div className="flex flex-wrap items-start gap-2 text-sm">
        <span className="bg-brand text-brand-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">{s.number}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{s.shows}</span>
          <span className="text-muted-foreground text-xs">
            <span className="bg-muted rounded px-1">{s.shot}</span>
            {s.people.map((w) => (
              <span key={w.character} className="ml-1.5 inline-flex items-center gap-1">
                · {w.character}
                {w.looks.length > 1 ? (
                  <select
                    data-shot-look={`${s.id}-${w.character}`}
                    value={w.look}
                    onChange={(e) => onLook(w.character, e.target.value)}
                    className={cn("bg-background rounded border px-1 py-0 text-[11px]", w.problem ? "border-amber-400/60 text-amber-200" : w.fromShot ? "border-brand/60" : "")}
                    title={w.problem ?? (w.fromShot ? "The look chosen for this shot" : "The song's look (Story room → Cast); choose another for this shot")}
                  >
                    {w.looks.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : w.look ? (
                  <span className="text-muted-foreground">({w.look})</span>
                ) : null}
              </span>
            ))}
            {places.length ? (
              // The shot's place: a scene card of the cast (its picture goes with the shot), for this shot or its whole section.
              <span className="ml-1.5 inline-flex items-center gap-1">
                · Place
                <select data-shot-place={s.id} value={s.scene ?? ""} onChange={(e) => onPlace(e.target.value, false)} className={cn("bg-background rounded border px-1 py-0 text-[11px]", s.scene ? "border-brand/60" : "")} title="The place of this shot: its scene card's picture goes with the prompt, Omni Reference and Make with references">
                  <option value="">None</option>
                  {[...new Set([...places, ...(s.scene ? [s.scene] : [])])].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button type="button" data-shot-place-section={s.id} onClick={() => onPlace(s.scene ?? "", true)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" title={`Give every shot of ${s.section} this place (${s.scene ?? "none"})`}>
                  all of {s.section}
                </button>
              </span>
            ) : s.scene ? (
              ` · ${s.scene}`
            ) : (
              ""
            )}
            {s.outfit ? ` · wears: ${s.outfit}` : ""}
            {s.line !== null ? <span data-shot-line={s.line}>{` · line ${s.line}: “${s.lineText ?? ""}”`}</span> : " · no line (music only)"}
            {s.tag ? ` · #${s.tag}` : ""}
            {s.span ? <ShotLength span={s.span} /> : null}
          </span>
        </div>
        {s.people.some((w) => w.problem) ? (
          <span data-shot-look-problem className="basis-full text-[11px] text-amber-300">
            {s.people.flatMap((w) => (w.problem ? [w.problem] : [])).join(" ")}
          </span>
        ) : null}
        {film ? (
          // A Mini film: a take for each film (a vertical take goes to the 9:16 film, a landscape take to the 16:9 one).
          <span className="flex shrink-0 items-center gap-1 text-xs">
            {([["tall", "9:16", s.filled, "Instagram"], ["wide", "16:9", s.filledWide ?? null, "YouTube"]] as const).map(([k, label, clip, where]) => (
              <span key={k} data-shot-film={k} data-shot-film-take={clip ?? ""} className={cn("flex items-center gap-1 rounded px-1.5 py-0.5", clip ? "bg-emerald-400/15 text-emerald-300" : "bg-muted text-muted-foreground")} title={clip ? `The ${label} film (${where}) uses ${clip}` : `No ${label} take yet: the ${label} film (${where}) shows a stand-in here. Make one with Copy prompt ${label}, then Use for shot ${s.number}.`}>
                {clip ? <Check className="size-3" /> : null} {label}
              </span>
            ))}
          </span>
        ) : s.filled ? (
          <span data-shot-filled={s.filled} className="flex shrink-0 items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 text-xs text-emerald-300" title={`In the Storyboard as ${s.filled}`}>
            <Check className="size-3" /> Filled
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs">To make</span>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2 text-xs">
        <button type="button" data-shot-copy-prompt={s.id} onClick={() => void copyPrompt("tall")} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-2 py-1" title={film ? "The Midjourney prompt for this shot in 9:16 (the Instagram film): paste it into Midjourney" : "The Midjourney prompt for this shot's first frame: paste it into Midjourney"}>
          {copied === "tall" ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />} {copied === "tall" ? "Copied" : film ? "Copy prompt 9:16" : "Copy prompt"}
        </button>
        {film ? (
          <button type="button" data-shot-copy-prompt-wide={s.id} onClick={() => void copyPrompt("wide")} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-2 py-1" title="The same shot in 16:9 (the YouTube film): paste it into Midjourney">
            {copied === "wide" ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />} {copied === "wide" ? "Copied" : "Copy prompt 16:9"}
          </button>
        ) : null}
        {s.refs.length && guides.options.length ? (
          <label className="flex shrink-0 items-center gap-1" title="Seedance follows this video's camera movement, framing, light and mood; the people and their clothes come from their pictures">
            <span className="text-muted-foreground">Camera guide</span>
            <select data-shot-guide={s.id} value={guides.value} onChange={(e) => guides.set(e.target.value)} className="bg-background max-w-48 rounded border px-1 py-0.5 text-[11px]">
              <option value="">None</option>
              {guides.options.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {s.refs.length ? (
          // Make with references: the video platform gets the people's and place's pictures, so the characters stay the same.
          (film ? (["9:16", "16:9"] as const) : ([s.prompt.includes("--ar 16:9") ? "16:9" : "9:16"] as const)).map((shape) => (
            <button key={shape} type="button" data-shot-references={`${s.id}-${shape}`} onClick={() => onReferences(shape)} className="hover:bg-accent border-brand/50 flex shrink-0 items-center gap-1 rounded border px-2 py-1" title={`Send this shot to Seedance 2.5 on WaveSpeed with the pictures of ${s.refs.map((r) => r.name).join(", ")} (reference-to-video): the characters stay as on their cards. The takes come back on this shot.`}>
              <Sparkles className="size-3" /> Make with references{film ? ` ${shape}` : ""}
            </button>
          ))
        ) : null}
        {s.refs.length ? (
          <label className="flex shrink-0 items-center gap-1" title="The persona of each person in the shot and this line's direction from the performance script (or the persona's section map) go with Make with references. Untick to make a take without it and compare.">
            <input type="checkbox" checked={acting.value} onChange={(e) => acting.set(e.target.checked)} data-shot-acting={s.id} /> acting direction
          </label>
        ) : null}
        {candidates >= 2 ? (
          <button type="button" data-shot-compare-open={s.id} onClick={onCompare} className="hover:bg-accent border-brand/50 text-brand flex shrink-0 items-center gap-1 rounded border px-2 py-1" title="Play every candidate of this shot side by side, together, with the song from its line">
            <Play className="size-3" /> Compare {candidates}
          </button>
        ) : null}
        {s.refs.length ? (
          <span data-shot-refs={s.id} className="flex items-center gap-1.5" title="Midjourney keeps a face from a picture, not from words: copy a picture, paste it into Midjourney's prompt bar (Ctrl+V) and choose Omni Reference">
            <span className="text-muted-foreground">Omni Reference:</span>
            {s.refs.map((r) => (
              <RefPicture key={`${r.card}-${r.file}`} r={r} />
            ))}
          </span>
        ) : null}
        {s.refs.length ? <SentPrompt projectId={projectId} slot={s.id} acting={acting.value} guide={!!guides.value} /> : null}
        <details className="text-muted-foreground min-w-0 flex-1">
          <summary className="cursor-pointer py-1">Show prompt</summary>
          <p data-shot-prompt={s.id} className="bg-background/60 mt-1 rounded border p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap select-all">
            {s.prompt}
          </p>
        </details>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {pictures.map((p) => tile(p, s))}
        <div className="flex min-h-32 flex-col gap-1.5">
          <button
            type="button"
            data-shot-drop={s.id}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              onDrop(e.dataTransfer.files, s);
            }}
            className={cn("flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center text-xs transition-colors", over ? "border-brand bg-brand/10" : "hover:border-brand/60")}
          >
            {adding ? <Loader2 className="text-brand size-5 animate-spin" /> : <ImagePlus className="text-brand size-5" />}
            <span>{pictures.length ? "Another picture for this shot" : `Drop the picture for shot ${s.number}`}</span>
          </button>
          {loose.length ? (
            <select data-shot-attach={s.id} value="" onChange={(e) => e.target.value && onAttach(e.target.value, s)} className="bg-background rounded-md border px-1.5 py-1 text-xs" aria-label={`A picture from Creation for shot ${s.number}`}>
              <option value="">or one from Creation…</option>
              {loose.map((p) => (
                <option key={p.file} value={p.file}>
                  {p.label ?? p.file}
                </option>
              ))}
            </select>
          ) : null}
          <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.m4v,.mov,.webm,image/*,video/*" className="hidden" data-shot-input={s.id} onChange={(e) => e.target.files && onDrop(e.target.files, s)} />
        </div>
      </div>
    </div>
  );
}

// Compare a shot (23 Nov 2026, Paul: "a viewer that automatically plays all shot 1 takes at once so it's easy to
// compare"): every candidate of one shot side by side (videos, animated takes, pictures as stills), started together
// and looped in sync; on a shot with a lyric line the song plays from that line, so each one is judged against the
// same words and beat. One set of controls (space: play / pause); "Use for shot N" under each tile.
type Candidate = { key: string; label: string; url: string; kind: "video" | "picture"; used: boolean; use: () => void; tag?: string; details?: string; fav?: boolean; onFav?: () => void }; // tag: the take's short tag (takeTag), label then the picture

function ShotCompare({ shot, candidates, song, onClose }: { shot: ProductionShot; candidates: Candidate[]; song: string | null; onClose: () => void }) {
  const videos = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [songOn, setSongOn] = useState(true);
  const fromS = shot.lineStartMs !== null && shot.lineStartMs !== undefined ? Math.max(0, shot.lineStartMs / 1000 - 0.5) : null; // a breath before the line
  const withSong = !!song && fromS !== null;
  const loopS = () => Math.max(3, ...[...videos.current.values()].map((v) => (Number.isFinite(v.duration) ? v.duration : 0)));
  const started = useRef(0);
  function restart(play = true) {
    for (const v of videos.current.values()) {
      v.currentTime = 0;
      if (play) void v.play().catch(() => undefined);
    }
    if (audio.current && withSong) {
      audio.current.currentTime = fromS!;
      if (play && songOn) void audio.current.play().catch(() => undefined);
    }
    started.current = performance.now();
    setPlaying(play);
  }
  function pause() {
    for (const v of videos.current.values()) v.pause();
    audio.current?.pause();
    setPlaying(false);
  }
  function toggle() {
    if (playing) pause();
    else {
      for (const v of videos.current.values()) void v.play().catch(() => undefined);
      if (audio.current && withSong && songOn) void audio.current.play().catch(() => undefined);
      setPlaying(true);
    }
  }
  // Every candidate starts again together when the longest one ends (and the song goes back to the line).
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const first = [...videos.current.values()][0];
      const at = first ? first.currentTime : (performance.now() - started.current) / 1000;
      if (at >= loopS() - 0.05 || (first && first.ended)) restart(true);
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, songOn]);
  useEffect(() => {
    const t = setTimeout(() => restart(true), 300); // all loaded: start together
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", key);
    return () => (clearTimeout(t), window.removeEventListener("keydown", key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [favOnly, setFavOnly] = useState(false); // ♥ only: just the favourites play side by side (25 Nov 2026)
  const favs = candidates.filter((c) => c.fav).length;
  const shown = favOnly && favs ? candidates.filter((c) => c.fav) : candidates;
  const cols = shown.length <= 2 ? "grid-cols-2" : shown.length === 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4";
  return (
    <Dialog open onOpenChange={(o) => !o && (pause(), onClose())}>
      <DialogContent data-shot-compare={shot.id} className="w-[min(72rem,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>
            Compare shot {shot.number}: {candidates.length} candidates
          </DialogTitle>
          <DialogDescription>
            {shot.shows}
            {shot.line !== null ? ` · line ${shot.line}: “${shot.lineText ?? ""}”` : " · no line (music only)"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button type="button" size="sm" data-compare-play onClick={toggle}>
            {playing ? "Pause" : "Play"} all
          </Button>
          <Button type="button" size="sm" variant="outline" data-compare-restart onClick={() => restart(true)}>
            <RotateCw /> From the start
          </Button>
          {withSong ? (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                data-compare-song
                checked={songOn}
                onChange={(e) => {
                  setSongOn(e.target.checked);
                  if (!e.target.checked) audio.current?.pause();
                  else restart(true);
                }}
              />
              With the song from line {shot.line}
            </label>
          ) : (
            <span className="text-muted-foreground">{shot.line === null ? "Music-only shot: the videos play without the song." : "The line is not timed yet: the videos play without the song."}</span>
          )}
          <button type="button" data-compare-fav-only={favOnly ? "on" : "off"} aria-pressed={favOnly} disabled={!favs} onClick={() => (setFavOnly((v) => !v), setTimeout(() => restart(true), 50))} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-50", favOnly && favs ? "border-brand bg-brand/15" : "hover:bg-accent")} title={favs ? "Only your ♥ favourites (click again for all)" : "Click ♡ on a tile to mark a favourite"}>
            <Heart className={cn("size-3.5 text-brand", favOnly && favs && "fill-brand")} /> {favOnly && favs ? "Show all" : `Favourites only (${favs})`}
          </button>
          <span className="text-muted-foreground">Space: play / pause · they loop together</span>
        </div>
        <div className={cn("grid max-h-[70vh] gap-3 overflow-y-auto", cols)}>
          {shown.map((c) => (
            <div key={c.key} data-compare-tile={c.key} data-compare-fav={c.fav ? "true" : "false"} className={cn("flex flex-col gap-1.5 rounded-lg border p-1.5", c.used && "border-emerald-400/50")}>
              <div className="relative aspect-[9/16] overflow-hidden rounded bg-black">
                {c.kind === "video" ? (
                  <video
                    ref={(el) => {
                      if (el) videos.current.set(c.key, el);
                      else videos.current.delete(c.key);
                    }}
                    src={c.url}
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a local picture served by /api/files
                  <img src={c.url} alt="" className="absolute inset-0 size-full object-cover" />
                )}
                {c.kind === "picture" ? <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">picture (as a still)</span> : null}
                {c.onFav ? <FavButton id={c.key} on={!!c.fav} onToggle={c.onFav} className="absolute top-1 right-1" /> : null}
              </div>
              {c.tag ? (
                <span data-compare-tag className="text-[11px] leading-tight font-medium" title={c.details}>
                  {c.tag}
                </span>
              ) : null}
              <span className="text-muted-foreground truncate text-[10px]" title={c.label}>
                {c.label}
              </span>
              {c.used ? (
                <span data-compare-used className="flex items-center gap-1 text-xs text-emerald-300">
                  <Check className="size-3" /> Shot {shot.number}
                </span>
              ) : (
                <Button type="button" size="sm" variant="outline" data-compare-use={c.key} onClick={c.use}>
                  <Check /> Use for shot {shot.number}
                </Button>
              )}
            </div>
          ))}
        </div>
        {withSong ? <audio ref={audio} src={song!} preload="auto" /> : null}
      </DialogContent>
    </Dialog>
  );
}

// A person's (or place's) locked picture for Midjourney's Omni Reference: click copies the picture itself (PNG) to paste
// into Midjourney's prompt bar; the link opens it (to save or drag it).
function RefPicture({ r }: { r: ProductionShot["refs"][number] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = `/api/cards/${r.card}/file/${r.file.split("/").map(encodeURIComponent).join("/")}`;
  async function copy() {
    try {
      const blob = await (await fetch(url)).blob();
      let png = blob;
      if (blob.type !== "image/png") {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.drawImage(bmp, 0, 0);
        png = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no picture"))), "image/png"));
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setState("copied");
    } catch {
      setState("failed");
      window.open(url, "_blank");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" data-shot-ref={r.name} onClick={() => void copy()} className="hover:border-brand relative size-9 shrink-0 overflow-hidden rounded border" title={`${r.name}: click to copy the picture, then paste it into Midjourney (Ctrl+V) as Omni Reference`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a card picture served by /api/cards */}
        <img src={url} alt={r.name} className="size-full object-cover" />
        {state === "copied" ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Check className="size-4 text-emerald-300" />
          </span>
        ) : null}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground underline underline-offset-2">
        {state === "copied" ? "copied" : state === "failed" ? "opened" : r.name}
      </a>
    </span>
  );
}

function PictureTile({
  projectId,
  p,
  board,
  post,
  reload,
  setNotice,
  play,
  shot,
  useShot,
  openCompare,
  favOnly = false,
  onFav,
}: {
  favOnly?: boolean; // ♥ only: just the favourite takes
  onFav?: (n: number | null, on: boolean) => void; // ♥ on the picture (n null) or a take
  openCompare?: () => void; // a shot with 2+ candidates: clicking one plays them all side by side (like Midjourney)
  projectId: string;
  p: PictureView;
  board: PicturesView;
  shot?: ProductionShot; // on a shot (Production): its takes are used for that shot
  useShot?: (n: number | null) => void;
  play: (url: string, title: string, take?: { fromS: number | null; clipInS: number; why: string | null }) => void;
  post: (b: Record<string, unknown>) => Promise<unknown>;
  reload: () => Promise<void>;
  setNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const [mood, setMood] = useState(p.mood);
  const [feeling, setFeeling] = useState(p.feeling);
  const [who, setWho] = useState(p.who ?? "");
  // This picture's own choice; until Paul changes it, his defaults apply.
  const [model, setModel] = useState<string | null>(null);
  const [takesOwn, setTakes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { defaults, takeSeconds, maxTakes } = board;
  const [service, quality] = splitModel(model ?? `${defaults.service}:${defaults.quality}`);
  const svc = board.services.find((s) => s.id === service) ?? board.services[0];
  const q = svc.qualities.find((x) => x.id === quality) ?? svc.qualities[0];
  const takes = takesOwn ?? defaults.takes;
  const capUsd = defaults.cap;
  const whoName = board.characters?.find((c) => c.id === who)?.name ?? null; // Animate keeps this character's face
  const perTake = Math.round((whoName ? (board.faceUsdPerSecond ?? 0.324) : q.usdPerSecond) * takeSeconds * 100) / 100;
  const total = Math.round(perTake * takes * 100) / 100;
  const over = total > capUsd;
  const ready = whoName ? !!board.services.find((x) => x.id === "wavespeed")?.ready : svc.ready; // with a face: WaveSpeed
  const video = p.kind === "video";
  // A take's video (pictures/takes/…); a take from the first build (21 Nov 2026) is only in the clips.
  const takeUrl = (t: Take) => (t.file ? fileUrl(p.url.replace(/[^/]+$/, t.file)) : t.clip ? fileUrl(p.url.replace(/pictures\/[^/]+$/, `clips/${t.clip}`)) : null);
  async function send(n: number | null, what: string) {
    try {
      const d = (await post({ action: "send", file: p.file, n })) as { clip: string; already: boolean };
      setNotice({ ok: true, text: d.already ? `${what} is already in your Storyboard (${d.clip}).` : `${what} is at the end of your Storyboard as ${d.clip}.` });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  // A singing take: the same choice as in Lyrics Sync (it goes on its lines at once; nothing is made again), and a
  // "New — compare" take loses its mark once watched.
  async function singer(body: Record<string, unknown>) {
    const r = await api(`/api/songs/${projectId}/singer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, source: p.file }) });
    const d = (await r.json()) as { error?: string };
    if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
  }
  async function chooseTake(t: Take) {
    try {
      await singer({ action: "use", n: t.n });
      setNotice({ ok: true, text: `${t.label ?? `Take ${t.n}`} is now on ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`} (nothing was made again). The next video uses it.` });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  // Clean up (n null: every take not chosen or failed) or Remove one take: put aside, never deleted (Restore below).
  async function cleanUp(n: number | null) {
    const which = (n === null ? p.cleanable : [n]).map((k) => {
      const t = p.takes.find((x) => x.n === k);
      return `${t?.label ?? `Take ${k}`}${t?.status === "failed" ? " (failed)" : ""}`;
    });
    if (!window.confirm(`Move ${which.length === 1 ? "this take" : `${which.length} takes`} of ${p.label ?? p.file} aside: ${which.join(", ")}? They leave this card and Lyrics Sync; Removed takes → Restore brings any of them back.`)) return;
    try {
      const d = (await post({ action: "cleanup", file: p.file, ...(n === null ? {} : { n }) })) as { removed: number[] };
      setNotice({ ok: true, text: `${d.removed.length} take${d.removed.length === 1 ? "" : "s"} of ${p.label ?? p.file} put aside (Removed takes → Restore).` });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }
  async function restore(n: number, label: string) {
    try {
      await post({ action: "restore", file: p.file, n });
      setNotice({ ok: true, text: `${label} of ${p.label ?? p.file} is back.` });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  async function takeAway() {
    try {
      if (shot) {
        await post({ action: "shot", file: p.file, slot: null });
        setNotice({ ok: true, text: `${p.label ?? p.file} is no longer for shot ${shot.number}: it is with the loose pictures (below).` });
      } else {
        if (!window.confirm(`Put ${p.label ?? p.file} aside? It leaves Creation (its clips already in the Storyboard stay). Put-aside pictures → Restore brings it back with its takes.`)) return;
        await post({ action: "remove-picture", file: p.file });
        setNotice({ ok: true, text: `${p.label ?? p.file} is put aside (Put-aside pictures → Restore).` });
      }
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  async function animate() {
    setBusy(true);
    try {
      if (mood !== p.mood) await post({ action: "mood", file: p.file, mood });
      await post({ action: "animate", file: p.file, service: svc.id, quality: q.id, takes, cap: capUsd });
      setNotice({ ok: true, text: `${p.file}: ${takes} take${takes === 1 ? "" : "s"} sent to ${whoName ? `WaveSpeed · Seedance 2.5 with ${whoName}'s face sheet` : `${svc.label} · ${q.label}`} (about ${money(total)}). They stay here: send your favourites to the Storyboard; follow them in Tasks.` });
      window.dispatchEvent(new Event("lyric-tasks-changed")); // the Tasks menu opens with them
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-picture={p.file} data-kind={p.kind} className="bg-card/40 flex flex-col gap-2 rounded-lg border p-2">
      <div className="relative">
        {video ? (
          <button type="button" data-picture-play onClick={() => (openCompare ? openCompare() : play(fileUrl(p.url), p.file))} className="block w-full cursor-pointer" title={openCompare ? "Click to play every candidate of this shot together" : "Click to watch it big"}>
            <video src={`${fileUrl(p.url)}#t=0.1`} muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={(e) => e.currentTarget.pause()} className="bg-muted h-48 w-full rounded object-contain" />
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a local picture served by /api/files
          <img src={fileUrl(p.url)} alt="" className="bg-muted h-48 w-full rounded object-contain" />
        )}
        <span data-source className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {p.source}
          {video ? " · video" : ""}
        </span>
        {p.mjLink ? (
          // The original on midjourney.com (its job id is in the file's name): vary, upscale or animate it again there.
          <a data-picture-mj={p.file} href={p.mjLink} target="_blank" rel="noreferrer" className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80" title="Open the original in Midjourney">
            Open in Midjourney ↗
          </a>
        ) : null}
        {/* ✕ (23 Nov 2026): on a shot, the picture goes back to the loose pictures; a loose picture is put aside (Restore below). */}
        <button
          type="button"
          data-picture-remove={p.file}
          onClick={() => void takeAway()}
          className="absolute top-1 right-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
          aria-label={shot ? `Take ${p.file} off shot ${shot.number}` : `Put ${p.file} aside`}
          title={shot ? `Not for this shot: it goes back to the loose pictures (nothing is lost)` : "Put aside: it leaves Creation; Put-aside pictures → Restore brings it back"}
        >
          <X className="size-3.5" />
        </button>
        {onFav ? <FavButton id={p.file} on={p.fav} onToggle={() => onFav(null, !p.fav)} className="absolute top-1 right-8" /> : null}
      </div>
      <span className="flex items-center justify-between gap-2 text-xs">
        <NameField id={p.file} name={p.label} file={p.file} onSave={async (label) => {
          await post({ action: "label", file: p.file, label }).catch((e: Error) => setNotice({ ok: false, text: e.message }));
          await reload();
        }} />
        {p.source === "Character references" ? (
          <span className="text-muted-foreground text-[11px]" title="The pictures sent with Make with references; its takes are below">pictures sent</span>
        ) : shot && useShot ? (
          // On a shot (Production) there is no "Send": a picture or video only ever fills its own shot, in its place in the
          // story (23 Nov 2026: a Send here added a loose copy at the end and changed the Storyboard's order).
          p.sent && shot.filled && p.sent.toLowerCase() === shot.filled.toLowerCase() ? (
            <span data-picture-shot-used className="flex shrink-0 items-center gap-1 text-emerald-300">
              <Check className="size-3" /> Shot {shot.number}
            </span>
          ) : (
            <button type="button" data-picture-use-shot={shot.id} onClick={() => useShot(null)} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]" title={video ? `This video fills shot ${shot.number}${shot.line !== null ? `, on line ${shot.line}` : ""}` : `This picture fills shot ${shot.number} as a photo (with a gentle move)${shot.line !== null ? `, on line ${shot.line}` : ""}; or Animate it and use a take`}>
              <Check className="size-3" /> {video ? `Use for shot ${shot.number}` : `Use picture for shot ${shot.number}`}
            </button>
          )
        ) : p.sent ? (
          <span data-picture-sent className="flex shrink-0 items-center gap-1 text-emerald-300" title={`In your Storyboard as ${p.sent}`}>
            <Check className="size-3" /> In Storyboard
          </span>
        ) : (
          <button type="button" data-picture-send onClick={() => void send(null, p.label ?? p.file)} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]" title={video ? "Put this video in your Storyboard" : "Use the picture itself as a photo in your Storyboard"}>
            <Send className="size-3" /> {video ? "Send to Storyboard" : "Send picture"}
          </button>
        )}
      </span>
      {video && p.source !== "Character references" && !shot ? <MusicVideoPanel p={p} url={fileUrl(p.url)} cap={board.defaults.cap} post={post} reload={reload} setNotice={setNotice} play={(u, title) => play(u, title)} /> : null}
      {video || p.source === "Character references" ? null : (
        <>
          <div className="flex items-center gap-1.5 text-xs">
            <FeelingSelect
              value={feeling}
              name={p.label ?? p.file}
              inherited={p.sectionFeeling}
              data="picture"
              onChange={(f) => {
                setFeeling(f);
                void post({ action: "feeling", file: p.file, feeling: f }).catch((e) => setNotice({ ok: false, text: (e as Error).message }));
              }}
            />
            {board.characters?.length ? (
              <select
                data-picture-who
                aria-label="Who is this"
                title="Who is in this picture: Animate then sends that character's face sheet (close-up, side profile, 3/4) so the face stays the same in every clip"
                value={who}
                onChange={(e) => {
                  const v = e.target.value;
                  setWho(v);
                  void post({ action: "who", file: p.file, who: v || null }).catch((err) => setNotice({ ok: false, text: (err as Error).message }));
                }}
                className={cn("bg-background max-w-40 rounded border px-1 py-0.5", who ? "text-sky-200" : "text-muted-foreground")}
              >
                <option value="">Who: nobody</option>
                {board.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    Who: {c.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <input
            data-picture-mood
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            onBlur={() => mood !== p.mood && void post({ action: "mood", file: p.file, mood }).catch(() => undefined)}
            placeholder="Mood, a few words (optional)"
            maxLength={200}
            className="bg-background rounded-md border px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {whoName ? (
              <span data-picture-face-model className="bg-background rounded-md border px-1.5 py-1" title="With a character, Animate uses Seedance 2.5 with references (WaveSpeed): the picture and the face sheet">
                Seedance 2.5 · with {whoName}&apos;s face
              </span>
            ) : (
              <select data-picture-model value={`${svc.id}:${q.id}`} onChange={(e) => setModel(e.target.value)} className="bg-background max-w-full rounded-md border px-1.5 py-1" aria-label="Model">
                {modelOptions(board.services).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            <select data-picture-takes value={takes} onChange={(e) => setTakes(Number(e.target.value))} className="bg-background rounded-md border px-1.5 py-1" aria-label="Takes">
              {Array.from({ length: maxTakes }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} take{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" data-picture-animate disabled={busy || !ready || over} onClick={() => void animate()} title={!ready ? `No ${whoName ? "WaveSpeed" : svc.label} key yet` : over ? `Above your cap of ${money(capUsd)}` : undefined}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Animate
            </Button>
          </div>
          <span data-picture-cost className={cn("text-[11px]", over ? "text-amber-300" : "text-muted-foreground")} title={`${q.label} · ${q.priceNote}`}>
            {takes} × {takeSeconds} s · about {money(total)}
            {over ? ` · above your cap of ${money(capUsd)}` : ""}
            {/estimate/.test(q.priceNote) ? " (estimate)" : ""}
            {svc.ready ? "" : ` · no ${svc.label} key yet`}
          </span>
        </>
      )}
      {p.cleanable.length ? (
        <button type="button" data-takes-cleanup={p.cleanable.length} onClick={() => void cleanUp(null)} className="hover:bg-accent self-start rounded border px-1.5 py-0.5 text-[11px]" title="Puts aside the failed takes and the ones you did not choose (not in use, on no line, not playing in your Storyboard). Nothing is deleted: Removed takes → Restore.">
          Clean up {p.cleanable.length} take{p.cleanable.length === 1 ? "" : "s"}
        </button>
      ) : null}
      {p.takes.length ? (
        <ul className="flex flex-col gap-1" data-picture-takes-list>
          {[...p.takes].filter((t) => !favOnly || t.fav).reverse().map((t) => (
            <TakeRow key={t.n} t={t} onFav={onFav ? () => onFav(t.n, !t.fav) : undefined} onRename={async (label) => {
              await post({ action: "label", file: p.file, n: t.n, label }).catch((e: Error) => setNotice({ ok: false, text: e.message }));
              await reload();
            }} source={`${board.services.find((s) => s.id === t.service)?.label ?? t.service} · ${t.model}${t.kind === "lipsync" ? ` · lip sync, ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` : ""}`} url={takeUrl(t)} onPlay={(url) => {
              if (openCompare && t.kind !== "lipsync") return openCompare();
              play(url, `${p.file} · Take ${t.n}`, { fromS: t.songFromMs !== undefined ? t.songFromMs / 1000 : null, clipInS: t.clipInS ?? 0, why: t.songWhy ?? null });
              if (t.fresh) void singer({ action: "seen", n: t.n }).then(reload).catch(() => undefined);
            }} onSend={() => void send(t.n, t.label ?? `Take ${t.n}`)} onUse={() => void chooseTake(t)} shot={shot && useShot ? { number: shot.number, used: !!(t.sent && shot.filled && t.sent.toLowerCase() === shot.filled.toLowerCase()), use: () => useShot(t.n) } : undefined} onRemove={p.cleanable.includes(t.n) ? () => void cleanUp(t.n) : undefined} onResume={() => void post({ action: "resume", file: p.file, n: t.n }).then(reload).catch((e: Error) => setNotice({ ok: false, text: e.message }))} onFinal={t.quality === "draft" && t.status === "done" && !p.takes.some((x) => x.finalOf === t.n && x.status !== "failed") ? () => void post({ action: "final", file: p.file, n: t.n }).then(reload).catch((e: Error) => setNotice({ ok: false, text: e.message })) : undefined} />
          ))}
        </ul>
      ) : null}
      {p.removed.length ? (
        <details data-takes-removed={p.removed.length} className="text-muted-foreground text-[11px]">
          <summary className="cursor-pointer">Removed takes ({p.removed.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {p.removed.map((r) => (
              <li key={r.n} className="flex items-center gap-2" data-take-removed={r.n}>
                <span className="min-w-0 flex-1 truncate">
                  {r.label} · {r.why}
                </span>
                <button type="button" data-take-restore={r.n} onClick={() => void restore(r.n, r.label)} className="hover:bg-accent text-foreground shrink-0 rounded border px-1.5 py-0.5">
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// Make final (25 Nov 2026): a Draft take upscaled with Video Upscaler Pro to 1080p, $0.04 a second (at least 3 s).
const finalUsd = (seconds: number | undefined) => Math.max(3, Math.ceil(seconds ?? 5)) * 0.04;

function TakeRow({ t, source, url, onPlay, onRename, onSend, onUse, onRemove, onResume, onFinal, shot, onFav }: { t: Take & { inUse?: boolean; onLines?: string }; onFav?: () => void; source: string; url: string | null; onPlay: (url: string) => void; onRename: (label: string) => Promise<void>; onSend: () => void; onUse: () => void; onRemove?: () => void; onResume: () => void; onFinal?: () => void; shot?: { number: number; used: boolean; use: () => void } }) {
  const label = t.finalOf ? `Take ${t.finalOf} final` : `Take ${t.n}`;
  return (
    <li data-take={t.n} data-take-status={t.status} className="flex items-center gap-2 text-[11px]">
      {t.status === "done" && url ? (
        <button type="button" data-take-play onClick={() => onPlay(url)} className="group relative size-10 shrink-0 cursor-pointer" title="Click to watch it big">
          <video src={`${url}#t=0.1`} muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={(e) => e.currentTarget.pause()} className="bg-muted size-10 rounded object-cover" />
          <span className="absolute inset-0 flex items-center justify-center rounded bg-black/30 group-hover:bg-transparent">
            <Play className="size-4 fill-white text-white group-hover:opacity-0" />
          </span>
        </button>
      ) : (
        <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded">{t.status === "running" ? <Loader2 className="text-brand size-4 animate-spin" /> : null}</span>
      )}
      {onFav && t.status === "done" ? <FavButton id={`take-${t.n}`} on={!!t.fav} onToggle={onFav} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1">
        <NameField id={`take-${t.n}`} name={t.label ?? null} file={label} className="inline-flex max-w-full font-bold" onSave={onRename} />{" "}
        <span data-take-source className="text-muted-foreground" title={`${source}\n${takeDetails(t)}`}>
          {takeKind(t)}
        </span>
        {t.status === "running" ? " · being made…" : null}
        <span data-take-facts className="text-muted-foreground block">
          {takeFacts(t)}
        </span>
        {t.status === "failed" || t.status === "interrupted" ? <span className={t.status === "failed" ? "text-red-300" : "text-amber-300"}> · {t.error}</span> : null}
      </span>
      {t.status === "done" && t.kind === "lipsync" ? (
        // A singing take belongs on its lines (elsewhere its lips are out of time): In use, or Use this take.
        t.inUse ? (
          <span data-take-badge="in-use" className="flex shrink-0 items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300" title={t.sent ? `On its lines as ${t.sent}` : undefined}>
            <Check className="size-3" /> In use · {t.through && t.through > (t.line ?? 0) ? `lines ${t.line}-${t.through}` : `line ${t.line}`}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            {t.fresh ? (
              <span data-take-badge="new" className="bg-brand/15 text-brand rounded px-1.5 py-0.5">
                New — compare
              </span>
            ) : null}
            <button type="button" data-take-use onClick={onUse} className="hover:bg-accent rounded border px-1.5 py-0.5" title="Put this take on its lines now (nothing is made again)">
              Use this take
            </button>
          </span>
        )
      ) : t.status === "done" && shot ? (
        // Production: this take fills its shot (its place in the story, on its line).
        shot.used ? (
          <span data-take-shot-used className="flex shrink-0 items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300">
            <Check className="size-3" /> Shot {shot.number}
          </span>
        ) : (
          <button type="button" data-take-use-shot onClick={shot.use} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5" title={`This take fills shot ${shot.number} (its place in the story, and its line)`}>
            <Check className="size-3" /> Use for shot {shot.number}
          </button>
        )
      ) : t.status === "done" && t.onLines ? (
        <span data-take-on={t.onLines} className="flex shrink-0 items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300" title={t.sent ? `Shown on ${t.onLines} as ${t.sent} (Lyrics Sync → Shows clip)` : undefined}>
          <Check className="size-3" /> On {t.onLines}
        </span>
      ) : t.status === "done" ? (
        t.sent ? (
          <span data-take-sent className="flex shrink-0 items-center gap-1 text-emerald-300" title={`In your Storyboard as ${t.sent}`}>
            <Check className="size-3" /> In Storyboard, on no line
          </span>
        ) : (
          <button type="button" data-take-send onClick={onSend} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5">
            <Send className="size-3" /> Send to Storyboard
          </button>
        )
      ) : null}
      {onFinal ? (
        <button type="button" data-take-final onClick={onFinal} className="border-brand/60 text-brand hover:bg-brand/10 flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5" title="Upscales this exact take to 1080p (Video Upscaler Pro): the same movement, full quality. The draft stays.">
          <Sparkles className="size-3" /> Make final · about ${finalUsd(t.seconds).toFixed(2)}
        </button>
      ) : null}
      {t.status === "interrupted" && t.request_id ? (
        <button type="button" data-take-resume onClick={onResume} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5">
          <RotateCw className="size-3" /> Get result
        </button>
      ) : null}
      {onRemove ? (
        <button type="button" data-take-remove onClick={onRemove} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5" aria-label={`Remove take ${t.n}`} title="Put this take aside (Removed takes → Restore brings it back)">
          <X className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

// ♥ Favourite (25 Nov 2026, Paul: "easily spot my favs"): pink and filled when on, an outline when off; one click each way.
function FavButton({ id, on, onToggle, className }: { id: string; on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-fav={id}
      data-fav-on={on ? "true" : "false"}
      aria-pressed={on}
      aria-label={on ? "Favourite: click to take it off" : "Mark as a favourite"}
      title={on ? "Your favourite (click to take it off)" : "Mark as a favourite"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn("rounded-full bg-black/60 p-1 hover:bg-black/80", className)}
    >
      <Heart className={cn("size-3.5", on ? "fill-brand text-brand" : "text-white")} />
    </button>
  );
}

// "Show the prompt sent" (26 Nov 2026): exactly what Make with references would send for this shot, with or without
// the acting direction (Persona + performance script), and Copy. Nothing is sent.
function SentPrompt({ projectId, slot, acting, guide }: { projectId: string; slot: string; acting: boolean; guide: boolean }) {
  const [text, setText] = useState<{ prompt: string; source: string; stale: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/songs/${projectId}/pictures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "references-preview", slot, acting, guide }) });
      const d = (await r.json()) as { prompt?: string; source?: string; stale?: string | null; error?: string };
      if (!r.ok || !d.prompt) throw new Error(d.error ?? "Could not show the prompt.");
      setText({ prompt: d.prompt, source: d.source ?? "none", stale: d.stale ?? null });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text.prompt);
    } catch {
      const t = document.createElement("textarea");
      t.value = text.prompt;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <details className="text-muted-foreground min-w-0" data-sent-prompt={slot} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary className="cursor-pointer py-1">Show the prompt sent{acting ? " (with acting)" : ""}</summary>
      {err ? <p className="text-amber-300">{err}</p> : null}
      {text ? (
        <div className="mt-1 flex flex-col gap-1">
          <p data-sent-prompt-source={text.source} className="text-[11px]">
            {text.source === "script" ? "The acting comes from this line's performance script." : text.source === "section" ? "The acting comes from the persona's section map (no script line for this shot)." : acting ? "No persona or script for the people in this shot: no acting direction." : "Without the acting direction."}
            {text.stale ? ` The script's line is stale (${text.stale}): its direction is not used.` : ""}
          </p>
          <p data-sent-prompt-text={slot} className="bg-background/60 rounded border p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap select-all">{text.prompt}</p>
          <button type="button" onClick={() => void copy()} className="hover:bg-accent w-fit rounded border px-2 py-0.5 text-[11px]" data-sent-prompt-copy={slot}>
            {copied ? "Copied" : "Copy performance prompt"}
          </button>
        </div>
      ) : null}
    </details>
  );
}
