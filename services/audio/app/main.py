"""Audio analysis service (FastAPI, port 8001)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .analysis import MAX_BPM, MIN_BPM
from .beatgrid import apply_downbeat_offset
from .cache import analyze_cached
from .config import resolve_workspace_path
from .store import DatabaseMissing, ProjectNotFound, get_downbeat_offset, save_analysis, set_downbeat_offset

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
    downbeat_offset: Annotated[int, Field(ge=0, le=3)] | None = Field(
        default=None,
        description="Bar 1 starts this many beats later than detected (0-3). Saved to the project if project_id is given; "
        "if left out, the project's saved offset is used.",
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
    offset = request.downbeat_offset
    if request.project_id:
        try:
            save_analysis(request.project_id, result)  # beats are stored as detected
            if offset is not None:
                set_downbeat_offset(request.project_id, offset)
            else:
                offset = get_downbeat_offset(request.project_id)
            saved = True
        except ProjectNotFound as error:
            raise HTTPException(status_code=404, detail=f"project not found: {request.project_id}") from error
        except DatabaseMissing as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    offset = offset or 0
    return {
        **result,
        "beats": apply_downbeat_offset(result["beats"], offset),
        "downbeat_offset": offset,
        "path": request.path,
        "project_id": request.project_id,
        "saved_to_project": saved,
    }
