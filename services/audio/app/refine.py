"""Fixes words that absorbed a silent gap.

CTC forced alignment can let a word swallow the gap before it: the first word after an instrumental
break then "starts" seconds early, while its end is still right. On the Demucs vocal track the singing
itself is the loudest part, so for a suspiciously long word we walk back from its (reliable) end
through the voice until a real pause (at least GAP_MS without audible voice), and start the word
there. Short blips (drum leakage in the vocal stem) do not count as voice. A held note keeps its
length because the voice is continuous. Times only ever move later; other words are unchanged.
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


def voice_onset_before(envelope: np.ndarray, threshold: float, first: int, last: int) -> int | None:
    """Frame where the voice that is sounding at the end of [first, last] began (going back until a
    pause of GAP_MS), or None if there is no voice in the range."""
    loud = envelope[first : last + 1] > threshold
    voiced = np.nonzero(loud)[0]
    if not len(voiced):
        return None
    gap_frames = int(GAP_MS / 1000 / HOP_S)
    onset = voiced[-1]
    quiet = 0
    for i in range(voiced[-1], -1, -1):
        if loud[i]:
            onset, quiet = i, 0
        else:
            quiet += 1
            if quiet >= gap_frames:
                break
    return first + onset


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
        onset = voice_onset_before(env, threshold, first, last)
        if onset is None:
            out.append(word)
            continue
        new_start = min(max(start, onset * HOP_S - MARGIN_MS / 1000), end)
        out.append({**word, "start": round(new_start, 3)})
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
