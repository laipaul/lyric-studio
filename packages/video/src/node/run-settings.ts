// The Videos tab (Step 6.2c-2b): the settings a run was made with (from its manifests, per platform),
// next to the song's recipe as it is now, and "Use these settings" (a Generate pre-fill). Manifests are
// read as JSON (no rendering code here, so the studio's server can use it directly).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Workspace } from "@lyric/db";

import type { AnchorUse } from "../anchors";
import { clockText } from "../section";
import { SHORT_LABELS } from "./exports";
import type { Manifest } from "./manifest";
import { readRecipe, resolveRecipe, type RecipeValues } from "./recipe";
import { songPathsById } from "./song-folder";
import { recipeInputFor } from "./style";
import { overrideCount, readTextboard, textboardHash } from "./textboard";

export type RunPlatformSettings = {
  platform: string;
  label: string;
  videos: number;
  theme: string | null; // the theme the videos were made with (null: before themes)
  verseEffect: string | null; // null: not recorded (older runs)
  hookEffect: string | null;
  verseFont: string | null;
  hookFont: string | null;
  accentColour: string | null;
  collections: string[] | null;
  cutRate: string | null;
  section: { mode: string; startMs: number; endMs: number } | null;
  targetLength: number | null;
  youtubeLayout: string | null;
  anchors: AnchorUse[] | null; // story anchors of its first video (null: none, or an older run)
  textboard: { file: string | null; hash: string | null; template: string | null; changes: number } | null; // null: an older run
  pictures: string[]; // picture versions: each video's clip set ("v2 city")
};

export type SettingsRow = { key: string; label: string; then: string; now: string; differs: boolean };
export type RunComparison = { platform: string; label: string; videos: number; rows: SettingsRow[] };

type ManifestJson = Partial<Manifest> & {
  settings?: Record<string, unknown>;
  props?: { style?: { font?: string }; hookFont?: { font?: string } | null; lyricEffects?: { accent?: string } | null; layout?: string };
};

const range = (s: { startMs: number; endMs: number }) => `${clockText(s.startMs).replace(/\.\d$/, "")}–${clockText(s.endMs).replace(/\.\d$/, "")}`;

function readManifests(dir: string): ManifestJson[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^v\d+\.manifest\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(dir, f), "utf8")) as ManifestJson;
      } catch {
        return null;
      }
    })
    .filter((m): m is ManifestJson => !!m);
}

// The settings of one run, per platform (its first video; the others differ only in order / style).
export function runSettings(ws: Workspace, projectId: string, folder: string): RunPlatformSettings[] {
  const runDir = path.join(songPathsById(ws, projectId).exports, folder);
  if (!/^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(folder) || !existsSync(runDir)) throw new Error(`No run ${folder} for this song.`);
  const groups: [string, ManifestJson[]][] = [];
  const top = readManifests(runDir);
  if (top.length) groups.push([top[0].platform?.name ?? "standard", top]);
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const ms = readManifests(path.join(runDir, d.name));
    if (ms.length) groups.push([ms[0].platform?.name ?? d.name, ms]);
  }
  return groups.map(([platform, ms]) => {
    const m = ms[0];
    const s = m.settings ?? {};
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const collectionNames = Array.isArray(s.collections)
      ? (s.collections as string[])
      : typeof (s.collection as { name?: unknown } | undefined)?.name === "string"
        ? String((s.collection as { name: string }).name)
            .split(" + ")
            .filter((n) => n !== "song clips" && !n.startsWith("song:"))
        : null;
    return {
      platform,
      label: SHORT_LABELS[platform] ?? m.platform?.preset?.label ?? platform,
      videos: ms.length,
      theme: str(s.theme),
      verseEffect: str(s.line_effect),
      hookEffect: str(s.hook_effect),
      verseFont: str(m.props?.style?.font) ?? str(s.font),
      hookFont: str(m.props?.hookFont?.font) ?? str(s.font_hook),
      accentColour: str(m.props?.lyricEffects?.accent),
      collections: collectionNames,
      cutRate: str(s.cut_rate),
      section: m.section ? { mode: m.section.mode, startMs: m.section.start_ms, endMs: m.section.end_ms } : null,
      targetLength: typeof s.target_length === "number" ? s.target_length : null,
      youtubeLayout: platform === "youtube" ? (str(m.props?.layout) ?? null) : null,
      anchors: m.anchors?.used?.length ? m.anchors.used : null,
      textboard: m.textboard ? { file: m.textboard.file, hash: m.textboard.hash, template: m.textboard.template, changes: m.textboard.changes } : null,
      pictures: ms.filter((x) => x.picture).map((x) => `v${x.picture!.index} ${x.picture!.label}`),
    };
  });
}

