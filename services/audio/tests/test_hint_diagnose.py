"""--hint and --diagnose logic (no AI packages needed)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.align import build_parser, output_path
from app.compare import compare
from app.diagnose import Burst, bursts_between, chart, diagnose_line, guess
from app.hint import HINT_CONFIDENCE, plan_hints, shift_line, voice_onsets
from app.lrc import AlignedLine, Word, parse_lrc
from app.refine import loudness_envelope, voice_threshold

SR = 16_000


def _line(text: str, start: int, score: float = 0.9, step: int = 300) -> AlignedLine:
    return AlignedLine(text, False, [Word(w, start + i * step, start + i * step + step - 50, score) for i, w in enumerate(text.split())])


def _voice(spans: list[tuple[float, float, float]], total_s: float = 30.0) -> np.ndarray:
    """(start s, end s, level) spans of 'singing' over a quiet noise floor."""
    rng = np.random.default_rng(1)
    audio = 0.0005 * rng.standard_normal(int(total_s * SR))
    for a, b, level in spans:
        t = np.arange(int(a * SR), int(b * SR)) / SR
        audio[int(a * SR) : int(b * SR)] += level * np.sin(2 * np.pi * 220 * t)
    return audio.astype(np.float32)


def _onsets(audio: np.ndarray) -> list[int]:
    env = loudness_envelope(audio, SR)
    return voice_onsets(env, voice_threshold(env))


# A song: line 2 was aligned 2.8 s early (low confidence); your taps are ~0.2 s late everywhere.
ALIGNED = [
    _line("First line here", 1_000),
    _line("When the night won't let you sleep", 2_400, score=0.55),  # really sung at 5.2 s
    _line("Third line comes", 9_000),
    _line("Fourth line now", 12_000, score=0.65),  # low confidence but already right
]
TAPS = parse_lrc("[00:01.20]First line here\n[00:05.40]When the night won't let you sleep\n[00:09.20]Third line comes\n[00:12.20]Fourth line now\n")
VOICE = _voice([(1.0, 2.0, 0.5), (2.3, 2.6, 0.08), (5.2, 7.0, 0.5), (9.0, 10.0, 0.5), (12.0, 13.0, 0.5)])


def test_voice_onsets_are_starts_after_a_pause() -> None:
    onsets = _onsets(VOICE)
    for expected in (1_000, 2_300, 5_200, 9_000, 12_000):
        assert any(abs(o - expected) <= 30 for o in onsets), expected


def test_only_low_confidence_lines_far_from_their_tap_are_moved() -> None:
    taps = compare(ALIGNED, TAPS)
    assert taps.typical_offset_ms == -200  # alignment minus taps: the taps are 0.2 s late
    decisions = plan_hints(ALIGNED, taps, _onsets(VOICE))
    assert [d.number for d in decisions] == [2]  # line 4 is low but already at its prior
    d = decisions[0]
    assert d.tapped_ms == 5_400 and d.prior_ms == 5_200  # tapped time minus the typical lateness
    assert abs(d.target_ms - 5_200) <= 30 and d.source == "voice onset"
    assert HINT_CONFIDENCE == 0.7


def test_without_a_voice_onset_nearby_the_prior_is_used() -> None:
    quiet = _voice([(1.0, 2.0, 0.5), (9.0, 10.0, 0.5), (12.0, 13.0, 0.5)])  # nothing near 5.2 s
    d = plan_hints(ALIGNED, compare(ALIGNED, TAPS), _onsets(quiet))[0]
    assert d.target_ms == 5_200 and d.source == "tap (no voice onset nearby)"


def test_shifted_line_fits_before_the_next_one() -> None:
    moved = shift_line(ALIGNED[1], 8_000, limit_ms=8_950)
    assert moved.start_ms == 8_000 and moved.end_ms <= 8_950
    assert [w.text for w in moved.words] == [w.text for w in ALIGNED[1].words]


def test_diagnose_finds_a_quieter_voice_before_the_tap(tmp_path: Path) -> None:
    rows = diagnose_line(2, ALIGNED[1], ALIGNED[0], 5_400, VOICE, SR, tmp_path)
    text = "\n".join(rows)
    assert "tapped [00:05.40]" in text and "difference -3000 ms" in text
    assert "best guess: a short, quiet sound" in text  # the 0.3 s burst at 2.3 s, 16 dB quieter
    assert (tmp_path / "line02-aligned.wav").exists() and (tmp_path / "line02-tapped.wav").exists()
    chart_line = next(r for r in rows if r.strip().startswith("|") and ("A" in r or "T" in r))
    assert "A" in chart_line and "T" in chart_line


def test_guess_labels() -> None:
    tail = Burst(2_050, 2_900, -3.0, decays=True)
    full = Burst(5_200, 7_000, 0.0, decays=False)
    assert "reverb tail" in guess(tail, full, previous_end_ms=2_000)
    assert "breath" in guess(Burst(2_300, 2_600, -15.0, False), full, None)
    assert "backing vocal" in guess(Burst(2_300, 3_500, -9.0, False), full, None)
    assert "no voice" in guess(None, full, None)
    assert "same burst" in guess(full, full, None)


def test_bursts_and_chart() -> None:
    env = loudness_envelope(VOICE, SR)
    ref = float(np.percentile(env, 95))
    bursts = bursts_between(env, voice_threshold(env), ref, 0, 8_000)
    assert [round(b.start_ms, -2) for b in bursts] == [1_000, 2_300, 5_200]
    levels, markers = chart(env, ref, 0, 3_000, {1_000: "A", 2_300: "T"})
    assert len(levels) == len(markers) == 30 and markers[10] == "A" and markers[23] == "T"


def test_hint_file_is_never_overwritten_and_options_parse(tmp_path: Path) -> None:
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("x")
    taps = tmp_path / "Lyrics.lrc"
    taps.write_text("[00:01.00]x\n")
    assert output_path(lyrics, None, [None, taps], tmp_path).name == "lyrics.aligned.lrc"
    args = build_parser().parse_args(["s.wav", "l.txt", "--hint", "taps.lrc", "--diagnose", "2,9"])
    assert args.hint == "taps.lrc" and args.diagnose == "2,9"


def test_low_confidence_lines_close_to_their_tap_are_kept() -> None:
    lines = [_line("One", 1_000), _line("Two", 3_000, score=0.4)]
    taps = parse_lrc("[00:01.10]One\n[00:03.20]Two\n")
    assert plan_hints(lines, compare(lines, taps), [3_000]) == []


def test_threshold_is_respected() -> None:
    lines = [_line("One", 1_000), _line("Two", 2_000, score=0.71), _line("Three", 9_000)]
    taps = parse_lrc("[00:01.00]One\n[00:05.00]Two\n[00:09.00]Three\n")
    assert plan_hints(lines, compare(lines, taps), [5_000]) == []  # 0.71 is above 0.7: not touched
    assert pytest.approx(0.7) == HINT_CONFIDENCE
