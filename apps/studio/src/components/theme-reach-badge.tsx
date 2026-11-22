import { themeReach } from "@lyric/video";

import { cn } from "@/lib/utils";

const TONE = { shared: "border-amber-300/40 bg-amber-300/10 text-amber-200", single: "border-brand/40 bg-brand/10 text-brand", unused: "text-muted-foreground" } as const;

// "Shared by N songs" / "This song only" / "Not used yet" as a small badge (Themes and Shape → Theme), so a
// user sees before editing whether a change reaches other songs. Hover: the songs' names.
export function ThemeReachBadge({ users, thisSong, className }: { users: string[]; thisSong?: string | null; className?: string }) {
  const r = themeReach(users, thisSong);
  return (
    <span data-theme-reach={r.tone} title={users.join(", ") || undefined} className={cn("inline-flex max-w-full shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap", TONE[r.tone], className)}>
      <span className="truncate">{r.badge}</span>
    </span>
  );
}
