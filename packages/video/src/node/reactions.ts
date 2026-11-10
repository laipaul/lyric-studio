// Reactions (Step C): the user's creative judgement on a video as a keyword; the app turns it into one
// setting for the next run (guiding principle: the translation is the app's job). Each reaction first
// says what it would change ("Next run: …"), then applies it to this song (song.json) or to all the
// artist's songs (brand.json, per platform). Every change is an ordinary recipe setting: the Style tab
// shows it and Reset undoes it. A log is kept in the song's .studio\feedback.jsonl.
// No Remotion code here: the studio's server uses it.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, REPO_ROOT, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { setVideoMark } from "./exports";
import type { Manifest } from "./manifest";
import { readRecipe, resolveRecipe, setField, writeRecipe, type RecipeField } from "./recipe";
import { songPathsById, STUDIO_DIR } from "./song-folder";
import { recipeInputFor, setBrandPerPlatform } from "./style";
import { isThemeField, setThemeLook } from "./themes";
import { loadFontCatalog } from "./font-catalog";
import { parsePresets } from "../platform";
import { LOOP_PLATFORMS, REACTIONS, type Reaction } from "../reactions-list";

export { REACTIONS, reactionsFor, type Reaction } from "../reactions-list";
export type ReactionScope = "song" | "artist";

const SHIFT_MIN = -3;
const SHIFT_MAX = 4;

export type ReactionPlan = {
  reaction: Reaction;
  label: string;
  text: string; // "Next run: …"
  changes: { field: RecipeField; value: unknown }[]; // recipe settings (song.json or brand.json)
  mark?: boolean; // love: favourite + approved
  scopes: ReactionScope[]; // where it may apply
  none?: string; // nothing to change, and why
};

