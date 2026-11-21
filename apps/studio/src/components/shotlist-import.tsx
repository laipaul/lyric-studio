"use client";

// Prepare → Storyboard → Import shot list (C2): choose (or drop) a shot list file, see the check in plain words
// (what is wrong, slot by slot; what changes), then import. Nothing is spent: no fal.ai calls happen here.
import { FileJson } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ShotListCheck } from "@lyric/video/shotlist";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const SHOTLIST_EXAMPLE = `{
  "slots": [
    { "id": "s01", "order": 1, "shows": "She walks along the path toward the sea, looking back over her shoulder",
      "characters": ["Bride No 2"], "scene": "Beach path", "shot": "wide", "line": 1, "tag": "intro" },
    { "id": "s02", "order": 2, "shows": "He waits at the end of the path, nervous smile",
      "characters": ["Bridegroom"], "scene": "Beach path", "shot": "close-up", "line": 3, "outfit": "jacket open" }
  ]
}
`;

const changes = (c: ShotListCheck["changes"]) =>
  [c.added.length ? `${c.added.length} new` : "", c.updated.length ? `${c.updated.length} changed` : "", c.removed.length ? `${c.removed.length} taken out (${c.removed.join(", ")})` : "", c.unchanged.length ? `${c.unchanged.length} unchanged` : ""].filter(Boolean).join(" · ");

// `preset`: a shot list pasted elsewhere (Prepare → Production → Paste Claude's answer), checked as soon as the dialog opens.
export function ShotListImport({ projectId, open, onOpenChange, onImported, preset }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void; onImported: (text: string) => void; preset?: { name: string; text: string } | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [check, setCheck] = useState<ShotListCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [example, setExample] = useState(false);

  useEffect(() => {
    if (!open || !preset) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a pasted shot list is checked once the dialog opens with it
    setFile(preset);
    setCheck(null);
    void post(preset.text, preset.name, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset]);

  function reset() {
    setFile(null);
    setCheck(null);
    setError(null);
    setExample(false);
  }

  async function post(text: string, name: string, doImport: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/api/songs/${projectId}/shotlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source: name, import: doImport }) });
      const d = (await r.json()) as { check?: ShotListCheck; error?: string };
      if (!r.ok || d.error || !d.check) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setCheck(d.check);
      if (doImport) {
        onImported(`Shot list imported: ${changes(d.check.changes) || "nothing changed"}. The slots are in your story line; their pictures are made later.`);
        reset();
        onOpenChange(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setFile({ name: f.name, text });
    setCheck(null);
    await post(text, f.name, false);
  }

  const errors = check?.problems.filter((p) => p.level === "error") ?? [];
  const warnings = check?.problems.filter((p) => p.level === "warn") ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-shotlist-dialog>
        <DialogHeader>
          <DialogTitle>Import shot list</DialogTitle>
          <DialogDescription>
            Your shot list (a .json file) becomes planned slots in your story line. Each slot&apos;s picture is made later from its characters and scene; until then the videos stay as they are. Nothing is spent here.
          </DialogDescription>
        </DialogHeader>
        <button
          type="button"
          data-shotlist-drop
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void choose(e.dataTransfer.files[0]);
          }}
          className={cn("flex flex-col items-center gap-1 rounded-lg border border-dashed p-5 text-sm transition-colors", over ? "border-brand bg-brand/10" : "hover:border-brand/60")}
        >
          <FileJson className="text-brand size-6" />
          {file ? <span data-shotlist-file className="font-medium">{file.name}</span> : <span>Drop the shot list here, or click to choose it</span>}
          <span className="text-muted-foreground text-xs">{file ? "Click to choose another file" : ".json"}</span>
        </button>
        <input ref={input} type="file" accept=".json,application/json" className="hidden" data-shotlist-input onChange={(e) => void choose(e.target.files?.[0])} />
        {busy && !check ? <p className="text-muted-foreground text-xs">Checking…</p> : null}
        {error ? (
          <p data-shotlist-error className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {check ? (
          <div data-shotlist-check={check.ok ? "ok" : "errors"} className="flex flex-col gap-2 text-sm">
            <p data-shotlist-summary className="font-medium">
              {check.ok ? `${check.slots.length} slot${check.slots.length === 1 ? "" : "s"} ready` : `${errors.length} thing${errors.length === 1 ? "" : "s"} to fix before importing`}
              {check.ok && changes(check.changes) ? <span className="text-muted-foreground font-normal"> · {changes(check.changes)}</span> : null}
            </p>
            {[...errors, ...warnings].length ? (
              <ul className="flex flex-col gap-1">
                {[...errors, ...warnings].map((p, i) => (
                  <li key={i} data-shotlist-problem={p.level} className={cn("text-xs", p.level === "error" ? "text-destructive" : "text-amber-400")}>
                    {p.level === "error" ? "✗" : "!"} {p.slot ? <b>{p.slot}: </b> : null}
                    {p.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {check.ok ? (
              <ol className="text-muted-foreground flex flex-col gap-0.5 text-xs" data-shotlist-slots>
                {check.slots.map((s) => (
                  <li key={s.id}>
                    <b className="text-foreground">{s.id}</b> · {s.shot} · {s.shows}
                    {s.characters.length ? ` · ${s.characters.join(", ")}` : ""}
                    {s.scene ? ` · ${s.scene}` : ""}
                    {s.line !== null ? ` · line ${s.line}` : ""}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" data-shotlist-example-toggle onClick={() => setExample((x) => !x)} className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
            {example ? "Hide the example" : "Show an example shot list"}
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!file || !check?.ok || busy} data-shotlist-import onClick={() => file && void post(file.text, file.name, true)}>
              Import{check?.ok ? ` ${check.slots.length} slot${check.slots.length === 1 ? "" : "s"}` : ""}
            </Button>
          </div>
        </div>
        {example ? (
          <div className="flex flex-col gap-1">
            <pre data-shotlist-example className="bg-muted overflow-x-auto rounded p-2 text-[11px] leading-snug">
              {SHOTLIST_EXAMPLE}
            </pre>
            <p className="text-muted-foreground text-xs">
              shot: close-up, medium, wide, detail or motion · line: the line number as in the Lyrics tab · order: the place in your story line (1 = first) · outfit, tag, animate: optional.
              Characters and scene are your card names on the Characters page.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
