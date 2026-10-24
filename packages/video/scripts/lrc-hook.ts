// pnpm lrc:hook <file.lrc> "<line text>"
// Marks a line as a hook ("* " after the time stamp) together with every repeat of it (same words;
// case, punctuation and extra spaces ignored). The previous version is kept as <file>.lrc.bak.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { markHookInLrc } from "../src";

const [fileArg, ...words] = process.argv.slice(2);
const text = words.join(" ").trim();
if (!fileArg || !text) {
  console.error('Usage: pnpm lrc:hook <file.lrc> "<line text>"');
  process.exit(1);
}
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);
if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const { content, matched } = markHookInLrc(readFileSync(file, "utf8"), text);
if (!matched) {
  console.error(`No line "${text}" in ${path.basename(file)} (nothing changed).`);
  process.exit(1);
}
copyFileSync(file, `${file}.bak`);
writeFileSync(file, content, "utf8");
console.log(`Marked ${matched} line${matched > 1 ? "s" : ""} as hook: "${text}"`);
console.log(`Saved:   ${file}   (backup: ${path.basename(file)}.bak)`);
