// The reaction keywords a video offers (Step C; the app turns each into one setting: src/node/reactions.ts).
// Pure: the Videos tab lists them from here.
export const REACTIONS = {
  "too-fast": "cuts too fast",
  "too-slow": "cuts too slow",
  "fewer-dissolves": "too many dissolves",
  "more-dreamy": "more dreamy",
  "abrupt-ending": "ending too abrupt",
  "hard-to-read": "lyrics hard to read",
  repetitive: "too repetitive",
  love: "love this one",
} as const;
export type Reaction = keyof typeof REACTIONS;
export const LOOP_PLATFORMS = ["reels", "tiktok", "shorts"];

// Which reactions a video offers (ending: loop platforms only; the Canvas has no cuts). "This clip doesn't
// fit here" is gone (2 Nov 2026): a shot's "Omit this clip" (Shape) does it.
export function reactionsFor(platform: string): { id: Reaction; label: string }[] {
  const ids = platform === "canvas" ? (["love"] as Reaction[]) : (Object.keys(REACTIONS) as Reaction[]).filter((r) => r !== "abrupt-ending" || LOOP_PLATFORMS.includes(platform));
  return ids.map((id) => ({ id, label: REACTIONS[id] }));
}
