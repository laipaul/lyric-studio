// Persona (26 Nov 2026, Paul: "my songs are mostly romantic; each singer needs her own personality and acting style,
// like a video-game character profile, so shots show expression, not just a face"). Three layers, kept apart:
//   Identity (face, hair, body, outfit): the card and its pack, locked.
//   Persona (how this character acts and sings): here; travels with the character across songs.
//   Shot emotion (what she feels on this line): the song's section + lyric, per shot.
// The Persona is NEVER put into the identity / description or any picture-pack prompt ("eyes closed" in an identity
// made every pack picture eyes-closed). It is used only in the texts copied for Claude and in "Copy shot prompt".
// Pure: no files, no network (Claude drafts it through the clipboard, per the no-API design rule).
import { directionLines, type ScriptEntry } from "./performance-script";

export type SectionKey = "verse" | "preChorus" | "chorus" | "bridge" | "finalChorus";
export type Persona = {
  archetype: string;
  traits: string[]; // up to 3
  sing: { soft: string; high: string; held: string };
  gestures: string[]; // 2-3
  movement: string; // movement quality: the dominant Laban efforts (float, glide, dab, flick, press, wring, punch, slash)
  actions: string[]; // favourite actions: typical action verbs ("to reassure", "to confess")
  gaze: string;
  range: { rest: string; peak: string };
  camera: string; // angles, framing, light that suit them
  never: string;
  sections: Record<SectionKey, string>;
};

export const SECTION_KEYS: readonly SectionKey[] = ["verse", "preChorus", "chorus", "bridge", "finalChorus"];
export const SECTION_LABEL: Record<SectionKey, string> = { verse: "Verse", preChorus: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", finalChorus: "Final chorus" };
export const DEFAULT_SECTION_MAP: Record<SectionKey, string> = {
  verse: "rest state, restrained, gaze away",
  preChorus: "building, breath visible, gaze searching",
  chorus: "finds the lens, signature gesture",
  bridge: "peak, most vulnerable",
  finalChorus: "peak and release",
};
export const PERSONA_HELP = "Describe what the face and body physically do (brows, eyes, breath, mouth, hands), not just feelings.";
export const FIELD_MAX = 400;

export function emptyPersona(): Persona {
  return { archetype: "", traits: [], sing: { soft: "", high: "", held: "" }, gestures: [], movement: "", actions: [], gaze: "", range: { rest: "", peak: "" }, camera: "", never: "", sections: { ...DEFAULT_SECTION_MAP } };
}

const one = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, FIELD_MAX) : "");
const list = (x: unknown, max: number) =>
  (Array.isArray(x) ? x : typeof x === "string" ? x.split(/\s*[;,•]\s*|\n+/) : []).map(one).filter(Boolean).slice(0, max);

// A persona from anything (the page's form, card.json): every field cleaned; missing section lines take the default.
export function cleanPersona(raw: unknown): Persona {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const o = (k: string) => ((r[k] && typeof r[k] === "object" ? r[k] : {}) as Record<string, unknown>);
  const sec = o("sections");
  return {
    archetype: one(r.archetype),
    traits: list(r.traits, 3),
    sing: { soft: one(o("sing").soft), high: one(o("sing").high), held: one(o("sing").held) },
    gestures: list(r.gestures, 5),
    movement: one(r.movement),
    actions: list(r.actions, 6),
    gaze: one(r.gaze),
    range: { rest: one(o("range").rest), peak: one(o("range").peak) },
    camera: one(r.camera),
    never: one(r.never),
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, typeof sec[k] === "string" ? one(sec[k]) : DEFAULT_SECTION_MAP[k]])) as Record<SectionKey, string>,
  };
}

// Nothing of the user's own in it (the default section map alone does not count).
export function personaIsEmpty(p: Persona | null | undefined): boolean {
  if (!p) return true;
  const own = SECTION_KEYS.some((k) => p.sections[k] && p.sections[k] !== DEFAULT_SECTION_MAP[k]);
  return !own && !p.archetype && !p.traits.length && !p.sing.soft && !p.sing.high && !p.sing.held && !p.gestures.length && !p.movement && !p.actions.length && !p.gaze && !p.range.rest && !p.range.peak && !p.camera && !p.never;
}

