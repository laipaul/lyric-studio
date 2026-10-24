"""Workspace location, shared with the Node side: WORKSPACE_DIR in the project's .env
(default ./workspace), relative paths resolved from the project root."""

import os
from pathlib import Path

from dotenv import load_dotenv


def _find_repo_root(start: Path) -> Path:
    for folder in [start, *start.parents]:
        if (folder / "pnpm-workspace.yaml").exists():
            return folder
    raise RuntimeError("Could not find the project root (pnpm-workspace.yaml).")


REPO_ROOT = _find_repo_root(Path(__file__).resolve().parent)

# Values already set in the environment win over .env.
load_dotenv(REPO_ROOT / ".env", override=False)

DEFAULT_WORKSPACE_DIR = "./workspace"
DB_FILENAME = "studio.db"


def workspace_dir() -> Path:
    raw = (os.environ.get("WORKSPACE_DIR") or "").strip() or DEFAULT_WORKSPACE_DIR
    return (REPO_ROOT / raw).resolve()


def db_path() -> Path:
    return workspace_dir() / DB_FILENAME


def cache_dir() -> Path:
    return workspace_dir() / "cache" / "analysis"


def resolve_workspace_path(relative: str) -> Path:
    """Turns a workspace-relative path ("projects/<id>/audio/song.wav") into a full path.
    Raises ValueError for absolute paths or paths that point outside the workspace."""
    cleaned = relative.strip().replace("\\", "/")
    if not cleaned or cleaned.startswith("/") or (len(cleaned) > 1 and cleaned[1] == ":"):
        raise ValueError("path must be relative to the workspace folder")
    root = workspace_dir()
    full = (root / cleaned).resolve()
    if not full.is_relative_to(root):
        raise ValueError("path points outside the workspace folder")
    return full