function readManifest(ws: Workspace, video: string): Manifest {
  const file = absPath(ws, video);
  if (!existsSync(file)) throw new Error(`No video ${video}.`);
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

export function planReaction(ws: Workspace, projectId: string, o: { video: string; reaction: Reaction; clip?: string }): ReactionPlan {
  if (!(o.reaction in REACTIONS)) throw new Error(`Unknown reaction "${o.reaction}".`);
  const m = readManifest(ws, o.video);
  const platform = m.platform?.name ?? "standard";
  const { input } = recipeInputFor(ws, projectId);
  const now = resolveRecipe(input, platform).values;
  const settings = (m.settings ?? {}) as Record<string, unknown>;
  const pace = settings.pace as { verse_bars?: number; hook_bars?: number } | null | undefined;
  const base = { reaction: o.reaction, label: REACTIONS[o.reaction], changes: [] as ReactionPlan["changes"], scopes: ["song", "artist"] as ReactionScope[] };
  const bars = (n: number) => `${n} bar${n === 1 ? "" : "s"}`;
  const shiftBy = (d: number, why: string): ReactionPlan => {
    const mode = now.shotLength ?? "auto";
    if (mode !== "auto") {
      // An explicit shot length: one step on 1 / 2 / 4 / 8 bars.
      const ladder = ["1", "2", "4", "8"];
      const i = ladder.indexOf(String(mode));
      const next = i < 0 ? null : ladder[i + d];
      if (!next) return { ...base, text: "", none: i < 0 ? `the shot length is "${mode}"; set it to auto on the Shape page first` : d > 0 ? "the shots are already 8 bars long" : "the shots are already one bar long" };
      return { ...base, text: `Next run: ${bars(Number(next))} per shot instead of ${bars(Number(mode))}${why}.`, changes: [{ field: "shotLength", value: next }] };
    }
    const shift = Math.max(SHIFT_MIN, Math.min(SHIFT_MAX, (now.paceShift ?? 0) + d));
    if (shift === (now.paceShift ?? 0)) return { ...base, text: "", none: d > 0 ? "the pace is already as calm as it goes" : "the pace is already as fast as it goes" };
    if (d < 0 && pace?.verse_bars === 1 && pace?.hook_bars === 1) return { ...base, text: "", none: "the shots are already one bar long" };
    const v = pace?.verse_bars;
    const h = pace?.hook_bars;
    const detail = v ? ` (verses ${bars(v)} → ${bars(Math.max(1, v + d))}${h ? `, hooks ${bars(h)} → ${bars(Math.max(1, h + d))}` : ""})` : "";
    return { ...base, text: `Next run: shots one bar ${d > 0 ? "longer" : "shorter"}${detail}${why}.`, changes: [{ field: "paceShift", value: shift }] };
  };

  switch (o.reaction) {
    case "too-fast":
      return shiftBy(1, "");
    case "too-slow":
      return shiftBy(-1, "");
    case "repetitive": {
      const p = shiftBy(1, ": fewer shots, so each clip comes back less often; adding clips to the song helps most");
      return p.none ? { ...p, none: `${p.none}; add more clips or photos to the song (Prepare → Storyboard)` } : p;
    }
    case "fewer-dissolves":
      return now.transitions === "crisp"
        ? { ...base, text: "", none: "the transitions are already crisp (cuts only); a single clip can still come in with a dissolve (clip editor)" }
        : { ...base, text: "Next run: crisp transitions (hard cuts on the beat, no dissolves or dips).", changes: [{ field: "transitions", value: "crisp" }] };
    case "more-dreamy":
      return now.transitions === "flowing"
        ? { ...base, text: "", none: "the transitions are already flowing" }
        : { ...base, text: "Next run: flowing transitions (soft dissolves outside the choruses, a dip into each chorus).", changes: [{ field: "transitions", value: "flowing" }] };
    case "abrupt-ending":
      if (!LOOP_PLATFORMS.includes(platform)) return { ...base, text: "", none: "this platform has no loop ending" };
      if (now.ending === "ring-out") return { ...base, text: "", none: "the ending already rings out (or fades where a ring-out does not fit)" };
      return { ...base, text: "Next run: the last chord rings out one more bar and fades (a soft fade where a ring-out does not fit).", changes: [{ field: "ending", value: "ring-out" }], scopes: ["song", "artist"] };
    case "hard-to-read":
      return now.readability === "strong"
        ? { ...base, text: "", none: "the lyrics already have the soft dark band; a lighter clip or a bolder font (Shape page) helps more" }
        : { ...base, text: "Next run: a soft dark band behind the lyrics on every shot, so they stay readable on bright clips.", changes: [{ field: "readability", value: "strong" }] };
    case "love": {
      const changes: ReactionPlan["changes"] = [];
      const style = settings.transition_style as string | undefined;
      if (style && style !== now.transitions) changes.push({ field: "transitions", value: style });
      const ending = (settings.ending as { kind?: string } | null | undefined)?.kind;
      if (ending && ["loop", "fade", "ring-out"].includes(ending) && LOOP_PLATFORMS.includes(platform) && ending !== now.ending) changes.push({ field: "ending", value: ending });
      for (const [k, f] of [["line_effect", "verseEffect"], ["hook_effect", "hookEffect"]] as const) {
        const v = settings[k];
        if (typeof v === "string" && v && v !== now[f]) changes.push({ field: f, value: v });
      }
      const kept = changes.map((c) => `${c.field} ${String(c.value)}`).join(", ");
      return { ...base, scopes: ["song"], mark: true, changes, text: `Marked favourite and approved${kept ? `; next runs keep this video's choices (${kept})` : "; the song's recipe already makes videos like this one"}.` };
    }
  }
}

export function applyReaction(ws: Workspace, projectId: string, o: { video: string; reaction: Reaction; clip?: string; scope: ReactionScope }): { text: string; applied: string } {
  const plan = planReaction(ws, projectId, o);
  if (plan.none) return { text: plan.none, applied: "nothing changed" };
  if (!plan.scopes.includes(o.scope)) throw new Error(`"${plan.label}" applies to this song only.`);
  const m = readManifest(ws, o.video);
  const platform = m.platform?.name ?? "standard";
  const paths = songPathsById(ws, projectId);
  if (!paths.recipe) throw new Error("This song still uses the old folders: migrate it first (Library → Migrate).");
  let applied: string;
  if (o.scope === "song" || !plan.changes.length) {
    let song = readRecipe(paths.recipe);
    // Fonts and effects belong to the song's theme (a copy for this song when other songs share it).
    const look = Object.fromEntries(plan.changes.filter((c) => isThemeField(c.field)).map((c) => [c.field, c.value]));
    if (Object.keys(look).length) {
      setThemeLook(ws, { projectId, values: look, scope: "song", catalog: loadFontCatalog(ws.dir) });
      song = readRecipe(paths.recipe);
    }
    for (const c of plan.changes.filter((x) => !isThemeField(x.field))) {
      song = setField(song, c.field, c.value);
      // A per-platform value of this song for the video's platform would hide the new default: it goes.
      const own = song.perPlatform?.[platform] as Record<string, unknown> | undefined;
      if (own && c.field in own) {
        const rest = { ...own };
        delete rest[c.field];
        song = { ...song, perPlatform: { ...song.perPlatform, [platform]: rest } };
      }
    }
    if (plan.changes.length) writeRecipe(paths.recipe, song);
    if (plan.mark) setVideoMark(ws, projectId, o.video, { favourite: true, status: "approved" });
    applied = plan.changes.length ? "this song (song.json)" : "marked";
  } else {
    const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    const artist = p?.artist ?? "Life Lyrics";
    const presets = parsePresets(JSON.parse(readFileSync(path.join(REPO_ROOT, "presets", "platforms.json"), "utf8")), "platforms.json");
    const platforms = Object.values(presets).filter((x) => x.layout !== "canvas").map((x) => x.name);
    for (const c of plan.changes) {
      for (const name of c.field === "ending" ? platforms.filter((n) => LOOP_PLATFORMS.includes(n)) : platforms) {
        setBrandPerPlatform(ws, { artist, platform: name, field: c.field, value: c.value as string | number });
      }
    }
    applied = `all ${artist} songs (brand.json)`;
  }
  // The log: what the user said and what changed.
  const dir = path.join(paths.root, STUDIO_DIR);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "feedback.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), video: o.video, platform, reaction: o.reaction, clip: o.clip ?? null, scope: o.scope, changes: plan.changes, text: plan.text })}\n`);
  return { text: plan.text, applied };
}
