// Transition notes for the Storyboard clip cards (22 Nov 2026): what the app changed in each saved shot plan so a
// dissolve never freezes a frame (src/handles.ts: slid inside the clip, slowed a little, dissolve shortened). Read
// from the song's storyboards\<platform>-<n>.json (the videos' own plans, not .previous or Try other looks), by clip.
import { readdirSync } from "node:fs";
import path from "node:path";

import { readStoryboard } from "./storyboard-file";

const PLATFORM_LABEL: Record<string, string> = { reels: "Reel", tiktok: "TikTok", shorts: "Short", youtube: "YouTube", canvas: "Canvas", standard: "Video" };

// "reels-1" -> "Reel", "reels-2" -> "Reel 2".
export function videoLabel(id: string): string {
  const m = /^(.*)-(\d+)$/.exec(id);
  const name = PLATFORM_LABEL[(m?.[1] ?? id).toLowerCase()] ?? (m?.[1] ?? id);
  return m && m[2] !== "1" ? `${name} ${m[2]}` : name;
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

// Clip name (lower case) -> its notes, e.g. "Reel, 0:53: slowed to 97% to fit the dissolve".
export function transitionNotes(songRoot: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let files: string[] = [];
  try {
    files = readdirSync(path.join(songRoot, "storyboards")).filter((f) => /^[^~]+\.json$/i.test(f) && !/\.previous\.json$/i.test(f)).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    const sb = readStoryboard(path.join(songRoot, "storyboards", f));
    if (!sb) continue;
    const label = videoLabel(f.replace(/\.json$/i, ""));
    for (const s of sb.shots) {
      for (const text of s.render?.fitNotes ?? []) {
        const key = s.clip.toLowerCase();
        const list = out.get(key) ?? [];
        const line = `${label}, ${clock(s.startMs)}: ${text}`;
        if (!list.includes(line)) list.push(line);
        out.set(key, list);
      }
    }
  }
  return out;
}
