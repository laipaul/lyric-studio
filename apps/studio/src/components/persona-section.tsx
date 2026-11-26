"use client";

// Persona on a character card (26 Nov 2026; src/persona.ts, node/persona.ts): how this character acts and sings,
// across songs. Editable also on a locked card (the lock protects the look, not the acting); each save keeps the text
// it replaces (History, with Restore). Never part of the identity / description or the picture pack.
//   Copy persona request: a text for claude.ai (no API call). Paste persona: Claude's answer back into the fields.
import { Check, ClipboardPaste, Copy, History, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cleanPersona, DEFAULT_SECTION_MAP, emptyPersona, parsePersona, PERSONA_HELP, SECTION_KEYS, SECTION_LABEL, type ParsedPersona, type Persona } from "@lyric/video/persona";

type PersonaInfo = { persona: Persona | null; editedAt: string | null; history: { at: string; persona: Persona }[] };

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

const input = "bg-background rounded-md border px-2 py-1.5 text-sm";

function Field({ label, value, onChange, attr, placeholder, rows = 1 }: { label: string; value: string; onChange: (v: string) => void; attr: string; placeholder?: string; rows?: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      {/* Wraps and grows with the text (26 Nov 2026, Paul: long answers were cut off at the box's edge). */}
      <textarea {...{ [attr]: "" }} value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value.replace(/\n+/g, " "))} className={`${input} min-h-9 resize-none [field-sizing:content]`} />
    </label>
  );
}

