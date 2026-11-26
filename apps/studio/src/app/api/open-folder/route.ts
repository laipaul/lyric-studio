// "Open folder": shows the file in Windows Explorer (selected); only export files of a song. With
// { projectId } it opens that song's folder (songs\<artist>\<title>\); with { collection } that collection's folder.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir } from "@lyric/db";

import { collectionFolder } from "@lyric/video/collections";
import { songPathsById } from "@lyric/video/song-folder";

import { allowedFile, TEMPLATE_FILE } from "@/lib/files";
import { withWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const { file, projectId, collection, performance } = (await request.json()) as { file?: string; projectId?: string; collection?: string; performance?: string };
  // A performance excerpt's folder (Storyboard → an accepted singing slot): songs\<artist>\<title>\performance\<name>\ only.
  if (projectId && performance) {
    const folder = withWorkspace((ws) => {
      const paths = songPathsById(ws, projectId);
      if (paths.legacy) return null;
      const base = path.join(paths.root, "performance");
      const full = path.resolve(base, performance);
      return path.dirname(full) === path.resolve(base) ? full : null;
    });
    if (!folder || !existsSync(folder)) return Response.json({ error: "Export the excerpt first" }, { status: 404 });
    open(process.platform === "win32" ? ["explorer.exe", [folder]] : process.platform === "darwin" ? ["open", [folder]] : ["xdg-open", [folder]]);
    return Response.json({ ok: true, folder });
  }
  if (collection) {
    let folder: string | null = null;
    try {
      folder = withWorkspace((ws) => collectionFolder(ws, collection));
    } catch {
      folder = null;
    }
    if (!folder || !existsSync(folder)) return Response.json({ error: "No such collection" }, { status: 404 });
    open(process.platform === "win32" ? ["explorer.exe", [folder]] : process.platform === "darwin" ? ["open", [folder]] : ["xdg-open", [folder]]);
    return Response.json({ ok: true, folder });
  }
  if (projectId) {
    const folder = withWorkspace((ws) => {
      const paths = songPathsById(ws, projectId);
      return paths.legacy ? null : paths.root;
    });
    if (!folder || !existsSync(folder)) return Response.json({ error: "This song has no folder yet" }, { status: 404 });
    open(process.platform === "win32" ? ["explorer.exe", [folder]] : process.platform === "darwin" ? ["open", [folder]] : ["xdg-open", [folder]]);
    return Response.json({ ok: true, folder });
  }
  if (!file || file.includes("..") || !(allowedFile(file) || TEMPLATE_FILE.test(file))) return Response.json({ error: "Not an export or template file" }, { status: 400 });
  const full = path.join(resolveWorkspaceDir(), ...file.split("/"));
  if (!existsSync(full)) return Response.json({ error: "File not found" }, { status: 404 });
  open(process.platform === "win32" ? ["explorer.exe", [`/select,${full}`]] : process.platform === "darwin" ? ["open", ["-R", full]] : ["xdg-open", [path.dirname(full)]]);
  return Response.json({ ok: true, folder: path.dirname(full) });
}

function open([command, args]: [string, string[]]): void {
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false }).on("error", () => {}).unref();
  } catch {
    // no file manager (e.g. a server without a desktop): nothing to open
  }
}
