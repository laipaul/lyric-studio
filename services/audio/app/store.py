"""Saves an analysis into the Project and Beat tables (created by packages/db migrations)."""

from __future__ import annotations

import sqlite3
from typing import Any

from .config import db_path


class ProjectNotFound(Exception):
    pass


class DatabaseMissing(Exception):
    pass


def save_analysis(project_id: str, result: dict[str, Any]) -> None:
    """Sets project.bpm and project.duration_ms and replaces the project's beats, all in one
    transaction (either everything is saved or nothing is)."""
    path = db_path()
    if not path.exists():
        raise DatabaseMissing(f"database not found at {path} (run: pnpm db:setup)")

    conn = sqlite3.connect(path, timeout=10)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
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
