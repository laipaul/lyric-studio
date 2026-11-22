// "Same look on every platform" (22 Nov 2026, decided with the user): a theme can give one platform its own value
// (theme.json perPlatform, e.g. { "youtube": { "verseEffect": "cinematic-fade" } }). That is easy to set and then
// forget, so the YouTube video looks different from the Reel without the user knowing why. These helpers find the
// places where a theme differs per platform and say so in plain words; the theme editor's switch makes them the
// same. Pure (the theme editor in the browser and the Themes page data both use it).

export type PlatformDifference = { platform: string; field: string; value: unknown; base: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Every platform value of the theme that is not the same as its default look, platform by platform, in the
// order the platforms and fields are listed.
export function platformDifferences(look: Readonly<Record<string, unknown>>, perPlatform: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>): PlatformDifference[] {
  const out: PlatformDifference[] = [];
  for (const [platform, values] of Object.entries(perPlatform)) {
    for (const [field, value] of Object.entries(values ?? {})) {
      if (value === undefined || same(value, look[field])) continue;
      out.push({ platform, field, value, base: look[field] });
    }
  }
  return out;
}

// The platforms that look different, once each, e.g. ["YouTube"] ("Differs on YouTube" on a Themes tile).
export function platformsThatDiffer(diffs: readonly PlatformDifference[], platformLabel: (p: string) => string): string[] {
  return [...new Set(diffs.map((d) => platformLabel(d.platform)))];
}

// One plain line per platform: "YouTube: verse effect cinematic-fade (typewriter:15 everywhere else)".
export function differenceLines(
  diffs: readonly PlatformDifference[],
  label: { platform: (p: string) => string; field: (f: string) => string; show: (v: unknown) => string },
): string[] {
  const byPlatform = new Map<string, PlatformDifference[]>();
  for (const d of diffs) byPlatform.set(d.platform, [...(byPlatform.get(d.platform) ?? []), d]);
  return [...byPlatform].map(([platform, list]) => {
    const parts = list.map((d) => `${label.field(d.field).toLowerCase()} ${label.show(d.value)}${d.base === undefined ? "" : ` (${label.show(d.base)} everywhere else)`}`);
    return `${label.platform(platform)}: ${parts.join("; ")}`;
  });
}
