"use client";

// Performance script (Part B, 26 Nov 2026): Prepare → Production. The app hears the track (music cues, local), Claude
// reads the lyric's meaning (Copy script request → claude.ai → Paste script), the persona decides how the singer shows
// it, Paul approves (edit, mark checked); every Copy shot prompt then carries the line's direction. Stale entries (the
// lyrics or timing changed since the paste) are marked and never used. Copy only: no cut, timing or render change.
import { AlertTriangle, Check, ClipboardPaste, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScriptEntry, ScriptScope } from "@lyric/video/performance-script";

type Cue = { level: number; level_word: string; trend: string; density: string; events: { type: string; at_ms: number; to_ms?: number }[]; contrast: string | null; vocal: string | null } | null;
type Cues = { stems: "demucs" | "bands"; vocals: boolean; duration_ms: number; energy: number[]; events: { type: string; at_ms: number }[]; made_at: string; segments: { key: string; cue: Cue }[] } | null;
type Entry = ScriptEntry & { stale: string | null; time: string; text: string; section: string | null };
type View = { script: { singsTo: string; objective: string; lastPaste?: { at: string; unrecognised: string[] } } | null; entries: Entry[]; segments: number; cues: Cues };

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
export function cueWords(c: Cue): string {
  if (!c) return "";
  return [c.events.map((e) => `${e.type} ${clock(e.at_ms)}`).join(", "), `${c.level_word}${c.trend === "steady" ? "" : `, ${c.trend}`}`, c.density, c.contrast && c.contrast !== "balanced" ? c.contrast : null, c.vocal ? `vocal ${c.vocal}` : null].filter(Boolean).join("; ");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

const FIELDS: [keyof ScriptEntry, string][] = [
  ["singer", "Singer"],
  ["meaning", "Meaning"],
  ["emotion", "Emotion"],
  ["beatChange", "Beat change"],
  ["action", "Action (verb)"],
  ["laban", "Laban"],
  ["face", "Face (brows, eyes, cheeks, lip corners, jaw)"],
  ["body", "Body (breath, hands, gaze, head)"],
  ["camera", "Camera"],
  ["pace", "Pace"],
];

export function PerformanceScriptPanel({ projectId }: { projectId: string }) {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [scope, setScope] = useState<ScriptScope>("song");
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => fetch(`/api/songs/${projectId}/script`, { cache: "no-store" }).then((r) => r.json()).then((d: View & { error?: string }) => (d.error ? setNote({ ok: false, text: d.error }) : setV(d))), [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const post = async <T,>(what: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(what);
    setNote(null);
    try {
      const r = await fetch(`/api/songs/${projectId}/script`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as T & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? "Something went wrong.");
      return d;
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };
  const edit = async (key: string, patch: Record<string, unknown>) => {
    const d = await post<View>("edit", { action: "edit", key, patch });
    if (d) setV((x) => (x ? { ...x, ...d, cues: x.cues } : x));
  };

  if (!v) return <p className="text-muted-foreground text-xs">{note ? note.text : "Loading…"}</p>;
  const cueOf = (key: string) => v.cues?.segments.find((s) => s.key === key)?.cue ?? null;
  const stale = v.entries.filter((e) => e.stale).length;
  const checked = v.entries.filter((e) => e.checked).length;
  return (
    <div className="flex flex-col gap-3" data-script-panel>
      <p className="text-muted-foreground text-xs">
        The app listens to the song (local, free), Claude reads the lyrics&apos; meaning through each singer&apos;s persona, you approve. Copy shot prompt then gives each line its own direction. Nothing is generated; cuts and timing do not change.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs" data-script-cues={v.cues ? v.cues.stems : "none"}>
        <span className="text-muted-foreground">
          {v.cues
            ? `Music listened to ${new Date(v.cues.made_at).toLocaleString()} (${v.cues.stems === "demucs" ? "with the stems: drums, bass, other, vocals" : "by frequency bands: install the AI packages for stems"}).`
            : "The music is not analysed yet (it happens with the first script request)."}
        </span>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => { const d = await post<{ cues: Cues }>("analyse", { action: "analyse", fresh: !!v.cues }); if (d) setV({ ...v, cues: d.cues }); }} data-script-analyse>
          <RefreshCw className={cn(busy === "analyse" && "animate-spin")} /> {busy === "analyse" ? "Listening… (the first time with stems takes a few minutes)" : v.cues ? "Listen again" : "Analyse the music"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value as ScriptScope)} className="bg-background rounded border px-2 py-1 text-xs" data-script-scope>
          <option value="song">Whole song</option>
          <option value="reel">Reel range</option>
          <option value="slots">Singing slots only</option>
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            const d = await post<{ text: string; lines: number; gaps: number; cues: Cues }>("request", { action: "request", scope });
            if (!d) return;
            await copyText(d.text);
            setV({ ...v, cues: d.cues });
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
            setNote({ ok: true, text: `Copied: ${d.lines} lines and ${d.gaps} instrumental gaps with their music cues and the cast's personas. Paste it in claude.ai, then paste the answer below.` });
          }}
          data-script-request
        >
          {copied ? <Check /> : <Copy />} {busy === "request" ? "Listening to the song…" : copied ? "Copied" : "Copy script request"}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <textarea data-script-paste value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder="Paste Claude's answer here (SCRIPT: …, then blocks like L12 [1:05] Chorus …)" className="bg-background rounded-md border px-2 py-1.5 text-sm" />
        <Button
          size="sm"
          className="w-fit"
          disabled={!!busy || !paste.trim()}
          onClick={async () => {
            const d = await post<View & { saved: number; unrecognised: string[] }>("paste", { action: "paste", text: paste });
            if (!d) return;
            setV({ ...v, ...d, cues: v.cues });
            setPaste("");
            setNote({ ok: true, text: `Saved ${d.saved} line${d.saved === 1 ? "" : "s"} of the script${d.unrecognised.length ? `; ${d.unrecognised.length} part(s) not recognised (below)` : ""}. Check them, then mark them checked.` });
          }}
          data-script-paste-save
        >
          <ClipboardPaste /> Paste script
        </Button>
      </div>
      {note ? <p className={cn("text-xs", note.ok ? "text-emerald-200" : "text-amber-300")} data-script-note>{note.text}</p> : null}
      {v.script?.lastPaste?.unrecognised.length ? (
        <ul className="text-xs text-amber-300" data-script-unrecognised>
          <li>Not recognised in the last paste (not used):</li>
          {v.script.lastPaste.unrecognised.map((u) => (
            <li key={u}>· {u}</li>
          ))}
        </ul>
      ) : null}
      {v.script ? (
        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Sings to</span>
            <input data-script-sings-to defaultValue={v.script.singsTo} key={`to-${v.script.singsTo}`} onBlur={(e) => e.target.value.trim() !== v.script!.singsTo && void edit("song", { singsTo: e.target.value })} className="bg-background rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Objective (for the whole song)</span>
            <input data-script-objective defaultValue={v.script.objective} key={`ob-${v.script.objective}`} onBlur={(e) => e.target.value.trim() !== v.script!.objective && void edit("song", { objective: e.target.value })} className="bg-background rounded border px-2 py-1" />
          </label>
        </div>
      ) : null}
      {v.entries.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-xs" data-script-summary>
              {v.entries.length} lines in the script · {checked} checked{stale ? ` · ${stale} stale (the lyrics or timing changed: not used until you check them)` : ""}
            </p>
            <Button size="sm" variant="outline" disabled={!!busy || checked === v.entries.length - stale} onClick={async () => { const d = await post<View>("check-all", { action: "check-all", checked: true }); if (d) setV((x) => (x ? { ...x, ...d, cues: x.cues } : x)); }} data-script-check-all title="Every line you have read: checked (stale lines wait for a look)">
              <Check /> Mark all checked
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy || checked === 0} onClick={async () => { const d = await post<View>("check-all", { action: "check-all", checked: false }); if (d) setV((x) => (x ? { ...x, ...d, cues: x.cues } : x)); }} data-script-uncheck-all>
              Untick all
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5" data-script-entries>
            {v.entries.map((e) => (
              <li key={e.key} data-script-entry={e.key} data-stale={e.stale ? "" : undefined} data-checked={e.checked ? "" : undefined} className={cn("rounded border px-2 py-1.5 text-xs", e.stale ? "border-amber-400/50" : e.checked ? "border-emerald-400/40" : "")}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">{e.key} · {e.time}</span>
                    {e.section ? <span className="text-muted-foreground">{e.section}</span> : null}
                    <span className="font-medium">{e.kind === "gap" ? `(${e.text})` : `"${e.text}"`}</span>
                    {e.emotion || e.intensity ? <span className="text-sky-200">{e.emotion}{e.intensity ? ` ${e.intensity}/5` : ""}</span> : null}
                    {e.action ? <span className="text-muted-foreground">{e.action}</span> : null}
                    {e.stale ? (
                      <span className="flex items-center gap-1 text-amber-300" data-stale-reason>
                        <AlertTriangle className="size-3" /> stale: {e.stale}
                      </span>
                    ) : null}
                    <label className="ml-auto flex items-center gap-1" onClick={(x) => x.stopPropagation()}>
                      <input type="checkbox" checked={e.checked} disabled={!!busy || !!e.stale} onChange={(x) => void edit(e.key, { checked: x.target.checked })} data-script-check={e.key} /> checked
                    </label>
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {cueOf(e.key) ? <p className="text-muted-foreground" data-script-cue>Music: {cueWords(cueOf(e.key))}</p> : null}
                    {e.stale ? (
                      <Button size="sm" variant="outline" className="w-fit" disabled={!!busy} onClick={() => void edit(e.key, { refresh: true })} data-script-refresh={e.key} title="The direction fits the line as it is now: use it again">
                        Still right for this line: use it again
                      </Button>
                    ) : null}
                    <div className="grid gap-1.5 md:grid-cols-2">
                      {FIELDS.filter(([k]) => e.kind === "line" || k !== "singer").map(([k, label]) => (
                        <label key={k} className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{label}</span>
                          <input data-script-field={`${e.key}.${k}`} defaultValue={String(e[k] ?? "")} key={`${e.key}-${k}-${String(e[k] ?? "")}`} onBlur={(x) => x.target.value.trim() !== String(e[k] ?? "") && void edit(e.key, { [k]: x.target.value })} className="bg-background rounded border px-2 py-1" />
                        </label>
                      ))}
                      <label className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground">Intensity (1-5)</span>
                        <input type="number" min={1} max={5} data-script-field={`${e.key}.intensity`} defaultValue={e.intensity ?? ""} key={`${e.key}-i-${e.intensity}`} onBlur={(x) => Number(x.target.value || 0) !== (e.intensity ?? 0) && void edit(e.key, { intensity: x.target.value })} className="bg-background rounded border px-2 py-1" />
                      </label>
                      {e.kind === "line" ? (
                        <label className="flex flex-col gap-0.5 md:col-span-2">
                          <span className="text-muted-foreground">Reaction{e.reaction?.who ? ` (${e.reaction.who})` : ""}: the one sung to, for listener shots</span>
                          <input data-script-field={`${e.key}.reaction`} defaultValue={e.reaction?.direction ?? ""} key={`${e.key}-r-${e.reaction?.direction ?? ""}`} onBlur={(x) => x.target.value.trim() !== (e.reaction?.direction ?? "") && void edit(e.key, { reaction: { who: e.reaction?.who ?? "", direction: x.target.value } })} className="bg-background rounded border px-2 py-1" />
                        </label>
                      ) : null}
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
