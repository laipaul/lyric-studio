"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// A searchable picker for any list that grows (themes, collections…): the user's rule (1 Nov 2026) is tick
// boxes only for a few fixed choices. A button opens a panel with a search box, optional filter chips and
// the items (as tiles or rows); a click picks an item. Single choice closes the panel; several choices
// stop at `max`. The chosen items are shown by the caller (chips with ×, see PickedChip).
export type PickerItem = { id: string; label: string; tags?: string[]; note?: string };

export function SearchPicker<T extends PickerItem>({
  items,
  selected,
  onPick,
  trigger,
  max,
  filters,
  render,
  tiles,
  name,
  disabled,
  placeholder = "Search…",
}: {
  items: T[]; // in the order to show (the caller puts the song's own / in-use first)
  selected: string[];
  onPick: (id: string) => void; // toggles (several) or sets (single: max 1)
  trigger: ReactNode;
  max?: number;
  filters?: readonly string[]; // tag chips (e.g. moods)
  render?: (item: T, picked: boolean) => ReactNode;
  tiles?: boolean; // a grid of tiles instead of rows
  name: string; // data-picker=<name> on the panel, data-picker-open=<name> on the button
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => (!q || i.label.toLowerCase().includes(q)) && (!tag || i.tags?.includes(tag)));
  const full = max !== undefined && max > 1 && selected.length >= max;

  return (
    <div ref={box} className="relative w-fit">
      <button type="button" data-picker-open={name} disabled={disabled} onClick={() => setOpen((o) => !o)} className="hover:bg-accent flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50">
        {trigger}
      </button>
      {open ? (
        <div data-picker={name} className="bg-popover absolute top-full left-0 z-40 mt-1 flex max-h-[420px] w-[min(560px,90vw)] flex-col gap-2 rounded-lg border p-3 shadow-xl">
          <label className="bg-background flex items-center gap-2 rounded-md border px-2 py-1">
            <Search className="text-muted-foreground size-3.5" />
            <input autoFocus data-picker-search value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          {filters?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button key={f} type="button" data-picker-filter={f} aria-pressed={tag === f} onClick={() => setTag((t) => (t === f ? null : f))} className={cn("rounded-full border px-2 py-0.5 text-[11px]", tag === f ? "border-brand bg-brand/15" : "text-muted-foreground")}>
                  {f}
                </button>
              ))}
            </div>
          ) : null}
          {full ? <p className="text-xs text-amber-300">{max} chosen: that is the most. Remove one to pick another.</p> : null}
          <div className={cn("min-h-0 overflow-y-auto", tiles ? "grid grid-cols-3 gap-2 sm:grid-cols-4" : "flex flex-col gap-0.5")}>
            {shown.map((item) => {
              const picked = selected.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-picker-item={item.id}
                  aria-pressed={picked}
                  disabled={!picked && full}
                  onClick={() => {
                    onPick(item.id);
                    if (max === 1) setOpen(false);
                  }}
                  className={cn("rounded-md text-left text-sm disabled:opacity-40", tiles ? "flex flex-col gap-1 p-1" : "flex items-center justify-between gap-2 px-2 py-1", picked ? "bg-brand/20 ring-brand ring-1" : "hover:bg-accent")}
                >
                  {render ? (
                    render(item, picked)
                  ) : (
                    <>
                      <span className="truncate">{item.label}</span>
                      {item.note ? <span className="text-muted-foreground shrink-0 text-[11px]">{item.note}</span> : null}
                    </>
                  )}
                </button>
              );
            })}
            {!shown.length ? <p className="text-muted-foreground col-span-full py-3 text-center text-xs">Nothing matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// A chosen item as a small chip with × (remove).
export function PickedChip({ children, onRemove, name, id }: { children: ReactNode; onRemove?: () => void; name: string; id: string }) {
  return (
    <span data-picked={name} data-picked-id={id} className="bg-card flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-1 text-xs">
      {children}
      {onRemove ? (
        <button type="button" aria-label="Remove" data-picked-remove={id} onClick={onRemove} className="text-muted-foreground hover:text-foreground rounded-full p-0.5">
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
