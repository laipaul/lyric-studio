// Thin wrappers around the ffmpeg / ffprobe programs installed on this PC.
// Override their location with FFMPEG_PATH / FFPROBE_PATH in .env if they are not on the PATH.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export const ffmpegBin = () => process.env.FFMPEG_PATH?.trim() || "ffmpeg";
export const ffprobeBin = () => process.env.FFPROBE_PATH?.trim() || "ffprobe";

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `FFmpeg was not found ("${bin}"). Check that "ffmpeg -version" and "ffprobe -version" work ` +
              `in the terminal, or set FFMPEG_PATH and FFPROBE_PATH in the .env file.`,
          ),
        );
      } else if (error) {
        reject(new Error(`${bin} failed: ${stderr.trim() || error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export type MediaInfo = {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null; // as displayed (rotation applied)
  height: number | null;
};

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
  disposition?: { attached_pic?: number };
};

export async function probeMedia(file: string): Promise<MediaInfo> {
  const out = await run(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const info = JSON.parse(out) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const streams = info.streams ?? [];
  // Cover art inside an MP3 shows up as a "video" stream; ignore it.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");

  const seconds = Number(info.format?.duration ?? video?.duration ?? audio?.duration ?? NaN);
  if (!Number.isFinite(seconds)) throw new Error(`Could not read the duration of ${file}`);

  let width = video?.width ?? null;
  let height = video?.height ?? null;
  const rotation = Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];

  return { durationMs: Math.round(seconds * 1000), hasVideo: !!video, hasAudio: !!audio, width, height };
}

// Thumbnails come from about 1 second in (frame 0 is often black), or the middle of shorter clips.
export function thumbnailTimeSeconds(durationMs: number): number {
  return durationMs >= 2000 ? 1 : durationMs / 2 / 1000;
}

const THUMB_MAX_SIZE = 480;

export async function makeThumbnail(input: string, output: string, atSeconds: number): Promise<void> {
  const grab = (seconds: number) =>
    run(ffmpegBin(), [
      "-y", "-v", "error",
      "-ss", seconds.toFixed(3),
      "-i", input,
      "-frames:v", "1",
      "-vf", `scale=w=${THUMB_MAX_SIZE}:h=${THUMB_MAX_SIZE}:force_original_aspect_ratio=decrease`,
      "-q:v", "3",
      output,
    ]);
  await grab(atSeconds);
  // Some files report a longer duration than they have frames for; fall back to the first frame.
  if (!existsSync(output)) await grab(0);
  if (!existsSync(output)) throw new Error(`FFmpeg could not create a thumbnail for ${input}`);
}
