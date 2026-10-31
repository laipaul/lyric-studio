"""The loudness of a song's vocal track, for the vocal-start guard of pnpm make.

python -m app.voice_map <song> --out voice.json

Uses the Suno vocal stem (vocals.wav, lined up on the song: app/vocal_stem.py; --stem) when it follows
the song, else the cached Demucs stem (the same one pnpm align made); only when that is not cached is
Demucs run, never the aligner (WhisperX). Writes {"version": 2, "hop_ms": 20, "db": [...]}: the level
of the vocal track every 20 ms (dB of full scale, rounded to 0.5 dB, at least -100). pnpm make decides
what counts as singing (relative to the song's own singing level). Exit code 3: no cached stem and the
AI packages are missing.
"""

from __future__ import annotations

from . import ai_env  # noqa: F401  (must come first: model folders inside the project)

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from .ai_env import Device, choose_device
from .cache import file_hash
from .config import workspace_dir

VERSION = 2
HOP_MS = 20
WINDOW_MS = 40
FLOOR_DB = -100.0


def level_db(audio: np.ndarray, sample_rate: int) -> list[float]:
    """RMS level every HOP_MS (WINDOW_MS windows), in dB of full scale, rounded to 0.5 dB."""
    hop = int(sample_rate * HOP_MS / 1000)
    win = int(sample_rate * WINDOW_MS / 1000)
    if len(audio) < win:
        return []
    frames = 1 + (len(audio) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    rms = np.sqrt(np.mean(audio[idx].astype(np.float64) ** 2, axis=1))
    db = np.maximum(FLOOR_DB, 20 * np.log10(np.maximum(rms, 1e-12)))
    return [round(float(v) * 2) / 2 for v in db]


def stem_cached(song: Path) -> bool:
    from .align import SEPARATION_MODEL

    return (workspace_dir() / "cache" / "stems" / f"{file_hash(song)}-{SEPARATION_MODEL}-vocals.wav").exists()


def voice_map(vocals: Path, source: dict | None = None) -> dict:
    import librosa

    from .align import ALIGN_SAMPLE_RATE

    voice, _ = librosa.load(str(vocals), sr=ALIGN_SAMPLE_RATE, mono=True)
    return {"version": VERSION, "stem": vocals.name, **({"voice": source} if source else {}), "hop_ms": HOP_MS, "db": level_db(voice, ALIGN_SAMPLE_RATE)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voice_map")
    parser.add_argument("song")
    parser.add_argument("--out", required=True)
    parser.add_argument("--stem", default="auto", help='the Suno vocal stem: a file, "none" (Demucs) or "auto" (vocals.wav next to the song)')
    args = parser.parse_args(argv)
    from .align import separate_vocals
    from .vocal_stem import stem_argument, stem_track

    song = Path(args.song).resolve()
    log = lambda m: print(m, flush=True)  # noqa: E731
    # The Suno stem needs no PyTorch at all (only reading and lining up).
    vocals, source = stem_track(song, stem_argument(song, args.stem), log)
    try:
        # A cached stem needs no device (and no PyTorch); otherwise Demucs runs on the GPU if there is one.
        device = Device("cpu", "CPU")
        if vocals is None and not stem_cached(song):
            import torch

            device = choose_device(torch)
        if vocals is None:
            vocals, _ = separate_vocals(song, device, log)
    except ImportError:
        print("The vocal track of this song is not cached and the AI packages are not installed: install them with pnpm audio:setup --ai.", file=sys.stderr)
        return 3
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    tmp.write_text(json.dumps(voice_map(vocals, source.as_dict())), encoding="utf-8")
    tmp.replace(out)
    print(f"voice map: {len(json.loads(out.read_text(encoding='utf-8'))['db'])} levels ({HOP_MS} ms apart)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
