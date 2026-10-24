// Pins: "lyric line = clip file" forces that clip onto the shot where the line appears on screen.
// Lines are matched with normalizeLyric (case, punctuation and extra spaces ignored); a line that
// occurs several times (a chorus) is pinned at every occurrence.
import { normalizeLyric } from "./lrc";

export type PinRule = { lineNumber: number; text: string; clipName: string };

export function parsePins(content: string): { rules: PinRule[]; warnings: string[] } {
  const rules: PinRule[] = [];
  const warnings: string[] = [];
  content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const at = line.lastIndexOf("=");
      if (at < 0) {
        warnings.push(`pins.txt line ${i + 1}: expected "lyric line = clip file", got "${line}"`);
        return;
      }
      const text = line.slice(0, at).trim();
      const clipName = line.slice(at + 1).trim();
      if (!text || !clipName) warnings.push(`pins.txt line ${i + 1}: expected "lyric line = clip file", got "${line}"`);
      else rules.push({ lineNumber: i + 1, text, clipName });
    });
  return { rules, warnings };
}

// A pin whose clip was found in the pool (the lyric line is matched later, per render).
export type ResolvedPin = { lineNumber: number; text: string; key: string; clipId: string; clipName: string };

export function matchPinClips(
  rules: readonly PinRule[],
  clips: readonly { id: string; name: string }[],
): { pins: ResolvedPin[]; warnings: string[] } {
  const pins: ResolvedPin[] = [];
  const warnings: string[] = [];
  const stem = (n: string) => n.toLowerCase().replace(/\.[^.]+$/, "");
  for (const rule of rules) {
    const wanted = rule.clipName.toLowerCase();
    const clip = clips.find((c) => c.name.toLowerCase() === wanted) ?? clips.find((c) => stem(c.name) === stem(wanted));
    if (!clip) {
      warnings.push(`pins.txt line ${rule.lineNumber}: clip "${rule.clipName}" not found in the clips folder`);
      continue;
    }
    pins.push({ lineNumber: rule.lineNumber, text: rule.text, key: normalizeLyric(rule.text), clipId: clip.id, clipName: clip.name });
  }
  return { pins, warnings };
}

// Maps pins to shots. `lines` are all lyric lines with their on-screen frames relative to the section
// (may be outside 0..duration), `bounds` the shot boundaries (section-relative frames). A line that
// starts just before the section but is still on screen at its start pins the first shot.
export function pinsToShots(
  pins: readonly ResolvedPin[],
  lines: readonly { text: string; startFrame: number; endFrame?: number }[],
  bounds: readonly number[],
): { byShot: Map<number, string>; warnings: string[] } {
  const byShot = new Map<number, string>();
  const owner = new Map<number, ResolvedPin>();
  const warnings: string[] = [];
  const duration = bounds[bounds.length - 1];
  for (const pin of pins) {
    const occurrences = lines.filter((l) => normalizeLyric(l.text) === pin.key);
    if (!occurrences.length) {
      warnings.push(`pins.txt line ${pin.lineNumber}: lyric line "${pin.text}" not found in the lyrics`);
      continue;
    }
    const inside = occurrences.filter((l) => l.startFrame < duration && (l.endFrame ?? l.startFrame + 1) > 0);
    if (!inside.length) {
      warnings.push(`pins.txt line ${pin.lineNumber}: "${pin.text}" is outside the section`);
      continue;
    }
    for (const line of inside) {
      const appears = Math.max(0, line.startFrame);
      let shot = 0;
      while (shot < bounds.length - 2 && bounds[shot + 1] <= appears) shot += 1;
      const earlier = owner.get(shot);
      if (earlier && earlier.clipId !== pin.clipId) {
        warnings.push(
          `pins.txt lines ${earlier.lineNumber} and ${pin.lineNumber} both pin shot ${shot + 1}; using ${pin.clipName} (line ${pin.lineNumber})`,
        );
      }
      byShot.set(shot, pin.clipId);
      owner.set(shot, pin);
    }
  }
  return { byShot, warnings };
}
