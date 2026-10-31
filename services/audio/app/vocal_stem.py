"""The vocal stem from Suno (vocals.wav in the song folder): checked against the song and lined up.

python -m app.vocal_stem <song> --stem <vocals.wav> [--out result.json]

The user's song.wav is Suno's finished mix, trimmed in a DAW (silence removed at the start and the end,
sometimes fades or mastering). vocals.wav is Suno's vocal stem, untouched: it can start earlier or later
than the song and be longer or shorter. Both files are only READ, never written: the stem is analysis
only, like the Demucs stem (it never goes into any video or output).

How it is checked (analysis only, both resampled to 8 kHz mono, voice band 150 Hz - 3.8 kHz):
  1. one offset for the whole song: cross-correlation (GCC-PHAT) of the stem against the song;
  2. the same measured again on several stretches where the stem has voice (start ... middle ... end):
     each must find a clear peak at the same offset (within MAX_SPREAD_S). A part cut or repeated in the
     middle, a tempo change or another version of the song breaks this, and the stem is not used (the app
     falls back to Demucs and says why in plain words).
A constant speed difference (the master exported a little faster or slower than the stem, e.g. 0.2 %) makes
the offset creep along the song and breaks that check; then the speed is searched (stem time = offset +
speed x song time; analysis copy of the stem only), and the same check is run on the stem warped to the
song's speed. When it matches, a lined-up copy on the song's own timeline (16 kHz mono, only the part that overlaps
the song, silence where the stem does not reach) is written to <workspace>/cache/stems/ and used by
pnpm align, the voice map and first_words instead of the Demucs stem. The check is cached per song and
stem content (cache/stems/match-<song>-<stem>.v<N>.json).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from .cache import file_hash
from .config import workspace_dir

VERSION = 2  # bump when the check or the lined-up copy changes
RATE = 8_000  # analysis rate for the comparison
BAND_HZ = (150.0, 3_800.0)  # the voice band
LINED_RATE = 16_000  # the lined-up copy: what the aligner, the voice map and first_words read
POINTS = 5  # stretches measured along the song (start ... middle ... end)
WINDOW_S = 12.0  # length of each measured stretch
MIN_POINTS = 3  # at least this many stretches with voice
# A drifting stem smears the whole-song peak, so the speed is searched from a lower strength (still above
# unrelated audio); the result must then pass every check above at MIN_STRENGTH.
SPEED_SEARCH_MIN_STRENGTH = 9.0
MIN_STRENGTH = 12.0  # a clear peak: this many standard deviations above the rest (unrelated audio: about 5-7)
MAX_SPREAD_S = 0.05  # every stretch must agree with the whole-song offset within this
MAX_UNCOVERED_S = 10.0  # the stem may miss at most this much of the song (start + end)
SPEED_RANGE = 0.01  # the speed difference searched: 0.99 ... 1.01
SPEED_COARSE = 0.001
SPEED_FINE = 0.0001
MIN_SPEED_DIFF = 0.0002  # a best speed closer to 1 than this is no speed difference

NOT_FOLLOWING = (
    "This vocal stem doesn't follow the song: probably another version of the song, or the song was "
    "edited in the middle. The app separates the vocals itself (Demucs) instead."
)


@dataclass
class Point:
    at_s: float  # where in the song (centre of the stretch)
    offset_s: float | None  # the offset this stretch found
    strength: float  # how clear its peak is (standard deviations)


@dataclass
class StemMatch:
    version: int
    status: str  # "lined-up" | "rejected"
    offset_ms: int | None  # stem time = offset + speed x song time (positive: the song was trimmed at the start)
    message: str  # plain words for the user
    reason: str  # technical detail (the log)
    stem_hash: str
    song_hash: str
    stem_rate: int
    song_rate: int
    covered_s: float | None = None  # how much of the song the stem covers
    strength: float | None = None  # the whole-song peak
    points: list[Point] = field(default_factory=list)
    speed: float | None = None  # stem seconds per song second, only when a speed difference was corrected

    @property
    def lined_up(self) -> bool:
        return self.status == "lined-up"


def offset_text(offset_ms: int) -> str:
    return f"{abs(offset_ms) / 1000:.1f} s"


def speed_text(speed: float) -> str:
    """"the song plays 0.2 % slower than the stem": stem time = offset + speed x song time, so a speed above 1
    means the stem gets through its material faster than the song does, i.e. the song plays faster."""
    pct = abs(speed - 1) * 100
    return f"the song plays {pct:.2g} % {'faster' if speed > 1 else 'slower'} than the stem"


def lined_up_message(offset_ms: int, speed: float | None = None) -> str:
    if speed is None:
        if abs(offset_ms) < 50:
            return "Vocal stem lined up: it starts with the song (no offset)."
        # A positive offset: the stem has more at its start than the song (silence trimmed from the song).
        side = "from trimming the song's start" if offset_ms > 0 else "the song starts earlier than the stem"
        return f"Vocal stem lined up: {offset_text(offset_ms)} offset, {side}."
    fix = f"{speed_text(speed)} (from the export), corrected for the lyric timing."
    if abs(offset_ms) < 50:
        return f"Vocal stem lined up: it starts with the song; {fix}"
    side = "from trimming the song's start" if offset_ms > 0 else "the song starts earlier than the stem"
    return f"Vocal stem lined up: {offset_text(offset_ms)} offset, {side}; {fix}"


# --------------------------------------------------------------------------- signal helpers

def load_mono(path: Path, rate: int) -> tuple[np.ndarray, int]:
    """The file as mono float32 at `rate` (resampled for analysis only), plus its own sample rate."""
    import librosa
    import soundfile as sf

    audio, native = sf.read(str(path), always_2d=True, dtype="float32")
    mono = audio.mean(axis=1)
    if native != rate:
        mono = librosa.resample(mono, orig_sr=native, target_sr=rate, res_type="soxr_hq")
    return np.ascontiguousarray(mono, dtype=np.float32), int(native)


def _band_weights(n: int, rate: int) -> np.ndarray:
    freqs = np.fft.rfftfreq(n, 1.0 / rate)
    return ((freqs >= BAND_HZ[0]) & (freqs <= BAND_HZ[1])).astype(np.float64)


def correlate(song: np.ndarray, stem: np.ndarray, rate: int) -> np.ndarray:
    """GCC-PHAT in the voice band. Index d (mod n) = how well stem[t + d] matches song[t]."""
    n = 1 << int(np.ceil(np.log2(len(song) + len(stem))))
    a = np.fft.rfft(song.astype(np.float64), n)
    b = np.fft.rfft(stem.astype(np.float64), n)
    cross = np.conj(a) * b
    cross *= _band_weights(n, rate) / (np.abs(cross) + 1e-12)
    return np.fft.irfft(cross, n)


def peak(corr: np.ndarray, lags: np.ndarray, guard: int) -> tuple[int, float]:
    """The best lag and how clear it is: (peak - mean) / std of the correlation away from the peak."""
    values = corr[lags % len(corr)]
    i = int(np.argmax(values))
    rest = np.concatenate([values[: max(0, i - guard)], values[i + guard + 1 :]])
    if len(rest) < 10 or rest.std() <= 0:
        return int(lags[i]), 0.0
    return int(lags[i]), float((values[i] - rest.mean()) / rest.std())


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))) if len(audio) else 0.0


# --------------------------------------------------------------------------- the check

def check_at_speed_one(song: np.ndarray, stem: np.ndarray, rate: int = RATE) -> tuple[str, int | None, str, float | None, float | None, list[Point]]:
    """The check for a stem at the song's own speed: (status, offset in samples, reason, covered seconds,
    whole-song strength, points)."""
    if rms(stem) < 1e-4:
        return "rejected", None, "the stem is silent", None, None, []
    if rms(song) < 1e-4:
        return "rejected", None, "the song is silent", None, None, []
    guard = int(0.02 * rate)
    # 1. One offset for the whole song (any lag where the two overlap).
    corr = correlate(song, stem, rate)
    lags = np.arange(-(len(song) - 1), len(stem))
    offset, strength = peak(corr, lags, guard)
    if strength < MIN_STRENGTH:
        return "rejected", None, f"no clear match for the whole song (strength {strength:.1f} < {MIN_STRENGTH})", None, strength, []
    # How much of the song the stem covers at that offset.
    first = max(0, -offset)
    last = min(len(song), len(stem) - offset)
    covered = max(0, last - first) / rate
    uncovered = len(song) / rate - covered
    # 2. The same offset on several stretches with voice, spread over the overlap.
    win = int(WINDOW_S * rate)
    hop = int(0.5 * rate)
    aligned = np.zeros(len(song), dtype=np.float32)  # the stem on the song's timeline (for choosing stretches)
    aligned[first:last] = stem[first + offset : last + offset]
    span = last - first
    points: list[Point] = []
    if span < win:
        starts = [first]
    else:
        edges = np.linspace(first, last - win, POINTS + 1)
        starts = []
        for k in range(POINTS):
            # In each part of the song: the stretch where the stem is loudest (voice, not a gap).
            a, b = int(edges[k]), int(edges[k + 1])
            candidates = list(range(a, max(a + 1, b), hop))
            levels = [rms(aligned[c : c + win]) for c in candidates]
            starts.append(candidates[int(np.argmax(levels))])
    search = int(30 * rate)  # each stretch may find its stem anywhere within 30 s of the expected place
    for s in starts:
        piece = song[s : s + win]
        voiced = rms(aligned[s : s + win]) >= 0.05 * rms(aligned[first:last])
        if not voiced:
            continue
        lo = max(0, s + offset - search)
        hi = min(len(stem), s + offset + win + search)
        local = correlate(piece, stem[lo:hi], rate)
        local_lags = np.arange(0, max(1, hi - lo - len(piece) + 1))
        if not len(local_lags):
            points.append(Point(round((s + win / 2) / rate, 2), None, 0.0))
            continue
        lag, st = peak(local, local_lags, guard)
        points.append(Point(round((s + win / 2) / rate, 2), round((lo + lag - s) / rate, 4), round(st, 1)))
    if len(points) < min(MIN_POINTS, len(starts)):
        return "rejected", offset, f"only {len(points)} stretch(es) with voice to compare (at least {MIN_POINTS} needed)", covered, strength, points
    weak = [p for p in points if p.strength < MIN_STRENGTH or p.offset_s is None]
    off = [p for p in points if p.offset_s is not None and abs(p.offset_s - offset / rate) > MAX_SPREAD_S]
    if weak or off:
        detail = "; ".join(
            f"at {p.at_s:.0f} s: {'no clear match' if p in weak else f'offset {p.offset_s:+.2f} s'} (strength {p.strength:.1f})" for p in [*weak, *off]
        )
        return "rejected", offset, f"the offset does not stay the same along the song (whole song {offset / rate:+.2f} s; {detail})", covered, strength, points
    if uncovered > MAX_UNCOVERED_S:
        return "rejected", offset, f"the stem covers only {covered:.1f} s of the song's {len(song) / rate:.1f} s", covered, strength, points
    return "lined-up", offset, f"offset {offset / rate:+.3f} s at every measured stretch (strength {strength:.1f} for the whole song)", covered, strength, points

# --------------------------------------------------------------------------- a constant speed difference

def warp(stem: np.ndarray, f: float, rate: int = RATE, quality: str = "HQ") -> np.ndarray:
    """The stem (analysis copy) played at another speed: warped[x] = stem[f * x]."""
    import soxr

    return np.ascontiguousarray(soxr.resample(stem, f * rate, rate, quality=quality), dtype=np.float32)


def find_speed(song: np.ndarray, stem: np.ndarray, rate: int = RATE) -> tuple[float, float]:
    """The speed f (0.99 ... 1.01) at which the warped stem matches the whole song best: (f, strength).
    Coarse steps first, then fine steps around the best."""
    from scipy import fft as sfft

    n = sfft.next_fast_len(int(len(song) + len(stem) / (1 - SPEED_RANGE)) + 16, real=True)
    weights = _band_weights(n, rate).astype(np.float32)
    a = np.conj(sfft.rfft(song.astype(np.float32), n, workers=-1))
    guard = int(0.02 * rate)
    tried: dict[float, float] = {}

    def strength_at(f: float) -> float:
        f = round(f, 6)
        if f not in tried:
            b = sfft.rfft(warp(stem, f, rate, "MQ"), n, workers=-1)
            cross = a * b
            cross *= weights / (np.abs(cross) + 1e-9)
            corr = sfft.irfft(cross, n, workers=-1)
            lags = np.arange(-(len(song) - 1), int(len(stem) / f) + 1)
            tried[f] = peak(corr, lags, guard)[1]
        return tried[f]

    steps = int(round(SPEED_RANGE / SPEED_COARSE))
    best = max((1 + k * SPEED_COARSE for k in range(-steps, steps + 1)), key=strength_at)
    ratio = int(round(SPEED_COARSE / SPEED_FINE))
    best = max((best + k * SPEED_FINE for k in range(-ratio, ratio + 1)), key=strength_at)
    best = round(best, 6)
    return best, tried[best]


def match_audio(song: np.ndarray, stem: np.ndarray, rate: int = RATE) -> tuple[str, int | None, str, float | None, float | None, list[Point], float | None]:
    """(status, offset in samples of real stem time, reason, covered seconds, whole-song strength, points,
    speed). The speed is None unless a constant speed difference had to be corrected."""
    status, offset, reason, covered, strength, points = check_at_speed_one(song, stem, rate)
    if status == "lined-up" or strength is None or strength < SPEED_SEARCH_MIN_STRENGTH:
        return status, offset, reason, covered, strength, points, None
    f, f_strength = find_speed(song, stem, rate)
    if abs(f - 1) < MIN_SPEED_DIFF:
        return status, offset, reason, covered, strength, points, None
    w_status, w_offset, w_reason, w_covered, w_strength, w_points = check_at_speed_one(song, warp(stem, f, rate), rate)
    if w_status == "lined-up" and w_offset is not None:
        # warped[x + d] matches song[x], warped[x] = stem[f x]: stem time = f d + f x.
        real = int(round(f * w_offset))
        return "lined-up", real, f"offset {real / rate:+.3f} s, speed {f:.5f} at every measured stretch (strength {f_strength:.1f} for the whole song)", w_covered, f_strength, w_points, f
    why = f"{reason}; with the stem's speed corrected by {f:.5f} (strength {f_strength:.1f}) it fails too: {w_reason}"
    return status, offset, why, covered, strength, points, None


def match_files(song: Path, stem: Path) -> StemMatch:
    song_audio, song_rate = load_mono(song, RATE)
    stem_audio, stem_rate = load_mono(stem, RATE)
    status, offset, reason, covered, strength, points, speed = match_audio(song_audio, stem_audio, RATE)
    offset_ms = round(offset * 1000 / RATE) if offset is not None and status == "lined-up" else None
    if status == "lined-up":
        message = lined_up_message(offset_ms or 0, speed)
    elif "silent" in reason and "stem" in reason:
        message = "This vocal stem is silent: download the vocal stem again. The app separates the vocals itself (Demucs) meanwhile."
    elif "covers only" in reason:
        message = "This vocal stem is much shorter than the song: download the whole vocal stem. The app separates the vocals itself (Demucs) meanwhile."
    else:
        message = NOT_FOLLOWING
    return StemMatch(
        version=VERSION,
        status=status,
        offset_ms=offset_ms,
        message=message,
        reason=reason,
        stem_hash=file_hash(stem),
        song_hash=file_hash(song),
        stem_rate=stem_rate,
        song_rate=song_rate,
        covered_s=round(covered, 2) if covered is not None else None,
        strength=round(strength, 1) if strength is not None else None,
        points=points,
        speed=round(speed, 6) if speed is not None else None,
    )


def stems_dir() -> Path:
    return workspace_dir() / "cache" / "stems"


def match_cache_file(song_hash: str, stem_hash: str) -> Path:
    return stems_dir() / f"match-{song_hash[:16]}-{stem_hash[:16]}.v{VERSION}.json"


def lined_up_file(song_hash: str, stem_hash: str, offset_ms: int, speed: float | None = None) -> Path:
    corrected = f"-x{speed:.5f}" if speed is not None else ""
    return stems_dir() / f"{song_hash}-suno-{stem_hash[:12]}-{offset_ms:+d}ms{corrected}-vocals.wav"


def check_stem(song: Path, stem: Path, log: Callable[[str], None] = print) -> StemMatch:
    """The check, from the cache when this song and this stem were compared before."""
    song_hash, stem_hash = file_hash(song), file_hash(stem)
    cached = match_cache_file(song_hash, stem_hash)
    if cached.exists():
        try:
            data = json.loads(cached.read_text(encoding="utf-8"))
            data["points"] = [Point(**p) for p in data.get("points", [])]
            return StemMatch(**data)
        except (ValueError, TypeError):
            pass  # damaged: check again
    log(f"vocal stem: comparing {stem.name} with {song.name} (analysis only)")
    result = match_files(song, stem)
    cached.parent.mkdir(parents=True, exist_ok=True)
    tmp = cached.with_suffix(f".{os.getpid()}.part")
    tmp.write_text(json.dumps(asdict(result), indent=1), encoding="utf-8")
    os.replace(tmp, cached)
    return result


def write_lined_up(song: Path, stem: Path, m: StemMatch) -> Path:
    """The stem on the song's own timeline (16 kHz mono float WAV in the cache): what overlaps the song,
    silence where the stem does not reach. Written once per song, stem and offset."""
    import soundfile as sf

    assert m.lined_up and m.offset_ms is not None
    out = lined_up_file(m.song_hash, m.stem_hash, m.offset_ms, m.speed)
    if out.exists():
        return out
    stem_audio, _ = load_mono(stem, LINED_RATE)
    length = int(round(sf.info(str(song)).duration * LINED_RATE))
    shift = int(round(m.offset_ms * LINED_RATE / 1000))
    if m.speed is not None:
        # stem time = offset + speed x song time: play the stem at the song's speed (warped[x] = stem[speed x]),
        # then the offset in song-speed seconds is offset / speed.
        stem_audio = warp(stem_audio, m.speed, LINED_RATE)
        shift = int(round(m.offset_ms * LINED_RATE / 1000 / m.speed))
    lined = np.zeros(length, dtype=np.float32)
    first = max(0, -shift)
    last = min(length, len(stem_audio) - shift)
    if last > first:
        lined[first:last] = stem_audio[first + shift : last + shift]
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.stem}.{os.getpid()}.part.wav")
    sf.write(str(tmp), lined, LINED_RATE, subtype="FLOAT")
    os.replace(tmp, out)
    return out


# --------------------------------------------------------------------------- the voice source

@dataclass
class VoiceSource:
    kind: str  # "stem" (Suno's vocal stem, lined up) | "demucs" (separated by the app)
    label: str  # "vocal stem, offset 1.8 s" | "separated by the app"
    offset_ms: int | None = None
    stem_hash: str | None = None
    message: str | None = None  # the check's message (lined up, or why the stem is not used)
    speed: float | None = None  # only when a speed difference is corrected

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


def stem_argument(song: Path, value: str | None) -> Path | None:
    """--stem: a file, "none", or "auto" (default): the song folder's vocal stem, any name, as linked in
    .studio/files.json ("vocals"), else vocals.wav next to the song when there is one."""
    if value is None or value == "auto":
        try:
            linked = json.loads((song.parent / ".studio" / "files.json").read_text(encoding="utf-8")).get("vocals")
        except (OSError, ValueError, AttributeError):
            linked = None
        if isinstance(linked, str) and linked and Path(linked).name == linked and (song.parent / linked).is_file():
            return song.parent / linked
        own = song.parent / "vocals.wav"
        return own if own.is_file() else None
    if value == "none":
        return None
    return Path(value).resolve()


def stem_track(song: Path, stem: Path | None, log: Callable[[str], None]) -> tuple[Path | None, VoiceSource]:
    """The lined-up Suno stem when it matches the song (path, source); (None, demucs source) otherwise."""
    if stem is None:
        return None, VoiceSource("demucs", "separated by the app")
    if not stem.is_file():
        log(f"vocal stem: {stem} not found; the app separates the vocals itself (Demucs)")
        return None, VoiceSource("demucs", "separated by the app", message=f"{stem.name} not found")
    m = check_stem(song, stem, log)
    if not m.lined_up:
        log(f"vocal stem: {m.message} ({m.reason})")
        return None, VoiceSource("demucs", "separated by the app (the vocal stem doesn't follow the song)", stem_hash=m.stem_hash, message=m.message)
    out = write_lined_up(song, stem, m)
    label = f"vocal stem, offset {offset_text(m.offset_ms or 0)}" + (", speed corrected" if m.speed is not None else "")
    log(f"vocal stem: {m.message} Using {stem.name} ({out.name})")
    return out, VoiceSource("stem", label, offset_ms=m.offset_ms, stem_hash=m.stem_hash, message=m.message, speed=m.speed)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vocal_stem", description="Check a Suno vocal stem against the song (analysis only).")
    parser.add_argument("song")
    parser.add_argument("--stem", required=True)
    parser.add_argument("--out", help="write the result as JSON")
    parser.add_argument("--line-up", action="store_true", help="also write the lined-up copy (cache) when it matches")
    args = parser.parse_args(argv)
    song, stem = Path(args.song).resolve(), Path(args.stem).resolve()
    for f in (song, stem):
        if not f.is_file():
            print(f"File not found: {f}", file=sys.stderr)
            return 1
    log = lambda m: print(m, flush=True)  # noqa: E731
    m = check_stem(song, stem, log)
    result = asdict(m)
    if m.lined_up and args.line_up:
        result["lined_up_file"] = str(write_lined_up(song, stem, m))
    print(m.message)
    if m.speed is not None:
        print(f"  speed: x{m.speed:.5f} (stem time = offset + speed x song time)")
    print(f"  ({m.reason})")
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".part")
        tmp.write_text(json.dumps(result, indent=1), encoding="utf-8")
        os.replace(tmp, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
