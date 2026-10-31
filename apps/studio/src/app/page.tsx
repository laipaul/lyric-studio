import { connection } from "next/server";
import { Suspense } from "react";

import { knownArtists, listSongs, removedSongs } from "@lyric/video/library";
import { migrationStatus } from "@lyric/video/migrate";

import { LibraryView } from "@/components/library-view";
import { MigrationBanner } from "@/components/migration-banner";
import { withWorkspace } from "@/lib/workspace";

// The start page: the Library of songs (from studio.db and the folders "pnpm make" writes).
export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading your library…</div>}>
      <Library />
    </Suspense>
  );
}

async function Library() {
  await connection(); // always fresh: read the workspace on every visit
  const { songs, artists, old, removed } = withWorkspace((ws) => ({ songs: listSongs(ws), artists: knownArtists(ws), old: migrationStatus(ws), removed: removedSongs(ws) }));
  return <LibraryView songs={songs} artists={artists} removed={removed} banner={<MigrationBanner songs={old.songs} collections={old.collections} tidy={old.tidy} />} />;
}
