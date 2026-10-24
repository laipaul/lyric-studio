// pnpm db:setup — migrate + seed in one go (also run by "pnpm dev").
import { dbFile, openWorkspace, seedStylePresets } from "../src";

const ws = openWorkspace();
const added = seedStylePresets(ws.db);
console.log(`[db] ready: ${dbFile(ws.dir)}${added ? ` (added ${added} style presets)` : ""}`);
ws.close();
