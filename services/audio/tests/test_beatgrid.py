"""Downbeat offset, click-track file and how /analyze stores the offset."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.beatgrid import apply_downbeat_offset, click_path_for, write_click_track
from app.cli import main as cli_main
from app.main import app
from tests.conftest import insert_project
from tests.synth import click_track

client = TestClient(app)


def _beats(n: int, first_downbeat: int, period_ms: int = 500) -> list[dict]:
    return [
        {"time_ms": 500 + i * period_ms, "strength": 1.0, "is_downbeat": i >= first_downbeat and (i - first_downbeat) % 4 == 0}
        for i in range(n)
    ]


def _downbeat_indexes(beats: list[dict]) -> list[int]:
    return [i for i, b in enumerate(beats) if b["is_downbeat"]]


def test_downbeat_offset_shifts_bar_one() -> None:
    beats = _beats(16, first_downbeat=1)
    assert _downbeat_indexes(apply_downbeat_offset(beats, 0)) == [1, 5, 9, 13]
    assert _downbeat_indexes(apply_downbeat_offset(beats, 1)) == [2, 6, 10, 14]
    assert _downbeat_indexes(apply_downbeat_offset(beats, 3)) == [0, 4, 8, 12]  # wraps within the bar
    with pytest.raises(ValueError):
        apply_downbeat_offset(beats, 4)


def test_click_track_marks_beats_and_downbeats(tmp_path: Path) -> None:
    # A silent stereo "song": the output is then only the clicks.
    sr = 44100
    song = tmp_path / "quiet song.wav"
    sf.write(str(song), np.zeros((sr * 5, 2), dtype=np.float32), sr)
    beats = _beats(8, first_downbeat=2)

    out = write_click_track(song, beats)
    assert out == tmp_path / "quiet song_click.wav" == click_path_for(song)
    audio, out_sr = sf.read(str(out), always_2d=True)
    assert out_sr == sr and audio.shape == (sr * 5, 2)

    def peak_near(ms: int) -> float:
        start = int(ms / 1000 * sr)
        return float(np.abs(audio[start : start + int(0.06 * sr), 0]).max())

    for i, b in enumerate(beats):
        expected = 0.8 if b["is_downbeat"] else 0.35
        assert peak_near(b["time_ms"]) == pytest.approx(expected, abs=0.05), f"beat {i}"
    # Silence between beats.
    assert peak_near(500 + 250) < 0.01


def test_click_track_keeps_the_music(tmp_path: Path) -> None:
    beat_times, _ = click_track(tmp_path / "song.wav", 120, bars=4)
    out = write_click_track(tmp_path / "song.wav", _beats(17, first_downbeat=1))
    original, _ = sf.read(str(tmp_path / "song.wav"))
    mixed, _ = sf.read(str(out))
    assert len(mixed) == len(original)
    assert np.abs(mixed).max() <= 1.0


def test_cli_click_and_offset(tmp_path: Path, workspace: Path, capsys: pytest.CaptureFixture[str]) -> None:
    click_track(tmp_path / "song.wav", 120, bars=8, pickup_beats=1)
    assert cli_main([str(tmp_path / "song.wav"), "--click", "--downbeat-offset", "2"]) == 0
    printed = capsys.readouterr().out
    assert "offset 2" in printed
    assert (tmp_path / "song_click.wav").exists()
    # Detected bar 1 is beat 2 (after the pickup); offset 2 moves it to beat 4.
    first_bar_line = next(line for line in printed.splitlines() if "(bar 1)" in line)
    assert first_bar_line.split()[0] == "4"


def test_analyze_saves_and_applies_the_project_offset(workspace: Path, database: Path) -> None:
    folder = workspace / "projects" / "p" / "audio"
    folder.mkdir(parents=True)
    click_track(folder / "song.wav", 120, bars=8, pickup_beats=1)
    project_id = insert_project(database)
    path = "projects/p/audio/song.wav"

    detected = client.post("/analyze", json={"path": path, "project_id": project_id}).json()
    assert detected["downbeat_offset"] == 0
    first = _downbeat_indexes(detected["beats"])[0]

    shifted = client.post("/analyze", json={"path": path, "project_id": project_id, "downbeat_offset": 1}).json()
    assert shifted["downbeat_offset"] == 1
    assert _downbeat_indexes(shifted["beats"])[0] == (first + 1) % 4

    # Saved on the project and used next time without asking...
    again = client.post("/analyze", json={"path": path, "project_id": project_id}).json()
    assert again["downbeat_offset"] == 1
    assert again["beats"] == shifted["beats"]

    conn = sqlite3.connect(database)
    assert conn.execute("SELECT downbeat_offset FROM project WHERE id = ?", (project_id,)).fetchone()[0] == 1
    # ...while the Beat table keeps the detected downbeats.
    stored = [r[0] for r in conn.execute("SELECT is_downbeat FROM beat WHERE project_id = ? ORDER BY time_ms", (project_id,))]
    conn.close()
    assert [i for i, d in enumerate(stored) if d][0] == first

    assert client.post("/analyze", json={"path": path, "downbeat_offset": 4}).status_code == 422
