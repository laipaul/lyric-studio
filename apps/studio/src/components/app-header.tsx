"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Library" },
  { href: "/studio", label: "Studio" },
];

// The header: the app's name and icon, navigation, and the Tasks menu (render progress from Step 6.2).
export function AppHeader() {
  const pathname = usePathname();
  const [tasksOpen, setTasksOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b px-4">
      <Link href="/" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- made from the brand logo */}
        <img src="/icons/favicon-32.png" alt="" className="size-6" />
        <span className="font-display text-brand text-sm tracking-[0.18em] uppercase">Lyric Studio</span>
      </Link>
      <nav className="flex gap-1">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/songs") : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="relative ml-auto">
        <button
          type="button"
          onClick={() => setTasksOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
          aria-expanded={tasksOpen}
        >
          <ListChecks className="size-4" /> Tasks
        </button>
        {tasksOpen ? (
          <div className="bg-popover absolute right-0 z-40 mt-2 w-72 rounded-lg border p-4 text-sm shadow-xl">
            <p className="font-medium">No tasks running</p>
            <p className="text-muted-foreground mt-1 text-xs">Videos you generate from a song page will show their progress here.</p>
          </div>
        ) : null}
      </div>
    </header>
  );
}
