// The Tasks menu's online takes (Paul, 21 Nov 2026: "when the video is being made, add it to the task in the queue"):
// every singing take (Lyrics Sync → Make singing clips) and Animate take (Creation) of every song, while it is being
// made and for a day after, read from each song's pictures\pictures.json, so the list survives a restart of the
// studio (a take that was being made when the studio stopped shows as interrupted, with Get result, free, in
// Creation). "Clear finished" hides finished ones (the take and its file stay).
import { existsSync } from "node:fs";
import path from "node:path";

import { project as projectTable, type Workspace } from "@lyric/db";

import { markInterrupted, PICTURES_DIR, PICTURES_FILE, readPictures, update, type Take } from "./animate";
import { takeSeconds, takeSent } from "../take-facts";
import { processAlive } from "./jobs";
import { songPathsById } from "./song-folder";

export type GenerateTask = {
  id: string; // <song id>:<picture or video>:<take n>
  project_id: string;
  title: string; // the song
  kind: "singing" | "animate";
  what: string; // "Singing · lines 9-14 · Bride smile" / "Animate · Bride smile · take 3"
  model: string; // "WaveSpeed · InfiniteTalk"
  cost_usd: number;
  seconds: number;
  sent: boolean; // reached the service (else nothing was spent)
  ended_at: string | null;
  status: "running" | "done" | "failed" | "interrupted";
  message: string | null; // the reason in plain words (failed / interrupted)
  href: string; // where it lands: Lyrics Sync for a singing take, Creation for an Animate take
  started_at: string;
};

export const RECENT_MS = 24 * 3600 * 1000; // finished takes stay listed for a day (or until Clear finished)
const SERVICE: Record<string, string> = { wavespeed: "WaveSpeed", higgsfield: "Higgsfield" };

function picturesDir(ws: Workspace, projectId: string): string | null {
  try {
    const paths = songPathsById(ws, projectId);
    if (paths.legacy) return null;
    const dir = path.join(paths.root, PICTURES_DIR);
    return existsSync(path.join(dir, PICTURES_FILE)) ? dir : null;
  } catch {
    return null;
  }
}

export function listGenerateTasks(ws: Workspace, now = Date.now(), isAlive: (pid: number) => boolean = processAlive): GenerateTask[] {
  const out: GenerateTask[] = [];
  for (const p of ws.db.select({ id: projectTable.id, title: projectTable.title }).from(projectTable).all()) {
    const dir = picturesDir(ws, p.id);
    if (!dir) continue;
    markInterrupted(dir, isAlive);
    for (const [file, rec] of Object.entries(readPictures(dir).pictures)) {
      for (const t of rec.takes) {
        if (t.cleared) continue;
        if (t.status !== "running" && !(now - Date.parse(t.ended_at ?? t.started_at) < RECENT_MS)) continue;
        out.push(taskOf(p, file, rec.label, t));
      }
    }
  }
  // Being made first, then the newest.
  return out.sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 30);
}

function taskOf(p: { id: string; title: string }, file: string, label: string | undefined, t: Take): GenerateTask {
  const name = label ?? file;
  const singing = t.kind === "lipsync";
  const lines = t.through && t.line && t.through > t.line ? `lines ${t.line}-${t.through}` : `line ${t.line}`;
  return {
    id: `${p.id}:${file}:${t.n}`,
    project_id: p.id,
    title: p.title,
    kind: singing ? "singing" : "animate",
    what: singing ? `Singing · ${lines} · ${name}` : `Animate · ${name} · take ${t.n}${t.label ? ` (${t.label})` : ""}`,
    model: `${SERVICE[t.service] ?? t.service} · ${t.model}`,
    cost_usd: t.cost_usd,
    seconds: takeSeconds(t),
    sent: takeSent(t),
    ended_at: t.ended_at ?? null,
    status: t.status as GenerateTask["status"],
    message: t.error ?? null,
    href: singing ? `/songs/${p.id}?tab=lyrics` : `/songs/${p.id}?tab=production`,
    started_at: t.started_at,
  };
}

// "Clear finished": finished takes leave the list (the takes and their files stay in Creation).
export function clearFinishedGenerateTasks(ws: Workspace): number {
  let n = 0;
  for (const p of ws.db.select({ id: projectTable.id }).from(projectTable).all()) {
    const dir = picturesDir(ws, p.id);
    if (!dir) continue;
    for (const [file, rec] of Object.entries(readPictures(dir).pictures)) {
      const ns = rec.takes.filter((t) => !t.cleared && t.status !== "running").map((t) => t.n);
      if (!ns.length) continue;
      update(dir, file, (r) => {
        for (const t of r.takes) if (ns.includes(t.n)) t.cleared = true;
      });
      n += ns.length;
    }
  }
  return n;
}
