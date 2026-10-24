"""Word times tightened to the audible voice (fixes words that absorbed a silent gap)."""

from __future__ import annotations

import numpy as np
import pytest

from app.refine import refine_words

SR = 16_000


def _voice(seconds_on: list[tuple[float, float]], total_s: float = 6.0) -> np.ndarray:
    """Quiet noise floor with 'singing' (a loud tone) in the given spans."""
    rng = np.random.default_rng(0)
    audio = 0.0005 * rng.standard_normal(int(total_s * SR))
    for a, b in seconds_on:
        t = np.arange(int(a * SR), int(b * SR)) / SR
        audio[int(a * SR) : int(b * SR)] += 0.5 * np.sin(2 * np.pi * 220 * t)
    return audio.astype(np.float32)


def test_a_word_that_absorbed_a_gap_starts_where_the_voice_starts() -> None:
    # The voice sings 0.5-1.0 s ("first"), then pauses, then 3.0-3.4 s ("Hope").
    audio = _voice([(0.5, 1.0), (3.0, 3.4)])
    words = [
        {"word": "first", "start": 0.48, "end": 1.02, "score": 0.9},
        {"word": "Hope", "start": 1.05, "end": 3.42, "score": 0.6},  # stretched over the gap
    ]
    refined = refine_words(words, audio, SR)
    assert refined[0]["start"] == pytest.approx(0.48, abs=0.03)  # never earlier than aligned
    assert refined[1]["start"] == pytest.approx(3.0, abs=0.05)  # onset minus the small margin
    assert refined[1]["end"] == pytest.approx(3.4, abs=0.06)
    assert refined[1]["score"] == 0.6 and refined[1]["word"] == "Hope"


def test_times_only_move_inward_and_silent_or_untimed_words_are_kept() -> None:
    audio = _voice([(1.0, 2.0)])
    words = [
        {"word": "a", "start": 1.2, "end": 1.6},  # already inside the voice: unchanged
        {"word": "b", "start": 4.0, "end": 4.5},  # no voice at all: unchanged
        {"word": "c"},  # no times: unchanged
    ]
    refined = refine_words(words, audio, SR)
    assert refined[0]["start"] == pytest.approx(1.2, abs=0.001)
    assert refined[0]["end"] == pytest.approx(1.6, abs=0.001)
    assert refined[1] == words[1]
    assert refined[2] == words[2]