// The PERSONA block, in the template's own form (Copy character for Claude; what Paste persona reads back).
export function personaBlock(name: string, p: Persona): string {
  const dash = (s: string) => s || "...";
  return [
    `PERSONA: ${name}`,
    `Archetype: ${dash(p.archetype)}`,
    `Personality: ${dash(p.traits.join(", "))}`,
    `How she sings: soft lines → ${dash(p.sing.soft)} / high notes → ${dash(p.sing.high)} / held notes → ${dash(p.sing.held)}`,
    `Signature gestures: ${dash(p.gestures.join("; "))}`,
    `Movement quality: ${dash(p.movement)}`,
    `Favourite actions: ${dash(p.actions.join(", "))}`,
    `Gaze: ${dash(p.gaze)}`,
    `Emotional range: rest = ${dash(p.range.rest)} → peak = ${dash(p.range.peak)}`,
    `Camera loves: ${dash(p.camera)}`,
    `Never: ${dash(p.never)}`,
    `Section map: ${SECTION_KEYS.map((k) => `${SECTION_LABEL[k]}: ${dash(p.sections[k])}`).join(" / ")}`,
  ].join("\n");
}

export const PERSONA_TEMPLATE = personaBlock("[Name]", { ...emptyPersona(), sections: { verse: "", preChorus: "", chorus: "", bridge: "", finalChorus: "" } });

// "Copy persona request": the text for claude.ai (no API call).
export function personaRequest(o: { name: string; identity: string | null; notes: string | null; looks: string[]; songs: string[] }): string {
  return [
    `I write romantic songs and make music videos with a recurring singer character called ${o.name}. Write ${o.name}'s PERSONA: how this character acts and sings on camera, like a video-game character profile, so every shot shows expression, not just a face.`,
    "",
    `Who ${o.name} is (identity: face, hair, body; do not change it):`,
    o.identity?.trim() || "(no description yet)",
    ...(o.notes?.trim() ? ["", `My notes: ${o.notes.trim()}`] : []),
    ...(o.looks.length ? ["", `Looks (outfits): ${o.looks.join(", ")}`] : []),
    ...(o.songs.length ? ["", `Songs ${o.name} appears in: ${o.songs.join(", ")}`] : []),
    "",
    `Rule: ${PERSONA_HELP} Every line must be something a camera can see. Keep each line short. Do not describe the face's features, hair or clothes (that is the identity, kept separately). Movement quality: the dominant Laban efforts (float, glide, dab, flick, press, wring, punch, slash). Favourite actions: typical transitive action verbs (to reassure, to confess, to tease, to plead).`,
    "",
    "Answer with exactly this block, filled in (keep the labels):",
    "",
    PERSONA_TEMPLATE,
  ].join("\n");
}

// ---- Paste persona: Claude's answer back into the fields -------------------------------------------------------

