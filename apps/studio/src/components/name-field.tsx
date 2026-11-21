"use client";

// A short name the user gives a clip, picture, video or take ("Bride smile", 21 Nov 2026: the long Midjourney file
// names are hard to recognise). Click to rename; Enter or leaving the field saves, Esc cancels, empty = back to the
// file name. The file on disk always keeps its own name.
import { Pencil } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function NameField({
  name,
  file,
  onSave,
  className,
  id,
}: {
  name: string | null; // the short name, or null (the file name shows)
  file: string; // shown when there is no name, and in the tooltip
  onSave: (name: string) => Promise<void>;
  className?: string;
  id?: string; // data-name-field value (tests)
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    const next = text.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (next === (name ?? "")) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <input
        data-name-input={id ?? file}
        autoFocus
        value={text}
        maxLength={60}
        placeholder="A short name, e.g. Bride smile"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(name ?? "");
            setEditing(false);
          }
        }}
        className={cn("bg-background min-w-0 rounded-md border px-1.5 py-0.5 text-xs", className)}
      />
    );
  return (
    <button
      type="button"
      data-name-field={id ?? file}
      disabled={busy}
      onClick={() => {
        setText(name ?? "");
        setEditing(true);
      }}
      title={name ? `${name}\n${file}\nClick to rename (the file keeps its name)` : `${file}\nClick to give it a short name`}
      className={cn("group flex min-w-0 items-center gap-1 text-left", className)}
    >
      <span className={cn("truncate", name ? "font-medium" : "text-muted-foreground")}>{name ?? file}</span>
      <Pencil className="text-muted-foreground size-3 shrink-0 opacity-50 group-hover:opacity-100" />
    </button>
  );
}
