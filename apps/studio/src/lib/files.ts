// Which workspace files the studio may serve: project covers and what "pnpm make" wrote into a
// project's export folders. Never the database or anything else.
const UUID = "[0-9a-f-]{36}";
const RUN = "\\d{4}-\\d{2}-\\d{2}_\\d{4}(?:-\\d+)?";
export const COVER_FILE = new RegExp(`^projects/${UUID}/audio/cover\\.(jpg|jpeg|png|webp)$`, "i");
export const EXPORT_FILE = new RegExp(`^projects/${UUID}/exports/${RUN}/(?:[a-z0-9-]+/)?(v\\d+\\.(mp4|srt|qa\\.txt|manifest\\.json)|thumbnail\\.jpg|publish\\.txt|[^/]+\\.lrc)$`, "i");
export const VIDEO_FILE = new RegExp(`^projects/${UUID}/exports/${RUN}/(?:[a-z0-9-]+/)?v\\d+\\.mp4$`, "i");

// Caption / publish templates in the brand folders (for "open folder").
export const TEMPLATE_FILE = /^brand\/(?:[^/]+\/)?publish-[a-z-]+\.txt$/;

export function allowedFile(relative: string): boolean {
  return !relative.includes("..") && (COVER_FILE.test(relative) || EXPORT_FILE.test(relative));
}
