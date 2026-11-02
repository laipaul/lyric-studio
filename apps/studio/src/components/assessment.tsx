"use client";

// The pro assessment (Step C): one verdict per video (✅ Ready to post / 🟡 Good / 🔴 Not ready), at most a
// few points in plain words with the creative action for each, what the app handled by itself, and the
// technical checks one click away.
import { Popover } from "radix-ui";
import { useRef, useState } from "react";

import type { Assessment } from "@lyric/video";

import { cn } from "@/lib/utils";

export const VERDICT_STYLE: Record<Assessment["verdict"], string> = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  good: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  "not-ready": "border-red-400/30 bg-red-400/10 text-red-300",
};
export const VERDICT_ICON: Record<Assessment["verdict"], string> = { ready: "✅", good: "🟡", "not-ready": "🔴" };
export const VERDICT_TEXT: Record<Assessment["verdict"], string> = { ready: "Ready to post", good: "Good", "not-ready": "Not ready" };

export function AssessmentDetails({ a, technical, limit = 3, handled = true }: { a: Assessment; technical?: string[]; limit?: number; handled?: boolean }) {
  const shown = a.points.slice(0, limit);
  const more = a.points.length - shown.length;
  return (
    <div className="flex flex-col gap-2 text-xs" data-assessment-details>
      <p className="font-medium" data-assessment-headline>
        {VERDICT_ICON[a.verdict]} {a.headline}
      </p>
      {shown.length ? (
        <ol className="flex list-decimal flex-col gap-1.5 pl-4">
          {shown.map((p) => (
            <li key={p.code} data-assessment-point={p.code}>
              <span className={p.major ? "text-red-200" : ""}>{p.text}</span>
              <span className="text-muted-foreground block">→ {p.action}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {more > 0 ? <p className="text-muted-foreground">+ {more} more (see the technical checks)</p> : null}
      {a.accepted.length ? (
        <p className="text-muted-foreground" data-assessment-accepted>
          You usually accept: {a.accepted.map((p) => p.text).join(" ")}
        </p>
      ) : null}
      {handled && a.handled.length ? (
        <div className="text-muted-foreground border-t pt-2" data-assessment-handled>
          <p className="text-foreground/80">Handled by the app:</p>
          {a.handled.map((h) => (
            <p key={h}>✔ {h}</p>
          ))}
        </div>
      ) : null}
      {technical?.length ? (
        <details className="text-muted-foreground border-t pt-2">
          <summary className="cursor-pointer">Show the technical checks</summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {technical.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// The verdict badge: its details open on hover and stay open on click.
export function VerdictBadge({ a, technical, heading, className }: { a: Assessment; technical?: string[]; heading?: string; className?: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (leave.current) clearTimeout(leave.current);
    setHover(true);
  };
  const exit = () => {
    leave.current = setTimeout(() => setHover(false), 150);
  };
  return (
    <Popover.Root open={hover || pinned} onOpenChange={(o) => (!o ? (setPinned(false), setHover(false)) : undefined)}>
      <Popover.Trigger
        asChild
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onMouseEnter={enter}
        onMouseLeave={exit}
      >
        <span data-verdict={a.verdict} className={cn("flex cursor-help items-center gap-1 rounded-md border px-2 py-1 text-[11px]", VERDICT_STYLE[a.verdict], className)}>
          {VERDICT_ICON[a.verdict]} {VERDICT_TEXT[a.verdict]}
          {a.points.length ? ` · ${a.points.length}` : ""}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={6} collisionPadding={12} onMouseEnter={enter} onMouseLeave={exit} onClick={(e) => e.stopPropagation()} data-reasons className="bg-popover z-50 max-w-sm rounded-lg border p-3 shadow-xl">
          {heading ? <p className="text-muted-foreground mb-1 text-[11px]">{heading}</p> : null}
          <AssessmentDetails a={a} technical={technical} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// A platform run's summary next to its heading: the worst verdict of its videos, in plain words.
// Nothing for a single video (its own badge says it).
export function PlatformVerdict({ videos }: { videos: { assessment: Assessment }[] }) {
  if (videos.length < 2) return null;
  const order: Assessment["verdict"][] = ["ready", "good", "not-ready"];
  const worst = videos.reduce<Assessment["verdict"]>((w, v) => (order.indexOf(v.assessment.verdict) > order.indexOf(w) ? v.assessment.verdict : w), "ready");
  const n = videos.filter((v) => v.assessment.verdict === worst).length;
  const text = worst === "ready" ? `All ${videos.length} ready to post` : worst === "good" ? `${n} of ${videos.length} could be better` : `${n} of ${videos.length} not ready`;
  return (
    <span data-platform-verdict={worst} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]", VERDICT_STYLE[worst])}>
      {VERDICT_ICON[worst]} {text}
    </span>
  );
}
