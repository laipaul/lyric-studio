"""Beat-grid helpers: downbeat offset and the click-track check file."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

BEATS_PER_BAR = 4


def downbeat_phase(beats: list[dict[str, Any]]) -> int:
    for i, b in enumerate(beats):
        if b["is_downbeat"]:
            return i % BEATS_PER_BAR
    return 0


def apply_downbeat_offset(beats: list[dict[str, Any]], offset: int) -> list[dict[str, Any]]:
    """Offset N (0-3): bar 1 starts N beats later than detected. Same rule as packages/video."""
    if offset not in (0, 1, 2, 3):
        raise ValueError("downbeat offset must be 0, 1, 2 or 3")
    phase = (downbeat_phase(beats) + offset) % BEATS_PER_BAR
    return [{**b, "is_downbeat": i >= phase and (i - phase) % BEATS_PER_BAR == 0} for i, b in enumerate(beats)]


def _tone(sr: int, freq: float, seconds: float, decay: float, level: float) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return level * np.sin(2 * np.pi * freq * t) * np.exp(-t / decay)


def click_path_for(song: Path) -> Path:
    return song.with_name(f"{song.stem}_click.wav")


def write_click_track(song: Path, beats: list[dict[str, Any]], out: Path | None = None) -> Path:
    """Writes <song>_click.wav: the original audio (full quality, stereo kept) with a short click on
    every beat and a louder, higher click on every downbeat."""
    audio, sr = sf.read(str(song), always_2d=True, dtype="float32")
    audio = audio.astype(np.float64)
    beat_click = _tone(sr, 1000, 0.03, 0.006, 0.35)
    bar_click = _tone(sr, 2000, 0.05, 0.010, 0.8)

    clicks = np.zeros(len(audio))
    for b in beats:
        start = int(round(b["time_ms"] / 1000 * sr))
        if start >= len(clicks):
            continue
        click = bar_click if b["is_downbeat"] else beat_click
        end = min(len(clicks), start + len(click))
        clicks[start:end] += click[: end - start]

    # Duck the music a little so the clicks stand out, then avoid clipping.
    mixed = audio * 0.7 + clicks[:, None]
    peak = np.abs(mixed).max()
    if peak > 0.99:
        mixed *= 0.99 / peak

    out = out or click_path_for(song)
    sf.write(str(out), mixed.astype(np.float32), sr, subtype="PCM_16")
    return out
