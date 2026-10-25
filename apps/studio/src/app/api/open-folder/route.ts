// "Open folder": shows the file in Windows Explorer (selected). Only export files of a project.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir } from "@lyric/db";

import { allowedFile, TEMPLATE_FILE } from "@/lib/files";

export async function POST(request: Request) {
  const { file } = (await request.json()) as { file?: string };
  if (!file || file.includes("..") || !(allowedFile(file) || TEMPLATE_FILE.test(file))) return Response.json({ error: "Not an export or template file" }, { status: 400 });
  const full = path.join(resolveWorkspaceDir(), ...file.split("/"));
  if (!existsSync(full)) return Response.json({ error: "File not found" }, { status: 404 });
  const [command, args] =
    process.platform === "win32" ? ["explorer.exe", [`/select,${full}`]] : process.platform === "darwin" ? ["open", ["-R", full]] : ["xdg-open", [path.dirname(full)]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false }).on("error", () => {}).unref();
  } catch {
    // no file manager (e.g. a server without a desktop): nothing to open
  }
  return Response.json({ ok: true, folder: path.dirname(full) });
}