export type ParsedPersona = { name: string | null; persona: Persona; found: string[]; unrecognised: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[*_`#>]/g, "").replace(/[\s-]+/g, " ").trim();
const LABELS: [RegExp, string][] = [
  [/^persona\b/, "persona"],
  [/^archetype\b/, "archetype"],
  [/^(personality|traits?)\b/, "traits"],
  [/^how (she|he|they) sings?\b|^singing\b|^how .* sings?\b/, "sing"],
  [/^(signature )?gestures?\b/, "gestures"],
  [/^movement( quality)?\b|^laban\b/, "movement"],
  [/^(favou?rite )?actions?\b|^action verbs?\b/, "actions"],
  [/^gaze\b|^eyes\b/, "gaze"],
  [/^emotional range\b|^range\b/, "range"],
  [/^camera( loves)?\b/, "camera"],
  [/^never\b/, "never"],
  [/^section map\b|^sections\b/, "sections"],
];
const SECTION_NAMES: [RegExp, SectionKey][] = [
  [/^final chorus\b|^last chorus\b/, "finalChorus"],
  [/^pre ?chorus\b/, "preChorus"],
  [/^chorus\b/, "chorus"],
  [/^bridge\b/, "bridge"],
  [/^verses?\b/, "verse"],
];
const ARROW = /\s*(?:→|->|=>|—>|:)\s*/;

// Splits "soft lines → a / high notes → b / held notes → c" (or one per line) into its labelled parts.
function parts(text: string, names: [RegExp, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  const chunks = text.split(/\s+\/\s+|\s*\|\s*|\n+/).map((c) => c.replace(/^[\s\-*•]+/, "").trim()).filter(Boolean);
  for (const c of chunks) {
    const m = ARROW.exec(c);
    if (!m) continue;
    const head = norm(c.slice(0, m.index));
    const value = c.slice(m.index + m[0].length).trim();
    const hit = names.find(([re]) => re.test(head));
    if (hit && value) out[hit[1]] = value;
  }
  return out;
}

const clean = (s: string) => s.replace(/^\.\.\.$/, "").trim();

// Reads the PERSONA block from Claude's answer: tolerant of bold labels, missing colons, "->" for "→", bullet lists
// under a label, "Pre chorus" or "Pre-chorus", text before and after the block. Lines it cannot place are listed.
export function parsePersona(text: string): ParsedPersona {
  const persona = emptyPersona();
  const found = new Set<string>();
  const unrecognised: string[] = [];
  let name: string | null = null;
  // Group each label with the lines that follow it (a bullet list under "Signature gestures:", the section map over
  // several lines).
  const lines = text.replace(/\r/g, "").split("\n");
  const groups: { key: string; value: string; raw: string }[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^```/.test(line)) continue;
    const m = /^[\s*_#>-]*([A-Za-z][A-Za-z /-]{1,40}?)[*_]*\s*(?::|—|–|-(?=\s))\s*(.*)$/.exec(line);
    const label = m ? LABELS.find(([re]) => re.test(norm(m[1]))) : undefined;
    if (m && label) {
      inBlock = true;
      groups.push({ key: label[1], value: m[2].replace(/^[*_\s]+|[*_\s]+$/g, "").trim(), raw: line });
      continue;
    }
    // A section line on its own ("Verse: ...") belongs to the section map.
    const sm = /^[\s*_•-]*([A-Za-z][A-Za-z -]{1,20}?)[*_]*\s*(?::|→|->)\s*(.+)$/.exec(line);
    if (sm && SECTION_NAMES.some(([re]) => re.test(norm(sm[1])))) {
      const last = groups[groups.length - 1];
      if (last?.key === "sections") last.value += `\n${line}`;
      else groups.push({ key: "sections", value: line, raw: line });
      inBlock = true;
      continue;
    }
    const last = groups[groups.length - 1];
    if (inBlock && last && /^[\s]*[-*•]\s+/.test(raw)) {
      last.value += `\n${line.replace(/^[-*•]\s+/, "")}`;
      continue;
    }
    // A "Label: value" line it does not know (prose around the block, "Hope this helps!", is not listed).
    if (inBlock && /^[^:]{2,40}:\s*\S/.test(line)) unrecognised.push(line);
  }
  for (const g of groups) {
    const v = clean(g.value);
    switch (g.key) {
      case "persona":
        name = v || null;
        break;
      case "archetype":
        persona.archetype = v;
        break;
      case "traits":
        persona.traits = v.split(/\s*[,;\n]\s*|\s+and\s+/).map(clean).filter(Boolean).slice(0, 3);
        break;
      case "movement":
        persona.movement = v.replace(/\n+/g, ", ");
        break;
      case "actions":
        persona.actions = v.split(/\s*[,;\n]\s*/).map(clean).filter(Boolean).slice(0, 6);
        break;
      case "gestures":
        persona.gestures = v.split(/\s*;\s*|\n+/).map(clean).filter(Boolean).slice(0, 5);
        break;
      case "gaze":
        persona.gaze = v;
        break;
      case "camera":
        persona.camera = v;
        break;
      case "never":
        persona.never = v.replace(/\n+/g, "; ");
        break;
      case "sing": {
        const p = parts(v, [[/^soft/, "soft"], [/^high/, "high"], [/^(held|long|sustain)/, "held"]]);
        for (const k of ["soft", "high", "held"] as const) if (p[k]) persona.sing[k] = clean(p[k]);
        if (!p.soft && !p.high && !p.held && v) unrecognised.push(g.raw);
        break;
      }
      case "range": {
        const r = /rest(?:ing)?\s*(?:state)?\s*(?:=|:)?\s*(.*?)\s*(?:→|->|=>|,|;)\s*peak\s*(?:state)?\s*(?:=|:)?\s*(.*)$/i.exec(v.replace(/\n/g, " "));
        if (r) {
          persona.range.rest = clean(r[1]);
          persona.range.peak = clean(r[2]);
        } else {
          const two = v.split(/\s*(?:→|->|=>)\s*/);
          if (two.length === 2) {
            persona.range.rest = clean(two[0]);
            persona.range.peak = clean(two[1]);
          } else unrecognised.push(g.raw);
        }
        break;
      }
      case "sections": {
        const p = parts(v, SECTION_NAMES);
        for (const k of SECTION_KEYS) if (p[k]) persona.sections[k] = clean(p[k]);
        if (!Object.keys(p).length && v) unrecognised.push(g.raw);
        break;
      }
    }
    if (g.key !== "persona" && v) found.add(g.key);
  }
  return { name, persona: cleanPersona(persona), found: [...found], unrecognised };
}

