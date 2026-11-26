"use client";

import { ArrowLeft, Copy, Crop, Download, Film, ImagePlus, Lock, Plus, RefreshCw, RotateCcw, Square, Trash2, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CardSummary, RemovedCard } from "@lyric/video/characters";

import type { CardDetail } from "@/app/api/cards/[id]/route";
import { Button } from "@/components/ui/button";
import { FramePicker } from "@/components/frame-picker";
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
// The extra views of a character card (plan.ts EXTRA_VIEWS), each made only when asked.
const EXTRAS = [
  { id: "profile", label: "Side profile", make: "Make the side profile", why: "A true side view of the face, for the Character sheet: video models invent what they never saw." },
  { id: "body_full", label: "Full body with face", make: "Make the full body with face", why: "The whole person from head to toe, face included, for the Character sheet." },
  { id: "closeup_teeth", label: "Teeth close-up", make: "Make the teeth close-up", why: "For a character who sings or speaks: a smile with the teeth visible, so the video keeps the same teeth in every shot." },
] as const;

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
  const [removed, setRemoved] = useState<RemovedCard[]>([]);
  const reload = useCallback(
    () =>
      call<{ cards: CardSummary[]; removed: RemovedCard[] }>("/api/cards")
        .then((d) => (setCards(d.cards), setRemoved(d.removed ?? [])))
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const restore = async (folder: string) => {
    setError(null);
    try {
      await call("/api/cards", { method: "POST", ...json({ restore: folder }) });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
                  <span className="flex items-center gap-1">
                    <StatusChip status={c.status} version={c.version} />
                    {c.draft ? <span className="text-muted-foreground text-[11px]" data-card-draft={c.draft}>v{c.draft} draft</span> : null}
                  </span>
                </div>
                {c.looks.length ? (
                  <div className="flex flex-wrap gap-1 px-3 pb-3" data-card-looks>
                    {c.looks.map((l) => (
                      <span key={l} className="text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]">
                        {l}
                      </span>
                    ))}
                  </div>
                ) : null}
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
      {removed.length ? (
        // Removed cards (Remove card on a card's page): kept in characters\_removed\ or scenes\_removed\, with Restore.
        <details className="text-xs" data-removed-cards>
          <summary className="text-muted-foreground cursor-pointer">Removed cards ({removed.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {removed.map((r) => (
              <li key={r.folder} className="flex items-center gap-2" data-removed-card={r.name}>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">
                  {KIND_LABEL[r.kind]}, removed {r.at ? new Date(r.at).toLocaleString() : ""} · kept in {r.folder.replace(/\//g, "\\")}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void restore(r.folder)} data-restore-card={r.name}>
                  <RotateCcw /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
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
  const [frames, setFrames] = useState(false);
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
          {kind === "character" ? (
            <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={busy} onClick={() => setFrames(true)} data-card-from-video>
              <Film /> Or pick a frame from a video
            </Button>
          ) : null}
          <FramePicker open={frames} onOpenChange={setFrames} onPick={(f) => setFile(f)} use="Use as the picture" />
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
  const [copied, setCopied] = useState(false);
  const [copyWarnings, setCopyWarnings] = useState<string[]>([]);
  // Copy character for Claude (26 Nov 2026): the character-lock block on the clipboard; no API call.
  const copyForClaude = async () => {
    try {
      const { block, warnings } = await call<{ block: string; warnings: string[] }>(`/api/cards/${id}`, { method: "POST", ...json({ action: "claude" }) });
      setCopyWarnings(warnings ?? []); // copied all the same: the warnings say what would make the prompts better
      try {
        await navigator.clipboard.writeText(block);
      } catch {
        const t = document.createElement("textarea");
        t.value = block;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // The version shown: null = the newest; a number = an older, read-only version.
  const [viewN, setViewN] = useState<number | null>(null);
  const load = useCallback(() => call<CardDetail>(`/api/cards/${id}${viewN ? `?v=${viewN}` : ""}`).then(setD).catch((e: Error) => setError(e.message)), [id, viewN]);
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
      setViewN(null);
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
  const [frames, setFrames] = useState(false);
  // Your own pictures into the pack (free): "Add my pack" (several, sorted into their places) or one place.
  const ownInput = useRef<HTMLInputElement>(null);
  const [ownSlot, setOwnSlot] = useState<string | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [descNote, setDescNote] = useState<string | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacePicture = async (f: File) => {
    setBusy("replace");
    setError(null);
    try {
      const form = new FormData();
      form.set("picture", f);
      form.set("replace", "reference");
      const r = await call<{ checkError?: string }>(`/api/cards/${id}/picture`, { method: "POST", body: form });
      if (r.checkError) setError(r.checkError);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const removeThisCard = async () => {
    setBusy("remove");
    setError(null);
    try {
      await call(`/api/cards/${id}`, { method: "POST", ...json({ action: "remove" }) });
      router.push("/characters");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  const chooseOwn = (slot: string | null) => {
    setOwnSlot(slot);
    if (ownInput.current) {
      ownInput.current.multiple = !slot;
      ownInput.current.value = "";
      ownInput.current.click();
    }
  };
  const addOwn = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("own");
    setError(null);
    setOwnError(null);
    setPackNote(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("picture", f);
      if (ownSlot) form.set("slot", ownSlot);
      const r = await call<{ summary: string }>(`/api/cards/${id}/own`, { method: "POST", body: form });
      setPackNote(r.summary);
      await load();
    } catch (e) {
      setOwnError((e as Error).message); // next to Add my pack, where Paul looks (26 Nov 2026)
    } finally {
      setBusy(null);
    }
  };
  const quiet = async (what: string, body: Record<string, unknown>, note: (m: string | null) => void) => {
    setBusy(what);
    setError(null);
    try {
      const r = await call<CardDetail>(`/api/cards/${id}`, { method: "POST", ...json(body) });
      note(r.message);
      setD({ ...r, message: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
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
        {file.versions.length > 1 ? (
          <span className="flex flex-wrap items-center gap-1 text-xs" data-card-versions>
            {file.versions.map((v) => (
              <button
                key={v.n}
                type="button"
                data-card-version={v.n}
                data-active={v.n === version.n ? "" : undefined}
                onClick={() => setViewN(v.n === d.latest ? null : v.n)}
                className={cn("rounded-full border px-2 py-0.5", v.n === version.n ? "border-brand/60 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                v{v.n} {v.status === "locked" ? (v.n === d.inUse ? "locked · in use" : "locked") : "draft"}
              </button>
            ))}
          </span>
        ) : null}
        {/* Remove card (cleanup.ts): the whole card to characters\_removed\ (or scenes\_removed\), Restore on the list page. */}
        <span className="ml-auto flex items-center gap-1 text-xs">
          {/* Cast Library (26 Nov 2026): the character-lock block for claude.ai (no API call). */}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void copyForClaude()} data-copy-claude title="A compact character-lock text (name, notes, looks, outfits, which reference pictures exist) to paste into claude.ai when writing shot prompts">
            <Copy /> {copied ? "Copied" : "Copy character for Claude"}
          </Button>
          {removing ? (
            <>
              <span className="text-muted-foreground" data-remove-note>
                Remove {card.name}? It is kept, with Restore on the Characters page; songs and shot lists will not find it until then.
              </span>
              <Button size="sm" variant="destructive" disabled={!!busy || !!running} onClick={() => void removeThisCard()} data-remove-yes>
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!!busy || !!running} onClick={() => setRemoving(true)} data-remove-card>
              <Trash2 /> Remove card
            </Button>
          )}
        </span>
      </div>
      {copyWarnings.length ? (
        <ul data-copy-warnings className="rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
          <li className="font-medium">Copied, but:</li>
          {copyWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <label className="flex flex-col gap-1 text-xs" title="Your own words: look, outfit, vibe, age range. They go into Copy character for Claude.">
        <span className="font-medium">Notes</span>
        <textarea
          data-card-notes
          defaultValue={file.notes ?? ""}
          key={`notes-${file.notes ?? ""}`}
          onBlur={(e) => e.target.value.trim() !== (file.notes ?? "") && void act("notes", { action: "notes", notes: e.target.value })}
          placeholder="Look, outfit, vibe, age range… (your own words, e.g. late 20s, warm and shy, classic and soft)"
          rows={2}
          className="bg-background rounded-md border px-2 py-1.5 text-sm"
        />
      </label>
      {version.n !== d.latest ? (
        <p className="text-muted-foreground rounded-md border px-4 py-2 text-xs" data-old-version>
          You are looking at v{version.n} (read-only{version.n === d.inUse ? ", still in use until v" + d.latest + " is locked" : ""}).{" "}
          <button type="button" className="text-foreground underline" onClick={() => setViewN(null)}>
            Open v{d.latest}
          </button>
        </p>
      ) : draft && d.inUse ? (
        <p className="text-muted-foreground rounded-md border px-4 py-2 text-xs" data-draft-note>
          v{version.n} is a draft. Scenes, stills and recasts keep using locked v{d.inUse} until you lock v{version.n}.
        </p>
      ) : null}
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
              <Button size="sm" variant="outline" disabled={!!busy || !!running} onClick={() => replaceInput.current?.click()} data-replace-picture title="A new picture for this card; the old one is kept under Earlier pictures">
                <ImagePlus /> Replace picture
              </Button>
              <input ref={replaceInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => (e.target.files?.[0] && void replacePicture(e.target.files[0]), (e.target.value = ""))} data-replace-input />
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
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setFrames(true)} data-second-from-video>
                    <Film /> Second picture from a video
                  </Button>
                  <FramePicker open={frames} onOpenChange={setFrames} onPick={(f) => addSecond(f)} use="Use as the second picture" />
                </>
              ) : null}
            </div>
          ) : null}
          {file.check2 ? <p className="text-muted-foreground text-xs">Second picture: {file.check2.verdict}</p> : null}
          {d.replaced.length && draft ? (
            <details className="text-xs" data-earlier-pictures>
              <summary className="text-muted-foreground cursor-pointer">Earlier pictures ({d.replaced.length})</summary>
              <ul className="mt-2 flex flex-wrap gap-2">
                {d.replaced.map((r) => (
                  <li key={r.at} className="flex flex-col items-start gap-1" data-earlier-picture={r.at}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- an earlier picture of this card */}
                    <img src={fileUrl(card.id, r.rel)} alt="" className="h-24 rounded border object-cover" />
                    <Button size="sm" variant="ghost" disabled={!!busy || !!running} onClick={() => act("reference-restore", { action: "reference-restore", at: r.at })} data-restore-picture>
                      <RotateCcw /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {character ? <Calibration d={d} disabled={!!running || !!busy} onStart={(songId, her) => act("calibrate", { action: "calibrate", songId, her })} /> : null}
          {busy && ["check", "crop", "second", "replace"].includes(busy) ? <p className="text-muted-foreground text-xs">Checking…</p> : null}
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
                  <select data-card-model value={version.model} onChange={(e) => save({ model: e.target.value })} className="bg-background rounded-md border px-2 py-1 text-xs" title="The image model (Seedream 4.5 won the first test; Gemini runs on your own Google key)">
                    {d.models.map((m) => (
                      <option key={m.id} value={m.id} title={m.price}>
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
                    <Button size="sm" disabled={!!running || !!busy || !!d.geminiMissing} onClick={() => setConfirm("pack")} data-make-pack>
                      <Wand2 /> {items.length ? "Make the pack again" : "Make pack"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={!!running || !!busy} onClick={() => chooseOwn(null)} data-own-pack title="Pictures you made elsewhere (Gemini, Midjourney …): free, nothing sent online">
                    <Upload /> {character ? "Add my pack" : "Add my angles"}
                  </Button>
                  <input ref={ownInput} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => void addOwn(e.target.files)} data-own-input />
                  {d.geminiPrompt ? <CopyGemini text={d.geminiPrompt} data="pack" /> : null}
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
            {d.geminiMissing ? (
              <p className="text-xs text-amber-300" data-gemini-missing>
                {d.geminiMissing}
              </p>
            ) : null}
            {busy === "own" ? <p className="text-muted-foreground text-xs">Checking your pictures… (free, on this PC)</p> : null}
            {ownError ? (
              <p className="text-xs text-amber-200" data-own-error>
                {ownError}
              </p>
            ) : null}
            {packNote ? (
              <p className="text-xs text-emerald-200" data-own-note>
                {packNote}
              </p>
            ) : null}
            {character && items.some((i) => i.id === "closeup" && i.chosen !== null) ? (
              // Extra views (25 Nov 2026): each one picture from this card, also on a locked card; they change none of the
              // views above. The side profile and the full body with face complete the Character sheet.
              <div className="flex flex-col gap-2" data-extra-views>
                {EXTRAS.map((x) => {
                  const it = items.find((i) => i.id === x.id);
                  const made = !!it && it.chosen !== null;
                  return (
                    <div key={x.id} data-extra={x.id} data-made={made ? "made" : "none"} {...(x.id === "closeup_teeth" ? { "data-teeth": made ? "made" : "none" } : {})} className="bg-card/40 flex items-center gap-3 rounded-md border p-2 text-xs">
                      {made ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a generated view
                        <img src={fileUrl(card.id, `v${version.n}/${x.id}.png`, stamp)} alt="" className="h-20 rounded border object-cover" />
                      ) : null}
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">
                          {x.label}
                          {made && it?.text ? ` · ${it.text}` : ""}
                        </span>
                        <span className="text-muted-foreground">{x.why}</span>
                        <span className="flex flex-wrap items-center gap-1">
                          <Button size="sm" variant="outline" className="w-fit" disabled={!!running || !!busy} onClick={() => act("remake", { action: "remake", only: [x.id], cap })} {...(x.id === "closeup_teeth" ? { "data-make-teeth": "" } : {})} data-make-extra={x.id}>
                            <RefreshCw /> {made ? "Make it again" : x.make}
                          </Button>
                          <Button size="sm" variant="ghost" className="w-fit" disabled={!!running || !!busy} onClick={() => chooseOwn(x.id)} data-own={x.id} title="Your own picture here: free, nothing sent online">
                            <Upload /> Use my own picture
                          </Button>
                          {made ? (
                            <Button size="sm" variant="ghost" className="text-muted-foreground w-fit" disabled={!!running || !!busy} onClick={() => quiet("aside", { action: "aside", view: x.id }, setPackNote)} data-aside={x.id} title="Take this picture off the card (kept under Put aside, with Restore)">
                              <X /> Remove
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {character && d.characterSheet ? (
              // The Character sheet: the views side by side in one picture (made on this PC, free).
              <div data-character-sheet className="bg-card/40 flex flex-col gap-2 rounded-md border p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Character sheet</span>
                  <span className="text-muted-foreground">{d.characterSheet.panels.join(" · ")}</span>
                  <a href={fileUrl(card.id, d.characterSheet.file, stamp)} download={`${card.name} character sheet.png`} className="hover:bg-accent ml-auto flex items-center gap-1 rounded border px-2 py-0.5" data-character-sheet-save>
                    <Download className="size-3" /> Save
                  </a>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- made from the views */}
                <img src={fileUrl(card.id, d.characterSheet.file, stamp)} alt={`${card.name}: ${d.characterSheet.panels.join(", ")}`} className="max-h-64 w-fit max-w-full rounded border object-contain" />
                <span className="text-muted-foreground">One picture of the same person from several sides, in soft daylight. Make with references sends it; Save it for Midjourney or Higgsfield.</span>
              </div>
            ) : null}
            {character && draft && items.some((i) => i.id === "body_front" || i.id === "body_back") ? (
              <Button size="sm" variant="outline" className="w-fit" disabled={!!running || !!busy} onClick={() => act("remake", { action: "remake", only: ["body_front", "body_back"], cap })} data-remake-body>
                <RefreshCw /> Remake the full-body views (front, then back)
              </Button>
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
                      // The whole picture (26 Nov 2026: a tall full body lost its feet in a 3:4 crop); ✕ puts it aside.
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a generated view */}
                        <img src={fileUrl(card.id, `v${version.n}/${vid}.png`, stamp)} alt="" className="bg-muted/30 aspect-[3/4] w-full rounded-md border object-contain" />
                        {draft ? (
                          <button
                            type="button"
                            disabled={!!running || !!busy}
                            onClick={() => void quiet("aside", { action: "aside", view: vid }, setPackNote)}
                            className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                            title="Take this picture off the card (kept under Put aside, with Restore)"
                            data-aside={vid}
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-muted-foreground flex aspect-[3/4] w-full items-center justify-center rounded-md border border-dashed text-xs">not made yet</div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs">
                      {it?.light ? <span className={cn("size-2 rounded-full", LIGHT[it.light])} /> : null}
                      <span className="font-medium">{labels[vid]}</span>
                      {t?.score !== null && t?.score !== undefined ? <span className="text-muted-foreground tabular-nums">{t.score.toFixed(2)}</span> : null}
                    </div>
                    {it?.text ? <p className="text-muted-foreground text-[11px] leading-snug">{it.text}{it.angle_note ? ` Angle: ${it.angle_note}.` : ""}</p> : null}
                    {draft ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {items.length ? (
                          <Button size="sm" variant="ghost" className="w-fit" disabled={!!running || !!busy} onClick={() => act("remake", { action: "remake", only: [vid], cap })} data-remake={vid}>
                            <RefreshCw /> Remake
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" className="w-fit" disabled={!!running || !!busy} onClick={() => chooseOwn(vid)} data-own={vid}>
                          <Upload /> Use my own picture
                        </Button>
                        {t?.own ? (
                          <select
                            data-own-move={vid}
                            value=""
                            disabled={!!running || !!busy}
                            onChange={(e) => e.target.value && void quiet("move", { action: "own-move", from: vid, to: e.target.value }, setPackNote)}
                            className="bg-background text-muted-foreground rounded border px-1 py-0.5 text-[11px]"
                            title="Your picture is in the wrong place? Move it"
                          >
                            <option value="">Move to…</option>
                            {order
                              .filter((o) => o !== vid)
                              .map((o) => (
                                <option key={o} value={o}>
                                  {labels[o]}
                                </option>
                              ))}
                          </select>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {d.aside.length ? (
              <details className="text-xs" data-aside-list>
                <summary className="text-muted-foreground cursor-pointer">Put aside ({d.aside.length})</summary>
                <ul className="mt-2 flex flex-wrap gap-3">
                  {d.aside.map((a) => (
                    <li key={a.file} className="flex flex-col items-start gap-1" data-aside-picture={a.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a picture put aside */}
                      <img src={fileUrl(card.id, a.rel)} alt="" className="h-28 rounded border object-contain" />
                      <span className="text-muted-foreground">{a.label}</span>
                      <Button size="sm" variant="ghost" disabled={!!running || !!busy || (!draft && !["profile", "body_full", "closeup_teeth"].includes(a.id))} onClick={() => quiet("restore", { action: "aside-restore", file: a.file }, setPackNote)} data-restore-aside={a.id}>
                        <RotateCcw /> Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {items.length ? (
              <a href={fileUrl(card.id, `v${version.n}/sheet.jpg`, stamp)} target="_blank" rel="noreferrer" className="text-muted-foreground w-fit text-xs hover:underline" data-sheet>
                Open the contact sheet
              </a>
            ) : null}
          </section>

          {character && version.n === d.latest ? <Wardrobe d={d} id={card.id} cap={cap} running={!!running} onChanged={setD} reload={load} /> : null}

          {/* The description */}
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="card-description">
              Description
            </label>
            <p className="text-muted-foreground text-xs">Drafted from your picture when the pack is made (with your own pictures: write it, or draft it below); edit it, then lock it with the pictures. It goes into every later prompt for this {KIND_LABEL[card.kind]}.</p>
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
            {draft && !version.description?.trim() ? (
              <Button size="sm" variant="outline" className="w-fit" disabled={!!running || !!busy} onClick={() => void quiet("describe", { action: "describe" }, setDescNote)} data-describe>
                <Wand2 /> {busy === "describe" ? "Drafting…" : "Draft it from the pictures (about $0.01)"}
              </Button>
            ) : null}
            {descNote ? (
              <p className="text-muted-foreground text-xs" data-describe-note>
                {descNote}
              </p>
            ) : null}
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
                  Locked{version.locked_at ? ` on ${new Date(version.locked_at).toLocaleString()}` : ""}: read-only.{" "}
                  {version.n === d.inUse ? "Scenes, stills and recasts use this version." : `Replaced by v${d.inUse}.`}
                  {version.n === d.latest ? " New version starts a draft with the same picture, outfit, description and pictures; remake only what needs it." : ""}
                </span>
                {version.n === d.latest ? (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("new-version", { action: "new-version" })} data-new-version>
                    <Plus /> New version
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the Wardrobe

// One face, many looks: the pack above is the main look; further looks have their own outfit and full body views (and,
// if asked, a close-up in the look), made by the app or from the user's own pictures, each locked on its own. A song
// chooses which look a character wears (Prepare → Production → Cast).
type WardrobeLook = CardDetail["wardrobe"][number];

function Wardrobe({ d, id, cap, running, onChanged, reload }: { d: CardDetail; id: string; cap: number; running: boolean; onChanged: (d: CardDetail) => void; reload: () => Promise<void> | void }) {
  const looks = d.wardrobe;
  const [open, setOpen] = useState<string>(looks.find((l) => !l.main)?.id ?? looks[0]?.id ?? "main");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const look: WardrobeLook | undefined = looks.find((l) => l.id === open) ?? looks[0];
  if (!look) return null;
  const locked = look.status === "locked";
  const stamp = look.report?.updated_at ?? String(d.card.updated_at);

  const post = async (what: string, body: Record<string, unknown>, after?: (r: CardDetail) => void) => {
    setBusy(what);
    setError(null);
    try {
      const r = await call<CardDetail>(`/api/cards/${id}`, { method: "POST", ...json(body) });
      setNote(r.message);
      onChanged({ ...r, message: null });
      after?.(r);
      if (["look-make", "look-remake"].includes(String(body.action))) window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = (body: Record<string, unknown>) => post("save", { action: "look-save", look: look.id, ...body });
  const choose = (s: string | null) => {
    setSlot(s);
    if (input.current) {
      input.current.multiple = !s;
      input.current.value = "";
      input.current.click();
    }
  };
  const addOwn = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("own");
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("picture", f);
      form.set("look", look.id);
      if (slot) form.set("slot", slot);
      setNote((await call<{ summary: string }>(`/api/cards/${id}/own`, { method: "POST", body: form })).summary);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const disabled = running || !!busy;

  return (
    <section className="flex flex-col gap-3 border-t pt-4" data-wardrobe>
      <div>
        <h2 className="text-sm font-medium">Wardrobe</h2>
        <p className="text-muted-foreground text-xs">One face, many looks. The pack above is the main look; add others (a travel coat, an evening dress …). Each song chooses which look a character wears (Prepare → Production → Cast).</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {looks.map((l) => (
          <button
            key={l.id}
            type="button"
            data-look-tab={l.id}
            data-active={l.id === look.id ? "" : undefined}
            onClick={() => (setOpen(l.id), setConfirm(false), setNote(null))}
            className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", l.id === look.id ? "border-brand/60 text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {l.status === "locked" ? <Lock className="size-3" /> : null}
            {l.name}
          </button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void post("add", { action: "look-add", name }, (r) => (setName(""), setOpen(r.wardrobe[r.wardrobe.length - 1].id)));
          }}
        >
          <Input data-look-new-name value={name} onChange={(e) => setName(e.target.value)} placeholder="New look, e.g. Travel coat" className="h-7 w-48 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={disabled || !name.trim()} data-look-add>
            <Plus /> Add look
          </Button>
        </form>
      </div>
      {error ? <p className="text-xs text-amber-200" data-look-error>{error}</p> : null}
      {note ? <p className="text-xs text-emerald-200" data-look-note>{note}</p> : null}

      {look.main ? (
        <div className="flex flex-col gap-2 text-xs" data-look={look.id}>
          <label className="flex items-center gap-2">
            Name
            <Input data-look-name key={look.name} defaultValue={look.name} onBlur={(e) => e.target.value.trim() !== look.name && void save({ name: e.target.value })} className="h-7 w-56 text-xs" />
          </label>
          <p className="text-muted-foreground">Its outfit and pictures are the Pack above (close-up, 3/4 face, full body front and back).</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-look={look.id} data-look-status={look.status}>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              Name
              <Input data-look-name key={`${look.id}-${look.name}`} defaultValue={look.name} onBlur={(e) => e.target.value.trim() !== look.name && void save({ name: e.target.value })} className="h-7 w-48 text-xs" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" data-look-closeup checked={look.closeup} disabled={locked || disabled} onChange={(e) => void save({ closeup: e.target.checked })} />
              Also a close-up in this look (hair, neckline, jewellery)
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            Outfit, in your words
            <textarea
              data-look-outfit
              key={`${look.id}-${look.outfit}`}
              defaultValue={look.outfit ?? ""}
              disabled={locked}
              rows={2}
              onBlur={(e) => e.target.value.trim() !== (look.outfit ?? "") && void save({ outfit: e.target.value })}
              className="bg-background rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. camel wool travel coat over a cream knit dress, ankle boots"
            />
          </label>
          {!locked ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select data-look-model value={look.model} onChange={(e) => void save({ model: e.target.value })} className="bg-background rounded-md border px-2 py-1 text-xs" title="The image model for this look">
                {d.models.map((m) => (
                  <option key={m.id} value={m.id} title={m.price}>
                    {m.name}
                  </option>
                ))}
              </select>
              {look.estimate ? (
                <span className="text-muted-foreground">
                  {look.estimate.text}: about <span data-look-estimate>{money(look.estimate.usd)}</span>
                </span>
              ) : null}
              {confirm ? (
                <span className="flex flex-wrap items-center gap-2">
                  {!look.outfit?.trim() ? <span className="text-amber-400">No outfit given: the model will invent it.</span> : null}
                  <Button size="sm" disabled={disabled} onClick={() => void post("look-make", { action: "look-make", look: look.id, cap }, () => setConfirm(false))} data-look-confirm>
                    Yes, make it (about {money(look.estimate?.usd ?? 0)})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button size="sm" disabled={disabled || !!look.geminiMissing} onClick={() => setConfirm(true)} data-look-make>
                  <Wand2 /> {look.report?.items.length ? "Make the look again" : "Make look"}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => choose(null)} data-look-own title="Pictures you made elsewhere (Gemini, Midjourney …): free, nothing sent online">
                <Upload /> Add my pictures
              </Button>
              <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => void addOwn(e.target.files)} data-look-own-input />
              {look.geminiPrompt ? <CopyGemini text={look.geminiPrompt} data="look" /> : null}
            </div>
          ) : null}
          {look.geminiMissing ? <p className="text-xs text-amber-300">{look.geminiMissing}</p> : null}
          {busy === "own" ? <p className="text-muted-foreground text-xs">Checking your pictures… (free, on this PC)</p> : null}
          <ul className={cn("grid gap-3", look.closeup ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-3")}>
            {look.views.map((v) => {
              const it = look.report?.items.find((i) => i.id === v.id);
              const t = it && it.chosen !== null ? it.tries[it.chosen] : null;
              return (
                <li key={v.id} className="flex flex-col gap-1.5" data-look-view={v.id} data-light={it?.light ?? "none"}>
                  {v.file ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a look's picture
                    <img src={fileUrl(id, v.file, stamp)} alt="" className="aspect-[3/4] w-full rounded-md border object-cover" />
                  ) : (
                    <div className="text-muted-foreground flex aspect-[3/4] w-full items-center justify-center rounded-md border border-dashed text-xs">not made yet</div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs">
                    {it?.light ? <span className={cn("size-2 rounded-full", LIGHT[it.light])} /> : null}
                    <span className="font-medium">{v.label}</span>
                  </div>
                  {it?.text ? <p className="text-muted-foreground text-[11px] leading-snug">{it.text}</p> : null}
                  {!locked ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {look.report?.items.length ? (
                        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void post("look-remake", { action: "look-remake", look: look.id, only: [v.id], cap })} data-look-remake={v.id}>
                          <RefreshCw /> Remake
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => choose(v.id)} data-look-own-slot={v.id}>
                        <Upload /> Use my own picture
                      </Button>
                      {t?.own ? (
                        <select
                          data-look-move={v.id}
                          value=""
                          disabled={disabled}
                          onChange={(e) => e.target.value && void post("move", { action: "own-move", look: look.id, from: v.id, to: e.target.value })}
                          className="bg-background text-muted-foreground rounded border px-1 py-0.5 text-[11px]"
                        >
                          <option value="">Move to…</option>
                          {look.views
                            .filter((o) => o.id !== v.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {look.problems.length && !locked ? <p className="text-muted-foreground text-xs" data-look-problems>· {look.problems.join(" ")}</p> : null}
          {locked ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span data-look-locked>Locked: songs that choose &quot;{look.name}&quot; use these pictures.</span>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => void post("unlock", { action: "look-unlock", look: look.id })} data-look-unlock>
                Change this look
              </Button>
            </div>
          ) : (
            <Button size="sm" className="w-fit" disabled={disabled || look.problems.length > 0} onClick={() => void post("lock", { action: "look-lock", look: look.id })} data-look-lock>
              <Lock /> Lock this look
            </Button>
          )}
        </div>
      )}
    </section>
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

// Copy the Gemini prompt (25 Nov 2026): the app's own words for each view (outdoors in soft daylight, natural skin), for
// the packs Paul makes himself in Gemini; then Add my pack / Add my pictures sorts them into their places.
function CopyGemini({ text, data }: { text: string; data: "pack" | "look" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      title="Copies the prompts the app would send, one per view (outdoors in soft daylight, natural skin): paste them into Gemini with your reference picture, then add the pictures here"
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined)
      }
      {...{ [`data-copy-gemini-${data}`]: "" }}
    >
      <Copy /> {copied ? "Copied" : "Copy the Gemini prompt"}
    </Button>
  );
}
