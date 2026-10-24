// Warns about lyric lines that are too long for phone screens (need the 3-line last resort) in the
// Simple or Bold style. Used by "pnpm tap" before tapping starts.
//   tsx packages/video/scripts/check-lyrics.ts <lyrics.txt>
import { readFileSync } from "node:fs";
import path from "node:path";

import { openWorkspace, stylePreset } from "@lyric/db";

import { tooLongLines, tooLongMessage } from "../src/node";
import type { StyleProps, TextCase } from "../src";

const file = process.argv[2];
if (!file) {
  console.error("Usage: check-lyrics <lyrics.txt>");
  process.exit(1);
}

const lines = readFileSync(file, "utf8")
  .replace(/^﻿/, "")
  .split(/\r?\n/)
  .map((text, i) => ({ text: text.trim(), number: i + 1 }))
  .filter((l) => l.text);

const ws = openWorkspace();
const styles = ws.db.select().from(stylePreset).all().filter((s) => s.name === "Simple" || s.name === "Bold");
ws.close();

const tooLong = new Map<number, string[]>();
for (const preset of styles) {
  const style: StyleProps = {
    name: preset.name,
    font: preset.font,
    weight: preset.weight,
    textCase: preset.text_case as TextCase,
    effect: preset.effect,
    animation: preset.animation,
  };
  for (const { text } of tooLongLines(lines.map((l) => l.text), style, preset.default_size)) {
    for (const l of lines.filter((x) => x.text === text)) tooLong.set(l.number, [...(tooLong.get(l.number) ?? []), preset.name]);
  }
}

for (const [number, styleNames] of [...tooLong.entries()].sort((a, b) => a[0] - b[0])) {
  const text = lines.find((l) => l.number === number)!.text;
  console.log(`WARNING: ${tooLongMessage(number, path.basename(file), text, styleNames.join(" and "))}`.replace("and Bold style", "and Bold styles"));
}
if (tooLong.size) console.log("         (press q to quit and edit the file, or carry on tapping)\n");
