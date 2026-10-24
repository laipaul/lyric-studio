"""Synthetic click tracks with known tempo and downbeats, for tests."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

SR = 22050


def _click(sr: int) -> np.ndarray:
    """Short bright tick (2.5 kHz, ~25 ms) on every beat."""
    t = np.arange(int(0.025 * sr)) / sr
    return 0.5 * np.sin(2 * np.pi * 2500 * t) * np.exp(-t / 0.006)


def _kick(sr: int) -> np.ndarray:
    """Low kick drum (sweeping 110 -> 50 Hz, ~180 ms) that accents the downbeats."""
    t = np.arange(int(0.18 * sr)) / sr
    freq = 50 + 60 * np.exp(-t / 0.03)
    phase = 2 * np.pi * np.cumsum(freq) / sr
    return 0.9 * np.sin(phase) * np.exp(-t / 0.06)


def click_track(
    path: Path,
    bpm: float,
    bars: int = 16,
    pickup_beats: int = 1,
    lead_in_s: float = 0.5,
    sr: int = SR,
    fmt: str | None = None,
) -> tuple[list[float], list[float]]:
    """Writes a 4/4 click track and returns (all beat times, downbeat times) in seconds.

    It starts with `pickup_beats` upbeats before the first downbeat, so the first beat is NOT a
    downbeat; the analyser has to find the right phase."""
    period = 60.0 / bpm
    n_beats = pickup_beats + bars * 4
    beat_times = [lead_in_s + i * period for i in range(n_beats)]
    downbeats = [t for i, t in enumerate(beat_times) if i >= pickup_beats and (i - pickup_beats) % 4 == 0]

    total = int((beat_times[-1] + 1.0) * sr)
    y = np.zeros(total)
    click, kick = _click(sr), _kick(sr)
    for t in beat_times:
        start = int(round(t * sr))
        y[start : start + len(click)] += click[: total - start]
    for t in downbeats:
        start = int(round(t * sr))
        y[start : start + len(kick)] += kick[: total - start]
    y += 0.003 * np.random.default_rng(0).standard_normal(total)  # a little noise floor
    y /= np.abs(y).max() * 1.1

    sf.write(str(path), y.astype(np.float32), sr, format=fmt)
    return beat_times, downbeats


def _snare(sr: int) -> np.ndarray:
    t = np.arange(int(0.15 * sr)) / sr
    noise = np.random.default_rng(1).standard_normal(len(t))
    return 0.6 * (noise * np.exp(-t / 0.04) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05))


def _hihat(sr: int) -> np.ndarray:
    t = np.arange(int(0.04 * sr)) / sr
    noise = np.random.default_rng(2).standard_normal(len(t)) * np.exp(-t / 0.008)
    return 0.15 * np.diff(noise, prepend=0)


def _bass_note(sr: int, seconds: float, freq: float) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return 0.35 * np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.3)


def drum_track(path: Path, bpm: float, bars: int = 24, pickup_beats: int = 1, lead_in_s: float = 0.5, sr: int = SR):
    """A more realistic 4/4 groove: kick on 1 AND 3, snare on 2 and 4, hi-hats on every 8th note,
    and a bass note that changes at the start of every bar. Returns (beat times, downbeat times)."""
    period = 60.0 / bpm
    n_beats = pickup_beats + bars * 4
    total = int((lead_in_s + n_beats * period + 1.0) * sr)
    y = np.zeros(total)

    def add(sound: np.ndarray, t: float) -> None:
        start = int(round(t * sr))
        y[start : start + len(sound)] += sound[: total - start]

    beat_times, downbeats = [], []
    for i in range(n_beats):
        t = lead_in_s + i * period
        beat_times.append(t)
        position = (i - pickup_beats) % 4
        add(_hihat(sr), t)
        add(_hihat(sr), t + period / 2)
        if position in (0, 2):
            add(_kick(sr), t)
        if position in (1, 3):
            add(_snare(sr), t)
        if position == 0 and i >= pickup_beats:
            downbeats.append(t)
            add(_bass_note(sr, period * 2, [55, 41, 49, 46][((i - pickup_beats) // 4) % 4]), t)

    y /= np.abs(y).max() * 1.1
    sf.write(str(path), y.astype(np.float32), sr)
    return beat_times, downbeats
