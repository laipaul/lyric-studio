// Song style (22 Nov 2026, Paul): how a song is made, his three levels. A creative choice per song (Prepare → Song
// Details); it only decides which tools the studio shows, never what a video looks like, and nothing is lost when it
// changes. Each style builds on the one before:
//   cut      Cut to the song: your clips cut to the beat and the lyrics (level 1).
//   singing  Add lip sync: the same, plus the singer on the lines you pick (level 2: Lyrics Sync → Who sings).
//   film     Mini film: the song planned as scenes, a Reel or the whole song on YouTube (level 3: Creation's story
//            tools open; Scenes come next).
// song.json "songStyle". Not chosen yet: "singing" when the song already has singing lines, else "cut", so a tool
// in use is never hidden. Pure (no node imports): the studio's pages use it too.
export const SONG_STYLES = ["cut", "singing", "film"] as const;
export type SongStyle = (typeof SONG_STYLES)[number];

export const SONG_STYLE_LABEL: Record<SongStyle, string> = { cut: "Cut to the song", singing: "Add lip sync", film: "Mini film" };
export const SONG_STYLE_HINT: Record<SongStyle, string> = {
  cut: "Your clips cut to the beat and the lyrics.",
  singing: "The same, plus your singer lip-synced on the lines you pick (Lyrics Sync → Lip sync).",
  film: "The whole song as a short film, shot by shot: Film 9:16 (Instagram) and Film 16:9 (YouTube). For a Reel, switch to Cut to the song.",
};

export function isSongStyle(x: unknown): x is SongStyle {
  return typeof x === "string" && (SONG_STYLES as readonly string[]).includes(x);
}

// The style the studio uses: the chosen one, else from what the song already has.
export function effectiveSongStyle(chosen: SongStyle | undefined | null, singingLines: number): SongStyle {
  return chosen ?? (singingLines > 0 ? "singing" : "cut");
}

// Does the song show this level's tools? Singing tools also show on a "cut" song that still has singing lines
// (they play in its videos, so they are never hidden).
export function showsSinging(style: SongStyle, singingLines: number): boolean {
  return style !== "cut" || singingLines > 0;
}
export function showsFilm(style: SongStyle): boolean {
  return style === "film";
}
