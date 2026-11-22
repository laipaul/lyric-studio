// The Midjourney first-frame prompt of a shot (C3 Part 2a, 22 Nov 2026; Paul: "that doesn't give me the prompt for
// MJ"). Written by the app from what it already knows, so Paul never writes or asks for one: the shot's framing and
// what happens, each person's locked description and the outfit of the look they wear (or the shot's own outfit), the
// scene card, a memory's softer feel, the song's Film look in Midjourney words, the picture shape. No names (the bible's
// rule: models drift on names). Midjourney reads "never X" as "X", so the "Never …" sentences become its --no list, and
// instructions meant for reference-image models ("Preserve …", "Match … the reference image") are left out.
// No face or body description (Paul, 22 Nov 2026: "all your prompts are being rejected by MJ"): age, ethnicity, build,
// lips and skin sentences made Midjourney's moderator refuse them, and Midjourney keeps a face better from a picture
// than from words. The face comes from the person's locked picture given as Midjourney's Omni Reference (Production
// shows it next to Copy prompt); the words say what happens, the outfit, the place and the look. Pure.

export type PromptPerson = { name: string; description: string | null; outfit: string | null }; // description: only to tell "the woman" from "the man"
export type ShotPromptInput = {
  shows: string;
  shot: "close-up" | "medium" | "wide" | "detail" | "motion";
  tag?: string;
  outfit?: string; // the shot's own outfit (e.g. a memory's everyday clothes), instead of the look's
  people: PromptPerson[];
  scene: { name: string; description: string | null } | null;
  filmLook: string | null; // the Film look's Midjourney words (else its look line)
  aspect: "9:16" | "16:9";
};

const FRAMING: Record<ShotPromptInput["shot"], string> = {
  "close-up": "cinematic close-up portrait",
  medium: "cinematic medium shot",
  wide: "cinematic wide establishing shot",
  detail: "cinematic extreme close-up detail shot",
  motion: "candid cinematic moment in motion",
};

const sentences = (t: string) => t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
const tidy = (t: string) => t.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/[.,;\s]+$/, "").trim();

// A description or outfit for Midjourney: the plain sentences, and the "never" phrases for --no.
export function forMidjourney(text: string | null | undefined): { text: string; no: string[] } {
  const keep: string[] = [];
  const no: string[] = [];
  for (const s of sentences(text ?? "")) {
    if (/^never\b/i.test(s)) {
      for (const part of s.replace(/[.!]+$/, "").split(/,\s*/)) {
        const item = part.replace(/^(and\s+)?never\s+/i, "").trim();
        if (item) no.push(item);
      }
      continue;
    }
    if (/^(preserve|keep the same|match\b)|reference (image|picture)|across (all )?(views|close-ups|shots)/i.test(s)) continue;
    // Behaviour is the shot's job (what happens), not the look's: "her resting expression…", "when he sees the bride…".
    if (/\bexpression\b|^when (he|she|they)\b|\bemotion shows\b/i.test(s)) continue;
    const plain = tidy(s.replace(/\s*\([^)]*\)/g, "").replace(/,\s*never\b[^,.;]*/gi, ""));
    if (plain) keep.push(plain);
  }
  return { text: keep.join(". "), no };
}

// What a person is called in the shot's words instead of their name.
// By the card's own words: who it says "she / her / woman" of, or "he / his / man" (a groom's card may mention the bride).
function roleOf(p: PromptPerson): string {
  const d = ` ${(p.description ?? "").toLowerCase()} `;
  const count = (re: RegExp) => (d.match(re) ?? []).length;
  const her = count(/\b(she|her|hers|woman|girl|lady)\b/g);
  const him = count(/\b(he|his|him|man|boy|gentleman)\b/g);
  if (her > him) return "the woman";
  if (him > her) return "the man";
  return "the person";
}

// Midjourney settings written into a text (a Film look's words often end with "--ar 9:16 --style raw --stylize 100"):
// the words without them, and the settings in order (name -> value, "" for a switch). Pure.
export function splitParams(text: string): { words: string; params: [string, string][] } {
  const params: [string, string][] = [];
  const at = text.search(/(^|\s)--[a-z]/i);
  if (at < 0) return { words: text.trim(), params };
  const tail = text.slice(at);
  for (const m of tail.matchAll(/--([a-z]+)((?:\s+(?!--)[^\s]+)*)/gi)) params.push([m[1].toLowerCase(), m[2].trim()]);
  return { words: text.slice(0, at).trim(), params };
}

export function shotPrompt(i: ShotPromptInput): string {
  let shows = i.shows.trim();
  for (const p of i.people) if (p.name.trim()) shows = shows.replace(new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), roleOf(p));
  shows = tidy(shows.replace(/^memory:\s*/i, ""));
  const no: string[] = [];
  const parts = [`${FRAMING[i.shot]}: ${shows}`];
  for (const p of i.people) {
    const o = forMidjourney(i.outfit ?? p.outfit);
    no.push(...o.no);
    if (!o.text) continue;
    const wear = `${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}`;
    // Two or more people: each one's outfit named for them, so they do not mix.
    parts.push(i.people.length > 1 ? `${roleOf(p)} wearing ${wear}` : `wearing ${wear}`);
  }
  if (i.scene) {
    const s = forMidjourney(i.scene.description);
    no.push(...s.no);
    if (s.text) parts.push(`the place: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`);
  }
  if ((i.tag ?? "").toLowerCase() === "memory" || /^memory:/i.test(i.shows.trim())) parts.push("a nostalgic memory, slightly faded colours, soft haze");
  // The Film look's own settings join the shot's, each once: the shape is the song's (--ar), --style raw stays, its
  // others (e.g. --stylize 100) are kept, and its --no items join the shot's.
  const film = splitParams(i.filmLook ?? "");
  if (film.words) parts.push(tidy(film.words));
  const settings = new Map<string, string>([["ar", i.aspect], ["style", "raw"]]);
  for (const [k, v] of film.params) {
    if (k === "no") no.push(...v.split(/,\s*/).filter(Boolean));
    else if (k === "ar" || k === "aspect") continue;
    else if (!settings.has(k)) settings.set(k, v);
  }
  const unique = [...new Set(no.map((n) => n.toLowerCase().trim()).filter(Boolean))];
  if (unique.length) settings.set("no", unique.join(", "));
  return `${parts.map(tidy).filter(Boolean).join(", ")} ${[...settings].map(([k, v]) => (v ? `--${k} ${v}` : `--${k}`)).join(" ")}`;
}
