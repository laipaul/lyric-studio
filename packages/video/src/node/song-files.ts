// Files the user puts into a song folder by hand (in Explorer), under any name, are recognised:
//  - an audio file with the song's content is the song (a song file renamed in Explorer is found again;
//    a copy of it is simply not used);
//  - a .txt is the lyrics when the song has none yet and it is the only candidate;
//  - an audio file whose name says it is a stem ("Lead Vocal", "Vocals", "Vox", "Acapella") is the vocal
//    stem, "Backing" / "Harmonies" / "BGV" the backing vocals (when the song has none yet);
//  - another audio file is the vocal stem when it lines up on the song (the L1a check; analysis only);
//  - anything still unclear is listed, and the Assets tab asks once "What is this file?".
// The roles go to .studio\files.json (file-links.ts); nothing is renamed, moved or written into a file.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { absPath, project as projectTable, type Workspace } from "@lyric/db";
import { eq } from "drizzle-orm";

import { cachedFileHash } from "./collection";
import { linkFile, markNotUsed, readLinks, type FileRole } from "./file-links";
import { enqueueLyricTiming } from "./runs";
import { AUDIO_FILE, BACKING_NAME, isWavFile, RESERVED_TXT, songPathsById, STEM_NAME, STORY_FILE } from "./song-folder";
import { checkStemFile, type StemCheckRunner } from "./voice-source";

export type UnassignedFile = { name: string; kind: "audio" | "text"; guess: FileRole | null };
export type Recognized = { linked: { name: string; role: FileRole }[]; copies: string[]; unassigned: UnassignedFile[]; retimed: boolean };

const KNOWN = new Set(["song.json", "hints.lrc", STORY_FILE]);

export async function recognizeSongFiles(
  ws: Workspace,
  projectId: string,
  options: { check?: StemCheckRunner; queue?: boolean; log?: (m: string) => void } = {},
): Promise<Recognized> {
  const out: Recognized = { linked: [], copies: [], unassigned: [], retimed: false };
  const p = ws.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  if (!p) return out;
  let paths = songPathsById(ws, projectId);
  if (paths.legacy || !existsSync(paths.root)) return out;
  const root = paths.root;
  const links = readLinks(root);
  const inRoot = (f: string | null) => (f && path.resolve(path.dirname(f)) === path.resolve(root) ? path.basename(f) : null);
  const known = new Set<string>([...KNOWN, ...(links.notUsed ?? [])]);
  for (const n of [links.song, links.lyrics, links.vocals, links.backingVocals, inRoot(paths.audio), inRoot(paths.cover)]) if (n) known.add(n);
  for (const f of [paths.lyricsTxt, paths.vocals, paths.backingVocals]) if (f && existsSync(f) && inRoot(f)) known.add(inRoot(f)!);
  const files = readdirSync(root).filter((f) => !f.startsWith(".") && !known.has(f) && statSync(path.join(root, f)).isFile());
  // Audio by its extension, or a WAV that lost its extension ("Love Is A Good Thing Lead Vocal").
  let audio = files.filter((f) => AUDIO_FILE.test(f) || (!path.extname(f) && isWavFile(path.join(root, f))));
  const texts = files.filter((f) => /\.txt$/i.test(f) && !RESERVED_TXT.test(f));
  const link = (name: string, role: FileRole) => {
    linkFile(root, role, name);
    out.linked.push({ name, role });
    options.log?.(`files: ${name} is ${role === "backingVocals" ? "the backing vocals" : role === "vocals" ? "the vocal stem" : `the ${role}`}`);
  };

  // The song: found by its content (renamed in Explorer); a copy of it is not used (never asked about).
  if (p.audio_hash && audio.length) {
    const songThere = !!p.audio_path && existsSync(absPath(ws, p.audio_path));
    for (const f of [...audio]) {
      if ((await cachedFileHash(ws, path.join(root, f))) !== p.audio_hash) continue;
      audio = audio.filter((a) => a !== f);
      if (!songThere && !out.linked.some((l) => l.role === "song")) {
        ws.db.update(projectTable).set({ audio_path: path.relative(ws.dir, path.join(root, f)).split(path.sep).join("/") }).where(eq(projectTable.id, projectId)).run();
        link(f, "song");
      } else {
        markNotUsed(root, f);
        out.copies.push(f);
      }
    }
  }
  paths = songPathsById(ws, projectId);

  // The lyrics: the only .txt when the song has none.
  if (!paths.instrumental && texts.length) {
    if (!existsSync(paths.lyricsTxt) && texts.length === 1) link(texts[0], "lyrics");
    else for (const t of texts) out.unassigned.push({ name: t, kind: "text", guess: existsSync(paths.lyricsTxt) ? null : "lyrics" });
  }

  paths = songPathsById(ws, projectId);

  // The stems: by name first, then by lining up on the song.
  let hasVocals = !!paths.vocals && existsSync(paths.vocals);
  let hasBacking = !!paths.backingVocals && existsSync(paths.backingVocals);
  const wav = (f: string) => /\.wav$/i.test(f) || (!path.extname(f) && isWavFile(path.join(root, f)));
  const songFile = p.audio_path ? absPath(ws, p.audio_path) : null;
  const songOk = !!songFile && existsSync(songFile) && !!p.audio_hash;
  let newVocals = false;
  for (const f of audio) {
    if (BACKING_NAME.test(f)) {
      if (!hasBacking && wav(f)) {
        link(f, "backingVocals");
        hasBacking = true;
      } else out.unassigned.push({ name: f, kind: "audio", guess: "backingVocals" });
      continue;
    }
    if (STEM_NAME.test(f)) {
      if (!hasVocals && wav(f)) {
        link(f, "vocals");
        hasVocals = newVocals = true;
      } else out.unassigned.push({ name: f, kind: "audio", guess: "vocals" });
      continue;
    }
    if (!hasVocals && wav(f) && songOk) {
      const result = await checkStemFile(ws, paths.store, { file: songFile!, hash: p.audio_hash! }, path.join(root, f), { check: options.check, log: options.log });
      if (result && "check" in result && result.check.status === "lined-up") {
        link(f, "vocals");
        hasVocals = newVocals = true;
        continue;
      }
    }
    out.unassigned.push({ name: f, kind: "audio", guess: null });
  }
  // A new vocal stem: the lyric timing is made again on it (stored hints and hand-set starts are kept).
  if (newVocals && options.queue !== false && !paths.instrumental && existsSync(paths.lyricsTxt) && songOk) {
    enqueueLyricTiming(ws, projectId);
    out.retimed = true;
  }
  return out;
}
