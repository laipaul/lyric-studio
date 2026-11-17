// FFmpeg / FFprobe for the spike: slices, the trimmed clip, review copies, the side-by-side comparison.
// The song and the vocal stem are only read (decoded into new WAV files); nothing writes into them.
import { spawnSync } from "node:child_process";

import type { VideoInfo } from "./checks";

export type Tools = { ffmpeg: string; ffprobe: string };

export function findTools(env: Record<string, string>): Tools | string {
  const tools = { ffmpeg: env.FFMPEG_PATH || "ffmpeg", ffprobe: env.FFPROBE_PATH || "ffprobe" };
  for (const [name, bin] of Object.entries(tools)) {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (r.error || r.status !== 0)
      return `${name} was not found (tried "${bin}"). Install FFmpeg (e.g. winget install Gyan.FFmpeg, then open a new terminal), or set ${name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"} in .env to the full path of ${name}.exe.`;
  }
  return tools;
}

function run(bin: string, args: string[], cwd?: string): string {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin.split(/[\\/]/).pop()} failed: ${(r.stderr || "").trim().split(/\r?\n/).slice(-4).join(" | ")}`);
  return r.stdout;
}

const fpsOf = (rate: string | undefined) => {
  const [a, b] = (rate ?? "0/1").split("/").map(Number);
  return b ? a / b : a || 0;
};

export function probeVideo(t: Tools, file: string): VideoInfo | null {
  try {
    const j = JSON.parse(run(t.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as {
      streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
      format: { duration?: string };
    };
    const v = j.streams.find((s) => s.codec_type === "video");
    if (!v?.width || !v.height) return null;
    const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
    const fps = fpsOf(v.avg_frame_rate) || fpsOf(v.r_frame_rate);
    return {
      width: rot ? v.height : v.width,
      height: rot ? v.width : v.height,
      fps,
      durationS: Number(v.duration ?? j.format.duration ?? 0),
      hasAudio: j.streams.some((s) => s.codec_type === "audio"),
    };
  } catch {
    return null;
  }
}

export function audioDuration(t: Tools, file: string): number {
  return Number(run(t.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).trim());
}

// Decodes the whole file; ok when FFmpeg reports no error.
export function plays(t: Tools, file: string): { ok: boolean; error?: string } {
  const r = spawnSync(t.ffmpeg, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
  const err = (r.stderr || "").trim();
  return r.status === 0 && !err ? { ok: true } : { ok: false, error: err.split(/\r?\n/)[0] || `exit ${r.status}` };
}

// A part of an audio file as WAV, sample-accurate (seek after -i), same sample rate and channels.
export function sliceAudioArgs(input: string, startS: number, durationS: number, out: string, codec: "pcm_s16le" | "pcm_s24le"): string[] {
  return ["-y", "-v", "error", "-i", input, "-ss", startS.toFixed(3), "-t", durationS.toFixed(3), "-map", "0:a:0", "-c:a", codec, out];
}

// The clip from `clipStartS`, exactly `durationS` long, its own size and frame rate, no sound.
export function trimClipArgs(input: string, clipStartS: number, durationS: number, out: string, size?: { w: number; h: number }): string[] {
  return [
    "-y", "-v", "error", "-i", input,
    "-ss", clipStartS.toFixed(3), "-t", durationS.toFixed(3),
    "-map", "0:v:0", "-an",
    ...(size ? ["-vf", `scale=${size.w}:${size.h}:flags=lanczos`] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-movflags", "+faststart",
    out,
  ];
}

// The model's video with the song's own mix (review only): picture copied as it is, sound AAC 320 kbps.
export function reviewArgs(video: string, mix: string, out: string): string[] {
  return ["-y", "-v", "error", "-i", video, "-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", out];
}

export type Panel = { file: string; label: string; aspect: number };

// Side by side: every panel the same height (whole comparison at most 3840 px wide, at most the clip's height),
// the clip's frame rate, padded / cut to the slice length, labelled; sound = the full mix.
export function comparisonArgs(panels: Panel[], mix: string, durationS: number, fps: number, clipHeight: number, out: string, font: string | null): string[] {
  const even = (x: number) => Math.max(2, Math.floor(x / 2) * 2);
  const h = even(Math.min(clipHeight, 1080, 3840 / panels.reduce((s, p) => s + p.aspect, 0)));
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
  const chains = panels.map((p, i) => {
    const label = font
      ? `,drawtext=fontfile=${font}:text='${esc(p.label)}':fontsize=${Math.round(h / 22)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(h / 90)}:x=(w-text_w)/2:y=h-text_h-${Math.round(h / 30)}`
      : "";
    return `[${i}:v]scale=-2:${h}:flags=lanczos,setsar=1,fps=${fps.toFixed(3)},tpad=stop_mode=clone:stop_duration=${durationS.toFixed(3)},trim=duration=${durationS.toFixed(3)},setpts=PTS-STARTPTS${label}[v${i}]`;
  });
  const stack = panels.length > 1 ? `${panels.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${panels.length}[out]` : "[v0]null[out]";
  return [
    "-y", "-v", "error",
    ...panels.flatMap((p) => ["-i", p.file]),
    "-i", mix,
    "-filter_complex", [...chains, stack].join(";"),
    "-map", "[out]", "-map", `${panels.length}:a:0`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "320k", "-t", durationS.toFixed(3), "-movflags", "+faststart",
    out,
  ];
}

export function ffmpeg(t: Tools, args: string[], cwd?: string): void {
  run(t.ffmpeg, args, cwd);
}

export function hasFilter(t: Tools, name: string): boolean {
  const r = spawnSync(t.ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" });
  return new RegExp(`\\s${name}\\s`).test(r.stdout ?? "");
}
