// "pnpm app:rebuild": a clean build of the studio (the old build folder apps\studio\.next is removed
// first), for when the app does not show the latest changes. Stop Lyric Studio before, start it after.
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildStamp, codeVersion, root } from "./app-version.mjs";

const v = codeVersion();
console.log(`[lyric-studio] removing the old build (apps\\studio\\.next)`);
rmSync(path.join(root, "apps", "studio", ".next"), { recursive: true, force: true });
console.log(`[lyric-studio] building the studio from commit ${v.commit} (about 1-2 minutes)`);
execSync("pnpm --filter @lyric/studio build", { cwd: root, stdio: "inherit" });
writeFileSync(buildStamp, `${v.version} ${v.commit}\n`);
console.log(`[lyric-studio] done: built from commit ${v.commit}. Start it with "Start Lyric Studio.cmd".`);
