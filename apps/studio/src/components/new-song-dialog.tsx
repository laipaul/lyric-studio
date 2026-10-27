"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {hint ? <span className="text-muted-foreground font-normal"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const fileInput =
  "file:bg-secondary file:text-secondary-foreground file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-xs text-muted-foreground block w-full cursor-pointer text-xs";

// "+ New song": song + lyrics (required), cover and hints (optional), title, artist, EP.
export function NewSongDialog({ artists, onDone }: { artists: string[]; onDone: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleHint, setTitleHint] = useState("the song's file name");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api("/api/songs", { method: "POST", body: new FormData(event.currentTarget) });
      const result = (await response.json()) as { error?: string; created?: boolean; updated?: string[] };
      if (!response.ok || result.error) throw new Error(result.error ?? `The studio answered ${response.status}`);
      onDone(result.created ? "Song added to your library." : `Already in your library: updated ${result.updated?.join(", ")}.`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New song
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New song</DialogTitle>
          <DialogDescription>The song and its lyrics are stored with the project in your workspace. The same song again only updates it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Song" hint="WAV or MP3">
            <input
              name="song"
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              required
              className={fileInput}
              onChange={(e) => setTitleHint(e.target.files?.[0]?.name.replace(/\.[^.]+$/, "") ?? "the song's file name")}
            />
          </Field>
          <Field label="Lyrics" hint="lyrics.txt, hook lines start with *">
            <input name="lyrics" type="file" accept=".txt,text/plain" required className={fileInput} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Cover" hint="optional">
              <input name="cover" type="file" accept=".jpg,.jpeg,.png,.webp,image/*" className={fileInput} />
            </Field>
            <Field label="Hints" hint="optional, tapped .lrc">
              <input name="hints" type="file" accept=".lrc" className={fileInput} />
            </Field>
          </div>
          <Field label="Title">
            <Input name="title" placeholder={titleHint} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Artist">
              <Input name="artist" defaultValue={artists[0] ?? "Life Lyrics"} list="known-artists" required />
              <datalist id="known-artists">
                {artists.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label="EP" hint="optional">
              <Input name="ep" placeholder="In The Mood for Life" />
            </Field>
          </div>
          {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm whitespace-pre-line text-red-200">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add song"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
