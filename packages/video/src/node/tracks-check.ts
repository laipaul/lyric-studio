// pnpm tracks:check (the two-layer timeline, Part A, 28 Nov 2026): proves on Paul's own songs that reading the edit
// through the tracks changes nothing. For every song and every video it would make (as Shape lists them), the planner
// runs twice without rendering (dry run): once with the edit straight from song.json / clips.json, once through the
// tracks; the render props, the anchor report, the line slots and the plan's fingerprint (which tells whether a saved
// shot plan stays as it is) must be identical. Changes no file: tracks.json is not written either.
import { existsSync } from "node:fs";

import { project as projectTable, type Workspace } from "@lyric/db";

import { fromEdit, toEdit } from "../tracks";
import { makeVideos, type MakeOptions, type PlatformPlan } from "./make";
import { resolveRecipe, studioCounts } from "./recipe";
import { isRemovedSong, songPathsById } from "./song-folder";
import { savedPlanCounts, storyboardChoices } from "./storyboard";
import { recipeInputFor } from "./style";
import { songEdit } from "./tracks";

export type VideoCheck = { platform: string; video: string; identical: boolean; differences: string[] };
export type SongCheck = { id: string; title: string; skipped: string | null; failed: string | null; tracks: { singer: number; story: number; pinned: number; inserts: number; cutaways: number } | null; videos: VideoCheck[] };

// The first differences between two values, as paths ("props.shots[12].start: 410 → 412"), at most `max`.
export function differences(a: unknown, b: unknown, at = "", out: string[] = [], max = 8): string[] {
  if (out.length >= max) return out;
  if (Object.is(a, b)) return out;
  const isObj = (v: unknown) => v !== null && typeof v === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${at}[${k}]` : at ? `${at}.${k}` : k, out, max);
      if (out.length >= max) break;
    }
    return out;
  }
  const show = (v: unknown) => (v === undefined ? "(none)" : JSON.stringify(v)?.slice(0, 80));
  out.push(`${at || "(the whole value)"}: ${show(a)} → ${show(b)}`);
  return out;
}

const compared = (p: PlatformPlan, video: string) => {
  const v = p.videos.find((x) => x.spec.name === video) ?? null;
  return v ? { props: v.props, anchors: v.anchors, planKey: v.planKey, slots: p.slots } : null;
};

export async function tracksCheck(ws: Workspace, log: (m: string) => void = () => {}): Promise<SongCheck[]> {
  const out: SongCheck[] = [];
  const projects = ws.db.select().from(projectTable).all().filter((p) => !isRemovedSong(p.folder));
  for (const p of projects) {
    const r: SongCheck = { id: p.id, title: p.title, skipped: null, failed: null, tracks: null, videos: [] };
    out.push(r);
    const paths = songPathsById(ws, p.id);
    if (paths.legacy) {
      r.skipped = "still in the old folders (Library → Migrate first)";
      continue;
    }
    if (!paths.audio || !existsSync(paths.audio)) {
      r.skipped = "no song file";
      continue;
    }
    try {
      // The tracks themselves: made from the edit and turned back, exactly.
      const edit = songEdit(paths.recipe, paths.root);
      const t = fromEdit(edit);
      r.tracks = { singer: t.singer.length, story: t.broll.story.length, pinned: t.broll.pinned.length, inserts: t.broll.inserts.length, cutaways: t.broll.cutaways.length };
      const back = differences(edit, toEdit(t), "edit");
      if (back.length) r.videos.push({ platform: "(the edit)", video: "tracks.json", identical: false, differences: back });
      const choices = storyboardChoices(ws, p.id);
      if (!choices.ready) {
        r.skipped = choices.why ?? "not ready";
        continue;
      }
      for (const platform of choices.platforms) {
        log(`${p.title}: ${platform.label}`);
        const base: MakeOptions = {
          workspaceDir: ws.dir,
          song: paths.audio,
          lyrics: paths.lyricsTxt,
          ...(paths.hints && existsSync(paths.hints) ? { hint: paths.hints } : {}),
          platforms: platform.name,
          variationsBy: { [platform.name]: studioCounts(resolveRecipe(recipeInputFor(ws, p.id).input).values, [platform.name])[platform.name] ?? Math.max(1, savedPlanCounts(paths.root).get(platform.name) ?? 0) },
          dryRun: true,
          frameCheck: false,
          writeTracks: false,
          log: () => {},
        };
        const plan = async (editSource: "files" | "tracks") => {
          const res = await makeVideos({ ...base, editSource });
          const pl = res.platforms[0];
          if (pl?.error) throw new Error(pl.error);
          if (!pl?.plan) throw new Error(`no plan for ${platform.label}`);
          return pl.plan;
        };
        const before = await plan("files");
        const after = await plan("tracks");
        for (const video of platform.videos) {
          const d = differences(compared(before, video), compared(after, video), "");
          r.videos.push({ platform: platform.label, video, identical: d.length === 0, differences: d });
        }
      }
    } catch (error) {
      r.failed = (error as Error).message;
    }
  }
  return out;
}

// The report in plain words; `ok`: every video identical and nothing failed.
export function tracksCheckReport(songs: readonly SongCheck[]): { text: string; ok: boolean } {
  const lines: string[] = [];
  let videos = 0;
  let same = 0;
  for (const s of songs) {
    const t = s.tracks ? ` (V1 Singer: ${s.tracks.singer} segment(s); V2 B-roll: ${s.tracks.story} in the story line, ${s.tracks.pinned} on lines, ${s.tracks.inserts} B-roll, ${s.tracks.cutaways} cut-away(s))` : "";
    if (s.failed) lines.push(`✗ ${s.title}: could not be checked: ${s.failed}`);
    else if (s.skipped && !s.videos.length) lines.push(`- ${s.title}: skipped (${s.skipped})${t}`);
    else {
      const bad = s.videos.filter((v) => !v.identical);
      lines.push(`${bad.length ? "✗" : "✓"} ${s.title}: ${s.videos.length - bad.length} of ${s.videos.length} video(s) identical${t}`);
      for (const v of bad) lines.push(`    ✗ ${v.platform} ${v.video}:\n${v.differences.map((d) => `        ${d}`).join("\n")}`);
    }
    videos += s.videos.length;
    same += s.videos.filter((v) => v.identical).length;
  }
  const ok = same === videos && !songs.some((s) => s.failed);
  lines.push("", ok ? `identical: all ${videos} video(s) of ${songs.length} song(s) come out exactly the same through the tracks.` : `NOT identical: ${videos - same} of ${videos} video(s) differ${songs.some((s) => s.failed) ? ", and some songs could not be checked" : ""}. Nothing was changed; send this report to Claude.`);
  return { text: lines.join("\n"), ok };
}