// "line 9 → hands.mp4 (0:41.0, dissolve), line 12 → … ; not in this section: line 31 (sea.mp4)"
export function anchorsText(uses: readonly AnchorUse[]): string {
  const used = uses.filter((u) => u.used).map((u) => `line ${u.line} → ${u.clip} (${clockText(u.at_ms ?? 0)}${u.transition === "dissolve" ? ", dissolve" : ""}${u.playback_rate ? `, slowed ${u.playback_rate.toFixed(2)}x` : ""})`);
  const out = uses.filter((u) => !u.used).map((u) => `line ${u.line} (${u.clip}${u.why && u.why !== "outside this section" ? `: ${u.why}` : ""})`);
  return [used.join(", ") || "none used", ...(out.length ? [`not in this video: ${out.join(", ")}`] : [])].join("; ");
}

// One run next to the recipe as it is now, platform by platform.
export function compareRunToRecipe(ws: Workspace, projectId: string, folder: string): RunComparison[] {
  const { input } = recipeInputFor(ws, projectId);
  return runSettings(ws, projectId, folder).map((r) => {
    const now = resolveRecipe(input, r.platform).values;
    const rows: SettingsRow[] = [];
    const add = (key: string, label: string, then: string | null, current: string, compare = true) =>
      rows.push({ key, label, then: then ?? "not recorded", now: current, differs: compare && then !== null && then.toLowerCase() !== current.toLowerCase() });
    const isCanvas = r.platform === "canvas";
    if (!isCanvas) {
      if (r.theme) add("theme", "Theme", r.theme, readRecipe(songPathsById(ws, projectId).recipe).theme ?? "none");
      add("verseEffect", "Verse effect", r.verseEffect, now.verseEffect);
      add("hookEffect", "Hook effect", r.hookEffect, now.hookEffect);
      add("verseFont", "Verse font", r.verseFont, now.verseFont);
      add("hookFont", "Hook font", r.hookFont, now.hookFont);
      add("accentColour", "Accent", r.accentColour, now.accentColour);
    }
    add("collections", "Collections", r.collections ? r.collections.join(", ") || "song clips only" : null, now.collections.join(", ") || "song clips only");
    if (r.section && r.platform !== "youtube" && !isCanvas) {
      const len = (r.section.endMs - r.section.startMs) / 1000;
      const then = `${r.section.mode === "auto" ? "auto" : r.section.mode === "full" ? "whole song" : "fixed"} ${range(r.section)} (${Math.round(len)} s)`;
      const nowText = now.section === "auto" ? `auto${now.length ? ` · ${now.length} s` : ""}` : now.section === "full" ? "whole song" : now.section;
      rows.push({ key: "section", label: "Section", then, now: nowText, differs: (r.section.mode === "auto") !== (now.section === "auto") });
    }
    if (r.platform === "youtube") add("youtubeLayout", "Layout", r.youtubeLayout, now.youtubeLayout);
    // Story anchors: which ones this run used (and which were outside its section), against song.json now.
    const nowAnchors = input.song.anchors ?? [];
    if (r.anchors || nowAnchors.length) {
      const then = r.anchors ? anchorsText(r.anchors) : "none";
      const key = (xs: readonly { line: number; clip: string }[]) => xs.map((a) => `${a.line}=${a.clip.toLowerCase()}`).sort().join(",");
      const nowText = nowAnchors.length ? nowAnchors.map((a) => `line ${a.line} → ${a.clip}`).join(", ") : "none";
      rows.push({ key: "anchors", label: "Story anchors", then, now: nowText, differs: key(r.anchors ?? []) !== key(nowAnchors) });
    }
    // The textboard (and its template) the run used, against the song's textboard.json now.
    if (!isCanvas) {
      const board = (() => {
        try {
          return readTextboard(songPathsById(ws, projectId).root);
        } catch {
          return null;
        }
      })();
      const text = (t: { file: string | null; template: string | null; changes: number; hash?: string | null }) =>
        t.file ? `textboard.json (${t.changes} change${t.changes === 1 ? "" : "s"}${t.template ? `, template "${t.template}"` : ""})` : "the brand's defaults";
      const nowBoard = board ? { file: "textboard.json", template: board.template, changes: overrideCount(board), hash: textboardHash(board) } : { file: null, template: null, changes: 0, hash: null };
      rows.push({ key: "textboard", label: "Textboard", then: r.textboard ? text(r.textboard) : "not recorded", now: text(nowBoard), differs: !!r.textboard && r.textboard.hash !== nowBoard.hash });
    }
    if (r.pictures.length) rows.push({ key: "pictures", label: "Picture versions", then: r.pictures.join(", "), now: "—", differs: false });
    return { platform: r.platform, label: r.label, videos: r.videos, rows };
  });
}

