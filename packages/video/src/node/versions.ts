// Version names (11 Nov 2026): a video is called "v1", "v2", "v3"... per platform for the whole song, in the order the
// videos were made, never reused (a discarded or deleted video keeps its number; numbers only grow). The files on disk
// keep the names the run gave them (exports\<run>\reels\v1.mp4: the "variation" of THAT run), so every run restarts at
// v1 there; this registry gives each file its song-wide number:
//   <song folder>\.studio\versions.json   { "reels": { "2026-11-11_1505/reels/v1": 1, "2026-11-11_1541/reels/v1": 2 } }
// The key is "<run folder>/<platform>/<file stem>" (the platform folder is "standard" for a run's top folder). A video
// gets its number the first time it is read (the existing ones in creation order: manifest created_at, then the run
// folder, then the file stem); an entry is never removed. Tries (Compare looks) are not versions: they have no number.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { STUDIO_DIR } from "./song-folder";

export type VersionRegistry = Record<string, Record<string, number>>;

export const versionsFile = (songRoot: string) => path.join(songRoot, STUDIO_DIR, "versions.json");

export const versionKey = (run: string, platform: string, stem: string) => `${run}/${platform}/${stem}`;

export function readVersions(songRoot: string): VersionRegistry {
  try {
    const raw = JSON.parse(readFileSync(versionsFile(songRoot), "utf8")) as unknown;
    const out: VersionRegistry = {};
    if (raw && typeof raw === "object")
      for (const [platform, entries] of Object.entries(raw as Record<string, unknown>)) {
        if (!entries || typeof entries !== "object") continue;
        out[platform] = {};
        for (const [key, n] of Object.entries(entries as Record<string, unknown>)) if (typeof n === "number" && Number.isInteger(n) && n >= 1) out[platform][key] = n;
      }
    return out;
  } catch {
    return {};
  }
}

function writeVersions(songRoot: string, registry: VersionRegistry): void {
  const file = versionsFile(songRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(tmp, file); // atomic: a reader sees the old or the new file, never half of one
}

export type VersionCandidate = { run: string; platform: string; stem: string; createdAt: string };

// The number of every candidate (key -> number). The ones the registry does not know yet get the next numbers of their
// platform in creation order and are saved; a registry that cannot be written (read-only folder) still gives the same
// numbers on every read, because the order is deterministic.
export function assignVersions(songRoot: string, candidates: readonly VersionCandidate[]): Map<string, number> {
  const registry = readVersions(songRoot);
  const fresh = candidates
    .filter((c) => registry[c.platform]?.[versionKey(c.run, c.platform, c.stem)] === undefined)
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.run.localeCompare(b.run, undefined, { numeric: true }) || a.stem.localeCompare(b.stem, undefined, { numeric: true }));
  if (fresh.length) {
    // Re-read right before writing: another process may have added numbers meanwhile.
    const latest = readVersions(songRoot);
    for (const c of fresh) {
      const entries = (latest[c.platform] ??= {});
      const key = versionKey(c.run, c.platform, c.stem);
      if (entries[key] === undefined) entries[key] = Math.max(0, ...Object.values(entries)) + 1;
    }
    try {
      if (existsSync(songRoot)) writeVersions(songRoot, latest);
    } catch {
      /* the numbers are still the same on the next read */
    }
    Object.assign(registry, latest);
  }
  const out = new Map<string, number>();
  for (const c of candidates) {
    const n = registry[c.platform]?.[versionKey(c.run, c.platform, c.stem)];
    if (n !== undefined) out.set(versionKey(c.run, c.platform, c.stem), n);
  }
  return out;
}
