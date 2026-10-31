"""The words actually sung where a line should start, for the vocal-start check of pnpm make.

python -m app.first_words <song> --windows '[[1, 0, 20000], [31, 118000, 140000]]' --lang en --out words.json

A short speech-recognition pass (faster-whisper, the one pnpm align's WhisperX uses, model "small" by
default: FIRST_WORDS_MODEL) on the vocal track (the Suno vocal stem lined up on the song when it follows
the song (--stem), else the cached Demucs stem), only inside the given windows (line number,
from ms, to ms; at most 30 s each). It never re-aligns the lyrics. Writes {"version": 1, "model": ...,
"windows": [{"line": 1, "from_ms": 0, "to_ms": 20000, "words": [{"text", "start_ms", "end_ms",
"prob"}]}]}. Exit code 3: the AI packages are not installed (or the vocal stem is missing and Demucs
cannot run).
"""

from __future__ import annotations

from . import ai_env  # noqa: F401  (must come first: model folders inside the project)

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .ai_env import MODELS_DIR, Device, choose_device

SAMPLE_RATE = 16_000
MAX_WINDOW_MS = 30_000
VERSION = 1

# (audio 16 kHz mono float32, language) -> [(text, start_s, end_s, prob)]
Transcriber = Callable[[np.ndarray, str], list[tuple[str, float, float, float]]]


def whisper_transcriber(model_name: str, device: Device, log: Callable[[str], None] = print) -> Transcriber:
    """faster-whisper on the GPU when there is one; any CUDA problem (on Windows often a missing cuBLAS /
    cuDNN library for CTranslate2) falls back to the CPU, which is fast enough for these short windows."""
    from faster_whisper import WhisperModel

    def load(on_gpu: bool):
        return WhisperModel(
            model_name,
            device="cuda" if on_gpu else "cpu",
            compute_type="float16" if on_gpu else "int8",
            download_root=str(MODELS_DIR / "faster-whisper"),
        )

    def words(model: Any, audio: np.ndarray, lang: str) -> list[tuple[str, float, float, float]]:
        segments, _ = model.transcribe(audio, language=lang, word_timestamps=True, beam_size=5, condition_on_previous_text=False, vad_filter=False)
        return [(w.word.strip(), float(w.start), float(w.end), float(w.probability)) for s in segments for w in (s.words or [])]

    state: dict[str, Any] = {"gpu": device.is_gpu}
    try:
        state["model"] = load(state["gpu"])
    except Exception as error:  # noqa: BLE001 - any CUDA failure: use the CPU
        if not state["gpu"]:
            raise
        log(f"first words: the GPU could not be used ({error}); using the CPU")
        state["gpu"] = False
        state["model"] = load(False)

    def run(audio: np.ndarray, lang: str) -> list[tuple[str, float, float, float]]:
        try:
            return words(state["model"], audio, lang)
        except Exception as error:  # noqa: BLE001
            if not state["gpu"]:
                raise
            log(f"first words: the GPU could not be used ({error}); using the CPU")
            state["gpu"] = False
            state["model"] = load(False)
            return words(state["model"], audio, lang)

    return run


def words_in_windows(audio: np.ndarray, windows: list[tuple[int, int, int]], lang: str, transcribe: Transcriber) -> list[dict[str, Any]]:
    """Each window transcribed on its own; word times in song milliseconds."""
    out = []
    for line, from_ms, to_ms in windows:
        to_ms = min(to_ms, from_ms + MAX_WINDOW_MS)
        a, b = int(from_ms * SAMPLE_RATE / 1000), int(to_ms * SAMPLE_RATE / 1000)
        clip = np.ascontiguousarray(audio[max(0, a) : max(0, b)], dtype=np.float32)
        words = transcribe(clip, lang) if len(clip) >= SAMPLE_RATE // 2 else []
        out.append(
            {
                "line": line,
                "from_ms": from_ms,
                "to_ms": to_ms,
                "words": [
                    {"text": t, "start_ms": from_ms + round(s * 1000), "end_ms": from_ms + round(e * 1000), "prob": round(p, 3)}
                    for t, s, e, p in words
                    if t
                ],
            }
        )
    return out


def main(argv: list[str] | None = None, transcribe: Transcriber | None = None) -> int:
    parser = argparse.ArgumentParser(prog="first_words")
    parser.add_argument("song")
    parser.add_argument("--windows", required=True, help="JSON list of [line, from_ms, to_ms]")
    parser.add_argument("--lang", default="en")
    parser.add_argument("--out", required=True)
    parser.add_argument("--stem", default="auto", help='the Suno vocal stem: a file, "none" (Demucs) or "auto" (vocals.wav next to the song)')
    args = parser.parse_args(argv)
    windows = [(int(l), int(a), int(b)) for l, a, b in json.loads(args.windows)]
    model_name = os.environ.get("FIRST_WORDS_MODEL", "small")
    from .align import vocal_track
    from .vocal_stem import stem_argument

    log = lambda m: print(m, flush=True)  # noqa: E731
    try:
        device = Device("cpu", "CPU")
        if transcribe is None:
            import torch

            device = choose_device(torch)
        song = Path(args.song).resolve()
        vocals, device, source = vocal_track(song, stem_argument(song, args.stem), device, log)
        if transcribe is None:
            log(f"first words: recognising the singing in {len(windows)} short window(s) with faster-whisper {model_name} on {device.description}")
            transcribe = whisper_transcriber(model_name, device, log)
    except ImportError:
        print("The AI packages are not installed: the recognised-words check needs pnpm audio:setup --ai.", file=sys.stderr)
        return 3
    import librosa

    audio, _ = librosa.load(str(vocals), sr=SAMPLE_RATE, mono=True)
    result = {"version": VERSION, "model": model_name, "lang": args.lang, "voice": source.as_dict(), "windows": words_in_windows(audio, windows, args.lang, transcribe)}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
