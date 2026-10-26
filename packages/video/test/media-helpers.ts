// Small media files and a stand-in aligner for tests that run "pnpm make".
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { ffmpegBin } from "@lyric/db";

import type { AlignRunner } from "../src/node";

export const ffmpeg = (...args: string[]) => execFileSync(ffmpegBin(), ["-y", "-v", "error", ...args]);

// A click track at 120 BPM: a high click on every beat and a low kick on every downbeat.
export function makeSong(file: string, seconds = 12) {
  ffmpeg(
    "-f", "lavfi",
    "-i", `aevalsrc='0.5*sin(2*PI*1200*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)+0.9*sin(2*PI*55*t)*exp(-12*mod(t-0.25,2))*gte(t,0.25)':s=44100:d=${seconds}`,
    "-ac", "2", file,
  );
}

export function makeClip(file: string, seconds: number, colour: string, size = "216x384") {
  ffmpeg("-f", "lavfi", "-i", `testsrc2=s=${size}:r=30:d=${seconds}`, "-vf", `drawbox=c=${colour}@0.6:t=fill`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file);
}

// Stands in for "pnpm align": a line every 1.5 s from 1 s, words 0.3 s apart.
export const fakeAlign: AlignRunner = async (a) => {
  const texts = readFileSync(a.lyrics, "utf8").split(/\r?\n/).filter(Boolean);
  const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
  const lines = texts.map((raw, i) => {
    const hook = raw.startsWith("* ");
    const text = raw.replace(/^\*\s+/, "");
    const start = 1000 + i * 1500;
    const words = text.split(" ").map((w, k) => `<${stamp(start + k * 300)}>${w}`).join(" ");
    return { line: `[${stamp(start)}]${hook ? "* " : ""}${words}`, report: { number: i + 1, text, is_hook: hook, start_ms: start, end_ms: start + 1100, confidence: 0.88 } };
  });
  writeFileSync(a.out, `${lines.map((l) => l.line).join("\n")}\n[${stamp(1000 + texts.length * 1500)}]\n`);
  writeFileSync(a.report, JSON.stringify({ model: "fake", lang: a.lang, low_confidence: 0.5, lines: lines.map((l) => l.report) }));
};

export const LYRICS = ["Verse one here", "* Hold on to me", "Through the night", "Verse two here", "Hold on to me", "Into the light"];
