// Where the song page opens, and which Review platform shows (25 Nov 2026, after "Something About You always opened
// Review → Reels with 'No video to show'"). Plain functions: no browser, no server, so they are tested on their own.

// The cookie that remembers the last tab used for each song (written in the browser, read by the page on the server).
export const OPEN_TAB_COOKIE = (songId: string) => `ls-tab-${songId}`;
export const OPEN_TAB_MAX_AGE = 180 * 24 * 60 * 60; // 180 days, in seconds

// ?tab= wins; else the tab last used for this song; else Review only when the song has a kept video, else the first
// thing still to prepare (a blocking one first), else Make ("generate").
export function chooseOpeningTab(o: { asked?: string | null; remembered?: string | null; tabs: readonly string[]; keptVideos: number; todoTab?: string | null }): string {
  if (o.asked && o.tabs.includes(o.asked)) return o.asked;
  if (o.remembered && o.tabs.includes(o.remembered)) return o.remembered;
  if (o.keptVideos > 0) return "videos";
  return o.todoTab ?? "generate";
}

// The remembered platform if it has videos to show; else the first platform that has some; else the remembered one
// (or the first), so a song that is only being made still shows its placeholder.
export function chooseReviewPlatform(remembered: string | null | undefined, platforms: { name: string; count: number }[]): string | null {
  const mine = platforms.find((p) => p.name === remembered);
  if (mine && mine.count > 0) return mine.name;
  const withVideos = platforms.find((p) => p.count > 0);
  if (withVideos) return withVideos.name;
  return mine?.name ?? platforms[0]?.name ?? null;
}
