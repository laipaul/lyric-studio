"""Fixes words that swallowed a silent gap.

CTC forced alignment can stretch a word across a gap: the first word after an instrumental break
"starts" seconds early, or the last word before a break "lasts" until the next line. On the Demucs
vocal track the singing is the loudest part, so inside a suspiciously long word we split the audible
voice into bursts (separated by a pause of at least GAP_MS) and keep the strongest burst: that is
where the word is really sung, whichever side the gap is on. Short blips (drum leakage) are too weak
to win, and a held note keeps its length because its voice is one continuous burst. Times only ever
move inward; other words are unchanged.
"""

from __future__ import annotations

import numpy as np

HOP_S = 0.01  # loudness measured every 10 ms
WINDOW_S = 0.025
THRESHOLD_DB = -20.0  # voice: within 20 dB of the loud parts of the vocal track
GAP_MS = 150  # a quiet stretch at least this long is a pause between words
LONG_WORD_S = 0.9  # only words longer than this are checked
MARGIN_MS = 20  # keep a little air before the onset


def loudness_envelope(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """RMS level every 10 ms."""
    hop = int(HOP_S * sample_rate)
    win = int(WINDOW_S * sample_rate)
    if len(audio) < win:
        return np.zeros(0)
    frames = 1 + (len(audio) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    return np.sqrt(np.mean(audio[idx].astype(np.float64) ** 2, axis=1))


def voice_threshold(envelope: np.ndarray) -> float:
    if not len(envelope):
        return 0.0
    return float(np.percentile(envelope, 95) * 10 ** (THRESHOLD_DB / 20))


def strongest_burst(envelope: np.ndarray, threshold: float, first: int, last: int) -> tuple[int, int] | None:
    """(first, last) frame of the loudest stretch of voice in [first, last], where pauses shorter
    than GAP_MS do not split a stretch; None if there is no voice."""
    segment = envelope[first : last + 1]
    voiced = np.nonzero(segment > threshold)[0]
    if not len(voiced):
        return None
    gap_frames = int(GAP_MS / 1000 / HOP_S)
    bursts: list[tuple[int, int]] = []
    begin = prev = voiced[0]
    for i in voiced[1:]:
        if i - prev > gap_frames:
            bursts.append((begin, prev))
            begin = i
        prev = i
    bursts.append((begin, prev))
    a, b = max(bursts, key=lambda r: float(np.sum(segment[r[0] : r[1] + 1] ** 2)))
    return first + a, first + b


def refine_words(words: list[dict], audio: np.ndarray, sample_rate: int) -> list[dict]:
    """words: [{"start": s, "end": s, ...}] in seconds (missing times are left alone)."""
    env = loudness_envelope(audio, sample_rate)
    if not len(env):
        return words
    threshold = voice_threshold(env)
    out = []
    for word in words:
        start, end = word.get("start"), word.get("end")
        if start is None or end is None or end - start <= LONG_WORD_S:
            out.append(word)
            continue
        first = max(0, int(start / HOP_S))
        last = min(len(env) - 1, int(end / HOP_S))
        burst = strongest_burst(env, threshold, first, last)
        if burst is None:
            out.append(word)
            continue
        new_start = min(max(start, burst[0] * HOP_S - MARGIN_MS / 1000), end)
        new_end = max(min(end, burst[1] * HOP_S + WINDOW_S + MARGIN_MS / 1000), new_start)
        out.append({**word, "start": round(new_start, 3), "end": round(new_end, 3)})
    return out


def loudness_report(audio: np.ndarray, sample_rate: int, start_s: float, end_s: float, step_s: float = 0.25) -> str:
    """Vocal-track loudness (dB below its loud parts) in steps, for diagnosing alignment problems."""
    env = loudness_envelope(audio, sample_rate)
    if not len(env):
        return "(no audio)"
    ref = np.percentile(env, 95) or 1.0
    parts = []
    t = start_s
    while t < end_s:
        a, b = int(t / HOP_S), max(int(t / HOP_S) + 1, int((t + step_s) / HOP_S))
        level = env[a:b].max() if b <= len(env) and a < b else 0.0
        parts.append(f"{t:.2f}s:{20 * np.log10(max(level, 1e-9) / ref):.0f}dB")
        t += step_s
    return " ".join(parts)
