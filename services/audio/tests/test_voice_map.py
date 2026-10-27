"""The voice map for pnpm make's vocal-start guard: stretches of sustained voice on the vocal stem,
from the cached stem only (no Demucs, no WhisperX when it is cached)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.cache import file_hash
from app.refine import loudness_envelope, voice_threshold
from app.voice_map import main, sustained_voice

SR = 16_000


def _audio(spans: list[tuple[float, float]], total_s: float = 40.0) -> np.ndarray:
    rng = np.random.default_rng(1)
    audio = 0.0005 * rng.standard_normal(int(total_s * SR))
    for a, b in spans:
        t = np.arange(int(a * SR), int(b * SR)) / SR
        audio[int(a * SR) : int(b * SR)] += 0.5 * np.sin(2 * np.pi * 220 * t)
    return audio.astype(np.float32)


SPANS = [(5.0, 5.05), (12.0, 14.0), (14.1, 17.0), (18.0, 25.0), (30.5, 36.0)]  # a click, then singing


def test_sustained_voice_joins_short_pauses_and_drops_clicks() -> None:
    env = loudness_envelope(_audio(SPANS), SR)
    got = sustained_voice(env, voice_threshold(env))
    expected = [(12_000, 17_000), (18_000, 25_000), (30_500, 36_000)]
    assert len(got) == len(expected)
    for (a, b), (x, y) in zip(got, expected):
        assert abs(a - x) <= 40 and abs(b - y) <= 40


def test_uses_the_cached_vocal_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "workspace"))
    song = tmp_path / "song.wav"
    sf.write(str(song), np.zeros(SR, dtype=np.float32), SR)
    stems = tmp_path / "workspace" / "cache" / "stems"
    stems.mkdir(parents=True)
    sf.write(str(stems / f"{file_hash(song)}-htdemucs-vocals.wav"), _audio(SPANS), SR)
    out = tmp_path / "voice.json"
    assert main([str(song), "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"] == 1 and len(data["stretches"]) == 3
    assert abs(data["stretches"][0][0] - 12_000) <= 40
