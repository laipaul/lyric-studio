// FFmpeg arguments for the recast spike (pure: tested). The clip is only read; every output is a new file.
// Probing, running FFmpeg and finding the tools come from the lip-sync spike (spikes/lipsync/src/media.ts).
export { ffmpeg, findTools, hasFilter, plays, probeVideo, type Tools } from "../../lipsync/src/media";

export type Target = { width: number; height: number; fps: number; durationS: number };

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

// The clip as sent to the models: its own size and frame rate, no sound, H.264 (fal reads it everywhere).
export function sendCopyArgs(input: string, out: string): string[] {
  return ["-y", "-v", "error", "-i", input, "-map", "0:v:0", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];
}

// The clip's first frame as PNG (method C).
export function firstFrameArgs(input: string, out: string): string[] {
  return ["-y", "-v", "error", "-i", input, "-frames:v", "1", out];
}

// A model's video back to the clip's exact shape: scaled to cover, centre-cropped to the clip's size, the clip's frame
// rate, exactly the clip's length (the last frame held when shorter, cut when longer), no sound.
export function fitArgs(input: string, t: Target, out: string): string[] {
  const w = even(t.width);
  const h = even(t.height);
  const d = t.durationS.toFixed(3);
  const vf = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${w}:${h}`,
    "setsar=1",
    `fps=${t.fps > 0 ? t.fps.toFixed(3) : "30"}`,
    `tpad=stop_mode=clone:stop_duration=${d}`,
    `trim=duration=${d}`,
    "setpts=PTS-STARTPTS",
  ].join(",");
  return ["-y", "-v", "error", "-i", input, "-map", "0:v:0", "-an", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];
}

// How much of a model's picture the fit cuts away (0 = same shape), to report it.
export function cropShare(from: { width: number; height: number }, to: { width: number; height: number }): number {
  const a = from.width / from.height;
  const b = to.width / to.height;
  return Math.round((1 - Math.min(a, b) / Math.max(a, b)) * 1000) / 1000;
}

export type Panel = { file: string; label: string };

// One clip's panels side by side, each the same height (at most 1080, the whole at most 3840 wide), labelled, no sound.
export function comparisonArgs(panels: Panel[], t: Target, out: string, font: string | null): string[] {
  const aspect = t.width / t.height;
  const h = even(Math.min(t.height, 1080, 3840 / (panels.length * aspect)));
  const d = t.durationS.toFixed(3);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
  const chains = panels.map((p, i) => {
    const label = font ? `,drawtext=fontfile=${font}:text='${esc(p.label)}':fontsize=${Math.max(12, Math.round(h / 24))}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(h / 90)}:x=(w-text_w)/2:y=h-text_h-${Math.round(h / 30)}` : "";
    return `[${i}:v]scale=${even(h * aspect)}:${h}:flags=lanczos,setsar=1,fps=${(t.fps || 30).toFixed(3)},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS${label}[v${i}]`;
  });
  const stack = panels.length > 1 ? `${panels.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${panels.length}[out]` : "[v0]null[out]";
  return ["-y", "-v", "error", ...panels.flatMap((p) => ["-i", p.file]), "-filter_complex", [...chains, stack].join(";"), "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-t", d, "-movflags", "+faststart", out];
}

// Every clip's comparison one after another, each letterboxed into the same frame (the widest and tallest of them).
export function concatArgs(files: { file: string; width: number; height: number }[], out: string): string[] {
  const w = even(Math.max(...files.map((f) => f.width)));
  const h = even(Math.max(...files.map((f) => f.height)));
  const chains = files.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[c${i}]`);
  const cat = `${files.map((_, i) => `[c${i}]`).join("")}concat=n=${files.length}:v=1:a=0[out]`;
  return ["-y", "-v", "error", ...files.flatMap((f) => ["-i", f.file]), "-filter_complex", [...chains, cat].join(";"), "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];
}
