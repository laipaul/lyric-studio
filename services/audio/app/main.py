"""Audio analysis service (FastAPI, port 8001)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .analysis import MAX_BPM, MIN_BPM
from .cache import analyze_cached
from .config import resolve_workspace_path
from .store import DatabaseMissing, ProjectNotFound, save_analysis

app = FastAPI(title="Lyric Studio audio service")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "audio"}


class AnalyzeRequest(BaseModel):
    path: str = Field(description='Audio file relative to the workspace, e.g. "projects/<id>/audio/song.wav"')
    project_id: str | None = Field(default=None, description="If given, save BPM, duration and beats to this project")
    bpm: Annotated[float, Field(ge=MIN_BPM, le=MAX_BPM)] | None = Field(
        default=None, description="Manual BPM: re-run beat tracking around this tempo"
    )


# A plain "def" endpoint: FastAPI runs it in a worker thread, so a long analysis does not block /health.
@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        audio = resolve_workspace_path(request.path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not audio.is_file():
        raise HTTPException(status_code=404, detail=f"audio file not found: {request.path}")

    try:
        result = analyze_cached(audio, bpm=request.bpm)
    except Exception as error:  # unreadable or unsupported audio
        raise HTTPException(status_code=422, detail=f"could not analyse {request.path}: {error}") from error

    saved = False
    if request.project_id:
        try:
            save_analysis(request.project_id, result)
            saved = True
        except ProjectNotFound as error:
            raise HTTPException(status_code=404, detail=f"project not found: {request.project_id}") from error
        except DatabaseMissing as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return {**result, "path": request.path, "project_id": request.project_id, "saved_to_project": saved}
