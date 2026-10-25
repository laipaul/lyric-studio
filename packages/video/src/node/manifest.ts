// v<N>.manifest.json: everything needed to reproduce one rendered variation exactly — the exact clip
// files with their content hashes, in/out points and speeds, the cuts, every lyric timing (with lead
// and offset), style, font files, all settings, and the full composition props. "pnpm rerender"
// renders those props again after checking that the song, clips and fonts are unchanged.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, absPath, fileHash, type Clip, type Workspace } from "@lyric/db";
import { VERSION as REMOTION_VERSION } from "remotion";

import type { PlatformPreset } from "../platform";
import type { LyricVideoProps } from "../props";
import type { Brand } from "./brand";
import { normaliseClip, NORMALISE_VERSION } from "./clips";
import { loadFontCatalog } from "./font-catalog";
import type { MediaRoots } from "./media";
import { resolveMediaPath } from "./media";

export const MANIFEST_VERSION = 1;

export type ManifestClip = {
  name: string;
  file: string; // as stored: workspace-relative, or a full path outside the workspace
  sha256: string;
  normalised: string; // workspace-relative copy the composition plays
  normalised_sha256: string;
};

export type Manifest = {
  manifest_version: number;
  tool: { name: string; version: string; git_commit: string | null; remotion: string; node: string; normalise_version: number };
  created_at: string;
  command: string;
  variation: { index: number; name: string; order: "story" | "shuffle"; seed: number; style: string; cinematic_bars: boolean };
  platform?: { name: string; preset: PlatformPreset };
  brand?: Brand;
  project: { id: string; title: string };
  song: { file: string; sha256: string; duration_ms: number };
  analysis: { bpm: number; downbeat_offset: number; downbeat_confidence: number };
  section: { mode: string; start_ms: number; end_ms: number; requested: { start_ms: number; end_ms: number } | null; reason: string };
  lyrics: {
    txt: string;
    txt_sha256: string;
    lrc: string; // workspace-relative, never modified
    lrc_sha256: string;
    source: string;
    hint: { file: string; sha256: string; source?: string; stored?: boolean } | null;
    lang: string;
    lead_ms: number;
    lyrics_offset_ms: number;
  };
  settings: Record<string, unknown>;
  clips: ManifestClip[];
  cuts: { frames: number[]; song_ms: number[] };
  shots: {
    index: number;
    clip: string; // name, see `clips`
    start_frame: number;
    duration_frames: number;
    clip_in_frame: number;
    clip_out_frame: number; // exclusive; with hold_last_frame the clip's last frame is held after it
    playback_rate: number;
    hold_last_frame: boolean;
  }[];
  lyric_timings: {
    number: number;
    text: string;
    is_hook: boolean;
    stamp_ms: number; // in the LRC (song time)
    end_ms: number;
    shown_from_ms: number; // song time, after lead and offset
    shown_until_ms: number;
    start_frame: number; // in the video
    end_frame: number;
    confidence: number | null;
  }[];
  fonts: { family: string; weight: number; style: string; src: string; sha256: string }[];
  props: Omit<LyricVideoProps, "mediaBaseUrl">;
  output: { file: string; duration_s: number; qa: string };
  warnings: string[];
};

export const sha256File = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function toolInfo(): Manifest["tool"] {
  const version = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version;
  let commit: string | null = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    commit = null;
  }
  return { name: "lyric-studio", version, git_commit: commit, remotion: REMOTION_VERSION, node: process.version, normalise_version: NORMALISE_VERSION };
}

export function writeManifest(file: string, manifest: Manifest): void {
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readManifest(file: string): Manifest {
  if (!existsSync(file)) throw new Error(`Manifest not found: ${file}`);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch (error) {
    throw new Error(`${file} is not a valid manifest (${(error as Error).message})`);
  }
  if (manifest.manifest_version !== MANIFEST_VERSION || !manifest.props) {
    throw new Error(`${file} is not a manifest from pnpm make (version ${manifest.manifest_version ?? "missing"})`);
  }
  return manifest;
}

export type Verification = { problems: string[]; notes: string[]; media: MediaRoots };

// Checks that every input of the manifest is still on this PC with the same content. Problems mean
// the video cannot be reproduced exactly; notes are harmless differences.
export async function verifyManifest(ws: Workspace, manifest: Manifest, log: (m: string) => void = () => {}): Promise<Verification> {
  const problems: string[] = [];
  const notes: string[] = [];

  const song = absPath(ws, manifest.song.file);
  if (!existsSync(song)) problems.push(`the song is missing: ${song}`);
  else if ((await fileHash(song)) !== manifest.song.sha256) problems.push(`the song has changed since the render: ${song}`);

  for (const c of manifest.clips) {
    const file = absPath(ws, c.file);
    if (!existsSync(file)) {
      problems.push(`clip ${c.name} is missing: ${file}`);
      continue;
    }
    if ((await fileHash(file)) !== c.sha256) {
      problems.push(`clip ${c.name} has changed since the render (its content hash is different): ${file}`);
      continue;
    }
    const normalised = absPath(ws, c.normalised);
    if (!existsSync(normalised)) {
      // The cached 1080x1920 copy was deleted: make it again from the (unchanged) clip.
      const pseudo = { id: c.name, path: c.file, content_hash: c.sha256 } as Clip;
      const made = await normaliseClip(ws, pseudo, c.name, log);
      if (made.path !== c.normalised) problems.push(`clip ${c.name}: its prepared copy would be ${made.path}, not ${c.normalised}`);
    }
    if (existsSync(normalised) && (await fileHash(normalised)) !== c.normalised_sha256) {
      notes.push(`clip ${c.name}: the prepared 1080x1920 copy was made again and differs slightly (e.g. another FFmpeg version)`);
    }
  }

  const catalog = loadFontCatalog(ws.dir);
  const media: MediaRoots = { workspaceDir: ws.dir, extraFiles: {}, fontDirs: catalog.fontDirs };
  for (const f of manifest.fonts) {
    const file = resolveMediaPath(f.src, media);
    if (!file || !existsSync(file)) problems.push(`font file missing: ${f.family} ${f.weight} (${f.src})`);
    else if (sha256File(file) !== f.sha256) problems.push(`font file changed: ${f.family} ${f.weight} (${file})`);
  }

  if (manifest.tool.git_commit) {
    const now = toolInfo();
    if (now.git_commit && now.git_commit !== manifest.tool.git_commit) {
      notes.push(`made with Lyric Studio ${manifest.tool.git_commit.slice(0, 7)}, now ${now.git_commit.slice(0, 7)}: the same props are rendered by the current composition`);
    }
  }
  return { problems, notes, media };
}
