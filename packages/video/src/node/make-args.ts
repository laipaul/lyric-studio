// "pnpm make" command-line arguments -> MakeOptions. Shared by the command (scripts/make.ts) and by
// the studio's "Resume" of a run that was started in the terminal (its command is in the manifests).
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { CutRate, Energy } from "../index";
import type { MakeOptions } from "./make";
import { songFolderFiles } from "./song-folder";

export type MakeArgs = { options: MakeOptions; noOpen: boolean };

export const MAKE_USAGE =
  'Usage: pnpm make <song folder>   or   pnpm make <song> <lyrics.txt> --collection <name>\n' +
  '  (e.g. pnpm make "workspace\\songs\\Life Lyrics\\Hold On"   or   pnpm make "workspace\\test\\song.wav" "workspace\\test\\lyrics.txt" --collection wedding)';

// Relative paths are relative to `cwd` (the folder the command was typed in).
export function parseMakeArgs(argv: string[], cwd: string): MakeArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      collection: { type: "string" },
      "collection-path": { type: "string" },
      variations: { type: "string" },
      platforms: { type: "string" },
      "allow-fill": { type: "boolean", default: false },
      title: { type: "string" },
      ep: { type: "string" },
      artist: { type: "string" },
      cover: { type: "string" },
      layout: { type: "string" },
      stills: { type: "string" },
      "no-grain": { type: "boolean", default: false },
      "no-glow": { type: "boolean", default: false },
      section: { type: "string" }, // default: the song's recipe, else auto
      length: { type: "string" }, // seconds an auto section aims for
      hint: { type: "string" },
      "no-hint": { type: "boolean", default: false },
      realign: { type: "boolean", default: false },
      lrc: { type: "string" },
      lang: { type: "string", default: "en" },
      rate: { type: "string", default: "1x" },
      energy: { type: "string", default: "medium" },
      lead: { type: "string", default: "0.25" },
      "lyrics-offset": { type: "string" },
      "downbeat-offset": { type: "string" },
      font: { type: "string" },
      "font-hook": { type: "string" },
      "line-effect": { type: "string" },
      "hook-effect": { type: "string" },
      pins: { type: "string" },
      parallel: { type: "string" },
      "no-open": { type: "boolean", default: false },
      "no-frame-check": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
    },
  });
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (positionals.length !== 1 && positionals.length !== 2) fail(MAKE_USAGE);
  // One argument: a song folder (song.wav|mp3, lyrics.txt, hints.lrc, clips\, song.json).
  let folder: ReturnType<typeof songFolderFiles> | undefined;
  if (positionals.length === 1) {
    const dir = path.resolve(cwd, positionals[0]);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${MAKE_USAGE}\n${dir} is not a song folder.`);
    folder = songFolderFiles(dir);
  }
  const rate = values.rate as CutRate;
  if (!["0.5x", "1x", "2x", "off"].includes(rate)) fail("--rate must be 0.5x, 1x, 2x or off");
  const energy = values.energy as Energy;
  if (!["low", "medium", "high"].includes(energy)) fail("--energy must be low, medium or high");
  if (!["en", "fr"].includes(values.lang!)) fail("--lang must be en or fr");
  const variations = values.variations === undefined ? undefined : Number(values.variations);
  if (variations !== undefined && (!Number.isInteger(variations) || variations < 1 || variations > 24)) fail("--variations must be a whole number from 1 to 24");
  const seconds = (name: string, text: string) => {
    const n = Number(text);
    if (!Number.isFinite(n) || Math.abs(n) > 10) fail(`--${name} must be a number of seconds, e.g. 0.25 or -0.3`);
    return Math.round(n * 1000);
  };
  const offset = values["downbeat-offset"] === undefined ? undefined : Number(values["downbeat-offset"]);
  if (offset !== undefined && ![0, 1, 2, 3].includes(offset)) fail("--downbeat-offset must be 0, 1, 2 or 3");
  const length = values.length === undefined ? undefined : Number(values.length);
  if (length !== undefined && (!Number.isFinite(length) || length < 3 || length > 600)) fail("--length must be a number of seconds from 3 to 600 (the target for an auto section)");
  const parallel = values.parallel === undefined ? undefined : Number(values.parallel);
  if (parallel !== undefined && (!Number.isInteger(parallel) || parallel < 1 || parallel > 6)) fail("--parallel must be a whole number from 1 to 6");
  if (values.realign && values.lrc) fail("--realign and --lrc cannot be used together");
  if (values.hint && values["no-hint"]) fail("--hint and --no-hint cannot be used together");
  if (values.layout && !["cover", "stills", "clips"].includes(values.layout)) fail("--layout must be cover, stills or clips");
  const resolve = (p?: string) => (p ? path.resolve(cwd, p) : undefined);
  return {
    noOpen: values["no-open"]!,
    options: {
      song: folder ? folder.song : resolve(positionals[0])!,
      lyrics: folder ? folder.lyrics : resolve(positionals[1])!,
      ...(folder ? { songFolder: path.dirname(folder.song) } : {}),
      collection: values.collection,
      collectionPath: resolve(values["collection-path"]),
      variations,
      platforms: values.platforms,
      allowFill: values["allow-fill"],
      title: values.title,
      ep: values.ep,
      artist: values.artist,
      cover: resolve(values.cover),
      layout: values.layout as MakeOptions["layout"],
      stills: resolve(values.stills),
      grain: values["no-grain"] ? false : undefined,
      glow: values["no-glow"] ? false : undefined,
      section: values.section,
      length,
      hint: resolve(values.hint) ?? (folder?.hints && !values["no-hint"] && !values.lrc ? folder.hints : undefined),
      noHint: values["no-hint"],
      realign: values.realign,
      lrc: resolve(values.lrc),
      lang: values.lang,
      rate,
      energy,
      leadMs: seconds("lead", values.lead!),
      lyricsOffsetMs: values["lyrics-offset"] === undefined ? undefined : seconds("lyrics-offset", values["lyrics-offset"]),
      downbeatOffset: offset,
      font: values.font,
      fontHook: values["font-hook"],
      lineEffect: values["line-effect"],
      hookEffect: values["hook-effect"],
      pins: resolve(values.pins),
      parallel,
      frameCheck: !values["no-frame-check"],
      resume: values.resume,
      command: makeCommand(argv),
    },
  };
}

// The command as it is stored in the manifests ("pnpm make a.wav "my lyrics.txt" --collection x").
export function makeCommand(argv: readonly string[]): string {
  return `pnpm make ${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;
}

// The arguments of a stored "pnpm make ..." command (double quotes group words, as in PowerShell).
export function commandArgs(command: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(command); m; m = re.exec(command)) args.push(m[1] ?? m[2]);
  if (args[0] === "pnpm" && args[1] === "make") return args.slice(2);
  return args;
}
