"use client";

// "Copy shot prompt" (Persona, 26 Nov 2026): on a Storyboard clip card and on an accepted singing slot. The text comes
// from /api/songs/<id>/shot-prompt (identity + persona + the section's line + the song note + the lyric + lip-sync
// framing for a sung shot). Copy only: nothing is generated or changed.
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyShotPrompt({ projectId, clip, slot, className }: { projectId: string; clip?: string; slot?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setState("busy");
    setError(null);
    try {
      const r = await fetch(`/api/songs/${projectId}/shot-prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(slot ? { slot } : { clip }) });
      const j = (await r.json()) as { text?: string; error?: string };
      if (!r.ok || !j.text) throw new Error(j.error ?? "Could not write the prompt.");
      try {
        await navigator.clipboard.writeText(j.text);
      } catch {
        const t = document.createElement("textarea");
        t.value = j.text;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
      }
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };
  return (
    <span className="flex flex-col gap-0.5">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => void copy()}
        data-copy-shot-prompt={slot ?? clip}
        title="Copy a prompt for this shot: who it is (identity), how they act (persona), what they feel in this part of the song, the lyric, and lip-sync framing for a sung shot"
        className={className ?? "hover:bg-accent text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 rounded border px-2 py-0.5 text-[11px]"}
      >
        {state === "copied" ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />} {state === "copied" ? "Copied" : "Copy shot prompt"}
      </button>
      {error ? (
        <span className="text-[11px] text-amber-300" data-copy-shot-prompt-error>
          {error}
        </span>
      ) : null}
    </span>
  );
}
