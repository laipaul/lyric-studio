// The shot list against the song's timing (23 Nov 2026): a checked shot list gets warnings (never errors) for shots
// longer than one take or only a flash, from the lyric times as the next video has them (shot-grid.ts timingNotes).
import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { timingNotes } from "../shot-grid";
import { timedLines } from "./production";
import type { ShotListCheck } from "./shotlist";

export async function withTiming(ws: Workspace, projectId: string, check: ShotListCheck): Promise<ShotListCheck> {
  if (!check.slots.length) return check;
  const duration = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()?.duration_ms ?? null;
  const timed = await timedLines(ws, projectId).catch(() => null);
  if (!duration || !timed?.some((l) => l.startMs !== null)) return check;
  const notes = timingNotes(check.slots, timed, duration);
  return { ...check, problems: [...check.problems, ...notes.map((n) => ({ slot: n.slot, level: "warn" as const, text: n.text }))] };
}
