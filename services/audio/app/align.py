"""pnpm align <song> <lyrics.txt> [--lang en|fr] [--compare taps.lrc] [--hint taps.lrc] [--diagnose 2,9]
                  [--trim on|off] [--out file.lrc] [--report file.json] [--fresh]

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
from .diagnose import diagnose_line
from .hint import HINT_CONFIDENCE, HintDecision, plan_hints, shift_line, voice_onsets
from .refine import loudness_envelope, refine_words, voice_threshold
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


class Aligner:
    """WhisperX forced alignment against the vocal track. The model is loaded once (on first use) and
    can align the whole song or a single line inside a time window (used by --hint)."""

    def __init__(self, vocals: Path, language: str, model_name: str, device: Device, log: Callable[[str], None]):
        import librosa

        self.language, self.model_name, self.device, self.log = language, model_name, device, log
        self.audio, _ = librosa.load(str(vocals), sr=ALIGN_SAMPLE_RATE, mono=True)
        self.duration = len(self.audio) / ALIGN_SAMPLE_RATE
        self._loaded: tuple[str, Any, dict] | None = None

    def _model(self, device_name: str):
        import whisperx

        if self._loaded is None or self._loaded[0] != device_name:
            ensure_nltk_data(self.log)
            self.log(f"loading the alignment model {self.model_name} on {device_name.upper()} (downloads on first use)")
            model, metadata = whisperx.load_align_model(
                self.language, device_name, model_name=self.model_name, model_dir=str(MODELS_DIR / "align")
            )
            self._loaded = (device_name, chunked_model(model, metadata["type"]), metadata)
        return self._loaded[1], self._loaded[2]

    def align(self, text: str, start_s: float = 0.0, end_s: float | None = None) -> list[dict]:
        import whisperx

        end_s = self.duration if end_s is None else min(end_s, self.duration)

        def run(device_name: str):
            model, metadata = self._model(device_name)
            result = whisperx.align(
                [{"text": text, "start": max(0.0, start_s), "end": end_s}],
                model,
                metadata,
                self.audio,
                device_name,
                return_char_alignments=False,
            )
            return result["word_segments"]

        words, self.device = with_cpu_fallback(self.device, "Alignment", run, self.log)
        return words


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
    With `trim`, words that swallowed a silent gap are cut back to their voice (app/refine.py)."""
    aligner = Aligner(vocals, language, model_name, device, log)
    log(f"aligning the lyrics with {model_name}")
    words = aligner.align(text)
    return (refine_words(words, aligner.audio, ALIGN_SAMPLE_RATE) if trim else words), aligner.device


def apply_hints(
    aligned: list[AlignedLine],
    decisions: list[HintDecision],
    aligner: Aligner,
    trim: bool,
) -> list[AlignedLine]:
    """Re-aligns each hinted line on its own, starting at its target; falls back to moving the line's
    words if the re-alignment does not land near the target."""
    lines = list(aligned)
    for d in sorted(decisions, key=lambda d: d.number):
        i = d.number - 1
        limit_ms = lines[i + 1].start_ms - 50 if i + 1 < len(lines) else None
        window_end = (limit_ms / 1000) if limit_ms is not None else d.target_ms / 1000 + max(4.0, 0.7 * len(lines[i].words))
        words = aligner.align(lines[i].text, d.target_ms / 1000 - 0.2, window_end)
        if trim:
            words = refine_words(words, aligner.audio, ALIGN_SAMPLE_RATE)
        candidate = words_to_lines([lines[i].text], [lines[i].is_hook], words)[0]
        if abs(candidate.start_ms - d.target_ms) <= 300 and (limit_ms is None or candidate.end_ms <= limit_ms + 50):
            lines[i], d.method = candidate, "re-aligned"
        else:
            lines[i], d.method = shift_line(lines[i], d.target_ms, limit_ms), "shifted"
        d.new_ms = lines[i].start_ms
    return lines


def print_hints(decisions: list[HintDecision], offset_ms: float, hint_file: Path) -> None:
    print()
    print(f"Hints from {hint_file.name} (lines below {HINT_CONFIDENCE} confidence; typical offset {offset_ms:+.0f} ms):")
    if not decisions:
        print("  no line needed adjusting")
        return
    for d in decisions:
        print(
            f"  line {d.number:>3}: {clock(d.aligned_ms)} -> {clock(d.new_ms or d.target_ms)}"
            f"  ({(d.new_ms or d.target_ms) - d.aligned_ms:+} ms; tapped {clock(d.tapped_ms)}, prior {clock(d.prior_ms)};"
            f" {d.source}, {d.method})  {d.text}"
        )


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


def output_path(lyrics: Path, out: str | None, protected: Path | list[Path | None] | None, cwd: Path) -> Path:
    """<lyrics>.lrc, unless that is a --compare / --hint file (on Windows lyrics.lrc and Lyrics.lrc
    are the same file): then <lyrics>.aligned.lrc, so those files are never overwritten."""
    target = (cwd / out).resolve() if out else lyrics.with_suffix(".lrc")
    keep = [p for p in (protected if isinstance(protected, list) else [protected]) if p is not None]
    if any(same_file(target, p) for p in keep):
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

