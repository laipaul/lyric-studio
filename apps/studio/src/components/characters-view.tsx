"use client";

import { ArrowLeft, Crop, ImagePlus, Lock, Plus, RefreshCw, RotateCcw, Square, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CardSummary } from "@lyric/video/characters";

import type { CardDetail } from "@/app/api/cards/[id]/route";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FeatureIcon } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await api(url, { cache: "no-store", ...init });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
  return d;
}
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const fileUrl = (id: string, rel: string, stamp?: string | number) => `/api/cards/${id}/file/${rel.split("/").map(encodeURIComponent).join("/")}${stamp ? `?t=${encodeURIComponent(String(stamp))}` : ""}`;
const money = (usd: number) => `$${usd.toFixed(2)}`;
const KIND_LABEL = { character: "character", scene: "scene card" } as const;

function StatusChip({ status, version }: { status: string; version: number }) {
  return (
    <span data-card-status={status} className={cn("rounded-full border px-2 py-0.5 text-[11px]", status === "locked" ? "border-emerald-400/40 text-emerald-300" : "text-muted-foreground")}>
      {status === "locked" ? <Lock className="mr-1 inline size-3" /> : null}
      {status === "locked" ? "Locked" : "Draft"} v{version}
    </span>
  );
}

// ---------------------------------------------------------------- the list

