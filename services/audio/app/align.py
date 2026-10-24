"""pnpm align <song> <lyrics.txt> [--lang en|fr] [--compare reference.lrc] [--out file.lrc]

Writes <lyrics>.lrc automatically: Demucs (htdemucs) separates the vocals, then WhisperX forced
alignment (wav2vec2) places every word of the known lyrics on the vocal track. Output is standard
LRC per line with enhanced word tags (<mm:ss.xx>) for future karaoke effects. "* " hook markers and
blank-line pauses from lyrics.txt are kept.
"""

from __future__ import annotations

from . import ai_env  # noqa: F401  (must come first: model folders inside the project)

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

from .ai_env import MODELS_DIR, Device, choose_device, with_cpu_fallback
from .cache import file_hash
from .compare import Comparison, compare
from .config import workspace_dir
from .lrc import AlignedLine, Word, build_lrc, format_stamp, parse_lrc
from .refine import refine_words
from .tap import parse_lyrics_txt

LOW_CONFIDENCE = 0.5
SEPARATION_MODEL = "htdemucs"
# wav2vec2 alignment models: WhisperX's English default; for French the larger XLSR-53 model,
# which copes better with singing than WhisperX's default (VoxPopuli, parliament speech).
ALIGN_MODELS = {
    "en": "WAV2VEC2_ASR_BASE_960H",
    "fr": "jonatasgrosman/wav2vec2-large-xlsr-53-french",
}
ALIGN_SAMPLE_RATE = 16_000
FRAME_SAMPLES = 320  # wav2vec2: one output frame per 20 ms
ALIGN_CACHE_VERSION = 4  # bump when the alignment method changes (4: strongest voice burst per long word)


# --------------------------------------------------------------------------- output helpers

def _colour(text: str, code: str) -> str:
    if os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        return text
    return f"\x1b[{code}m{text}\x1b[0m"


def orange(text: str) -> str:
    return _colour(text, "38;5;208")


def clock(ms: int) -> str:
    return format_stamp(ms)[1:-1]


# --------------------------------------------------------------------------- vocals (Demucs)

def separate_vocals(song: Path, device: Device, log: Callable[[str], None]) -> tuple[Path, Device]:
    """Vocal stem of the song, cached by the song's content hash in <workspace>/cache/stems/."""
    import numpy as np
    import soundfile as sf

    stems = workspace_dir() / "cache" / "stems"
    out = stems / f"{file_hash(song)}-{SEPARATION_MODEL}-vocals.wav"
    if out.exists():
        log(f"vocals: cached ({out.name})")
        return out, device

    import torch
    from demucs.api import Separator

    audio, sr = sf.read(str(song), always_2d=True, dtype="float32")
    wav = torch.from_numpy(np.ascontiguousarray(audio.T))

    def run(device_name: str):
        log(f"separating the vocals with Demucs {SEPARATION_MODEL} on {device_name.upper()} (model downloads on first use)")
        separator = Separator(model=SEPARATION_MODEL, device=device_name, progress=True)
        _, stems_ = separator.separate_tensor(wav, sr)
        return stems_["vocals"].cpu().numpy().T, separator.samplerate

    (vocals, rate), device = with_cpu_fallback(device, "Vocal separation", run, log)
    stems.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.wav")
    sf.write(str(tmp), vocals, rate, subtype="FLOAT")
    os.replace(tmp, out)
    return out, device


# --------------------------------------------------------------------------- alignment (WhisperX)

