"use client";

// The ⋯ menu of a Shape setting: the rarely used actions (per platform, back to the inherited value, lock,
// use for all my songs) out of the row, so each row shows only its name, its value and the "Set by me"
// badge. Each item keeps its own data-* attribute (data-lock, data-reset, ...) for the browser tests.
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { cn } from "@/lib/utils";

export type RowMenuItem = { key: string; label: string; onSelect: () => void; attrs?: Record<string, string | boolean | undefined> };

export function RowMenu({ label, items, menuId }: { label: string; items: RowMenuItem[]; menuId: string }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-row-menu={menuId} aria-label={`More for ${label}`} title="More" className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1">
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="bg-popover text-popover-foreground z-50 min-w-48 rounded-md border p-1 text-sm shadow-lg">
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.key}
              onSelect={it.onSelect}
              {...Object.fromEntries(Object.entries(it.attrs ?? {}).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => [k, v === true ? "" : v]))}
              className={cn("hover:bg-accent focus:bg-accent cursor-pointer rounded px-2 py-1.5 outline-none select-none")}
            >
              {it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
