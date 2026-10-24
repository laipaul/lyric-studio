"""Analysis cache: one JSON file per (file content, analyser version, BPM override) in
<workspace>/cache/analysis/. The same song is never analysed twice, even if renamed or copied."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from .analysis import ANALYZER_VERSION, analyze_file
from .config import cache_dir


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cache_file(content_hash: str, bpm: float | None) -> Path:
    suffix = f"-bpm{bpm:g}" if bpm is not None else ""
    return cache_dir() / f"{content_hash}-v{ANALYZER_VERSION}{suffix}.json"


def analyze_cached(path: Path, bpm: float | None = None) -> dict[str, Any]:
    content_hash = file_hash(path)
    cached_file = _cache_file(content_hash, bpm)
    if cached_file.exists():
        try:
            result = json.loads(cached_file.read_text(encoding="utf-8"))
            return {**result, "file_hash": content_hash, "cached": True}
        except (OSError, json.JSONDecodeError):
            pass  # unreadable cache entry: analyse again and overwrite it

    result = analyze_file(path, bpm=bpm)
    cached_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = cached_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(result), encoding="utf-8")
    os.replace(tmp, cached_file)
    return {**result, "file_hash": content_hash, "cached": False}
