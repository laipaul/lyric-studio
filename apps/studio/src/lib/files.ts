// Which workspace files the studio may serve: a song's cover, its own clips and what "pnpm make"
// wrote into its export folders (song folders songs/<artist>/<title>/, and songs not migrated yet in
// projects/<id>/), plus clip thumbnails and the song itself (audio preview). Never the database, .studio\ or anything else.
const UUID = "[0-9a-f-]{36}";
const RUN = "\\d{4}-\\d{2}-\\d{2}_\\d{4}(?:-\\d+)?";
const SONG = `(?:projects/${UUID}|songs/[^/]+/[^/]+)`;
export const COVER_FILE = new RegExp(`^(?:projects/${UUID}/audio|songs/[^/]+/[^/]+)/cover\\.(jpg|jpeg|png|webp)$`, "i");
export const EXPORT_FILE = new RegExp(`^${SONG}/exports/${RUN}/(?:[a-z0-9-]+/)?(v\\d+\\.(mp4|srt|qa\\.txt|manifest\\.json)|thumbnail\\.jpg|publish\\.txt|[^/]+\\.lrc)$`, "i");
export const VIDEO_FILE = new RegExp(`^${SONG}/exports/${RUN}/(?:[a-z0-9-]+/)?v\\d+\\.mp4$`, "i");
export const SONG_CLIP_FILE = /^songs\/[^/]+\/[^/]+\/clips\/[^/]+\.(mp4|m4v|mov|webm|jpe?g|png|webp)$/i;
// A shared collection's clips (the Collections page plays them on hover).
export const COLLECTION_CLIP_FILE = /^(?:collections|clips)\/[^/]+\/[^/]+\.(mp4|m4v|mov|webm|jpe?g|png|webp)$/i;
export const THUMB_FILE = new RegExp(`^thumbs/${UUID}\\.jpg$`, "i");
// The song itself (the Lyrics tab's audio preview). Songs keep their own file names: any WAV/MP3 at the top
// of a song folder may be the song, so those are served only when the database names them as a song
// (isSongAudio); song.wav|mp3 and the old projects\<id>\audio\ files as before.
export const SONG_AUDIO_FILE = new RegExp(`^(?:projects/${UUID}/audio/[^/]+|songs/[^/]+/[^/]+/song)\\.(wav|mp3)$`, "i");
export const SONG_FOLDER_AUDIO = /^songs\/[^/]+\/[^/]+\/[^/]+\.(wav|mp3)$/i;

// Caption / publish templates in the brand folders (for "open folder").
export const TEMPLATE_FILE = /^brand\/(?:[^/]+\/)?publish-[a-z-]+\.txt$/;

export function allowedFile(relative: string, isSongAudio?: (relative: string) => boolean): boolean {
  if (relative.split("/").some((part) => part === ".." || part === "." || part.startsWith(".studio"))) return false;
  return COVER_FILE.test(relative) || EXPORT_FILE.test(relative) || SONG_CLIP_FILE.test(relative) || COLLECTION_CLIP_FILE.test(relative) || THUMB_FILE.test(relative) || SONG_AUDIO_FILE.test(relative) || (!!isSongAudio && SONG_FOLDER_AUDIO.test(relative) && isSongAudio(relative));
}
