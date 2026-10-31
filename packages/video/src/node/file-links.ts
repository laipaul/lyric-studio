// Which file of a song folder has which role (song, lyrics, vocal stem, backing vocals), kept in
// <song folder>\.studio\files.json, so every file keeps the name the user gave it ("These Empty Roads
// (Master).wav", "TER lyrics v3.txt", "These Empty Roads (Lead Vocal).wav"). Nothing is ever renamed for
// a role. A role without a link falls back to the old fixed names (song.wav|mp3, lyrics.txt, vocals.wav,
// backing-vocals.wav), so songs made before keep working as they are.
// `notUsed`: files of the folder the user said are not used (or copies of the song): never asked about again.
// No imports from song-folder.ts (which reads the links for songPaths).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type FileRole = "song" | "lyrics" | "vocals" | "backingVocals";
export type FileLinks = { version: 1; song?: string; lyrics?: string; vocals?: string; backingVocals?: string; notUsed?: string[] };

export const FILE_ROLES: readonly FileRole[] = ["song", "lyrics", "vocals", "backingVocals"];
export const FIXED_NAMES: Record<FileRole, readonly string[]> = {
  song: ["song.wav", "song.mp3"],
  lyrics: ["lyrics.txt"],
  vocals: ["vocals.wav"],
  backingVocals: ["backing-vocals.wav"],
};
export const ROLE_LABEL: Record<FileRole, string> = { song: "the song", lyrics: "the lyrics", vocals: "the vocal stem", backingVocals: "the backing vocals" };

export const linksFile = (root: string) => path.join(root, ".studio", "files.json");

export function readLinks(root: string): FileLinks {
  try {
    const raw = JSON.parse(readFileSync(linksFile(root), "utf8")) as Partial<FileLinks>;
    const out: FileLinks = { version: 1 };
    for (const role of FILE_ROLES) {
      const v = raw[role];
      if (typeof v === "string" && v && path.basename(v) === v) out[role] = v; // a name in the folder, never a path elsewhere
    }
    if (Array.isArray(raw.notUsed)) out.notUsed = raw.notUsed.filter((n): n is string => typeof n === "string" && path.basename(n) === n);
    return out;
  } catch {
    return { version: 1 };
  }
}

export function writeLinks(root: string, links: FileLinks): void {
  const file = linksFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const clean: FileLinks = { version: 1 };
  for (const role of FILE_ROLES) if (links[role]) clean[role] = links[role];
  if (links.notUsed?.length) clean.notUsed = [...new Set(links.notUsed)].sort((a, b) => a.localeCompare(b));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`);
  renameSync(tmp, file);
}

// Links `name` to `role` (null: removes the link). A file has one role only.
export function linkFile(root: string, role: FileRole, name: string | null): FileLinks {
  const links = readLinks(root);
  if (name) {
    for (const r of FILE_ROLES) if (r !== role && links[r] === name) delete links[r];
    links[role] = name;
    links.notUsed = links.notUsed?.filter((n) => n !== name);
  } else delete links[role];
  writeLinks(root, links);
  return links;
}

// "Not used": the file stays where it is and is not asked about again.
export function markNotUsed(root: string, name: string): FileLinks {
  const links = readLinks(root);
  for (const r of FILE_ROLES) if (links[r] === name) delete links[r];
  links.notUsed = [...(links.notUsed ?? []), name];
  writeLinks(root, links);
  return links;
}

// The file with this role: the linked one when it is there, else the first fixed name that is there,
// else the linked name (or the first fixed name) where it would be.
export function roleFile(root: string, role: FileRole, links: FileLinks = readLinks(root)): string {
  const linked = links[role] ? path.join(root, links[role]!) : null;
  if (linked && existsSync(linked)) return linked;
  const fixed = FIXED_NAMES[role].map((n) => path.join(root, n));
  return fixed.find((f) => existsSync(f)) ?? linked ?? fixed[0];
}
