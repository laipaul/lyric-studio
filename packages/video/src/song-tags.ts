// The song's tags (Prepare → Song Details → Tags, 11 Nov 2026): one ranked list of hashtags (song.json "tags"), the
// artist's brand tags added to every song (brand.json "tags", "from your brand"), and suggestions from local rules
// only (artist, title, EP, the lyrics' language, the brand's genre / mood starter set brand.json "tagStarters"); never
// generic tags. The Post panel takes the top ones per platform (TAG_LIMITS). Pure: no files, no network.
export type TagSource = "artist" | "title" | "EP" | "language" | "starter";
export type RankedTag = { tag: string; brand: boolean }; // brand: from the artist's brand (always there)
export type TagSuggestion = { tag: string; from: TagSource };

// How many of the top tags each platform's post uses. Instagram: 5 at most (caption and comments together, since
// Dec 2025); a Reel shared to Facebook keeps them. TikTok and Shorts allow more (8 keeps the caption clean; YouTube
// ignores every hashtag past 60). YouTube: the first 3 hashtags of the description show above the title; its Tags
// box takes the whole list, up to 500 characters.
export const TAG_LIMITS: Record<string, number> = { reels: 5, standard: 5, tiktok: 8, shorts: 8, youtube: 3 };
export const YOUTUBE_TAGS_CHARS = 500;
export const TAG_PLATFORM_LABEL: Record<string, string> = { reels: "Instagram / Facebook", tiktok: "TikTok", shorts: "YouTube Shorts", youtube: "YouTube" };

// Tags people use to chase reach, not to describe the song: never suggested.
export const GENERIC_TAGS = new Set([
  "reels", "reel", "reelsinstagram", "instareels", "explore", "explorepage", "explorer", "fyp", "fy", "foryou", "foryoupage", "fypage",
  "viral", "viralvideo", "viralreels", "trending", "trend", "trendingreels", "instagood", "instadaily", "photooftheday", "love", "like",
  "follow", "likeforlikes", "followforfollowback", "tiktok", "shorts", "youtube", "youtubeshorts", "instagram", "facebook", "music", "newmusic",
]);

// The brand's genre / mood starter set when its brand.json has none (edit "tagStarters" there).
export const DEFAULT_TAG_STARTERS = ["lyricvideo", "emotionalpop", "cinematicpop", "lovesong", "sadsongs"];

