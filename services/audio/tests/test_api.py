"""The /analyze endpoint: path safety, caching and saving into the Project and Beat tables."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import insert_project
from tests.synth import click_track

client = TestClient(app)


@pytest.fixture
def song(workspace: Path) -> str:
    folder = workspace / "projects" / "p1" / "audio"
    folder.mkdir(parents=True)
    click_track(folder / "song.wav", 120)
    return "projects/p1/audio/song.wav"


def test_analyze_returns_bpm_duration_and_beats(song: str) -> None:
    r = client.post("/analyze", json={"path": song})
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["bpm"] - 120) <= 1
    assert body["duration_ms"] > 0
    assert {"time_ms", "strength", "is_downbeat"} <= set(body["beats"][0])
    assert body["bpm_alternatives"]["half"] == pytest.approx(60, abs=0.5)
    assert body["saved_to_project"] is False


def test_results_are_cached_by_file_content(song: str, workspace: Path) -> None:
    first = client.post("/analyze", json={"path": song}).json()
    second = client.post("/analyze", json={"path": song}).json()
    assert first["cached"] is False
    assert second["cached"] is True
    assert second["beats"] == first["beats"]
    assert len(list((workspace / "cache" / "analysis").glob(f"{first['file_hash']}-v*.json"))) == 1

    # A manual BPM is cached separately.
    manual = client.post("/analyze", json={"path": song, "bpm": 60}).json()
    assert manual["cached"] is False and manual["bpm_source"] == "manual"

    # A copy of the same song under another name hits the cache.
    copy = workspace / "projects" / "p1" / "audio" / "copy.wav"
    copy.write_bytes((workspace / song).read_bytes())
    assert client.post("/analyze", json={"path": "projects/p1/audio/copy.wav"}).json()["cached"] is True


@pytest.mark.parametrize("bad", ["../secret.wav", "projects/../../x.wav", "/etc/passwd", "C:/Windows/win.ini", ""])
def test_rejects_paths_outside_the_workspace(workspace: Path, bad: str) -> None:
    assert client.post("/analyze", json={"path": bad}).status_code == 400


def test_missing_file_and_bad_bpm(workspace: Path) -> None:
    assert client.post("/analyze", json={"path": "nope.wav"}).status_code == 404
    assert client.post("/analyze", json={"path": "nope.wav", "bpm": 1000}).status_code == 422


def test_not_audio(workspace: Path) -> None:
    (workspace / "notes.wav").write_text("this is not audio")
    assert client.post("/analyze", json={"path": "notes.wav"}).status_code == 422


def test_saves_to_project_and_beat_tables(song: str, database: Path) -> None:
    project_id = insert_project(database)
    body = client.post("/analyze", json={"path": song, "project_id": project_id}).json()
    assert body["saved_to_project"] is True

    # Run twice: beats are replaced, not duplicated.
    client.post("/analyze", json={"path": song, "project_id": project_id})

    conn = sqlite3.connect(database)
    bpm, duration_ms = conn.execute("SELECT bpm, duration_ms FROM project WHERE id = ?", (project_id,)).fetchone()
    rows = conn.execute(
        "SELECT time_ms, strength, is_downbeat FROM beat WHERE project_id = ? ORDER BY time_ms", (project_id,)
    ).fetchall()
    conn.close()

    assert bpm == body["bpm"]
    assert duration_ms == body["duration_ms"]
    assert len(rows) == len(body["beats"])
    assert [r[0] for r in rows] == [b["time_ms"] for b in body["beats"]]
    assert sum(r[2] for r in rows) == sum(b["is_downbeat"] for b in body["beats"])


def test_unknown_project(song: str, database: Path) -> None:
    r = client.post("/analyze", json={"path": song, "project_id": "does-not-exist"})
    assert r.status_code == 404


def test_project_without_database(song: str) -> None:
    r = client.post("/analyze", json={"path": song, "project_id": "x"})
    assert r.status_code == 503
    assert "pnpm db:setup" in r.json()["detail"]
