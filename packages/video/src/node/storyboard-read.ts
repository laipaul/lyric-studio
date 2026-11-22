// Reading one saved shot plan file (storyboards\<id>.json). Kept apart from node/storyboard-file.ts on purpose: that
// file writes plans and imports manifest.ts, which loads Remotion. API routes that only read plans (the Assets tab
// via story-line.ts -> transition-notes.ts) must not pull Remotion in: in a Next.js route React has no createContext,
// so importing Remotion there breaks `next build` ("Failed to collect page data for /api/songs/[id]/assets").
import { readFileSync } from "node:fs";

import { STORYBOARD_SCHEMA, type StoryboardFile } from "../storyboard-file";

export function readStoryboard(file: string): StoryboardFile | null {
  try {
    const sb = JSON.parse(readFileSync(file, "utf8")) as StoryboardFile;
    return sb && sb.schemaVersion === STORYBOARD_SCHEMA && Array.isArray(sb.shots) ? sb : null;
  } catch {
    return null;
  }
}
