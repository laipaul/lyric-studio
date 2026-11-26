"use client";

// Lip-sync readiness on the Storyboard (26 Nov 2026, Nextgen step 2; lipsync.ts): the singing meter of a video (a Reel,
// or the whole song for YouTube / a Mini film), its singing slots with the suggested clip (Accept / Ignore / Split at a
// sung line), "Check lip sync" for all clips, and on an accepted slot "Export performance excerpt" and "Open folder".
// Suggestions only: nothing here changes cutting, timing or rendering, and nothing is generated.
import { Check, FolderOpen, Loader2, Mic, Scissors, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { LipCheck } from "@lyric/video/lipsync-check";
import type { SingingView } from "@lyric/video/lipsync";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICON: Record<LipCheck["verdict"], string> = { good: "✅", risky: "⚠️", bad: "❌" };
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

export function useSinging(projectId: string, enabled = true) {
  const [view, setView] = useState<SingingView | null>(null);
  const [kind, setKind] = useState<"short" | "full" | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await api(`/api/songs/${projectId}/singing${kind ? `?kind=${kind}` : ""}`, { cache: "no-store" });
    const d = (await r.json()) as SingingView & { error?: string };
    if (!d.error) setView(d);
  }, [projectId, kind, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { view, setView, kind: kind ?? view?.kind ?? null, setKind, load };
}

// The verdict chip on a clip card: ✅ / ⚠️ / ❌ with the best window; the reasons in its tooltip; "Check lip sync".
export function LipChip({ check, onCheck, busy, clip, sings }: { check: LipCheck | undefined; onCheck: () => void; busy: boolean; clip: string; sings: string | null }) {
  return (
    <div data-lip={clip} data-lip-verdict={check?.verdict ?? "none"} className="flex flex-wrap items-center gap-1 text-[11px]">
      {check ? (
        <span className={cn("rounded px-1", check.verdict === "good" ? "bg-emerald-400/15 text-emerald-300" : check.verdict === "risky" ? "bg-amber-400/15 text-amber-200" : "bg-red-400/10 text-red-300")} title={check.reasons.join(" · ")}>
          {ICON[check.verdict]} {check.verdict === "good" ? "lip sync" : check.verdict === "risky" ? "risky for lip sync" : "no lip sync"}
          {check.window && check.verdict !== "bad" ? ` · best ${check.window.from.toFixed(1)}–${check.window.to.toFixed(1)} s` : ""}
        </span>
      ) : null}
      {check && check.verdict !== "good" ? <span data-lip-reason className="text-muted-foreground truncate" title={check.reasons.join(" · ")}>{check.reasons[0]}</span> : null}
      {sings ? (
        <span data-lip-sings className="flex items-center gap-0.5 text-sky-300">
          <Mic className="size-3" /> {sings}
        </span>
      ) : null}
      <button type="button" data-lip-check={clip} disabled={busy} onClick={onCheck} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50">
        {check ? "check again" : "Check lip sync"}
      </button>
    </div>
  );
}

export function SingingPanel({ projectId, singing, labelOf }: { projectId: string; singing: ReturnType<typeof useSinging>; labelOf: (clip: string) => string }) {
  const { view, setView, kind, setKind } = singing;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [exported, setExported] = useState<Record<string, string>>({});
  if (!view) return null;
  const post = async (what: string, body: Record<string, unknown>) => {
    setBusy(what);
    setNotice(null);
    try {
      const r = await api(`/api/songs/${projectId}/singing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, kind }) });
      const d = (await r.json()) as (SingingView & { folder?: string; files?: string[] }) & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `The studio answered ${r.status}`);
      return d;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };
  const act = async (what: string, body: Record<string, unknown>) => {
    const d = await post(what, body);
    if (d && "matches" in d) setView(d);
  };
  const checked = Object.keys(view.checks).length;
  return (
    <section data-singing className="bg-card/40 flex flex-col gap-2 rounded-lg border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Mic className="size-4 text-sky-300" />
        <span className="text-sm font-medium" data-singing-meter>{view.meter.text}</span>
        <select data-singing-kind value={kind ?? view.kind} onChange={(e) => setKind(e.target.value as "short" | "full")} className="bg-background rounded border px-1 py-0.5" title={view.windowNote}>
          <option value="short">for a Reel (1/6)</option>
          <option value="full">for the whole song: YouTube, Mini film (1/3)</option>
        </select>
        <button type="button" data-lip-check-all disabled={!!busy} onClick={() => void act("check", { action: "check" })} className="hover:bg-accent flex items-center gap-1 rounded border px-2 py-0.5" title="Check every video clip of this song for lip sync, on this PC, free (a clip already checked and unchanged is not checked again)">
          {busy === "check" ? <Loader2 className="size-3 animate-spin" /> : null} Check lip sync (all clips)
        </button>
        <span className="text-muted-foreground">{checked ? `${checked} clip${checked === 1 ? "" : "s"} checked` : "no clip checked yet"} · suggestions only: nothing changes the videos</span>
      </div>
      {!view.timed ? <p className="text-muted-foreground">Time the lyrics in Lyrics Sync first: the singing slots follow the sung lines.</p> : null}
      {view.linesShortMs > 0 ? <p className="text-amber-200" data-singing-short>This part has only {Math.round((view.meter.targetMs - view.linesShortMs) / 1000)} s of sung lines for a {Math.round(view.meter.targetMs / 1000)} s target.</p> : null}
      {notice ? <p className={notice.ok ? "text-emerald-300" : "text-red-300"}>{notice.text}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {view.matches.map((m) => (
          <li key={m.slot.key} data-slot={m.slot.key} data-slot-state={m.accepted ? "accepted" : m.clip ? (m.full ? "suggested" : "partial") : "none"} className={cn("flex flex-wrap items-center gap-2 rounded border px-2 py-1", m.accepted ? "border-sky-400/50" : !m.clip ? "border-amber-400/40" : "")}>
            <span className="font-medium">{m.slot.label}</span>
            <span className="text-muted-foreground">
              {m.slot.lines[0] === m.slot.lines[1] ? `line ${m.slot.lines[0]}` : `lines ${m.slot.lines[0]}–${m.slot.lines[1]}`} · {clock(m.slot.fromMs)} · {((m.slot.toMs - m.slot.fromMs) / 1000).toFixed(1)} s
            </span>
            <span className={cn(!m.clip ? "text-amber-200" : "")} data-slot-text title={m.slot.reason}>
              {m.clip ? m.text.replace(m.clip, labelOf(m.clip)) : m.text}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-1">
              {m.accepted ? (
                <>
                  <button type="button" data-slot-export={m.slot.key} disabled={!!busy} onClick={async () => {
                    const d = await post("export", { action: "export", slot: m.slot.key });
                    if (d?.folder) {
                      setExported((x) => ({ ...x, [m.slot.key]: d.folder! }));
                      setNotice({ ok: true, text: `Performance excerpt saved: performance\\${d.folder}\\ (${(d.files ?? []).join(", ")}).` });
                    }
                  }} className="hover:bg-accent rounded border px-2 py-0.5" title="The vocal and the mix of these lines with 1 s before and after, and a text with the times: the same audio for every lip-sync tool">
                    Export performance excerpt
                  </button>
                  {exported[m.slot.key] ? (
                    <button type="button" data-slot-open={m.slot.key} onClick={() => void api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, performance: exported[m.slot.key] }) })} className="hover:bg-accent flex items-center gap-1 rounded border px-2 py-0.5">
                      <FolderOpen className="size-3" /> Open folder
                    </button>
                  ) : null}
                  <button type="button" data-slot-unaccept={m.slot.key} disabled={!!busy} onClick={() => void act("accept", { action: "accept", slot: m.slot.key, clip: null })} className="text-muted-foreground hover:text-foreground px-1">
                    Undo
                  </button>
                </>
              ) : m.clip ? (
                <>
                  <button type="button" data-slot-accept={m.slot.key} disabled={!!busy} onClick={() => void act("accept", { action: "accept", slot: m.slot.key, clip: m.clip })} className="hover:bg-accent flex items-center gap-1 rounded border border-sky-400/50 px-2 py-0.5">
                    <Check className="size-3" /> Accept
                  </button>
                  <button type="button" data-slot-ignore={m.slot.key} disabled={!!busy} onClick={() => void act("ignore", { action: "ignore", slot: m.slot.key, clip: m.clip })} className="hover:bg-accent flex items-center gap-1 rounded border px-2 py-0.5" title="Not this clip: suggest the next best">
                    <X className="size-3" /> Ignore
                  </button>
                </>
              ) : null}
              {m.splitAfter ? (
                <button type="button" data-slot-split={m.slot.key} disabled={!!busy} onClick={() => void act("split", { action: "split", line: m.splitAfter })} className="hover:bg-accent flex items-center gap-1 rounded border px-2 py-0.5" title="Two slots instead: the clip carries the first, the second gets its own clip">
                  <Scissors className="size-3" /> Split after line {m.splitAfter}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