// "Use these settings": what Generate starts with for this run. An auto section comes back as the exact
// times that run used ("0:34–1:06 (from that run)"), with its target length for the one-click switch
// back to "auto"; a fixed section exactly as it was.
export type GeneratePreset = {
  folder: string;
  platforms: string[];
  variations: Record<string, number>;
  lineEffect: string | null;
  hookEffect: string | null;
  collections: string[] | null;
  section: string | null; // "0:34.213-1:06.000" (exact, as pnpm make accepts) or "full"
  sectionLabel: string | null; // "0:34–1:06 (from that run)"
  sectionWasAuto: boolean;
  targetLength: number | null; // that run's target length (auto), if it was recorded
  layout: RecipeValues["youtubeLayout"] | null;
};

export function generatePresetFromRun(ws: Workspace, projectId: string, folder: string): GeneratePreset {
  const runs = runSettings(ws, projectId, folder);
  const one = <T>(pick: (r: RunPlatformSettings) => T | null): T | null => {
    const values = runs.filter((r) => r.platform !== "canvas").map(pick);
    return values.length && values.every((v) => JSON.stringify(v) === JSON.stringify(values[0])) ? values[0] : null;
  };
  // One section for the run: the first short-form / standard platform's (YouTube is always the whole song).
  const sectioned = runs.find((r) => r.section && r.platform !== "youtube" && r.platform !== "canvas");
  const sec = sectioned?.section ?? null;
  // To the millisecond, so the run's exact section comes back ("0:34.213").
  const exact = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, "0")}`;
  return {
    folder,
    platforms: runs.map((r) => r.platform),
    variations: Object.fromEntries(runs.map((r) => [r.platform, r.videos])),
    lineEffect: one((r) => r.verseEffect),
    hookEffect: one((r) => r.hookEffect),
    collections: one((r) => r.collections),
    section: sec ? (sec.mode === "full" ? "full" : `${exact(sec.startMs)}-${exact(sec.endMs)}`) : null,
    sectionLabel: sec ? (sec.mode === "full" ? "whole song (from that run)" : `${range(sec)} (from that run)`) : null,
    sectionWasAuto: sec?.mode === "auto",
    targetLength: sectioned?.targetLength ?? null,
    layout: (runs.find((r) => r.platform === "youtube")?.youtubeLayout as RecipeValues["youtubeLayout"] | null) ?? null,
  };
}
