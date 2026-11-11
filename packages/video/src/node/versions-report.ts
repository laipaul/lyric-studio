// pnpm versions <song title or id>: what every video of a song is called now (versions.ts). Reads only.
import { project as projectTable, type Workspace } from "@lyric/db";

import { songRuns } from "./exports";

export function findSongByTitleOrId(ws: Workspace, query: string): { id: string; title: string } {
  const all = ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all();
  const q = query.trim().toLowerCase();
  const exact = all.filter((p) => p.id === query || p.title.toLowerCase() === q);
  const found = exact.length ? exact : all.filter((p) => p.title.toLowerCase().includes(q));
  if (!found.length) throw new Error(`No song matches "${query}". Songs: ${all.map((p) => p.title).join(", ") || "(none)"}`);
  if (found.length > 1) throw new Error(`"${query}" matches several songs: ${found.map((p) => p.title).join(", ")}. Type more of the title (or the id).`);
  return found[0];
}

// One line per video: "exports\<run>\reels\v1.mp4 -> v3 (approved, ★)", per platform, oldest first.
export function versionsReport(ws: Workspace, projectId: string, title: string): string {
  const runs = songRuns(ws, projectId);
  const byPlatform = new Map<string, string[]>();
  for (const run of runs)
    for (const p of run.platforms)
      for (const v of p.videos) {
        const file = ["exports", run.folder, ...(p.name === "standard" ? [] : [p.name]), `${v.file}.mp4`].join("\\");
        const marks = [v.mark.status !== "generated" ? v.mark.status : null, v.mark.favourite ? "★" : null].filter(Boolean).join(", ");
        const name = v.try ? `${v.name} (a try, based on ${v.basedOn ?? "?"}; not a version)` : v.name;
        const list = byPlatform.get(p.name) ?? [];
        list.push(`  ${file} -> ${name}${marks ? ` (${marks})` : ""}`);
        byPlatform.set(p.name, list);
      }
  if (!byPlatform.size) return `${title}: no videos yet.`;
  return [`${title}: the names the studio shows now (the files on disk are not renamed)`, ...[...byPlatform].flatMap(([platform, lines]) => ["", `${platform}`, ...lines])].join("\n");
}
