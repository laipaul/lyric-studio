// The shot list as a script (24 Nov 2026, Paul, for Higgsfield's Short Drama: "Upload your script … PDF, DOCX, FDX, TXT
// or MD"): a readable Markdown text, never the app's JSON. The cast first (who each person is and every look they wear
// in this film, each place), then the story bible, then the shots grouped by the song's sections, each with its time
// on the song, its lyric line, its framing, who is in it in which look, its place and what happens. Read-only: it
// changes nothing; Story room → Shot list → "Save as script".
import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { productionData, timedLines, type CastCard } from "./production";
import { productionView, withLineStarts } from "./shot-production";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export async function shotListScript(ws: Workspace, projectId: string): Promise<string> {
  const data = productionData(ws, projectId);
  const duration = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get()?.duration_ms ?? null;
  let view = productionView(ws, projectId);
  if (!view.shots.length) throw new Error("This song has no shot list yet: import one in Story room first.");
  view = withLineStarts(view, await timedLines(ws, projectId).catch(() => null), duration);
  const cast = data.cast.filter((c): c is CastCard => !("missing" in c && c.missing));
  const out: string[] = [];
  out.push(`# ${data.title}: shot list`, "");
  out.push(`A music film for the song "${data.title}" by ${data.artist}${data.ep ? ` (EP ${data.ep})` : ""}${duration ? `, ${clock(duration)} long` : ""}. ${view.shots.length} shots, in order. The song is the only sound: no dialogue.`, "");

  // The cast: each person with every look they wear in this film (from the shots), each place.
  out.push("## Cast", "");
  // Every person of the cast, and anyone a shot names who is not in it (their card from the library).
  const people = [...cast.filter((x) => x.kind === "character")];
  for (const s of view.shots) for (const w of s.people) {
    if (people.some((c) => c.name === w.character)) continue;
    const card = data.library.find((c) => c.id === w.card || c.name.toLowerCase() === w.character.toLowerCase());
    people.push(card ?? ({ name: w.character, description: null } as CastCard));
  }
  for (const c of people) {
    out.push(`### ${c.name}`);
    if (c.description) out.push(oneLine(c.description));
    const looks = new Map<string, string | null>();
    for (const s of view.shots) for (const w of s.people) if (w.character === c.name && w.look) looks.set(w.look, w.outfit ?? looks.get(w.look) ?? null);
    for (const [look, outfit] of looks) out.push(`- Look "${look}": ${oneLine(outfit) || "(no outfit description)"}`);
    out.push("");
  }
  const places = cast.filter((x) => x.kind === "scene");
  if (places.length) {
    out.push("## Places", "");
    for (const p of places) out.push(`- **${p.name}**: ${oneLine(p.description ?? p.outfit) || "(no description)"}`);
    out.push("");
  }
  if (data.bible.text.trim()) out.push("## Story", "", data.bible.text.trim(), "");

  // The shots, by section.
  out.push("## Shots", "");
  let section = "";
  for (const s of view.shots) {
    if (s.section !== section) {
      section = s.section;
      out.push(`### ${section}`, "");
    }
    const time = s.span ? ` · ${clock(s.span.startMs)}–${clock(s.span.endMs)} (${((s.span.endMs - s.span.startMs) / 1000).toFixed(1)} s)` : "";
    out.push(`**Shot ${s.number}** · ${s.shot}${time}${s.scene ? ` · ${s.scene}` : ""}`);
    out.push(oneLine(s.shows));
    if (s.people.length) out.push(`People: ${s.people.map((w) => `${w.character}${w.look ? ` (${w.look})` : ""}`).join(", ")}${s.outfit ? `. Wearing: ${oneLine(s.outfit)}` : ""}`);
    if (s.line !== null && s.lineText) out.push(`Lyric: "${oneLine(s.lineText)}"`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
