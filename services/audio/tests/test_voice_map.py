"""The voice map for pnpm make's vocal-start guard: the vocal track's level every 20 ms, from the
cached stem only (no Demucs, no WhisperX when it is cached)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.cache import file_hash
from app.voice_map import level_db, main

SR = 16_000


def _audio(spans: list[tuple[float, float, float]], total_s: float = 20.0) -> np.ndarray:
    audio = np.zeros(int(total_s * SR), dtype=np.float64)
    for a, b, amp in spans:
        t = np.arange(int(a * SR), int(b * SR)) / SR
        audio[int(a * SR) : int(b * SR)] += amp * np.sin(2 * np.pi * 220 * t)
    return audio.astype(np.float32)


def test_levels_every_20_ms_in_db() -> None:
    db = level_db(_audio([(2.0, 4.0, 0.5), (6.0, 7.0, 0.005)]), SR)
    assert len(db) == 999  # 20 s / 20 ms (minus the last window)
    at = lambda s: db[int(s * 1000 / 20)]  # noqa: E731
    assert abs(at(3.0) - (20 * np.log10(0.5 / np.sqrt(2)))) < 0.6  # a sine's RMS: -9 dB
    assert abs(at(6.5) - (20 * np.log10(0.005 / np.sqrt(2)))) < 0.6  # 40 dB quieter
    assert at(10.0) == -100.0  # silence: the floor
    assert all(v * 2 == round(v * 2) for v in db)  # 0.5 dB steps


def test_uses_the_cached_vocal_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "workspace"))
    song = tmp_path / "song.wav"
    sf.write(str(song), np.zeros(SR, dtype=np.float32), SR)
    stems = tmp_path / "workspace" / "cache" / "stems"
    stems.mkdir(parents=True)
    sf.write(str(stems / f"{file_hash(song)}-htdemucs-vocals.wav"), _audio([(2.0, 4.0, 0.5)]), SR)
    out = tmp_path / "voice.json"
    assert main([str(song), "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"] == 2 and data["hop_ms"] == 20 and len(data["db"]) == 999
