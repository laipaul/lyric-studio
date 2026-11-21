"use client";

// Prepare → Creation (G2, 21 Nov 2026; first called Pictures): Paul's messy creation space, apart from the Storyboard.
// Everything he makes sits here together, from anywhere: pictures and videos he adds by hand (Midjourney videos too,
// under their own names), files from a link (any outside source), and takes animated here: Animate sends a picture as
// image-to-video to WaveSpeed or Higgsfield (his own key). The app chooses the length, size, motion and sound (none);
// Paul may add a few words of mood. His own defaults (model, takes, cap) apply to every song; each picture can override
// them. The cost shows before sending and a press above the cap is refused. Each item shows where it came from. Paul
// sends his favourites with "Send to Storyboard" (the end of his story line, marked ✓).
import { Check, Film, ImagePlus, Link2, Loader2, Play, RotateCw, Send, Sparkles, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CreationDefaults, PictureView, PicturesView, Quality, ServiceId, Take } from "@lyric/video/animate";

import { NameField } from "@/components/name-field";
import { useGoToTab } from "@/components/song-stages";
import { takeFacts } from "@lyric/video/take-facts";

import { CharacterPicker } from "@/components/character-picker";
import { FramePicker } from "@/components/frame-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;
type Svc = PicturesView["services"][number];
// One dropdown for service and model together ("WaveSpeed · Seedance 2.5 Flash"): value "<service>:<quality>".
const modelOptions = (services: Svc[]) => services.flatMap((s) => s.qualities.map((q) => ({ value: `${s.id}:${q.id}`, label: `${s.label} · ${q.label}${s.ready ? "" : " (no key yet)"}` })));
const splitModel = (v: string) => v.split(":") as [ServiceId, Quality];
const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function PicturesBoard({ projectId }: { projectId: string }) {
  const goTo = useGoToTab();
  const [board, setBoard] = useState<PicturesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [cap, setCap] = useState<string>("");
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null); // a take or video in the big player
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/songs/${projectId}/pictures`);
      const d = (await r.json()) as { board?: PicturesView; error?: string };
      if (!r.ok || !d.board) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setBoard(d.board);
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
  async function add(files: FileList | File[] | null | undefined) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setAdding(true);
    try {
      const form = new FormData();
      for (const f of list) form.append("pictures", f);
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

  return (
    <div data-pictures className="flex flex-col gap-3">
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
      {!defSvc.ready ? (
        <p data-animate-nokey className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">
          No {defSvc.label} key yet: Animate with {defSvc.label} stays off and nothing is sent. Adding your own pictures and videos works without a key. To animate here, add a line <code>{defSvc.keyName}=…</code> with your own key to the file{" "}
          <code>D:\videomaker\.env</code> (not <code>.env.example</code>, which comes from GitHub)
          {defSvc.id === "higgsfield" ? ' (from open.higgsfield.ai, written as "key id:key secret")' : " (from wavespeed.ai → API keys)"}, then restart Lyric Studio. You pay {defSvc.label} directly.
        </p>
      ) : null}
      {notice ? (
        <p data-pictures-notice={notice.ok ? "ok" : "error"} className={cn("rounded-md border p-2 text-sm", notice.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200")}>
          {notice.text}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {board.pictures.map((p) => (
          <PictureTile key={p.file} projectId={projectId} p={p} board={board} post={post} reload={load} setNotice={setNotice} play={(url, title) => setPlaying({ url, title })} />
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
            <DialogDescription>Takes are made without sound: your song is added when the video is made.</DialogDescription>
          </DialogHeader>
          {playing ? <video key={playing.url} src={playing.url} controls autoPlay loop playsInline className="bg-muted max-h-[70vh] w-full rounded object-contain" /> : null}
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
    </div>
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
}: {
  projectId: string;
  p: PictureView;
  board: PicturesView;
  play: (url: string, title: string) => void;
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
        {p.sent ? (
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
      {p.takes.length ? (
        <ul className="flex flex-col gap-1" data-picture-takes-list>
          {[...p.takes].reverse().map((t) => (
            <TakeRow key={t.n} t={t} onRename={async (label) => {
              await post({ action: "label", file: p.file, n: t.n, label }).catch((e: Error) => setNotice({ ok: false, text: e.message }));
              await reload();
            }} source={`${board.services.find((s) => s.id === t.service)?.label ?? t.service} · ${t.model}${t.kind === "lipsync" ? ` · lip sync, ${t.through ? `lines ${t.line}-${t.through}` : `line ${t.line}`}` : ""}`} url={takeUrl(t)} onPlay={(url) => {
              play(url, `${p.file} · Take ${t.n}`);
              if (t.fresh) void singer({ action: "seen", n: t.n }).then(reload).catch(() => undefined);
            }} onSend={() => void send(t.n, t.label ?? `Take ${t.n}`)} onUse={() => void chooseTake(t)} onResume={() => void post({ action: "resume", file: p.file, n: t.n }).then(reload).catch((e: Error) => setNotice({ ok: false, text: e.message }))} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TakeRow({ t, source, url, onPlay, onRename, onSend, onUse, onResume }: { t: Take & { inUse?: boolean }; source: string; url: string | null; onPlay: (url: string) => void; onRename: (label: string) => Promise<void>; onSend: () => void; onUse: () => void; onResume: () => void }) {
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
            <Check className="size-3" /> In use
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
      ) : t.status === "done" ? (
        t.sent ? (
          <span data-take-sent className="flex shrink-0 items-center gap-1 text-emerald-300" title={`In your Storyboard as ${t.sent}`}>
            <Check className="size-3" /> In Storyboard
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
    </li>
  );
}
