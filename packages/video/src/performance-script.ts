// Performance script (Part B, 26 Nov 2026, Paul: "lip-sync models move the mouth to the audio but don't understand the
// lyrics, so the feeling must come from the start image and the prompt"). The chain: the app hears the track (music
// cues) → Claude reads the lyric's meaning → the persona decides how this singer shows it → Paul approves → every shot
// prompt carries that direction. One entry per sung line and per instrumental gap; once per song: who the character
// sings to and their objective. Pure: no files, no network (Claude drafts it through the clipboard).
// The script never goes into the identity / description or any picture pack, and changes no cut, timing or render.

export type Reaction = { who: string; direction: string };
export type ScriptEntry = {
  key: string; // "L12" (lyric line 12) or "G3" (the 3rd instrumental gap)
  kind: "line" | "gap";
  number: number | null;
  basis: { text: string; startMs: number; endMs: number }; // the line as it was when the script was pasted (staleness)
  singer: string; // who sings it (a cast name; duets)
  meaning: string;
  emotion: string;
  intensity: number | null; // 1-5
  beatChange: string; // "" = none
  action: string; // an action verb ("to reassure")
  laban: string; // the movement quality (float, glide, dab, flick, press, wring, punch, slash)
  face: string; // FACS-style: brows, eyes, cheeks, lip corners, jaw
  body: string; // breath, hands, gaze, head
  camera: string;
  pace: string;
  reaction: Reaction | null; // the character being sung to (listener / reaction shots)
  checked: boolean;
};
export type ScriptFile = { version: 1; pasted_at: string; singsTo: string; objective: string; entries: ScriptEntry[]; lastPaste?: { at: string; unrecognised: string[] } };

export type ScriptSegment = { key: string; kind: "line" | "gap"; number: number | null; text: string; startMs: number; endMs: number; section: string | null; sectionKind: string | null; cue: string };
export type ScriptCast = { name: string; persona: string | null; note: string | null };
export type ScriptScope = "song" | "reel" | "slots";
export const SCOPE_LABEL: Record<ScriptScope, string> = { song: "the whole song", reel: "the Reel's part", slots: "the singing slots only" };

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Repeats (Paul: "chorus 1 ≠ final chorus"): each chorus counted ("Chorus, 2 of 3"); a line already sung earlier names
// its first time. Pure.
export function repeatsOf(segments: readonly ScriptSegment[]): Map<string, string> {
  const out = new Map<string, string>();
  // Each chorus OCCURRENCE (a run of chorus lines; sections are often all just called "Chorus").
  const instance = new Map<string, number>();
  let choruses = 0;
  let prevChorus = false;
  for (const s of segments) {
    if (s.kind !== "line") continue;
    const isChorus = s.sectionKind === "chorus";
    if (isChorus && !prevChorus) choruses++;
    if (isChorus) instance.set(s.key, choruses);
    prevChorus = isChorus;
  }
  const firstOf = new Map<string, number>();
  const count = new Map<string, number>();
  const total = new Map<string, number>();
  for (const s of segments) if (s.kind === "line") total.set(norm(s.text), (total.get(norm(s.text)) ?? 0) + 1);
  for (const s of segments) {
    const parts: string[] = [];
    const i = instance.get(s.key);
    if (i && choruses > 1) parts.push(i === choruses ? `final chorus (${i} of ${choruses})` : `chorus ${i} of ${choruses}`);
    if (s.kind === "line" && (total.get(norm(s.text)) ?? 0) > 1) {
      const k = (count.get(norm(s.text)) ?? 0) + 1;
      count.set(norm(s.text), k);
      if (k === 1) firstOf.set(norm(s.text), s.number!);
      else parts.push(`repeat ${k} of ${total.get(norm(s.text))} of line ${firstOf.get(norm(s.text))}`);
    }
    if (parts.length) out.set(s.key, parts.join("; "));
  }
  return out;
}

export const ENTRY_TEMPLATE = [
  "Singer: (who sings this line)",
  "Meaning: (one sentence)",
  "Emotion: ... | Intensity: 1-5",
  "Beat change: none | yes: (what shifts)",
  "Action: to ... (a transitive action verb)",
  "Laban: float | glide | dab | flick | press | wring | punch | slash",
  "Face: brows ..., eyes ..., cheeks ..., lip corners ..., jaw ...",
  "Body: breath ..., hands ..., gaze ..., head ...",
  "Reaction (name): (what the person sung to does, through their persona)",
  "Camera: push-in | hold | wide | cut on drop ... | Pace: hold long | cut fast ...",
];

