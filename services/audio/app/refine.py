"""Tightens word times to where the separated voice is actually audible.

CTC forced alignment can let a word absorb a silent gap before it (e.g. the first word after an
instrumental break "starts" seconds early). On the Demucs vocal track the gap is nearly silent, so
each word's start is moved forward to the first moment the voice is audible inside the word, and its
end back to the last one. Times only ever move inward; a word with no audible voice is left as is.
"""

from __future__ import annotations

import numpy as np

HOP_S = 0.01  # loudness measured every 10 ms
WINDOW_S = 0.025
THRESHOLD_DB = -30.0  # "audible": within 30 dB of the loud parts of the vocal track
MARGIN_MS = 20  # keep a little air before the onset / after the end
MIN_WORD_MS = 60


def loudness_envelope(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """RMS level every 10 ms."""
    hop = int(HOP_S * sample_rate)
    win = int(WINDOW_S * sample_rate)
    if len(audio) < win:
        return np.zeros(0)
    frames = 1 + (len(audio) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    return np.sqrt(np.mean(audio[idx].astype(np.float64) ** 2, axis=1))


def audible_threshold(envelope: np.ndarray) -> float:
    if not len(envelope):
        return 0.0
    loud = np.percentile(envelope, 95)
    return float(loud * 10 ** (THRESHOLD_DB / 20))


def refine_words(words: list[dict], audio: np.ndarray, sample_rate: int) -> list[dict]:
    """words: [{"start": s, "end": s, ...}] in seconds (missing times are left alone)."""
    env = loudness_envelope(audio, sample_rate)
    if not len(env):
        return words
    threshold = audible_threshold(env)
    out = []
    for word in words:
        start, end = word.get("start"), word.get("end")
        if start is None or end is None or end <= start:
            out.append(word)
            continue
        a = max(0, int(start / HOP_S))
        b = min(len(env), int(np.ceil(end / HOP_S)) + 1)
        loud = np.nonzero(env[a:b] > threshold)[0]
        if not len(loud):
            out.append(word)
            continue
        new_start = max(start, (a + loud[0]) * HOP_S - MARGIN_MS / 1000)
        new_end = min(end, (a + loud[-1]) * HOP_S + WINDOW_S + MARGIN_MS / 1000)
        if new_end - new_start < MIN_WORD_MS / 1000:  # keep words sensible
            new_end = min(end, new_start + MIN_WORD_MS / 1000)
        out.append({**word, "start": round(new_start, 3), "end": round(max(new_end, new_start), 3)})
    return out
