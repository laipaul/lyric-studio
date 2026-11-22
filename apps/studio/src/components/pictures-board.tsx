"use client";

// Prepare → Creation (G2, 21 Nov 2026; first called Pictures): Paul's messy creation space, apart from the Storyboard.
// Everything he makes sits here together, from anywhere: pictures and videos he adds by hand (Midjourney videos too,
// under their own names), files from a link (any outside source), and takes animated here: Animate sends a picture as
// image-to-video to WaveSpeed or Higgsfield (his own key). The app chooses the length, size, motion and sound (none);
// Paul may add a few words of mood. His own defaults (model, takes, cap) apply to every song; each picture can override
// them. The cost shows before sending and a press above the cap is refused. Each item shows where it came from. Paul
// sends his favourites with "Send to Storyboard" (the end of his story line, marked ✓).
import { Check, Copy, Film, ImagePlus, Link2, Loader2, Play, RotateCw, Send, Sparkles, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { CreationDefaults, PictureView, PicturesView, Quality, ServiceId, Take } from "@lyric/video/animate";
import type { ProductionShot, ProductionView } from "@lyric/video/shot-production";

import { NameField } from "@/components/name-field";
import { useGoToTab } from "@/components/song-stages";
import { takeFacts } from "@lyric/video/take-facts";

import { CharacterPicker } from "@/components/character-picker";
import { FilmLookPicker } from "@/components/film-look-picker";
import { FramePicker } from "@/components/frame-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
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

  function added(d: { added?: string[]; skipped?: { name: string; reason: string }[] }) {
    const skipped = d.skipped?.length ? ` Skipped: ${d.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : "";
    setNotice({ ok: !!d.added?.length, text: `${d.added?.length ?? 0} file${d.added?.length === 1 ? "" : "s"} added.${skipped}` });
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
      const d = (await r.json()) as { added?: string[]; skipped?: { name: string; reason: string }[]; error?: string };
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

      {shots.length ? (
        <ShotItems
          shots={shots}
          pictures={board.pictures}
          loose={loose}
          adding={adding}
          onDrop={(files, s) => void add(files, s.id)}
          onAttach={(file, s) => void attach(file, s)}
          tile={(p, s) => <PictureTile key={p.file} projectId={projectId} p={p} board={board} post={post} reload={load} setNotice={setNotice} play={(url, title, take) => setPlaying({ url, title, take })} shot={s} useShot={(n) => void useShot(p.file, n, s)} />}
        />
      ) : null}
      {shots.length ? (
        <h3 data-loose-heading className="mt-2 text-sm font-semibold">
          Loose pictures <span className="text-muted-foreground font-normal">· not in a shot: inspiration, extra B-roll, or drop one on a shot above</span>
        </h3>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {loose.map((p) => (
          <PictureTile key={p.file} projectId={projectId} p={p} board={board} post={post} reload={load} setNotice={setNotice} play={(url, title, take) => setPlaying({ url, title, take })} />
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
  tile,
}: {
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
            <ShotRow key={s.id} s={s} pictures={pictures.filter((p) => p.slot === s.id)} loose={loose} adding={adding} onDrop={onDrop} onAttach={onAttach} tile={tile} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ShotRow({ s, pictures, loose, adding, onDrop, onAttach, tile }: { s: ProductionShot; pictures: PictureView[]; loose: PictureView[]; adding: boolean; onDrop: (files: FileList, s: ProductionShot) => void; onAttach: (file: string, s: ProductionShot) => void; tile: (p: PictureView, s: ProductionShot) => ReactNode }) {
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Copy prompt (C3 Part 2a): the shot's Midjourney first-frame prompt, written by the app (src/shot-prompt.ts).
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(s.prompt);
    } catch {
      const t = document.createElement("textarea");
      t.value = s.prompt;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <div data-shot={s.id} data-shot-number={s.number} data-shot-state={s.filled ? "filled" : pictures.length ? "picture" : "empty"} className={cn("bg-card/40 flex flex-col gap-2 rounded-lg border p-3", s.filled && "border-emerald-400/30")}>
      <div className="flex flex-wrap items-start gap-2 text-sm">
        <span className="bg-brand text-brand-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">{s.number}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{s.shows}</span>
          <span className="text-muted-foreground text-xs">
            <span className="bg-muted rounded px-1">{s.shot}</span>
            {s.characters.length ? ` · ${s.characters.join(", ")}` : ""}
            {s.scene ? ` · ${s.scene}` : ""}
            {s.outfit ? ` · wears: ${s.outfit}` : ""}
            {s.line !== null ? <span data-shot-line={s.line}>{` · line ${s.line}: “${s.lineText ?? ""}”`}</span> : " · no line (music only)"}
            {s.tag ? ` · #${s.tag}` : ""}
          </span>
        </div>
        {s.filled ? (
          <span data-shot-filled={s.filled} className="flex shrink-0 items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 text-xs text-emerald-300" title={`In the Storyboard as ${s.filled}`}>
            <Check className="size-3" /> Filled
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs">To make</span>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2 text-xs">
        <button type="button" data-shot-copy-prompt={s.id} onClick={() => void copyPrompt()} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-2 py-1" title="The Midjourney prompt for this shot's first frame: paste it into Midjourney">
          {copied ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy prompt"}
        </button>
        {s.refs.length ? (
          <span data-shot-refs={s.id} className="flex items-center gap-1.5" title="Midjourney keeps a face from a picture, not from words: copy a picture, paste it into Midjourney's prompt bar (Ctrl+V) and choose Omni Reference">
            <span className="text-muted-foreground">Omni Reference:</span>
            {s.refs.map((r) => (
              <RefPicture key={`${r.card}-${r.file}`} r={r} />
            ))}
          </span>
        ) : null}
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
}: {
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
  const perTake = Math.round(q.usdPerSecond * takeSeconds * 100) / 100;
  const total = Math.round(perTake * takes * 100) / 100;
  const over = total > capUsd;
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

  async function animate() {
    setBusy(true);
    try {
      if (mood !== p.mood) await post({ action: "mood", file: p.file, mood });
      await post({ action: "animate", file: p.file, service: svc.id, quality: q.id, takes, cap: capUsd });
      setNotice({ ok: true, text: `${p.file}: ${takes} take${takes === 1 ? "" : "s"} sent to ${svc.label} · ${q.label} (about ${money(total)}). They stay here: send your favourites to the Storyboard; follow them in Tasks.` });
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
          <button type="button" data-picture-play onClick={() => play(fileUrl(p.url), p.file)} className="block w-full cursor-pointer" title="Click to watch it big">
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
      </div>
      <span className="flex items-center justify-between gap-2 text-xs">
        <NameField id={p.file} name={p.label} file={p.file} onSave={async (label) => {
          await post({ action: "label", file: p.file, label }).catch((e: Error) => setNotice({ ok: false, text: e.message }));
          await reload();
        }} />
        {shot && video && useShot ? (
          p.sent && shot.filled && p.sent.toLowerCase() === shot.filled.toLowerCase() ? (
            <span data-picture-shot-used className="flex shrink-0 items-center gap-1 text-emerald-300">
              <Check className="size-3" /> Shot {shot.number}
            </span>
          ) : (
            <button type="button" data-picture-use-shot={shot.id} onClick={() => useShot(null)} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]" title={`This video fills shot ${shot.number}${shot.line !== null ? `, on line ${shot.line}` : ""}`}>
              <Check className="size-3" /> Use for shot {shot.number}
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
      {video ? null : (
        <>
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
            <select data-picture-model value={`${svc.id}:${q.id}`} onChange={(e) => setModel(e.target.value)} className="bg-background max-w-full rounded-md border px-1.5 py-1" aria-label="Model">
              {modelOptions(board.services).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select data-picture-takes value={takes} onChange={(e) => setTakes(Number(e.target.value))} className="bg-background rounded-md border px-1.5 py-1" aria-label="Takes">
              {Array.from({ length: maxTakes }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} take{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" data-picture-animate disabled={busy || !svc.ready || over} onClick={() => void animate()} title={!svc.ready ? `No ${svc.label} key yet` : over ? `Above your cap of ${money(capUsd)}` : undefined}>
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
          {[...p.takes].reverse().map((t) => (
            <TakeRow key={t.n} t={t} onRename={async (label) => {
              await post({ action: "label", file: p.file, n: t.n, label }).catch((e: Error) => setNotice({ ok: false, text: e.message }));
              await reload();
            }} source={`${board.services.find((s) => s.id === t.service)?.label ?? t.service} · ${t.model}${t.kind === "lipsync" ? ` · lip sync, ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` : ""}`} url={takeUrl(t)} onPlay={(url) => {
              play(url, `${p.file} · Take ${t.n}`, { fromS: t.songFromMs !== undefined ? t.songFromMs / 1000 : null, clipInS: t.clipInS ?? 0, why: t.songWhy ?? null });
              if (t.fresh) void singer({ action: "seen", n: t.n }).then(reload).catch(() => undefined);
            }} onSend={() => void send(t.n, t.label ?? `Take ${t.n}`)} onUse={() => void chooseTake(t)} shot={shot && useShot ? { number: shot.number, used: !!(t.sent && shot.filled && t.sent.toLowerCase() === shot.filled.toLowerCase()), use: () => useShot(t.n) } : undefined} onRemove={p.cleanable.includes(t.n) ? () => void cleanUp(t.n) : undefined} onResume={() => void post({ action: "resume", file: p.file, n: t.n }).then(reload).catch((e: Error) => setNotice({ ok: false, text: e.message }))} />
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

function TakeRow({ t, source, url, onPlay, onRename, onSend, onUse, onRemove, onResume, shot }: { t: Take & { inUse?: boolean; onLines?: string }; source: string; url: string | null; onPlay: (url: string) => void; onRename: (label: string) => Promise<void>; onSend: () => void; onUse: () => void; onRemove?: () => void; onResume: () => void; shot?: { number: number; used: boolean; use: () => void } }) {
  const label = `Take ${t.n}`;
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
      <span className="min-w-0 flex-1">
        <NameField id={`take-${t.n}`} name={t.label ?? null} file={label} className="inline-flex max-w-full font-bold" onSave={onRename} />{" "}
        <span data-take-source className="text-muted-foreground">
          {source}
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