// "Copy script request": the text for claude.ai.
export function scriptRequest(o: { title: string; artist: string | null; scope: ScriptScope; segments: readonly ScriptSegment[]; cast: readonly ScriptCast[] }): string {
  const rep = repeatsOf(o.segments);
  const out: string[] = [];
  out.push(`I make music videos for my romantic songs. Write the PERFORMANCE SCRIPT for "${o.title}"${o.artist ? ` by ${o.artist}` : ""}, for ${SCOPE_LABEL[o.scope]}: what the singing character feels and physically does on each line, so a lip-sync video shows the meaning, not just a moving mouth.`);
  out.push("");
  out.push("CAST (identity is fixed by reference pictures; act through each PERSONA):");
  for (const c of o.cast) {
    out.push("");
    out.push(c.persona ? c.persona : `PERSONA: ${c.name}\n(no persona yet: keep the acting natural and restrained)`);
    if (c.note) out.push(`In this song: ${c.note}`);
  }
  out.push("");
  out.push("RULES:");
  out.push("- Every direction is something a camera can see: brows, eyes, cheeks, lip corners, jaw (FACS-style), breath, hands, gaze, head. Not just feelings.");
  out.push("- Repeated lines and choruses ESCALATE: chorus 1 is not the final chorus. Intensity and direction grow across repeats (a held-back first chorus, a fuller second, the most open final chorus); never copy a direction to its repeat.");
  out.push("- Use the music cues: a build tightens, a drop releases or cuts, a breakdown goes inward, a sudden silence holds still; a soft vocal over a loud mix stays intimate.");
  out.push(`- Duets: say per line which cast member sings it.${o.cast.length > 1 ? " For the character being sung to, give a Reaction direction (for listener shots), through their persona." : ""}`);
  out.push("- Keep each field short. Keep the line keys (L12, G3) exactly as given.");
  out.push("");
  out.push("THE SONG (sung lines with their section and start time; instrumental gaps; the music cues after the dash):");
  for (const s of o.segments) {
    const r = rep.get(s.key);
    const head = s.kind === "gap" ? `${s.key} [${clock(s.startMs)}-${clock(s.endMs)}] ${s.text} (instrumental)` : `${s.key} [${clock(s.startMs)}] ${s.section ?? ""}${r ? ` (${r})` : ""}: "${s.text}"`;
    out.push(`${head}${s.cue ? ` - ${s.cue}` : ""}`);
  }
  out.push("");
  out.push("ANSWER with exactly this format: the two song lines once, then one block per key above, in order:");
  out.push("");
  out.push(`SCRIPT: ${o.title}`);
  out.push("Sings to: (who the character sings to)");
  out.push("Objective: (what they want from that person in this song)");
  out.push("");
  out.push("L12 [1:05] Chorus");
  out.push(...ENTRY_TEMPLATE);
  out.push("");
  out.push("G3 [1:12-1:20] Instrumental");
  out.push(...ENTRY_TEMPLATE.filter((l) => !/^Singer|^Reaction/.test(l)));
  return `${out.join("\n")}\n`;
}

// ---- Paste script ----------------------------------------------------------------------------------------------

export type ParsedScript = { title: string | null; singsTo: string; objective: string; entries: Omit<ScriptEntry, "basis" | "kind" | "number" | "checked">[]; unrecognised: string[] };

