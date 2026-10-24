// pnpm lrc:shift <file.lrc> <seconds>   e.g. pnpm lrc:shift lyrics.lrc -0.3
// Moves every time stamp (never below 0). The previous version is kept as <file>.lrc.bak.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseLrc, shiftLrc } from "../src";

const [fileArg, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg);
if (!fileArg || secondsArg === undefined || !Number.isFinite(seconds)) {
  console.error("Usage: pnpm lrc:shift <file.lrc> <seconds>   (e.g. -0.3 = 0.3 s earlier)");
  process.exit(1);
}
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);
if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const before = readFileSync(file, "utf8");
const after = shiftLrc(before, Math.round(seconds * 1000));
copyFileSync(file, `${file}.bak`);
writeFileSync(file, after, "utf8");
const lines = parseLrc(after).length;
console.log(`Shifted ${lines} lines by ${seconds > 0 ? "+" : ""}${seconds} s (${seconds < 0 ? "earlier" : "later"}).`);
console.log(`Saved:   ${file}`);
console.log(`Backup:  ${file}.bak`);
