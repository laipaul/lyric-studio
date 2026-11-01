// Who a theme reaches, in plain words (asked by the user on 1 Nov 2026: in a song and on Themes it was not
// clear what a change touches). `users` are the titles of the songs using the theme; `thisSong` the song
// being worked on, when there is one.
export type ThemeReach = { badge: string; tone: "shared" | "single" | "unused"; reach: string };

const list = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

export function themeReach(users: string[], thisSong?: string | null): ThemeReach {
  const n = users.length;
  if (n === 0) return { badge: "Not used yet", tone: "unused", reach: "Changes here reach: no song yet (new songs can pick it)." };
  if (n === 1) {
    const only = thisSong && users[0] === thisSong;
    return { badge: only ? "This song only" : `Only ${users[0]}`, tone: "single", reach: `Changes here reach: ${only ? "this song only" : users[0]}.` };
  }
  return { badge: `Shared by ${n} songs`, tone: "shared", reach: `Changes here reach: ${n} songs (${list(users)}).` };
}
