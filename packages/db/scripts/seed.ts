// pnpm db:seed — adds the built-in style presets (safe to run again).
import { openWorkspace, seedStylePresets } from "../src";

const ws = openWorkspace();
const added = seedStylePresets(ws.db);
console.log(added ? `Added ${added} style presets.` : "Style presets already present.");
ws.close();
