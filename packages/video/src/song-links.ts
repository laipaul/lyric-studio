// A song's links (song.json "links"): where people can hear it or find the artist. The Assets tab edits
// them; the posting texts use them (placeholders {{links}}, {{bestLink}}, {{spotify}}, ...). Pure: the
// studio's client imports it too.

export type LinkGroup = "Stores" | "Smart links & marketing" | "Artist & social";
export type LinkService = { id: string; label: string; group: LinkGroup; hosts: string[]; smart?: boolean };

// The services the Assets dropdown offers, grouped. "other" (with its own label) covers the rest.
export const LINK_SERVICES: LinkService[] = [
  { id: "spotify", label: "Spotify", group: "Stores", hosts: ["open.spotify.com", "spotify.com", "spotify.link"] },
  { id: "appleMusic", label: "Apple Music", group: "Stores", hosts: ["music.apple.com"] },
  { id: "itunes", label: "iTunes", group: "Stores", hosts: ["itunes.apple.com"] },
  { id: "youtube", label: "YouTube", group: "Stores", hosts: ["youtube.com", "youtu.be", "m.youtube.com"] },
  { id: "youtubeMusic", label: "YouTube Music", group: "Stores", hosts: ["music.youtube.com"] },
  { id: "amazonMusic", label: "Amazon Music", group: "Stores", hosts: ["music.amazon.com", "music.amazon.co.uk", "music.amazon.de", "music.amazon.fr", "amazon.com/music"] },
  { id: "deezer", label: "Deezer", group: "Stores", hosts: ["deezer.com", "deezer.page.link", "link.deezer.com"] },
  { id: "tidal", label: "Tidal", group: "Stores", hosts: ["tidal.com", "listen.tidal.com"] },
  { id: "soundcloud", label: "SoundCloud", group: "Stores", hosts: ["soundcloud.com", "on.soundcloud.com"] },
  { id: "bandcamp", label: "Bandcamp", group: "Stores", hosts: ["bandcamp.com"] },
  { id: "audiomack", label: "Audiomack", group: "Stores", hosts: ["audiomack.com"] },
  { id: "pandora", label: "Pandora", group: "Stores", hosts: ["pandora.com"] },
  { id: "anghami", label: "Anghami", group: "Stores", hosts: ["anghami.com"] },
  { id: "boomplay", label: "Boomplay", group: "Stores", hosts: ["boomplay.com"] },
  { id: "napster", label: "Napster", group: "Stores", hosts: ["napster.com"] },
  { id: "qobuz", label: "Qobuz", group: "Stores", hosts: ["qobuz.com"] },
  { id: "shazam", label: "Shazam", group: "Stores", hosts: ["shazam.com"] },
  { id: "featurefm", label: "Feature.fm", group: "Smart links & marketing", hosts: ["ffm.to", "feature.fm", "ffm.bio"], smart: true },
  { id: "linkfire", label: "Linkfire", group: "Smart links & marketing", hosts: ["lnk.to", "linkfire.com"], smart: true },
  { id: "hyperfollow", label: "DistroKid HyperFollow", group: "Smart links & marketing", hosts: ["distrokid.com/hyperfollow"], smart: true },
  { id: "toneden", label: "ToneDen", group: "Smart links & marketing", hosts: ["toneden.io"], smart: true },
  { id: "songlink", label: "Odesli (song.link)", group: "Smart links & marketing", hosts: ["song.link", "album.link", "odesli.co"], smart: true },
  { id: "songwhip", label: "Songwhip", group: "Smart links & marketing", hosts: ["songwhip.com"], smart: true },
  { id: "smarturl", label: "SmartURL", group: "Smart links & marketing", hosts: ["smarturl.it"], smart: true },
  { id: "hypeddit", label: "Hypeddit", group: "Smart links & marketing", hosts: ["hypeddit.com"], smart: true },
  { id: "showco", label: "Show.co", group: "Smart links & marketing", hosts: ["show.co"], smart: true },
  { id: "linktree", label: "Linktree", group: "Smart links & marketing", hosts: ["linktr.ee"], smart: true },
  { id: "beacons", label: "Beacons", group: "Smart links & marketing", hosts: ["beacons.ai"], smart: true },
  { id: "smartlink", label: "Smart link (other)", group: "Smart links & marketing", hosts: [], smart: true },
  { id: "website", label: "Artist website", group: "Artist & social", hosts: [] },
  { id: "instagram", label: "Instagram", group: "Artist & social", hosts: ["instagram.com", "instagr.am"] },
  { id: "tiktok", label: "TikTok", group: "Artist & social", hosts: ["tiktok.com", "vm.tiktok.com"] },
  { id: "facebook", label: "Facebook", group: "Artist & social", hosts: ["facebook.com", "fb.com", "fb.me", "m.facebook.com"] },
  { id: "x", label: "X (Twitter)", group: "Artist & social", hosts: ["x.com", "twitter.com"] },
  { id: "threads", label: "Threads", group: "Artist & social", hosts: ["threads.net", "threads.com"] },
  { id: "snapchat", label: "Snapchat", group: "Artist & social", hosts: ["snapchat.com"] },
  { id: "twitch", label: "Twitch", group: "Artist & social", hosts: ["twitch.tv"] },
  { id: "discord", label: "Discord", group: "Artist & social", hosts: ["discord.gg", "discord.com"] },
  { id: "patreon", label: "Patreon", group: "Artist & social", hosts: ["patreon.com"] },
  { id: "other", label: "Other", group: "Artist & social", hosts: [] },
];

