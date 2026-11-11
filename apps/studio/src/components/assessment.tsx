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
// The app's quality verdict in words (11 Nov 2026): "Ready to post" is said only of a video the user approved.
export const VERDICT_TEXT: Record<Assessment["verdict"], string> = { ready: "Excellent", good: "Good", "not-ready": "Could be better" };
const SUMMARY_WORD: Record<Assessment["verdict"], string> = { ready: "excellent", good: "good", "not-ready": "could be better" };
// The headline in the same words: "Excellent: nothing a viewer would notice" (approved: "Ready to post"), "Good — 2 to
// improve", "Could be better — fix 1 first".
export function headlineOf(a: Assessment, approved = false): string {
  const note = /\s\(prediction before rendering\)$/.exec(a.headline)?.[0] ?? ""; // Shape's prediction keeps saying so
  if (a.verdict === "ready") return `${approved ? "Ready to post" : "Excellent: nothing a viewer would notice"}${note}`;
  return a.headline.replace(/^Not ready\b/, "Could be better");
}

export function AssessmentDetails({ a, technical, limit = 3, handled = true, approved = false }: { a: Assessment; technical?: string[]; limit?: number; handled?: boolean; approved?: boolean }) {
  const shown = a.points.slice(0, limit);
  const more = a.points.length - shown.length;
  return (
    <div className="flex flex-col gap-2 text-xs" data-assessment-details>
      <p className="font-medium" data-assessment-headline>
        {VERDICT_ICON[a.verdict]} {headlineOf(a, approved)}
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
// approved: the user approved this video: its badge says "Ready to post" (before that: the app's quality verdict).
export function VerdictBadge({ a, technical, heading, className, approved = false }: { a: Assessment; technical?: string[]; heading?: string; className?: string; approved?: boolean }) {
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
        <span data-verdict={a.verdict} data-verdict-text={approved ? "Ready to post" : VERDICT_TEXT[a.verdict]} className={cn("flex cursor-help items-center gap-1 rounded-md border px-2 py-1 text-[11px]", approved ? VERDICT_STYLE.ready : VERDICT_STYLE[a.verdict], className)}>
          {approved ? "✅ Ready to post" : `${VERDICT_ICON[a.verdict]} ${VERDICT_TEXT[a.verdict]}`}
          {a.points.length ? ` · ${a.points.length}` : ""}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={6} collisionPadding={12} onMouseEnter={enter} onMouseLeave={exit} onClick={(e) => e.stopPropagation()} data-reasons className="bg-popover z-50 max-w-sm rounded-lg border p-3 shadow-xl">
          {heading ? <p className="text-muted-foreground mb-1 text-[11px]">{heading}</p> : null}
          <AssessmentDetails a={a} technical={technical} approved={approved} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// A platform's summary next to its heading (11 Nov 2026): the app's quality in the badges' words and how many the
// user approved, like the stage line ("All 3 good · 0 approved", "1 of 3 could be better · 2 approved"). Nothing for a
// single video (its own badge says it).
export function PlatformVerdict({ videos }: { videos: { assessment: Assessment; mark?: { status: string } }[] }) {
  if (videos.length < 2) return null;
  const order: Assessment["verdict"][] = ["ready", "good", "not-ready"];
  const worst = videos.reduce<Assessment["verdict"]>((w, v) => (order.indexOf(v.assessment.verdict) > order.indexOf(w) ? v.assessment.verdict : w), "ready");
  const n = videos.filter((v) => v.assessment.verdict === worst).length;
  const approved = videos.filter((v) => v.mark?.status === "approved").length;
  const quality = worst === "not-ready" ? `${n} of ${videos.length} ${SUMMARY_WORD[worst]}` : `All ${videos.length} ${SUMMARY_WORD[worst]}`;
  return (
    <span data-platform-verdict={worst} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]", VERDICT_STYLE[worst])}>
      {VERDICT_ICON[worst]} {quality} · {approved} approved
    </span>
  );
}
