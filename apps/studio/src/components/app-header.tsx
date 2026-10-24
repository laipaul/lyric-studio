"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/studio", label: "Studio" },
  { href: "/library", label: "Library" },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b px-4">
      <Link href="/" className="font-semibold tracking-tight">
        Lyric Studio
      </Link>
      <nav className="flex gap-1">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
