"""The recognised-words check: speech recognition only inside short windows, times in song ms
(the real model runs on the PC; here a stand-in transcriber)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.cache import file_hash
from app.first_words import main, words_in_windows

SR = 16_000


def test_windows_are_transcribed_on_their_own_with_song_times() -> None:
    audio = np.zeros(60 * SR, dtype=np.float32)
    seen: list[float] = []

    def fake(clip: np.ndarray, lang: str):
        seen.append(len(clip) / SR)
        return [("A", 0.30, 0.55, 0.9), ("heart", 0.60, 0.95, 0.8), ("", 1.0, 1.1, 0.1)]

    out = words_in_windows(audio, [(1, 11_500, 20_000), (31, 40_000, 90_000)], "en", fake)
    assert seen == [8.5, 20.0]  # the second window is cut at 30 s... and at the end of the song
    assert out[0]["words"] == [
        {"text": "A", "start_ms": 11_800, "end_ms": 12_050, "prob": 0.9},
        {"text": "heart", "start_ms": 12_100, "end_ms": 12_450, "prob": 0.8},
    ]
    assert out[1]["line"] == 31 and out[1]["to_ms"] == 70_000


def test_cli_uses_the_cached_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "workspace"))
    song = tmp_path / "song.wav"
    sf.write(str(song), np.zeros(SR, dtype=np.float32), SR)
    stems = tmp_path / "workspace" / "cache" / "stems"
    stems.mkdir(parents=True)
    sf.write(str(stems / f"{file_hash(song)}-htdemucs-vocals.wav"), np.zeros(20 * SR, dtype=np.float32), SR)
    out = tmp_path / "words.json"
    code = main([str(song), "--windows", "[[1, 0, 10000]]", "--lang", "en", "--out", str(out)], transcribe=lambda c, l: [("Hello", 1.0, 1.4, 0.7)])
    assert code == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["windows"][0]["words"][0]["start_ms"] == 1_000