export function CharactersList() {
  const router = useRouter();
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<"character" | "scene" | null>(null);
  const [dropped, setDropped] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState<"character" | "scene" | null>(null);
  useEffect(() => {
    call<{ cards: CardSummary[] }>("/api/cards")
      .then((d) => setCards(d.cards))
      .catch((e: Error) => setError(e.message));
  }, []);

  const section = (kind: "character" | "scene", title: string, hint: string) => (
    <section className="flex flex-col gap-3" data-cards-section={kind}>
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        <li>
          {/* Click to open the dialog, or drop a picture from Explorer straight onto the tile. */}
          <button
            type="button"
            data-new-card={kind}
            onClick={() => (setDropped(null), setCreating(kind))}
            onDragOver={(e) => (e.preventDefault(), setDragOver(kind))}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const f = e.dataTransfer.files?.[0];
              if (!f) return;
              setDropped(f);
              setCreating(kind);
            }}
            className={cn("hover:border-brand/60 hover:text-foreground text-muted-foreground flex size-full min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center transition-colors", dragOver === kind && "border-brand bg-brand/10 text-foreground")}
          >
            <span className="border-brand/50 text-brand flex size-12 items-center justify-center rounded-full border">
              <Plus className="size-6" />
            </span>
            <span className="text-sm font-medium">New {KIND_LABEL[kind]}</span>
            <span className="text-xs">Drop a picture here, or click to choose one</span>
          </button>
        </li>
        {(cards ?? [])
          .filter((c) => c.kind === kind)
          .map((c) => (
            <li key={c.id}>
              <Link href={`/characters/${c.id}`} data-card={c.name} className="hover:border-brand/60 bg-card flex flex-col overflow-hidden rounded-xl border transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element -- a card's own picture */}
                <img src={fileUrl(c.id, c.thumbnail, new Date(c.updated_at).getTime())} alt="" className="aspect-[3/4] w-full object-cover" />
                <div className="flex items-center justify-between gap-2 p-3">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <StatusChip status={c.status} version={c.version} />
                </div>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <div>
        <h1 className="font-display text-brand flex items-center gap-2 text-xl tracking-[0.14em] uppercase">
          <FeatureIcon feature="character" className="size-5" /> Characters
        </h1>
        <p className="text-muted-foreground text-sm">One picture in, a locked pack out: the same face and outfit (or the same place) in every shot. Each card lives in a folder of your workspace.</p>
      </div>
      {error ? <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">{error}</p> : null}
      {!cards ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {cards ? section("character", "Characters", "A face view close-up, a 3/4 face, and the full body front and back (cropped at the neck, so faces only come from the close-up).") : null}
      {cards ? section("scene", "Scene cards", "A place from one picture: three more angles of the same room or location, its key props kept.") : null}
      <NewCardDialog key={`${creating}-${dropped?.name ?? ""}`} kind={creating} initialFile={dropped} onClose={() => (setCreating(null), setDropped(null))} onCreated={(id) => router.push(`/characters/${id}`)} />
    </div>
  );
}

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");

function NewCardDialog({ kind, initialFile, onClose, onCreated }: { kind: "character" | "scene" | null; initialFile: File | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [file, setFileState] = useState<File | null>(initialFile);
  const [name, setName] = useState(initialFile ? baseName(initialFile) : "");
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const setFile = (f: File | null) => {
    setFileState(f);
    if (f && !name.trim()) setName(baseName(f));
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!kind || !file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("name", name || baseName(file));
      form.set("picture", file);
      const d = await call<{ id: string }>("/api/cards", { method: "POST", body: form });
      onCreated(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-new-card-dialog>
        <DialogHeader>
          <DialogTitle>New {kind ? KIND_LABEL[kind] : ""}</DialogTitle>
          <DialogDescription>{kind === "scene" ? "One picture of the place." : "One clear picture of the face (front or 3/4, the mouth visible)."} It is checked at once, on this PC, for free.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input data-card-name placeholder={kind === "scene" ? "e.g. bridal room" : "e.g. bride"} value={name} onChange={(e) => setName(e.target.value)} />
          {/* The picture: a drop area (click to choose, or drop from Explorer), with a preview once chosen. */}
          <label
            data-card-drop
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className={cn("hover:border-brand/60 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 transition-colors", over && "border-brand bg-brand/10")}
          >
            {file && preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen picture
              <img src={preview} alt="" className="size-20 rounded-md object-cover" data-card-preview />
            ) : (
              <span className="border-brand/50 text-brand flex size-20 shrink-0 items-center justify-center rounded-md border border-dashed">
                <ImagePlus className="size-7" />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span className="font-medium">{file ? file.name : "Drop the picture here, or click to choose"}</span>
              <span className="text-muted-foreground text-xs">{file ? "Click to choose another" : "JPG, PNG or WebP"}</span>
            </span>
            <input data-card-picture type="file" accept=".jpg,.jpeg,.png,.webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {busy ? <p className="text-muted-foreground text-xs">Checking the picture… The first time, the face checks install themselves (about a minute).</p> : null}
          {error ? <p className="text-xs text-red-300" data-card-error>{error}</p> : null}
          <Button data-create-card disabled={!file || busy} onClick={create}>
            {busy ? "Checking…" : "Create and check"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- one card

const LIGHT: Record<string, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-red-400", grey: "bg-zinc-400" };
const ACTIVE = new Set(["queued", "running"]);

export function CardPage({ id }: { id: string }) {
  const [d, setD] = useState<CardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cap, setCap] = useState(3);
  const [confirm, setConfirm] = useState<"pack" | "lock" | null>(null);
  const load = useCallback(() => call<CardDetail>(`/api/cards/${id}`).then(setD).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const running = d?.jobs.find((j) => ACTIVE.has(j.status)) ?? null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  const act = async (what: string, body: Record<string, unknown>) => {
    setBusy(what);
    setError(null);
    try {
      setD(await call<CardDetail>(`/api/cards/${id}`, { method: "POST", ...json(body) }));
      setConfirm(null);
      if (["pack", "remake", "fetch"].includes(String(body.action))) window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setD(await call<CardDetail>(`/api/cards/${id}`, { method: "PATCH", ...json(body) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const second = useRef<HTMLInputElement>(null);
  const addSecond = async (file: File) => {
    setBusy("second");
    setError(null);
    try {
      const form = new FormData();
      form.set("picture", file);
      await call(`/api/cards/${id}/picture`, { method: "POST", body: form });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!d) return <div className="p-6 text-sm">{error ? <p className="text-red-300">{error}</p> : "Loading…"}</div>;
  const { card, file, version, report } = d;
  const draft = version.status === "draft";
  const character = card.kind === "character";
  const stamp = report?.updated_at ?? String(card.updated_at);
  const items = report?.items ?? [];
  const missing = items.some((i) => i.tries.some((t) => !t.file && t.request_id && /not downloaded/.test(t.text)));
  const order = character ? ["closeup", "three_quarter", "body_front", "body_back"] : ["wide_left", "wide_right", "detail"];
  const labels: Record<string, string> = { closeup: "Close-up face", three_quarter: "3/4 face", body_front: "Full body, front", body_back: "Full body, back", wide_left: "Wide, from the left", wide_right: "Wide, from the right", detail: "Closer detail" };
  const check = file.check;
  const lastJob = d.jobs[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-card-page={card.name}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/characters" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> Characters
        </Link>
        <h1 className="text-xl font-medium">{card.name}</h1>
        <span className="text-muted-foreground text-sm">{KIND_LABEL[card.kind]}</span>
        <StatusChip status={version.status} version={version.n} />
        {file.versions.length > 1 ? <span className="text-muted-foreground text-xs">{file.versions.map((v) => `v${v.n} ${v.status}`).join(" · ")}</span> : null}
      </div>
      {error ? <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100" data-card-error>{error}</p> : null}

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* The picture and its check */}
        <section className="flex flex-col gap-3" data-card-reference>
          {/* eslint-disable-next-line @next/next/no-img-element -- the card's own picture */}
          <img src={fileUrl(card.id, file.reference, card.updated_at.toString())} alt="" className="w-full rounded-lg border" />
          {check ? (
            <div className="flex flex-col gap-1 text-xs" data-check-verdict={check.verdict}>
              <p className="text-sm font-medium">
                {character ? "Reference check" : "Location check"}: {check.verdict}
              </p>
              <ul className="flex flex-col gap-0.5">
                {check.reasons.map((r, k) => (
                  <li key={k} className={cn(r.level === "bad" ? "text-red-300" : r.level === "fix" ? "text-amber-200" : r.level === "info" ? "text-muted-foreground" : "")}>
                    {r.level === "ok" ? "✓" : r.level === "info" ? "·" : r.level === "fix" ? "!" : "✗"} {r.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Not checked yet.</p>
          )}
          {draft ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("check", { action: "check" })} data-check-again>
                <RefreshCw /> Check again
              </Button>
              {character ? (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("crop", { action: "crop" })} data-crop>
                  <Crop /> Crop to face
                </Button>
              ) : null}
              {character ? (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => second.current?.click()} data-second-picture>
                    <ImagePlus /> {file.reference2 ? "Replace second picture" : "Add a second picture"}
                  </Button>
                  <input ref={second} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => e.target.files?.[0] && addSecond(e.target.files[0])} data-second-input />
                </>
              ) : null}
            </div>
          ) : null}
          {file.check2 ? <p className="text-muted-foreground text-xs">Second picture: {file.check2.verdict}</p> : null}
          {character ? <Calibration d={d} disabled={!!running || !!busy} onStart={(songId, her) => act("calibrate", { action: "calibrate", songId, her })} /> : null}
          {busy && ["check", "crop", "second"].includes(busy) ? <p className="text-muted-foreground text-xs">Checking…</p> : null}
        </section>

        <div className="flex flex-col gap-6">
          {/* Outfit or key props, and the model */}
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="card-words">
              {character ? "Outfit, in your words" : "Key props that must not change"}
            </label>
            <p className="text-muted-foreground text-xs">
              {character ? "Your picture shows only part of it: without this, each model invents the rest. The app splits it into what the close-ups, the front and the back show." : "Small details drift between angles: name the things that must stay (e.g. gilded floor mirror, velvet armchair)."}
            </p>
            <textarea
              id="card-words"
              data-card-words
              key={`${version.n}-${character ? version.outfit : version.props}`}
              defaultValue={(character ? version.outfit : version.props) ?? ""}
              disabled={!draft}
              rows={2}
              onBlur={(e) => save(character ? { outfit: e.target.value } : { props: e.target.value })}
              className="bg-background rounded-md border px-3 py-2 text-sm"
              placeholder={character ? "e.g. floor-length white A-line bridal gown, short sleeves, round neckline, long sheer veil" : "e.g. gilded floor mirror, velvet armchair, white veil draped on the chair"}
            />
            {character && version.outfit_split && version.outfit_split.from.trim() === (version.outfit ?? "").trim() ? (
              <div className="flex flex-col gap-2" data-outfit-split>
                <p className="text-muted-foreground text-xs">Split from your outfit by the app; correct it if a detail is on the wrong side.</p>
                {(
                  [
                    ["closeups", "Close-ups show", "data-outfit-closeups"],
                    ["front", "Front shows", "data-outfit-front"],
                    ["back", "Back shows", "data-outfit-back"],
                  ] as const
                ).map(([k, label, attr]) => (
                  <label key={k} className="flex flex-col gap-1 text-xs">
                    {label}
                    <textarea
                      {...{ [attr]: "" }}
                      key={`${version.n}-${k}-${version.outfit_split![k]}`}
                      defaultValue={version.outfit_split![k]}
                      disabled={!draft}
                      rows={2}
                      onBlur={(e) => e.target.value.trim() !== version.outfit_split![k] && save({ outfit_split: { [k]: e.target.value } })}
                      className="bg-background rounded-md border px-3 py-2 text-sm"
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {d.message ? (
              <p className="text-amber-400 text-xs" data-outfit-message>
                {d.message}
              </p>
            ) : null}
          </section>

          {/* The pack */}
          <section className="flex flex-col gap-3" data-card-pack>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">{character ? "Pack" : "Angles"}</h2>
                <p className="text-muted-foreground text-xs">
                  {d.estimate.text}: about <span data-estimate>{money(d.estimate.usd)}</span>
                  {character ? `. Face views are checked against your picture (green ≥ ${d.thresholds.green_from}); a drifted view is made again, within the cap.` : "."}
                </p>
              </div>
              {draft ? (
                <div className="flex items-center gap-2">
                  <select data-card-model value={version.model} onChange={(e) => save({ model: e.target.value })} className="bg-background rounded-md border px-2 py-1 text-xs" title="The image model (Seedream 4.5 won the first test)">
                    {d.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <label className="text-muted-foreground flex items-center gap-1 text-xs">
                    cap $
                    <input data-card-cap type="number" min={0} step={0.5} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="bg-background w-14 rounded border px-1 py-0.5" />
                  </label>
                  {confirm === "pack" ? (
                    <span className="flex flex-wrap items-center gap-2" data-confirm-pack>
                      {character && !version.outfit?.trim() ? (
                        <span className="text-amber-400 w-full text-xs" data-outfit-warning>
                          No outfit given: the model will invent it (and front and back may not match). Add it above first?
                        </span>
                      ) : null}
                      <Button size="sm" disabled={!!busy} onClick={() => act("pack", { action: "pack", cap })} data-confirm-yes>
                        {character && !version.outfit?.trim() ? "Make it anyway" : "Yes, make it"} (about {money(d.estimate.usd)})
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" disabled={!!running || !!busy} onClick={() => setConfirm("pack")} data-make-pack>
                      <Wand2 /> {items.length ? "Make the pack again" : "Make pack"}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
            {running ? (
              <div className="flex flex-col gap-1 rounded-md border p-3 text-xs" data-card-running>
                <div className="flex items-center justify-between">
                  <span>{running.label}</span>
                  <Button size="sm" variant="ghost" onClick={() => act("stop", { action: "stop", job: running.id })}>
                    <Square /> Stop after this picture
                  </Button>
                </div>
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div className="bg-brand h-full rounded-full transition-[width]" style={{ width: `${Math.round(running.progress * 100)}%` }} />
                </div>
                {running.current ? <span className="text-muted-foreground">{running.current}</span> : null}
              </div>
            ) : lastJob && lastJob.message ? (
              <p className={cn("text-xs", lastJob.status === "failed" ? "text-red-300" : "text-muted-foreground")} data-last-job={lastJob.status}>
                {lastJob.label}: {lastJob.message}
              </p>
            ) : null}
            {missing && draft ? (
              <Button size="sm" variant="outline" className="w-fit" disabled={!!running || !!busy} onClick={() => act("fetch", { action: "fetch" })} data-fetch-missing>
                <RotateCcw /> Get missing pictures (free)
              </Button>
            ) : null}
            <ul className={cn("grid gap-3", character ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3")}>
              {order.map((vid) => {
                const it = items.find((i) => i.id === vid);
                const t = it && it.chosen !== null ? it.tries[it.chosen] : null;
                return (
                  <li key={vid} className="flex flex-col gap-1.5" data-view={vid} data-light={it?.light ?? "none"}>
                    {t ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a generated view
                      <img src={fileUrl(card.id, `v${version.n}/${vid}.png`, stamp)} alt="" className="aspect-[3/4] w-full rounded-md border object-cover" />
                    ) : (
                      <div className="text-muted-foreground flex aspect-[3/4] w-full items-center justify-center rounded-md border border-dashed text-xs">not made yet</div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs">
                      {it?.light ? <span className={cn("size-2 rounded-full", LIGHT[it.light])} /> : null}
                      <span className="font-medium">{labels[vid]}</span>
                      {t?.score !== null && t?.score !== undefined ? <span className="text-muted-foreground tabular-nums">{t.score.toFixed(2)}</span> : null}
                    </div>
                    {it?.text ? <p className="text-muted-foreground text-[11px] leading-snug">{it.text}{it.angle_note ? ` Angle: ${it.angle_note}.` : ""}</p> : null}
                    {draft && items.length ? (
                      <Button size="sm" variant="ghost" className="w-fit" disabled={!!running || !!busy} onClick={() => act("remake", { action: "remake", only: [vid], cap })} data-remake={vid}>
                        <RefreshCw /> Remake
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {items.length ? (
              <a href={fileUrl(card.id, `v${version.n}/sheet.jpg`, stamp)} target="_blank" rel="noreferrer" className="text-muted-foreground w-fit text-xs hover:underline" data-sheet>
                Open the contact sheet
              </a>
            ) : null}
          </section>

          {/* The description */}
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="card-description">
              Description
            </label>
            <p className="text-muted-foreground text-xs">Drafted from your picture when the pack is made; edit it, then lock it with the pictures. It goes into every later prompt for this {KIND_LABEL[card.kind]}.</p>
            <textarea
              id="card-description"
              data-card-description
              key={`${version.n}-${version.description}`}
              defaultValue={version.description ?? ""}
              disabled={!draft}
              rows={4}
              onBlur={(e) => e.target.value !== (version.description ?? "") && save({ description: e.target.value })}
              className="bg-background rounded-md border px-3 py-2 text-sm"
            />
          </section>

          {/* Approve and lock / new version */}
          <section className="flex flex-col gap-2 border-t pt-4" data-card-lock>
            {draft ? (
              <>
                {d.lockProblems.length ? (
                  <ul className="text-muted-foreground text-xs" data-lock-problems>
                    {d.lockProblems.map((p) => (
                      <li key={p}>· {p}</li>
                    ))}
                  </ul>
                ) : null}
                {confirm === "lock" ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    Lock v{version.n}? Its pictures and texts become read-only (a new version can change them later).
                    <Button size="sm" disabled={!!busy} onClick={() => act("lock", { action: "lock" })} data-confirm-lock>
                      <Lock /> Lock v{version.n}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" className="w-fit" disabled={d.lockProblems.length > 0 || !!running || !!busy} onClick={() => setConfirm("lock")} data-lock>
                    <Lock /> Approve and lock
                  </Button>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span data-locked-note>
                  Locked{version.locked_at ? ` on ${new Date(version.locked_at).toLocaleString()}` : ""}: read-only. Scenes and stills will use this version.
                </span>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("new-version", { action: "new-version" })} data-new-version>
                  <Plus /> New version
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// The face-check lines: SFace's defaults until calibrated on a song's clips (local, free; clips of her can be marked).
function Calibration({ d, disabled, onStart }: { d: CardDetail; disabled: boolean; onStart: (songId: string, her: string[]) => void }) {
  const [song, setSong] = useState(d.songs[0]?.id ?? "");
  const [her, setHer] = useState("");
  const t = d.thresholds;
  return (
    <details className="text-xs" data-calibration>
      <summary className="text-muted-foreground cursor-pointer">
        Face-check lines: green ≥ {t.green_from}, red &lt; {t.red_below} <span data-calibration-source>({t.source})</span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-muted-foreground">Compares this face with the other people in a song&apos;s clips, so green means her and not a look-alike. Local and free.</p>
        {d.songs.length ? (
          <>
            <select data-calibration-song value={song} onChange={(e) => setSong(e.target.value)} className="bg-background rounded-md border px-2 py-1">
              {d.songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <Input data-calibration-her placeholder="Clips of her (part of the file name; commas between)" value={her} onChange={(e) => setHer(e.target.value)} />
            <Button size="sm" variant="outline" className="w-fit" disabled={disabled || !song} onClick={() => onStart(song, her.split(","))} data-calibrate>
              Calibrate on these clips
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">No song has clips of its own yet.</p>
        )}
      </div>
    </details>
  );
}
