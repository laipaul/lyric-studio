"""--diagnose 2,9: what did the aligner latch onto for these lines?

Prints the line's words with scores, a loudness chart of the vocal track around the aligned and the
tapped time, the bursts of voice found there, and a best guess of what the aligner heard (reverb tail,
breath, quieter backing vocal, ...). Also saves short WAV snippets of the vocal track at both times,
which are the most reliable way to judge: listen to them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .lrc import AlignedLine, format_stamp
from .refine import GAP_MS, HOP_S, loudness_envelope, voice_threshold

CHART = " .:-=+*#%@"  # quiet -> loud (plain ASCII so every terminal shows it)


@dataclass
class Burst:
    start_ms: int
    end_ms: int
    peak_db: float  # relative to the loud parts of the vocal track
    decays: bool  # loudest at the start and fading out (like a reverb tail)

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


def bursts_between(env: np.ndarray, threshold: float, ref: float, start_ms: int, end_ms: int) -> list[Burst]:
    a, b = max(0, int(start_ms / 1000 / HOP_S)), min(len(env), int(end_ms / 1000 / HOP_S))
    voiced = np.nonzero(env[a:b] > threshold)[0]
    if not len(voiced):
        return []
    gap = int(GAP_MS / 1000 / HOP_S)
    spans, begin, prev = [], voiced[0], voiced[0]
    for i in voiced[1:]:
        if i - prev > gap:
            spans.append((begin, prev))
            begin = i
        prev = i
    spans.append((begin, prev))
    out = []
    for s, e in spans:
        part = env[a + s : a + e + 1]
        peak = float(part.max())
        first_fifth = part[: max(1, len(part) // 5)].max()
        decays = len(part) >= 10 and first_fifth >= peak * 0.9 and part[-max(1, len(part) // 5) :].mean() < peak * 0.35
        out.append(Burst(round((a + s) * HOP_S * 1000), round((a + e + 1) * HOP_S * 1000), 20 * np.log10(max(peak, 1e-9) / ref), decays))
    return out


def guess(at_aligned: Burst | None, near_tap: Burst | None, previous_end_ms: int | None) -> str:
    """Best guess of what the aligner latched onto at the aligned time."""
    if at_aligned is None:
        return "no voice at the aligned time: the line was stretched over a gap in the singing"
    if previous_end_ms is not None and at_aligned.start_ms - previous_end_ms <= 300 and at_aligned.decays:
        return "a fading sound right after the previous line: most likely its reverb tail / held last note"
    if at_aligned.duration_ms < 400 and at_aligned.peak_db < -10:
        return "a short, quiet sound: most likely a breath or a small noise"
    if near_tap is not None and near_tap is not at_aligned and at_aligned.peak_db < near_tap.peak_db - 6:
        return "a quieter voice than the one at your tap: most likely a backing vocal, ad-lib or echo"
    if near_tap is not None and near_tap is not at_aligned:
        return "a full-strength vocal phrase before your tap: possibly an earlier part sung with similar sounds"
    return "the same burst of voice as your tap (the start inside it is off)"


def chart(env: np.ndarray, ref: float, start_ms: int, end_ms: int, marks: dict[int, str], step_ms: int = 100) -> list[str]:
    """One character per step for loudness (-40 dB .. 0 dB) and a marker line below it."""
    levels, markers = [], []
    for t in range(start_ms, end_ms, step_ms):
        a, b = int(t / 1000 / HOP_S), int((t + step_ms) / 1000 / HOP_S)
        level = env[a:b].max() if 0 <= a < b <= len(env) else 0.0
        db = 20 * np.log10(max(level, 1e-9) / ref)
        levels.append(CHART[int(np.clip((db + 40) / 40 * (len(CHART) - 1), 0, len(CHART) - 1))])
        markers.append(next((m for at, m in marks.items() if t <= at < t + step_ms), " "))
    return ["".join(levels), "".join(markers)]


def diagnose_line(
    number: int,
    line: AlignedLine,
    previous: AlignedLine | None,
    tapped_ms: int | None,
    voice: np.ndarray,
    sample_rate: int,
    snippet_dir: Path,
) -> list[str]:
    import soundfile as sf

    env = loudness_envelope(voice, sample_rate)
    threshold = voice_threshold(env)
    ref = float(np.percentile(env, 95)) or 1.0
    times = [line.start_ms] + ([tapped_ms] if tapped_ms is not None else [])
    start, end = max(0, min(times) - 1500), max(times) + 2500
    bursts = bursts_between(env, threshold, ref, start, end)
    inside = lambda t: next((b for b in bursts if b.start_ms - 50 <= t <= b.end_ms), None)  # noqa: E731
    at_aligned = inside(line.start_ms)
    near_tap = min(bursts, key=lambda b: abs(b.start_ms - tapped_ms)) if (bursts and tapped_ms is not None) else None

    out = [f"Line {number}: {line.text!r}   confidence {line.confidence:.2f}"]
    out.append(
        f"  aligned {format_stamp(line.start_ms)}"
        + (f"   tapped {format_stamp(tapped_ms)}   difference {line.start_ms - tapped_ms:+} ms" if tapped_ms is not None else "")
    )
    out.append("  words:  " + "  ".join(f"{w.text} {format_stamp(w.start_ms)[1:-1]} ({w.score:.2f})" for w in line.words))
    marks = {line.start_ms: "A"} | ({tapped_ms: "T"} if tapped_ms is not None else {})
    levels, markers = chart(env, ref, start, end, marks)
    out.append(f"  vocal loudness {format_stamp(start)[1:-1]} -> {format_stamp(end)[1:-1]}, 0.1 s per character (A = aligned, T = tapped):")
    out.append(f"    |{levels}|")
    out.append(f"    |{markers}|")
    out.append("  bursts of voice:")
    for b in bursts:
        tags = [t for t, ok in (("<- aligned", b is at_aligned), ("<- nearest your tap", b is near_tap)) if ok]
        out.append(
            f"    {format_stamp(b.start_ms)[1:-1]} - {format_stamp(b.end_ms)[1:-1]}  {b.duration_ms / 1000:4.1f} s  peak {b.peak_db:5.1f} dB"
            f"{'  fading' if b.decays else ''}  {' '.join(tags)}"
        )
    out.append(f"  best guess: {guess(at_aligned, near_tap, previous.end_ms if previous else None)}")

    snippet_dir.mkdir(parents=True, exist_ok=True)
    for label, t in [("aligned", line.start_ms)] + ([("tapped", tapped_ms)] if tapped_ms is not None else []):
        a, b = max(0, int((t - 500) / 1000 * sample_rate)), int((t + 3000) / 1000 * sample_rate)
        path = snippet_dir / f"line{number:02d}-{label}.wav"
        sf.write(str(path), voice[a:b], sample_rate)
        out.append(f"  listen ({label}, vocals only, from 0.5 s before): {path}")
    return out
