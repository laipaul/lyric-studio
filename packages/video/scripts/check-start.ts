// pnpm lyrics:check-start "<song folder>"   e.g. pnpm lyrics:check-start "workspace\songs\Life Lyrics\A Heart For Two"
// The vocal-start check of pnpm make, without making videos: for line 1 and every line after a long
// instrumental (or with a stretched first word) it prints the stamp of the stored alignment, the voice
// onset, the recognised words, the word-duration estimate, where they agree and what pnpm make will use.
// Uses the stored alignment (never aligns): run pnpm make once first.
import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { applyVocalGuard, ensureAlignment, findOrCreateSongProject, loadBrand, loadFontCatalog, parseMakeArgs, type AlignRunner } from "../src/node";

const cwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: pnpm lyrics:check-start "<song folder>"   (e.g. "workspace\\songs\\Life Lyrics\\A Heart For Two")');
  process.exit(1);
}
const noAligning: AlignRunner = async () => {
  throw new Error("this song has no stored alignment for its lyrics.txt and hints yet: run pnpm make for it once first.");
};

async function main() {
  const { options } = parseMakeArgs(args, cwd);
  const ws = openWorkspace(resolveWorkspaceDir());
  try {
    const sp = await findOrCreateSongProject(ws, options.song);
    const log = (m: string) => (m.startsWith("lyrics: aligning") ? undefined : console.log(m)); // it never aligns
    const stored = await ensureAlignment(ws, sp, { lyricsTxt: options.lyrics, hint: options.hint, lang: options.lang, durationMs: sp.project.duration_ms ?? 600_000, log, align: noAligning });
    const brand = loadBrand(ws.dir, loadFontCatalog(ws.dir), sp.project.artist);
    const checked = await applyVocalGuard(ws, sp, stored, { log, reviewMs: Math.round(brand.brand.motion.gapLeadInS * 1000) });
    for (const w of checked.warnings) console.log(`Warning: ${w}`);
    if (checked.guard && !checked.guard.moves.length) console.log("Nothing to move: every checked line starts with its singing.");
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
});
