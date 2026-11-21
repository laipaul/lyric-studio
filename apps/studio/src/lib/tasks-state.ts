"use client";

// The online takes the Tasks menu last read (it polls /api/tasks: every 1.5 s while something runs, else every 5 s),
// shared with the song page so a tab can show what is being made without a second poll (running-task badge on
// Creation and Lyrics Sync, 21 Nov 2026).
import { useSyncExternalStore } from "react";

export type TakeTaskState = { project_id: string; kind: "singing" | "animate"; status: string };

let takes: readonly TakeTaskState[] = [];
const listeners = new Set<() => void>();

export function publishTakes(next: readonly TakeTaskState[]): void {
  takes = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// How many takes of this kind are being made for this song now.
export function useRunningTakes(projectId: string | undefined, kind: TakeTaskState["kind"]): number {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? takes.filter((t) => t.project_id === projectId && t.kind === kind && t.status === "running").length : 0),
    () => 0,
  );
}

// Opens the Tasks menu (it listens for this event).
export const openTasks = () => window.dispatchEvent(new Event("lyric-tasks-changed"));
