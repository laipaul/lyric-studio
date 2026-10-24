"""Beat analysis on synthetic click tracks with known tempo and downbeats."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.analysis import analyze_file, estimate_downbeat_phase
from tests.synth import click_track, drum_track

TOLERANCE_S = 0.05  # a detected beat must be within 50 ms of the real one


def _check(
    result: dict, beat_times: list[float], downbeats: list[float], bpm: float, min_confidence: float = 0.4
) -> None:
    assert abs(result["bpm"] - bpm) <= 1, f"BPM {result['bpm']} is not within 1 of {bpm}"

    detected = [b["time_ms"] / 1000 for b in result["beats"]]
    assert len(detected) >= len(beat_times) - 2  # librosa may trim a weak first/last beat
    for t in detected:
        assert min(abs(t - real) for real in beat_times) <= TOLERANCE_S

    found_downbeats = [b["time_ms"] / 1000 for b in result["beats"] if b["is_downbeat"]]
    assert len(found_downbeats) >= len(downbeats) - 1
    for t in found_downbeats:
        assert min(abs(t - real) for real in downbeats) <= TOLERANCE_S, f"{t:.3f}s is not a downbeat"
    assert result["downbeat_confidence"] >= min_confidence


@pytest.mark.parametrize("bpm", [90, 120, 128])
def test_click_track_bpm_and_downbeats(tmp_path: Path, bpm: int) -> None:
    # The track starts with one upbeat, so the first beat is NOT a downbeat.
    beat_times, downbeats = click_track(tmp_path / f"click_{bpm}.wav", bpm)
    result = analyze_file(tmp_path / f"click_{bpm}.wav")

    _check(result, beat_times, downbeats, bpm)
    assert result["bpm_source"] == "detected"
    assert result["bpm_alternatives"] == {"half": pytest.approx(bpm / 2, abs=0.5), "double": pytest.approx(bpm * 2, abs=1)}
    assert result["beats"][0]["is_downbeat"] is False
    assert abs(result["duration_ms"] - (beat_times[-1] + 1.0) * 1000) <= 5
    assert all(0 <= b["strength"] <= 1 for b in result["beats"])


@pytest.mark.parametrize("bpm, pickup", [(120, 0), (128, 3)])
def test_downbeat_phase_follows_the_kick(tmp_path: Path, bpm: int, pickup: int) -> None:
    beat_times, downbeats = click_track(tmp_path / "c.wav", bpm, pickup_beats=pickup)
    _check(analyze_file(tmp_path / "c.wav"), beat_times, downbeats, bpm)


def test_long_song_bpm_stays_exact(tmp_path: Path) -> None:
    # 100 bars (over 3 minutes): small timing errors must not add up into a wrong BPM.
    beat_times, downbeats = click_track(tmp_path / "long.wav", 128, bars=100)
    result = analyze_file(tmp_path / "long.wav")
    _check(result, beat_times, downbeats, 128)
    assert abs(result["bpm"] - 128) <= 0.1


def test_realistic_groove_with_kick_on_one_and_three(tmp_path: Path) -> None:
    # Kick on 1 and 3 makes beat 1 and beat 3 look alike; the bass note change on beat 1 decides.
    beat_times, downbeats = drum_track(tmp_path / "groove.wav", 95)
    _check(analyze_file(tmp_path / "groove.wav"), beat_times, downbeats, 95, min_confidence=0.1)


def test_mp3_input(tmp_path: Path) -> None:
    beat_times, downbeats = click_track(tmp_path / "c.mp3", 120, fmt="MP3")
    _check(analyze_file(tmp_path / "c.mp3"), beat_times, downbeats, 120)


def test_manual_bpm_half_keeps_the_strong_beats(tmp_path: Path) -> None:
    beat_times, downbeats = click_track(tmp_path / "c.wav", 120)
    result = analyze_file(tmp_path / "c.wav", bpm=60)

    assert result["bpm_source"] == "manual"
    assert abs(result["bpm"] - 60) <= 1
    times = [b["time_ms"] / 1000 for b in result["beats"]]
    # Every other click, and it must be the ones with the kick (beats 1 and 3 of each bar).
    on_kicks = [t for t in times if min(abs(t - d) for d in downbeats) <= TOLERANCE_S]
    assert len(on_kicks) >= len(downbeats) - 1


def test_manual_bpm_double_adds_beats_in_between(tmp_path: Path) -> None:
    click_track(tmp_path / "c.wav", 70)
    result = analyze_file(tmp_path / "c.wav", bpm=140)
    assert abs(result["bpm"] - 140) <= 1
    assert len(result["beats"]) >= 2 * 64 - 4


def test_manual_bpm_near_detected_is_refined(tmp_path: Path) -> None:
    click_track(tmp_path / "c.wav", 128)
    result = analyze_file(tmp_path / "c.wav", bpm=130)  # user typed 130, song is 128
    assert abs(result["bpm"] - 128) <= 1
    assert result["bpm_source"] == "manual"


def test_manual_bpm_out_of_range(tmp_path: Path) -> None:
    click_track(tmp_path / "c.wav", 120, bars=2)
    with pytest.raises(ValueError):
        analyze_file(tmp_path / "c.wav", bpm=500)


def test_downbeat_phase_estimator() -> None:
    strong_third = [0.2, 0.3, 1.0, 0.25] * 8
    assert estimate_downbeat_phase(strong_third)[0] == 2
    phase, confidence = estimate_downbeat_phase([0.5] * 32)
    assert confidence == 0
    assert estimate_downbeat_phase([1.0, 0.1, 0.1])[1] == 0  # too few beats to tell