const FIELDS: [RegExp, keyof ScriptEntry | "intensity" | "reaction"][] = [
  [/^singer|^sung by|^who sings/, "singer"],
  [/^meaning/, "meaning"],
  [/^emotion/, "emotion"],
  [/^intensity/, "intensity"],
  [/^beat( change)?|^shift/, "beatChange"],
  [/^action( verb)?|^objective verb/, "action"],
  [/^laban|^movement( quality)?|^effort/, "laban"],
  [/^face|^facial( direction)?/, "face"],
  [/^body|^physical( direction)?|^direction/, "body"],
  [/^reaction|^listener/, "reaction"],
  [/^camera/, "camera"],
  [/^(edit )?pace/, "pace"],
];
const lab = (s: string) => s.toLowerCase().replace(/[*_`#>]/g, "").replace(/[\s-]+/g, " ").trim();
const clean = (s: string) => s.replace(/^[*_\s]+|[*_\s]+$/g, "").replace(/^\(.*\)$/, "").trim();

function blank(key: string): ParsedScript["entries"][number] {
  return { key, singer: "", meaning: "", emotion: "", intensity: null, beatChange: "", action: "", laban: "", face: "", body: "", camera: "", pace: "", reaction: null };
}

// Reads Claude's answer: tolerant of bold labels, "|"-joined fields on one line, "->" arrows, text around it, keys
// written "L12", "**L12**", "Line 12" or "G3". Lines it cannot place are listed.
export function parseScript(text: string): ParsedScript {
  const r: ParsedScript = { title: null, singsTo: "", objective: "", entries: [], unrecognised: [] };
  let cur: ParsedScript["entries"][number] | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || /^```/.test(line) || /^-{3,}$/.test(line)) continue;
    const head = /^[\s*_#>-]*(?:(L|G)\s*(\d+)|line\s+(\d+)|gap\s+(\d+))\b[*_]*\s*(?:\[[^\]]*\])?/i.exec(line);
    if (head) {
      const key = head[3] ? `L${head[3]}` : head[4] ? `G${head[4]}` : `${head[1].toUpperCase()}${head[2]}`;
      cur = blank(key);
      r.entries.push(cur);
      continue;
    }
    // Fields: "Label: value", several on one line joined by " | ".
    const pieces = line.split(/\s+\|\s+/);
    let placed = false;
    for (const piece of pieces) {
      const m = /^[\s*_•-]*([A-Za-z][A-Za-z ()/']{1,40}?)[*_]*\s*(?::|—|–|-(?=\s))\s*(.*)$/.exec(piece);
      if (!m) continue;
      const label = lab(m[1]);
      const value = clean(m[2]);
      if (/^script\b/.test(label)) {
        r.title = value || null;
        placed = true;
        continue;
      }
      if (/^sings? to\b|^singing to\b/.test(label) && !cur) {
        r.singsTo = value;
        placed = true;
        continue;
      }
      if (/^objective\b|^super objective\b/.test(label) && !cur) {
        r.objective = value;
        placed = true;
        continue;
      }
      const f = cur ? FIELDS.find(([re]) => re.test(label)) : undefined;
      if (!cur || !f) continue;
      placed = true;
      if (f[1] === "intensity") {
        const n = Number(/\d/.exec(value)?.[0]);
        cur.intensity = n >= 1 && n <= 5 ? n : null;
      } else if (f[1] === "reaction") {
        const who = /\(([^)]+)\)/.exec(m[1])?.[1]?.trim() ?? "";
        if (value && !/^none$/i.test(value)) cur.reaction = { who, direction: value };
      } else if (f[1] === "beatChange") {
        cur.beatChange = /^(none|no)\b/i.test(value) ? "" : value.replace(/^yes\s*[:,-]?\s*/i, "");
      } else (cur as Record<string, unknown>)[f[1]] = value;
    }
    if (!placed && /^[^:]{2,40}:\s*\S/.test(line) && (cur || r.entries.length)) r.unrecognised.push(line);
  }
  return r;
}

// ---- Staleness and use -------------------------------------------------------------------------------------------

export const STALE_SHIFT_MS = 1000;

// Is the entry still about the same line? Matched by the line's text and position (never applied to another line):
// the text changed, the line moved (the same words now elsewhere), or its timing moved by more than a second.
export function staleness(e: Pick<ScriptEntry, "key" | "kind" | "number" | "basis">, now: readonly Pick<ScriptSegment, "key" | "kind" | "number" | "text" | "startMs" | "endMs">[]): string | null {
  const same = now.find((s) => s.key === e.key);
  if (e.kind === "gap") {
    if (!same) return "this instrumental gap is not in the song any more";
    if (Math.abs(same.startMs - e.basis.startMs) > STALE_SHIFT_MS * 1.5 || Math.abs(same.endMs - e.basis.endMs) > STALE_SHIFT_MS * 1.5) return `the gap moved (${clock(e.basis.startMs)} → ${clock(same.startMs)})`;
    return null;
  }
  if (!same || norm(same.text) !== norm(e.basis.text)) {
    // Renumbered (a line added or removed before it): the same words at the same moment under another number. The same
    // words elsewhere in the song (a repeated chorus line) are not "this line".
    const moved = now.find((s) => s.kind === "line" && norm(s.text) === norm(e.basis.text) && s.key !== e.key && Math.abs(s.startMs - e.basis.startMs) <= STALE_SHIFT_MS);
    if (moved) return `these words are now line ${moved.number}`;
    return same ? `the line's words changed (was "${e.basis.text}")` : "this line is not in the lyrics any more";
  }
  if (Math.abs(same.startMs - e.basis.startMs) > STALE_SHIFT_MS) return `the line's timing moved (${clock(e.basis.startMs)} → ${clock(same.startMs)})`;
  return null;
}

// What a shot prompt says for a person in a scripted line: the singer's direction, or the reaction of the one sung to.
export function directionLines(e: ScriptEntry, person: string): string[] {
  const isSinger = !e.singer || e.singer.toLowerCase().split(/\s*(?:&|and|,)\s*/).includes(person.toLowerCase());
  if (!isSinger) {
    if (e.reaction && (!e.reaction.who || e.reaction.who.toLowerCase() === person.toLowerCase())) return [`Reaction (${person} is sung to, listening): ${e.reaction.direction}`];
    return [];
  }
  return [
    e.meaning && `Meaning: ${e.meaning}`,
    (e.emotion || e.intensity) && `Emotion: ${e.emotion}${e.intensity ? ` (intensity ${e.intensity}/5)` : ""}`,
    e.beatChange && `Beat change: ${e.beatChange}`,
    e.action && `Action: ${e.action}`,
    e.laban && `Movement (Laban): ${e.laban}`,
    e.face && `Face: ${e.face}`,
    e.body && `Body: ${e.body}`,
  ].filter((x): x is string => !!x);
}
