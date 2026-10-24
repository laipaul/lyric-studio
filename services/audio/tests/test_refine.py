"""Words that absorbed a silent gap are moved to where the voice starts."""

from __future__ import annotations

import numpy as np
import pytest

from app.refine import refine_words

SR = 16_000


def _voice(spans: list[tuple[float, float]], total_s: float = 6.0, blips: list[float] = (), leak_level: float = 0.06) -> np.ndarray:
    """Quiet noise floor, 'singing' (a loud tone) in the spans, and short drum-like blips (leakage)."""
    rng = np.random.default_rng(0)
    audio = 0.0005 * rng.standard_normal(int(total_s * SR))
    for a, b in spans:
        t = np.arange(int(a * SR), int(b * SR)) / SR
        audio[int(a * SR) : int(b * SR)] += 0.5 * np.sin(2 * np.pi * 220 * t)
    for at in blips:
        n = int(0.03 * SR)
        audio[int(at * SR) : int(at * SR) + n] += leak_level * rng.standard_normal(n)
    return audio.astype(np.float32)


def test_a_word_that_absorbed_a_gap_starts_where_the_voice_starts() -> None:
    # The voice sings 0.5-1.0 s, pauses (with drum leakage every 0.3 s), then sings "Hope" 3.0-3.4 s.
    audio = _voice([(0.5, 1.0), (3.0, 3.4)], blips=[1.2, 1.5, 1.8, 2.1, 2.4, 2.7])
    words = [
        {"word": "first", "start": 0.48, "end": 1.02, "score": 0.9},
        {"word": "Hope", "start": 1.05, "end": 3.42, "score": 0.6},  # stretched over the gap
    ]
    refined = refine_words(words, audio, SR)
    assert refined[0] == words[0]  # a normal word is left alone
    assert refined[1]["start"] == pytest.approx(3.0, abs=0.05)
    assert refined[1]["end"] == 3.42 and refined[1]["score"] == 0.6 and refined[1]["word"] == "Hope"


def test_a_held_note_keeps_its_length() -> None:
    audio = _voice([(1.0, 3.0)])
    word = {"word": "loooove", "start": 1.0, "end": 3.0}
    assert refine_words([word], audio, SR)[0]["start"] == pytest.approx(1.0, abs=0.01)


def test_a_breath_inside_a_long_word_is_not_a_gap() -> None:
    audio = _voice([(1.0, 1.8), (1.9, 3.0)])  # 100 ms dip: shorter than a pause
    word = {"word": "long", "start": 1.0, "end": 3.0}
    assert refine_words([word], audio, SR)[0]["start"] == pytest.approx(1.0, abs=0.03)


def test_silent_or_untimed_words_are_kept() -> None:
    audio = _voice([(1.0, 2.0)])
    words = [{"word": "b", "start": 3.5, "end": 5.0}, {"word": "c"}]
    assert refine_words(words, audio, SR) == words
