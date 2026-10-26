"use client";

import { FolderInput } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Preview = { lines: string[]; problems: string[]; reminder: string };

// Songs made before song folders: "Preview" shows what "pnpm songs:migrate" would move (nothing
// changes); "Migrate" moves them (as "pnpm songs:migrate --apply"), after the backup reminder.
export function MigrationBanner({ songs, collections }: { songs: number; collections: number }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const what = [songs ? `${songs} song${songs === 1 ? "" : "s"}` : "", collections ? `${collections} collection${collections === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");

  async function load(): Promise<Preview> {
    const r = await fetch("/api/migrate", { cache: "no-store" });
    return (await r.json()) as Preview;
  }

  async function migrate() {
    setBusy(true);
    setMessage(null);
    try {
      const p = await load();
      if (p.problems.length) throw new Error(`Cannot migrate now: ${p.problems.join("; ")}`);
      if (!window.confirm(p.reminder.replace(/ \(y\/n\)$/, "?"))) return;
      const r = await fetch("/api/migrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const result = (await r.json()) as { error?: string; songs?: number; collections?: number; backupDir?: string };
      if (!r.ok || result.error) throw new Error(result.error ?? `The studio answered ${r.status}`);
      setMessage({ ok: true, text: `Moved ${result.songs} song(s) and ${result.collections} collection(s). Backup: ${result.backupDir}. To undo: pnpm songs:migrate --undo` });
      setPreview(null);
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!songs && !collections) {
    return message ? (
      <p role="status" className="border-brand/30 bg-brand/10 rounded-md border px-4 py-2 text-sm">
        {message.text}
      </p>
    ) : null;
  }
  return (
    <section data-migration className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-amber-100">
          <FolderInput className="size-4 shrink-0" />
          {what} still use{songs + collections === 1 ? "s" : ""} the old folders. Move them into one folder per song (songs\&lt;artist&gt;\&lt;title&gt;\) and collections\?
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => setPreview(await load())}>
            Preview
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={migrate}>
            {busy ? "Moving…" : "Migrate"}
          </Button>
        </div>
      </div>
      {message ? <p className={message.ok ? "text-emerald-200" : "text-red-300"}>{message.text}</p> : null}
      <Dialog open={!!preview} onOpenChange={(o) => (o ? null : setPreview(null))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>What would move (nothing has changed yet)</DialogTitle>
          </DialogHeader>
          <pre data-migration-preview className="bg-background/60 max-h-[60vh] overflow-auto rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {preview?.lines.join("\n")}
          </pre>
          <p className="text-muted-foreground text-xs">Nothing is deleted: files are moved, the database follows, and old videos still re-render. A backup of the database comes first.</p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
