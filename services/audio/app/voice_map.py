"""Where the voice is heard in a song (for the vocal-start guard of pnpm make).

python -m app.voice_map <song> --out voice.json

Uses the cached vocal stem (Demucs, the same one pnpm align made); only when it is not cached is
Demucs run, never the aligner (WhisperX). Writes {"stem": ..., "stretches": [[start_ms, end_ms], ...]}:
the stretches of sustained voice on the vocal track (pauses shorter than GAP_MS do not split one;
clicks and breaths shorter than MIN_VOICE_MS are left out). Exit code 3: no cached stem and the AI
packages are missing.
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
from .refine import GAP_MS, HOP_S, loudness_envelope, voice_threshold

MIN_VOICE_MS = 120
VERSION = 1


def sustained_voice(envelope: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    """(start_ms, end_ms) stretches of voice."""
    voiced = np.nonzero(envelope > threshold)[0]
    if not len(voiced):
        return []
    gap = int(GAP_MS / 1000 / HOP_S)
    runs: list[tuple[int, int]] = []
    first = prev = int(voiced[0])
    for cur in map(int, voiced[1:]):
        if cur - prev > gap:
            runs.append((first, prev))
            first = cur
        prev = cur
    runs.append((first, prev))
    to_ms = lambda f: round(f * HOP_S * 1000)  # noqa: E731
    return [(to_ms(a), to_ms(b + 1)) for a, b in runs if to_ms(b + 1) - to_ms(a) >= MIN_VOICE_MS]


def stem_cached(song: Path) -> bool:
    from .align import SEPARATION_MODEL

    return (workspace_dir() / "cache" / "stems" / f"{file_hash(song)}-{SEPARATION_MODEL}-vocals.wav").exists()


def voice_map(vocals: Path) -> dict:
    import librosa

    from .align import ALIGN_SAMPLE_RATE

    voice, _ = librosa.load(str(vocals), sr=ALIGN_SAMPLE_RATE, mono=True)
    env = loudness_envelope(voice, ALIGN_SAMPLE_RATE)
    return {"version": VERSION, "stem": vocals.name, "stretches": [list(s) for s in sustained_voice(env, voice_threshold(env))]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voice_map")
    parser.add_argument("song")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    from .align import separate_vocals

    song = Path(args.song).resolve()
    log = lambda m: print(m, flush=True)  # noqa: E731
    try:
        # A cached stem needs no device (and no PyTorch); otherwise Demucs runs on the GPU if there is one.
        device = Device("cpu", "CPU")
        if not stem_cached(song):
            import torch

            device = choose_device(torch)
        vocals, _ = separate_vocals(song, device, log)
    except ImportError:
        print("The vocal track of this song is not cached and the AI packages are not installed: install them with pnpm audio:setup --ai.", file=sys.stderr)
        return 3
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    tmp.write_text(json.dumps(voice_map(vocals)), encoding="utf-8")
    tmp.replace(out)
    print(f"voice map: {len(json.loads(out.read_text(encoding='utf-8'))['stretches'])} stretches of voice")
    return 0


if __name__ == "__main__":
    sys.exit(main())
