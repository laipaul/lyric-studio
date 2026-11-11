// How a video is named on screen (11 Nov 2026): your own videos by platform and version ("Reels v1"); a try (Compare
// looks: another theme, picture set or fonts) by what it tries ("Try · Midnight Highway", "Try · pictures city"), with
// the version it is based on as a small line ("based on v1"). The same in Review, Shape's video picker and Post.
// `tryLabel`: exports.ts VideoInfo.try ("theme Midnight Highway", "pictures city", "fonts Cormorant + Kaushan").
export function tryName(tryLabel: string): string {
  const theme = /^theme (.+)$/.exec(tryLabel);
  return `Try · ${theme ? theme[1] : tryLabel}`;
}

// `name`: the song-wide version ("v3", exports.ts VideoInfo.name); a try's `basedOn` is the version it is based on.
export function videoTitle(v: { label: string; name: string; try?: string | null; basedOn?: string | null }, withPlatform = false): { title: string; basedOn: string | null } {
  if (!v.try) return { title: `${v.label} ${v.name}`, basedOn: null };
  return { title: withPlatform ? `${v.label} · ${tryName(v.try)}` : tryName(v.try), basedOn: `based on ${v.basedOn ?? v.name}` };
}

// The file name part ("Reels" for v1, "Reels v2", "Reels - Try Midnight Highway"): a try's files never take the name
// of your own video's.
export function videoFilePart(v: { label: string; name: string; try?: string | null }): string {
  if (v.try) return `${v.label} - ${tryName(v.try).replace(" · ", " ")}`;
  return `${v.label}${v.name && v.name !== "v1" ? ` ${v.name}` : ""}`;
}
