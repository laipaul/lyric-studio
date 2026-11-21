"use client";

// "From a character" (the Wardrobe, 21 Nov 2026): a picture of one of your characters in one of their looks (the
// close-up, the 3/4 face, the full body front or back) goes into Creation, to animate or to sing with. The card's
// own picture is only read: Creation gets a copy.
import { Check, Loader2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type View = { id: string; label: string; file: string };
type Character = { id: string; name: string; looks: { id: string; name: string; locked: boolean; views: View[] }[] };

const url = (card: string, rel: string) => `/api/cards/${card}/file/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function CharacterPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (file: File) => Promise<void> | void }) {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ card: Character; look: string; view: View } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    api("/api/cards/looks", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json()) as { characters?: Character[]; error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
        setCharacters(d.characters ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);

  async function use() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await (await fetch(url(chosen.card.id, chosen.view.file))).blob();
      const look = chosen.card.looks.find((l) => l.id === chosen.look)?.name ?? "";
      await onPick(new File([blob], `${chosen.card.name} - ${look} - ${chosen.view.label}.png`.replace(/[\\/:*?"<>|]/g, "_"), { type: blob.type || "image/png" }));
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent data-character-picker className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>A picture of one of your characters</DialogTitle>
          <DialogDescription>Choose a character, a look and a picture: a copy goes into Creation, to animate or to sing with.</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
        {!characters ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" /> Loading your characters…
          </p>
        ) : !characters.length ? (
          <p className="text-muted-foreground text-xs">No character has pictures yet: make a pack (or add your own) on the Characters page.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto" data-character-list>
            {characters.map((c) => (
              <div key={c.id} className="flex flex-col gap-2" data-character={c.name}>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <UserRound className="text-brand size-4" /> {c.name}
                </p>
                {c.looks.map((l) => (
                  <div key={l.id} className="flex flex-col gap-1" data-character-look={l.id}>
                    <p className="text-muted-foreground text-xs">
                      {l.name}
                      {l.locked ? "" : " (not locked yet)"}
                    </p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {l.views.map((v) => {
                        const on = chosen?.card.id === c.id && chosen.look === l.id && chosen.view.id === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            data-character-view={`${l.id}/${v.id}`}
                            title={v.label}
                            onClick={() => setChosen({ card: c, look: l.id, view: v })}
                            onDoubleClick={() => (setChosen({ card: c, look: l.id, view: v }), void use())}
                            className={cn("relative overflow-hidden rounded-md border-2", on ? "border-brand" : "border-transparent")}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a card's picture */}
                            <img src={url(c.id, v.file)} alt="" className="aspect-[3/4] w-full object-cover" />
                            <span className="absolute right-0 bottom-0 left-0 truncate bg-black/60 px-1 text-[10px]">{v.label}</span>
                            {on ? <Check className="bg-brand absolute top-1 right-1 size-4 rounded-full p-0.5 text-white" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button data-character-use disabled={!chosen || busy} onClick={() => void use()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Add to Creation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
