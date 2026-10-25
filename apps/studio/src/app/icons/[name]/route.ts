// App icons made from the brand logo (WORKSPACE_DIR\brand\logo.png), cached in the workspace.
import { readFileSync } from "node:fs";

import { resolveWorkspaceDir } from "@lyric/db";
import { appIcon, type IconKind } from "@lyric/video/app-icons";

const ICONS: Record<string, { size: number; kind: IconKind }> = {
  "icon-192.png": { size: 192, kind: "any" },
  "icon-512.png": { size: 512, kind: "any" },
  "maskable-512.png": { size: 512, kind: "maskable" },
  "apple-touch-icon.png": { size: 180, kind: "maskable" },
  "favicon-32.png": { size: 32, kind: "any" },
  "favicon.ico": { size: 256, kind: "ico" }, // 16-256 px in one file (the Edge app window, tabs)
};

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  const file = await appIcon(resolveWorkspaceDir(), icon.size, icon.kind);
  const type = icon.kind === "ico" ? "image/x-icon" : "image/png";
  return new Response(readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
}
