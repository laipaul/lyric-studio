"use client";

// Prepare → Pictures (G2, 21 Nov 2026): Paul's picture-first flow. Drop Midjourney pictures, press Animate on one: the
// app sends it as image-to-video to WaveSpeed or Higgsfield (his own key) and makes several takes at once. The app
// chooses the length, size, motion and sound (none); Paul may add a few words of mood. The cost shows before sending
// and a press above the cap is refused. Each finished take goes to the END of the song's clips: he arranges them
// himself (Storyboard, or Shape with the song playing).
import { ImagePlus, Loader2, RotateCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PictureView, PicturesView, Quality, ServiceId, Take } from "@lyric/video/animate";

import { useGoToTab } from "@/components/song-stages";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;
const CAP_KEY = "lyric-studio:animate-cap";
const SERVICE_KEY = "lyric-studio:animate-service";
const readLocal = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    // browser storage off: the choice is not remembered
  }
};

export function PicturesBoard({ projectId }: { projectId: string }) {
  const goTo = useGoToTab();
  const [board, setBoard] = useState<PicturesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cap, setCap] = useState<string>("");
  const [service, setService] = useState<ServiceId>("wavespeed");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the board's data and the remembered choices, read once it is shown
    void load();
    setCap(readLocal(CAP_KEY) ?? "");
    const s = readLocal(SERVICE_KEY);
    if (s === "wavespeed" || s === "higgsfield") setService(s);
  }, [load]);
  // While takes are being made, the board follows them.
  const running = !!board?.pictures.some((p) => p.takes.some((t) => t.status === "running"));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

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
      const skipped = d.skipped?.length ? ` Skipped: ${d.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : "";
      setNotice({ ok: !!d.added?.length, text: `${d.added?.length ?? 0} picture${d.added?.length === 1 ? "" : "s"} added.${skipped}` });
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

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!board) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const capUsd = Number(cap) > 0 ? Number(cap) : board.defaultCap;
  const svc = board.services.find((s) => s.id === service) ?? board.services[0];

  return (
    <div data-pictures className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5">
          Animate with
          <select
            data-animate-service
            value={svc.id}
            onChange={(e) => {
              setService(e.target.value as ServiceId);
              writeLocal(SERVICE_KEY, e.target.value);
            }}
            className="bg-background rounded-md border px-2 py-1"
          >
            {board.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.ready ? "" : " (no key yet)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="An Animate that would cost more than this is refused before anything is sent.">
          Spending cap per Animate $
          <input
            data-animate-cap
            type="number"
            min={1}
            step={1}
            value={cap}
            placeholder={String(board.defaultCap)}
            onChange={(e) => {
              setCap(e.target.value);
              writeLocal(CAP_KEY, e.target.value);
            }}
            className="bg-background w-16 rounded-md border px-2 py-1"
          />
        </label>
        <span className="text-muted-foreground" data-animate-spent>
          Sent for this song so far: about {money(board.spentUsd)}
        </span>
      </div>
      {!svc.ready ? (
        <p data-animate-nokey className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">
          No {svc.label} key yet: Animate stays off and nothing is sent. To use it, add a line <code>{svc.keyName}=…</code> with your own key to the file <code>D:\videomaker\.env</code> (not <code>.env.example</code>, which comes from GitHub)
          {svc.id === "higgsfield" ? ' (from open.higgsfield.ai, written as "key id:key secret")' : " (from wavespeed.ai → API keys)"}, then restart Lyric Studio. You pay {svc.label} directly.
        </p>
      ) : null}
      {notice ? (
        <p data-pictures-notice={notice.ok ? "ok" : "error"} className={cn("rounded-md border p-2 text-sm", notice.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200")}>
          {notice.text}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {board.pictures.map((p) => (
          <PictureTile key={p.file} p={p} svc={svc} capUsd={capUsd} takeSeconds={board.takeSeconds} defaultTakes={board.defaultTakes} maxTakes={board.maxTakes} post={post} reload={load} setNotice={setNotice} />
        ))}
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
          className={cn("flex min-h-48 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm transition-colors", over ? "border-brand bg-brand/10" : "hover:border-brand/60")}
        >
          {adding ? <Loader2 className="text-brand size-6 animate-spin" /> : <ImagePlus className="text-brand size-6" />}
          <span>Drop your pictures here</span>
          <span className="text-muted-foreground text-xs">Midjourney or any .jpg, .png, .webp: no story needed</span>
        </button>
      </div>
      <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,image/*" className="hidden" data-pictures-input onChange={(e) => void add(e.target.files)} />
      {board.pictures.some((p) => p.takes.some((t) => t.status === "done")) ? (
        <p className="text-muted-foreground text-xs">
          Finished takes are at the end of your clips.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => goTo("clips")}>
            Arrange them in Storyboard
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
  p,
  svc,
  capUsd,
  takeSeconds,
  defaultTakes,
  maxTakes,
  post,
  reload,
  setNotice,
}: {
  p: PictureView;
  svc: PicturesView["services"][number];
  capUsd: number;
  takeSeconds: number;
  defaultTakes: number;
  maxTakes: number;
  post: (b: Record<string, unknown>) => Promise<unknown>;
  reload: () => Promise<void>;
  setNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const [mood, setMood] = useState(p.mood);
  const [takes, setTakes] = useState(defaultTakes);
  const [quality, setQuality] = useState<Quality>(svc.qualities[0].id);
  const [busy, setBusy] = useState(false);
  const q = svc.qualities.find((x) => x.id === quality) ?? svc.qualities[0];
  const perTake = Math.round(q.usdPerSecond * takeSeconds * 100) / 100;
  const total = Math.round(perTake * takes * 100) / 100;
  const over = total > capUsd;
  const clipUrl = (clip: string) => `/api/files/${p.url.replace(/pictures\/[^/]+$/, `clips/${clip.split("/").map(encodeURIComponent).join("/")}`)}`;

  async function animate() {
    setBusy(true);
    try {
      if (mood !== p.mood) await post({ action: "mood", file: p.file, mood });
      await post({ action: "animate", file: p.file, service: svc.id, quality: q.id, takes, cap: capUsd });
      setNotice({ ok: true, text: `${p.file}: ${takes} take${takes === 1 ? "" : "s"} sent to ${svc.label} (about ${money(total)}). They join your clips as they finish.` });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-picture={p.file} className="bg-card/40 flex flex-col gap-2 rounded-lg border p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local picture served by /api/files */}
      <img src={`/api/files/${p.url.split("/").map(encodeURIComponent).join("/")}`} alt="" className="bg-muted h-48 w-full rounded object-contain" />
      <span className="truncate text-xs font-medium" title={p.file}>
        {p.file}
      </span>
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
        <select data-picture-takes value={takes} onChange={(e) => setTakes(Number(e.target.value))} className="bg-background rounded-md border px-1.5 py-1" aria-label="Takes">
          {Array.from({ length: maxTakes }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} take{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        {svc.qualities.length > 1 ? (
          <select data-picture-quality value={q.id} onChange={(e) => setQuality(e.target.value as Quality)} className="bg-background rounded-md border px-1.5 py-1" aria-label="Quality">
            {svc.qualities.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id === "standard" ? "Standard" : "Best"}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="button" size="sm" data-picture-animate disabled={busy || !svc.ready || over} onClick={() => void animate()} title={over ? `Above your cap of ${money(capUsd)}` : undefined}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Animate
        </Button>
      </div>
      <span data-picture-cost className={cn("text-[11px]", over ? "text-amber-300" : "text-muted-foreground")} title={`${q.label} · ${q.priceNote}`}>
        {takes} × {takeSeconds} s · about {money(total)}
        {over ? ` · above your cap of ${money(capUsd)}` : ""}
        {/estimate/.test(q.priceNote) ? " (estimate)" : ""}
      </span>
      {p.takes.length ? (
        <ul className="flex flex-col gap-1" data-picture-takes-list>
          {[...p.takes].reverse().map((t) => (
            <TakeRow key={t.n} t={t} clipUrl={clipUrl} onResume={() => void post({ action: "resume", file: p.file, n: t.n }).then(reload).catch((e: Error) => setNotice({ ok: false, text: e.message }))} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TakeRow({ t, clipUrl, onResume }: { t: Take; clipUrl: (clip: string) => string; onResume: () => void }) {
  const label = `Take ${t.n}`;
  return (
    <li data-take={t.n} data-take-status={t.status} className="flex items-center gap-2 text-[11px]">
      {t.status === "done" && t.clip ? (
        <video src={`${clipUrl(t.clip)}#t=0.1`} muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={(e) => e.currentTarget.pause()} className="bg-muted size-10 shrink-0 rounded object-cover" />
      ) : (
        <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded">{t.status === "running" ? <Loader2 className="text-brand size-4 animate-spin" /> : null}</span>
      )}
      <span className="min-w-0 flex-1">
        <b>{label}</b>
        {t.status === "running" ? " · being made…" : t.status === "done" ? <span className="text-emerald-300"> · in your clips</span> : null}
        {t.status === "failed" || t.status === "interrupted" ? <span className={t.status === "failed" ? "text-red-300" : "text-amber-300"}> · {t.error}</span> : null}
      </span>
      {t.status === "interrupted" && t.request_id ? (
        <button type="button" data-take-resume onClick={onResume} className="hover:bg-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5">
          <RotateCw className="size-3" /> Get result
        </button>
      ) : null}
    </li>
  );
}