export function PersonaSection({ cardId, name, info, busy, onSave, onRestore }: { cardId: string; name: string; info: PersonaInfo; busy: boolean; onSave: (p: Persona) => Promise<void>; onRestore: (at: string) => Promise<void> }) {
  const start = info.persona ?? emptyPersona();
  const [p, setP] = useState<Persona>(start);
  const [base, setBase] = useState(JSON.stringify(start));
  // A new persona from the server (saved, restored): the form follows it.
  const server = JSON.stringify(info.persona ?? emptyPersona());
  if (server !== base) {
    setBase(server);
    setP(info.persona ?? emptyPersona());
  }
  const dirty = JSON.stringify(cleanPersona(p)) !== JSON.stringify(cleanPersona(info.persona ?? emptyPersona()));
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPersona | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (f: (x: Persona) => Persona) => setP((x) => f(structuredClone(x)));

  const copyRequest = async () => {
    setNote(null);
    try {
      const r = await fetch(`/api/cards/${cardId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "persona-request" }) });
      const j = (await r.json()) as { text?: string; error?: string };
      if (!r.ok || !j.text) throw new Error(j.error ?? "Could not make the request.");
      await copyText(j.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" data-persona>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Persona</h2>
        <span className="text-muted-foreground text-xs">How {name} acts and sings, in every song. Never used for the pack pictures; editable when locked.</span>
        <span className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => void copyRequest()} data-persona-request title="A request for claude.ai with this character's identity, notes, songs and the persona template (no API call)">
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy persona request"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => (setPaste(paste === null ? "" : null), setParsed(null))} data-persona-paste-open>
            <ClipboardPaste /> Paste persona
          </Button>
        </span>
      </div>
      <p className="text-muted-foreground text-xs" data-persona-help>
        {PERSONA_HELP}
      </p>
      {paste !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2" data-persona-paste>
          <textarea data-persona-paste-text value={paste} onChange={(e) => (setPaste(e.target.value), setParsed(null))} rows={6} placeholder="Paste Claude's answer here (the PERSONA block)" className={input} />
          <span className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!paste.trim()} onClick={() => setParsed(parsePersona(paste))} data-persona-read>
              Read it
            </Button>
            {parsed ? (
              <>
                <span className="text-muted-foreground text-xs" data-persona-found>
                  Found: {parsed.found.length ? parsed.found.length : "nothing"} of 11 parts{parsed.name && parsed.name.toLowerCase() !== name.toLowerCase() ? ` (it names "${parsed.name}")` : ""}.
                </span>
                <Button size="sm" disabled={!parsed.found.length} onClick={() => (setP(parsed.persona), setPaste(null), setParsed(null), setNote("Filled in from Claude's answer: check it, then Save persona."))} data-persona-use>
                  Use these
                </Button>
              </>
            ) : null}
          </span>
          {parsed?.unrecognised.length ? (
            <ul className="text-xs text-amber-300" data-persona-unrecognised>
              <li>Not recognised (not used):</li>
              {parsed.unrecognised.map((u) => (
                <li key={u}>· {u}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <Field label="Archetype" attr="data-persona-archetype" value={p.archetype} onChange={(v) => set((x) => ((x.archetype = v), x))} placeholder="The Quiet Romantic: feels everything, shows it in small ways" />
        <Field label="Personality (3 traits)" attr="data-persona-traits" value={p.traits.join(", ")} onChange={(v) => set((x) => ((x.traits = v.split(/\s*,\s*/).slice(0, 3)), x))} placeholder="shy, warm, quietly intense" />
        <Field label="Sings soft lines" attr="data-persona-soft" value={p.sing.soft} onChange={(v) => set((x) => ((x.sing.soft = v), x))} placeholder="half-smile, eyes lowered, barely moving" />
        <Field label="Sings high notes" attr="data-persona-high" value={p.sing.high} onChange={(v) => set((x) => ((x.sing.high = v), x))} placeholder="chin lifts, brows rise, eyes close" />
        <Field label="Sings held notes" attr="data-persona-held" value={p.sing.held} onChange={(v) => set((x) => ((x.sing.held = v), x))} placeholder="hand to chest, slow breath out" />
        <Field label="Signature gestures (separate with ;)" attr="data-persona-gestures" value={p.gestures.join("; ")} onChange={(v) => set((x) => ((x.gestures = v.split(/\s*;\s*/).slice(0, 5)), x))} placeholder="tucks hair behind her ear; touches her necklace" />
        <Field label="Movement quality (Laban: float, glide, dab, flick, press, wring, punch, slash)" attr="data-persona-movement" value={p.movement} onChange={(v) => set((x) => ((x.movement = v), x))} placeholder="glide and float; press on the peaks" />
        <Field label="Favourite actions (action verbs, separate with ,)" attr="data-persona-actions" value={p.actions.join(", ")} onChange={(v) => set((x) => ((x.actions = v.split(/\s*,\s*/).slice(0, 6)), x))} placeholder="to reassure, to confess, to hold on" />
        <Field label="Gaze" attr="data-persona-gaze" value={p.gaze} onChange={(v) => set((x) => ((x.gaze = v), x))} placeholder="looks away on verses, into the lens on the chorus" />
        <Field label="Camera loves" attr="data-persona-camera" value={p.camera} onChange={(v) => set((x) => ((x.camera = v), x))} placeholder="3/4 from her left, soft window light, slow push-in" />
        <Field label="Emotional range: rest state" attr="data-persona-rest" value={p.range.rest} onChange={(v) => set((x) => ((x.range.rest = v), x))} placeholder="calm, soft eyes, lips relaxed" />
        <Field label="Emotional range: peak state" attr="data-persona-peak" value={p.range.peak} onChange={(v) => set((x) => ((x.range.peak = v), x))} placeholder="eyes glistening, voice breaking, hands open" />
        <div className="md:col-span-2">
          <Field label="Never (what breaks the character)" attr="data-persona-never" value={p.never} onChange={(v) => set((x) => ((x.never = v), x))} placeholder="no wide grin, no winking, no big arm moves" />
        </div>
      </div>
      <div className="flex flex-col gap-1" data-persona-sections>
        <span className="text-xs font-medium">Section map (what she does in each part of a song)</span>
        {SECTION_KEYS.map((k) => (
          <label key={k} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{SECTION_LABEL[k]}</span>
            <textarea data-persona-section={k} value={p.sections[k]} rows={1} placeholder={DEFAULT_SECTION_MAP[k]} onChange={(e) => set((x) => ((x.sections[k] = e.target.value.replace(/\n+/g, " ")), x))} className={`${input} min-h-9 resize-none [field-sizing:content]`} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !dirty} onClick={() => void onSave(cleanPersona(p)).then(() => setNote(null))} data-persona-save>
          <Save /> Save persona
        </Button>
        {dirty ? <span className="text-xs text-amber-300" data-persona-unsaved>Not saved yet</span> : null}
        {info.editedAt ? <span className="text-muted-foreground text-xs" data-persona-edited>Last edited {new Date(info.editedAt).toLocaleString()}</span> : null}
        {note ? <span className="text-xs text-emerald-200" data-persona-note>{note}</span> : null}
      </div>
      {info.history.length ? (
        <details className="text-xs" data-persona-history>
          <summary className="text-muted-foreground cursor-pointer">
            <History className="mr-1 inline size-3" />
            History ({info.history.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {info.history.map((h) => (
              <li key={h.at} className="flex flex-col gap-1 rounded border p-2" data-persona-history-item={h.at}>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">Until {new Date(h.at).toLocaleString()}</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRestore(h.at)} data-persona-restore>
                    Restore
                  </Button>
                </span>
                <span className="text-muted-foreground">{[h.persona.archetype, h.persona.traits.join(", ")].filter(Boolean).join(" · ") || "(empty)"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
