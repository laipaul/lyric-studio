"use client";

import { ListChecks, Square, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Tasks } from "@lyric/video/runs";

import { cn } from "@/lib/utils";

type Run = Tasks["runs"][number];
const ACTIVE = new Set(["queued", "running"]);
const STATUS: Record<string, { text: string; style: string }> = {
  queued: { text: "waiting", style: "text-muted-foreground" },
  running: { text: "making", style: "text-brand" },
  done: { text: "done", style: "text-emerald-300" },
  failed: { text: "failed", style: "text-red-300" },
  stopped: { text: "stopped", style: "text-orange-300" },
  interrupted: { text: "interrupted", style: "text-orange-300" },
};

// The header's Tasks menu: live progress of the runs started from the studio (and of runs started in
// the terminal). It refreshes the page when a run finishes, so new videos appear by themselves.
export function TasksMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Tasks>({ runs: [], terminal: [] });
  const last = useRef<Map<string, string>>(new Map());
  const terminalCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks", { cache: "no-store" });
      if (!r.ok) return;
      const next = (await r.json()) as Tasks;
      // A run finished (or a terminal run ended): show its videos.
      const finished = next.runs.some((run) => ACTIVE.has(last.current.get(run.id) ?? "") && !ACTIVE.has(run.status));
      if (finished || next.terminal.length < terminalCount.current) router.refresh();
      last.current = new Map(next.runs.map((run) => [run.id, run.status]));
      terminalCount.current = next.terminal.length;
      setTasks(next);
    } catch {
      // the studio is restarting: try again on the next tick
    }
  }, [router]);

  const active = tasks.runs.filter((r) => ACTIVE.has(r.status)).length + tasks.terminal.length;
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, active || open ? 1500 : 5000);
    const nudge = () => {
      void load();
      setOpen(true);
    };
    window.addEventListener("lyric-tasks-changed", nudge);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("lyric-tasks-changed", nudge);
    };
  }, [load, active, open]);

  const stop = async (run: Run) => {
    await fetch("/api/runs/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: run.id }) });
    void load();
  };

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
        aria-expanded={open}
        data-tasks-button
      >
        <ListChecks className="size-4" /> Tasks
        {active ? <span className="bg-brand text-primary-foreground rounded-full px-1.5 text-[11px] font-semibold tabular-nums">{active}</span> : null}
      </button>
      {open ? (
        <div data-tasks className="bg-popover absolute right-0 z-40 mt-2 flex max-h-[70vh] w-96 flex-col gap-3 overflow-y-auto rounded-lg border p-4 text-sm shadow-xl">
          {!tasks.runs.length && !tasks.terminal.length ? (
            <div>
              <p className="font-medium">No tasks</p>
              <p className="text-muted-foreground mt-1 text-xs">Press Generate on a song page; its progress shows here.</p>
            </div>
          ) : null}
          {tasks.terminal.map((t) => {
            const done = t.videos.filter((v) => v.status !== "queued").length;
            const progress = t.videos.reduce((a, v) => a + v.progress, 0) / Math.max(1, t.videos.length);
            return (
              <div key={`${t.projectId}-${t.run}`} data-task="terminal" className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/songs/${t.projectId}`} className="truncate font-medium hover:underline">
                    {t.title}
                  </Link>
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Terminal className="size-3" /> terminal
                  </span>
                </div>
                <Bar value={progress} />
                <p className="text-muted-foreground text-xs">
                  {t.platforms.join(", ")} · {done} of {t.videos.length} started
                </p>
              </div>
            );
          })}
          {tasks.runs.map((run) => (
            <div key={run.id} data-task={run.status} className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/songs/${run.project_id}`} className="truncate font-medium hover:underline" onClick={() => setOpen(false)}>
                  {run.title}
                </Link>
                <span className={cn("text-xs", STATUS[run.status]?.style)}>{STATUS[run.status]?.text ?? run.status}</span>
              </div>
              <p className="text-muted-foreground text-xs">{run.label}</p>
              {ACTIVE.has(run.status) || run.progress < 1 ? <Bar value={run.status === "queued" ? 0 : run.progress} /> : null}
              {run.current ? <p className="text-xs">{run.current}</p> : null}
              {run.message && !ACTIVE.has(run.status) ? <p className="text-muted-foreground text-xs whitespace-pre-line">{run.message}</p> : null}
              {ACTIVE.has(run.status) && !run.stop_requested ? (
                <button type="button" onClick={() => stop(run)} className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs">
                  <Square className="size-3" /> {run.status === "queued" ? "Cancel" : "Stop after this video"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
      <div className="bg-brand h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}