// One tag: lowercase, no accents, no spaces or signs ("Here With Me" -> "herewithme", "Pômé" -> "pome").
export function normaliseTag(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// A list from what the user typed or a stored list: split on commas and #, each normalised, no empties, no duplicates.
export function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    for (const part of x.split(/[,#]/)) {
      const t = normaliseTag(part);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// The song's list with the brand's tags: the song's order (brand tags it placed keep their place), brand tags it
// has not placed yet at the end.
export function rankedTags(songTags: readonly string[] | undefined, brandTags: readonly string[]): RankedTag[] {
  const own = cleanTags(songTags ?? []);
  const brand = cleanTags(brandTags);
  return [...own, ...brand.filter((b) => !own.includes(b))].map((tag) => ({ tag, brand: brand.includes(tag) }));
}

export const hashtags = (tags: readonly string[]) => tags.map((t) => `#${t}`).join(" ");
export const tagsFor = (tags: readonly string[], platform: string) => tags.slice(0, TAG_LIMITS[platform] ?? TAG_LIMITS.standard);
// YouTube's Tags box: the whole list, as many whole tags as fit in 500 characters (commas count).
export function youtubeTagsField(tags: readonly string[]): string {
  let out = "";
  for (const t of tags) {
    const next = out ? `${out}, ${t}` : t;
    if (next.length > YOUTUBE_TAGS_CHARS) break;
    out = next;
  }
  return out;
}

// The lyrics' language from their small words (local rule, no network): en, fr, es, de, it, pt or null.
const SMALL_WORDS: Record<string, string[]> = {
  en: ["the", "and", "you", "my", "me", "your", "is", "i", "to", "in", "of", "it", "on", "with", "love", "we", "be", "for"],
  fr: ["le", "la", "les", "et", "je", "tu", "de", "des", "un", "une", "mon", "ma", "mes", "pas", "est", "que", "qui", "moi", "toi", "dans", "nous"],
  es: ["el", "la", "los", "las", "y", "yo", "tu", "de", "que", "en", "mi", "es", "no", "con", "por", "para", "amor", "una"],
  de: ["der", "die", "das", "und", "ich", "du", "nicht", "ist", "mit", "mein", "dich", "mich", "ein", "eine", "wir", "zu"],
  it: ["il", "lo", "la", "e", "io", "tu", "di", "che", "non", "mi", "ti", "un", "una", "per", "con", "sono", "amore"],
  pt: ["o", "a", "os", "as", "e", "eu", "voce", "de", "que", "nao", "meu", "minha", "um", "uma", "com", "por", "amor"],
};
export function lyricsLanguage(lyrics: string): string | null {
  const words = lyrics.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z']+/).flatMap((w) => w.split("'")).filter(Boolean);
  if (words.length < 8) return null;
  let best: string | null = null;
  let score = 0;
  for (const [lang, small] of Object.entries(SMALL_WORDS)) {
    const n = words.filter((w) => small.includes(w)).length;
    if (n > score) [best, score] = [lang, n];
  }
  return score / words.length >= 0.08 ? best : null;
}
export const LANGUAGE_TAGS: Record<string, string[]> = {
  en: ["englishsongs"],
  fr: ["chansonfrancaise", "musiquefrancaise"],
  es: ["musicaenespanol"],
  de: ["deutschemusik"],
  it: ["musicaitaliana"],
  pt: ["musicaportuguesa"],
};

// The suggestions for a song (grey chips): the artist, the title, the EP, the language, the brand's starter set;
// never a generic tag; each once.
export function suggestTags(values: { artist: string; song: string; ep?: string | null; lyrics?: string; starters?: readonly string[] }): TagSuggestion[] {
  const out: TagSuggestion[] = [];
  const add = (raw: string, from: TagSource) => {
    const tag = normaliseTag(raw);
    if (tag.length > 1 && !GENERIC_TAGS.has(tag) && !out.some((s) => s.tag === tag)) out.push({ tag, from });
  };
  add(values.artist, "artist");
  add(values.song, "title");
  if (values.ep) add(values.ep, "EP");
  const lang = values.lyrics ? lyricsLanguage(values.lyrics) : null;
  for (const t of lang ? (LANGUAGE_TAGS[lang] ?? []) : []) add(t, "language");
  for (const t of values.starters ?? DEFAULT_TAG_STARTERS) add(t, "starter");
  return out;
}

// A publishing text with the song's tags in: a "Hashtags" section (captions) gets the platform's top tags; YouTube's
// "Tags" section gets the whole list (500 characters) and the description's hashtag line its top 3.
export function withSongTags(sections: Record<string, string>, tags: readonly string[], platform: string): Record<string, string> {
  if (!tags.length) return sections;
  const out = { ...sections };
  if (platform === "youtube") {
    out.Tags = youtubeTagsField(tags);
    if (out.Description !== undefined) out.Description = withHashtagLine(out.Description, hashtags(tagsFor(tags, "youtube")));
  } else out.Hashtags = hashtags(tagsFor(tags, platform));
  return out;
}

// The description's last line made only of hashtags becomes `line` (added at the end when there is none).
export function withHashtagLine(text: string, line: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(#[^\s#]+\s*)+$/.test(lines[i])) {
      lines[i] = line;
      return lines.join("\n");
    }
  }
  return `${text.replace(/\n*$/, "")}\n\n${line}`;
}

// The same for a whole publish.txt ("== Title ==" ... sections): its Description and Tags.
export function withSongTagsText(text: string, tags: readonly string[]): string {
  if (!tags.length) return text;
  const parts = text.split(/^(== [^=\n]+ ==)\n/m);
  if (parts.length < 3) return `${text.replace(/\n*$/, "\n")}\n== Tags ==\n${youtubeTagsField(tags)}\n`;
  let hasTags = false;
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].slice(3, -3);
    const body = parts[i + 1] ?? "";
    const trail = /\n*$/.exec(body)![0];
    if (name === "Tags") {
      hasTags = true;
      parts[i + 1] = `${youtubeTagsField(tags)}${trail || "\n"}`;
    } else if (name === "Description") parts[i + 1] = `${withHashtagLine(body.replace(/\n*$/, ""), hashtags(tagsFor(tags, "youtube")))}${trail || "\n"}`;
  }
  let joined = parts[0];
  for (let i = 1; i < parts.length; i += 2) joined += `${parts[i]}\n${parts[i + 1] ?? ""}`;
  return hasTags ? joined : `${joined.replace(/\n*$/, "\n")}\n== Tags ==\n${youtubeTagsField(tags)}\n`;
}
