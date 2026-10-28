// Each clip's best moment: the strongest 2 s by motion, colour and contrast (as the Spotify Canvas picks
// its loop), cached in workspace\cache\best-moments.json by file, size and date. A best moment set in
// the clip editor (clips.json "best") always wins over this one.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CANVAS, strongestWindows } from "../canvas";
import { BEST_WINDOW_MS } from "../shots";
import { clipStats } from "./canvas";

// Seconds into each file (null: no clear best moment, e.g. too short); measured once per file version.
export async function bestMoments(workspaceDir: string, files: readonly string[], log: (m: string) => void = () => {}): Promise<Map<string, number | null>> {
  const cacheFile = path.join(workspaceDir, "cache", "best-moments.json");
  let cache: Record<string, number | null> = {};
  try {
    cache = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number | null>) : {};
  } catch {
    cache = {};
  }
  const keyOf = (file: string) => {
    const st = statSync(file);
    return `${file}|${st.size}|${Math.round(st.mtimeMs)}`;
  };
  const todo = files.filter((f) => existsSync(f) && !(keyOf(f) in cache));
  if (todo.length) log(`best moments: measuring ${todo.length} clip(s) (cached afterwards)`);
  for (const file of todo) {
    try {
      const stats = await clipStats(file);
      const best = strongestWindows([{ name: file, stats }], (BEST_WINDOW_MS / 1000) * CANVAS.sampleFps)[0];
      cache[keyOf(file)] = best ? Math.round((best.startSample / CANVAS.sampleFps) * 10) / 10 : null;
    } catch {
      cache[keyOf(file)] = null;
    }
  }
  if (todo.length) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return new Map(files.map((f) => [f, existsSync(f) ? (cache[keyOf(f)] ?? null) : null]));
}