export const LINK_GROUPS: LinkGroup[] = ["Stores", "Smart links & marketing", "Artist & social"];

// Short placeholder names for the most used ones ({{apple}} = Apple Music).
const ALIASES: Record<string, string> = { apple: "appleMusic", amazon: "amazonMusic", ytmusic: "youtubeMusic", twitter: "x" };

export type SongLink = { service: string; url: string; label?: string };

export function linkService(id: string): LinkService | undefined {
  return LINK_SERVICES.find((s) => s.id === id);
}

// The name a link is shown with: its own label for "other", else the service's name.
export function linkLabel(l: SongLink): string {
  if (l.label?.trim()) return l.label.trim();
  return linkService(l.service)?.label ?? "Link";
}

// "open.spotify.com/track/x" -> a full https URL; null when it is not a web address.
export function normaliseUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// The service a pasted URL belongs to (the longest matching host wins: music.youtube.com over youtube.com),
// else null (the user picks one).
export function detectService(raw: string): string | null {
  const url = normaliseUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const hostPath = `${host}${u.pathname.toLowerCase()}`;
  let best: { id: string; len: number } | null = null;
  for (const s of LINK_SERVICES) {
    for (const h of s.hosts) {
      const hit = h.includes("/") ? hostPath.startsWith(h) || hostPath.includes(`.${h}`) : host === h || host.endsWith(`.${h}`);
      if (hit && (!best || h.length > best.len)) best = { id: s.id, len: h.length };
    }
  }
  return best?.id ?? null;
}

// Checks song.json "links"; every problem is named.
export function checkLinks(raw: unknown): { links: SongLink[]; problems: string[] } {
  const problems: string[] = [];
  const links: SongLink[] = [];
  if (!Array.isArray(raw)) return { links, problems: ['links must be a list, e.g. [{ "service": "spotify", "url": "https://open.spotify.com/track/..." }]'] };
  raw.forEach((x, i) => {
    const l = x as { service?: unknown; url?: unknown; label?: unknown };
    const at = `links[${i + 1}]`;
    if (!l || typeof l !== "object") return void problems.push(`${at} must be { "service", "url" }`);
    if (typeof l.service !== "string" || !linkService(l.service)) return void problems.push(`${at}: unknown service "${String(l.service)}" (one of ${LINK_SERVICES.map((s) => s.id).join(", ")})`);
    const url = typeof l.url === "string" ? normaliseUrl(l.url) : null;
    if (!url) return void problems.push(`${at}: "${String(l.url)}" is not a web address`);
    const label = typeof l.label === "string" && l.label.trim() ? l.label.trim().slice(0, 40) : undefined;
    links.push({ service: l.service, url, ...(label ? { label } : {}) });
  });
  return { links, problems };
}

// The one link for a bio or a short caption: a smart link (covers every store), else the artist's
// website, else Spotify, else the first one.
export function bestLink(links: SongLink[]): SongLink | null {
  return links.find((l) => linkService(l.service)?.smart) ?? links.find((l) => l.service === "website") ?? links.find((l) => l.service === "spotify") ?? links[0] ?? null;
}

// Where to listen: the stores and smart links (not the social pages), "Spotify: https://...", one per line.
export function listenLines(links: SongLink[]): string {
  return links
    .filter((l) => linkService(l.service)?.group !== "Artist & social" || l.service === "website")
    .map((l) => `${linkLabel(l)}: ${l.url}`)
    .join("\n");
}