// ---- Shot emotion: the section line and the shot prompt ---------------------------------------------------------

// The section map's line for a song section (sections.ts kinds). final: the song's last chorus. Intro and outro: the
// rest state (the Verse line).
export function sectionKeyOf(kind: string | null | undefined, final = false): SectionKey | null {
  if (!kind) return null;
  const k = kind.toLowerCase();
  if (k === "chorus") return final ? "finalChorus" : "chorus";
  if (k === "pre-chorus") return "preChorus";
  if (k === "bridge") return "bridge";
  if (k === "verse" || k === "intro" || k === "outro") return "verse";
  return null;
}

export const LIPSYNC_FRAMING =
  "Lip-sync framing: front or 3/4 medium close-up, the mouth always visible and unobstructed (no hand, hair, microphone or shadow over it), steady camera, the face sharp and well lit.";

export type ShotPromptPerson = { name: string; identity: string | null; look: string | null; outfit: string | null; persona: Persona | null; songNote: string | null };
export type PersonaShotInput = {
  people: ShotPromptPerson[];
  section: { kind: string; name: string; final: boolean } | null; // null: the shot's place is not known
  lyric: string | null; // the sung line (null: an instrumental part, or not known)
  singing: boolean;
  song: string;
  // The performance script's entry for this line (Part B): its direction wins over the section map; stale: why the
  // line's entry was not used (the lyrics or timing changed since it was pasted).
  script?: { entry: ScriptEntry | null; stale: string | null; singsTo?: string; objective?: string } | null;
};

// "Copy shot prompt": identity + persona + the section line + the song's note + the lyric + lip-sync framing for a
// sung shot. Copy only: it changes no cut, timing or render.
export function personaShotPrompt(i: PersonaShotInput): string {
  const out: string[] = [`SHOT: ${i.song}${i.section ? ` · ${i.section.name}` : ""}`];
  for (const p of i.people) {
    out.push("");
    out.push(`${p.name}, identity (keep exactly):`);
    out.push(p.identity?.trim() || "(no description on the card yet)");
    if (p.outfit || p.look) out.push(`Wearing${p.look ? ` (look: ${p.look})` : ""}: ${p.outfit?.trim() || "as in the reference pictures"}`);
    const per = p.persona && !personaIsEmpty(p.persona) ? p.persona : null;
    if (per) {
      out.push("");
      out.push(`${p.name}, persona (how they act and sing):`);
      if (per.archetype) out.push(`Archetype: ${per.archetype}`);
      if (per.traits.length) out.push(`Personality: ${per.traits.join(", ")}`);
      if (i.singing && (per.sing.soft || per.sing.high || per.sing.held))
        out.push(`How they sing: ${[per.sing.soft && `soft lines → ${per.sing.soft}`, per.sing.high && `high notes → ${per.sing.high}`, per.sing.held && `held notes → ${per.sing.held}`].filter(Boolean).join(" / ")}`);
      if (per.gestures.length) out.push(`Signature gestures: ${per.gestures.join("; ")}`);
      if (per.movement) out.push(`Movement quality (Laban): ${per.movement}`);
      if (per.actions.length) out.push(`Favourite actions: ${per.actions.join(", ")}`);
      if (per.gaze) out.push(`Gaze: ${per.gaze}`);
      if (per.never) out.push(`Never: ${per.never}`);
    }
    const key = i.section ? sectionKeyOf(i.section.kind, i.section.final) : null;
    const scripted = i.script?.entry ? directionLines(i.script.entry, p.name) : [];
    if (scripted.length) {
      out.push(`On this line (performance script${i.section ? `, ${i.section.name}` : ""}):`);
      out.push(...scripted);
    } else if (key) out.push(`In this part (${SECTION_LABEL[key]}${i.section!.name && !new RegExp(`^${SECTION_LABEL[key]}$`, "i").test(i.section!.name) ? `, ${i.section!.name}` : ""}): ${(per?.sections[key] ?? DEFAULT_SECTION_MAP[key]) || DEFAULT_SECTION_MAP[key]}`);
    if (p.songNote?.trim()) out.push(`In this song: ${p.songNote.trim()}`);
  }
  out.push("");
  if (i.script?.entry && (i.script.singsTo || i.script.objective)) out.push([i.script.singsTo && `Sings to: ${i.script.singsTo}`, i.script.objective && `Objective: ${i.script.objective}`].filter(Boolean).join(" · "));
  if (i.script?.entry && (i.script.entry.camera || i.script.entry.pace)) out.push([i.script.entry.camera && `Camera: ${i.script.entry.camera}`, i.script.entry.pace && `Pace: ${i.script.entry.pace}`].filter(Boolean).join(" · "));
  if (i.script?.stale) out.push(`(The performance script's direction for this line is stale: ${i.script.stale}. The persona's section line is used instead; check it in the Script panel.)`);
  if (!i.section) out.push("Where the shot sits is not known yet: put the clip on a lyric line for an expression per section.");
  if (i.lyric) out.push(`${i.singing ? "Sung line" : "Lyric line"}: "${i.lyric}"`);
  else if (i.section) out.push("No singing in this shot.");
  if (i.singing) out.push(LIPSYNC_FRAMING);
  out.push("Show the emotion through what the face and body physically do (brows, eyes, breath, mouth, hands).");
  return `${out.join("\n")}\n`;
}

