// pnpm fonts — lists the fonts available to the lyrics: bundled ones and those in WORKSPACE_DIR\fonts,
// with their weights, italics and whether they have the French accents é è à ç œ (and capitals).
import path from "node:path";

import { resolveWorkspaceDir } from "@lyric/db";

import { FRENCH_CHARACTERS, loadFontCatalog, missingCharacters } from "../src/node";

const workspaceDir = resolveWorkspaceDir();
const catalog = loadFontCatalog(workspaceDir);

const pad = (s: string, n: number) => `${s.padEnd(n - 1)} `;
console.log(`Fonts (user fonts go in ${path.join(workspaceDir, "fonts")})\n`);
console.log(`  ${pad("Family", 22)}${pad("Source", 9)}${pad("Weights", 37)}${pad("Italic", 37)}French accents`);
console.log(`  ${"-".repeat(22)}${"-".repeat(9)}${"-".repeat(37)}${"-".repeat(37)}${"-".repeat(14)}`);
for (const family of catalog.families) {
  const weights = (style: string) =>
    [...new Set(family.faces.filter((f) => f.style === style).map((f) => f.weight))].sort((a, b) => a - b).join(" ");
  const missing = new Set(family.faces.flatMap((f) => missingCharacters(f)));
  const accents = missing.size ? `missing ${[...missing].join(" ")}` : "ok";
  console.log(`  ${pad(family.family, 22)}${pad(family.source, 9)}${pad(weights("normal") || "-", 37)}${pad(weights("italic") || "-", 37)}${accents}`);
}
for (const problem of catalog.problems) console.log(`\n  Skipped ${problem}`);
console.log(`\n  Checked characters: ${FRENCH_CHARACTERS.join(" ")}`);
console.log('  Use with: pnpm render:test --font "Family" --font-hook "Family"');
