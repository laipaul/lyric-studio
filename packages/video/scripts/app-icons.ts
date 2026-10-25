// pnpm app:icons: makes the app icons from WORKSPACE_DIR\brand\logo.png and prints the .ico for the
// desktop shortcut (used by "Create Desktop Shortcut.cmd"). The studio makes the PNGs by itself.
import { resolveWorkspaceDir } from "@lyric/db";

import { appIcon } from "../src/node/app-icons";

const ws = resolveWorkspaceDir();
await appIcon(ws, 192, "any");
await appIcon(ws, 512, "any");
await appIcon(ws, 512, "maskable");
console.log(await appIcon(ws, 256, "ico"));
