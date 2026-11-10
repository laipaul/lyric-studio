// pnpm storyboards (Theme v2 step 2d): plans every video of every song (each platform of its recipe, every
// video of it: the same plan Shape shows), which writes their storyboard files, and reports per song the moved
// cuts and slips (clips.json) that no video uses any more, with the nearest shot. Nothing is changed in the
// song's own files; old-layout songs (not migrated) and deleted songs are skipped and named.
import { project as projectTable, type Workspace } from "@lyric/db";

import { unusedSongEdits, type StoryboardFile } from "../storyboard-file";
import { readClipEdits } from "./clip-edits";
import { isRemovedSong, songPathsById } from "./song-folder";
import { storyboardChoices, storyboardPlan } from "./storyboard";
import { readStoryboard, storyboardFile, storyboardId } from "./storyboard-file";

export type SongStoryboards = {
  id: string;
  title: string;
  artist: string;
  written: string[]; // storyboard ids ("reels-1")
  skipped: string | null; // why the song was not planned
  failed: { video: string; error: string }[];
  unused: string[]; // moved cuts and slips no video uses, in plain words
};

export async function writeAllStoryboards(ws: Workspace, log: (m: string) => void = () => {}): Promise<SongStoryboards[]> {
  const out: SongStoryboards[] = [];
  const projects = ws.db.select().from(projectTable).all().filter((p) => !isRemovedSong(p.folder));
  for (const p of projects) {
    const r: SongStoryboards = { id: p.id, title: p.title, artist: p.artist, written: [], skipped: null, failed: [], unused: [] };
    out.push(r);
    const paths = songPathsById(ws, p.id);
    if (paths.legacy) {
      r.skipped = "still in the old folders (Library -> Migrate first)";
      continue;
    }
    const choices = storyboardChoices(ws, p.id);
    if (!choices.ready) {
      r.skipped = choices.why ?? "not ready";
      continue;
    }
    const boards: StoryboardFile[] = [];
    for (const platform of choices.platforms) {
      for (const video of platform.videos) {
        const id = storyboardId(platform.name, video);
        log(`${p.title}: ${platform.label} ${video}`);
        try {
          await storyboardPlan(ws, p.id, platform.name, video);
          const sb = readStoryboard(storyboardFile(paths.root, id));
          if (sb) {
            boards.push(sb);
            r.written.push(id);
          }
        } catch (error) {
          r.failed.push({ video: id, error: (error as Error).message });
        }
      }
    }
    const edits = readClipEdits(paths.root);
    r.unused = unusedSongEdits({ cuts: edits.cuts ?? [], slips: edits.slips ?? [] }, boards);
  }
  return out;
}

// The report in plain words.
export function storyboardsReport(songs: readonly SongStoryboards[]): string {
  const lines: string[] = [];
  let unused = 0;
  for (const s of songs) {
    lines.push(`${s.title} (${s.artist})`);
    if (s.skipped) {
      lines.push(`  skipped: ${s.skipped}`);
      continue;
    }
    lines.push(`  shot plans: ${s.written.length ? s.written.join(", ") : "none"}`);
    for (const f of s.failed) lines.push(`  ${f.video}: could not be planned: ${f.error}`);
    if (s.unused.length) {
      lines.push("  your moved cuts / slips that no video uses now (kept in clips.json, nothing deleted):");
      for (const u of s.unused) lines.push(`    - ${u}`);
      unused += s.unused.length;
    } else lines.push("  every moved cut and slip is used (or there are none)");
  }
  lines.push("");
  lines.push(unused ? `${unused} moved cut(s) / slip(s) not used by any video: listed above.` : "All your moved cuts and slips are used by a video.");
  return lines.join("\n");
}