def parse_line_list(values: list[str] | str | None) -> list[int]:
    """Line numbers from "2,9", "2 9", "2, 9" or separate arguments (PowerShell turns an unquoted
    2,9 into two arguments)."""
    if not values:
        return []
    text = " ".join(values) if isinstance(values, list) else values
    return sorted({int(part) for part in text.replace(",", " ").split()})


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
    p.add_argument(
        "--hint",
        metavar="TAPS.lrc",
        help=f"use hand-tapped times to fix lines below {HINT_CONFIDENCE} confidence (nearest voice onset to the tap)",
    )
    p.add_argument(
        "--diagnose",
        metavar="LINES",
        nargs="+",
        help='explain what the aligner heard for these lines: "2,9" or "2 9" (quote the list in PowerShell)',
    )
    p.add_argument("--report", metavar="FILE.json", help="also write per-line confidence and timings as JSON (used by pnpm make)")
    p.add_argument("--fresh", action="store_true", help="ignore the cached alignment and align again")
    p.add_argument("--cwd", help=argparse.SUPPRESS)
    return p


def line_report(aligned: list[AlignedLine], model_name: str, lang: str) -> dict:
    """Per-line confidence and sung times (start of the first word, end of the last word)."""
    return {
        "model": model_name,
        "lang": lang,
        "low_confidence": LOW_CONFIDENCE,
        "lines": [
            {
                "number": n,
                "text": line.text,
                "is_hook": line.is_hook,
                "start_ms": line.start_ms,
                "end_ms": line.end_ms,
                "confidence": round(line.confidence, 3),
                "words": [{"text": w.text, "start_ms": w.start_ms, "end_ms": w.end_ms} for w in line.words],
            }
            for n, line in enumerate(aligned, start=1)
        ],
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path(args.cwd or os.getcwd())
    resolve = lambda p: (cwd / p).resolve()  # noqa: E731
    song, lyrics = resolve(args.song), resolve(args.lyrics)
    reference = resolve(args.compare) if args.compare else None
    hint_file = resolve(args.hint) if args.hint else None
    if hint_file and not reference:
        reference = hint_file  # also show the comparison with the taps
    try:
        diagnose = parse_line_list(args.diagnose)
    except ValueError:
        print('--diagnose takes line numbers, e.g. "2,9" or "2 9"', file=sys.stderr)
        return 1
    for f in [song, lyrics, *([reference] if reference else []), *([hint_file] if hint_file else [])]:
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
    if cache.exists() and not args.fresh:
        log("alignment: cached")
        words = json.loads(cache.read_text(encoding="utf-8"))
    else:
        words, device = align_words(vocals, " ".join(texts), args.lang, model_name, device, log, trim=args.trim == "on")
        words = [{k: (float(v) if k in ("start", "end", "score") and v is not None else v) for k, v in w.items()} for w in words]
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(words), encoding="utf-8")

    aligned = words_to_lines(texts, hooks, words)
    original = list(aligned)  # before --hint (what --diagnose explains)

    taps = parse_lrc(hint_file.read_text(encoding="utf-8-sig")) if hint_file else None
    decisions: list[HintDecision] = []
    hint_offset = 0.0
    voice = None
    if taps is not None or diagnose:
        import librosa

        voice, _ = librosa.load(str(vocals), sr=ALIGN_SAMPLE_RATE, mono=True)
    if taps is not None:
        tap_match = compare(aligned, taps)
        hint_offset = tap_match.typical_offset_ms
        env = loudness_envelope(voice, ALIGN_SAMPLE_RATE)
        decisions = plan_hints(aligned, tap_match, voice_onsets(env, voice_threshold(env)))
        if decisions:
            aligner = Aligner(vocals, args.lang, model_name, device, log)
            aligned = apply_hints(aligned, decisions, aligner, trim=args.trim == "on")
            device = aligner.device

    lines_iter = iter(aligned)
    ordered = [("line", next(lines_iter)) if i.kind == "line" else ("pause", None) for i in items if i.kind != "end"]

    import soundfile as sf

    duration_ms = int(sf.info(str(song)).duration * 1000)
    out = output_path(lyrics, args.out, [reference, hint_file], cwd)
    if out.exists():
        out.with_suffix(".lrc.bak").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    out.write_text(
        build_lrc(ordered, duration_ms, header=["[ar:Life Lyrics]", f"[re:Lyric Studio - pnpm align ({model_name})]"]),
        encoding="utf-8",
    )

    if args.report:
        report = resolve(args.report)
        report.write_text(json.dumps(line_report(aligned, model_name, args.lang), indent=1), encoding="utf-8")

    comparison = compare(aligned, parse_lrc(reference.read_text(encoding="utf-8-sig"))) if reference else None
    print_lines(aligned, comparison)
    if hint_file:
        print_hints(decisions, hint_offset, hint_file)
    if comparison and reference:
        print_comparison(comparison, reference)
    if diagnose and voice is not None:
        snippets = workspace_dir() / "cache" / "diagnose"
        for n in diagnose:
            if not 1 <= n <= len(aligned):
                print(f"--diagnose: there is no line {n} (1-{len(aligned)})")
                continue
            print()
            for row in diagnose_line(
                n,
                original[n - 1],
                original[n - 2] if n > 1 else None,
                comparison.tapped_for(n) if comparison else None,
                voice,
                ALIGN_SAMPLE_RATE,
                snippets,
            ):
                print(row)
            moved = next((d for d in decisions if d.number == n), None)
            if moved:
                print(f"  --hint moved this line to {clock(moved.new_ms or moved.target_ms)} ({moved.source}, {moved.method})")
    print()
    if out.name.endswith(".aligned.lrc"):
        print(f"Note: {out.with_suffix('').with_suffix('.lrc').name} is your comparison/hint file, so the result was written to {out.name} instead.")
    print(f"Saved {len(aligned)} lines with word timings to {out}   ({time.time() - started:.0f} s, {device.description})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
