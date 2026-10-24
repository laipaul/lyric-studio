from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from app.config import REPO_ROOT

MIGRATIONS_DIR = REPO_ROOT / "packages" / "db" / "drizzle"


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A temporary workspace (WORKSPACE_DIR points to it), so the real one is never touched."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    monkeypatch.setenv("WORKSPACE_DIR", str(ws))
    return ws


@pytest.fixture
def database(workspace: Path) -> Path:
    """studio.db built from the same migration files the Node side uses."""
    db = workspace / "studio.db"
    conn = sqlite3.connect(db)
    for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
        for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
            if statement.strip():
                conn.execute(statement)
    conn.commit()
    conn.close()
    return db


def insert_project(db: Path, title: str = "Test song") -> str:
    project_id = str(uuid.uuid4())
    conn = sqlite3.connect(db)
    with conn:
        conn.execute(
            "INSERT INTO project (id, title, artist, created_at) VALUES (?, ?, 'Life Lyrics', 0)",
            (project_id, title),
        )
    conn.close()
    return project_id