// Placeholder values: {{links}} (where to listen, one per line), {{socials}} (the artist's pages),
// {{bestLink}}, {{smartlink}} (any smart link), and one per service id ({{spotify}}, {{appleMusic}} /
// {{apple}}, {{youtube}}, {{website}}, {{facebook}}, ...). Empty when the song has none.
export function linkPlaceholders(links: SongLink[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of LINK_SERVICES) map[s.id] = links.find((l) => l.service === s.id)?.url ?? "";
  for (const [alias, id] of Object.entries(ALIASES)) map[alias] = map[id];
  map.smartlink = links.find((l) => linkService(l.service)?.smart)?.url ?? "";
  map.bestLink = bestLink(links)?.url ?? "";
  map.links = listenLines(links);
  map.socials = links
    .filter((l) => linkService(l.service)?.group === "Artist & social" && l.service !== "website")
    .map((l) => `${linkLabel(l)}: ${l.url}`)
    .join("\n");
  map.listen = map.links ? `Listen:\n${map.links}` : "";
  map.follow = map.socials ? `Follow:\n${map.socials}` : "";
  return map;
}

export const LINK_PLACEHOLDER_NAMES = ["links", "socials", "listen", "follow", "bestLink", "smartlink", ...LINK_SERVICES.map((s) => s.id), ...Object.keys(ALIASES)];

// A line holding an empty link placeholder disappears completely (like {{epLine}}).
export function dropEmptyLinkLines(text: string, map: Record<string, string>): string {
  return text.replace(/^[^\n]*\{\{(\w+)\}\}[^\n]*\n?/gm, (line, k: string) => (LINK_PLACEHOLDER_NAMES.includes(k) && !map[k] ? "" : line));
}

// The old YouTube template line, from before songs had links.
export const OLD_SPOTIFY_LINE = /^[ \t]*Listen on Spotify: https:\/\/open\.spotify\.com\/ \(add the link to the song\)[ \t]*$/m;

// A YouTube description (or any text) with the song's links in: the old Spotify placeholder line
// becomes "Listen:" + the links (and "Follow:" + the social pages); a text that has none of the links
// yet gets them before its hashtag line (or at its end). Without links: the old placeholder line goes.
export function withLinks(text: string, links: SongLink[]): string {
  const map = linkPlaceholders(links);
  const block = [map.listen, map.follow].filter(Boolean).join("\n\n");
  if (!block) return text.replace(new RegExp(`${OLD_SPOTIFY_LINE.source}\\n?`, "m"), "");
  if (OLD_SPOTIFY_LINE.test(text)) return text.replace(OLD_SPOTIFY_LINE, block);
  if (links.some((l) => text.includes(l.url))) return text;
  const lines = text.split("\n");
  const tagAt = lines.findIndex((l) => /^#[\p{L}\p{N}]/u.test(l.trim()));
  if (tagAt < 0) return `${text.replace(/\s*$/, "")}\n\n${block}`;
  const before = lines.slice(0, tagAt).join("\n").replace(/\s*$/, "");
  return `${before}\n\n${block}\n\n${lines.slice(tagAt).join("\n")}`;
}

// The links a post of one platform uses: the ones picked for that platform on the Post panel (song.json
// postLinks), else YouTube (clickable descriptions): every store and smart link plus the social pages;
// Reels / TikTok / Shorts (captions are not clickable there): the one best link, for the bio.
export function pickedLinks(links: SongLink[], postLinks: Record<string, string[]> | undefined, platform: string): SongLink[] {
  const own = postLinks?.[platform];
  if (own) return own.map((u) => links.find((l) => l.url === u)).filter((l): l is SongLink => !!l);
  if (platform === "youtube") return links;
  const best = bestLink(links);
  return best ? [best] : [];
}

// A text with the song's links taken out and the picked ones put in (withLinks): the Post panel's
// YouTube description follows the links picked there, even after publish.txt was written.
export function relink(text: string, all: SongLink[], picked: SongLink[]): string {
  const urls = all.map((l) => l.url);
  const kept = text.split("\n").filter((line) => !urls.some((u) => line.includes(u)));
  const cleaned = kept
    .filter((line, i) => !(/^\s*(Listen|Follow):\s*$/.test(line) && !(kept[i + 1] ?? "").trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return withLinks(cleaned, picked);
}
