"use client";

// The Style tab's "Pairings" row: every font pairing previewed as a pair, never one font at a time: a
// real verse line and a real hook line of this song, together, as the video draws them (the video's own
// layout, size, weight, italic, shadow and the hook effect's accent colour) over a frame of the song's
// clips. "This song" applies the pair (locks kept); "Save to brand" is separate and asks first.
import { Thumbnail } from "@remotion/player";
import { AlertTriangle, Check, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { PairPreview } from "@lyric/video";
import type { PairingCard, PairingsView } from "@lyric/video/pairings";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const face = (f: PairingCard["verse"]) => `${f.family} ${f.weight}${f.italic ? " italic" : ""}`;

export function PairingsRow({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [view, setView] = useState<PairingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBrand, setConfirmBrand] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api(`/api/songs/${projectId}/pairings`, { cache: "no-store" });
      const d = (await r.json()) as PairingsView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      setView(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let alive = true;
    api(`/api/songs/${projectId}/pairings`, { cache: "no-store" })
      .then((r) => r.json() as Promise<PairingsView & { error?: string }>)
      .then((d) => alive && (d.error ? setError(d.error) : setView(d)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/pairings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { error?: string; kept?: string[]; file?: string; pairing?: { name: string } };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function apply(card: PairingCard) {
    const d = await post({ action: "apply", id: card.id });
    if (!d) return;
    setNotice(`${card.name} is now this song's fonts (song.json).${d.kept?.length ? ` Locked, kept as they are: ${d.kept.join(", ")}.` : ""}${card.title && !card.brand ? ` Its title font (${card.title.family}) applies with "Save to brand" (title fonts per song come later).` : ""}`);
    await load();
    onChanged();
  }
  async function reset() {
    const d = await post({ action: "reset" });
    if (!d) return;
    setNotice(`Back to the brand's fonts.${d.kept?.length ? ` Locked, kept: ${d.kept.join(", ")}.` : ""}`);
    await load();
    onChanged();
  }
  async function saveToBrand(card: PairingCard) {
    const d = await post({ action: "brand", id: card.id });
    setConfirmBrand(null);
    if (!d) return;
    setNotice(`${card.name} saved to the brand (${d.file}): every song of this artist that does not set its own fonts uses it now.`);
    await load();
    onChanged();
  }

  if (error && !view) return <p className="text-sm text-red-300">{error}</p>;
  if (!view) return <p className="text-muted-foreground text-xs">Loading the font pairings…</p>;

  return (
    <section data-pairings className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-medium">Pairings</span>
        <span className="text-muted-foreground text-xs">
          Each pair on this song&apos;s own lines, as a {view.platform} video draws them{view.backgroundFrom ? `, over ${view.backgroundFrom}` : ""}. The font lists below are for fine-tuning.
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={reset} data-pairing-reset>
          <RotateCcw /> Back to the brand
        </Button>
      </div>
      {view.problems.length ? <p className="text-xs text-amber-300">presets/font-pairings.json: {view.problems.join("; ")}</p> : null}
      {view.locked.length ? <p className="text-muted-foreground text-xs">Locked on this song (a pairing keeps them): {view.locked.join(", ")}</p> : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {view.cards.map((card) => (
          <article key={card.id} data-pairing={card.id} data-current={card.current || undefined} className={cn("flex w-64 shrink-0 flex-col gap-2 rounded-lg border p-2", card.current && "border-brand/60 bg-brand/5")}>
            <div className="overflow-hidden rounded-md">
              <Thumbnail
                component={PairPreview}
                compositionWidth={1080}
                compositionHeight={1920}
                frameToDisplay={0}
                durationInFrames={1}
                fps={30}
                style={{ width: "100%" }}
                inputProps={{
                  mediaBaseUrl: "/api/fonts",
                  fonts: card.fonts,
                  background: view.background ? `/api/files/${view.background}` : null,
                  verse: { text: view.verseLine, font: { family: card.verse.family, weight: card.verse.weight, italic: card.verse.italic } },
                  hook: { text: view.hookLine, font: { family: card.hook.family, weight: card.hook.weight, italic: card.hook.italic }, highlightWords: view.highlightWords },
                  textSize: view.textSize,
                  area: view.area,
                  colour: view.colour,
                  accent: view.accent,
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{card.name}</span>
              {card.brand ? <span className="text-brand rounded-full border border-current px-1.5 text-[10px]">brand</span> : null}
              {card.recommended ? (
                <span className="flex items-center gap-0.5 text-[10px] text-emerald-300">
                  <Sparkles className="size-3" /> try this
                </span>
              ) : null}
              {card.current ? <Check className="text-brand ml-auto size-4" aria-label="this song's fonts" /> : null}
            </div>
            <p className="text-muted-foreground text-[11px] leading-snug">{card.note}</p>
            <p className="text-[11px] leading-snug" data-pairing-faces>
              verse {face(card.verse)} · hook {face(card.hook)}
              {card.title ? ` · title ${face(card.title)}` : ""}
            </p>
            {card.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1 text-[11px] leading-snug text-amber-200" data-pairing-warning>
                <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
              </p>
            ))}
            <div className="mt-auto flex flex-col gap-1">
              <Button size="sm" disabled={busy || card.current} onClick={() => apply(card)} data-pairing-apply>
                {card.current ? "This song's fonts" : "This song"}
              </Button>
              {!card.brand ? (
                confirmBrand === card.id ? (
                  <div className="flex flex-col gap-1 rounded-md border border-amber-400/40 p-1.5 text-[11px]">
                    <span>Change the brand for every song of this artist that does not set its own fonts?</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => saveToBrand(card)} data-pairing-brand-confirm>
                        Save to brand
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmBrand(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmBrand(card.id)} data-pairing-brand>
                    Save to brand…
                  </Button>
                )
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {notice ? (
        <p role="status" className="border-brand/30 bg-brand/10 rounded-md border p-2 text-xs">
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </section>
  );
}
