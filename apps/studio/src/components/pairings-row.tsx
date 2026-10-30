"use client";

// The Style tab's font pairings (Look block): a grid of compact cards, each a small picture of the pair
// as the video draws it (this song's verse and hook line, the video's layout, size, weight, italic,
// shadow and the hook effect's accent colour, over a frame of the song's clips) and its name. Clicking a
// card chooses it for this song (song.json, locks kept); the chosen one has a ✓ and the brand-coloured
// border (pink is reserved for it). The description and the exact faces show on hover / focus; "Save to
// brand…" is a small link on hover / focus and on the chosen card, and asks first. Warnings are not
// shown per card: under the grid, the chosen pair's in plain words, the technical text one click away.
// Readability over the clips is the app's job (readability "auto": the render adds a soft backing).
// The cards stay the visual picker; hovering or focusing one tries the pair in the Look block's big
// preview (look-preview.tsx), which also uses this view's frame, lines and layout.
import { Thumbnail } from "@remotion/player";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { PairPreview } from "@lyric/video";
import type { PairingCard, PairingsView } from "@lyric/video/pairings";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const face = (f: PairingCard["verse"]) => `${f.family} ${f.weight}${f.italic ? " italic" : ""}`;
const faces = (card: PairingCard) => `verse ${face(card.verse)} · hook ${face(card.hook)}${card.title ? ` · title ${face(card.title)}` : ""}`;

export function PairingsRow({
  projectId,
  onChanged,
  onView,
  onHover,
}: {
  projectId: string;
  onChanged: () => void;
  onView?: (view: PairingsView) => void; // the Look preview uses the same frame, lines and layout
  onHover?: (card: PairingCard | null) => void; // a card under the pointer / focus: the Look preview tries it (nothing saved)
}) {
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

  useEffect(() => {
    if (view) onView?.(view);
  }, [view, onView]);

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

  async function choose(card: PairingCard) {
    if (busy || card.current) return;
    const d = await post({ action: "apply", id: card.id });
    if (!d) return;
    // Only what the user needs to know: locked fonts kept, a title font that waits for "Save to brand".
    const extra = [
      ...(d.kept?.length ? [`Locked, kept as they are: ${d.kept.join(", ")}.`] : []),
      ...(card.title && !card.brand ? [`Its title font (${card.title.family}) applies with "Save to brand".`] : []),
    ];
    setNotice(extra.length ? `${card.name} chosen for this song. ${extra.join(" ")}` : null);
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
  const chosen = view.cards.find((c) => c.current) ?? null;

  return (
    <section data-pairings className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-medium">Font pairings</span>
        <span className="text-muted-foreground truncate text-xs" title={`Each pair on this song's own lines, as a ${view.platform} video draws them${view.backgroundFrom ? `, over ${view.backgroundFrom}` : ""}. Hover a card for its fonts; click it to choose it for this song.`}>
          Click a pair to use it for this song{view.backgroundFrom ? ` · shown over ${view.backgroundFrom}` : ""}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={reset} data-pairing-reset>
          <RotateCcw /> Back to the brand
        </Button>
      </div>
      {view.problems.length ? <p className="text-xs text-amber-300">presets/font-pairings.json: {view.problems.join("; ")}</p> : null}
      {view.locked.length ? <p className="text-muted-foreground text-xs">Locked on this song (a pairing keeps them): {view.locked.join(", ")}</p> : null}
      <div className="@container max-w-4xl">
        <div data-pairing-grid className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5">
          {view.cards.map((card) => (
            <article
              key={card.id}
              data-pairing={card.id}
              data-current={card.current || undefined}
              onMouseEnter={() => onHover?.(card)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(card)}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && onHover?.(null)}
              className={cn(
                "group relative flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 transition-colors",
                card.current ? "border-brand ring-brand/60 ring-1" : "hover:border-foreground/30",
              )}
            >
              <button
                type="button"
                data-pairing-choose
                aria-pressed={card.current}
                aria-label={`${card.name}${card.current ? " (this song's fonts)" : ": use for this song"}`}
                disabled={busy && !card.current}
                onClick={() => choose(card)}
                className={cn("flex flex-col gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/40", card.current ? "cursor-default" : "cursor-pointer")}
              >
                <div className="relative overflow-hidden rounded-md">
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
                  {card.current ? (
                    <span data-pairing-check className="bg-brand absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full text-black shadow">
                      <Check className="size-4" aria-label="this song's fonts" />
                    </span>
                  ) : null}
                </div>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-sm font-medium">{card.name}</span>
                  {card.brand ? <span className="text-muted-foreground shrink-0 rounded-full border px-1.5 text-[10px]">brand</span> : null}
                  {card.recommended ? (
                    <span data-pairing-try className="flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-300">
                      <Sparkles className="size-3" /> try this
                    </span>
                  ) : null}
                  {!card.current && card.warnings.length ? (
                    <span data-pairing-flag title={card.warnings.join("\n")} className="text-muted-foreground ml-auto shrink-0 rounded-full border px-1 text-[10px] leading-tight">
                      !
                    </span>
                  ) : null}
                </span>
              </button>
              {/* Hover / focus: what the pair is and its exact faces (never covers a click: no pointer events). */}
              <div
                data-pairing-details
                role="tooltip"
                className="bg-popover text-popover-foreground pointer-events-none absolute top-full right-0 left-0 z-20 mt-1 hidden flex-col gap-1 rounded-md border p-2 text-[11px] leading-snug shadow-lg group-focus-within:flex group-hover:flex"
              >
                <span>{card.note}</span>
                <span className="text-muted-foreground" data-pairing-faces>
                  {faces(card)}
                </span>
              </div>
              {!card.brand ? (
                confirmBrand === card.id ? (
                  <div className="flex flex-col gap-1 rounded-md border p-1.5 text-[11px]">
                    <span>Use these fonts for every song of this artist that does not set its own?</span>
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
                  <button
                    type="button"
                    data-pairing-brand
                    disabled={busy}
                    onClick={() => setConfirmBrand(card.id)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground self-start text-[11px] underline underline-offset-2 focus-visible:opacity-100",
                      card.current ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                    )}
                  >
                    Save to brand…
                  </button>
                )
              ) : null}
            </article>
          ))}
        </div>
      </div>
      {chosen && chosen.plain.length ? (
        <div data-pairing-note className="flex flex-col gap-1 text-xs">
          {chosen.plain.map((line) => (
            <p key={line} data-pairing-warning className="text-muted-foreground">
              <span className="text-foreground font-medium">{chosen.name}:</span> {line}
            </p>
          ))}
          <details data-pairing-note-details className="text-muted-foreground">
            <summary className="hover:text-foreground cursor-pointer select-none text-[11px]">Details</summary>
            <ul className="mt-1 list-disc pl-5 text-[11px]">
              {chosen.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="bg-muted/40 rounded-md border p-2 text-xs">
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </section>
  );
}
