"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { TasksMenu } from "@/components/tasks-menu";
import { FeatureIcon, type Feature } from "@/lib/feature-icons";
import { cn } from "@/lib/utils";

// Only menu items that lead somewhere real (the Studio editor and the content board come later).
// Each with its feature icon (lib/feature-icons.tsx): songs, themes, collections, posting.
const NAV: { href: string; label: string; feature: Feature }[] = [
  { href: "/", label: "Library", feature: "song" },
  { href: "/themes", label: "Themes", feature: "theme" },
  { href: "/film-looks", label: "Film looks", feature: "filmLook" },
  { href: "/collections", label: "Collections", feature: "collection" },
  { href: "/characters", label: "Characters", feature: "character" },
  { href: "/releases", label: "Releases", feature: "post" },
];

// The header: the app's name and icon, navigation, and the Tasks menu (live progress of the runs).
export function AppHeader() {
  const pathname = usePathname();

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
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <FeatureIcon feature={item.feature} className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <TasksMenu />
    </header>
  );
}
