"use client";

// The Style tab's font pairings (Look block): ONE dropdown "Font pairing" (a Radix popover with a
// listbox, not a native select, so that hovering an option can preview it). Each option: the pairing's
// name (+ "brand" / "try this"), its fonts in one line (verse · hook) and a one-line sample drawn in the
// pair's own fonts; a muted "!" when it has points. Hovering or keyboard-highlighting an option tries the
// pair in the Look block's big preview (look-preview.tsx, nothing saved; closing without a choice puts the
// song's fonts back); choosing one applies it to this song (song.json, locks kept). Next to it: "Back to
// the brand" and "Save to brand…" (asks first). Under it the chosen pair's points in plain words, the
// technical text one click away. Readability over the clips is the app's job (readability "auto").
import { Check, ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import type { PairingCard, PairingsView } from "@lyric/video/pairings";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { shortFrom } from "@/lib/short-from";
import { cn } from "@/lib/utils";

const loadedFaces = new Set<string>();
const face = (f: PairingCard["verse"]) =>
  `${f.family} ${f.weight}${f.italic ? " italic" : ""}`;
// One small line under the card name: verse font · hook font (same family: "Family 400 / 600 italic").
const fontsLine = (card: PairingCard) => {
  const [v, h] = [card.verse, card.hook];
  const it = (f: PairingCard["verse"]) => (f.italic ? " italic" : "");
  return v.family === h.family
    ? `${v.family} ${v.weight}${it(v)} / ${h.weight}${it(h)}`
    : `${v.family}${it(v)} · ${h.family}${it(h)}`;
};
const faces = (card: PairingCard) =>
  `verse ${face(card.verse)} · hook ${face(card.hook)}${card.title ? ` · title ${face(card.title)}` : ""}`;

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
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const r = await api(`/api/songs/${projectId}/pairings`, {
        cache: "no-store",
      });
      const d = (await r.json()) as PairingsView & { error?: string };
      if (!r.ok || d.error)
        throw new Error(d.error ?? `The studio answered ${r.status}`);
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
      const r = await api(`/api/songs/${projectId}/pairings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as {
        error?: string;
        kept?: string[];
        file?: string;
        pairing?: { name: string };
      };
      if (!r.ok || d.error)
        throw new Error(d.error ?? `The studio answered ${r.status}`);
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
      ...(d.kept?.length
        ? [`Locked, kept as they are: ${d.kept.join(", ")}.`]
        : []),
      ...(card.title && !card.brand
        ? [
            `Its title font (${card.title.family}) applies with "Save to brand".`,
          ]
        : []),
    ];
    setNotice(
      extra.length
        ? `${card.name} chosen for this song. ${extra.join(" ")}`
        : null,
    );
    await load();
    onChanged();
  }
  async function reset() {
    const d = await post({ action: "reset" });
    if (!d) return;
    setNotice(
      `Back to the brand's fonts.${d.kept?.length ? ` Locked, kept: ${d.kept.join(", ")}.` : ""}`,
    );
    await load();
    onChanged();
  }
  async function saveToBrand(card: PairingCard) {
    const d = await post({ action: "brand", id: card.id });
    setConfirmBrand(null);
    if (!d) return;
    setNotice(
      `${card.name} saved to the brand (${d.file}): every song of this artist that does not set its own fonts uses it now.`,
    );
    await load();
    onChanged();
  }

  // The samples are drawn in the pairs' own fonts (the exact files a render loads), so load them for the DOM too.
  useEffect(() => {
    if (!view) return;
    for (const c of view.cards)
      for (const f of c.fonts) {
        const url = `/api/fonts/${f.src.split("/").map(encodeURIComponent).join("/")}`;
        const key = `${f.family}|${f.weight}|${f.style}|${f.src}`;
        if (loadedFaces.has(key)) continue;
        loadedFaces.add(key);
        new FontFace(f.family, `url("${url}")`, {
          weight: String(f.weight),
          style: f.style,
          ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
        })
          .load()
          .then((l) => document.fonts.add(l))
          .catch(() => loadedFaces.delete(key));
      }
  }, [view]);
  async function pick(c: PairingCard) {
    setOpen(false);
    onHover?.(null);
    await choose(c);
  }

  if (error && !view) return <p className="text-sm text-red-300">{error}</p>;
  if (!view)
    return (
      <p className="text-muted-foreground text-xs">
        Loading the font pairings…
      </p>
    );
  const chosen = view.cards.find((c) => c.current) ?? null;
  const card = chosen ?? view.cards[0];
  const sampleStyle = (f: PairingCard["verse"]) =>
    ({
      fontFamily: `"${f.family}", sans-serif`,
      fontWeight: f.weight,
      fontStyle: f.italic ? "italic" : "normal",
      fontSynthesis: "none",
    }) as const;
  const words = (t: string, n: number) => t.split(" ").slice(0, n).join(" ");

  return (
    <section
      data-pairings
      className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-medium">Font pairing</span>
        <span
          className="text-muted-foreground min-w-0 text-xs break-words"
          title={`Each pair on this song's own lines, as a ${view.platform} video draws them${view.backgroundFrom ? `, over ${view.backgroundFrom}` : ""}. Point at a pair to see it in the preview; click it to choose it for this song.`}
        >
          Point at a pair to see it in the preview, click to use it for this
          song
          {view.backgroundFrom
            ? ` · shown over ${shortFrom(view.backgroundFrom)}`
            : ""}
        </span>
      </div>
      {view.problems.length ? (
        <p className="text-xs text-amber-300">
          presets/font-pairings.json: {view.problems.join("; ")}
        </p>
      ) : null}
      {view.locked.length ? (
        <p className="text-muted-foreground text-xs">
          Locked on this song (a pairing keeps them): {view.locked.join(", ")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Popover.Root
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) onHover?.(null); // closed without a choice: the song's fonts are back in the preview
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              data-pairing-select
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={busy}
              className="bg-background flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span data-pairing-current className="font-medium">
                  {chosen ? chosen.name : "Choose a pairing"}
                </span>
                {card ? (
                  <span className="text-muted-foreground truncate text-[11px]">
                    {fontsLine(card)}
                  </span>
                ) : null}
              </span>
              <ChevronDown className="size-4 shrink-0" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              data-pairing-list
              role="listbox"
              aria-label="Font pairing"
              onKeyDown={(e) => {
                const items = [
                  ...(listRef.current?.querySelectorAll<HTMLElement>(
                    "[data-pairing]",
                  ) ?? []),
                ];
                const at = items.indexOf(document.activeElement as HTMLElement);
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  items[
                    (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length
                  ]?.focus();
                }
              }}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                (
                  listRef.current?.querySelector<HTMLElement>(
                    "[data-current]",
                  ) ??
                  listRef.current?.querySelector<HTMLElement>("[data-pairing]")
                )?.focus();
              }}
              collisionPadding={8}
              className="bg-popover text-popover-foreground z-50 max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[min(34rem,92vw)] overflow-y-auto rounded-md border p-1 shadow-lg"
            >
              <div ref={listRef} className="flex flex-col">
                {view.cards.map((c) => (
                  <div
                    key={c.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={c.current}
                    data-pairing={c.id}
                    data-current={c.current || undefined}
                    onMouseEnter={() => onHover?.(c)}
                    onFocus={() => onHover?.(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void pick(c);
                      }
                    }}
                    onClick={() => void pick(c)}
                    className={cn(
                      "hover:bg-accent focus:bg-accent flex cursor-pointer flex-col gap-0.5 rounded-md border border-transparent px-2.5 py-2 outline-none",
                      c.current && "border-brand",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span data-pairing-name className="text-sm font-medium">
                        {c.name}
                      </span>
                      {c.brand ? (
                        <span className="text-muted-foreground rounded-full border px-1.5 text-[10px]">
                          brand
                        </span>
                      ) : null}
                      {c.recommended ? (
                        <span
                          data-pairing-try
                          className="flex items-center gap-0.5 text-[10px] text-emerald-300"
                        >
                          <Sparkles className="size-3" /> try this
                        </span>
                      ) : null}
                      {c.current ? (
                        <Check
                          className="text-brand size-3.5"
                          aria-label="this song's fonts"
                        />
                      ) : null}
                      {!c.current && c.warnings.length ? (
                        <span
                          data-pairing-flag
                          title={c.warnings.join("\n")}
                          className="text-muted-foreground ml-auto rounded-full border px-1 text-[10px] leading-tight"
                        >
                          !
                        </span>
                      ) : null}
                    </span>
                    <span
                      data-pairing-fonts
                      title={faces(c)}
                      className="text-muted-foreground text-[11px] leading-tight"
                    >
                      {fontsLine(c)}
                    </span>
                    <span
                      data-pairing-sample
                      className="truncate text-lg leading-snug"
                    >
                      <span style={sampleStyle(c.verse)}>
                        {words(view.verseLine, 4)}
                      </span>{" "}
                      <span style={sampleStyle(c.hook)}>
                        {words(view.hookLine, 3)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={reset}
          data-pairing-reset
        >
          <RotateCcw /> Back to the brand
        </Button>
        {chosen && !chosen.brand ? (
          confirmBrand === chosen.id ? (
            <span className="flex flex-wrap items-center gap-1 text-[11px]">
              Use these fonts for every song of this artist that does not set
              its own?
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => saveToBrand(chosen)}
                data-pairing-brand-confirm
              >
                Save to brand
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmBrand(null)}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <button
              type="button"
              data-pairing-brand
              disabled={busy}
              onClick={() => setConfirmBrand(chosen.id)}
              className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
            >
              Save to brand…
            </button>
          )
        ) : null}
      </div>
      {chosen && chosen.plain.length ? (
        <div data-pairing-note className="flex flex-col gap-1 text-xs">
          {chosen.plain.map((line) => (
            <p
              key={line}
              data-pairing-warning
              className="text-muted-foreground"
            >
              <span className="text-foreground font-medium">
                {chosen.name}:
              </span>{" "}
              {line}
            </p>
          ))}
          <details data-pairing-note-details className="text-muted-foreground">
            <summary className="hover:text-foreground cursor-pointer text-[11px] select-none">
              Details
            </summary>
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
