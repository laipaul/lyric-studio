// The four-stage song page (Prepare -> Shape -> Make -> Review & Post): the Prepare to-do list (only what
// needs the user's ears or eyes) and the platforms a release pack makes. No rendering code is imported
// here, so the studio's server can use it directly.
import { existsSync } from "node:fs";

import { project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { songAssets } from "./assets";
import { lyricsView } from "./lyrics-view";
import { songCollections } from "./project-settings";
import { songPathsById } from "./song-folder";

export { songPlatforms } from "./library";

// The platforms a release pack makes when the song's recipe names none: everything you post to.
export const RELEASE_PLATFORMS = ["reels", "tiktok", "shorts", "youtube", "canvas"];

export type TodoItem = {
  id: string;
  text: string; // plain words: what is needed
  tab: "assets" | "lyrics" | "generate"; // where to do it
  action: string; // the button
  blocking: boolean; // no video can be made without it
};

export async function songTodo(ws: Workspace, projectId: string): Promise<TodoItem[]> {
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) throw new Error("Song not found.");
  const paths = songPathsById(ws, projectId);
  const todo: TodoItem[] = [];
  if (!paths.instrumental && !existsSync(paths.lyricsTxt)) todo.push({ id: "lyrics", text: "Add the lyrics (lyrics.txt).", tab: "assets", action: "Add lyrics", blocking: true });

  const assets = await songAssets(ws, projectId).catch(() => null);
  const collections = songCollections(ws, projectId);
  if (assets && !assets.clips.length && !collections.length)
    todo.push({ id: "clips", text: "Add your clips: drop them in Assets, or tick a collection (e.g. wedding).", tab: "assets", action: "Add clips", blocking: true });
  if (assets && !assets.cover) todo.push({ id: "cover", text: "Add a cover picture (used for YouTube, the Library and your thumbnails).", tab: "assets", action: "Add a cover", blocking: false });

  const view = await lyricsView(ws, projectId).catch(() => null);
  if (view) {
    if (view.labels.length)
      todo.push({
        id: "labels",
        text: `${view.labels.length} line${view.labels.length === 1 ? "" : "s"} in the lyrics look${view.labels.length === 1 ? "s" : ""} like ${view.labels.length === 1 ? "a label" : "labels"} (e.g. “${view.labels[0].text}”), not sung words: remove ${view.labels.length === 1 ? "it" : "them"}.`,
        tab: "lyrics",
        action: "Open the lyrics",
        blocking: false,
      });
    const listen = (view.lines ?? []).filter((l) => (l.flagged || l.lowConfidence) && !l.checkedByEar && l.source !== "hand");
    if (listen.length)
      todo.push({
        id: "listen",
        text: `${listen.length} line${listen.length === 1 ? "" : "s"} to check by ear (line${listen.length === 1 ? "" : "s"} ${listen
          .slice(0, 4)
          .map((l) => l.number)
          .join(", ")}${listen.length > 4 ? ", …" : ""}): listen with ▶, then nudge or mark “Checked by ear”.`,
        tab: "lyrics",
        action: "Listen",
        blocking: false,
      });
  }
  return todo;
}
