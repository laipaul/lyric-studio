// Captions for posting ("ready to post" in the studio), per artist and platform:
// WORKSPACE_DIR\brand\<artist>\publish-<platform>.txt when that artist has one (e.g. Pômé's in French),
// else WORKSPACE_DIR\brand\publish-<platform>.txt (created with English defaults the first time).
// YouTube uses publish.txt, written next to each YouTube video by "pnpm make".
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { safeName } from "@lyric/db";

import { brandDir, DEFAULT_ARTIST } from "./brand";

export const CAPTION_PLATFORMS = ["standard", "reels", "tiktok", "shorts"] as const;

const DEFAULTS: Record<string, string> = {
  reels: `== Caption ==
{{hook}}
{{song}} by {{artist}}
{{epLine}}
Full song on Spotify (link in bio).

== Hashtags ==
#{{artistTag}} #{{songTag}} #lyrics #lyricvideo #reels #newmusic
`,
  tiktok: `== Caption ==
{{hook}}
{{song}} - {{artist}}
{{epLine}}

== Hashtags ==
#{{artistTag}} #{{songTag}} #lyrics #lyricvideo #newmusic #fyp
`,
  shorts: `== Caption ==
{{song}} (Lyrics) - {{artist}}
{{hook}}
{{epLine}}

== Hashtags ==
#shorts #{{artistTag}} #{{songTag}} #lyrics #lyricvideo
`,
};
DEFAULTS.standard = DEFAULTS.reels;

const HELP = `Placeholders: {{song}} {{artist}} {{ep}} {{epLine}} {{hook}} {{songTag}} {{artistTag}} {{year}}.
{{epLine}} is 'From the EP "<name>"' (its line disappears without an EP); write your own line with {{ep}}
for another language, e.g. Extrait de l'EP « {{ep}} ». {{hook}} is the first hook line of the lyrics.`;

// The artist's own copy of a brand file if there is one, else the default brand's.
export function artistBrandFile(workspaceDir: string, artist: string | null | undefined, name: string): { file: string; own: boolean } {
  const base = brandDir(workspaceDir);
  if (artist && artist.trim() && artist.trim() !== DEFAULT_ARTIST) {
    const own = path.join(base, safeName(artist.trim()), name);
    if (existsSync(own)) return { file: own, own: true };
  }
  return { file: path.join(base, name), own: !artist || artist.trim() === DEFAULT_ARTIST };
}

export function captionTemplate(workspaceDir: string, artist: string, platform: string): { file: string; own: boolean; created: boolean } {
  const { file, own } = artistBrandFile(workspaceDir, artist, `publish-${platform}.txt`);
  let created = false;
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${DEFAULTS[platform] ?? DEFAULTS.reels}\n# ${HELP.replace(/\n/g, "\n# ")}\n`);
    created = true;
  }
  return { file, own, created };
}

// "Make <artist>'s own template": copies the current template into brand\<artist>\ to edit there.
export function makeOwnCaptionTemplate(workspaceDir: string, artist: string, platform: string): string {
  const current = captionTemplate(workspaceDir, DEFAULT_ARTIST, platform);
  const target = path.join(brandDir(workspaceDir), safeName(artist.trim()), `publish-${platform}.txt`);
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(current.file, target);
  }
  return target;
}

export type CaptionValues = { song: string; artist: string; ep?: string | null; hook?: string | null; year: number };

// Fills a template: returns its sections ("Caption", "Hashtags", ...) with the values in.
export function fillCaption(template: string, v: CaptionValues): Record<string, string> {
  const tag = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "");
  const map: Record<string, string> = {
    song: v.song,
    artist: v.artist,
    ep: v.ep ?? "",
    epLine: v.ep ? `From the EP "${v.ep}"` : "",
    hook: v.hook ?? "",
    songTag: tag(v.song),
    artistTag: tag(v.artist),
    year: String(v.year),
  };
  // Notes are "# " lines (a hashtag has no space after the #).
  let text = template.replace(/\r\n/g, "\n").replace(/^# .*\n?/gm, "");
  for (const k of ["epLine", "hook", "ep"]) if (!map[k]) text = text.replace(new RegExp(`^[ \\t]*\\{\\{${k}\\}\\}[ \\t]*\\n`, "gm"), "");
  const filled = text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => map[k] ?? m);
  return parseSections(filled);
}

// "== Name ==" sections of a text (publish.txt or a caption template).
export function parseSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (name) out[name] = lines.join("\n").trim();
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^==\s*(.+?)\s*==\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1];
      lines = [];
    } else lines.push(line);
  }
  flush();
  return out;
}

// The first hook line of a lyrics.txt ("* " lines), for {{hook}}.
export function firstHookLine(lyricsTxt: string): string | null {
  const line = lyricsTxt.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => /^\*\s+\S/.test(l.trim()));
  return line ? line.trim().replace(/^\*\s+/, "") : null;
}

const rel = (dir: string, file: string) => path.relative(dir, file).split(path.sep).join("/");

export type PostingPack = {
  platform: string;
  kind: "youtube" | "caption" | "none"; // none: Spotify Canvas (uploaded without a caption)
  artist: string;
  sections: Record<string, string>; // "Caption" / "Hashtags", or YouTube's "Title" / "Description" / "Tags"
  template: { file: string; relative: string; own: boolean } | null; // where to edit the caption text
};

// What to paste when posting one video: the caption and hashtags from the artist's template for its
// platform, or (YouTube) the publish.txt written next to the video.
export function postingPack(
  ws: { dir: string },
  input: { platform: string; artist: string; song: string; ep?: string | null; hook?: string | null; publishFile?: string | null; now?: Date },
): PostingPack {
  const base = { platform: input.platform, artist: input.artist };
  if (input.platform === "canvas") return { ...base, kind: "none", sections: {}, template: null };
  if (input.platform === "youtube") {
    const text = input.publishFile && existsSync(input.publishFile) ? readFileSync(input.publishFile, "utf8") : "";
    const tpl = artistBrandFile(ws.dir, input.artist, "publish-template.txt");
    return { ...base, kind: "youtube", sections: parseSections(text), template: { file: tpl.file, relative: rel(ws.dir, tpl.file), own: tpl.own } };
  }
  const platform = (CAPTION_PLATFORMS as readonly string[]).includes(input.platform) ? input.platform : "reels";
  const t = captionTemplate(ws.dir, input.artist, platform);
  const sections = fillCaption(readFileSync(t.file, "utf8"), { song: input.song, artist: input.artist, ep: input.ep, hook: input.hook, year: (input.now ?? new Date()).getFullYear() });
  return { ...base, kind: "caption", sections, template: { file: t.file, relative: rel(ws.dir, t.file), own: t.own } };
}