// The acting direction for Make with references (26 Nov 2026): the video model gets the people from their reference
// pictures, so no identity here; only how they act on this line. The persona (gestures, movement, gaze, never) for each
// person in the shot, then the line's direction from the performance script (or the persona's section map), Sings to /
// Objective, camera and pace. "" when there is nothing to say (no persona, no script).
export type ActingInput = {
  people: { name: string; persona: Persona | null; songNote: string | null }[];
  section: { kind: string; name: string; final: boolean } | null;
  script: { entry: ScriptEntry | null; stale: string | null; singsTo?: string; objective?: string } | null;
  lyric: string | null;
};
export function actingDirection(i: ActingInput): string {
  const out: string[] = [];
  const key = i.section ? sectionKeyOf(i.section.kind, i.section.final) : null;
  for (const p of i.people) {
    const per = p.persona && !personaIsEmpty(p.persona) ? p.persona : null;
    const scripted = i.script?.entry ? directionLines(i.script.entry, p.name) : [];
    const lines: string[] = [];
    if (per) {
      if (per.traits.length) lines.push(`${per.traits.join(", ")}.`);
      if (per.gestures.length) lines.push(`Gestures: ${per.gestures.join("; ")}.`);
      if (per.movement) lines.push(`Movement: ${per.movement}.`);
      if (per.gaze) lines.push(`Gaze: ${per.gaze}.`);
    }
    if (scripted.length) lines.push(...scripted.map((x) => `${x}.`.replace(/\.\.$/, ".")));
    else if (key && per) lines.push(`In this part of the song: ${per.sections[key] || DEFAULT_SECTION_MAP[key]}.`);
    if (p.songNote?.trim()) lines.push(`In this song: ${p.songNote.trim()}.`);
    if (per?.never) lines.push(`Never: ${per.never}.`);
    if (lines.length) out.push(`${p.name} acts: ${lines.join(" ")}`);
  }
  if (!out.length) return "";
  if (i.script?.entry && (i.script.singsTo || i.script.objective)) out.push([i.script.singsTo && `Sings to: ${i.script.singsTo}.`, i.script.objective && `Objective: ${i.script.objective}.`].filter(Boolean).join(" "));
  if (i.script?.entry?.camera || i.script?.entry?.pace) out.push([i.script.entry.camera && `Camera: ${i.script.entry.camera}.`, i.script.entry.pace && `Pace: ${i.script.entry.pace}.`].filter(Boolean).join(" "));
  return `Acting direction (show it through the face and body: brows, eyes, breath, mouth, hands; no text on screen): ${out.join(" ")}`;
}
