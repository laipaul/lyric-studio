"""Saves an analysis into the Project and Beat tables (created by packages/db migrations)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from .config import db_path, workspace_dir


class ProjectNotFound(Exception):
    pass


class DatabaseMissing(Exception):
    pass


class DatabaseOutdated(Exception):
    """The database exists but its migrations have not been applied yet."""


def _connect():
    path = db_path()
    if not path.exists():
        raise DatabaseMissing(f"database not found at {path} (run: pnpm db:setup)")
    conn = sqlite3.connect(path, timeout=10)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def find_project_by_audio(audio: Path) -> dict[str, Any] | None:
    """The project whose song is this file (projects store workspace-relative audio paths)."""
    if not db_path().exists():
        return None
    try:
        relative = audio.resolve().relative_to(workspace_dir()).as_posix()
    except ValueError:
        return None  # not inside the workspace
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, title, downbeat_offset FROM project WHERE audio_path = ?", (relative,)
        ).fetchone()
        return dict(row) if row else None
    except sqlite3.OperationalError as error:
        raise DatabaseOutdated("the database needs updating (run: pnpm db:setup)") from error
    finally:
        conn.close()


def get_downbeat_offset(project_id: str) -> int:
    conn = _connect()
    try:
        row = conn.execute("SELECT downbeat_offset FROM project WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise ProjectNotFound(project_id)
        return int(row[0])
    finally:
        conn.close()


def set_downbeat_offset(project_id: str, offset: int) -> None:
    conn = _connect()
    try:
        with conn:
            if conn.execute("UPDATE project SET downbeat_offset = ? WHERE id = ?", (offset, project_id)).rowcount == 0:
                raise ProjectNotFound(project_id)
    finally:
        conn.close()


def save_analysis(project_id: str, result: dict[str, Any]) -> None:
    """Sets project.bpm and project.duration_ms and replaces the project's beats, all in one
    transaction (either everything is saved or nothing is). Beats are stored as detected; the
    project's downbeat_offset is applied when they are read."""
    conn = _connect()
    try:
        with conn:  # commits on success, rolls back on error
            updated = conn.execute(
                "UPDATE project SET bpm = ?, duration_ms = ? WHERE id = ?",
                (result["bpm"], result["duration_ms"], project_id),
            ).rowcount
            if updated == 0:
                raise ProjectNotFound(project_id)
            conn.execute("DELETE FROM beat WHERE project_id = ?", (project_id,))
            conn.executemany(
                "INSERT INTO beat (project_id, time_ms, strength, is_downbeat) VALUES (?, ?, ?, ?)",
                [(project_id, b["time_ms"], b["strength"], 1 if b["is_downbeat"] else 0) for b in result["beats"]],
            )
    finally:
        conn.close()
