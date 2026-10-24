"""Audio analysis service. Beat detection (librosa) arrives in a later step."""

from fastapi import FastAPI

app = FastAPI(title="Lyric Studio audio service")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "audio"}
