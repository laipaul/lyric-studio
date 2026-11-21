"use client";

import { Eraser, ListChecks, Mic, RotateCw, Sparkles, Square, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardTask } from "@lyric/video/characters";
import type { GenerateTask } from "@lyric/video/generate-tasks";
import { takeWhen } from "@lyric/video/take-facts";
import type { Tasks as RunTasks } from "@lyric/video/runs";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type Tasks = RunTasks & { cards: CardTask[]; takes: GenerateTask[] };
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
const TAKE_STATUS: Record<string, string> = { running: "being made", done: "done", failed: "failed", interrupted: "interrupted" };

// The header's Tasks menu: live progress of the runs started from the studio (and of runs started in
// the terminal). It refreshes the page when a run finishes, so new videos appear by themselves.
export function TasksMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Tasks>({ runs: [], terminal: [], cards: [], takes: [] });
  const last = useRef<Map<string, string>>(new Map());
  const terminalCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api("/api/tasks", { cache: "no-store" });
      if (!r.ok) return;
      const next = (await r.json()) as Tasks;
      next.cards ??= [];
      next.takes ??= [];
      // A run finished (or a terminal run ended): show its videos.
      const finished = [...next.runs, ...next.cards, ...next.takes].some((run) => ACTIVE.has(last.current.get(run.id) ?? "") && !ACTIVE.has(run.status));
      if (finished || next.terminal.length < terminalCount.current) router.refresh();
      last.current = new Map([...next.runs, ...next.cards, ...next.takes].map((run) => [run.id, run.status]));
      terminalCount.current = next.terminal.length;
      setTasks(next);
    } catch {
      // the studio is restarting: try again on the next tick
    }
  }, [router]);

  const active = tasks.runs.filter((r) => ACTIVE.has(r.status)).length + tasks.terminal.length + tasks.cards.filter((c) => ACTIVE.has(c.status)).length + tasks.takes.filter((t) => t.status === "running").length;
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

  // Clear finished: done / failed / never-started entries at once; stopped ones that can still Resume
  // only after the question. Only the list entries go (the videos and files stay).
  const [askStopped, setAskStopped] = useState(0);
  const clear = async (includeStopped: boolean) => {
    const r = await api("/api/tasks/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeStopped }) });
    const result = (await r.json()) as { cleared: number; resumable: number };
    setAskStopped(includeStopped ? 0 : result.resumable);
    void load();
  };
  const finishedCount = tasks.runs.filter((r) => !ACTIVE.has(r.status)).length + tasks.cards.filter((c) => !ACTIVE.has(c.status)).length + tasks.takes.filter((t) => t.status !== "running").length;
  const stopCard = async (job: CardTask) => {
    await api(`/api/cards/${job.card_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", job: job.id }) });
    void load();
  };

  const stop = async (run: Run) => {
    await api("/api/runs/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: run.id }) });
    void load();
  };

  // Resume: queues the missing videos (also platforms that never started) into the run's own folder.
  const [resuming, setResuming] = useState<Set<string>>(new Set());
  const [resumeError, setResumeError] = useState<Record<string, string>>({});
  const resume = async (run: Run) => {
    const folder = run.export_dir?.split(/[\\/]/).filter(Boolean).pop();
    if (!folder) return;
    setResuming((s) => new Set(s).add(run.id));
    setResumeError((e) => ({ ...e, [run.id]: "" }));
    try {
      const r = await api("/api/runs/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: run.project_id, folder }) });
      const body = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Could not resume");
      window.dispatchEvent(new Event("lyric-tasks-changed"));
    } catch (e) {
      setResumeError((m) => ({ ...m, [run.id]: (e as Error).message }));
    } finally {
      setResuming((s) => {
        const n = new Set(s);
        n.delete(run.id);
        return n;
      });
      void load();
    }
  };

  // Closes on a click outside (the panel and the Tasks button stay open) and on Escape.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative ml-auto">
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
          {!tasks.runs.length && !tasks.terminal.length && !tasks.cards.length && !tasks.takes.length ? (
            <div>
              <p className="font-medium">No tasks</p>
              <p className="text-muted-foreground mt-1 text-xs">Press Generate on a song page; its progress shows here.</p>
            </div>
          ) : null}
          {finishedCount || askStopped ? (
            <div className="flex flex-col gap-2">
              {finishedCount ? (
                <button type="button" data-clear-finished onClick={() => clear(false)} className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 self-end text-xs">
                  <Eraser className="size-3" /> Clear finished
                </button>
              ) : null}
              {askStopped ? (
                <div data-clear-ask className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2 text-xs">
                  <p>
                    {askStopped} stopped task{askStopped === 1 ? "" : "s"} can still resume — clear {askStopped === 1 ? "it" : "them"} too?
                  </p>
                  <div className="flex gap-3">
                    <button type="button" data-clear-stopped onClick={() => clear(true)} className="text-brand hover:underline">
                      Clear {askStopped === 1 ? "it" : "them"} too
                    </button>
                    <button type="button" onClick={() => setAskStopped(0)} className="text-muted-foreground hover:text-foreground">
                      Keep
                    </button>
                  </div>
                </div>
              ) : null}
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
          {tasks.takes.map((t) => (
            <div key={t.id} data-task={t.status} data-take-task={t.kind} className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <Link href={t.href} className="truncate font-medium hover:underline" onClick={() => setOpen(false)}>
                  {t.title}
                </Link>
                <span className={cn("text-xs", STATUS[t.status]?.style)}>{TAKE_STATUS[t.status] ?? t.status}</span>
              </div>
              <p className="flex items-center gap-1 text-xs">
                {t.kind === "singing" ? <Mic className="text-brand size-3 shrink-0" /> : <Sparkles className="text-brand size-3 shrink-0" />}
                <span className="truncate">{t.what}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {t.model} · {t.seconds} s · {t.sent ? `about $${t.cost_usd.toFixed(2)}` : "nothing spent"} · {t.status === "running" ? "sent " : ""}
                {takeWhen(t)}
              </p>
              {t.status === "running" ? <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className="bg-brand h-full w-1/3 animate-pulse rounded-full" /></div> : null}
              {t.message && t.status !== "running" ? <p className="text-muted-foreground text-xs">{t.message}</p> : null}
            </div>
          ))}
          {tasks.cards.map((job) => (
            <div key={job.id} data-task={job.status} data-card-task={job.kind} className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/characters/${job.card_id}`} className="truncate font-medium hover:underline" onClick={() => setOpen(false)}>
                  {job.cardName}
                </Link>
                <span className={cn("text-xs", STATUS[job.status]?.style)}>{STATUS[job.status]?.text ?? job.status}</span>
              </div>
              <p className="text-muted-foreground text-xs">{job.label}</p>
              {ACTIVE.has(job.status) ? <Bar value={job.status === "queued" ? 0 : job.progress} /> : null}
              {job.current && ACTIVE.has(job.status) ? <p className="text-xs">{job.current}</p> : null}
              {job.message && !ACTIVE.has(job.status) ? <p className="text-muted-foreground text-xs whitespace-pre-line">{job.message}</p> : null}
              {ACTIVE.has(job.status) ? (
                <Button type="button" size="sm" variant="outline" onClick={() => stopCard(job)} className="w-fit" data-stop-card>
                  <Square /> {job.status === "queued" ? "Cancel" : "Stop after this picture"}
                </Button>
              ) : null}
            </div>
          ))}
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
              {ACTIVE.has(run.status) ? (
                <Button type="button" size="sm" variant="outline" disabled={run.stop_requested} onClick={() => stop(run)} className="w-fit" data-stop={run.stop_requested ? "requested" : "ready"}>
                  <Square /> {run.stop_requested ? "Stopping after this video…" : run.status === "queued" ? "Cancel" : "Stop after this video"}
                </Button>
              ) : null}
              {run.resumable ? (
                <Button type="button" size="sm" variant="outline" disabled={resuming.has(run.id)} onClick={() => resume(run)} className="w-fit" data-resume>
                  <RotateCw /> {resuming.has(run.id) ? "Queuing…" : "Resume"}
                </Button>
              ) : null}
              {resumeError[run.id] ? <p className="text-xs text-red-300" data-resume-error>{resumeError[run.id]}</p> : null}
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
