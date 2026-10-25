"use client";

import { Popover } from "radix-ui";
import { useRef, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export type BadgeStatus = "PASS" | "WARN" | "FAILED" | "interrupted" | "Rendering" | "none";

export const STATUS_STYLE: Record<BadgeStatus, string> = {
  PASS: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  WARN: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  FAILED: "border-red-400/30 bg-red-400/10 text-red-300",
  interrupted: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  Rendering: "border-brand/40 bg-brand/10 text-brand animate-pulse",
  none: "border-border text-muted-foreground/60",
};

const TITLES: Record<BadgeStatus, string> = {
  PASS: "QA passed",
  WARN: "QA warnings",
  FAILED: "Failed",
  interrupted: "Interrupted",
  Rendering: "Rendering",
  none: "Not made yet",
};

// A status badge. For WARN / FAILED / interrupted the reasons open on hover, and stay open on click
// (inside a link the click does not follow the link). Interrupted: the command that resumes the run.
export function StatusBadge({
  status,
  children,
  details = [],
  resumeCommand,
  heading,
  className,
}: {
  status: BadgeStatus;
  children: React.ReactNode;
  details?: string[];
  resumeCommand?: string | null;
  heading?: string;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explains = status === "WARN" || status === "FAILED" || status === "interrupted";
  const badge = (
    <span data-status={status} className={cn("flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-[11px]", STATUS_STYLE[status], explains && "cursor-help", className)}>
      {children}
    </span>
  );
  if (!explains) return badge;
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
        {badge}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          onMouseEnter={enter}
          onMouseLeave={exit}
          onClick={(e) => e.stopPropagation()}
          data-reasons
          className="bg-popover z-50 max-w-sm rounded-lg border p-3 text-xs shadow-xl"
        >
          <p className="mb-1.5 font-medium">{heading ?? TITLES[status]}</p>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4">
            {(details.length ? details : ["No details recorded."]).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          {resumeCommand ? (
            <div className="mt-3 flex flex-col gap-2 border-t pt-3">
              <p>Resume: run this in the terminal to make only the missing videos (one click in Step 6.2b).</p>
              <code className="bg-muted block rounded p-2 text-[11px] break-all">{resumeCommand}</code>
              <CopyButton text={resumeCommand} label="Copy command" className="self-start" />
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
