import { CircleCheckBig, Clapperboard, Diamond, Eye, Film, Layers, Music, Palette, Send, Type, Wand2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// One icon and one colour per core feature, used the same way everywhere (header, rail, stages, cards),
// so a user knows at a glance what a thing is (asked by the user on 1 Nov 2026):
// Song: music note, white · Theme: palette, pink (the brand) · Clips: film, teal (a collection: a stack) ·
// Lyrics and card text: "T", amber · Steps: Prepare ✓, Shape ◇, Make 🎬, Review 👁, Post 📤 · Automatic: wand.
export const FEATURE = {
  song: { icon: Music, colour: "text-white" },
  theme: { icon: Palette, colour: "text-brand" },
  clips: { icon: Film, colour: "text-teal-300" },
  collection: { icon: Layers, colour: "text-teal-300" },
  lyrics: { icon: Type, colour: "text-amber-300" },
  prepare: { icon: CircleCheckBig, colour: "" },
  shape: { icon: Diamond, colour: "" },
  make: { icon: Clapperboard, colour: "" },
  review: { icon: Eye, colour: "" },
  post: { icon: Send, colour: "" },
  auto: { icon: Wand2, colour: "" },
} as const satisfies Record<string, { icon: LucideIcon; colour: string }>;
export type Feature = keyof typeof FEATURE;

// A feature's icon in its colour. `plain` keeps the surrounding text colour (e.g. a selected tab).
export function FeatureIcon({ feature, className, plain }: { feature: Feature; className?: string; plain?: boolean }) {
  const { icon: Icon, colour } = FEATURE[feature];
  return <Icon aria-hidden data-feature-icon={feature} className={cn("size-4 shrink-0", !plain && colour, className)} />;
}

// Platform marks: plain shapes in each platform's colour, never the platforms' own logos.
export const PLATFORM_MARK: Record<string, { shape: "square" | "rounded" | "circle" | "tall" | "play" | "ring"; colour: string }> = {
  standard: { shape: "square", colour: "#a1a1aa" },
  reels: { shape: "rounded", colour: "#e1306c" },
  tiktok: { shape: "circle", colour: "#25f4ee" },
  shorts: { shape: "tall", colour: "#ff4e45" },
  youtube: { shape: "play", colour: "#ff0033" },
  canvas: { shape: "ring", colour: "#1db954" },
};

export function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  const mark = PLATFORM_MARK[platform] ?? { shape: "square" as const, colour: "#a1a1aa" };
  const c = mark.colour;
  const shape = {
    square: <rect x="2" y="2" width="8" height="8" fill={c} />,
    rounded: <rect x="1.5" y="1.5" width="9" height="9" rx="2.5" fill="none" stroke={c} strokeWidth="1.8" />,
    circle: <circle cx="6" cy="6" r="4.5" fill={c} />,
    tall: <rect x="3.5" y="1" width="5" height="10" rx="1" fill={c} />,
    play: <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill={c} />,
    ring: <circle cx="6" cy="6" r="4" fill="none" stroke={c} strokeWidth="2" />,
  }[mark.shape];
  return (
    <svg viewBox="0 0 12 12" aria-hidden data-platform-mark={platform} className={cn("size-2.5 shrink-0", className)}>
      {shape}
    </svg>
  );
}
