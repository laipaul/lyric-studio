// QA "Audio matches the song": the video's audio against the same section of the song file (decoded by
// FFmpeg to mono 16 kHz for the comparison only; the song file is only read).
import { execFile } from "node:child_process";

import { ffmpegBin } from "@lyric/db";

import { compareSignals, type AudioMatch } from "../audio";

const RATE = 16_000;

function decode(file: string, startS?: number, lengthS?: number): Promise<Float32Array> {
  const args = ["-v", "error", ...(startS !== undefined ? ["-ss", startS.toFixed(3)] : []), "-i", file, ...(lengthS !== undefined ? ["-t", lengthS.toFixed(3)] : []), "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"];
  return new Promise((resolve, reject) =>
    execFile(ffmpegBin(), args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffmpeg could not read the audio of ${file}: ${stderr.toString() || error.message}`));
      const buf = Buffer.from(stdout);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    }),
  );
}

export async function compareAudio(video: string, song: string, section: { startMs: number; endMs: number }, fades: { fadeInS: number; fadeOutS: number }): Promise<AudioMatch> {
  const [rendered, source] = await Promise.all([decode(video), decode(song, section.startMs / 1000, (section.endMs - section.startMs) / 1000)]);
  const match = compareSignals(rendered, source, RATE, fades.fadeInS, fades.fadeOutS);
  // The expected length is the section's, also when the song ends early.
  return { ...match, expectedS: (section.endMs - section.startMs) / 1000 };
}