def chunked_model(model: Any, kind: str, chunk_s: float = 30.0, context_s: float = 2.0):
    """Wraps a wav2vec2 model so long audio is processed in overlapping windows (memory stays small,
    an 8 GB GPU is plenty) while the output has exactly one frame per 20 ms, as WhisperX expects."""
    import torch

    chunk = int(chunk_s * ALIGN_SAMPLE_RATE / FRAME_SAMPLES)  # frames per window
    context = int(context_s * ALIGN_SAMPLE_RATE / FRAME_SAMPLES)

    class Chunked(torch.nn.Module):
        def forward(self, waveform, **_kwargs):
            total = -(-waveform.shape[-1] // FRAME_SAMPLES)  # frames for the whole audio
            parts = []
            with torch.inference_mode():
                for a in range(0, total, chunk):
                    b = min(total, a + chunk)
                    ws = max(0, a - context)
                    we = min(total, b + context)
                    piece = waveform[..., ws * FRAME_SAMPLES : we * FRAME_SAMPLES]
                    if piece.shape[-1] < 400:  # the model needs at least 25 ms
                        piece = torch.nn.functional.pad(piece, (0, 400 - piece.shape[-1]))
                    out = model(piece)
                    logits = out[0] if kind == "torchaudio" else out.logits
                    frames = logits[:, a - ws : a - ws + (b - a)]
                    if frames.shape[1] < b - a:  # last window: repeat the final frame
                        frames = torch.cat([frames, frames[:, -1:].expand(-1, b - a - frames.shape[1], -1)], dim=1)
                    parts.append(frames)
            emissions = torch.cat(parts, dim=1)
            if kind == "torchaudio":
                return emissions, None

            class Output:
                logits = emissions

            return Output()

    return Chunked()


def ensure_nltk_data(log: Callable[[str], None]) -> None:
    """WhisperX splits sentences with NLTK's punkt tokenizer; keep its data in the models folder."""
    import nltk

    target = Path(os.environ["NLTK_DATA"])
    if str(target) not in nltk.data.path:
        nltk.data.path.insert(0, str(target))
    try:
        nltk.data.find("tokenizers/punkt_tab")
    except LookupError:
        log("downloading NLTK sentence data (small, first use only)")
        nltk.download("punkt_tab", download_dir=str(target), quiet=True)


def align_words(
    vocals: Path,
    text: str,
    language: str,
    model_name: str,
    device: Device,
    log: Callable[[str], None],
    trim: bool = True,
):
    """WhisperX forced alignment of `text` against the vocal track. Returns (words, device).
    With `trim`, words that swallowed a silent gap start where the voice starts (app/refine.py)."""
    import librosa
    import whisperx

    ensure_nltk_data(log)
    audio, _ = librosa.load(str(vocals), sr=ALIGN_SAMPLE_RATE, mono=True)
    duration = len(audio) / ALIGN_SAMPLE_RATE

    def run(device_name: str):
        log(f"aligning the lyrics with {model_name} on {device_name.upper()} (model downloads on first use)")
        model, metadata = whisperx.load_align_model(
            language, device_name, model_name=model_name, model_dir=str(MODELS_DIR / "align")
        )
        wrapped = chunked_model(model, metadata["type"])
        result = whisperx.align(
            [{"text": text, "start": 0.0, "end": duration}],
            wrapped,
            metadata,
            audio,
            device_name,
            return_char_alignments=False,
        )
        return result["word_segments"]

    words, device = with_cpu_fallback(device, "Alignment", run, log)
    return (refine_words(words, audio, ALIGN_SAMPLE_RATE) if trim else words), device


def words_to_lines(texts: list[str], hooks: list[bool], words: list[dict]) -> list[AlignedLine]:
    """Gives each lyric line its aligned words (WhisperX splits the text on spaces, in order).
    Words the model could not place get the time of their neighbours and a score of 0."""
    tokens = [t.split() for t in texts]
    flat = [w for line in tokens for w in line]
    if len(words) != len(flat):
        words = match_words(flat, words)
    # Fill missing times from the nearest placed word (before, else after).
    starts = [w.get("start") for w in words]
    ends = [w.get("end") for w in words]
    for i in range(len(words)):
        if starts[i] is None:
            prev = next((ends[k] for k in range(i - 1, -1, -1) if ends[k] is not None), None)
            nxt = next((starts[k] for k in range(i + 1, len(words)) if starts[k] is not None), None)
            starts[i] = prev if prev is not None else (nxt if nxt is not None else 0.0)
        if ends[i] is None:
            ends[i] = starts[i]
    out: list[AlignedLine] = []
    k = 0
    for text, hook, line_tokens in zip(texts, hooks, tokens):
        line = AlignedLine(text=text, is_hook=hook)
        for token in line_tokens:
            score = words[k].get("score")
            line.words.append(Word(token, round(starts[k] * 1000), round(max(ends[k], starts[k]) * 1000), float(score) if score is not None else 0.0))
            k += 1
        out.append(line)
    return out


def match_words(flat: list[str], words: list[dict]) -> list[dict]:
    """Fallback when the aligner returned a different number of words: pair them by their text."""
    from difflib import SequenceMatcher

    from .lrc import normalize_lyric

    out: list[dict] = [{"word": w} for w in flat]
    matcher = SequenceMatcher(a=[normalize_lyric(w) for w in flat], b=[normalize_lyric(w.get("word", "")) for w in words], autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            out[block.a + k] = words[block.b + k]
    return out


def output_path(lyrics: Path, out: str | None, reference: Path | None, cwd: Path) -> Path:
    """<lyrics>.lrc, unless that is the --compare reference (on Windows lyrics.lrc and Lyrics.lrc
    are the same file): then <lyrics>.aligned.lrc, so the reference is never overwritten."""
    target = (cwd / out).resolve() if out else lyrics.with_suffix(".lrc")
    if reference is not None and same_file(target, reference):
        target = lyrics.with_name(f"{lyrics.stem}.aligned.lrc")
    return target


def same_file(a: Path, b: Path) -> bool:
    if a.exists() and b.exists():
        return os.path.samefile(a, b)
    return os.path.normcase(str(a.resolve())).lower() == os.path.normcase(str(b.resolve())).lower()


# --------------------------------------------------------------------------- report

def print_lines(lines: list[AlignedLine], comparison: Comparison | None) -> None:
    print()
    print("    #   time       conf   line")
    for n, line in enumerate(lines, start=1):
        row = f"  {n:>3}   {clock(line.start_ms)}   {line.confidence:.2f}   {'* ' if line.is_hook else ''}{line.text}"
        if line.confidence < LOW_CONFIDENCE:
            tapped = comparison.tapped_for(n) if comparison else None
            extra = f"   (tapped {clock(tapped)})" if tapped is not None else ""
            print(orange(f"{row}{extra}   <- low confidence"))
        else:
            print(row)
    low = [n for n, l in enumerate(lines, start=1) if l.confidence < LOW_CONFIDENCE]
    if low:
        print()
        print(orange(f"{len(low)} line(s) below {LOW_CONFIDENCE} confidence: {', '.join(map(str, low))}."))
        print(orange("  Check them by ear (pnpm analyze <song> --click helps), then re-tap them with pnpm tap, or edit"))
        print(orange("  their [mm:ss.xx] stamp in the .lrc (with --compare, your tapped time is shown next to them)."))


def print_comparison(c: Comparison, reference: Path) -> None:
    print()
    print(f"Compared with {reference.name}: {len(c.rows)} lines matched")
    if not c.rows:
        return
    print()
    print("    #   tapped     aligned    diff ms   line")
    for r in c.rows:
        print(f"  {r.number:>3}   {clock(r.tapped_ms)}   {clock(r.aligned_ms)}   {r.diff_ms:>+7}   {r.text}")
    print()
    print(f"Median difference (absolute): {c.median_abs_ms:.0f} ms")
    print(f"Typical offset: {c.typical_offset_ms:+.0f} ms (alignment minus taps; negative = your taps are later)")
    if abs(c.shift_suggestion_s) >= 0.05:
        print(f'  To move your taps onto the alignment: pnpm lrc:shift "{reference}" {c.shift_suggestion_s:+.2f}')
    print("Worst 5:")
    for r in c.worst(5):
        print(f"  line {r.number:>3}: {r.diff_ms:+6} ms   (tapped {clock(r.tapped_ms)}, aligned {clock(r.aligned_ms)})   {r.text}")
    for text in c.missing_in_alignment:
        print(f"  only in {reference.name}: {text}")
    for text in c.missing_in_reference:
        print(f"  not in {reference.name}: {text}")


# --------------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pnpm align", description="Align known lyrics to a song automatically.")
    p.add_argument("song")
    p.add_argument("lyrics", help='lyrics.txt: one line per lyric line, blank line = pause, "* " = hook')
    p.add_argument("--lang", choices=sorted(ALIGN_MODELS), default="en")
    p.add_argument("--compare", metavar="REFERENCE.lrc", help="compare with a hand-tapped LRC")
    p.add_argument("--out", help="output .lrc (default: next to lyrics.txt)")
    p.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    p.add_argument("--align-model", help="another wav2vec2 alignment model (torchaudio or Hugging Face name)")
    p.add_argument(
        "--trim",
        choices=["on", "off"],
        default="on",
        help="move words that swallowed a silent gap to where the voice starts (default on)",
    )
    p.add_argument("--cwd", help=argparse.SUPPRESS)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path(args.cwd or os.getcwd())
    resolve = lambda p: (cwd / p).resolve()  # noqa: E731
    song, lyrics = resolve(args.song), resolve(args.lyrics)
    reference = resolve(args.compare) if args.compare else None
    for f in [song, lyrics, *( [reference] if reference else [])]:
        if not f.is_file():
            print(f"File not found: {f}", file=sys.stderr)
            return 1

    items = parse_lyrics_txt(lyrics.read_text(encoding="utf-8-sig"))
    line_items = [i for i in items if i.kind == "line"]
    texts = [i.text[2:].strip() if i.text.startswith("* ") else i.text for i in line_items]
    hooks = [i.text.startswith("* ") for i in line_items]
    model_name = args.align_model or ALIGN_MODELS[args.lang]
    log = lambda m: print(f"  {m}", flush=True)  # noqa: E731

    started = time.time()
    import torch

    device = choose_device(torch, args.device)
    print(f"Device:  {device.description}")
    print(f"Song:    {song}")
    print(f"Lyrics:  {len(texts)} lines from {lyrics.name} ({args.lang}, gap trim {args.trim})")

    vocals, device = separate_vocals(song, device, log)

    # Cache: same vocals + same lyrics + same model = same alignment.
    key = hashlib.sha256(
        f"v{ALIGN_CACHE_VERSION}|trim-{args.trim}|{vocals.name}|{model_name}|{json.dumps(texts)}".encode()
    ).hexdigest()[:24]
    cache = workspace_dir() / "cache" / "align" / f"{key}.json"
    if cache.exists():
        log("alignment: cached")
        words = json.loads(cache.read_text(encoding="utf-8"))
    else:
        words, device = align_words(vocals, " ".join(texts), args.lang, model_name, device, log, trim=args.trim == "on")
        words = [{k: (float(v) if k in ("start", "end", "score") and v is not None else v) for k, v in w.items()} for w in words]
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(words), encoding="utf-8")

    aligned = words_to_lines(texts, hooks, words)
    lines_iter = iter(aligned)
    ordered = [("line", next(lines_iter)) if i.kind == "line" else ("pause", None) for i in items if i.kind != "end"]

    import soundfile as sf

    duration_ms = int(sf.info(str(song)).duration * 1000)
    out = output_path(lyrics, args.out, reference, cwd)
    if out.exists():
        out.with_suffix(".lrc.bak").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    out.write_text(
        build_lrc(ordered, duration_ms, header=["[ar:Life Lyrics]", f"[re:Lyric Studio - pnpm align ({model_name})]"]),
        encoding="utf-8",
    )

    comparison = compare(aligned, parse_lrc(reference.read_text(encoding="utf-8-sig"))) if reference else None
    print_lines(aligned, comparison)
    if comparison and reference:
        print_comparison(comparison, reference)
    print()
    if reference and out.name.endswith(".aligned.lrc"):
        print(f"Note: {reference.name} is your reference, so the result was written to {out.name} instead.")
    print(f"Saved {len(aligned)} lines with word timings to {out}   ({time.time() - started:.0f} s, {device.description})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
