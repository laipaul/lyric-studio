"""Synthetic songs with a known vocal stem, for the vocal-stem tests: a "voice" (sung phrases: harmonic
notes with vibrato and breathy consonants, gaps between phrases) and a "band" (chords, kick, hi-hat),
mixed and lightly "mastered" (gain and a soft limiter), like Suno's mix and its vocal stem."""

from __future__ import annotations

import numpy as np

SR = 44_100


def voice(seconds: float, seed: int = 1, sr: int = SR, phrases_from: float = 2.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * sr))
    t0 = phrases_from
    while t0 < seconds - 3:
        phrase = rng.uniform(4.0, 9.0)
        t = t0
        while t < min(t0 + phrase, seconds - 1):
            dur = rng.uniform(0.18, 0.7)
            f0 = 110 * 2 ** (rng.integers(12, 26) / 12)
            n = int(dur * sr)
            tt = np.arange(n) / sr
            vib = 1 + 0.01 * np.sin(2 * np.pi * 5.5 * tt + rng.uniform(0, 6))
            phase = 2 * np.pi * np.cumsum(f0 * vib) / sr
            note = sum((0.6 / k) * np.sin(k * phase + rng.uniform(0, 6)) for k in range(1, 7))
            env = np.minimum(1, tt / 0.03) * np.minimum(1, (dur - tt) / 0.05)
            a = int(t * sr)
            out[a : a + n] += 0.25 * note * env
            # a consonant: a short noise burst before some notes
            if rng.random() < 0.5:
                m = int(0.04 * sr)
                b = max(0, a - m)
                out[b:a] += 0.05 * rng.standard_normal(a - b)
            t += dur + rng.uniform(0.0, 0.08)
        t0 += phrase + rng.uniform(1.5, 5.0)
    return out.astype(np.float32)


def band(seconds: float, seed: int = 7, sr: int = SR, bpm: float = 96.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    tt = np.arange(n) / sr
    out = np.zeros(n)
    beat = 60 / bpm
    # chords: four bars each, three notes
    for bar in range(int(seconds / (4 * beat)) + 1):
        a, b = int(bar * 4 * beat * sr), min(n, int((bar + 1) * 4 * beat * sr))
        root = 55 * 2 ** (rng.choice([0, 5, 7, 9]) / 12)
        for k in (1, 1.26, 1.5, 2):
            out[a:b] += 0.06 * np.sin(2 * np.pi * root * k * tt[a:b])
    kick_t = np.arange(int(0.15 * sr)) / sr
    kick = 0.7 * np.sin(2 * np.pi * (50 + 60 * np.exp(-kick_t / 0.03)) * kick_t) * np.exp(-kick_t / 0.05)
    hat = 0.08 * rng.standard_normal(int(0.03 * sr)) * np.exp(-np.arange(int(0.03 * sr)) / (0.006 * sr))
    k = 0
    while k * beat < seconds - 0.2:
        a = int(k * beat * sr)
        out[a : a + len(kick)] += kick[: n - a]
        h = int((k + 0.5) * beat * sr)
        if h + len(hat) < n:
            out[h : h + len(hat)] += hat
        k += 1
    return out.astype(np.float32)


def mix(v: np.ndarray, b: np.ndarray, master: bool = True) -> np.ndarray:
    m = 0.9 * v + b
    if master:
        m = np.tanh(1.6 * m) / 1.2  # a soft limiter and some gain
    return m.astype(np.float32)


def stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, 0.97 * x], axis=1)


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    import librosa

    return librosa.resample(x, orig_sr=src, target_sr=dst).astype(np.float32)


def fade(x: np.ndarray, seconds_in: float, seconds_out: float, sr: int = SR) -> np.ndarray:
    y = x.copy()
    a, b = int(seconds_in * sr), int(seconds_out * sr)
    if a:
        y[:a] *= np.linspace(0, 1, a)
    if b:
        y[-b:] *= np.linspace(1, 0, b)
    return y
